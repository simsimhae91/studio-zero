import { z } from 'zod';
import type { ReviewerId } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { CliBridgeEngine } from '../harness/engines/CliBridgeEngine.ts';
import { textBlock, type ClaudeClient, type LlmScope } from '../llm/ClaudeClient.ts';
import { PolicyDeniedError } from '../policy/PolicyEngine.ts';
import { errorMessage, type Logger } from '../util/core.ts';
import { VISION_MODEL, VISION_SYSTEM_PROMPT, VisionReply, toScreenReview, visionContent, visionJsonSchema, visionText, type ScreenReview, type VisionInput } from './vision.ts';

/** One review is a few images and a page of text; a reviewer that has not answered in this long is not going to. */
const REVIEW_TIMEOUT_MS = 6 * 60 * 1000;
const PING_TIMEOUT_MS = 2 * 60 * 1000;

type VendorId = Exclude<ReviewerId, 'api' | 'claude-code'>;
/** What the bridge needs of another vendor's CLI: whether it is there, and one question that can carry pictures. */
export type VendorReviewer = Pick<CliBridgeEngine, 'availability' | 'ask'>;

export interface VisionAttempt {
  path: ReviewerId;
  error: string;
  /** The reviewer refused for a usage or budget limit: it will answer again once that limit moves. */
  limited: boolean;
}

/** No reviewer produced a review. `attempts` says what each one answered. */
export class VisionUnavailableError extends Error {
  readonly attempts: readonly VisionAttempt[];
  /** True when asking again for another screen cannot go differently: the budget is spent, or there is nobody to ask. */
  readonly final: boolean;

  constructor(reason: string, attempts: readonly VisionAttempt[], final: boolean) {
    super(reason);
    this.name = 'VisionUnavailableError';
    this.attempts = attempts;
    this.final = final;
  }

  /** True when at least one reviewer is only out of quota: waiting is enough to get the review. */
  get limited(): boolean {
    return this.attempts.some((a) => a.limited);
  }
}

export interface VisionAvailability {
  status: 'ready' | 'off' | 'unavailable';
  /** The reviewers a review can be asked of right now, in the order they are tried. Empty unless `ready`. */
  paths: ReviewerId[];
  reason: string | null;
}

/** How vendors say "you are out of quota". Their wording differs; these are the words they share. */
const LIMIT = /usage limit|rate.?limit|limit reached|hit your [\w ]*limit|quota|한도|\b429\b|too many requests|resource[ _]?exhausted|overloaded|at capacity/i;

export function isUsageLimit(err: unknown): boolean {
  return (err instanceof PolicyDeniedError && err.rule.startsWith('budget.')) || LIMIT.test(errorMessage(err));
}

/**
 * A reviewer without schema enforcement is asked for JSON and nothing else; this reads what came back, with or
 * without a code fence around it. What it returns is still validated against the schema by the caller.
 */
export function jsonFrom(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('the reviewer did not answer with a JSON object');
    return JSON.parse(body.slice(start, end + 1));
  }
}

const Pong = z.object({ ok: z.boolean() });

/**
 * The design reviewer's line out. A review is offered to one reviewer after another, and who they are is
 * decided by what the owner has set up, never by a model:
 *
 * - `api`: the Anthropic API key in the Keychain, through the SDK's structured outputs. Tried first when there is one.
 * - then the owner's subscriptions, in the order of `audit.reviewers` (Codex, Claude, Antigravity, Cursor by
 *   default), each through its own CLI under that CLI's lockdown: no tools, or a host jail where the tools
 *   cannot be switched off. The screenshots are handed over by the CLI or the protocol (inline image blocks
 *   for Claude, `--image` for Codex, ACP image blocks for Antigravity and Cursor); no reviewer fetches them
 *   with a tool. The reply is held to the schema by the CLI where it can (`--json-schema`, `--output-schema`)
 *   and validated here in every case.
 *
 * The next reviewer is asked only when the one before fails or is out of quota. A spent budget is not such a
 * failure: it is the same wall for every reviewer, so it ends the attempt.
 *
 * Reviews are the daemon's own calls (`judge` scope): metered into the task's ledger, gated on the project's
 * daily budget. Before this, a task that had spent its own budget had its design review refused by the task
 * budget rule, and the audit went on to pass on measurements alone.
 */
export class QaVisionBridge {
  readonly #config: Config;
  readonly #claude: ClaudeClient;
  readonly #vendors: Partial<Record<VendorId, VendorReviewer>>;
  readonly #log: Logger;

  constructor(deps: { config: Config; claude: ClaudeClient; vendors?: Partial<Record<VendorId, VendorReviewer>>; log: Logger }) {
    this.#config = deps.config;
    this.#claude = deps.claude;
    this.#vendors = deps.vendors ?? {};
    this.#log = deps.log;
  }

  async availability(): Promise<VisionAvailability> {
    if (!this.#config.audit.vision) return { status: 'off', paths: [], reason: 'the design review is switched off (audit.vision in config.json)' };
    const paths: ReviewerId[] = this.#claude.hasApiKey() ? ['api'] : [];
    for (const id of this.#config.audit.reviewers) {
      const there = id === 'claude-code' ? this.#claude.paths().includes('session') : ((await this.#vendors[id]?.availability())?.available ?? false);
      if (there) paths.push(id);
    }
    if (paths.length === 0) return { status: 'unavailable', paths, reason: `no reviewer to ask: there is no Anthropic API key in the vault and none of the subscription CLIs (${this.#config.audit.reviewers.join(', ')}) is available` };
    return { status: 'ready', paths, reason: null };
  }

  async review(input: VisionInput): Promise<{ review: ScreenReview; via: ReviewerId; model: string }> {
    const available = await this.availability();
    if (available.status !== 'ready') throw new VisionUnavailableError(available.reason ?? 'the design review is not available', [], true);

    const attempts: VisionAttempt[] = [];
    for (const path of available.paths) {
      try {
        const reply = await this.#ask(path, input);
        return { review: toScreenReview(reply, input), via: path, model: modelOf(path) };
      } catch (err) {
        if (input.signal?.aborted) throw err;
        attempts.push({ path, error: errorMessage(err), limited: isUsageLimit(err) });
        this.#log.warn({ path, viewport: input.viewport, route: input.route, err: errorMessage(err) }, 'design review attempt failed');
        if (err instanceof PolicyDeniedError) throw new VisionUnavailableError(describe(attempts), attempts, true);
      }
    }
    throw new VisionUnavailableError(describe(attempts), attempts, false);
  }

  /**
   * Whether a review could be had right now: the first reviewer that answers a one-word question, or null.
   * This is how a suspended task learns that a usage limit has moved. A reviewer still at its limit refuses
   * the question for nothing; the one that answers is metered like any other call.
   */
  async probe(scope: LlmScope, signal?: AbortSignal): Promise<ReviewerId | null> {
    const judge = { ...scope, judge: true };
    for (const path of (await this.availability()).paths) {
      try {
        if (path === 'api' || path === 'claude-code') {
          await this.#claude.structured({ scope: judge, model: VISION_MODEL, effort: 'low', system: 'Answer exactly as asked.', schema: Pong, content: [textBlock('Set ok to true.')], via: path === 'api' ? 'api' : 'session', timeoutMs: PING_TIMEOUT_MS, signal });
        } else {
          await this.#claude.gate(judge, modelOf(path));
          const answer = await this.#vendors[path]!.ask({ system: 'Answer exactly as asked.', question: 'Reply with the single word: ok', effort: 'low', timeoutMs: PING_TIMEOUT_MS, signal });
          this.#claude.recordBridge(judge, modelOf(path), answer);
        }
        return path;
      } catch (err) {
        if (signal?.aborted) throw err;
        if (err instanceof PolicyDeniedError) return null;
      }
    }
    return null;
  }

  async #ask(path: ReviewerId, input: VisionInput): Promise<VisionReply> {
    const scope = { ...input.scope, judge: true };
    if (path === 'api' || path === 'claude-code') {
      return this.#claude.structured({
        scope,
        model: VISION_MODEL,
        effort: 'high',
        system: VISION_SYSTEM_PROMPT,
        schema: VisionReply,
        maxTokens: 16_000,
        signal: input.signal,
        via: path === 'api' ? 'api' : 'session',
        timeoutMs: REVIEW_TIMEOUT_MS,
        content: visionContent(input),
      });
    }
    const schema = visionJsonSchema();
    await this.#claude.gate(scope, modelOf(path));
    const answer = await this.#vendors[path]!.ask({
      system: VISION_SYSTEM_PROMPT,
      question: `${visionText(input)}\n\nThe screenshots are attached to this message. Answer with one JSON object and nothing else: no prose before or after it, no code fence. It must be valid against this JSON Schema:\n${JSON.stringify(schema)}`,
      images: input.folds,
      jsonSchema: schema,
      effort: 'high',
      signal: input.signal,
      timeoutMs: REVIEW_TIMEOUT_MS,
    });
    // The tokens were spent whether or not the answer turns out to be usable.
    this.#claude.recordBridge(scope, modelOf(path), answer);
    return VisionReply.parse(jsonFrom(answer.text));
  }
}

/** The model behind a reviewer. Fixed for Claude; another vendor's CLI runs whatever its own default is. */
function modelOf(path: ReviewerId): string {
  return path === 'api' || path === 'claude-code' ? VISION_MODEL : `${path}:default`;
}

const REVIEWER_NAME: Record<ReviewerId, string> = { api: 'API key', codex: 'Codex subscription', 'claude-code': 'Claude subscription', antigravity: 'Antigravity subscription', cursor: 'Cursor subscription' };

function describe(attempts: readonly VisionAttempt[]): string {
  return attempts.map((a) => `${REVIEWER_NAME[a.path]}: ${a.error.split('\n')[0]}`).join('; ');
}

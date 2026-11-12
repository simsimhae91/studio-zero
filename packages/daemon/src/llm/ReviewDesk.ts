import type { z } from 'zod';
import type { ReviewerId } from '@studio-zero/protocol';
import type { Effort } from '../config.ts';
import type { CliBridgeEngine } from '../harness/engines/CliBridgeEngine.ts';
import { PolicyDeniedError } from '../policy/PolicyEngine.ts';
import { errorMessage } from '../util/core.ts';
import { pngBlock, textBlock, type ClaudeClient, type LlmScope } from './ClaudeClient.ts';

/** The model behind Claude when it reviews. Fixed in code, like every model on the verification side. */
export const REVIEW_MODEL = 'claude-fable-5-2';

export type VendorId = Exclude<ReviewerId, 'api' | 'claude-code'>;
/** What a review needs of another vendor's CLI: whether it is there, and one question that can carry pictures. */
export type VendorReviewer = Pick<CliBridgeEngine, 'availability' | 'ask'>;

/** How vendors say "you are out of quota". Their wording differs; these are the words they share. */
const LIMIT = /usage limit|rate.?limit|limit reached|hit your [\w ]*limit|quota|한도|\b429\b|too many requests|resource[ _]?exhausted|overloaded|at capacity/i;

/** True when the words are a vendor refusing for a usage limit: time, not a fix, brings the answer back. */
export function saysUsageLimit(text: string): boolean {
  return LIMIT.test(text);
}

export function isUsageLimit(err: unknown): boolean {
  return (err instanceof PolicyDeniedError && err.rule.startsWith('budget.')) || saysUsageLimit(errorMessage(err));
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

export interface ReviewRequest<Schema extends z.ZodType> {
  scope: LlmScope;
  system: string;
  /** The user turn in order: text, and PNG pictures where they belong in it. */
  parts: readonly (string | Uint8Array)[];
  schema: Schema;
  effort: Effort;
  maxTokens?: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * One question to one reviewer, answered in a schema. A reviewer is the Anthropic API key, or one of the
 * owner's subscriptions through its CLI under that CLI's lockdown: no tools, or a host jail where the tools
 * cannot be switched off. Pictures are handed over by the CLI or the protocol (inline image blocks for Claude,
 * `--image` for Codex, ACP image blocks for Antigravity and Cursor); no reviewer fetches anything with a tool.
 * The answer is held to the schema by the CLI where it can and validated here in every case.
 *
 * Every such call is the daemon's own (`judge` scope): metered into the task's ledger, gated on the project's
 * daily budget, so the work under review cannot starve its own reviewer by spending the task's budget first.
 *
 * Who is asked is the caller's decision. The design review offers a screen to its reviewers in turn; a task's
 * two cross-checks go to the one subscription paired with its lead engine.
 */
export class ReviewDesk {
  readonly #claude: ClaudeClient;
  readonly #vendors: Partial<Record<VendorId, VendorReviewer>>;

  constructor(deps: { claude: ClaudeClient; vendors?: Partial<Record<VendorId, VendorReviewer>> }) {
    this.#claude = deps.claude;
    this.#vendors = deps.vendors ?? {};
  }

  /** The model behind a reviewer. Fixed for Claude; another vendor's CLI runs whatever its own default is. */
  modelOf(path: ReviewerId): string {
    return path === 'api' || path === 'claude-code' ? REVIEW_MODEL : `${path}:default`;
  }

  hasApiKey(): boolean {
    return this.#claude.hasApiKey();
  }

  /** Whether this reviewer can be asked right now. */
  async available(path: ReviewerId): Promise<boolean> {
    if (path === 'api') return this.#claude.hasApiKey();
    if (path === 'claude-code') return this.#claude.paths().includes('session');
    return (await this.#vendors[path]?.availability())?.available ?? false;
  }

  async ask<Schema extends z.ZodType>(path: ReviewerId, req: ReviewRequest<Schema>): Promise<z.infer<Schema>> {
    const scope = { ...req.scope, judge: true };
    if (path === 'api' || path === 'claude-code') {
      return this.#claude.structured({
        scope,
        model: REVIEW_MODEL,
        effort: req.effort,
        system: req.system,
        schema: req.schema,
        ...(req.maxTokens === undefined ? {} : { maxTokens: req.maxTokens }),
        signal: req.signal,
        via: path === 'api' ? 'api' : 'session',
        timeoutMs: req.timeoutMs,
        content: req.parts.map((part) => (typeof part === 'string' ? textBlock(part) : pngBlock(part))),
      });
    }
    const { z: zod } = await import('zod');
    const { $schema: _dialect, ...schema } = zod.toJSONSchema(req.schema) as Record<string, unknown>;
    const images = req.parts.filter((part): part is Uint8Array => typeof part !== 'string');
    const text = req.parts.filter((part): part is string => typeof part === 'string').join('\n\n');
    await this.#claude.gate(scope, this.modelOf(path));
    const answer = await this.#vendors[path]!.ask({
      system: req.system,
      question: `${text}\n\n${images.length > 0 ? 'The screenshots are attached to this message. ' : ''}Answer with one JSON object and nothing else: no prose before or after it, no code fence. It must be valid against this JSON Schema:\n${JSON.stringify(schema)}`,
      ...(images.length > 0 ? { images } : {}),
      jsonSchema: schema,
      effort: req.effort,
      signal: req.signal,
      timeoutMs: req.timeoutMs,
    });
    // The tokens were spent whether or not the answer turns out to be usable.
    this.#claude.recordBridge(scope, this.modelOf(path), answer);
    return req.schema.parse(jsonFrom(answer.text)) as z.infer<Schema>;
  }

  /** A one-word question: does this reviewer answer at all right now? Metered like any other call when it does. */
  async ping(path: ReviewerId, scope: LlmScope, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    const judge = { ...scope, judge: true };
    if (path === 'api' || path === 'claude-code') {
      const { z: zod } = await import('zod');
      await this.#claude.structured({ scope: judge, model: REVIEW_MODEL, effort: 'low', system: 'Answer exactly as asked.', schema: zod.object({ ok: zod.boolean() }), content: [textBlock('Set ok to true.')], via: path === 'api' ? 'api' : 'session', timeoutMs, signal });
      return;
    }
    await this.#claude.gate(judge, this.modelOf(path));
    const answer = await this.#vendors[path]!.ask({ system: 'Answer exactly as asked.', question: 'Reply with the single word: ok', effort: 'low', timeoutMs, signal });
    this.#claude.recordBridge(judge, this.modelOf(path), answer);
  }
}

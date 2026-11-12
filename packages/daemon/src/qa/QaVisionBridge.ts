import type { ReviewerId } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { ClaudeClient, LlmScope } from '../llm/ClaudeClient.ts';
import { ReviewDesk, isUsageLimit, type VendorId, type VendorReviewer } from '../llm/ReviewDesk.ts';
import { PolicyDeniedError } from '../policy/PolicyEngine.ts';
import { errorMessage, type Logger } from '../util/core.ts';
import { VISION_SYSTEM_PROMPT, VisionReply, toScreenReview, visionParts, type ScreenReview, type VisionInput } from './vision.ts';

export { isUsageLimit, jsonFrom, type VendorReviewer } from '../llm/ReviewDesk.ts';

/** One review is a few images and a page of text; a reviewer that has not answered in this long is not going to. */
const REVIEW_TIMEOUT_MS = 6 * 60 * 1000;
const PING_TIMEOUT_MS = 2 * 60 * 1000;

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

/**
 * The design reviewer's line out. A review is offered to one reviewer after another, and who they are is
 * decided by what the owner has set up, never by a model:
 *
 * - `api`: the Anthropic API key in the Keychain, through the SDK's structured outputs. Tried first when there is one.
 * - then the owner's subscriptions, in the order of `audit.reviewers` (Codex, Claude, Antigravity, Cursor by
 *   default), each through its own CLI under that CLI's lockdown: no tools, or a host jail where the tools
 *   cannot be switched off (see `ReviewDesk`, which carries the question and validates the answer).
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
  readonly #desk: ReviewDesk;
  readonly #log: Logger;

  constructor(deps: { config: Config; claude: ClaudeClient; vendors?: Partial<Record<VendorId, VendorReviewer>>; desk?: ReviewDesk; log: Logger }) {
    this.#config = deps.config;
    this.#desk = deps.desk ?? new ReviewDesk({ claude: deps.claude, vendors: deps.vendors });
    this.#log = deps.log;
  }

  async availability(): Promise<VisionAvailability> {
    if (!this.#config.audit.vision) return { status: 'off', paths: [], reason: 'the design review is switched off (audit.vision in config.json)' };
    const paths: ReviewerId[] = this.#desk.hasApiKey() ? ['api'] : [];
    for (const id of this.#config.audit.reviewers) if (await this.#desk.available(id)) paths.push(id);
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
        return { review: toScreenReview(reply, input), via: path, model: this.#desk.modelOf(path) };
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
    for (const path of (await this.availability()).paths) {
      try {
        await this.#desk.ping(path, scope, PING_TIMEOUT_MS, signal);
        return path;
      } catch (err) {
        if (signal?.aborted) throw err;
        if (err instanceof PolicyDeniedError) return null;
      }
    }
    return null;
  }

  #ask(path: ReviewerId, input: VisionInput): Promise<VisionReply> {
    const parts = visionParts(input);
    return this.#desk.ask(path, { scope: input.scope, system: VISION_SYSTEM_PROMPT, parts: [parts.head, ...input.folds, parts.elements, parts.measured], schema: VisionReply, effort: 'high', maxTokens: 16_000, timeoutMs: REVIEW_TIMEOUT_MS, signal: input.signal });
  }
}

const REVIEWER_NAME: Record<ReviewerId, string> = { api: 'API key', codex: 'Codex subscription', 'claude-code': 'Claude subscription', antigravity: 'Antigravity subscription', cursor: 'Cursor subscription' };

function describe(attempts: readonly VisionAttempt[]): string {
  return attempts.map((a) => `${REVIEWER_NAME[a.path]}: ${a.error.split('\n')[0]}`).join('; ');
}

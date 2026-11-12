import type { Config } from '../config.ts';
import type { ClaudeClient, LlmPath } from '../llm/ClaudeClient.ts';
import { PolicyDeniedError } from '../policy/PolicyEngine.ts';
import { errorMessage, type Logger } from '../util/core.ts';
import { VISION_MODEL, VISION_SYSTEM_PROMPT, VisionReply, toScreenReview, visionContent, type ScreenReview, type VisionInput } from './vision.ts';

/** One review is a few images and a page of text; a path that has not answered in this long is not going to. */
const REVIEW_TIMEOUT_MS = 6 * 60 * 1000;

export interface VisionAttempt {
  path: LlmPath;
  error: string;
}

/** No path produced a review. `attempts` says what each one answered. */
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
}

export interface VisionAvailability {
  status: 'ready' | 'off' | 'unavailable';
  /** The paths a review can travel right now, in the order they are tried. Empty unless `ready`. */
  paths: LlmPath[];
  reason: string | null;
}

/**
 * The design reviewer's line out. A review travels one of two ways, and which is decided by what the owner has
 * set up, never by a model:
 *
 * - `api`: the Anthropic API key in the Keychain, through the SDK's structured outputs;
 * - `session`: no key; the owner's Claude subscription, through the Claude Code CLI run headless with every
 *   tool switched off. The screenshots go in on stdin as image blocks of one stream-json message, so the
 *   reviewer never needs a file path, and with it never needs file access; `--json-schema` constrains the reply.
 *
 * A stored key is tried first. If that path fails for a reason of its own (the provider is down, the key was
 * revoked, the reply did not parse) and the subscription CLI is there, the same review is asked again that way.
 * A spent budget is not such a reason: it is the same wall on both paths, so it ends the attempt.
 *
 * Reviews are the daemon's own calls (`judge` scope): metered into the task's ledger, gated on the project's
 * daily budget. Before this, a task that had spent its own budget had its design review refused by the task
 * budget rule, and the audit went on to pass on measurements alone.
 */
export class QaVisionBridge {
  readonly #config: Config;
  readonly #claude: ClaudeClient;
  readonly #log: Logger;

  constructor(deps: { config: Config; claude: ClaudeClient; log: Logger }) {
    this.#config = deps.config;
    this.#claude = deps.claude;
    this.#log = deps.log;
  }

  availability(): VisionAvailability {
    if (!this.#config.audit.vision) return { status: 'off', paths: [], reason: 'the design review is switched off (audit.vision in config.json)' };
    const paths = this.#claude.paths();
    if (paths.length === 0) return { status: 'unavailable', paths, reason: 'no model to ask: there is no Anthropic API key in the vault and the Claude Code CLI is not available' };
    return { status: 'ready', paths, reason: null };
  }

  async review(input: VisionInput): Promise<{ review: ScreenReview; via: LlmPath }> {
    const available = this.availability();
    if (available.status !== 'ready') throw new VisionUnavailableError(available.reason ?? 'the design review is not available', [], true);

    const attempts: VisionAttempt[] = [];
    for (const path of available.paths) {
      try {
        const reply = await this.#claude.structured({
          scope: { ...input.scope, judge: true },
          model: VISION_MODEL,
          effort: 'high',
          system: VISION_SYSTEM_PROMPT,
          schema: VisionReply,
          maxTokens: 16_000,
          signal: input.signal,
          via: path,
          timeoutMs: REVIEW_TIMEOUT_MS,
          content: visionContent(input),
        });
        return { review: toScreenReview(reply, input), via: path };
      } catch (err) {
        if (input.signal?.aborted) throw err;
        attempts.push({ path, error: errorMessage(err) });
        this.#log.warn({ path, viewport: input.viewport, route: input.route, err: errorMessage(err) }, 'design review attempt failed');
        if (err instanceof PolicyDeniedError) throw new VisionUnavailableError(describe(attempts), attempts, true);
      }
    }
    throw new VisionUnavailableError(describe(attempts), attempts, false);
  }
}

const PATH_NAME: Record<LlmPath, string> = { api: 'API key', session: 'Claude subscription (CLI)' };

function describe(attempts: readonly VisionAttempt[]): string {
  return attempts.map((a) => `${PATH_NAME[a.path]}: ${a.error.split('\n')[0]}`).join('; ');
}

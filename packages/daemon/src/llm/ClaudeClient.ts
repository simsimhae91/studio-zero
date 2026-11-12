import type Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { UnavailableError } from '../app/errors.ts';
import type { Effort } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import type { PolicyEngine } from '../policy/PolicyEngine.ts';
import type { Clock, Secret } from '../util/core.ts';
import { CredentialIds, type KeychainVault } from '../vault/KeychainVault.ts';

/** Fixed in code: the verification side of the loop must not be re-routable by configuration drift. */
export const JUDGE_MODEL = 'claude-opus-5-5';

/** The only place the daemon sends the owner's key. Pinned in code so an ANTHROPIC_BASE_URL in the environment cannot move it. */
const ANTHROPIC_API = 'https://api.anthropic.com';

/** Asks the provider whether it accepts a key, without spending tokens. `unknown` when the question could not be asked. */
export type KeyCheck = (key: Secret) => Promise<'accepted' | 'rejected' | 'unknown'>;

const askProvider: KeyCheck = async (key) => {
  try {
    const { default: Sdk } = await import('@anthropic-ai/sdk');
    await new Sdk({ apiKey: key.expose(), authToken: null, baseURL: ANTHROPIC_API, maxRetries: 0, timeout: 15_000 }).models.list({ limit: 1 });
    return 'accepted';
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    return status === 401 || status === 403 ? 'rejected' : 'unknown';
  }
};

/** USD per million tokens (input, output, cache read). Source: Anthropic price list cached 2026-11-03. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** Models that accept the server-side refusal fallback chain. */
const FALLBACK_CAPABLE = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class ModelRefusedError extends Error {
  constructor(category: string | null) {
    super(`the model declined this request${category ? ` (${category})` : ''}`);
    this.name = 'ModelRefusedError';
  }
}

export interface LlmScope {
  projectId: string;
  taskId: string | null;
  /** Called with each metered response, for callers that keep their own running total (knowledge jobs). */
  onUsage?: (usage: TokenUsage) => void;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  usdMicros: number;
}

/** Converts SDK usage into billable totals. Cache reads and writes count as input tokens toward budgets. */
export function meterUsage(model: string, usage: Anthropic.Beta.BetaUsage): TokenUsage {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const price = PRICES[model];
  const usd = price ? usage.input_tokens * price.input + cacheWrite * price.input * 1.25 + cacheRead * price.cacheRead + usage.output_tokens * price.output : 0;
  return { inputTokens: usage.input_tokens + cacheRead + cacheWrite, outputTokens: usage.output_tokens, usdMicros: Math.round(usd) };
}

/** Request fields that opt a model into the refusal fallback chain. Empty for models that do not support it. */
export function fallbackParams(model: string): { betas?: string[]; fallbacks?: 'default' } {
  return FALLBACK_CAPABLE.has(model) ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {};
}

/**
 * The daemon's own access to Claude (planning, vision audit, reflection, Kirby synthesis, the native coding loop).
 * Every request passes the `llm.request` budget rule first and is metered into the usage ledger afterwards.
 * The API key is read from the Keychain on the host and handed to the SDK in-process; it is not written to
 * disk, not put in an environment variable, and has no path into a sandbox.
 */
export class ClaudeClient {
  readonly #vault: KeychainVault;
  readonly #policy: PolicyEngine;
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #clock: Clock;
  /** A client supplied by the caller (tests). Never replaced by one built from the vault. */
  readonly #injected: Anthropic | null;
  readonly #checkKey: KeyCheck;
  #sdk: Anthropic | null = null;

  constructor(deps: { vault: KeychainVault; policy: PolicyEngine; store: Store; events: EventLog; clock: Clock; sdk?: Anthropic; checkKey?: KeyCheck }) {
    this.#checkKey = deps.checkKey ?? askProvider;
    this.#vault = deps.vault;
    this.#policy = deps.policy;
    this.#store = deps.store;
    this.#events = deps.events;
    this.#clock = deps.clock;
    this.#injected = deps.sdk ?? null;
  }

  isConfigured(): boolean {
    return this.#injected !== null || this.#store.hasCredential(CredentialIds.anthropicApiKey);
  }

  /** Whether the provider accepts this key. Asked before a key is stored, so a mistyped one fails here and not in the middle of a task. */
  checkKey(key: Secret): ReturnType<KeyCheck> {
    return this.#checkKey(key);
  }

  /** Drop the cached SDK client after the key is rotated. */
  invalidate(): void {
    this.#sdk = null;
  }

  async sdk(): Promise<Anthropic> {
    if (this.#injected) return this.#injected;
    if (this.#sdk) return this.#sdk;
    const key = await this.#vault.get(CredentialIds.anthropicApiKey);
    if (!key) throw new UnavailableError(`no Anthropic API key in the vault (set ${CredentialIds.anthropicApiKey})`);
    const { default: Sdk } = await import('@anthropic-ai/sdk'); // loaded on first model call, not at boot
    // Only the vault's key, only to the provider: nothing ambient (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL) is picked up.
    this.#sdk = new Sdk({ apiKey: key.expose(), authToken: null, baseURL: ANTHROPIC_API });
    return this.#sdk;
  }

  /** Budget gate. Throws `PolicyDeniedError` when the task or project budget is spent. */
  async gate(scope: LlmScope, model: string): Promise<void> {
    await this.#policy.authorize(scope.taskId ? { type: 'agent', taskId: scope.taskId } : { type: 'system' }, { kind: 'llm.request', projectId: scope.projectId, taskId: scope.taskId, model }, { taskId: scope.taskId });
  }

  record(scope: LlmScope, model: string, usage: Anthropic.Beta.BetaUsage): TokenUsage {
    const metered = meterUsage(model, usage);
    this.#store.addUsage({ projectId: scope.projectId, taskId: scope.taskId, source: 'native', model, ...metered }, this.#clock());
    this.#events.emit({ projectId: scope.projectId, taskId: scope.taskId }, { type: 'usage', source: 'native', model, ...metered });
    scope.onUsage?.(metered);
    return metered;
  }

  /**
   * One request, one schema-validated answer. Uses structured outputs, so the reply either parses into `schema`
   * or this throws; callers never scrape JSON out of prose.
   */
  async structured<Schema extends z.ZodType>(req: {
    scope: LlmScope;
    model: string;
    effort: Effort;
    system: string;
    content: Anthropic.Beta.BetaContentBlockParam[];
    schema: Schema;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<z.infer<Schema>> {
    await this.gate(req.scope, req.model);
    const sdk = await this.sdk();
    const { betaZodOutputFormat } = await import('@anthropic-ai/sdk/helpers/beta/zod');
    const message = await sdk.beta.messages.parse(
      {
        model: req.model,
        max_tokens: req.maxTokens ?? 16_000,
        system: req.system,
        messages: [{ role: 'user', content: req.content }],
        output_config: { effort: req.effort, format: betaZodOutputFormat(req.schema) },
        ...fallbackParams(req.model),
      },
      { signal: req.signal },
    );
    this.record(req.scope, message.model, message.usage);
    if (message.stop_reason === 'refusal') throw new ModelRefusedError(message.stop_details?.category ?? null);
    if (message.stop_reason === 'max_tokens') throw new Error('structured response was cut off at max_tokens');
    if (message.parsed_output === null || message.parsed_output === undefined) throw new Error('model returned no parseable structured output');
    return message.parsed_output as z.infer<Schema>;
  }
}

/** One assistant turn of plain writing in an ongoing conversation. Returns the text and the turn to append to the history. */
export async function writeTurn(
  claude: ClaudeClient,
  req: { scope: LlmScope; model: string; effort: Effort; system: string; messages: Anthropic.Beta.BetaMessageParam[]; maxTokens?: number; signal?: AbortSignal },
): Promise<{ text: string; turn: Anthropic.Beta.BetaMessageParam }> {
  await claude.gate(req.scope, req.model);
  const sdk = await claude.sdk();
  const message = await sdk.beta.messages
    .stream({ model: req.model, max_tokens: req.maxTokens ?? 32_000, system: req.system, messages: req.messages, output_config: { effort: req.effort }, ...fallbackParams(req.model) }, { signal: req.signal })
    .finalMessage();
  claude.record(req.scope, message.model, message.usage);
  if (message.stop_reason === 'refusal') throw new ModelRefusedError(message.stop_details?.category ?? null);
  if (message.stop_reason === 'max_tokens') throw new Error('the draft was cut off at max_tokens');
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
  // The whole content goes back into the history unchanged, thinking blocks included.
  return { text, turn: { role: 'assistant', content: message.content as Anthropic.Beta.BetaContentBlockParam[] } };
}

export function textBlock(text: string): Anthropic.Beta.BetaTextBlockParam {
  return { type: 'text', text };
}

export function pngBlock(png: Uint8Array): Anthropic.Beta.BetaImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(png).toString('base64') } };
}

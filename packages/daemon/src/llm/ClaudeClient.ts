import type Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { UnavailableError } from '../app/errors.ts';
import type { Effort } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import type { PolicyEngine } from '../policy/PolicyEngine.ts';
import type { Clock, Secret } from '../util/core.ts';
import { CredentialIds, type KeychainVault } from '../vault/KeychainVault.ts';
import type { BrainPart, SessionBrain } from './SessionBrain.ts';

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
 * The daemon's own access to Claude (planning, vision audit, reflection, Kirby synthesis, scratchpad turns,
 * research, writing, and the native coding loop). There are two ways in, and one is chosen by what the owner
 * has set up, never by a model:
 *
 * - `api`: an API key in the Keychain, handed to the SDK in-process. It is not written to disk, not put in an
 *   environment variable, and has no path into a sandbox.
 * - `session`: no key; the owner's Claude subscription through the Claude Code CLI run as a tool-less brain
 *   (see `SessionBrain`). The native coding loop is not available this way; coding goes to a bridged CLI engine.
 *
 * Either way every request passes the `llm.request` budget rule first and is metered into the usage ledger.
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
  readonly #session: SessionBrain | null;
  #sdk: Anthropic | null = null;

  constructor(deps: { vault: KeychainVault; policy: PolicyEngine; store: Store; events: EventLog; clock: Clock; sdk?: Anthropic; checkKey?: KeyCheck; session?: SessionBrain }) {
    this.#checkKey = deps.checkKey ?? askProvider;
    this.#session = deps.session ?? null;
    this.#vault = deps.vault;
    this.#policy = deps.policy;
    this.#store = deps.store;
    this.#events = deps.events;
    this.#clock = deps.clock;
    this.#injected = deps.sdk ?? null;
  }

  hasApiKey(): boolean {
    return this.#injected !== null || this.#store.hasCredential(CredentialIds.anthropicApiKey);
  }

  /** How the daemon's own model calls travel right now. A stored key wins: it is the more exact path. */
  mode(): 'api' | 'session' | 'none' {
    return this.hasApiKey() ? 'api' : this.#session?.ready() ? 'session' : 'none';
  }

  isConfigured(): boolean {
    return this.mode() !== 'none';
  }

  /** Looks for the subscription CLI now, so the first `mode()` after boot is right. */
  async refresh(): Promise<void> {
    await this.#session?.availability();
  }

  session(): SessionBrain {
    if (!this.#session) throw new UnavailableError('no Claude Code session is configured');
    return this.#session;
  }

  /** Meters a subscription-billed response: tokens count against budgets, dollars do not. */
  recordSession(scope: LlmScope, model: string, usage: { inputTokens: number; outputTokens: number }): TokenUsage {
    const metered = { ...usage, usdMicros: 0 };
    const label = `claude-code:${model}`;
    this.#store.addUsage({ projectId: scope.projectId, taskId: scope.taskId, source: 'bridge', model: label, ...metered }, this.#clock());
    this.#events.emit({ projectId: scope.projectId, taskId: scope.taskId }, { type: 'usage', source: 'bridge', model: label, ...metered });
    scope.onUsage?.(metered);
    return metered;
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
    if (!key) throw new UnavailableError(`no Anthropic API key in the vault (set ${CredentialIds.anthropicApiKey}); this call needs the API and cannot go through a subscription`);
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
    if (this.mode() === 'session') {
      const { z: zod } = await import('zod');
      const answer = await this.session().ask({ system: req.system, content: brainParts(req.content), model: req.model, effort: req.effort, jsonSchema: zod.toJSONSchema(req.schema) as Record<string, unknown>, signal: req.signal });
      this.recordSession(req.scope, req.model, answer.usage);
      // The CLI enforces the schema; it is checked again here because nothing a model returns is taken on trust.
      return req.schema.parse(answer.structured ?? JSON.parse(answer.text)) as z.infer<Schema>;
    }
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
  if (claude.mode() === 'session') {
    const answer = await claude.session().ask({ system: req.system, content: [{ type: 'text', text: transcript(req.messages) }], model: req.model, effort: req.effort, signal: req.signal });
    claude.recordSession(req.scope, req.model, answer.usage);
    return { text: answer.text.trim(), turn: { role: 'assistant', content: answer.text } };
  }
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

/** Request content as the subscription CLI takes it: text and base64 images. Other block kinds have no equivalent there. */
export function brainParts(content: unknown): BrainPart[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return (content as Anthropic.Beta.BetaContentBlockParam[]).flatMap((block): BrainPart[] => {
    if (block.type === 'text') return [{ type: 'text', text: block.text }];
    if (block.type === 'image' && block.source.type === 'base64') return [{ type: 'image', mediaType: block.source.media_type, base64: block.source.data }];
    if (block.type === 'tool_result') return brainParts(block.content).filter((part) => part.type === 'text');
    return [];
  });
}

/**
 * A message history as one prompt. A CLI run is a single request, so earlier turns are restated in order and
 * the model continues from the last one.
 */
export function transcript(messages: readonly Anthropic.Beta.BetaMessageParam[]): string {
  const text = (m: Anthropic.Beta.BetaMessageParam): string => brainParts(m.content).flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
  if (messages.length === 1) return text(messages[0]!);
  const earlier = messages.slice(0, -1).map((m) => `${m.role === 'user' ? '[to you]' : '[from you]'}\n${text(m)}`).join('\n\n');
  return `What has been said so far, in order:\n\n${earlier}\n\nThe latest message, which you are answering now:\n\n${text(messages.at(-1)!)}`;
}

export function textBlock(text: string): Anthropic.Beta.BetaTextBlockParam {
  return { type: 'text', text };
}

export function pngBlock(png: Uint8Array): Anthropic.Beta.BetaImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(png).toString('base64') } };
}

import { Readable, Transform } from 'node:stream';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { PolicyDeniedError, type PolicyEngine } from '../policy/PolicyEngine.ts';
import { errorMessage, sha256Hex, type Clock, type Logger } from '../util/core.ts';
import { trackSockets } from '../util/sockets.ts';
import { CredentialIds, type KeychainVault } from '../vault/KeychainVault.ts';

interface Provider {
  origin: string;
  credentialId: string;
  /** Exact method + path pairs that may be forwarded. Anything else is a 404 at the gateway. */
  routes: ReadonlySet<string>;
  authHeaders: (key: string) => Record<string, string>;
}

const FORWARDED_REQUEST_HEADERS = ['content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'openai-beta', 'openai-organization', 'openai-project'];
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'retry-after', 'request-id', 'x-request-id'];

export interface GatewayUpstreams {
  anthropic: string;
  openai: string;
}

/**
 * "Keys stay out of the sandbox", as a network component.
 *
 * Sandboxes are created with `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` pointing here and a sandbox-scoped token
 * where SDKs expect an API key. For each request the gateway:
 *   1. maps the token (by hash) to its project — a token is worthless outside its own sandbox's budget,
 *   2. checks the method and path against a fixed allow-list (upstream hosts are constants, so no SSRF),
 *   3. asks the PolicyEngine for an `llm.request` decision (task and daily project budgets),
 *   4. drops the caller's credential headers and attaches the real key, read from the Keychain on the host,
 *   5. streams the response through unchanged while metering token usage into the ledger.
 *
 * The real key exists only in this process and on the TLS connection to the provider.
 * This is a byte-level reverse proxy for code running in sandboxes; the daemon's own Claude calls use the SDK.
 */
export class LlmGateway {
  readonly app: FastifyInstance;
  readonly #config: Config;
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #policy: PolicyEngine;
  readonly #vault: KeychainVault;
  readonly #clock: Clock;
  readonly #log: Logger;
  readonly #providers: Record<string, Provider>;
  readonly #destroySockets: () => void;

  constructor(deps: { config: Config; store: Store; events: EventLog; policy: PolicyEngine; vault: KeychainVault; clock: Clock; log: Logger; upstreams?: GatewayUpstreams }) {
    this.#config = deps.config;
    this.#store = deps.store;
    this.#events = deps.events;
    this.#policy = deps.policy;
    this.#vault = deps.vault;
    this.#clock = deps.clock;
    this.#log = deps.log;
    const upstreams = deps.upstreams ?? { anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com' };
    this.#providers = {
      anthropic: {
        origin: upstreams.anthropic,
        credentialId: CredentialIds.anthropicApiKey,
        routes: new Set(['POST /v1/messages', 'POST /v1/messages/count_tokens', 'GET /v1/models']),
        authHeaders: (key) => ({ 'x-api-key': key }),
      },
      openai: {
        origin: upstreams.openai,
        credentialId: CredentialIds.openaiApiKey,
        routes: new Set(['POST /v1/chat/completions', 'POST /v1/responses', 'POST /v1/embeddings', 'GET /v1/models']),
        authHeaders: (key) => ({ authorization: `Bearer ${key}` }),
      },
    };

    this.app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
    this.#destroySockets = trackSockets(this.app.server);
    // Bodies are forwarded byte-for-byte, so nothing is parsed on the way in.
    this.app.removeAllContentTypeParsers();
    this.app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    this.app.all('/:provider/*', (req, reply) => this.#handle(req, reply));
  }

  async listen(): Promise<void> {
    await this.app.listen({ host: this.#config.gateway.host, port: this.#config.gateway.port });
  }

  /** In-flight proxied streams get a short grace period, then their sockets are destroyed. */
  async close(graceMs = 2000): Promise<void> {
    const timer = setTimeout(this.#destroySockets, graceMs);
    try {
      await this.app.close();
    } finally {
      clearTimeout(timer);
    }
  }

  async #handle(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const params = req.params as { provider: string; '*': string };
    const provider = Object.hasOwn(this.#providers, params.provider) ? this.#providers[params.provider] : undefined;
    const path = `/${params['*']}`;
    if (!provider || !provider.routes.has(`${req.method} ${path}`)) return reply.code(404).send(gatewayError('not_found', 'this endpoint is not available through the Studio Zero gateway'));

    const token = presentedToken(req);
    const sandbox = token ? this.#store.getSandboxByTokenHash(sha256Hex(token)) : null;
    if (!sandbox) return reply.code(401).send(gatewayError('authentication_error', 'unknown sandbox token'));

    const body = Buffer.isBuffer(req.body) ? req.body : undefined;
    const model = requestModel(body);
    const task = this.#store.listTasks(sandbox.projectId, 5).find((t) => t.state === 'running') ?? null;
    const scope = { projectId: sandbox.projectId, taskId: task?.id ?? null };
    try {
      await this.#policy.authorize(task ? { type: 'agent', taskId: task.id } : { type: 'system' }, { kind: 'llm.request', projectId: sandbox.projectId, taskId: scope.taskId, model }, { taskId: scope.taskId });
    } catch (err) {
      if (err instanceof PolicyDeniedError) return reply.code(429).send(gatewayError('budget_exceeded', err.message));
      throw err;
    }

    const key = await this.#vault.get(provider.credentialId);
    if (!key) return reply.code(503).send(gatewayError('unavailable', `no credential stored for ${params.provider}`));

    const headers: Record<string, string> = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = req.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    Object.assign(headers, provider.authHeaders(key.expose()));

    let upstream: Response;
    try {
      upstream = await fetch(`${provider.origin}${path}`, { method: req.method, headers, body: req.method === 'GET' ? undefined : (body as BodyInit | undefined), signal: AbortSignal.timeout(15 * 60 * 1000) });
    } catch (err) {
      this.#log.warn({ provider: params.provider, err: errorMessage(err) }, 'gateway upstream request failed');
      return reply.code(502).send(gatewayError('upstream_error', 'the provider could not be reached'));
    }

    reply.code(upstream.status);
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) reply.header(name, value);
    }
    if (!upstream.body) return reply.send();

    const meter = new UsageMeter((upstream.headers.get('content-type') ?? '').includes('text/event-stream'));
    const tap = new Transform({
      transform: (chunk: Buffer, _enc, done) => {
        meter.feed(chunk);
        done(null, chunk);
      },
      flush: (done) => {
        const usage = meter.finish();
        if (usage.inputTokens + usage.outputTokens > 0) {
          // Provider billing is the owner's own; the ledger tracks tokens for budgets, cost is not estimated here.
          this.#store.addUsage({ ...scope, source: 'gateway', model, ...usage, usdMicros: 0 }, this.#clock());
          this.#events.emit(scope, { type: 'usage', source: 'gateway', model, ...usage, usdMicros: 0 });
        }
        done();
      },
    });
    return reply.send(Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream<Uint8Array>).pipe(tap));
  }
}

function presentedToken(req: FastifyRequest): string | null {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey !== '') return apiKey;
  const auth = req.headers.authorization;
  return typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function requestModel(body: Buffer | undefined): string {
  if (!body || body.length > 16 * 1024 * 1024) return 'unknown';
  try {
    const model = (JSON.parse(body.toString('utf8')) as { model?: unknown }).model;
    return typeof model === 'string' ? model.slice(0, 100) : 'unknown';
  } catch {
    return 'unknown';
  }
}

function gatewayError(type: string, message: string): { type: 'error'; error: { type: string; message: string } } {
  return { type: 'error', error: { type, message } };
}

/**
 * Reads token usage out of a provider response as it streams past, without altering it.
 * Understands Anthropic Messages (JSON and SSE), OpenAI Responses and Chat Completions.
 */
export class UsageMeter {
  readonly #sse: boolean;
  #buffer = '';
  #json: Buffer[] = [];
  #jsonBytes = 0;
  #input = 0;
  #output = 0;

  constructor(sse: boolean) {
    this.#sse = sse;
  }

  feed(chunk: Buffer): void {
    if (!this.#sse) {
      if (this.#jsonBytes <= 8 * 1024 * 1024) {
        this.#json.push(chunk);
        this.#jsonBytes += chunk.length;
      }
      return;
    }
    this.#buffer += chunk.toString('utf8');
    let newline: number;
    while ((newline = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, newline).trimEnd();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.startsWith('data:')) this.#observe(line.slice(5).trim());
    }
    if (this.#buffer.length > 1024 * 1024) this.#buffer = ''; // a single line this long is not a usage event
  }

  finish(): { inputTokens: number; outputTokens: number } {
    if (!this.#sse && this.#jsonBytes <= 8 * 1024 * 1024) this.#observe(Buffer.concat(this.#json).toString('utf8'));
    return { inputTokens: this.#input, outputTokens: this.#output };
  }

  #observe(payload: string): void {
    if (payload === '' || payload === '[DONE]') return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    const usage = (data.usage ?? (data.message as Record<string, unknown> | undefined)?.usage ?? (data.response as Record<string, unknown> | undefined)?.usage) as Record<string, unknown> | undefined;
    if (!usage || typeof usage !== 'object') return;
    const n = (key: string): number => (typeof usage[key] === 'number' ? (usage[key] as number) : 0);
    const input = n('input_tokens') + n('cache_read_input_tokens') + n('cache_creation_input_tokens') + n('prompt_tokens');
    const output = n('output_tokens') + n('completion_tokens');
    // Streams report cumulative counts across several events, so keep the largest value seen.
    this.#input = Math.max(this.#input, input);
    this.#output = Math.max(this.#output, output);
  }
}

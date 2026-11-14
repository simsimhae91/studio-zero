import { createReadStream } from 'node:fs';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Logger as PinoLogger } from 'pino';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { ClientFrame, CloseCode, PROTOCOL_VERSION, isMethodName, matchesFilter, methods, type EventEnvelope, type EventFilter, type RpcErrorCode, type ServerFrame } from '@studio-zero/protocol';
import { ConflictError, LocalOnlyError, NotFoundError, UnavailableError } from '../app/errors.ts';
import type { BridgeSessions } from '../bridge/BridgeSessions.ts';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import type { Toolbox } from '../harness/Toolbox.ts';
import { ModelRefusedError } from '../llm/ClaudeClient.ts';
import { ApprovalDeniedError, PolicyDeniedError } from '../policy/PolicyEngine.ts';
import { SandboxError } from '../sandbox/OrbStackManager.ts';
import type { PtyManager } from '../sandbox/PtyManager.ts';
import { errorMessage, newId, safeEqual, type Secret } from '../util/core.ts';
import { trackSockets } from '../util/sockets.ts';
import { VaultError } from '../vault/KeychainVault.ts';
import { OAUTH_CALLBACK_PATH } from '../arms/logins.ts';
import type { ClientConnection, Handlers } from './handlers.ts';

const HELLO_TIMEOUT_MS = 5_000;
const MAX_SUBSCRIPTIONS = 32;
const REPLAY_PAGE = 500;
const REPLAY_LIMIT = 10_000;
/** A subscriber this far behind is dropped and told to resubscribe, so one slow client cannot grow the heap. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
/** A terminal stops reading from its shell while this much of its output is still waiting to leave the socket. */
const TERMINAL_HIGH_WATER_BYTES = 1024 * 1024;
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export interface DaemonServerDeps {
  config: Config;
  handlers: Handlers;
  events: EventLog;
  store: Store;
  toolbox: Toolbox;
  bridgeSessions: BridgeSessions;
  /** Keystrokes go straight to the terminal that the connection owns; everything else about terminals is an RPC. */
  terminals: PtyManager;
  clientToken: Secret;
  version: string;
  log: PinoLogger;
  /** Where a person coming back from a login provider is passed on to (see `arms/logins.ts`), or null when no project sent them. */
  oauthRelay?: (query: string, state: string) => Promise<string | null>;
}

/**
 * The control plane: one Fastify instance on loopback (default 127.0.0.1:49200).
 *
 *   GET  /healthz             liveness, unauthenticated, reveals nothing
 *   GET  /v1/ws               WebSocket RPC, event streaming and interactive terminals for owner clients
 *   GET  /v1/artifacts/:id    screenshots, bearer-authenticated
 *   *    /v1/bridge/*         tool endpoint for the MCP shim of bridged CLIs, task-scoped bearer token
 *
 * Loopback is not treated as a trust boundary. Sandboxes can reach the host's loopback through
 * host.docker.internal and any local web page can attempt a WebSocket to localhost, so:
 *   - every route except /healthz requires a token, compared in constant time;
 *   - the Host header must be a loopback name or an explicitly configured one (stops DNS rebinding);
 *   - a browser Origin must be on the allow-list (stops drive-by pages; native clients send no Origin).
 * Remote access is the same listener behind Tailscale Serve or Cloudflare Tunnel; the daemon never binds a
 * public interface itself.
 */
export class DaemonServer {
  readonly app: FastifyInstance;
  readonly #d: DaemonServerDeps;
  readonly #allowedHosts: Set<string>;
  readonly #destroySockets: () => void;

  constructor(deps: DaemonServerDeps) {
    this.#d = deps;
    this.#allowedHosts = new Set([...LOOPBACK_HOSTS, ...deps.config.listen.allowedHosts.map((h) => h.toLowerCase())]);
    // Fastify logs each request at info; the HTTP layer gets a child logger that only speaks from warn up.
    this.app = Fastify({ loggerInstance: deps.log.child({ mod: 'http' }, { level: 'warn' }), bodyLimit: 4 * 1024 * 1024 }) as unknown as FastifyInstance;
    this.#destroySockets = trackSockets(this.app.server);

    this.app.addHook('onRequest', async (req, reply) => {
      const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
      if (this.#allowedHosts.has(host)) return;
      if (req.raw.headers.upgrade !== undefined) {
        // An upgrade request has already left the HTTP server's connection handling, so nothing else would
        // close this socket: answer on it directly and end it.
        reply.hijack();
        req.raw.socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      return reply.code(403).send({ error: 'host not allowed' });
    });

    // The desktop and mobile clients are web views: fetching a screenshot with a bearer token is a cross-origin
    // request with a preflight. Only origins on the allow-list get CORS headers; everyone else is refused by the browser.
    this.app.addHook('onRequest', async (req, reply) => {
      const origin = req.headers.origin;
      if (origin === undefined || !this.#d.config.listen.allowedOrigins.includes(origin)) return;
      reply.header('access-control-allow-origin', origin).header('vary', 'origin');
      if (req.method === 'OPTIONS') return reply.header('access-control-allow-headers', 'authorization').header('access-control-allow-methods', 'GET').header('access-control-max-age', '600').code(204).send();
    });

    this.app.get('/healthz', async () => ({ ok: true }));

    // A person coming back from a login provider, on the one address registered with it. No token is asked
    // for: the browser arriving here is that person's own, sent by the provider, and all that happens is that
    // it is sent on, with what it carried, to the backend on this machine that started the sign-in.
    this.app.get(OAUTH_CALLBACK_PATH, async (req, reply) => {
      const raw = req.raw.url ?? '';
      const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
      const state = new URLSearchParams(query).get('state') ?? '';
      const target = state === '' || !this.#d.oauthRelay ? null : await this.#d.oauthRelay(query, state).catch(() => null);
      if (target === null) return reply.code(404).type('text/plain; charset=utf-8').send('This sign-in was not started by a project on this machine, or it has run out. Go back to the product and sign in again.\n');
      return reply.code(302).header('location', target).header('cache-control', 'no-store').send();
    });

    void this.app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
    void this.app.register(async (scoped) => {
      scoped.get(
        '/v1/ws',
        {
          websocket: true,
          preValidation: async (req, reply) => {
            const origin = req.headers.origin;
            if (origin !== undefined && !this.#d.config.listen.allowedOrigins.includes(origin)) return reply.code(403).send({ error: 'origin not allowed' });
          },
        },
        (socket, req) => this.#connection(socket, openedHere(req)),
      );
    });

    this.app.get('/v1/artifacts/:id', async (req, reply) => {
      if (!this.#bearerMatches(req, this.#d.clientToken.expose())) return reply.code(401).send({ error: 'unauthorized' });
      const artifact = this.#d.store.getArtifact((req.params as { id: string }).id);
      if (!artifact) return reply.code(404).send({ error: 'not found' });
      return reply.header('content-type', artifact.mime).header('cache-control', 'private, max-age=31536000, immutable').send(createReadStream(artifact.file));
    });

    this.app.get('/v1/bridge/tools', async (req, reply) => {
      const tools = this.#bridgeTools(req);
      if (!tools) return reply.code(401).send({ error: 'unauthorized' });
      return { tools: tools.definitions() };
    });
    this.app.post('/v1/bridge/call', async (req, reply) => {
      const tools = this.#bridgeTools(req);
      if (!tools) return reply.code(401).send({ error: 'unauthorized' });
      const body = z.object({ name: z.string(), arguments: z.unknown() }).safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid request' });
      const outcome = await tools.call(body.data.name, body.data.arguments ?? {});
      return { content: [{ type: 'text', text: outcome.content }], isError: outcome.isError };
    });
  }

  async listen(): Promise<void> {
    await this.app.listen({ host: this.#d.config.listen.host, port: this.#d.config.listen.port });
  }

  /** Graceful first; any connection still open after the grace period is destroyed, so shutdown always completes. */
  async close(graceMs = 2000): Promise<void> {
    const timer = setTimeout(this.#destroySockets, graceMs);
    try {
      await this.app.close();
    } finally {
      clearTimeout(timer);
    }
  }

  #bearerMatches(req: FastifyRequest, expected: string): boolean {
    const auth = req.headers.authorization;
    return typeof auth === 'string' && auth.startsWith('Bearer ') && safeEqual(auth.slice(7), expected);
  }

  /** The MCP shim runs on this host, so bridge calls must come over loopback and carry a live session token. */
  #bridgeTools(req: FastifyRequest): ReturnType<BridgeSessions['resolve']> {
    const auth = req.headers.authorization;
    const loopback = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
    return loopback && typeof auth === 'string' && auth.startsWith('Bearer ') ? this.#d.bridgeSessions.resolve(auth.slice(7)) : null;
  }

  #connection(socket: WebSocket, local: boolean): void {
    let authed = false;
    const subs = new Map<string, EventFilter>();
    let unsubscribeLive: (() => void) | null = null;
    const send = (frame: ServerFrame): void => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
    };
    const helloTimer = setTimeout(() => socket.close(CloseCode.helloTimeout, 'hello timeout'), HELLO_TIMEOUT_MS);
    const conn: ClientConnection = {
      id: newId('con'),
      local,
      terminals: {
        output: (terminalId, data) => send({ t: 'terminal.output', terminalId, data }),
        exit: (terminalId, exitCode, reason) => send({ t: 'terminal.exit', terminalId, exitCode, reason }),
        congested: () => socket.readyState === socket.OPEN && socket.bufferedAmount > TERMINAL_HIGH_WATER_BYTES,
      },
    };

    const deliver = (subId: string, event: EventEnvelope): void => {
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        subs.delete(subId);
        send({ t: 'sub_closed', sub: subId, reason: 'slow consumer' });
        return;
      }
      send({ t: 'evt', sub: subId, event });
    };
    const onLive = (event: EventEnvelope): void => {
      for (const [subId, filter] of subs) if (matchesFilter(event, filter)) deliver(subId, event);
    };

    socket.on('message', (raw, isBinary) => {
      if (isBinary) return socket.close(CloseCode.badFrame, 'binary frames are not supported');
      let frame: ClientFrame;
      try {
        frame = ClientFrame.parse(JSON.parse(raw.toString()));
      } catch {
        return socket.close(CloseCode.badFrame, 'malformed frame');
      }

      if (!authed) {
        if (frame.t !== 'hello' || !safeEqual(frame.token, this.#d.clientToken.expose())) return socket.close(CloseCode.unauthorized, 'unauthorized');
        if (frame.protocol !== PROTOCOL_VERSION) return socket.close(CloseCode.protocolMismatch, `daemon speaks protocol ${PROTOCOL_VERSION}`);
        authed = true;
        clearTimeout(helloTimer);
        this.#d.log.info({ client: frame.client }, 'client connected');
        return send({ t: 'ready', protocol: PROTOCOL_VERSION, version: this.#d.version, headSeq: this.#d.events.headSeq() });
      }

      switch (frame.t) {
        case 'hello':
          return;
        case 'terminal.data':
          return this.#d.terminals.write(conn.id, frame.terminalId, frame.data);
        case 'req':
          void this.#dispatch(frame.method, frame.params, conn).then(
            (result) => send({ t: 'res', id: frame.id, result }),
            (err: unknown) => send({ t: 'err', id: frame.id, error: this.#toRpcError(frame.method, err) }),
          );
          return;
        case 'sub': {
          if (subs.size >= MAX_SUBSCRIPTIONS && !subs.has(frame.id)) return send({ t: 'sub_closed', sub: frame.id, reason: 'too many subscriptions' });
          // Replay and live hand-off happen in one synchronous turn: SQLite reads and EventLog.emit are both
          // synchronous, so no event can fall between the last replayed row and the first live one.
          let cursor = frame.sinceSeq ?? this.#d.events.headSeq();
          for (let sent = 0; sent < REPLAY_LIMIT; ) {
            const page = this.#d.events.history(frame.filter, cursor, REPLAY_PAGE);
            for (const event of page) send({ t: 'evt', sub: frame.id, event });
            sent += page.length;
            if (page.length < REPLAY_PAGE) break;
            cursor = page[page.length - 1]!.seq;
          }
          subs.set(frame.id, frame.filter);
          unsubscribeLive ??= this.#d.events.subscribe(onLive);
          return;
        }
        case 'unsub':
          subs.delete(frame.id);
          return;
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      unsubscribeLive?.();
      subs.clear();
      void this.#d.terminals.closeOwner(conn.id);
    });
    socket.on('error', () => socket.terminate());
  }

  async #dispatch(method: string, rawParams: unknown, conn: ClientConnection): Promise<unknown> {
    if (!isMethodName(method)) throw new UnknownMethodError(method);
    const contract = methods[method];
    const params = contract.params.safeParse(rawParams ?? {});
    if (!params.success) throw new InvalidParamsError(z.prettifyError(params.error));
    const handler = this.#d.handlers[method] as (p: unknown, conn: ClientConnection) => unknown;
    // Results are validated too: a handler bug surfaces here as `internal`, not as a malformed frame on a client.
    return contract.result.parse(await handler(params.data, conn));
  }

  #toRpcError(method: string, err: unknown): { code: RpcErrorCode; message: string } {
    const as = (code: RpcErrorCode): { code: RpcErrorCode; message: string } => ({ code, message: errorMessage(err) });
    if (err instanceof UnknownMethodError) return as('unknown_method');
    if (err instanceof InvalidParamsError) return as('invalid_params');
    if (err instanceof NotFoundError) return as('not_found');
    if (err instanceof ConflictError) return as('conflict');
    if (err instanceof PolicyDeniedError || err instanceof LocalOnlyError) return as('policy_denied');
    if (err instanceof ApprovalDeniedError) return as('approval_denied');
    if (err instanceof UnavailableError || err instanceof SandboxError || err instanceof VaultError || err instanceof ModelRefusedError) return as('unavailable');
    this.#d.log.error({ method, err: errorMessage(err) }, 'rpc handler failed');
    return { code: 'internal', message: 'internal error; see the daemon log' };
  }
}

/** Headers a forwarder adds on the way in. A connection that carries one did not start on this machine. */
const FORWARDED = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip', 'via', 'cf-connecting-ip', 'cf-ray', 'tailscale-user-login', 'tailscale-user-name'];

/**
 * Whether a control connection was opened on this Mac itself.
 *
 * Remote access is this same listener behind Tailscale Serve or a Cloudflare Tunnel, so every connection
 * arrives from loopback and the address alone says nothing. What tells them apart is what the forwarder leaves
 * on the request: the name it was asked for (the tailnet or tunnel name, which has to be on `allowedHosts`
 * to get in at all) and the forwarding headers it adds. Local means a loopback address, a loopback name, and
 * none of those headers.
 *
 * A forwarder that adds nothing (an SSH port forward, a bare TCP proxy) passes as local. Setting one up takes
 * a shell on this Mac, which is the same access as editing the file.
 */
export function openedHere(req: Pick<FastifyRequest, 'ip' | 'headers'>): boolean {
  const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
  const loopback = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  return loopback && LOOPBACK_HOSTS.includes(host) && FORWARDED.every((name) => req.headers[name] === undefined);
}

class UnknownMethodError extends Error {
  constructor(method: string) {
    super(`unknown method: ${method.slice(0, 64)}`);
    this.name = 'UnknownMethodError';
  }
}

class InvalidParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidParamsError';
  }
}

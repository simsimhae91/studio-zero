import type { EventEnvelope, EventFilter } from './events.ts';
import { PROTOCOL_VERSION } from './domain.ts';
import { ServerFrame, methods, type ClientFrame, type MethodName, type ParamsOf, type ResultOf, type RpcErrorCode } from './rpc.ts';

export class RpcCallError extends Error {
  readonly code: RpcErrorCode | 'disconnected';
  constructor(code: RpcErrorCode | 'disconnected', message: string) {
    super(message);
    this.name = 'RpcCallError';
    this.code = code;
  }
}

export interface RpcClientOptions {
  /** `ws://127.0.0.1:49200/v1/ws` locally, `wss://<machine>.<tailnet>.ts.net/v1/ws` through Tailscale Serve. */
  url: string;
  token: string;
  /** Free-form client label shown in daemon logs, e.g. `desktop/0.1.0`. */
  client: string;
  /** Called on every (re)connect and disconnect so a UI can show link state. */
  onLinkChange?: (state: 'connected' | 'reconnecting' | 'closed') => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

interface Subscription {
  filter: EventFilter;
  /** null until the daemon's head sequence is known: a subscription that starts "from now". */
  lastSeq: number | null;
  onEvent: (e: EventEnvelope) => void;
}

/**
 * Typed client for the daemon's WebSocket RPC. Uses the platform `WebSocket`, so the same class runs in the
 * Electron renderer, a mobile PWA and Node 24.
 *
 * Reconnects with exponential backoff and resumes every subscription from the last sequence number it saw.
 * In-flight calls are rejected with `disconnected` rather than replayed: only the caller knows whether a
 * request is safe to repeat.
 */
export class RpcClient {
  readonly #opts: RpcClientOptions;
  #ws: WebSocket | null = null;
  #ready: Promise<void> | null = null;
  #closed = false;
  #nextId = 1;
  #attempt = 0;
  readonly #pending = new Map<string, Pending>();
  readonly #subs = new Map<string, Subscription>();
  /** Highest sequence number seen from the daemon, from `ready` frames and events. */
  #head: number | null = null;

  constructor(opts: RpcClientOptions) {
    this.#opts = opts;
  }

  connect(): Promise<void> {
    if (this.#closed) return Promise.reject(new RpcCallError('disconnected', 'client is closed'));
    this.#ready ??= this.#open();
    return this.#ready;
  }

  async call<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    await this.connect();
    const id = `r${this.#nextId++}`;
    const raw = await new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#send({ t: 'req', id, method, params });
    });
    return methods[method].result.parse(raw) as ResultOf<M>;
  }

  /**
   * Streams events matching `filter`, starting after `sinceSeq` (0 = full history, `'now'` = only what happens
   * from here on). Returns an unsubscribe function.
   */
  subscribe(filter: EventFilter, onEvent: (e: EventEnvelope) => void, sinceSeq: number | 'now' = 0): () => void {
    const id = `s${this.#nextId++}`;
    this.#subs.set(id, { filter, lastSeq: sinceSeq === 'now' ? this.#head : sinceSeq, onEvent });
    void this.connect().then(
      () => this.#sendSub(id),
      () => undefined,
    );
    return () => {
      if (this.#subs.delete(id) && this.#ws?.readyState === WebSocket.OPEN) this.#send({ t: 'unsub', id });
    };
  }

  close(): void {
    this.#closed = true;
    this.#ws?.close(1000);
    this.#failPending('client closed');
    this.#opts.onLinkChange?.('closed');
  }

  #open(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.#opts.url);
      this.#ws = ws;
      let settled = false;

      ws.addEventListener('open', () => {
        this.#send({ t: 'hello', protocol: PROTOCOL_VERSION, token: this.#opts.token, client: this.#opts.client });
      });

      ws.addEventListener('message', (ev: MessageEvent) => {
        if (typeof ev.data !== 'string') return;
        let frame: ServerFrame;
        try {
          frame = ServerFrame.parse(JSON.parse(ev.data));
        } catch {
          return; // A frame this client version does not understand is skipped, not fatal.
        }
        switch (frame.t) {
          case 'ready':
            this.#attempt = 0;
            settled = true;
            this.#head = Math.max(this.#head ?? 0, frame.headSeq);
            for (const [id, sub] of this.#subs) {
              sub.lastSeq ??= frame.headSeq;
              this.#sendSub(id);
            }
            this.#opts.onLinkChange?.('connected');
            resolve();
            break;
          case 'res':
            this.#pending.get(frame.id)?.resolve(frame.result);
            this.#pending.delete(frame.id);
            break;
          case 'err':
            this.#pending.get(frame.id)?.reject(new RpcCallError(frame.error.code, frame.error.message));
            this.#pending.delete(frame.id);
            break;
          case 'evt': {
            const sub = this.#subs.get(frame.sub);
            this.#head = Math.max(this.#head ?? 0, frame.event.seq);
            if (sub && frame.event.seq > (sub.lastSeq ?? -1)) {
              sub.lastSeq = frame.event.seq;
              sub.onEvent(frame.event);
            }
            break;
          }
          case 'sub_closed':
            if (this.#subs.has(frame.sub)) this.#sendSub(frame.sub);
            break;
        }
      });

      ws.addEventListener('close', (ev: CloseEvent) => {
        this.#ws = null;
        this.#ready = null;
        this.#failPending(`connection closed (${ev.code})`);
        // 44xx codes are the daemon rejecting us (bad token, protocol mismatch): retrying cannot help.
        const fatal = ev.code >= 4400 && ev.code < 4500;
        if (!settled) reject(new RpcCallError(fatal ? 'unauthorized' : 'disconnected', `connection failed (${ev.code}) ${ev.reason}`));
        if (this.#closed || fatal) {
          if (fatal) this.#closed = true;
          this.#opts.onLinkChange?.('closed');
          return;
        }
        this.#opts.onLinkChange?.('reconnecting');
        const delay = Math.min(15_000, 250 * 2 ** this.#attempt++) * (0.5 + Math.random() / 2);
        setTimeout(() => {
          if (!this.#closed) void this.connect().catch(() => undefined);
        }, delay);
      });
    });
  }

  #sendSub(id: string): void {
    const sub = this.#subs.get(id);
    if (sub && this.#ws?.readyState === WebSocket.OPEN) this.#send({ t: 'sub', id, filter: sub.filter, ...(sub.lastSeq === null ? {} : { sinceSeq: sub.lastSeq }) });
  }

  #send(frame: ClientFrame): void {
    this.#ws?.send(JSON.stringify(frame));
  }

  #failPending(reason: string): void {
    for (const p of this.#pending.values()) p.reject(new RpcCallError('disconnected', reason));
    this.#pending.clear();
  }
}

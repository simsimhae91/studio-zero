import { DEFAULT_DAEMON_PORT, RpcClient, type EventEnvelope, type EventFilter, type MethodName, type ParamsOf, type ResultOf } from '@studio-zero/protocol';

export type LinkState = 'connected' | 'reconnecting' | 'closed';

/** Everything the interface needs from a daemon. Implemented by the real connection and by the demo fixtures. */
export interface Backend {
  readonly demo: boolean;
  /** Host shown in the interface, e.g. `localhost` or `macmini.tailnet.ts.net`. */
  readonly host: string;
  call<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>>;
  subscribe(filter: EventFilter, onEvent: (e: EventEnvelope) => void, sinceSeq?: number | 'now'): () => void;
  /** A URL an <img> can load for a stored screenshot. */
  artifactUrl(artifactId: string): Promise<string>;
  close(): void;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Turns what someone types into the address field into socket and HTTP URLs.
 * A loopback host is plain `ws://` on the daemon's port. Anything else is `wss://`: a remote daemon sits behind
 * Tailscale Serve or a tunnel, which terminates TLS.
 */
export function daemonAddress(input: string): { ws: string; http: string; host: string } {
  const raw = input.trim() || 'localhost';
  const explicit = /^(wss?):\/\/([^/]+)/i.exec(raw);
  const authority = explicit ? explicit[2]! : raw.replace(/\/.*$/, '');
  const host = authority.replace(/:\d+$/, '').toLowerCase();
  const hasPort = /:\d+$/.test(authority);
  const secure = explicit ? explicit[1]!.toLowerCase() === 'wss' : !LOOPBACK.has(host);
  const origin = `${authority}${hasPort || secure ? '' : `:${DEFAULT_DAEMON_PORT}`}`;
  return { ws: `${secure ? 'wss' : 'ws'}://${origin}/v1/ws`, http: `${secure ? 'https' : 'http'}://${origin}`, host };
}

export async function connectDaemon(address: string, token: string, onLink: (state: LinkState) => void): Promise<Backend> {
  const { ws, http, host } = daemonAddress(address);
  const client = new RpcClient({ url: ws, token, client: 'desktop/0.1.0', onLinkChange: onLink });
  await client.connect();
  const images = new Map<string, Promise<string>>();
  return {
    demo: false,
    host,
    call: (method, params) => client.call(method, params),
    subscribe: (filter, onEvent, sinceSeq) => client.subscribe(filter, onEvent, sinceSeq),
    artifactUrl: (id) => {
      // The artifact route wants a bearer token, which an <img> cannot send: fetch it and hand back a blob URL.
      let url = images.get(id);
      if (!url) {
        url = fetch(`${http}/v1/artifacts/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` } }).then(async (res) => {
          if (!res.ok) throw new Error(`screenshot ${id} could not be loaded (${res.status})`);
          return URL.createObjectURL(await res.blob());
        });
        images.set(id, url);
        url.catch(() => images.delete(id));
      }
      return url;
    },
    close: () => {
      client.close();
      for (const url of images.values()) void url.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
    },
  };
}

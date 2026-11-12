import type { AxBlock, Confidence } from './blocks.ts';

/**
 * What the kit reports about an AI feature in use. The set is closed and carries no content: timings, counts,
 * block types and whether a recommendation was followed. Nothing a person typed or read is ever in an event.
 */
export type TelemetryEvent =
  | { name: 'stream.started' }
  | { name: 'stream.first_output'; ms: number }
  | { name: 'stream.completed'; ms: number; blocks: number; chars: number; invalid: number }
  | { name: 'stream.failed'; ms: number; code: string }
  | { name: 'stream.stopped'; ms: number }
  | { name: 'block.shown'; block: AxBlock['type']; confidence: Confidence | null }
  | { name: 'block.answered'; block: 'choice' | 'form'; confidence: Confidence | null; followedRecommendation: boolean | null; ms: number }
  | { name: 'steer.sent' };

export interface Telemetry {
  track(event: TelemetryEvent): void;
  /** Sends whatever is queued now. Resolves when the request has finished, successfully or not. */
  flush(): Promise<void>;
}

const MAX_QUEUE = 200;

/**
 * Batches events and posts them to an endpoint the app owns, as `{ app, session, events }`. The session id is
 * random per page load and identifies no one. A failed batch is retried once with the next one, then dropped:
 * telemetry never gets to slow down or break the feature it measures.
 */
export function createTelemetry(opts: { endpoint: string; app: string; flushMs?: number; maxBatch?: number; fetch?: typeof fetch }): Telemetry {
  const session = crypto.randomUUID();
  const send = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let queue: (TelemetryEvent & { at: number })[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retried = false;

  const payload = (events: typeof queue): string => JSON.stringify({ app: opts.app, session, events });
  const flush = async (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    try {
      const res = await send(opts.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload(batch), keepalive: true });
      if (!res.ok) throw new Error(String(res.status));
      retried = false;
    } catch {
      if (!retried) queue = [...batch, ...queue].slice(-MAX_QUEUE);
      retried = !retried;
    }
  };

  // A page being hidden may never run timers again: hand what is left to the browser to deliver.
  if (typeof document !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden' || queue.length === 0) return;
      if (navigator.sendBeacon(opts.endpoint, new Blob([payload(queue)], { type: 'application/json' }))) queue = [];
    });
  }

  return {
    track(event) {
      queue.push({ ...event, at: Date.now() });
      if (queue.length > MAX_QUEUE) queue.shift();
      if (queue.length >= (opts.maxBatch ?? 20)) void flush();
      else timer ??= setTimeout(() => void flush(), opts.flushMs ?? 5000);
    },
    flush,
  };
}

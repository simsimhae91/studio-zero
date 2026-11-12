import { z } from 'zod';
import { AxBlock } from './blocks.ts';

/**
 * What an agent endpoint sends while it works, as server-sent events. Text arrives in deltas, anything richer
 * arrives as a typed block, and `activity` says what the agent is doing so a wait is never a blank screen.
 */
export const AgentEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({ type: z.literal('block'), block: AxBlock }),
  z.object({ type: z.literal('activity'), label: z.string().max(200) }),
  z.object({ type: z.literal('done') }),
  z.object({ type: z.literal('error'), message: z.string().max(2000) }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;

/** An event that did not match the contract. It is reported, never rendered. */
export interface InvalidEvent {
  type: 'invalid';
  reason: string;
}

export const EVENT_STREAM_HEADERS = { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } as const;

/** Server side: one event in the wire format, for a response sent with `EVENT_STREAM_HEADERS`. */
export function encodeEvent(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(AgentEvent.parse(event))}\n\n`;
}

function parseMessage(message: string): AgentEvent | InvalidEvent | null {
  const data: string[] = [];
  for (const line of message.split('\n')) {
    if (line.startsWith('data:')) data.push(line.slice(line.charAt(5) === ' ' ? 6 : 5));
    // `event:`, `id:`, `retry:` and comment lines carry nothing the payload does not.
  }
  if (data.length === 0) return null;
  let json: unknown;
  try {
    json = JSON.parse(data.join('\n'));
  } catch {
    return { type: 'invalid', reason: 'the event data was not JSON' };
  }
  const parsed = AgentEvent.safeParse(json);
  return parsed.success ? parsed.data : { type: 'invalid', reason: parsed.error.issues[0]?.message ?? 'the event did not match the contract' };
}

/**
 * Client side: turns a response body into events. Messages may be split anywhere across network chunks,
 * including inside a multi-byte character or between a CR and its LF. Every block is checked against the
 * schema here, so what reaches a renderer is one of the known block types and nothing else.
 */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent | InvalidEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // A CR at the very end may be the first half of a CRLF whose LF is in the next chunk: leave it for then.
      const held = !done && buffer.endsWith('\r') ? '\r' : '';
      buffer = buffer.slice(0, buffer.length - held.length).replace(/\r\n?/g, '\n') + held;
      for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
        const event = parseMessage(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (event) yield event;
      }
      if (done) {
        const last = parseMessage(buffer);
        if (last) yield last;
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class AgentStreamError extends Error {
  /** A short code safe to report: `http_500`, `not_a_stream`, `network`. */
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentStreamError';
    this.code = code;
  }
}

/** Posts `body` as JSON to an agent endpoint and yields its events. Abort the signal to stop reading. */
export async function* streamAgent(url: string, init: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal; fetch?: typeof fetch } = {}): AsyncGenerator<AgentEvent | InvalidEvent> {
  let res: Response;
  try {
    res = await (init.fetch ?? fetch)(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...init.headers }, body: JSON.stringify(init.body ?? {}), signal: init.signal });
  } catch (err) {
    if (init.signal?.aborted) throw err;
    throw new AgentStreamError('network', 'The agent could not be reached.');
  }
  if (!res.ok) throw new AgentStreamError(`http_${res.status}`, `The agent endpoint answered ${res.status}.`);
  if (!res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) throw new AgentStreamError('not_a_stream', 'The agent endpoint did not answer with an event stream.');
  yield* readEvents(res.body);
}

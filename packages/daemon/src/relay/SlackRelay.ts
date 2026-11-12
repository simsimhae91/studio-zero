import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Studio } from '../app/Studio.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { errorMessage, sleep, type Logger, type Secret } from '../util/core.ts';
import { RelayCore, renderPlain, type Line, type OutMessage } from './RelayCore.ts';

/** The subset of the WebSocket interface the relay uses; the platform `WebSocket` satisfies it. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: 'close' | 'error' | 'open', listener: () => void): void;
}

const Envelope = z.object({
  type: z.string(),
  envelope_id: z.string().optional(),
  payload: z.unknown().optional(),
});

const MessageEvent = z.object({
  event_id: z.string().optional(),
  event: z.object({
    type: z.literal('message'),
    channel_type: z.string().optional(),
    channel: z.string(),
    user: z.string().optional(),
    text: z.string().max(8000).optional(),
    bot_id: z.string().optional(),
    subtype: z.string().optional(),
  }),
});

const BlockActions = z.object({
  type: z.literal('block_actions'),
  user: z.object({ id: z.string() }),
  channel: z.object({ id: z.string() }).optional(),
  message: z.object({ ts: z.string(), text: z.string().optional(), blocks: z.array(z.record(z.string(), z.unknown())).optional() }).optional(),
  actions: z.array(z.object({ value: z.string().max(64).optional() })).min(1),
});

const escape = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function toMrkdwn(lines: readonly Line[]): string {
  return lines.map((line) => line.map((part) => (typeof part === 'string' ? escape(part) : part.style === 'bold' ? `*${escape(part.text)}*` : `\`${escape(part.text)}\``)).join('')).join('\n');
}

class SlackApiError extends Error {
  readonly retryAfterSec: number | null;
  constructor(method: string, error: string, retryAfterSec: number | null) {
    super(`slack ${method} failed: ${error}`);
    this.name = 'SlackApiError';
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * Slack as a control surface, over Socket Mode: the daemon opens an outbound WebSocket to Slack, so nothing
 * listens for Slack on this machine and no request URL exists to be found.
 *
 * Trust model, same as Telegram: identity is the user id Slack attaches to each event, checked against
 * `slack.allowedUserIds`; only direct messages to the bot are read; every action still passes the PolicyEngine
 * as a remote owner. Events are acknowledged before they are handled and de-duplicated by event id, so a
 * redelivery cannot start a task twice.
 */
export class SlackRelay {
  readonly #appToken: Secret;
  readonly #botToken: Secret;
  readonly #core: RelayCore;
  readonly #log: Logger;
  readonly #allowed: ReadonlySet<string>;
  readonly #fetch: typeof fetch;
  readonly #openSocket: (url: string) => SocketLike;
  readonly #apiBase: string;
  readonly #abort = new AbortController();
  readonly #dmChannels = new Map<string, string>();
  readonly #seenEvents: string[] = [];
  readonly #outbox: { user: string; message: OutMessage }[] = [];
  #draining = false;
  #socket: SocketLike | null = null;
  #loop: Promise<void> | null = null;
  #state: 'connected' | 'degraded' = 'degraded';

  constructor(deps: { appToken: Secret; botToken: Secret; allowedUserIds: readonly string[]; studio: Studio; store: Store; events: EventLog; log: Logger; fetch?: typeof fetch; openSocket?: (url: string) => SocketLike; apiBase?: string }) {
    this.#appToken = deps.appToken;
    this.#botToken = deps.botToken;
    this.#log = deps.log;
    this.#allowed = new Set(deps.allowedUserIds);
    this.#fetch = deps.fetch ?? fetch;
    this.#openSocket = deps.openSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.#apiBase = deps.apiBase ?? 'https://slack.com/api';
    this.#core = new RelayCore({ channel: 'slack', studio: deps.studio, store: deps.store, events: deps.events, send: (user, message) => this.#send(user, message), owners: () => [...this.#allowed] });
  }

  get state(): 'connected' | 'degraded' {
    return this.#state;
  }

  async start(): Promise<void> {
    const me = z.object({ user: z.string().optional(), team: z.string().optional() }).parse(await this.#api(this.#botToken, 'auth.test', {}));
    this.#log.info({ bot: me.user, team: me.team, owners: this.#allowed.size }, 'slack relay started');
    this.#core.start();
    this.#loop = this.#run();
  }

  async stop(): Promise<void> {
    this.#core.stop();
    this.#abort.abort();
    this.#socket?.close();
    await this.#loop?.catch(() => undefined);
  }

  /** Connect, serve until the socket closes, reconnect with backoff. Slack rotates Socket Mode connections routinely. */
  async #run(): Promise<void> {
    let failures = 0;
    while (!this.#abort.signal.aborted) {
      try {
        const { url } = z.object({ url: z.string().startsWith('wss://') }).parse(await this.#api(this.#appToken, 'apps.connections.open', {}));
        await new Promise<void>((resolve) => {
          const socket = this.#openSocket(url);
          this.#socket = socket;
          socket.addEventListener('open', () => {
            failures = 0;
            this.#state = 'connected';
          });
          socket.addEventListener('message', (ev) => void this.handleFrame(typeof ev.data === 'string' ? ev.data : '', (data) => socket.send(data)).then((disconnect) => disconnect && socket.close()));
          socket.addEventListener('close', resolve);
          socket.addEventListener('error', resolve);
        });
      } catch (err) {
        if (this.#abort.signal.aborted) return;
        failures += 1;
        this.#log.warn({ err: errorMessage(err) }, 'slack connection failed');
      }
      this.#socket = null;
      if (this.#abort.signal.aborted) return;
      this.#state = 'degraded';
      await sleep(Math.min(60_000, 1000 * 2 ** Math.min(failures, 6)), this.#abort.signal).catch(() => undefined);
    }
  }

  /**
   * One Socket Mode frame. Acknowledges first (Slack wants the ack within three seconds), then acts.
   * Returns true when Slack asked for the connection to be replaced. Exposed for tests.
   */
  async handleFrame(raw: string, ack: (data: string) => void): Promise<boolean> {
    let envelope: z.infer<typeof Envelope>;
    try {
      envelope = Envelope.parse(JSON.parse(raw));
    } catch {
      return false;
    }
    if (envelope.type === 'disconnect') return true;
    if (envelope.envelope_id) ack(JSON.stringify({ envelope_id: envelope.envelope_id }));

    if (envelope.type === 'events_api') {
      const parsed = MessageEvent.safeParse(envelope.payload);
      if (!parsed.success) return false;
      const { event, event_id } = parsed.data;
      // Only a person's direct message to the bot: no channels, no bots (including this one), no edits or joins.
      if (event.channel_type !== 'im' || event.bot_id || event.subtype || !event.user || !this.#allowed.has(event.user)) return false;
      if (event_id) {
        if (this.#seenEvents.includes(event_id)) return false;
        this.#seenEvents.push(event_id);
        if (this.#seenEvents.length > 200) this.#seenEvents.shift();
      }
      this.#dmChannels.set(event.user, event.channel);
      await this.#core.text(event.user, event.text ?? '').catch((err: unknown) => this.#log.error({ err: errorMessage(err) }, 'slack message failed'));
    } else if (envelope.type === 'interactive') {
      const parsed = BlockActions.safeParse(envelope.payload);
      if (!parsed.success || !this.#allowed.has(parsed.data.user.id)) return false;
      const { user, channel, message, actions } = parsed.data;
      if (channel) this.#dmChannels.set(user.id, channel.id);
      const { reply, spent } = await this.#core.action(user.id, actions[0]!.value ?? '');
      // A used button disappears: the message is rewritten without its actions block.
      if (spent && channel && message) {
        await this.#api(this.#botToken, 'chat.update', { channel: channel.id, ts: message.ts, text: message.text ?? '', blocks: (message.blocks ?? []).filter((b) => b.type !== 'actions') }).catch(() => undefined);
      }
      this.#send(user.id, { lines: [[reply]] });
    }
    return false;
  }

  #send(user: string, message: OutMessage): void {
    this.#outbox.push({ user, message });
    if (!this.#draining) void this.#drain();
  }

  async #drain(): Promise<void> {
    this.#draining = true;
    try {
      while (this.#outbox.length > 0 && !this.#abort.signal.aborted) {
        const { user, message } = this.#outbox[0]!;
        try {
          await this.#deliver(user, message);
          this.#outbox.shift();
        } catch (err) {
          if (err instanceof SlackApiError && err.retryAfterSec !== null) {
            await sleep(err.retryAfterSec * 1000, this.#abort.signal).catch(() => undefined);
            continue;
          }
          this.#log.warn({ err: errorMessage(err), user }, 'slack send failed');
          this.#outbox.shift();
        }
      }
    } finally {
      this.#draining = false;
    }
  }

  async #deliver(user: string, message: OutMessage): Promise<void> {
    let channel = this.#dmChannels.get(user);
    if (!channel) {
      channel = z.object({ channel: z.object({ id: z.string() }) }).parse(await this.#api(this.#botToken, 'conversations.open', { users: user })).channel.id;
      this.#dmChannels.set(user, channel);
    }
    if (message.imageFile) await this.#upload(channel, await readFile(message.imageFile)).catch((err: unknown) => this.#log.warn({ err: errorMessage(err) }, 'slack screenshot upload failed'));
    const text = toMrkdwn(message.lines).slice(0, 2900);
    const blocks: unknown[] = [{ type: 'section', text: { type: 'mrkdwn', text } }];
    if (message.buttons?.length) {
      blocks.push({ type: 'actions', elements: message.buttons.flat().map((b, i) => ({ type: 'button', action_id: `sz_${i}`, text: { type: 'plain_text', text: b.label.slice(0, 75) }, value: b.action })) });
    }
    // `text` is what notifications and screen readers get; `blocks` is what the conversation shows.
    await this.#api(this.#botToken, 'chat.postMessage', { channel, text: renderPlain(message.lines).slice(0, 2900), blocks, unfurl_links: false });
  }

  /** Slack's current three-step upload: ask for a URL, send the bytes there, then attach the file to the channel. */
  async #upload(channel: string, png: Uint8Array): Promise<void> {
    const ticket = z.object({ upload_url: z.string().url(), file_id: z.string() }).parse(await this.#api(this.#botToken, 'files.getUploadURLExternal', { filename: 'preview.png', length: png.byteLength }, 'form'));
    const sent = await this.#fetch(ticket.upload_url, { method: 'POST', body: new Blob([png as BlobPart], { type: 'image/png' }), signal: AbortSignal.timeout(60_000) });
    if (!sent.ok) throw new SlackApiError('upload', `HTTP ${sent.status}`, null);
    await this.#api(this.#botToken, 'files.completeUploadExternal', { files: [{ id: ticket.file_id, title: 'preview' }], channel_id: channel });
  }

  async #api(token: Secret, method: string, params: Record<string, unknown>, encoding: 'json' | 'form' = 'json'): Promise<unknown> {
    const headers: Record<string, string> = { authorization: `Bearer ${token.expose()}` };
    let body: string;
    if (encoding === 'form') {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    } else {
      headers['content-type'] = 'application/json; charset=utf-8';
      body = JSON.stringify(params);
    }
    let res: Response;
    try {
      res = await this.#fetch(`${this.#apiBase}/${method}`, { method: 'POST', headers, body, signal: AbortSignal.any([this.#abort.signal, AbortSignal.timeout(30_000)]) });
    } catch (err) {
      throw new SlackApiError(method, err instanceof Error ? err.name : 'network error', null);
    }
    if (res.status === 429) throw new SlackApiError(method, 'rate limited', Number(res.headers.get('retry-after') ?? 1));
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!json?.ok) throw new SlackApiError(method, json?.error ?? `HTTP ${res.status}`, null);
    return json;
  }

  /** Resolves once every queued outbound message has been sent or dropped. For tests and graceful shutdown. */
  async flush(): Promise<void> {
    while (this.#draining || this.#outbox.length > 0) await sleep(5);
  }
}

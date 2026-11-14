import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Studio } from '../app/Studio.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { errorMessage, sleep, type Logger, type Secret } from '../util/core.ts';
import { RelayCore, renderPlain, type OutMessage } from './RelayCore.ts';

const SINCE_KEY = 'ntfy.since';
const CHAT = 'owner';
/** ntfy shows at most three action buttons on a notification. */
const MAX_ACTIONS = 3;

const StreamEvent = z.object({ id: z.string(), event: z.string(), message: z.string().max(400).optional() });

/**
 * ntfy as a notification channel with one-tap decisions.
 *
 * Outbound: briefings and approval requests are published to `topic`, with a screenshot when there is one.
 * Inbound: each button is an ntfy `http` action that makes the phone publish a short command to `commandTopic`,
 * which the daemon follows as a stream. Both directions are outbound HTTPS from this machine.
 *
 * ntfy carries no sender identity, so this channel is narrower than Telegram and Slack by design:
 * - Only button commands are accepted, and each must carry an HMAC made with a key that never leaves the vault.
 *   A command is therefore one the daemon itself offered; nobody who merely knows the topic name can make one up.
 * - There is no free-text prompting. A message typed into the command topic is ignored.
 * - Anyone who can read the notification topic sees the buttons and can press them. Treat the topic name as a
 *   password on a public server, or protect both topics with an access token (`relay/ntfy/token`).
 */
export class NtfyRelay {
  readonly #server: string;
  readonly #topic: string;
  readonly #commandTopic: string;
  readonly #token: Secret | null;
  readonly #signingKey: Secret;
  readonly #core: RelayCore;
  readonly #store: Store;
  readonly #log: Logger;
  readonly #fetch: typeof fetch;
  readonly #abort = new AbortController();
  readonly #outbox: OutMessage[] = [];
  #draining = false;
  #loop: Promise<void> | null = null;
  #state: 'connected' | 'degraded' = 'degraded';

  constructor(deps: { server: string; topic: string; commandTopic: string; token: Secret | null; signingKey: Secret; studio: Studio; store: Store; events: EventLog; log: Logger; fetch?: typeof fetch }) {
    for (const name of [deps.topic, deps.commandTopic]) if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error('ntfy topic names may contain letters, digits, dashes and underscores (1–64 characters)');
    if (deps.topic === deps.commandTopic) throw new Error('ntfy.topic and ntfy.commandTopic must differ');
    this.#server = deps.server.replace(/\/+$/, '');
    this.#topic = deps.topic;
    this.#commandTopic = deps.commandTopic;
    this.#token = deps.token;
    this.#signingKey = deps.signingKey;
    this.#store = deps.store;
    this.#log = deps.log;
    this.#fetch = deps.fetch ?? fetch;
    this.#core = new RelayCore({ channel: 'ntfy', studio: deps.studio, store: deps.store, events: deps.events, send: (_chat, message) => this.#send(message), owners: () => [CHAT] });
  }

  get state(): 'connected' | 'degraded' {
    return this.#state;
  }

  start(): void {
    this.#core.start();
    this.#loop = this.#follow();
    this.#log.info({ server: this.#server }, 'ntfy relay started');
  }

  async stop(): Promise<void> {
    this.#core.stop();
    this.#abort.abort();
    await this.#loop?.catch(() => undefined);
  }

  // ------------------------------------------------------------ commands

  sign(action: string): string {
    return `${action}.${createHmac('sha256', this.#signingKey.expose()).update(action).digest('base64url')}`;
  }

  #verify(command: string): string | null {
    const dot = command.lastIndexOf('.');
    if (dot <= 0) return null;
    const action = command.slice(0, dot);
    const given = Buffer.from(command.slice(dot + 1));
    const expected = Buffer.from(createHmac('sha256', this.#signingKey.expose()).update(action).digest('base64url'));
    return given.length === expected.length && timingSafeEqual(given, expected) ? action : null;
  }

  /** One command from the command topic. Exposed for tests. */
  async handleCommand(command: string): Promise<void> {
    const action = this.#verify(command.trim());
    if (action === null) {
      this.#log.warn({}, 'ntfy command with a bad signature dropped');
      return;
    }
    const { reply } = await this.#core.action(CHAT, action);
    this.#send({ lines: [[reply]] });
  }

  /** Follows the command topic as a JSON stream, resuming after the last message handled. */
  async #follow(): Promise<void> {
    let failures = 0;
    while (!this.#abort.signal.aborted) {
      try {
        const since = this.#store.kvGet(SINCE_KEY);
        const res = await this.#fetch(`${this.#server}/${this.#commandTopic}/json${since ? `?since=${encodeURIComponent(since)}` : ''}`, { headers: this.#auth(), signal: this.#abort.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        failures = 0;
        this.#state = 'connected';
        let buffer = '';
        for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
          buffer += chunk;
          let newline: number;
          while ((newline = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            const event = StreamEvent.safeParse(safeJson(line));
            if (!event.success || event.data.event !== 'message') continue;
            // At-most-once, as with the other relays: remember the position before acting on the message.
            this.#store.kvSet(SINCE_KEY, event.data.id);
            await this.handleCommand(event.data.message ?? '').catch((err: unknown) => this.#log.error({ err: errorMessage(err) }, 'ntfy command failed'));
          }
          if (buffer.length > 64 * 1024) buffer = '';
        }
      } catch (err) {
        if (this.#abort.signal.aborted) return;
        failures += 1;
        this.#log.warn({ err: errorMessage(err) }, 'ntfy stream failed');
      }
      if (this.#abort.signal.aborted) return;
      this.#state = 'degraded';
      await sleep(Math.min(60_000, 1000 * 2 ** Math.min(failures, 6)), this.#abort.signal).catch(() => undefined);
    }
  }

  // ---------------------------------------------------------- publishing

  #auth(): Record<string, string> {
    return this.#token ? { authorization: `Bearer ${this.#token.expose()}` } : {};
  }

  #send(message: OutMessage): void {
    this.#outbox.push(message);
    if (!this.#draining) void this.#drain();
  }

  async #drain(): Promise<void> {
    this.#draining = true;
    try {
      while (this.#outbox.length > 0 && !this.#abort.signal.aborted) {
        const message = this.#outbox[0]!;
        try {
          await this.#publish(message);
        } catch (err) {
          this.#log.warn({ err: errorMessage(err) }, 'ntfy publish failed');
        }
        this.#outbox.shift();
      }
    } finally {
      this.#draining = false;
    }
  }

  async #publish(message: OutMessage): Promise<void> {
    const [first, ...rest] = message.lines;
    // Buttons that need a follow-up message (choosing a project, describing a change) have no meaning here.
    const buttons = (message.buttons ?? []).flat().filter((b) => !b.action.startsWith('f:') && !b.action.startsWith('p:') && !b.action.startsWith('e:')).slice(0, MAX_ACTIONS);
    const body = {
      topic: this.#topic,
      title: renderPlain(first ? [first] : []).slice(0, 200) || 'Studio Zero',
      message: renderPlain(rest).trim().slice(0, 3500) || renderPlain(first ? [first] : []),
      priority: message.priority === 'high' ? 4 : 3,
      actions: buttons.map((b) => ({ action: 'http', label: b.label.slice(0, 40), url: `${this.#server}/${this.#commandTopic}`, method: 'POST', headers: this.#auth(), body: this.sign(b.action), clear: true })),
    };
    const res = await this.#fetch(this.#server, { method: 'POST', headers: { 'content-type': 'application/json', ...this.#auth() }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`publish failed (${res.status})`);
    if (message.imageFile) {
      const png = await readFile(message.imageFile);
      const upload = await this.#fetch(`${this.#server}/${this.#topic}`, { method: 'PUT', headers: { Filename: 'preview.png', Title: encodeURIComponent(body.title), ...this.#auth() }, body: new Blob([png as BlobPart], { type: 'image/png' }), signal: AbortSignal.timeout(60_000) });
      if (!upload.ok) throw new Error(`screenshot upload failed (${upload.status})`);
    }
  }

  /** Resolves once every queued outbound message has been sent or dropped. For tests and graceful shutdown. */
  async flush(): Promise<void> {
    while (this.#draining || this.#outbox.length > 0) await sleep(5);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

import { readFile } from 'node:fs/promises';
import type { Studio } from '../app/Studio.ts';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { errorMessage, sleep, type Logger } from '../util/core.ts';
import { RelayCore, type Line, type OutMessage } from './RelayCore.ts';
import { TelegramApiError, escapeHtml, type Keyboard, type TelegramApi, type Update } from './telegramApi.ts';

const OFFSET_KEY = 'telegram.offset';
const MIN_POLL_INTERVAL_MS = 1000;

type Outbound = { chatId: number; html: string; keyboard?: Keyboard; photoFile?: string };

/** Speech to text for voice notes. Absent when no provider key is configured. */
export type Transcriber = (audio: Uint8Array, mimeType: string) => Promise<string>;

function toHtml(lines: readonly Line[]): string {
  return lines.map((line) => line.map((part) => (typeof part === 'string' ? escapeHtml(part) : part.style === 'bold' ? `<b>${escapeHtml(part.text)}</b>` : `<code>${escapeHtml(part.text)}</code>`)).join('')).join('\n');
}

/**
 * Telegram as a control surface. Long-polls the Bot API (outbound HTTPS only) and hands owner messages and
 * button taps to `RelayCore`.
 *
 * Trust model:
 * - Identity is the numeric `from.id` Telegram attaches to each update, checked against `telegram.allowedUserIds`,
 *   in private chats only. Group messages, channel posts and everyone else are dropped before any parsing.
 * - A tap or message is a request, not an authorization: it still goes through the PolicyEngine, which is why
 *   credential management is unavailable here (`vault.local-owner-only`).
 * - Text from the owner becomes a task prompt (user-role input). It is never executed or interpolated into
 *   daemon-side commands.
 *
 * Delivery semantics: the poll offset is persisted *before* an update is handled (at-most-once). A crash can
 * drop a message, which the owner notices and resends; it can never start the same paid task twice.
 */
export class TelegramRelay {
  readonly #api: TelegramApi;
  readonly #core: RelayCore;
  readonly #store: Store;
  readonly #log: Logger;
  readonly #allowed: ReadonlySet<number>;
  readonly #transcribe: Transcriber | null;
  readonly #abort = new AbortController();
  readonly #outbox: Outbound[] = [];
  #draining = false;
  #loop: Promise<void> | null = null;
  #state: 'polling' | 'degraded' = 'polling';

  constructor(deps: { api: TelegramApi; studio: Studio; store: Store; events: EventLog; config: Config; log: Logger; transcribe?: Transcriber }) {
    this.#api = deps.api;
    this.#store = deps.store;
    this.#log = deps.log;
    this.#allowed = new Set(deps.config.telegram.allowedUserIds);
    this.#transcribe = deps.transcribe ?? null;
    this.#core = new RelayCore({
      channel: 'telegram',
      studio: deps.studio,
      store: deps.store,
      events: deps.events,
      send: (chat, message) => this.#send(Number(chat), message),
      // In a private chat the chat id equals the user id, so the allow-list doubles as the recipient list.
      owners: () => [...this.#allowed].map(String),
    });
  }

  get state(): 'polling' | 'degraded' {
    return this.#state;
  }

  async start(): Promise<void> {
    const me = await this.#api.getMe();
    this.#log.info({ bot: me.username, owners: this.#allowed.size }, 'telegram relay started');
    this.#core.start();
    this.#loop = this.#poll();
  }

  async stop(): Promise<void> {
    this.#core.stop();
    this.#abort.abort();
    await this.#loop?.catch(() => undefined);
  }

  async #poll(): Promise<void> {
    let failures = 0;
    while (!this.#abort.signal.aborted) {
      try {
        const offset = Number(this.#store.kvGet(OFFSET_KEY) ?? 0);
        const started = Date.now();
        const updates = await this.#api.getUpdates(offset, 50, this.#abort.signal);
        failures = 0;
        this.#state = 'polling';
        // A long poll that comes back empty at once means something in between is not holding the request
        // open. Pace the loop so that case costs one request a second instead of a busy spin.
        if (updates.length === 0 && Date.now() - started < MIN_POLL_INTERVAL_MS) await sleep(MIN_POLL_INTERVAL_MS, this.#abort.signal).catch(() => undefined);
        for (const update of updates) {
          this.#store.kvSet(OFFSET_KEY, String(update.update_id + 1));
          await this.handleUpdate(update).catch((err: unknown) => this.#log.error({ err: errorMessage(err), update: update.update_id }, 'telegram update failed'));
        }
      } catch (err) {
        if (this.#abort.signal.aborted) return;
        failures += 1;
        this.#state = 'degraded';
        const retryAfter = err instanceof TelegramApiError && err.retryAfterSec !== null ? err.retryAfterSec * 1000 : 0;
        const backoff = Math.max(retryAfter, Math.min(60_000, 1000 * 2 ** Math.min(failures, 6)));
        this.#log.warn({ err: errorMessage(err), backoffMs: backoff }, 'telegram poll failed');
        await sleep(backoff, this.#abort.signal).catch(() => undefined);
      }
    }
  }

  /** Exposed for tests; the poll loop is the only production caller. */
  async handleUpdate(update: Update): Promise<void> {
    const from = update.message?.from?.id ?? update.callback_query?.from.id;
    const chat = update.message?.chat ?? update.callback_query?.message?.chat;
    if (from === undefined || !this.#allowed.has(from) || chat?.type !== 'private' || chat.id !== from) {
      if (from !== undefined) this.#log.debug({ from }, 'telegram update from non-owner dropped');
      return;
    }
    const chatKey = String(from);

    if (update.callback_query) {
      const query = update.callback_query;
      const action = query.data ?? '';
      const { reply, spent } = await this.#core.action(chatKey, action);
      await this.#api.answerCallback(query.id, reply).catch(() => undefined);
      if (spent && query.message) await this.#api.clearKeyboard(from, query.message.message_id).catch(() => undefined);
      // Selecting a project or starting a follow-up is confirmed by the toast alone; results get a message.
      if (!action.startsWith('p:') && !action.startsWith('f:')) this.#send(from, { lines: [[reply]] });
      return;
    }

    if (update.message?.voice) {
      if (!this.#transcribe) return this.#send(from, { lines: [['음성 메모를 받아쓰려면 OpenAI API 키가 필요합니다. 설정에서 키를 저장하거나, 키보드 받아쓰기로 텍스트를 보내주세요.']] });
      try {
        const audio = await this.#api.downloadFile(update.message.voice.file_id, 20 * 1024 * 1024);
        const transcript = (await this.#transcribe(audio, 'audio/ogg')).trim();
        if (transcript === '') return this.#send(from, { lines: [['음성에서 알아들은 내용이 없습니다. 다시 보내주세요.']] });
        // Say back what was understood before acting on it: a misheard instruction should be visible.
        this.#send(from, { lines: [['받아쓴 내용: ', { text: transcript.slice(0, 1000), style: 'bold' }]] });
        // A transcript is always a prompt, never a command: speech that happens to sound like "/cancel" must not cancel anything.
        await this.#core.text(chatKey, transcript.replace(/^\/+/, ''));
      } catch (err) {
        this.#send(from, { lines: [[`음성 메모를 처리하지 못했습니다: ${errorMessage(err)}`]] });
      }
      return;
    }

    if (update.message?.text !== undefined) await this.#core.text(chatKey, update.message.text);
  }

  #send(chatId: number, message: OutMessage): void {
    this.#outbox.push({
      chatId,
      html: toHtml(message.lines),
      keyboard: message.buttons?.map((row) => row.map((b) => ({ text: b.label, callback_data: b.action }))),
      photoFile: message.imageFile,
    });
    if (!this.#draining) void this.#drain();
  }

  /** One message at a time, in order, honouring Telegram's `retry_after`. Emitting an event never waits on this. */
  async #drain(): Promise<void> {
    this.#draining = true;
    try {
      while (this.#outbox.length > 0 && !this.#abort.signal.aborted) {
        const message = this.#outbox[0]!;
        try {
          if (message.photoFile) await this.#api.sendPhoto(message.chatId, await readFile(message.photoFile), message.html, message.keyboard);
          else await this.#api.sendMessage(message.chatId, message.html, message.keyboard);
          this.#outbox.shift();
        } catch (err) {
          if (err instanceof TelegramApiError && err.retryAfterSec !== null) {
            await sleep(err.retryAfterSec * 1000, this.#abort.signal).catch(() => undefined);
            continue;
          }
          // Not retryable (blocked bot, bad chat, missing screenshot file): log and move on so the queue cannot wedge.
          this.#log.warn({ err: errorMessage(err), chatId: message.chatId }, 'telegram send failed');
          this.#outbox.shift();
        }
      }
    } finally {
      this.#draining = false;
    }
  }

  /** Resolves once every queued outbound message has been sent or dropped. For tests and graceful shutdown. */
  async flush(): Promise<void> {
    while (this.#draining || this.#outbox.length > 0) await sleep(5);
  }
}

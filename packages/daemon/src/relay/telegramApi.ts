import { z } from 'zod';
import type { Secret } from '../util/core.ts';

const User = z.object({ id: z.number().int(), is_bot: z.boolean().optional() });
const Chat = z.object({ id: z.number().int(), type: z.string() });

const Message = z.object({
  message_id: z.number().int(),
  from: User.optional(),
  chat: Chat,
  text: z.string().max(8192).optional(),
  voice: z.object({ file_id: z.string() }).optional(),
});

const CallbackQuery = z.object({
  id: z.string(),
  from: User,
  message: z.object({ message_id: z.number().int(), chat: Chat }).optional(),
  data: z.string().max(64).optional(),
});

/** Only the fields the relay acts on. Everything else Telegram sends is dropped at this boundary. */
export const Update = z.object({
  update_id: z.number().int(),
  message: Message.optional(),
  callback_query: CallbackQuery.optional(),
});
export type Update = z.infer<typeof Update>;

export interface InlineButton {
  text: string;
  callback_data: string;
}
export type Keyboard = InlineButton[][];

export class TelegramApiError extends Error {
  readonly code: number;
  readonly retryAfterSec: number | null;
  constructor(method: string, code: number, description: string, retryAfterSec: number | null) {
    super(`telegram ${method} failed (${code}): ${description}`);
    this.name = 'TelegramApiError';
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

const Envelope = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error_code: z.number().optional(),
  description: z.string().optional(),
  parameters: z.object({ retry_after: z.number().optional() }).optional(),
});

/**
 * Minimal Bot API client over `fetch`. Outbound HTTPS only: with long polling the daemon never accepts an
 * inbound connection from Telegram, so no port is exposed and no webhook URL exists to be discovered.
 */
export class TelegramApi {
  readonly #base: string;
  readonly #token: Secret;
  readonly #fetch: typeof fetch;

  constructor(opts: { apiBase: string; token: Secret; fetch?: typeof fetch }) {
    this.#base = opts.apiBase.replace(/\/+$/, '');
    this.#token = opts.token;
    this.#fetch = opts.fetch ?? fetch;
  }

  async getMe(): Promise<{ id: number; username: string }> {
    return z.object({ id: z.number(), username: z.string() }).parse(await this.#call('getMe', {}));
  }

  async getUpdates(offset: number, timeoutSec: number, signal: AbortSignal): Promise<Update[]> {
    const raw = await this.#call('getUpdates', { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] }, signal, (timeoutSec + 15) * 1000);
    const updates: Update[] = [];
    for (const item of z.array(z.unknown()).parse(raw)) {
      const parsed = Update.safeParse(item);
      if (parsed.success) updates.push(parsed.data);
      else {
        // Still advance past an update we cannot parse, or the poll would return it forever.
        const id = z.object({ update_id: z.number().int() }).safeParse(item);
        if (id.success) updates.push({ update_id: id.data.update_id });
      }
    }
    return updates;
  }

  async sendMessage(chatId: number, html: string, keyboard?: Keyboard): Promise<number> {
    const res = await this.#call('sendMessage', {
      chat_id: chatId,
      text: clip(html, 4096),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
    return z.object({ message_id: z.number().int() }).parse(res).message_id;
  }

  async sendPhoto(chatId: number, png: Uint8Array, captionHtml: string, keyboard?: Keyboard): Promise<number> {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('caption', clip(captionHtml, 1024));
    form.set('parse_mode', 'HTML');
    if (keyboard) form.set('reply_markup', JSON.stringify({ inline_keyboard: keyboard }));
    form.set('photo', new Blob([png as BlobPart], { type: 'image/png' }), 'preview.png');
    const res = await this.#request('sendPhoto', { method: 'POST', body: form }, 60_000);
    return z.object({ message_id: z.number().int() }).parse(res).message_id;
  }

  /** Downloads a file the bot was sent (a voice note). Refuses anything larger than `maxBytes`. */
  async downloadFile(fileId: string, maxBytes: number): Promise<Uint8Array> {
    const info = z.object({ file_path: z.string(), file_size: z.number().optional() }).parse(await this.#call('getFile', { file_id: fileId }));
    if ((info.file_size ?? 0) > maxBytes) throw new TelegramApiError('getFile', 413, 'file too large', null);
    let res: Response;
    try {
      res = await this.#fetch(`${this.#base}/file/bot${this.#token.expose()}/${info.file_path}`, { signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      throw new TelegramApiError('download', 0, err instanceof Error ? err.name : 'network error', null);
    }
    if (!res.ok) throw new TelegramApiError('download', res.status, 'download failed', null);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new TelegramApiError('download', 413, 'file too large', null);
    return bytes;
  }

  async answerCallback(callbackQueryId: string, text: string): Promise<void> {
    await this.#call('answerCallbackQuery', { callback_query_id: callbackQueryId, text: clip(text, 200) });
  }

  async clearKeyboard(chatId: number, messageId: number): Promise<void> {
    await this.#call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
  }

  #call(method: string, params: Record<string, unknown>, signal?: AbortSignal, timeoutMs = 30_000): Promise<unknown> {
    return this.#request(method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal }, timeoutMs);
  }

  async #request(method: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      // The bot token is part of the URL by Telegram's design, so the URL is never logged or put in an error.
      res = await this.#fetch(`${this.#base}/bot${this.#token.expose()}/${method}`, { ...init, signal });
    } catch (err) {
      if (init.signal?.aborted) throw err;
      throw new TelegramApiError(method, 0, err instanceof Error ? err.name : 'network error', null);
    }
    const body = Envelope.safeParse(await res.json().catch(() => null));
    if (!body.success) throw new TelegramApiError(method, res.status, 'unparseable response', null);
    if (!body.data.ok) {
      throw new TelegramApiError(method, body.data.error_code ?? res.status, body.data.description ?? 'unknown error', body.data.parameters?.retry_after ?? null);
    }
    return body.data.result;
  }
}

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

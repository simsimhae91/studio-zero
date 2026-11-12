import type { Secret } from '../util/core.ts';
import type { Transcriber } from './TelegramRelay.ts';

/**
 * Speech-to-text through OpenAI's transcription endpoint, for voice notes sent to a relay.
 * Runs on the host with the key from the vault; the audio never touches a sandbox.
 */
export function openAiTranscriber(opts: { apiKey: () => Promise<Secret | null>; model: string; fetch?: typeof fetch; baseUrl?: string }): Transcriber {
  const doFetch = opts.fetch ?? fetch;
  return async (audio, mimeType) => {
    const key = await opts.apiKey();
    if (!key) throw new Error('OpenAI API 키가 저장되어 있지 않습니다');
    const form = new FormData();
    form.set('model', opts.model);
    form.set('file', new Blob([audio as BlobPart], { type: mimeType }), 'voice.ogg');
    const res = await doFetch(`${opts.baseUrl ?? 'https://api.openai.com'}/v1/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${key.expose()}` }, body: form, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`transcription failed (${res.status})`);
    const body = (await res.json()) as { text?: unknown };
    if (typeof body.text !== 'string') throw new Error('transcription returned no text');
    return body.text;
  };
}

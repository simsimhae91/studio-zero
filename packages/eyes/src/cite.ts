import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Browser } from 'playwright-core';
import { closeBrowser, openBrowser, quiet } from './web.ts';

/**
 * A claim about the world (people pay for this, they complain of that) is believed for the words of a real
 * page, and an agent that wants a claim to be true will write down words that are on no page. So a quotation
 * is not taken on its writer's word: the page is fetched again here, and the words are looked for on it. What
 * is kept is where they stood (the text around them) and, when a browser was needed to read the page, a
 * picture of it. Whether the words support the claim is another reader's judgement; that they exist is not.
 */
export interface Seen {
  at: string;
  /** How the page was read: as it is sent (`fetch`), or as a browser draws it (`chrome`). */
  by: 'fetch' | 'chrome';
  /** The words with what stands around them on the page. */
  excerpt: string;
  title: string;
  /** A picture of the page at those words, when a browser read it and somewhere to keep it was given. */
  shot: string | null;
}

export class CiteError extends Error {}

/** The same words however a page spaces, quotes and dashes them. */
const plain = (text: string): string =>
  text
    .normalize('NFC')
    .replace(/[​-‍﻿­]/g, '')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** What a page sent as markup says when read: without its scripts, styles and tags. */
const asText = (body: string): string =>
  body
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);

/** A body that is data (JSON) writes its letters as escapes: `약` is 약. */
const unescaped = (body: string): string => body.replace(/\\u([0-9a-f]{4})/gi, (_m, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))).replace(/\\(["/])/g, '$1');

/**
 * Where the words stand in a text, as the text around them, or null. Spacing is not held against a page: words
 * that a tag or a line break split are still those words.
 */
export function findQuote(text: string, quote: string): string | null {
  // Capitals are not held against it either; what is kept is the page's own writing.
  const page = plain(text);
  const hay = page.toLowerCase();
  const needle = plain(quote).toLowerCase();
  if (needle === '' || hay.length !== page.length) return needle !== '' && page.includes(plain(quote)) ? plain(quote) : null;
  const cut = (from: number, to: number): string => `${from > 160 ? '… ' : ''}${page.slice(Math.max(0, from - 160), to + 160)}${to + 160 < page.length ? ' …' : ''}`;
  const at = hay.indexOf(needle);
  if (at !== -1) return cut(at, at + needle.length);
  // The same letters with no spaces at all: found, the excerpt is cut from the spaced text by counting letters.
  const tight = needle.replace(/ /g, '');
  const letters: number[] = [];
  let packed = '';
  for (let i = 0; i < hay.length; i++) {
    if (hay[i] !== ' ') {
      packed += hay[i];
      letters.push(i);
    }
  }
  const hit = packed.indexOf(tight);
  if (hit === -1) return null;
  return cut(letters[hit]!, letters[hit + tight.length - 1]! + 1);
}

/** A page out in the world: not this machine, not a network only this machine is on, not a file. */
export function publicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CiteError(`not an address: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new CiteError(`${raw}: evidence is a page on the web (http or https)`);
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd])/.test(host)) throw new CiteError(`${raw}: that is this machine or a private network. Evidence about the world is a page anyone can open`);
  return url;
}

const AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const titleOf = (body: string): string => asText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);

export interface CiteOptions {
  /** Where to keep a picture of the page (a .png path), when a browser reads it. */
  shot?: string;
  browser?: Browser;
  timeoutMs?: number;
  now?: () => string;
}

/**
 * Opens the page and looks for the words. First as the page is sent, which is enough for most pages and for
 * data; then, when the words are not in what was sent, as a browser draws it. Says why when they are not found:
 * the page did not answer, it asked for a login, or it was read and the words are not on it.
 */
export async function seeQuote(rawUrl: string, quote: string, opts: CiteOptions = {}): Promise<{ seen: Seen | null; why: string | null }> {
  const url = publicUrl(rawUrl);
  if (plain(quote).replace(/ /g, '').length < 4) throw new CiteError('a quotation is the words (or the figure) as they stand on the page: at least four characters');
  const at = (opts.now ?? (() => new Date().toISOString()))();
  const timeout = opts.timeoutMs ?? 20_000;
  let sent: string | null = null;
  let refused: string | null = null;
  try {
    const ask = (): Promise<Response> => fetch(url, { headers: { 'user-agent': AGENT, 'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7', accept: 'text/html,application/json;q=0.9,*/*;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
    let response = await ask();
    // A site asked too quickly says so: once more, after a pause.
    if (response.status === 429) {
      await new Promise((done) => setTimeout(done, 4_000));
      response = await ask();
    }
    if (response.ok) sent = (await response.text()).slice(0, 8_000_000);
    else refused = `it answered ${response.status}`;
  } catch (err) {
    refused = `it did not answer (${(err instanceof Error ? err.message : String(err)).slice(0, 120)})`;
  }
  if (sent !== null) {
    for (const reading of [asText(sent), unescaped(sent), asText(unescaped(sent))]) {
      const excerpt = findQuote(reading, quote);
      if (excerpt) return { seen: { at, by: 'fetch', excerpt, title: titleOf(sent), shot: null }, why: null };
    }
  }
  // Not in what was sent: the page may write its words with a script. Read it as a person's browser shows it.
  const browser = opts.browser ?? (await openBrowser());
  try {
    const context = await browser.newContext({ locale: 'ko-KR', userAgent: AGENT, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const answer = await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout }).catch(() => null);
    await quiet(page);
    const drawn = (await Promise.all(page.frames().map((frame) => frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')))).join('\n');
    // On its face first; then in what it holds behind (its description, the data it was drawn from).
    const behind = await page.content().catch(() => '');
    const excerpt = findQuote(drawn, quote) ?? findQuote(unescaped(behind), quote) ?? findQuote(asText(unescaped(behind)), quote);
    if (!excerpt) {
      await context.close();
      const status = answer?.status() ?? null;
      if (drawn.trim().length < 200) return { seen: null, why: `the page could not be read: ${status && status >= 400 ? `it answered ${status}` : (refused ?? 'it showed almost nothing (a login, a check that the reader is a person, or an empty page)')}` };
      return { seen: null, why: `the page was read (${drawn.length} characters as a browser shows it) and these words are not on it. Quote the words exactly as they stand there` };
    }
    let shot: string | null = null;
    if (opts.shot) {
      // The picture is of the place on the page where the words stand, where that can be found.
      await page
        .getByText(quote.trim().slice(0, 40), { exact: false })
        .first()
        .scrollIntoViewIfNeeded({ timeout: 2_000 })
        .catch(() => undefined);
      mkdirSync(dirname(opts.shot), { recursive: true });
      writeFileSync(opts.shot, await page.screenshot({ type: 'png' }));
      shot = opts.shot;
    }
    const title = (await page.title().catch(() => '')).slice(0, 160);
    await context.close();
    return { seen: { at, by: 'chrome', excerpt, title, shot }, why: null };
  } finally {
    if (!opts.browser) await closeBrowser(browser);
  }
}

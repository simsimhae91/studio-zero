import { randomUUID } from 'node:crypto';

/**
 * A look at a service where people reach it, without a browser: is it up, is it the version that was released,
 * is it served the way a public service has to be, and what would a person arriving from a shared link trip on.
 * "It deployed" says the provider took the files. This says what answers at the address.
 */
export interface LiveLook {
  url: string;
  /** The home page's status, or null when nothing answered. */
  status: number | null;
  /** The middle of three times the home page took to answer, in milliseconds. */
  ms: number | null;
  version: {
    /** Where the service was asked which version it is. */
    at: string;
    /** What it said, or null when it does not say. */
    said: string | null;
    wanted: string | null;
    same: boolean | null;
  };
  /** Why this is not the service as released: nothing is built on, or left live with, one of these. */
  problems: string[];
  /** What a person arriving would trip on. Nobody asked, and the owner would want to know. */
  notices: string[];
}

const LOCAL = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|.*\.local$|.*\.orb\.local$|host\.docker\.internal$)/;

async function get(url: string, opts: { redirect?: 'follow' | 'manual' } = {}): Promise<{ status: number; headers: Headers; body: string; ms: number } | null> {
  const started = performance.now();
  try {
    const res = await fetch(url, { redirect: opts.redirect ?? 'follow', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'sz-eyes' } });
    const body = (await res.text()).slice(0, 2 * 1024 * 1024);
    return { status: res.status, headers: res.headers, body, ms: Math.round(performance.now() - started) };
  } catch {
    return null;
  }
}

/** The versions a health answer names: the fields a JSON answer usually has, or anything that looks like a commit. */
export function versionsIn(body: string): string[] {
  const found: string[] = [];
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object') for (const key of ['commit', 'version', 'sha', 'revision', 'build', 'release']) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'string' && value !== '') found.push(value);
    }
  } catch {
    // Plain words: taken as they are below.
  }
  for (const match of body.matchAll(/\b[0-9a-f]{7,40}\b/g)) found.push(match[0]);
  return [...new Set(found)];
}

/** Two names of one commit: one is the beginning of the other, and at least seven characters are compared. */
export const sameCommit = (a: string, b: string): boolean => {
  const [x, y] = [a.trim().toLowerCase(), b.trim().toLowerCase()];
  return Math.min(x.length, y.length) >= 7 && (x.startsWith(y) || y.startsWith(x));
};

const has = (html: string, pattern: RegExp): boolean => pattern.test(html);

export async function lookAtLive(url: string, opts: { commit?: string; at?: string } = {}): Promise<LiveLook> {
  const home = new URL(url);
  const at = new URL(opts.at ?? '/healthz', home).href;
  const problems: string[] = [];
  const notices: string[] = [];
  const local = LOCAL.test(home.hostname);

  const tries = [await get(home.href), await get(home.href), await get(home.href)];
  const answered = tries.filter((t) => t !== null);
  const first = answered[0] ?? null;
  const ms = answered.length > 0 ? answered.map((t) => t.ms).sort((a, b) => a - b)[Math.floor(answered.length / 2)]! : null;
  if (!first) problems.push(`nothing answers at ${home.href}`);
  else if (first.status >= 400) problems.push(`the first page answers ${first.status}`);
  if (answered.length > 0 && answered.length < tries.length) problems.push(`${tries.length - answered.length} of ${tries.length} requests for the first page got no answer`);
  if (ms !== null && ms > 1500) notices.push(`the first page takes ${ms} ms to answer (the middle of three): a person on a phone waits that long before anything is drawn`);

  const health = await get(at);
  const said = health && health.status < 400 ? (versionsIn(health.body)[0] ?? null) : null;
  const wanted = opts.commit?.trim() || null;
  const same = wanted === null || !health || health.status >= 400 ? null : versionsIn(health.body).some((version) => sameCommit(version, wanted));
  if (!health) problems.push(`nothing answers at ${at}`);
  else if (health.status >= 400) problems.push(`${at} answers ${health.status}: the service does not say whether it is up or which version it is`);
  else if (wanted !== null && said === null) problems.push(`${at} does not say which version is running, so nobody can tell that what was released is what answers. Have it say the commit it was built from`);
  else if (wanted !== null && same === false) problems.push(`what answers is version ${said}, not ${wanted}: the release did not take, or something else is being served`);
  else if (wanted === null && said === null) notices.push(`${at} does not say which version is running: after a release nobody can tell that it took`);

  if (home.protocol === 'http:' && !local) problems.push('it is served without https: what people type, and their session, crosses the network in the clear');
  if (home.protocol === 'https:') {
    const plain = await get(`http://${home.host}${home.pathname}`, { redirect: 'manual' });
    if (plain && !(plain.status >= 300 && plain.status < 400 && (plain.headers.get('location') ?? '').startsWith('https://'))) notices.push(`http://${home.host} does not send people on to https (it answers ${plain.status})`);
    if (first && !first.headers.get('strict-transport-security')) notices.push('no Strict-Transport-Security header: a browser may try plain http first on the next visit');
  }

  const missing = await get(new URL(`/sz-nothing-here-${randomUUID().slice(0, 8)}`, home).href);
  if (missing && missing.status >= 500) problems.push(`an address that does not exist answers ${missing.status}: the server fails where it should say "not found"`);
  else if (missing && missing.status === 200) notices.push('an address that does not exist answers 200, not 404: search engines and link previews take it for a real page');

  if (first && first.status < 400 && /html/i.test(first.headers.get('content-type') ?? '')) {
    const html = first.body;
    if (!has(html, /<title>\s*[^<\s][^<]*<\/title>/i)) notices.push('the first page has no title: a tab and a shared link show the bare address');
    if (!has(html, /<meta[^>]+name=["']viewport["']/i)) notices.push('no viewport meta tag: on a phone the page is drawn at desktop width and shrunk');
    if (!has(html, /<html[^>]+lang=/i)) notices.push('the page does not say its language (html lang): screen readers guess, and browsers may offer to translate it');
    if (!has(html, /<meta[^>]+property=["']og:title["']/i) || !has(html, /<meta[^>]+property=["']og:image["']/i)) notices.push('no og:title or og:image: a link shared in a messenger shows no title or picture');
    if (has(html, /<meta[^>]+name=["']robots["'][^>]+noindex/i) || /noindex/i.test(first.headers.get('x-robots-tag') ?? '')) notices.push('the first page asks search engines not to list it (noindex)');
    if (!has(html, /<link[^>]+rel=["'][^"']*icon/i)) {
      const icon = await get(new URL('/favicon.ico', home).href);
      if (!icon || icon.status >= 400) notices.push('no icon: the tab and a home-screen shortcut show a blank');
    }
    if (/[가-힣]/.test(html) && !/개인정보/.test(html)) notices.push('the first page links no 개인정보 처리방침: a service that keeps anything about a person (a name, an email, a sign-in) has to post one, and say there where the data is kept');
    if (!first.headers.get('x-content-type-options')) notices.push('no X-Content-Type-Options header (nosniff): a file a person uploaded can be run as a script by an old browser');
  }

  return { url: home.href, status: first?.status ?? null, ms, version: { at, said, wanted, same }, problems, notices };
}

export function renderLive(look: LiveLook): string {
  const lines = [`${look.url}: ${look.status === null ? 'no answer' : `answers ${look.status}`}${look.ms !== null ? ` in ${look.ms} ms` : ''}`];
  lines.push(look.version.said === null ? `version: not said at ${look.version.at}` : `version: ${look.version.said}${look.version.wanted ? (look.version.same ? ` (the released ${look.version.wanted})` : ` (released: ${look.version.wanted})`) : ''}`);
  if (look.problems.length === 0) lines.push(look.version.wanted ? 'what answers is what was released' : 'it is up');
  else lines.push(`${look.problems.length} PROBLEM(S):`, ...look.problems.map((line) => `  - ${line}`));
  if (look.notices.length > 0) lines.push(`${look.notices.length} thing(s) a person arriving would meet:`, ...look.notices.map((line) => `  - ${line}`));
  return lines.join('\n');
}

import type { Browser, BrowserContext, Page } from 'playwright-core';
import { SIZES, closeBrowser, doStep, openBrowser, quiet, type Step } from './web.ts';

/**
 * Can one person get at what another stored? The commonest serious fault of a product made by an agent is a
 * server that hands anyone anything: in one study a tenth of the apps of one builder gave their tables to whoever
 * asked. A screen cannot show this, because the screen only asks for what is its own. So this does not look at
 * the screen. It uses the product as one person (A), writes down everything that person's browser asked of a
 * server and what came back, and then asks for exactly the same things as nobody (no session) and as a second
 * person (B). An answer that holds what only A typed, or a change of A's things that goes through, is a finding.
 */

/** One thing a person's browser asked of a server while they used the product, and what came back. */
export interface Asked {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  status: number;
  answer: string;
  /** True for what the page's own script asked for (a fetch): a page or a file is the same for everyone far more often. */
  byScript?: boolean;
}

export interface Finding {
  who: 'nobody' | 'another person';
  method: string;
  url: string;
  status: number;
  /** What makes it a finding, as the owner reads it. */
  why: string;
}

export interface StrangersReport {
  /** What A's browser asked for and got: reads and changes. */
  reads: number;
  changes: number;
  /** Whether a second person was there to ask as. */
  withOther: boolean;
  /** Words only A's data holds, that were looked for in every answer given to someone else. */
  marks: string[];
  findings: Finding[];
  /** Addresses that answered someone else and were declared open to everyone. */
  open: string[];
  /** What was asked again or tried, so that whoever reads the result can see what it covered. */
  asked: string[];
  /** The step of a walk that could not be done: nothing can be said until it can. */
  stopped: string | null;
}

export interface StrangersOptions {
  /** What A does: sign in, and use the product so that it asks for and changes A's things. */
  as: Step[];
  /** What B does to sign in. Without it only "nobody" is asked as. */
  other?: Step[];
  /** Headers that are A's session or B's, when signing in cannot be done by steps (`authorization: Bearer ...`). */
  asHeaders?: Record<string, string>;
  otherHeaders?: Record<string, string>;
  /** Words only A's data holds. What A typed and B did not is added to these. */
  marks?: string[];
  /** Paths (their beginnings) that are meant to answer everyone. */
  open?: string[];
  /** Ask again only for what reads: for an address people are using. */
  readsOnly?: boolean;
  /** How long a step may take before the walk is said to have stopped there. */
  stepTimeoutMs?: number;
  browser?: Browser;
}

const STATIC = new Set(['script', 'stylesheet', 'image', 'font', 'media', 'manifest', 'texttrack', 'websocket', 'eventsource', 'ping', 'cspreport']);
const SESSION = /(^|\/)(auth|login|logout|signin|signup|sign-in|sign-up|sign_in|sign_up|token|otp|verify|session|sessions|callback|magiclink|recover|register)(\/|$|\?)/i;
const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const typed = (steps: readonly Step[]): string[] => steps.filter((step) => step.startsWith('type:') && step.includes('=')).map((step) => step.slice(step.indexOf('=') + 1));

/** The words that tell A's data from anyone else's: given, or typed by A alone, and long enough not to be found by chance. */
export function marksOf(as: readonly Step[], other: readonly Step[], given: readonly string[] = []): string[] {
  const others = new Set(typed(other));
  return [...new Set([...given, ...typed(as).filter((text) => !others.has(text))])].filter((text) => text.trim().length >= 6);
}

/** Uses the product in a browser of its own and keeps what the page asked of a server. */
async function use(browser: Browser, origin: string, steps: readonly Step[], headers: Record<string, string>, patience: number, beforeChange?: (ask: Omit<Asked, 'status' | 'answer'>) => Promise<void>): Promise<{ asked: Asked[]; context: BrowserContext; stopped: string | null }> {
  const context = await browser.newContext({ ...SIZES.phone.context, extraHTTPHeaders: headers });
  const asked: Asked[] = [];
  const pending: Promise<void>[] = [];
  // What was asked for and never answered to the page: a file that was downloaded leaves no answer to read.
  const unanswered = new Map<object, Omit<Asked, 'status' | 'answer'>>();
  context.on('request', (request) => {
    if (STATIC.has(request.resourceType()) || request.method() !== 'GET') return;
    pending.push(
      request
        .allHeaders()
        .catch(() => ({}) as Record<string, string>)
        .then((headers) => void unanswered.set(request, { method: 'GET', url: request.url(), headers, body: null })),
    );
  });
  // A change is tried as the others before the person's own goes through: afterwards the thing may be gone
  // (they removed it), and asking again would say nothing.
  if (beforeChange) {
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!STATIC.has(request.resourceType()) && CHANGES.has(request.method())) await beforeChange({ method: request.method(), url: request.url(), headers: await request.allHeaders().catch(() => ({}) as Record<string, string>), body: request.postData() }).catch(() => undefined);
      await route.continue().catch(() => undefined);
    });
  }
  context.on('response', (response) => {
    const request = response.request();
    // Everything the page asked a server for, but the files every visitor is given alike (scripts, styles,
    // pictures, fonts). A page drawn on the server and a file that is downloaded hold a person's data as much as
    // an answer to a fetch does (the first product with a download had its export go unasked).
    if (STATIC.has(request.resourceType())) return;
    pending.push(
      (async () => {
        const all = await request.allHeaders().catch(() => ({}) as Record<string, string>);
        const answer = await response.text().catch(() => '');
        asked.push({ method: request.method(), url: request.url(), headers: all, body: request.postData(), status: response.status(), answer: answer.slice(0, 1024 * 1024), byScript: ['xhr', 'fetch'].includes(request.resourceType()) });
        unanswered.delete(request);
      })(),
    );
  });
  // A download: the browser took the file and the page was told the request was given up.
  context.on('requestfailed', (request) => {
    if (!/ERR_ABORTED/.test(request.failure()?.errorText ?? '')) unanswered.delete(request);
  });
  const page: Page = await context.newPage();
  // A file the browser downloads is taken outside the page: the page's own record of what it asked never
  // shows it. Its address is kept here, and the file is not saved.
  const downloaded: string[] = [];
  context.on('page', (opened) => opened.on('download', (file) => (downloaded.push(file.url()), void file.cancel().catch(() => undefined))));
  page.on('download', (file) => (downloaded.push(file.url()), void file.cancel().catch(() => undefined)));
  let stopped: string | null = null;
  await page.goto(origin, { waitUntil: 'load', timeout: 30_000 }).catch(() => undefined);
  await quiet(page);
  await Promise.all(pending);
  // Opening the product is not using it: the page everyone is given on arriving is not something to ask again.
  const arriving = asked.findIndex((ask) => ask.method === 'GET' && !ask.byScript && ask.url.split('#')[0] === page.url().split('#')[0]);
  if (arriving >= 0) asked.splice(arriving, 1);
  for (const step of steps) {
    const why = await doStep(page, step, patience);
    if (why !== null) {
      stopped = `${step}: ${why}`;
      break;
    }
  }
  await quiet(page);
  await page.waitForTimeout(400);
  await Promise.all(pending);
  await Promise.all(pending);
  // What the first person was given as a file is asked for again like anything else; what it held is not known
  // here, so it is judged by what only they stored.
  for (const left of unanswered.values()) if (!asked.some((ask) => ask.method === left.method && ask.url === left.url)) asked.push({ ...left, status: 200, answer: '' });
  for (const url of downloaded) if (/^https?:/.test(url) && !asked.some((ask) => ask.method === 'GET' && ask.url === url)) asked.push({ method: 'GET', url, headers: {}, body: null, status: 200, answer: '' });
  return { asked, context, stopped };
}

/** The headers that say who is asking. Everything else of a request is the same whoever asks. */
const WHO = new Set(['cookie', 'authorization', 'x-csrf-token', 'x-xsrf-token']);
const NOT_SENT = new Set(['host', 'content-length', 'connection', 'accept-encoding', 'origin', 'referer']);

async function askAs(asked: Omit<Asked, 'status' | 'answer'>, who: { cookie: string; authorization: string | null }): Promise<{ status: number; answer: string }> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(asked.headers)) if (!name.startsWith(':') && !WHO.has(name.toLowerCase()) && !NOT_SENT.has(name.toLowerCase()) && !name.toLowerCase().startsWith('sec-')) headers[name] = value;
  if (who.cookie) headers.cookie = who.cookie;
  if (who.authorization && asked.headers.authorization) headers.authorization = who.authorization;
  try {
    const res = await fetch(asked.url, { method: asked.method, headers, ...(asked.body !== null && asked.method !== 'GET' && asked.method !== 'HEAD' ? { body: asked.body } : {}), redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    return { status: res.status, answer: (await res.text()).slice(0, 1024 * 1024) };
  } catch {
    return { status: 0, answer: '' };
  }
}

const pathOf = (url: string): string => {
  const at = new URL(url);
  return `${at.pathname}${at.search ? `?${at.search.slice(1, 60)}` : ''}`;
};
const ok = (status: number): boolean => status >= 200 && status < 300;

export async function strangers(origin: string, opts: StrangersOptions): Promise<StrangersReport> {
  const browser = opts.browser ?? (await openBrowser());
  const marks = marksOf(opts.as, opts.other ?? [], opts.marks ?? []);
  const open = opts.open ?? [];
  const isOpen = (url: string): boolean => open.some((prefix) => new URL(url).pathname.startsWith(prefix));
  try {
    // The second person signs in first, so that they are there to try each change of the first person's.
    const withOther = (opts.other?.length ?? 0) > 0 || Object.keys(opts.otherHeaders ?? {}).length > 0;
    const patience = opts.stepTimeoutMs ?? 10_000;
    const b = withOther ? await use(browser, origin, opts.other ?? [], opts.otherHeaders ?? {}, patience) : null;
    if (b?.stopped) return { reads: 0, changes: 0, withOther, marks, findings: [], open: [], asked: [], stopped: `as the second person, ${b.stopped}` };

    const cookieOf = async (context: BrowserContext, url: string): Promise<string> => (await context.cookies(url)).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
    const bearerOf = (asks: Asked[], url: string): string | null => asks.filter((ask) => new URL(ask.url).origin === new URL(url).origin && ask.headers.authorization).at(-1)?.headers.authorization ?? null;
    const askers: { who: Finding['who']; as: (url: string) => Promise<{ cookie: string; authorization: string | null }> }[] = [
      { who: 'nobody', as: async () => ({ cookie: '', authorization: null }) },
      ...(b ? [{ who: 'another person' as const, as: async (url: string) => ({ cookie: await cookieOf(b.context, url), authorization: opts.otherHeaders?.authorization ?? bearerOf(b.asked, url) }) }] : []),
    ];

    const findings: Finding[] = [];
    const answeredOpen = new Set<string>();
    const tried = new Set<string>();
    /** A change of a thing that is there already: its address names the thing. */
    const ofAThing = (url: string): boolean => new URL(url).pathname.split('/').some((part) => /^\d+$/.test(part) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(part) || (part.length >= 12 && /\d/.test(part) && /[A-Za-z]/.test(part) && /^[\w-]+$/.test(part)));
    const tryChange = async (ask: Omit<Asked, 'status' | 'answer'>): Promise<void> => {
      const key = `${ask.method} ${ask.url} ${ask.body ?? ''}`;
      if (opts.readsOnly || SESSION.test(new URL(ask.url).pathname) || tried.has(key)) return;
      tried.add(key);
      for (const asker of askers) {
        // Making something new as oneself is what a second person may do. Changing or removing a thing of the
        // first person's is not, and nobody without a session makes or changes anything.
        if (asker.who === 'another person' && ask.method === 'POST' && !ofAThing(ask.url)) continue;
        const got = await askAs(ask, await asker.as(ask.url));
        if (!ok(got.status)) continue;
        if (isOpen(ask.url)) answeredOpen.add(new URL(ask.url).pathname);
        else findings.push({ who: asker.who, method: ask.method, url: ask.url, status: got.status, why: `${ask.method} ${pathOf(ask.url)} went through (${got.status}) for ${asker.who}, before the first person did it themselves: it ${ask.method === 'DELETE' ? 'removes' : ask.method === 'POST' ? 'makes or acts on' : 'changes'} a thing of theirs` });
      }
    };

    const a = await use(browser, origin, opts.as, opts.asHeaders ?? {}, patience, tryChange);
    // What the first person asked for and was given, once each. Signing in and out is not their data.
    const seen = new Set<string>();
    const reads = a.asked.filter((ask) => {
      const key = `${ask.method} ${ask.url}`;
      if (CHANGES.has(ask.method) || !ok(ask.status) || SESSION.test(new URL(ask.url).pathname) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    for (const ask of reads) {
      for (const asker of askers) {
        const got = await askAs(ask, await asker.as(ask.url));
        if (!ok(got.status)) continue;
        if (isOpen(ask.url)) {
          answeredOpen.add(new URL(ask.url).pathname);
          continue;
        }
        const path = `${ask.method} ${pathOf(ask.url)}`;
        const held = marks.filter((mark) => got.answer.includes(mark));
        if (held.length > 0) findings.push({ who: asker.who, method: ask.method, url: ask.url, status: got.status, why: `${path} gave ${asker.who} what only the first person stored (it holds "${held[0]!.slice(0, 40)}")` });
        // With nothing to mark the first person's data, an answer to their script that is the same for someone
        // else is taken for theirs. A page is not: the same page is given to everyone who opens the address.
        else if (marks.length === 0 && ask.byScript && ask.answer.length >= 20 && got.answer === ask.answer) findings.push({ who: asker.who, method: ask.method, url: ask.url, status: got.status, why: `${path} gave ${asker.who} exactly what it gave the first person (${ask.answer.length} characters)` });
      }
    }
    await a.context.close();
    await b?.context.close();
    const asked = [...new Set([...reads.map((ask) => `${ask.method} ${pathOf(ask.url)}`), ...[...tried].map((key) => `${key.split(' ')[0]} ${pathOf(key.split(' ')[1]!)}`)])];
    return { reads: reads.length, changes: tried.size, withOther, marks, findings, open: [...answeredOpen].sort(), asked, stopped: a.stopped ? `as the first person, ${a.stopped}` : null };
  } finally {
    if (!opts.browser) await closeBrowser(browser);
  }
}

export function renderStrangers(report: StrangersReport, origin: string): string {
  const found = report.findings.length > 0 ? `\n${report.findings.length} FINDING(S) before it stopped: someone else got at what the first person stored\n${report.findings.map((finding) => `  - ${finding.why}`).join('\n')}` : '';
  if (report.stopped !== null) return `${origin}: the walk stopped, so ${found ? 'not everything was asked' : 'nothing can be said'}: ${report.stopped}${found}`;
  const total = report.reads + report.changes;
  if (total === 0) return `${origin}: the first person's browser asked nothing of a server during the walk, so there was nothing to ask for again. Have the walk sign in and open, make and change something of that person's own.`;
  const lines = [
    `${origin}: the first person's browser asked a server for ${report.reads} thing(s) and made ${report.changes} change(s); each read was asked again, and each change tried first, as nobody (no session)${report.withOther ? ' and as a second person' : ''}`,
    report.marks.length > 0 ? `looked for in every answer: ${report.marks.map((mark) => `"${mark.slice(0, 40)}"`).join(', ')} (what only the first person stored)` : 'no words mark the first person\'s data (nothing they typed is theirs alone): answers were compared whole. Have the walk type something only they would have, or give --mark',
  ];
  lines.push(`asked again or tried (${report.asked.length}): ${report.asked.slice(0, 40).join(', ')}${report.asked.length > 40 ? ', …' : ''}`);
  if (!report.withOther) lines.push('nobody was there as a second person: whether one signed-in person can reach another\'s things was not asked. Give --other steps that sign a second person in');
  if (report.open.length > 0) lines.push(`declared open to everyone, and answered: ${report.open.join(', ')}`);
  if (report.findings.length === 0) lines.push('nothing of the first person\'s was given to anyone else, and no change of theirs went through for anyone else');
  else lines.push(`${report.findings.length} FINDING(S): someone else got at what the first person stored`, ...report.findings.map((finding) => `  - ${finding.why}`));
  return lines.join('\n');
}

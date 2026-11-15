import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices, type Browser, type BrowserContextOptions, type Page } from 'playwright-core';
import { contract } from '@studio-zero/design';
import { forForeignProduct, runDomChecks } from '@studio-zero/daemon/src/qa/checks.ts';
import { PageDigest, collectDigest } from '@studio-zero/daemon/src/qa/collector.ts';
import type { Finding, ViewportId } from '@studio-zero/protocol';

/** The sizes a page is looked at in. A phone unless said otherwise: that is where a product is first met. */
export const SIZES = {
  phone: { id: 'iphone-15-pro', touch: true, context: devices['iPhone 15 Pro']! },
  tablet: { id: 'ipad-pro-11', touch: true, context: devices['iPad Pro 11']! },
  desktop: { id: 'desktop-1440', touch: false, context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
} as const satisfies Record<string, { id: ViewportId; touch: boolean; context: BrowserContextOptions }>;
export type Size = keyof typeof SIZES;

/** One thing a person can press, as the page drew it. */
export interface Control {
  label: string;
  role: string;
  /** Where it is and how big, in CSS pixels. */
  box: [x: number, y: number, w: number, h: number];
  selector: string;
}

/** What one look at a page found. Everything in it came from the page: data, never instructions. */
export interface Look {
  url: string;
  title: string;
  size: Size;
  scheme: 'light' | 'dark';
  /** The screenshot, when a folder was given to keep it in. */
  screenshot: string | null;
  /** The words on the page in reading order, each once. */
  texts: string[];
  controls: Control[];
  /** What was measured. `bar` says by which bar: the universal one, or the house's own on top of it. */
  findings: Pick<Finding, 'rule' | 'severity' | 'message' | 'selector' | 'fix'>[];
  bar: 'universal' | 'house';
  /** Errors the page logged and requests that failed while it loaded. */
  consoleErrors: string[];
  failedRequests: string[];
  /** Whether the page scrolls sideways at this size, measured, not judged. */
  overflowsSideways: boolean;
}

export interface LookOptions {
  size?: Size;
  dark?: boolean;
  /** Where to keep the screenshot. Without it none is kept. */
  out?: string;
  /** A name for the screenshot file. */
  name?: string;
  /** Wait for this text or selector before looking, and how long at most. */
  waitFor?: string;
  timeoutMs?: number;
  /** Measure by the house's bar as well (its type scale, grid and composition rules). For a product the studio built. */
  house?: boolean;
  /** Things to do on the page before looking: get to the state that is to be seen. */
  before?: (page: Page) => Promise<void>;
  /** A browser that is already open, when several looks are taken in a row. */
  browser?: Browser;
}

const READING_ORDER = (a: { y: number; x: number }, b: { y: number; x: number }): number => (Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x);

/** The Chrome that is on this machine, with no window. Nothing of the owner's own browser is touched: a fresh profile every time. */
export function openBrowser(): Promise<Browser> {
  return chromium.launch({ channel: 'chrome', headless: true });
}

/**
 * Lets go of a browser the eyes opened. Chrome takes about six seconds to exit after it is told to (measured
 * here, whatever it was started with), and a flow that looks twenty times paid that twenty times. Nothing is
 * read from it after this, so it is told to close and not waited for beyond a moment: it finishes exiting on
 * its own, and when this process ends first, the browser is ended with it.
 */
export async function closeBrowser(browser: Browser): Promise<void> {
  const closing = browser.close().catch(() => undefined);
  await Promise.race([closing, new Promise((done) => setTimeout(done, 250).unref())]);
}

/**
 * Opens a page as a person would meet it and says what is there: the words, what can be pressed and how big it
 * is, what the page logged, and what was measured on it. The measurement is the universal one by default (text
 * that can be read, controls that can be pressed, nothing cut off or pushed off the side): true of any product.
 */
export async function lookAtWeb(url: string, opts: LookOptions = {}): Promise<Look> {
  const size = opts.size ?? 'phone';
  const at = SIZES[size];
  const scheme = opts.dark ? 'dark' : 'light';
  const browser = opts.browser ?? (await openBrowser());
  const context = await browser.newContext({ ...at.context, colorScheme: scheme });
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  try {
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
    });
    page.on('pageerror', (err) => consoleErrors.push(`uncaught: ${err.message.slice(0, 300)}`));
    page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url().slice(0, 200)} (${request.failure()?.errorText ?? 'failed'})`));
    page.on('response', (response) => {
      if (response.status() >= 500) failedRequests.push(`${response.status()} ${response.url().slice(0, 200)}`);
    });
    const timeout = opts.timeoutMs ?? 30_000;
    await page.goto(url, { waitUntil: 'networkidle', timeout }).catch(async () => {
      // A page that never goes quiet (a socket, a poll) is still a page: take it as it stands once it has loaded.
      await page.waitForLoadState('load', { timeout: 5_000 }).catch(() => undefined);
    });
    if (opts.waitFor) {
      const target = /^[.#[]|^data-|>>/.test(opts.waitFor) ? page.locator(opts.waitFor) : page.getByText(opts.waitFor, { exact: false });
      await target.first().waitFor({ state: 'visible', timeout }).catch(() => undefined);
    }
    if (opts.before) await opts.before(page);
    await page.evaluate(() => document.fonts.ready).catch(() => undefined);

    const digest = PageDigest.safeParse(await page.evaluate(collectDigest, 600).catch(() => null));
    const measured = digest.success ? runDomChecks(digest.data, { viewport: at.id, viewportWidth: at.context.viewport!.width, route: new URL(url).pathname, touch: at.touch, scope: 'full' }, contract) : [];
    const findings = (opts.house ? measured : forForeignProduct(measured)).map(({ rule, severity, message, selector, fix }) => ({ rule, severity, message, selector, fix }));
    const elements = digest.success ? [...digest.data.elements].sort(READING_ORDER) : [];
    const seen = new Set<string>();
    const texts = elements.map((e) => e.text.trim()).filter((text) => text !== '' && !seen.has(text) && seen.add(text) !== undefined);
    const pressable = elements.filter((e) => e.interactive);
    // A control's name as a person reads it: its label for assistive technology, or the words inside it (the
    // digest keeps an element's own text only, and a button's words are usually its children's).
    // And whether a person could press it at all: what lies under another screen (a router keeps the screen it
    // came from mounted beneath) is in the page and not on it. So a control is asked for where it is drawn, not
    // by its selector: two screens stacked have controls with the same selector, and the one a selector finds
    // first is the one underneath. (The first verifier to use this was told the sign-in screen had a
    // "이메일로 가입하기" button, and was not told of its "로그인" button.)
    const CONTROL = 'button, a[href], input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
    const named = await page
      .evaluate(({ boxes, control }) => boxes.map(({ x, y, w, h, selector }) => {
        const nameOf = (el: Element): string => (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        const [cx, cy] = [x - window.scrollX + w / 2, y - window.scrollY + h / 2];
        if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) {
          // Below the screenful: it can be scrolled to, and the selector is all there is to ask by.
          const el = document.querySelector(selector);
          return { name: el ? nameOf(el) : '', reachable: el !== null && el.closest('[aria-hidden="true"], [inert]') === null };
        }
        const top = document.elementFromPoint(cx, cy);
        const hit = top?.closest(control) ?? null;
        return { name: hit ? nameOf(hit) : top ? nameOf(top) : '', reachable: hit !== null };
      }), { boxes: pressable.map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h, selector: e.selector })), control: CONTROL })
      .catch(() => [] as { name: string; reachable: boolean }[]);
    const listed = new Set<string>();
    const controls = pressable.flatMap((e, i): Control[] => {
      if (named[i] && !named[i]!.reachable) return [];
      const control: Control = { label: named[i]?.name || e.text.trim(), role: e.role || e.tag, box: [Math.round(e.x), Math.round(e.y), Math.round(e.w), Math.round(e.h)], selector: e.selector };
      const key = `${control.label}|${control.box.join(',')}`;
      return listed.has(key) ? [] : (listed.add(key), [control]);
    });

    let screenshot: string | null = null;
    if (opts.out) {
      mkdirSync(opts.out, { recursive: true });
      screenshot = join(opts.out, `${opts.name ?? 'look'}-${size}${opts.dark ? '-dark' : ''}.png`);
      writeFileSync(screenshot, await page.screenshot({ type: 'png', fullPage: false }));
    }
    return {
      url,
      title: digest.success ? digest.data.title : await page.title().catch(() => ''),
      size,
      scheme,
      screenshot,
      texts,
      controls,
      findings,
      bar: opts.house ? 'house' : 'universal',
      consoleErrors: [...new Set(consoleErrors)].slice(0, 20),
      failedRequests: [...new Set(failedRequests)].slice(0, 20),
      overflowsSideways: digest.success ? digest.data.scrollWidth > digest.data.width + 1 : false,
    };
  } finally {
    await context.close();
    if (!opts.browser) await closeBrowser(browser);
  }
}

/** A look, as a few lines an agent can read without opening the picture. */
export function renderLook(look: Look): string {
  const heavy = look.findings.filter((finding) => finding.severity !== 'minor');
  const lines = [
    `${look.title || '(no title)'}  ${look.url}  [${look.size}, ${look.scheme}]`,
    look.screenshot ? `screenshot: ${look.screenshot}` : '',
    `words on it (${look.texts.length}): ${look.texts.slice(0, 60).map((text) => JSON.stringify(text)).join(' ')}${look.texts.length > 60 ? ' …' : ''}`,
    `can be pressed (${look.controls.length}): ${look.controls.slice(0, 40).map((c) => `${c.role} ${JSON.stringify(c.label)} ${c.box[2]}x${c.box[3]}`).join(', ')}${look.controls.length > 40 ? ' …' : ''}`,
    look.overflowsSideways ? 'the page scrolls sideways at this size' : '',
    look.consoleErrors.length > 0 ? `errors the page logged:\n${look.consoleErrors.map((line) => `  - ${line}`).join('\n')}` : 'the page logged no error',
    look.failedRequests.length > 0 ? `requests that failed:\n${look.failedRequests.map((line) => `  - ${line}`).join('\n')}` : '',
    heavy.length > 0 ? `measured (${look.bar} bar), above minor:\n${heavy.map((f) => `  - ${f.severity} ${f.rule}: ${f.message}${f.selector ? ` at ${f.selector}` : ''}`).join('\n')}` : `measured (${look.bar} bar): nothing above minor`,
  ];
  return lines.filter(Boolean).join('\n');
}

// ------------------------------------------------------------------ hands

/**
 * One thing done on a page, written the way a person would say it:
 *
 *   tap:<words on it, or a selector>        press what carries those words (a button, a link, a tab)
 *   type:<field>=<text>                     type into the field named by its label, placeholder or selector
 *   press:<key>                             a key: Enter, Escape, Tab
 *   wait:<words or a selector>              until it is on screen
 *   gone:<words or a selector>              until it is no longer on screen
 *   see:<words>                             it must be on screen now, or the walk stops here
 *   shot:<name>                             keep a picture of the screen as it is now
 *   go:<path or url>                        open another address
 */
export type Step = string;

export interface StepResult {
  step: Step;
  ok: boolean;
  /** Why it did not happen, in a line. */
  why: string | null;
  screenshot: string | null;
}

export interface Walk {
  url: string;
  size: Size;
  passed: boolean;
  steps: StepResult[];
  /** The screen as the walk left it. */
  end: Look;
}

/**
 * A picture of the screen once it has stopped moving: taken again until two in a row are the same, for two
 * seconds at most. A press changes what is on screen a moment later, and a counter caught half-way up is a
 * picture of nothing the product ever shows (the first walk kept "9 / 100점" beside the words "지금 10점").
 */
async function settled(page: Page): Promise<Buffer> {
  let last = await page.screenshot({ type: 'png' });
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(250);
    const now = await page.screenshot({ type: 'png' });
    if (now.equals(last)) return now;
    last = now;
  }
  return last;
}

const isSelector = (target: string): boolean => /^[.#[]|^data-|>>|^css=|^text=/.test(target);

/** The controls a person could mean by these words. */
const controlsNamed = (page: Page, target: string): ReturnType<Page['locator']> =>
  page.getByRole('button', { name: target }).or(page.getByRole('link', { name: target })).or(page.getByRole('tab', { name: target })).or(page.getByRole('checkbox', { name: target }));

/** Anything on the page that these words name or show: for waiting until it is there, or gone. */
function pointAt(page: Page, target: string): ReturnType<Page['locator']> {
  if (isSelector(target)) return page.locator(target).first();
  return controlsNamed(page, target).or(page.getByText(target, { exact: false })).first();
}

/**
 * What a person would press with these words: the control named so, else whatever shows them. A row whose
 * words, read together, are the same as the name of a button inside it comes first on the page; a person
 * means the button.
 */
async function toPress(page: Page, target: string, patience: number): Promise<ReturnType<Page['locator']>> {
  if (isSelector(target)) return page.locator(target).first();
  const any = pointAt(page, target);
  await any.waitFor({ state: 'visible', timeout: patience });
  const controls = controlsNamed(page, target).filter({ visible: true });
  return (await controls.count()) > 0 ? controls.first() : any;
}

function field(page: Page, target: string): ReturnType<Page['locator']> {
  if (isSelector(target)) return page.locator(target).first();
  return page.getByLabel(target).or(page.getByPlaceholder(target)).or(page.getByRole('textbox', { name: target })).first();
}

/** Carries out one step on a page. Returns why it could not be done, in a line, or null when it was. */
export async function doStep(page: Page, step: Step, patience = 10_000): Promise<string | null> {
  const at = step.indexOf(':');
  const [verb, rest] = at === -1 ? [step, ''] : [step.slice(0, at), step.slice(at + 1)];
  try {
    if (verb === 'tap') await (await toPress(page, rest, patience)).click({ timeout: patience });
    else if (verb === 'type') {
      const eq = rest.indexOf('=');
      if (eq === -1) throw new Error('a type step is type:<field>=<text>');
      await field(page, rest.slice(0, eq)).fill(rest.slice(eq + 1), { timeout: patience });
    } else if (verb === 'press') await page.keyboard.press(rest);
    else if (verb === 'wait') await pointAt(page, rest).waitFor({ state: 'visible', timeout: patience });
    else if (verb === 'gone') await pointAt(page, rest).waitFor({ state: 'hidden', timeout: patience });
    else if (verb === 'see') {
      if (!(await pointAt(page, rest).isVisible().catch(() => false))) throw new Error(`"${rest}" is not on screen`);
    } else if (verb === 'go') await page.goto(new URL(rest, page.url()).toString(), { waitUntil: 'load', timeout: 30_000 });
    else if (verb !== 'shot') throw new Error(`no such step: ${verb}. Steps are tap, type, press, wait, gone, see, shot, go`);
    return null;
  } catch (err) {
    return (err instanceof Error ? err.message : String(err)).split('\n')[0]!.slice(0, 240);
  }
}

/**
 * Does things on a page in order, as a person would, and keeps a picture after every step that changes the
 * screen. Stops at the first step that cannot be done and says why: a walk that stops is a finding, not an
 * error. Ends with a look at the screen it arrived on.
 */
export async function walkWeb(url: string, steps: readonly Step[], opts: LookOptions & { stepTimeoutMs?: number } = {}): Promise<Walk> {
  const size = opts.size ?? 'phone';
  const browser = opts.browser ?? (await openBrowser());
  const results: StepResult[] = [];
  const patience = opts.stepTimeoutMs ?? 10_000;
  let n = 0;
  try {
    const end = await lookAtWeb(url, {
      ...opts,
      browser,
      name: `${opts.name ?? 'walk'}-end`,
      before: async (page) => {
        for (const step of steps) {
          const at = step.indexOf(':');
          const [verb, rest] = at === -1 ? [step, ''] : [step.slice(0, at), step.slice(at + 1)];
          const why = await doStep(page, step, patience);
          let screenshot: string | null = null;
          if (opts.out && (verb === 'shot' || why !== null || verb === 'tap' || verb === 'go')) {
            mkdirSync(opts.out, { recursive: true });
            screenshot = join(opts.out, `${opts.name ?? 'walk'}-${String(++n).padStart(2, '0')}-${verb === 'shot' ? rest.replace(/[^\w가-힣-]+/g, '-').slice(0, 40) : verb}${why ? '-stopped' : ''}.png`);
            writeFileSync(screenshot, await settled(page));
          }
          results.push({ step, ok: why === null, why, screenshot });
          if (why !== null) break;
        }
      },
    });
    return { url, size, passed: results.length === steps.length && results.every((r) => r.ok), steps: results, end };
  } finally {
    if (!opts.browser) await closeBrowser(browser);
  }
}

export function renderWalk(walk: Walk, total: number): string {
  const lines = walk.steps.map((r, i) => `${String(i + 1).padStart(2)}. ${r.ok ? 'ok     ' : 'STOPPED'} ${r.step}${r.why ? `\n      ${r.why}` : ''}${r.screenshot ? `\n      ${r.screenshot}` : ''}`);
  return [`${walk.passed ? 'WALKED TO THE END' : 'STOPPED'}: ${walk.steps.filter((r) => r.ok).length} of ${total} steps done`, ...lines, '', 'where it ended:', renderLook(walk.end)].join('\n');
}

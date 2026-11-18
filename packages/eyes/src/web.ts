import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices, type Browser, type BrowserContext, type BrowserContextOptions, type Locator, type Page } from 'playwright-core';
import { contract } from '@studio-zero/design';
import { forForeignProduct, runDomChecks } from '@studio-zero/daemon/src/qa/checks.ts';
import { PageDigest, collectDigest } from '@studio-zero/daemon/src/qa/collector.ts';
import type { Finding, ViewportId } from '@studio-zero/protocol';

/**
 * The sizes a page is looked at in. A phone unless said otherwise: that is where a product is first met.
 *
 * The phone is a current one at its whole screen (an iPhone 17: 402 by 874). The browser library's own figure for
 * a phone is what is left under a browser's bars (393 by 659 for the phone used before), and pictures taken at it
 * have the short shape of a phone from years ago: the owner said so of every picture shown to them. The id is the
 * name the studio's records have always given the phone's place, and stays.
 */
export const PHONE = { width: 402, height: 874 } as const;
export const SIZES = {
  phone: { id: 'iphone-15-pro', touch: true, context: { ...devices['iPhone 17']!, viewport: { ...PHONE }, screen: { ...PHONE } } },
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
  /**
   * Hold the page's time still and move it only with `run:` and `hold:` steps. For a game, or anything that
   * moves by itself: what it does in two seconds is then the same every time it is asked.
   */
  clock?: boolean;
  /** A browser that is already open, when several looks are taken in a row. */
  browser?: Browser;
}

const READING_ORDER = (a: { y: number; x: number }, b: { y: number; x: number }): number => (Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x);

/** How long a look waits for a loaded page to stop asking for things. */
export const QUIET_MS = 4_000;
export const quiet = (page: Page, ms = QUIET_MS): Promise<void> => page.waitForLoadState('networkidle', { timeout: ms }).catch(() => undefined);

/** How long `see` and `expect` let the screen catch up with what was just done before saying it is not so. */
const GLANCE_MS = 2_000;

/** Where a held clock starts: a fixed moment, so that a date a product shows is the same on every run. */
const CLOCK_START = Date.UTC(2026, 0, 1, 0, 0, 0);

/**
 * A session can be set to run its commands inside a sandbox (Claude Code's, macOS Seatbelt). No browser starts
 * in it: every Chromium registers a system service as it starts, the sandbox refuses that, and no setting of the
 * sandbox opens it (tried with every allowance its settings have). A session that met this wrote "error" in
 * its notes and warned that claims might stay unchecked; nothing was wrong with the product. So the failure is
 * recognised here and said for what it is, with what to do about it.
 */
export class SandboxError extends Error {}

const SANDBOXED = /ProcessSingleton|Failed to create socket directory|bootstrap_check_in[^\n]*Permission denied|MachPortRendezvous|mac_util\.mm[^\n]*Operation not permitted|CoreSimulatorService connection became invalid|not connected to CoreSimulatorService/;

/** The error to give instead, when what stopped a browser or an app from starting was the command sandbox; else null. */
export function stoppedBySandbox(err: unknown, what = 'the browser'): SandboxError | null {
  const text = err instanceof Error ? err.message : String(err);
  if (!SANDBOXED.test(text)) return null;
  return new SandboxError(
    `${what} could not start because this command ran inside the session's command sandbox, which refuses a system service it needs (no setting of the sandbox opens it). Nothing is wrong with the product. Run the same command again outside the sandbox: set dangerouslyDisableSandbox: true on the Bash call, and do so from the first try for every command that opens a browser, a desktop app, a simulator or Docker. If that call is refused, nobody was there to approve it: stop and tell the owner that looking at the product needs one of three things from them: sessions in auto mode, their approval of the unsandboxed command, or the sandbox turned off for this project (/sandbox). A look the sandbox stopped is not a verdict on any claim.`,
  );
}

/** The Chrome that is on this machine, with no window. Nothing of the owner's own browser is touched: a fresh profile every time. */
export async function openBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch (err) {
    throw stoppedBySandbox(err) ?? err;
  }
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

/** What is on a page as it stands: its words, what can be pressed, and what was measured on it. */
export async function describePage(page: Page, at: { viewport: ViewportId; width: number; touch: boolean; route: string }, house: boolean): Promise<Pick<Look, 'title' | 'texts' | 'controls' | 'findings' | 'overflowsSideways'>> {
  const digest = PageDigest.safeParse(await page.evaluate(collectDigest, 600).catch(() => null));
  const measured = digest.success ? runDomChecks(digest.data, { viewport: at.viewport, viewportWidth: at.width, route: at.route, touch: at.touch, scope: 'full' }, contract) : [];
  const findings = (house ? measured : forForeignProduct(measured)).map(({ rule, severity, message, selector, fix }) => ({ rule, severity, message, selector, fix }));
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
  return { title: digest.success ? digest.data.title : await page.title().catch(() => ''), texts, controls, findings, overflowsSideways: digest.success ? digest.data.scrollWidth > digest.data.width + 1 : false };
}

/** A browser context as a person at this size would have it: the device, its touch, and the light or dark scheme. */
export const openContext = (browser: Browser, size: Size, dark: boolean): Promise<BrowserContext> => browser.newContext({ ...SIZES[size].context, colorScheme: dark ? 'dark' : 'light' });

/**
 * What is measured on a page that is open and has settled, once its faces have loaded: the same for one look
 * and for a sweep of many screens, so that both say the same of the same screen.
 */
export async function measureOpen(page: Page, url: string, size: Size, house: boolean): Promise<Pick<Look, 'title' | 'texts' | 'controls' | 'findings' | 'overflowsSideways'>> {
  const at = SIZES[size];
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  return describePage(page, { viewport: at.id, width: at.context.viewport!.width, touch: at.touch, route: new URL(url).pathname }, house);
}

/** Where the picture of a look is kept: `<out>/<name>-<size>.png`, and `-dark` after it in the dark scheme. */
export const pictureFile = (out: string, name: string, size: Size, dark: boolean): string => join(out, `${name}-${size}${dark ? '-dark' : ''}.png`);

/** One measured finding, as a line. */
export const renderFinding = (f: Look['findings'][number]): string => `- ${f.severity} ${f.rule}: ${f.message}${f.selector ? ` at ${f.selector}` : ''}`;

/**
 * Opens a page as a person would meet it and says what is there: the words, what can be pressed and how big it
 * is, what the page logged, and what was measured on it. The measurement is the universal one by default (text
 * that can be read, controls that can be pressed, nothing cut off or pushed off the side): true of any product.
 */
export async function lookAtWeb(url: string, opts: LookOptions = {}): Promise<Look> {
  const size = opts.size ?? 'phone';
  const scheme = opts.dark ? 'dark' : 'light';
  const browser = opts.browser ?? (await openBrowser());
  const context = await openContext(browser, size, opts.dark ?? false);
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
    // With `clock` the page's time is held from its first instant and never runs by itself (see `startHeld`).
    // The hold is the first thing the clock is told: told to start and then to hold, it gives every later page
    // a start that differs by the milliseconds between the two.
    if (opts.clock) await page.clock.pauseAt(CLOCK_START);
    await page.goto(url, { waitUntil: 'load', timeout }).catch(() => undefined);
    if (opts.clock) {
      // Started a frame at a time, then on to a whole second: from here the page's own time stands at one
      // second after it opened (the next whole one, when it took longer to start), whatever the machine was doing.
      await startHeld(page, opts.waitFor ?? null, Date.now() + (opts.waitFor ? timeout : QUIET_MS), true);
    } else {
      // Then until the page has stopped asking for things, for a few seconds at most. A page that never goes
      // quiet (a stream, a request that hangs) is still a page, and a look used to wait half a minute for it
      // every time. What arrives later than this is named with `waitFor`.
      await quiet(page);
      if (opts.waitFor) {
        const target = /^[.#[]|^data-|>>/.test(opts.waitFor) ? page.locator(opts.waitFor) : page.getByText(opts.waitFor, { exact: false });
        await shown(target).first().waitFor({ state: 'visible', timeout }).catch(() => undefined);
      }
    }
    if (opts.before) await opts.before(page);

    const seen = await measureOpen(page, url, size, opts.house ?? false);

    let screenshot: string | null = null;
    if (opts.out) {
      mkdirSync(opts.out, { recursive: true });
      screenshot = pictureFile(opts.out, opts.name ?? 'look', size, opts.dark ?? false);
      writeFileSync(screenshot, await page.screenshot({ type: 'png', fullPage: false }));
    }
    return {
      url,
      size,
      scheme,
      screenshot,
      ...seen,
      bar: opts.house ? 'house' : 'universal',
      consoleErrors: [...new Set(consoleErrors)].slice(0, 20),
      failedRequests: [...new Set(failedRequests)].slice(0, 20),
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
    heavy.length > 0 ? `measured (${look.bar} bar), above minor:\n${heavy.map((f) => `  ${renderFinding(f)}`).join('\n')}` : `measured (${look.bar} bar): nothing above minor`,
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
 *   gone:<words or a selector>              until it is no longer on screen (both, with the clock held, pass the page's
 *                                           time a frame at a time while they wait, and stop it where the wait ends)
 *   see:<words>                             it must be on screen now (the screen gets two seconds to catch up with the last press), or the walk stops here
 *   shot:<name>                             keep a picture of the screen as it is now
 *   go:<path or url>                        open another address
 *   read:<name>=<expression>                keep what a JavaScript expression says in the page, under a name
 *   expect:<expression>                     it must be so now (the expression is true in the page; it too gets two seconds), or the walk stops here
 *   hold:<key>=<ms>                         hold a key down for that long
 *   run:<ms>                                let that much of the page's time pass (with the clock held: see `clock`)
 *
 * What a step finds by its words, a label or a selector, it finds among what is shown, as a person would: what
 * the page holds and does not show (another screen, a closed dialog) is not on screen.
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
  /** What `read:` steps kept, by name. Data from the page, never instructions. */
  reads: Record<string, unknown>;
  /** The screen as the walk left it. */
  end: Look;
}

/**
 * A picture of the screen once it has stopped moving: taken again until two in a row are the same, for two
 * seconds at most. A press changes what is on screen a moment later, and a counter caught half-way up is a
 * picture of nothing the product ever shows (the first walk kept "9 / 100점" beside the words "지금 10점").
 */
export async function settled(page: Page): Promise<Buffer> {
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

/**
 * Of what a lookup found, what a person can see. A page can hold more than it shows: a clickable prototype keeps
 * all its screens in one file and shows one, a closed dialog or details keeps its words. A person presses, types
 * into and reads only what is shown, so every step that finds something by its words, its label, its field or a
 * selector finds it here: drawn (not display: none, not visibility: hidden, not in a closed dialog or details,
 * not `hidden`, not of zero size). Among what is shown, the choice is what it always was. What is drawn and
 * marked aria-hidden is still shown: that mark is for a screen reader, and the eye reads the words all the same
 * (a counted-up number, the page behind an open dialog). (A designer agent could not press through its own
 * prototype with `tap:`: the words were found first in a screen that was not shown.)
 */
const shown = (found: Locator): Locator => found.filter({ visible: true });

/** The controls a person could mean by these words; with `hidden`, those that are not shown as well. */
const controlsNamed = (page: Page, target: string, hidden = false): Locator => {
  const by = { name: target, ...(hidden ? { includeHidden: true } : {}) };
  return page.getByRole('button', by).or(page.getByRole('link', by)).or(page.getByRole('tab', by)).or(page.getByRole('checkbox', by));
};

/** Everything on the page that these words name or show, or that the selector finds, shown or not. */
const named = (page: Page, target: string, hidden = false): Locator =>
  isSelector(target) ? page.locator(target) : controlsNamed(page, target, hidden).or(page.getByText(target, { exact: false }));

/** The fields these words name by their label or placeholder, or that the selector finds, shown or not. */
const fieldsNamed = (page: Page, target: string, hidden = false): Locator =>
  isSelector(target) ? page.locator(target) : page.getByLabel(target).or(page.getByPlaceholder(target)).or(page.getByRole('textbox', { name: target, ...(hidden ? { includeHidden: true } : {}) }));

/** The first thing shown that these words name or show: for waiting until it is there, or gone. */
const pointAt = (page: Page, target: string): Locator => shown(named(page, target)).first();

/**
 * What a person would press with these words: the control named so, else whatever shows them. A row whose
 * words, read together, are the same as the name of a button inside it comes first on the page; a person
 * means the button.
 */
async function toPress(page: Page, target: string, patience: number): Promise<Locator> {
  if (isSelector(target)) return pointAt(page, target);
  const any = pointAt(page, target);
  await any.waitFor({ state: 'visible', timeout: patience });
  const controls = shown(controlsNamed(page, target));
  return (await controls.count()) > 0 ? controls.first() : any;
}

const field = (page: Page, target: string): Locator => shown(fieldsNamed(page, target)).first();

/**
 * Why a step that looks for something did not find it, when what it looked for is on the page only where nothing
 * is shown: it stopped as it would if it were not there at all, and this says that it is, so that whoever reads
 * it knows why. Null when it is shown somewhere, or nowhere, or the step looks for nothing.
 */
async function foundOnlyHidden(page: Page, verb: string, rest: string): Promise<string | null> {
  const eq = rest.indexOf('=');
  const sought = verb === 'tap' || verb === 'wait' || verb === 'see' ? { what: `"${rest}"`, all: named(page, rest, true) } : verb === 'type' && eq > 0 ? { what: `the field "${rest.slice(0, eq)}"`, all: fieldsNamed(page, rest.slice(0, eq), true) } : null;
  if (!sought) return null;
  const [anywhere, onScreen] = await Promise.all([sought.all.count(), shown(sought.all).count()]).catch(() => [0, 0]);
  if (anywhere === 0 || onScreen > 0) return null;
  return `${sought.what} is not on screen: it was found only where nothing is shown (a screen or part of the page not shown, a closed dialog or details, hidden or of no size)`;
}

/** Carries out one step on a page. Returns why it could not be done, in a line, or null when it was. */
export async function doStep(page: Page, step: Step, patience = 10_000, more: { clock?: boolean; reads?: Record<string, unknown> } = {}): Promise<string | null> {
  const at = step.indexOf(':');
  const [verb, rest] = at === -1 ? [step, ''] : [step.slice(0, at), step.slice(at + 1)];
  const pass = async (ms: number): Promise<void> => {
    if (!Number.isFinite(ms) || ms < 0) throw new Error(`"${rest}" is not a time in milliseconds`);
    if (more.clock) await page.clock.runFor(ms);
    else await page.waitForTimeout(ms);
  };
  try {
    if (verb === 'tap') {
      const target = await toPress(page, rest, patience);
      try {
        await target.click({ timeout: Math.min(patience, 2_500) });
      } catch (err) {
        // Something lies over the words: a choice drawn as a chip is an invisible input over its label. A person
        // presses the place, and what is on top takes the press; so does this. Anything else that held the
        // press back (not there yet, not enabled) is waited for as before.
        if (!(err instanceof Error) || !err.message.includes('intercepts pointer events')) await target.click({ timeout: patience });
        else {
          await target.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined);
          const box = await target.boundingBox();
          if (!box) throw err;
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
      }
    }
    else if (verb === 'type') {
      const eq = rest.indexOf('=');
      if (eq === -1) throw new Error('a type step is type:<field>=<text>');
      await field(page, rest.slice(0, eq)).fill(rest.slice(eq + 1), { timeout: patience });
    } else if (verb === 'press') await page.keyboard.press(rest);
    else if (verb === 'wait') await pointAt(page, rest).waitFor({ state: 'visible', timeout: patience });
    else if (verb === 'gone') await pointAt(page, rest).waitFor({ state: 'hidden', timeout: patience });
    else if (verb === 'see') {
      // "Now" as a person means it: the screen is given a moment to catch up with the last press.
      await pointAt(page, rest)
        .waitFor({ state: 'visible', timeout: Math.min(GLANCE_MS, patience) })
        .catch(() => {
          throw new Error(`"${rest}" is not on screen`);
        });
    } else if (verb === 'go') await page.goto(new URL(rest, page.url()).toString(), { waitUntil: 'load', timeout: 30_000 });
    else if (verb === 'run') await pass(Number(rest));
    else if (verb === 'hold') {
      const eq = rest.lastIndexOf('=');
      if (eq < 1) throw new Error('a hold step is hold:<key>=<ms>');
      await page.keyboard.down(rest.slice(0, eq));
      await pass(Number(rest.slice(eq + 1))).finally(() => page.keyboard.up(rest.slice(0, eq)));
    } else if (verb === 'read') {
      const eq = rest.indexOf('=');
      if (eq < 1) throw new Error('a read step is read:<name>=<expression>');
      const value: unknown = await page.evaluate(rest.slice(eq + 1));
      if (more.reads) more.reads[rest.slice(0, eq)] = value;
    } else if (verb === 'expect') {
      const until = Date.now() + Math.min(GLANCE_MS, patience);
      let value: unknown = await page.evaluate(rest);
      while (!value && Date.now() < until) {
        await page.waitForTimeout(100);
        value = await page.evaluate(rest);
      }
      if (!value) throw new Error(`not so: ${rest} (it is ${JSON.stringify(value)})`);
    } else if (verb !== 'shot') throw new Error(`no such step: ${verb}. Steps are tap, type, press, hold, wait, gone, see, read, expect, run, shot, go`);
    return null;
  } catch (err) {
    const said = (err instanceof Error ? err.message : String(err)).split('\n')[0]!;
    return ((await foundOnlyHidden(page, verb, rest)) ?? said).slice(0, 240);
  }
}

/**
 * A page a walk opens while its time is held (`clock`) must still start as any page does. Playwright replays a
 * held clock into every new document, so a page reached by `go:` or by a press has its time held from its first
 * instant, and whatever its start-up waits on with a timer never comes: a React app shows a screen whose code
 * arrived late by a timer of up to 300 ms, and its page stayed blank (2026-11-18: a flow of four scenes, each a
 * `go:` and a `wait:`, walked to its end in 0 of 10 runs, at random and more often on a busy machine).
 *
 * So the eyes start every page themselves, the first one too: they move its time a frame at a time, at the
 * pace of real time, until what is waited for is on screen (`wait:` as the next step, `waitFor` for the first
 * page), or else until the page has stopped asking for things. The time is never let run by itself: every page
 * begins at the same tick and is moved by whole frames, so what is read afterwards is the same on every run.
 * And for a `wait:` it stops the moment the awaited thing is there, before the frame that would move it: what
 * starts with a screen (a face sliding in) is read where it started, and `run:<ms>` moves it by exactly that much.
 *
 * The same holds on a page that has already started: what a `wait:` waits for may need an answer from the
 * network and then a timer (a photograph sent, then the next screen), and with time standing still the timer
 * never came, whatever `run:` the flow had put before it. Waiting is time passing, so `wait:` and `gone:` pass it.
 */
type PageClock = { now(): number; performanceNow(): number; runFor(ms: number): Promise<void> };
const FRAME_MS = 16;

/**
 * One frame of a held page's time, in the page. Up to the last millisecond before the frame is due, then over
 * it, looking in between: something that appears in the first part has its own first frame still ahead of it,
 * and something that appears as the frame runs has a whole frame ahead. Says whether what is waited for is on
 * screen; "none" when the page has no clock of Playwright's.
 */
const frameInPage = async ({ target, selector, gone }: { target: string | null; selector: boolean; gone: boolean }): Promise<boolean | 'none'> => {
  const clock = (globalThis as unknown as { __pwClock?: { controller: PageClock } }).__pwClock?.controller;
  if (!clock) return 'none';
  const words = (target ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const onScreen = (): boolean => {
    try {
      if (target === null) return false;
      if (!selector) return (document.body?.innerText ?? '').replace(/\s+/g, ' ').toLowerCase().includes(words);
      const found = document.querySelector(target);
      if (!found) return false;
      const box = found.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(found).visibility !== 'hidden';
    } catch {
      return false;
    }
  };
  const there = (): boolean => target !== null && onScreen() !== gone;
  if (there()) return true;
  const phase = Math.ceil(clock.performanceNow()) % 16;
  if (phase < 15) await clock.runFor(15 - phase);
  if (there()) return true;
  await clock.runFor(1);
  return there();
};

/**
 * Moves a held page's time a frame at a time, at the pace of real time: until `target` is on screen (or, with
 * `gone`, no longer on screen), which it answers with true, or, with no target, until the page has stopped
 * asking for things. Gives up at `until` (false). What Playwright itself calls visible has the last word on
 * `target`: the page's own look at its words is quicker and can miss a name that is only read out.
 */
async function startHeld(page: Page, target: string | null, until: number, toWholeSecond = false, gone = false): Promise<boolean> {
  // Quiet is counted from here, not asked of Playwright: a page that has not started is quiet already.
  let asking = 0;
  let lastAsked = Date.now();
  const asked = (): void => void (asking++, (lastAsked = Date.now()));
  const answered = (): void => void ((asking = Math.max(0, asking - 1)), (lastAsked = Date.now()));
  page.on('request', asked).on('requestfinished', answered).on('requestfailed', answered);
  let shown = false;
  let trust = true;
  try {
    for (let n = 0; Date.now() < until && !(target === null && asking === 0 && Date.now() - lastAsked >= 500); n++) {
      const began = Date.now();
      const said = await page.evaluate(frameInPage, { target: trust ? target : null, selector: target !== null && isSelector(target), gone }).catch(() => false as const);
      if (said === 'none') break;
      if (target !== null && (said === true || n % 8 === 7)) {
        shown = (await pointAt(page, target).isVisible().catch(() => false)) !== gone;
        if (shown) break;
        if (said === true) trust = false;
      }
      await new Promise((next) => setTimeout(next, Math.max(0, FRAME_MS - (Date.now() - began))));
    }
  } finally {
    page.off('request', asked).off('requestfinished', answered).off('requestfailed', answered);
  }
  if (toWholeSecond) {
    await page
      .evaluate(async () => {
        const clock = (globalThis as unknown as { __pwClock?: { controller: PageClock } }).__pwClock?.controller;
        if (!clock) return;
        const now = Math.ceil(clock.performanceNow());
        const second = Math.max(1_000, Math.ceil(now / 1_000) * 1_000);
        if (second > now) await clock.runFor(second - now);
      })
      .catch(() => undefined);
  }
  // Into Playwright's own record of the clock: the next page goes on from this time, not from an earlier one.
  const at = await page.evaluate(() => Date.now()).catch(() => null);
  if (at !== null) await page.clock.pauseAt(at).catch(() => undefined);
  return target === null ? true : shown;
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
  const reads: Record<string, unknown> = {};
  const patience = opts.stepTimeoutMs ?? 10_000;
  let n = 0;
  try {
    const end = await lookAtWeb(url, {
      ...opts,
      browser,
      name: `${opts.name ?? 'walk'}-end`,
      before: async (page) => {
        const parts = (step: Step | undefined): [string, string] => {
          const at = step === undefined ? -1 : step.indexOf(':');
          return step === undefined ? ['', ''] : at === -1 ? [step, ''] : [step.slice(0, at), step.slice(at + 1)];
        };
        // With time held: a page the walk has opened and not yet started (see `startHeld`).
        let fresh = false;
        if (opts.clock) page.on('domcontentloaded', () => (fresh = true));
        for (const step of steps) {
          const [verb, rest] = parts(step);
          let why: string | null;
          if (opts.clock && (verb === 'wait' || verb === 'gone')) {
            // Waiting is time passing: with time held, the walk passes it, and stops where the wait ends.
            fresh = false;
            const came = await startHeld(page, rest, Date.now() + patience, false, verb === 'gone');
            why = came ? null : ((await foundOnlyHidden(page, verb, rest)) ?? `"${rest}" ${verb === 'gone' ? 'was still on screen' : 'did not come on screen'} after ${patience / 1000} s (the page's time is held, and was moved a frame at a time while the walk waited)`).slice(0, 240);
          } else {
            if (fresh) {
              fresh = false;
              await startHeld(page, null, Date.now() + QUIET_MS);
            }
            why = await doStep(page, step, patience, { ...(opts.clock ? { clock: true } : {}), reads });
          }
          let screenshot: string | null = null;
          if (verb === 'shot' || why !== null || verb === 'tap' || verb === 'go' || verb === 'hold') {
            // What an action sets going is let finish before the next step looks, whether or not a picture is
            // kept: a `see` straight after a `tap` would otherwise read the screen as it was before the press.
            const png = await settled(page);
            if (opts.out) {
              mkdirSync(opts.out, { recursive: true });
              screenshot = join(opts.out, `${opts.name ?? 'walk'}-${String(++n).padStart(2, '0')}-${verb === 'shot' ? rest.replace(/[^\w가-힣-]+/g, '-').slice(0, 40) : verb}${why ? '-stopped' : ''}.png`);
              writeFileSync(screenshot, png);
            }
          }
          results.push({ step, ok: why === null, why, screenshot });
          if (why !== null) break;
        }
        // A page opened by the last step is started too: the look that follows is of a page, not of a blank.
        if (fresh) await startHeld(page, null, Date.now() + QUIET_MS);
      },
    });
    return { url, size, passed: results.length === steps.length && results.every((r) => r.ok), steps: results, reads, end };
  } finally {
    if (!opts.browser) await closeBrowser(browser);
  }
}

export function renderWalk(walk: Walk, total: number): string {
  const lines = walk.steps.map((r, i) => `${String(i + 1).padStart(2)}. ${r.ok ? 'ok     ' : 'STOPPED'} ${r.step}${r.why ? `\n      ${r.why}` : ''}${r.screenshot ? `\n      ${r.screenshot}` : ''}`);
  const read = Object.entries(walk.reads).map(([name, value]) => `read ${name}: ${JSON.stringify(value)?.slice(0, 600)}`);
  return [`${walk.passed ? 'WALKED TO THE END' : 'STOPPED'}: ${walk.steps.filter((r) => r.ok).length} of ${total} steps done`, ...lines, ...read, '', 'where it ended:', renderLook(walk.end)].join('\n');
}

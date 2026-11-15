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
    const names = await page
      .evaluate((selectors) => selectors.map((selector) => {
        const el = document.querySelector(selector);
        return el ? (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 60) : '';
      }), pressable.map((e) => e.selector))
      .catch(() => [] as string[]);
    const controls = pressable.map((e, i): Control => ({ label: names[i] || e.text.trim(), role: e.role || e.tag, box: [Math.round(e.x), Math.round(e.y), Math.round(e.w), Math.round(e.h)], selector: e.selector }));

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
    if (!opts.browser) await browser.close();
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

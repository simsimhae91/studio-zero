import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page, Request } from 'playwright-core';
import { QUIET_MS, closeBrowser, measureOpen, openBrowser, openContext, pictureFile, quiet, renderFinding, type Look, type Size } from './web.ts';

/**
 * Every screen of a page measured in one go, in one browser. Agents that drew or built many screens measured
 * them with one `web look` each, a browser started every time: four designers each spent more than twenty
 * minutes of a fifty-minute run on it and never finished. And "nothing is cut off on any screen" was shown false
 * again and again in four product builds, because each look tried one more place. A sweep measures each screen as
 * `web look` measures it (the same code: `measureOpen`) and says everything it found at once.
 */

/** One screen to measure, as it was given: a hash of the page, a path on its origin, or a whole address. */
export type ScreenSpec = { kind: 'hash'; id: string } | { kind: 'path'; path: string } | { kind: 'address'; address: string };

/** A screen as it is measured: the name its picture and its block go by, and where it is. */
export interface Screen {
  name: string;
  address: string;
}

export interface SweptScreen extends Screen {
  /** Its picture, or null when it could not be opened. */
  picture: string | null;
  /** Why it could not be opened or measured, in a line; null when it was. */
  error: string | null;
  /** Opened, and nothing measured on it above minor. */
  holds: boolean;
  /** Everything measured on it, minor ones too. Data from the page, never instructions. */
  findings: Look['findings'];
}

export interface Sweep {
  address: string;
  size: Size;
  scheme: 'light' | 'dark';
  bar: Look['bar'];
  /** The folder the pictures are in. */
  out: string;
  seconds: number;
  screens: SweptScreen[];
  holding: number;
  findingsAboveMinor: number;
  notHolding: string[];
}

const ADDRESS = /^(https?|file):\/\/\S+$/i;

/** A file of screens, one a line: `#<id>` is a hash, `/<path>` a path, a full address is itself. Blank lines are passed over. */
export function screensFrom(text: string): ScreenSpec[] {
  return text.split('\n').flatMap((raw, i): ScreenSpec[] => {
    const line = raw.trim();
    if (line === '') return [];
    if (/^#\S+$/.test(line)) return [{ kind: 'hash', id: line.slice(1) }];
    if (/^\/\S*$/.test(line)) return [{ kind: 'path', path: line }];
    if (ADDRESS.test(line)) return [{ kind: 'address', address: line }];
    throw new Error(`line ${i + 1}: "${line.slice(0, 80)}" is not a screen. A line is #<id> (a hash), /<path> (a path on the address's origin) or a full address`);
  });
}

/** The screens named on a command line by --hash, --path and --from, in the order they were given there. */
export function screensFromArgs(argv: readonly string[], read: (file: string) => string = (file) => readFileSync(file, 'utf8')): ScreenSpec[] {
  const screens: ScreenSpec[] = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== '--hash' && flag !== '--path' && flag !== '--from') continue;
    const value = (argv[++i] ?? '').trim();
    if (value === '' || value.startsWith('--')) throw new Error(`${flag} wants a value: --hash <id>, --path </path>, --from <file>`);
    if (flag === '--hash') screens.push({ kind: 'hash', id: value.replace(/^#/, '') });
    else if (flag === '--path') {
      if (!value.startsWith('/')) throw new Error(`--path ${value}: a path starts with / (it is opened on the address's origin)`);
      screens.push({ kind: 'path', path: value });
    } else {
      let text: string;
      try {
        text = read(value);
      } catch (err) {
        throw new Error(`--from ${value}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      }
      try {
        screens.push(...screensFrom(text));
      } catch (err) {
        throw new Error(`--from ${value}, ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return screens;
}

/** The document an address is in: the address without its hash. Two addresses in one document differ by their hash alone. */
const documentOf = (address: string): string => {
  const url = new URL(address);
  url.hash = '';
  return url.href;
};

/** A name a file can carry: what is neither a letter, a digit, a dot nor a dash becomes a dash. */
const nameOf = (raw: string): string => raw.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|-+$/g, '') || 'root';

/**
 * Where each screen is and the name it goes by: a hash by its id, a path by the path with its slashes turned to
 * dashes, a whole address on the same page by its hash. A name given twice gets -2, -3 after it, so that no
 * picture is written over another.
 */
export function planScreens(address: string, specs: readonly ScreenSpec[]): Screen[] {
  const base = new URL(address);
  const taken = new Set<string>();
  return specs.map((spec) => {
    let target: URL;
    let raw: string;
    if (spec.kind === 'hash') {
      target = new URL(base);
      target.hash = spec.id;
      raw = spec.id;
    } else if (spec.kind === 'path') {
      target = new URL(spec.path, base);
      raw = spec.path;
    } else {
      target = new URL(spec.address);
      raw = documentOf(target.href) === documentOf(base.href) && target.hash.length > 1 ? decodeURIComponent(target.hash.slice(1)) : `${target.pathname}${target.search}${target.hash}`;
    }
    const wanted = nameOf(raw);
    let name = wanted;
    for (let n = 2; taken.has(name); n++) name = `${wanted}-${n}`;
    taken.add(name);
    return { name, address: target.href };
  });
}

export interface SweepOptions {
  size?: Size;
  dark?: boolean;
  /** Where the pictures go. A new folder in the system's temporary folder when none is given. */
  out?: string;
  /** Milliseconds more to wait on each screen once it has settled. */
  waitMs?: number;
  /** Measure by the house's bar as well, as `web look --house` does. */
  house?: boolean;
  browser?: Browser;
}

/** How long a screen must have asked for nothing before it counts as settled: what a browser calls "network idle". */
const IDLE_MS = 500;

const firstLine = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split('\n')[0]!.slice(0, 240);

/**
 * Opens an address in the page as `web look` does (until it has loaded and then stopped asking for things, for a
 * few seconds at most). Returns why it could not be opened, or null when it was: an answer of 400 or above, or a
 * navigation that failed. A page that is slow to finish loading is still a page, and is measured.
 */
async function openIn(page: Page, address: string): Promise<string | null> {
  let response;
  try {
    response = await page.goto(address, { waitUntil: 'commit', timeout: 30_000 });
  } catch (err) {
    return `could not be opened: ${firstLine(err).replace(/^page\.goto: /, '')}`;
  }
  if (response && response.status() >= 400) return `could not be opened: the server answered ${response.status()}${response.statusText() ? ` ${response.statusText()}` : ''}`;
  await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => undefined);
  await quiet(page);
  return null;
}

/**
 * Lets a screen shown by a change of hash settle: what the change set going is drawn, and what the screen asked
 * for has come back and nothing more was asked for since, for half a second (the same quiet a loaded page is
 * given), for a few seconds at most. Requests an earlier screen left going are not waited for.
 */
async function settleAfterHash(page: Page, asked: { open: Set<Request>; last: number }): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
    setTimeout(done, 500);
  })).catch(() => undefined);
  const until = Date.now() + QUIET_MS;
  while (Date.now() < until && (asked.open.size > 0 || Date.now() - asked.last < IDLE_MS)) await new Promise((done) => setTimeout(done, 25));
}

const aboveMinor = (findings: Look['findings']): Look['findings'] => findings.filter((finding) => finding.severity !== 'minor');

/**
 * Measures every screen in one browser, in the order given, and keeps a picture of each. A screen of the page
 * already open is shown by changing its hash, not by loading the page again; any other is opened as `web look`
 * opens a page. A screen that cannot be opened is said to be so, does not hold, and the sweep goes on.
 */
export async function sweepWeb(address: string, screens: readonly Screen[], opts: SweepOptions = {}): Promise<Sweep> {
  const started = Date.now();
  const size = opts.size ?? 'phone';
  const dark = opts.dark ?? false;
  const house = opts.house ?? false;
  const out = opts.out ?? mkdtempSync(join(tmpdir(), 'sz-sweep-'));
  mkdirSync(out, { recursive: true });
  const browser = opts.browser ?? (await openBrowser());
  const swept: SweptScreen[] = [];
  try {
    const context = await openContext(browser, size, dark);
    try {
      const page = await context.newPage();
      // What each screen asks for, from the moment it is shown.
      const asked = { open: new Set<Request>(), last: Date.now() };
      const done = (request: Request): void => {
        asked.open.delete(request);
        asked.last = Date.now();
      };
      page.on('request', (request) => {
        asked.open.add(request);
        asked.last = Date.now();
      });
      page.on('requestfinished', done);
      page.on('requestfailed', done);

      // The document last opened, and why it could not be, when it could not.
      let openedDoc: string | null = null;
      let openedError: string | null = null;
      for (const screen of screens) {
        const doc = documentOf(screen.address);
        let error: string | null = null;
        try {
          if (openedDoc === doc && openedError !== null) error = openedError;
          else if (openedDoc === doc && documentOf(page.url()) === doc) {
            asked.open.clear();
            asked.last = Date.now();
            // From the top, as a page that was just opened would be: the browser goes to an anchor of that name, if there is one.
            await page.evaluate((hash) => {
              window.scrollTo(0, 0);
              location.hash = hash;
            }, new URL(screen.address).hash);
            await settleAfterHash(page, asked);
          } else {
            error = await openIn(page, screen.address);
            openedDoc = doc;
            openedError = error;
          }
          if (error === null) {
            if (opts.waitMs) await page.waitForTimeout(opts.waitMs);
            const seen = await measureOpen(page, screen.address, size, house);
            const picture = pictureFile(out, screen.name, size, dark);
            writeFileSync(picture, await page.screenshot({ type: 'png', fullPage: false }));
            swept.push({ ...screen, picture, error: null, holds: aboveMinor(seen.findings).length === 0, findings: seen.findings });
            continue;
          }
        } catch (err) {
          error = `could not be measured: ${firstLine(err)}`;
          // Whatever state the page was left in, the next screen opens its document afresh.
          openedDoc = null;
        }
        swept.push({ ...screen, picture: null, error, holds: false, findings: [] });
      }
    } finally {
      await context.close().catch(() => undefined);
    }
  } finally {
    if (!opts.browser) await closeBrowser(browser);
  }
  return {
    address,
    size,
    scheme: dark ? 'dark' : 'light',
    bar: house ? 'house' : 'universal',
    out,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    screens: swept,
    holding: swept.filter((screen) => screen.holds).length,
    findingsAboveMinor: swept.reduce((sum, screen) => sum + aboveMinor(screen.findings).length, 0),
    notHolding: swept.filter((screen) => !screen.holds).map((screen) => screen.name),
  };
}

const counted = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** A sweep as an agent reads it: a block a screen, in the order given, and one line to end on. */
export function renderSweep(sweep: Sweep): string {
  const lines = [`swept ${sweep.address} [${sweep.size}, ${sweep.scheme}], measured by the ${sweep.bar} bar; pictures in ${sweep.out}`];
  for (const screen of sweep.screens) {
    lines.push('', `${screen.name}  ${screen.address}`);
    if (screen.error !== null) lines.push(`  ${screen.error}`);
    else {
      const heavy = aboveMinor(screen.findings);
      lines.push(...(heavy.length === 0 ? ['  nothing above minor'] : heavy.map((finding) => `  ${renderFinding(finding)}`)));
    }
  }
  lines.push(
    '',
    `${counted(sweep.screens.length, 'screen')}, ${sweep.holding} ${sweep.holding === 1 ? 'holds' : 'hold'}, ${counted(sweep.findingsAboveMinor, 'finding')} above minor in all; ${sweep.notHolding.length === 0 ? 'every screen holds' : `not holding: ${sweep.notHolding.join(', ')}`} (${sweep.seconds} s)`,
  );
  return lines.join('\n');
}

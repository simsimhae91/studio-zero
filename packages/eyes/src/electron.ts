import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import { describePage, doStep, renderLook, settled, type Look, type Step, type StepResult } from './web.ts';

/**
 * Eyes and hands for a desktop app built on Electron: the app is started from its folder, its windows are
 * looked at and operated like pages, and it is closed again. Three things are kept from the owner's own use of
 * the same app on the same machine. Its data: the app is given a folder of its own for what it stores, so the
 * owner's real profile is never opened and a second copy can run beside theirs. Their screen: an Electron app
 * has no way to run without windows, so its windows are made invisible and take no click of the owner's
 * (measured: a window with no opacity is still drawn and pictured in full). Their keyboard: it is driven
 * through the debugging protocol, and never becomes the app in front.
 */

export interface ElectronOptions {
  /**
   * More arguments for the app, and what its environment has besides this process's own. `{data}` in either is
   * replaced by the folder made for this run's data: an app that decides itself where it keeps its data is
   * pointed there by its own variable (`SIDE_USER_DATA={data}`).
   */
  args?: string[];
  env?: Record<string, string>;
  /** Words of the title or the address of the window to look at. The first window to open otherwise. */
  window?: string;
  out?: string;
  name?: string;
  house?: boolean;
  /**
   * A folder to keep the app's data in for this run, in place of a new one that is thrown away afterwards: what
   * one run stores is there for the next (the app closed and opened again), and a run can start from data put
   * there beforehand (a file in the shape an older version wrote). Never a folder where the owner's own apps
   * keep theirs.
   */
  data?: string;
  /** Show its windows on the owner's screen, as a person sees them. For an app whose layout follows the screen. */
  onscreen?: boolean;
  /** The Electron to run it with, when it is not the one installed in the app's own folder. */
  executablePath?: string;
  /** How long the app may take to open a window, and a step to be done. */
  timeoutMs?: number;
  stepTimeoutMs?: number;
}

/** A look at one window of the app, with which windows it had open and what its main process said. */
export interface AppLook extends Look {
  windows: string[];
  /** The size of the window that was looked at. */
  width: number;
  height: number;
  /** The last lines the app's main process wrote to its error stream. */
  mainLog: string[];
}

export interface AppWalk {
  app: string;
  passed: boolean;
  steps: StepResult[];
  reads: Record<string, unknown>;
  end: AppLook;
}

export class ElectronError extends Error {}

/** What is asked of a window to keep it off the owner's screen. (Electron's own types are not installed here.) */
type Quietable = { setOpacity(opacity: number): void; setIgnoreMouseEvents(ignore: boolean): void };

const describes = async (page: Page, words: string): Promise<boolean> => (await page.title().catch(() => '')).includes(words) || page.url().includes(words);

/** The window these words name, waited for until it opens. */
async function windowNamed(app: ElectronApplication, words: string, patience: number): Promise<Page> {
  const until = Date.now() + patience;
  for (;;) {
    for (const page of app.windows()) if (await describes(page, words)) return page;
    if (Date.now() > until) throw new ElectronError(`no window whose title or address has "${words}". Open: ${(await Promise.all(app.windows().map((page) => page.title().catch(() => '')))).map((title) => JSON.stringify(title)).join(', ') || '(none)'}`);
    await new Promise((done) => setTimeout(done, 150));
  }
}

/** The file Electron runs for an app folder: what its package.json names, or its index.js. */
function mainFile(folder: string): string | null {
  try {
    const named: unknown = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).main;
    const file = join(folder, typeof named === 'string' && named !== '' ? named : 'index.js');
    return existsSync(file) && statSync(file).isFile() && statSync(file).size < 30 * 1024 * 1024 ? file : null;
  } catch {
    return null;
  }
}

async function open(folder: string, opts: ElectronOptions): Promise<{ app: ElectronApplication; data: string; own: boolean; mainLog: string[] }> {
  let bin = opts.executablePath;
  if (!bin) {
    try {
      // The package's own entry answers with where its binary is.
      bin = createRequire(join(folder, 'package.json'))('electron') as string;
    } catch {
      throw new ElectronError(`electron is not installed in ${folder}: install the project's dependencies first (the map says how), or give --electron <its binary>`);
    }
  }
  // An app that sets its own data folder is not moved by the switch below: started as it is, it would open the
  // owner's real data. That is found before anything is started, in the file Electron is about to run.
  const points = [...(opts.args ?? []), ...Object.values(opts.env ?? {})].some((value) => value.includes('{data}'));
  const entry = mainFile(folder);
  if (!points && entry && /setPath\(\s*["'`]userData["'`]/.test(readFileSync(entry, 'utf8'))) {
    throw new ElectronError(
      `this app decides itself where it keeps its data (setPath('userData', ...) in ${entry}), so it cannot be given a folder of its own from outside: started as it is, it would open the owner's real data. Read next to that call which variable it takes the folder from, and give it: --env <THAT_VARIABLE>={data}. If it has none, it is not started here; say so.`,
    );
  }
  // A folder the caller keeps (to open the app twice on the same data), or a new one thrown away afterwards.
  const kept = opts.data ? resolve(opts.data) : null;
  if (kept) {
    const real = existsSync(kept) ? realpathSync(kept) : kept;
    if ([join(homedir(), 'Library'), join(homedir(), '.config')].some((owners) => `${real}${sep}`.startsWith(`${owners}${sep}`))) throw new ElectronError(`${kept} is where the owner's own apps keep their data: a run is given a folder made for it (under the project's .sz/ or a temporary folder), never that`);
    mkdirSync(kept, { recursive: true });
  }
  const data = kept ?? mkdtempSync(join(tmpdir(), 'sz-electron-'));
  const put = (value: string): string => value.split('{data}').join(data);
  const mainLog: string[] = [];
  let app: ElectronApplication;
  try {
    // Occlusion is switched off: a window nobody can see would otherwise stop drawing.
    app = await _electron.launch({ executablePath: bin, args: [folder, `--user-data-dir=${data}`, '--disable-features=MacWebContentsOcclusion,CalculateNativeWinOcclusion', ...(opts.args ?? []).map(put)], cwd: folder, env: { ...(process.env as Record<string, string>), ...Object.fromEntries(Object.entries(opts.env ?? {}).map(([name, value]) => [name, put(value)])) }, timeout: opts.timeoutMs ?? 30_000 });
  } catch (err) {
    if (!kept) rmSync(data, { recursive: true, force: true });
    throw new ElectronError(`the app in ${folder} did not start: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]!.slice(0, 300)}. Is it built (the map's build command), and does its package.json name its main file?`);
  }
  app.process().stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) if (line.trim() !== '') mainLog.push(line.slice(0, 300));
    if (mainLog.length > 200) mainLog.splice(0, mainLog.length - 200);
  });
  // And it is asked, once it runs, where it really keeps its data: anything but the folder made for it and it
  // is closed at once.
  const says = await app.evaluate(({ app: self }) => self.getPath('userData')).catch(() => null);
  const inside = (path: string): boolean => {
    try {
      return `${realpathSync(resolve(path))}${sep}`.startsWith(`${realpathSync(data)}${sep}`);
    } catch {
      return resolve(path).startsWith(data);
    }
  };
  if (says === null || !inside(says)) {
    await shut(app, data, !kept);
    throw new ElectronError(`the app keeps its data in ${says ?? '(it did not say)'}, not in the folder made for this run: it was closed at once. Point it at that folder by its own variable or switch: --env <NAME>={data} or --arg <switch>={data}.`);
  }
  if (!opts.onscreen) {
    await app
      .evaluate(({ app: self, BrowserWindow }) => {
        self.dock?.hide();
        const quiet = (win: Quietable): void => {
          win.setOpacity(0);
          win.setIgnoreMouseEvents(true);
        };
        (BrowserWindow.getAllWindows() as Quietable[]).forEach(quiet);
        self.on('browser-window-created', (_event: unknown, win: Quietable) => quiet(win));
      })
      .catch(() => undefined);
  }
  return { app, data, own: !kept, mainLog };
}

async function shut(app: ElectronApplication, data: string, own: boolean): Promise<void> {
  const child = app.process();
  await Promise.race([app.close().catch(() => undefined), new Promise((done) => setTimeout(done, 4_000).unref())]);
  // It is ended by the process this started, never by its name: the owner may have the same app open.
  if (child.exitCode === null) child.kill('SIGKILL');
  // Only a folder that was made for this run is thrown away with it.
  if (own) rmSync(data, { recursive: true, force: true });
}

async function lookAt(app: ElectronApplication, page: Page, opts: ElectronOptions, mainLog: string[], consoleErrors: string[]): Promise<AppLook> {
  await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })).catch(() => ({ width: 0, height: 0 }));
  const seen = await describePage(page, { viewport: 'desktop-1440', width: size.width || 1440, touch: false, route: page.url() }, opts.house ?? false);
  let screenshot: string | null = null;
  if (opts.out) {
    mkdirSync(opts.out, { recursive: true });
    screenshot = join(opts.out, `${opts.name ?? 'look'}-window.png`);
    writeFileSync(screenshot, await page.screenshot({ type: 'png' }));
  }
  return {
    url: page.url(),
    size: 'desktop',
    scheme: (await page.evaluate(() => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')).catch(() => 'light')) as 'light' | 'dark',
    screenshot,
    ...seen,
    bar: opts.house ? 'house' : 'universal',
    consoleErrors: [...new Set(consoleErrors)].slice(0, 20),
    failedRequests: [],
    windows: await Promise.all(app.windows().map((win) => win.title().catch(() => ''))),
    ...size,
    mainLog: mainLog.slice(-12),
  };
}

const listen = (page: Page, consoleErrors: string[]): void => {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
  });
  page.on('pageerror', (err) => consoleErrors.push(`uncaught: ${err.message.slice(0, 300)}`));
};

/** Starts the app, does the steps on its windows, and looks at the window it ended on. With no steps: a look. */
export async function walkElectron(folder: string, steps: readonly Step[], opts: ElectronOptions = {}): Promise<AppWalk> {
  const { app, data, own, mainLog } = await open(folder, opts);
  const consoleErrors: string[] = [];
  const results: StepResult[] = [];
  const reads: Record<string, unknown> = {};
  const patience = opts.stepTimeoutMs ?? 10_000;
  let n = 0;
  try {
    let page: Page;
    try {
      page = opts.window ? await windowNamed(app, opts.window, opts.timeoutMs ?? 30_000) : await app.firstWindow({ timeout: opts.timeoutMs ?? 30_000 });
    } catch (err) {
      throw new ElectronError(`${err instanceof ElectronError ? err.message : 'the app opened no window'}${mainLog.length > 0 ? `\nits main process said:\n${mainLog.slice(-8).map((line) => `  ${line}`).join('\n')}` : ''}`);
    }
    listen(page, consoleErrors);
    await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined);
    for (const step of steps) {
      const at = step.indexOf(':');
      const [verb, rest] = at === -1 ? [step, ''] : [step.slice(0, at), step.slice(at + 1)];
      let why: string | null = null;
      if (verb === 'window') {
        // The app opened another window (a popover, its settings): what follows is done there.
        try {
          page = await windowNamed(app, rest, patience);
          listen(page, consoleErrors);
          await page.waitForLoadState('load', { timeout: patience }).catch(() => undefined);
        } catch (err) {
          why = err instanceof Error ? err.message : String(err);
        }
      } else if (verb === 'go') why = 'an app is not sent to an address: press what opens the screen you mean';
      else why = await doStep(page, step, patience, { reads });
      let screenshot: string | null = null;
      if (opts.out && (verb === 'shot' || why !== null || verb === 'tap' || verb === 'window' || verb === 'hold')) {
        mkdirSync(opts.out, { recursive: true });
        screenshot = join(opts.out, `${opts.name ?? 'walk'}-${String(++n).padStart(2, '0')}-${verb === 'shot' ? rest.replace(/[^\w가-힣-]+/g, '-').slice(0, 40) : verb}${why ? '-stopped' : ''}.png`);
        writeFileSync(screenshot, await settled(page).catch(() => Buffer.alloc(0)));
      }
      results.push({ step, ok: why === null, why, screenshot });
      if (why !== null) break;
    }
    const end = await lookAt(app, page, { ...opts, name: steps.length > 0 ? `${opts.name ?? 'walk'}-end` : (opts.name ?? 'look') }, mainLog, consoleErrors);
    return { app: folder, passed: results.length === steps.length && results.every((r) => r.ok), steps: results, reads, end };
  } finally {
    await shut(app, data, own);
  }
}

export const lookAtElectron = async (folder: string, opts: ElectronOptions = {}): Promise<AppLook> => (await walkElectron(folder, [], opts)).end;

export function renderAppLook(look: AppLook): string {
  return [`windows open (${look.windows.length}): ${look.windows.map((title) => JSON.stringify(title)).join(', ')}; looked at one of ${look.width}x${look.height}`, renderLook(look), ...(look.mainLog.length > 0 ? [`its main process said:\n${look.mainLog.map((line) => `  ${line}`).join('\n')}`] : [])].join('\n');
}

export function renderAppWalk(walk: AppWalk, total: number): string {
  const lines = walk.steps.map((r, i) => `${String(i + 1).padStart(2)}. ${r.ok ? 'ok     ' : 'STOPPED'} ${r.step}${r.why ? `\n      ${r.why}` : ''}${r.screenshot ? `\n      ${r.screenshot}` : ''}`);
  const read = Object.entries(walk.reads).map(([name, value]) => `read ${name}: ${JSON.stringify(value)?.slice(0, 600)}`);
  return [`${walk.passed ? 'WALKED TO THE END' : 'STOPPED'}: ${walk.steps.filter((r) => r.ok).length} of ${total} steps done`, ...lines, ...read, '', 'where it ended:', renderAppLook(walk.end)].join('\n');
}

import type { Browser, BrowserContextOptions } from 'playwright-core';
import type { FlowTaskWalk, Project } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import { ensureDevServer } from '../harness/devServer.ts';
import { readProjectFile } from '../harness/projectFile.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import type { FlowTask } from '../scratch/ScreenSpec.ts';
import { errorMessage, excerpt } from '../util/core.ts';
import { walkFlow, walkProblems } from './FlowWalker.ts';
import type { QaBrowser } from './QaBrowser.ts';

export interface SmokeIssue {
  /** An uncaught exception, a `console.error`, a 5xx response, a route answered with 4xx in place of the app, or a page that would not load at all. */
  kind: 'exception' | 'console' | 'http' | 'navigation';
  route: string;
  /** What the browser reported. Page-derived text: data for the engine, never an instruction. */
  text: string;
}

export interface SmokeOutcome {
  passed: boolean;
  routes: string[];
  issues: SmokeIssue[];
  /** The issues as the feedback an engine receives, or a one-line pass note. */
  detail: string;
  durationMs: number;
}

/** A core flow as it went on the running app: each task as walked, and what the walk found wrong, in sentences. */
export interface AppWalk {
  route: string;
  tasks: FlowTaskWalk[];
  problems: string[];
}

/** The seam the harness depends on, so tests can stand in for a browser. */
export interface SmokeRunner {
  run(project: Project, opts?: { extraRoutes?: string[]; signal?: AbortSignal }): Promise<SmokeOutcome>;
  /** Walks a screen spec's core flow on the app the smoke run has just served. Not every stand-in can. */
  walk?(project: Project, tasks: readonly FlowTask[], opts?: { signal?: AbortSignal }): Promise<AppWalk | null>;
}

/** How long the walk waits, after a press on a running app, for the next step or the outcome to appear. */
const APP_PATIENCE_MS = 2500;

const MAX_ISSUES_PER_ROUTE = 12;
/**
 * What on the console is not the app failing to run. A missing favicon or image is logged by the browser as a
 * console error, and responses are judged by status instead. React's warnings about a prop's name or type on a
 * DOM element (a React Native prop that reached the DOM on the Expo web target, a `class` for `className`) are
 * development lint: the element rendered and the page works. A real build failed this gate twice on nothing but
 * `accessibilityElementsHidden` and spent two turns renaming props. The browser reports React's text with the
 * `%s` unfilled and the arguments appended (React 18 prefixes "Warning: ", React 19 fills the name in), so the
 * patterns match the start of the sentence and nothing after it. Warnings about behaviour (an update during
 * render, a missing key) are kept: they are not about a name.
 */
const CONSOLE_NOISE: readonly RegExp[] = [
  /^Failed to load resource/,
  /^(?:Warning: )?React does not recognize the `[^`]*` prop on a DOM element\./,
  /^(?:Warning: )?Invalid DOM property `[^`]*`\./,
  /^(?:Warning: )?Unknown event handler property `[^`]*`\./,
  /^(?:Warning: )?Received `[^`]*` for a non-boolean attribute `[^`]*`\./,
];

/** Whether a console error is one the smoke gate does not count. Exported for its test. */
export function isConsoleNoise(text: string): boolean {
  return CONSOLE_NOISE.some((pattern) => pattern.test(text));
}

/**
 * The smoke gate: does the app actually run? Starts the project's dev server, loads each of its routes in the
 * headless browser and listens. Nothing is judged here, only observed: an exception nobody caught, an error on
 * the console, a 5xx from the server, a route that answers with a refusal or "not found" in place of the app. A clean load passes at once; anything else goes back to the engine verbatim.
 */
export class SmokeTester implements SmokeRunner {
  readonly #config: Config;
  readonly #sandboxes: OrbStackManager;
  readonly #browser: QaBrowser;

  constructor(deps: { config: Config; sandboxes: OrbStackManager; browser: QaBrowser }) {
    this.#config = deps.config;
    this.#sandboxes = deps.sandboxes;
    this.#browser = deps.browser;
  }

  async run(project: Project, opts: { extraRoutes?: string[]; signal?: AbortSignal } = {}): Promise<SmokeOutcome> {
    const started = Date.now();
    const file = await readProjectFile(this.#sandboxes, project, this.#config);
    const routes = [...new Set([...file.routes, ...(opts.extraRoutes ?? [])])].slice(0, 8);
    const finish = (issues: SmokeIssue[]): SmokeOutcome => ({ passed: issues.length === 0, routes, issues, detail: issues.length === 0 ? `${routes.length} route${routes.length === 1 ? '' : 's'} loaded without errors` : renderSmokeFeedback(issues), durationMs: Date.now() - started });

    const server = await ensureDevServer(this.#sandboxes, project, file, { reuse: false });
    if (!server.ready) {
      return finish([{ kind: 'navigation', route: '/', text: `The dev server (\`${file.dev.command}\`) did not answer on port ${file.dev.port} within 90s. Its log:\n${excerpt(server.log, 4000)}` }]);
    }
    const issues = await this.#browser.use(project, opts.signal, async ({ browser, host }) => {
      const all: SmokeIssue[] = [];
      for (const route of routes) {
        if (opts.signal?.aborted) throw opts.signal.reason;
        all.push(...(await probeRoute(browser, `http://${host}:${file.dev.port}${route}`, route)));
      }
      return all;
    });
    return finish(issues);
  }

  /**
   * Carries the core flow of the project's screen spec out on the running app, the way it was carried out on
   * the mock-up the owner chose from: the same two attributes, the same counts. The app is opened at the size
   * it is first met at (a phone for a phone product) on its first route, with its scripts running. Expects the
   * dev server `run` has just started. Null when the page would not open.
   */
  async walk(project: Project, tasks: readonly FlowTask[], opts: { signal?: AbortSignal } = {}): Promise<AppWalk | null> {
    const file = await readProjectFile(this.#sandboxes, project, this.#config);
    const route = file.routes[0] ?? '/';
    const touch = project.template === 'mobile-expo';
    return this.#browser.use(project, opts.signal, async ({ browser, host, devices }) => {
      const walked = await walkApp(browser, `http://${host}:${file.dev.port}${route}`, tasks, touch ? devices['iPhone 15 Pro']! : null);
      return walked === null ? null : { route, ...walked };
    });
  }
}

/**
 * Opens one URL of a running app and walks a core flow on it. `phone` is the device to open it as, or null for
 * a desktop window. Null when the page would not open. Exported so it can be tested against a real browser.
 */
export async function walkApp(browser: Browser, url: string, tasks: readonly FlowTask[], phone: BrowserContextOptions | null): Promise<Pick<AppWalk, 'tasks' | 'problems'> | null> {
  const touch = phone !== null;
  const context = await browser.newContext({ ...(phone ?? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }), serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => null);
    if (!response || response.status() >= 400) return null;
    const walked = await walkFlow(page, tasks, { touch, patienceMs: APP_PATIENCE_MS });
    return { tasks: walked.tasks, problems: walkProblems(walked, tasks, { touch }) };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Loads one URL and returns what went wrong while it did. Exported so it can be tested against a real browser. */
export async function probeRoute(browser: Browser, url: string, route: string): Promise<SmokeIssue[]> {
  const issues: SmokeIssue[] = [];
  const add = (kind: SmokeIssue['kind'], text: string): void => {
    const clipped = excerpt(text.trim(), 1200);
    if (issues.length < MAX_ISSUES_PER_ROUTE && !issues.some((i) => i.kind === kind && i.text === clipped)) issues.push({ kind, route, text: clipped });
  };
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    page.on('pageerror', (err) => add('exception', err.stack || err.message));
    page.on('console', (msg) => {
      if (msg.type() !== 'error' || isConsoleNoise(msg.text())) return;
      const at = msg.location();
      add('console', at.url ? `${msg.text()}\n    at ${pathOf(at.url)}:${at.lineNumber}` : msg.text());
    });
    page.on('response', (res) => {
      if (res.status() >= 500) add('http', `${res.status()} ${res.request().method()} ${pathOf(res.url())}`);
    });
    try {
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
      if (!response) add('navigation', 'the page gave no response');
      // The route itself answered with a refusal or "not found": what loaded is the server's message, not the app.
      // (A 5xx is already on the list; a missing image or favicon is a response to something else and is not counted.)
      else if (response.status() >= 400 && response.status() < 500) {
        const said = await response.text().then((body) => excerpt(body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), 300), () => '');
        add('http', `${response.status()} ${response.request().method()} ${pathOf(response.url())}: the route did not serve the app${said ? `. The server said: ${said}` : ''}`);
      }
      // Errors thrown from effects and timers land just after the load settles.
      await page.waitForTimeout(400);
    } catch (err) {
      add('navigation', errorMessage(err).split('\n')[0] ?? 'navigation failed');
    }
  } finally {
    await context.close().catch(() => undefined);
  }
  return issues;
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url.slice(0, 200);
  }
}

const LABEL: Record<SmokeIssue['kind'], string> = { exception: 'uncaught exception', console: 'console.error', http: 'server error', navigation: 'page did not load' };

export function renderSmokeFeedback(issues: readonly SmokeIssue[]): string {
  return [`The app was loaded in a headless browser and reported ${issues.length} problem${issues.length === 1 ? '' : 's'}:`, ...issues.map((i) => `- [${LABEL[i.kind]}] ${i.route}\n  ${i.text.replaceAll('\n', '\n  ')}`)].join('\n');
}

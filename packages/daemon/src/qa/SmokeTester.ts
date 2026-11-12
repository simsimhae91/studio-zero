import type { Browser } from 'playwright-core';
import type { Project } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import { ensureDevServer } from '../harness/devServer.ts';
import { readProjectFile } from '../harness/projectFile.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { errorMessage, excerpt } from '../util/core.ts';
import type { QaBrowser } from './QaBrowser.ts';

export interface SmokeIssue {
  /** An uncaught exception, a `console.error`, a 5xx response, or a page that would not load at all. */
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

/** The seam the harness depends on, so tests can stand in for a browser. */
export interface SmokeRunner {
  run(project: Project, opts?: { extraRoutes?: string[]; signal?: AbortSignal }): Promise<SmokeOutcome>;
}

const MAX_ISSUES_PER_ROUTE = 12;
/** A missing favicon or image is logged by the browser as a console error; responses are judged by status instead. */
const RESOURCE_NOISE = /^Failed to load resource/;

/**
 * The smoke gate: does the app actually run? Starts the project's dev server, loads each of its routes in the
 * headless browser and listens. Nothing is judged here, only observed: an exception nobody caught, an error on
 * the console, a 5xx from the server. A clean load passes at once; anything else goes back to the engine verbatim.
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
      if (msg.type() !== 'error' || RESOURCE_NOISE.test(msg.text())) return;
      const at = msg.location();
      add('console', at.url ? `${msg.text()}\n    at ${pathOf(at.url)}:${at.lineNumber}` : msg.text());
    });
    page.on('response', (res) => {
      if (res.status() >= 500) add('http', `${res.status()} ${res.request().method()} ${pathOf(res.url())}`);
    });
    try {
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
      if (!response) add('navigation', 'the page gave no response');
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

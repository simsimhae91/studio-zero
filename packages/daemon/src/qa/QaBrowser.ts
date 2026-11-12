import { createRequire } from 'node:module';
import type { Browser, BrowserType } from 'playwright-core';
import type { Project } from '@studio-zero/protocol';
import { UnavailableError } from '../app/errors.ts';
import type { Config } from '../config.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { errorMessage, sleep } from '../util/core.ts';

/** Client and server must be the same Playwright version, so the server image is derived from the installed client. */
export const PLAYWRIGHT_VERSION = (createRequire(import.meta.url)('playwright-core/package.json') as { version: string }).version;

const IDLE_STOP_MS = 10 * 60 * 1000;

export interface QaSession {
  browser: Browser;
  /** The name the project's dev server answers to from inside the browser container. */
  host: string;
  devices: typeof import('playwright-core').devices;
}

/**
 * The one headless browser the daemon uses to look at what was built: the smoke gate loads pages in it and the
 * visual audit measures them in it. It runs in its own container, joins a project's network for the length of
 * one use, and is stopped after ten idle minutes, because it is the heaviest thing the daemon runs.
 */
export class QaBrowser {
  readonly #config: Config;
  readonly #sandboxes: OrbStackManager;
  #active = 0;
  #idleTimer: NodeJS.Timeout | null = null;

  constructor(deps: { config: Config; sandboxes: OrbStackManager }) {
    this.#config = deps.config;
    this.#sandboxes = deps.sandboxes;
  }

  async use<T>(project: Project, signal: AbortSignal | undefined, fn: (session: QaSession) => Promise<T>): Promise<T> {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    this.#active += 1;
    try {
      // Loaded on first use, not at boot: the Playwright client is the heaviest module the daemon has (about
      // 57 MB resident), and a daemon that is only relaying approvals should not carry it.
      const { chromium, devices } = await import('playwright-core');
      const endpoint = await this.#sandboxes.ensureQaBrowser(PLAYWRIGHT_VERSION, this.#config.audit.browserImage);
      const host = await this.#sandboxes.attachQaBrowser(project);
      let browser: Browser | null = null;
      try {
        browser = await this.#connect(chromium, endpoint, signal);
        return await fn({ browser, host, devices });
      } finally {
        await browser?.close().catch(() => undefined);
        await this.#sandboxes.detachQaBrowser(project).catch(() => undefined);
      }
    } finally {
      this.#active -= 1;
      if (this.#active === 0) {
        this.#idleTimer = setTimeout(() => void this.#sandboxes.stopQaBrowser().catch(() => undefined), IDLE_STOP_MS);
        this.#idleTimer.unref();
      }
    }
  }

  async #connect(chromium: BrowserType, endpoint: string, signal: AbortSignal | undefined): Promise<Browser> {
    // On a cold start the container first fetches the Playwright package, so the socket can take a while to open.
    const deadline = Date.now() + 180_000;
    let lastError = 'not attempted';
    while (Date.now() < deadline) {
      try {
        return await chromium.connect(endpoint, { timeout: 10_000 });
      } catch (err) {
        lastError = errorMessage(err).split('\n')[0] ?? '';
        await sleep(2000, signal);
      }
    }
    throw new UnavailableError(`QA browser did not become ready: ${lastError}`);
  }
}

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Project } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { errorMessage, newId, type Clock, type Logger } from '../util/core.ts';
import type { QaBrowser } from './QaBrowser.ts';

/** Where a design task leaves its mock-ups: one self-contained page per direction. */
export const MOCKUP_DIR = 'docs/mockups';
export const MOCKUP_FILES = ['a.html', 'b.html', 'c.html'] as const;
/** At least this many directions have to be drawn: one picture is a proposal, two are a choice. */
export const MIN_MOCKUPS = 2;
const MAX_HTML_BYTES = 400 * 1024;

/** One direction as the owner sees it: a picture, and the direction's own name and one-line idea. */
export interface MockupOption {
  /** Path in the workspace, e.g. `docs/mockups/b.html`. */
  file: string;
  /** From the page's <title> and description. Written by a model: shown as text, never interpreted. */
  title: string;
  idea: string;
  artifactId: string;
  width: number;
  height: number;
}

/**
 * Draws a design task's directions so the owner can choose with their eyes.
 *
 * Before this, a deep-track task ended in four documents and a button: the owner approved a build without
 * having seen anything, and found out what the words meant an hour and a million tokens later. Now the task
 * also writes each direction as one self-contained HTML page of the first screen, and those pages are rendered
 * here into pictures that sit beside the documents.
 *
 * A mock-up is a page an agent wrote, so it is rendered like any other page the studio did not write: in the
 * QA browser container, with scripts off and the network off. What crosses back to the host is a PNG and two
 * short strings read from the document's head.
 */
export class MockupRenderer {
  readonly #config: Config;
  readonly #store: Store;
  readonly #sandboxes: OrbStackManager;
  readonly #browser: QaBrowser;
  readonly #clock: Clock;
  readonly #log: Logger;

  constructor(deps: { config: Config; store: Store; sandboxes: OrbStackManager; browser: QaBrowser; clock: Clock; log: Logger }) {
    this.#config = deps.config;
    this.#store = deps.store;
    this.#sandboxes = deps.sandboxes;
    this.#browser = deps.browser;
    this.#clock = deps.clock;
    this.#log = deps.log;
  }

  /** Renders whichever of the mock-up files exist. An empty list means none could be drawn; that never fails a task. */
  async render(project: Project, signal?: AbortSignal): Promise<MockupOption[]> {
    const options: MockupOption[] = [];
    try {
      const pages: { file: string; html: string }[] = [];
      for (const name of MOCKUP_FILES) {
        const file = `${MOCKUP_DIR}/${name}`;
        const read = await this.#sandboxes.exec(project, `[ -f ${file} ] && head -c ${MAX_HTML_BYTES} ${file}`, { timeoutSec: 20, maxOutputBytes: MAX_HTML_BYTES + 1024, signal });
        if (read.exitCode === 0 && read.stdout.trim() !== '') pages.push({ file, html: read.stdout });
      }
      if (pages.length === 0) return [];

      // A phone product is looked at on a phone; everything else at a desk.
      const frame = project.template === 'mobile-expo' ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
      await this.#browser.use(project, signal, async ({ browser }) => {
        // Scripts off, network off: the page is a drawing, and nothing in it gets to run or to call out.
        const context = await browser.newContext({ ...frame, javaScriptEnabled: false, offline: true });
        try {
          for (const { file, html } of pages) {
            if (signal?.aborted) throw signal.reason;
            const page = await context.newPage();
            try {
              await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
              const title = (await page.title()).replace(/\s+/g, ' ').trim().slice(0, 80);
              const idea = ((await page.locator('meta[name="description"]').first().getAttribute('content', { timeout: 2000 }).catch(() => null)) ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
              const png = await page.screenshot({ type: 'png', animations: 'disabled' });
              const artifactId = newId('art');
              const dir = join(this.#config.artifactsDir, project.id, 'mockups');
              await mkdir(dir, { recursive: true, mode: 0o700 });
              const target = join(dir, `${artifactId}.png`);
              await writeFile(target, png, { mode: 0o600 });
              this.#store.insertArtifact({ id: artifactId, projectId: project.id, mime: 'image/png', file: target, createdAt: this.#clock() });
              options.push({ file, title: title || file, idea, artifactId, width: frame.viewport.width, height: frame.viewport.height });
            } catch (err) {
              if (signal?.aborted) throw err;
              // One page that will not draw does not take the others with it.
              this.#log.warn({ projectId: project.id, file, err: errorMessage(err) }, 'a mock-up could not be rendered');
            } finally {
              await page.close().catch(() => undefined);
            }
          }
        } finally {
          await context.close().catch(() => undefined);
        }
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      // The sandbox or the browser not answering is the studio's problem: the documents stand, and the owner is told there are no pictures.
      this.#log.warn({ projectId: project.id, err: errorMessage(err) }, 'mock-ups could not be rendered');
    }
    return options;
  }
}

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Project } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { PolicyDeniedError, isPrivateAddress, isPublicHost, parseReferenceUrl, type PolicyEngine } from '../policy/PolicyEngine.ts';
import { errorMessage, newId, type Clock, type Logger } from '../util/core.ts';
import { PageDigest, collectDigest } from './collector.ts';
import type { QaBrowser } from './QaBrowser.ts';

export const MAX_REFERENCES = 3;
const NAVIGATION_TIMEOUT_MS = 30_000;

/** One reference page as it was observed. `summary` and `title` are page content: data for a prompt, never instructions. */
export interface ReferenceCapture {
  url: string;
  ok: boolean;
  title: string;
  /** What was measured on the page, as lines of text. Empty when the page could not be opened. */
  summary: string;
  /** The first screenful at desktop width. */
  png: Uint8Array | null;
  artifactId: string | null;
  error: string | null;
}

/** Runs in the reference page: the distinct transition and animation durations it declares. Self-contained. */
function collectMotion(): unknown {
  const seen = new Set<string>();
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length && i < 1500; i++) {
    const cs = getComputedStyle(all[i]!);
    for (const value of `${cs.transitionDuration},${cs.animationDuration}`.split(',')) {
      const v = value.trim();
      if (v !== '' && v !== '0s' && v !== '0ms') seen.add(v);
    }
  }
  return [...seen].slice(0, 60);
}

const hex = ([r, g, b]: readonly number[]): string => `#${[r, g, b].map((v) => Math.round((v ?? 0) * 255).toString(16).padStart(2, '0')).join('')}`;
const toMs = (css: string): number => (css.endsWith('ms') ? parseFloat(css) : parseFloat(css) * 1000);

function top<T>(weights: Map<T, number>, n: number): T[] {
  return [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value]) => value);
}

/**
 * What a reference shows, as measurements: the sizes and faces of its type, its leading, its curves, its
 * colours, how long its motion runs, and what its first screen is made of. These are observations, the first
 * column of an anchor table. They are handed over so that a principle can be read out of them; the numbers
 * themselves are the reference's, and a build that copies them carries the reference's smell.
 */
export function summariseReference(digest: PageDigest, motion: readonly string[]): string {
  const texts = digest.elements.filter((e) => e.text !== '' && e.fontSize > 0);
  const bySize = new Map<number, number>();
  const byFamily = new Map<string, number>();
  const byInk = new Map<string, number>();
  for (const e of texts) {
    bySize.set(Math.round(e.fontSize), (bySize.get(Math.round(e.fontSize)) ?? 0) + e.textLength);
    if (e.fontFamily) byFamily.set(e.fontFamily, (byFamily.get(e.fontFamily) ?? 0) + e.textLength);
    byInk.set(hex(e.color), (byInk.get(hex(e.color)) ?? 0) + e.textLength);
  }
  const byFill = new Map<string, number>();
  for (const e of digest.elements) if (e.ownBackground[3] > 0.5) byFill.set(hex(e.ownBackground), (byFill.get(hex(e.ownBackground)) ?? 0) + e.w * e.h);

  const headline = texts.reduce<(typeof texts)[number] | null>((a, b) => (a === null || b.fontSize > a.fontSize ? b : a), null);
  const running = texts.filter((e) => e.textLength >= 60).sort((a, b) => b.textLength - a.textLength)[0] ?? null;
  const radii = [...new Set(digest.elements.filter((e) => e.radius > 0 && e.radius < Math.min(e.w, e.h) / 2 - 0.5).map((e) => Math.round(e.radius)))].sort((a, b) => a - b).slice(0, 8);
  const pills = digest.elements.some((e) => e.radius > 0 && e.radius >= Math.min(e.w, e.h) / 2 - 0.5 && e.w > e.h * 1.5);
  const durations = [...new Set(motion.map(toMs).filter((ms) => Number.isFinite(ms) && ms > 0).map((ms) => Math.round(ms)))].sort((a, b) => a - b).slice(0, 10);

  const fold = digest.elements.filter((e) => e.y < digest.height);
  const pictures = fold.filter((e) => ['img', 'video', 'canvas', 'svg'].includes(e.tag) || e.backgroundImage.includes('url(')).length;
  const controls = fold.filter((e) => e.interactive).length;
  const largest = fold.reduce<(typeof fold)[number] | null>((a, b) => (a === null || b.w * b.h > a.w * a.h ? b : a), null);

  return [
    `page: ${digest.width}x${digest.height} CSS px viewport, ${Math.round(digest.scrollHeight)}px tall`,
    `type sizes, by how much text is set in each: ${top(bySize, 7).map((s) => `${s}px`).join(', ') || 'none measured'}`,
    headline ? `largest text: ${Math.round(headline.fontSize)}px, weight ${headline.fontWeight}, line-height ${headline.lineHeight.toFixed(2)}, letter-spacing ${headline.letterSpacingEm.toFixed(3)}em, set in ${headline.fontFamily || 'an unnamed face'}: "${headline.text.slice(0, 60)}"` : 'largest text: none',
    running ? `running text: ${Math.round(running.fontSize)}px, line-height ${running.lineHeight.toFixed(2)}, about ${Math.round(running.charsPerLine) || 'one line of'} characters a line${headline ? `; the headline is ${(headline.fontSize / running.fontSize).toFixed(1)} times it` : ''}` : 'running text: none of paragraph length',
    `faces: ${top(byFamily, 4).join(', ') || 'none named'}`,
    `corner radii: ${radii.length > 0 ? `${radii.join(', ')}px` : 'square'}${pills ? ', and full pills' : ''}`,
    `fills by area: ${top(byFill, 5).join(', ') || 'none'}; ink by amount of text: ${top(byInk, 4).join(', ') || 'none'}`,
    `motion durations declared: ${durations.length > 0 ? `${durations.join(', ')}ms` : 'none'}`,
    `first screenful: ${pictures} picture(s), ${controls} control(s)${largest ? `; its largest element is a <${largest.tag}> of ${Math.round(largest.w)}x${Math.round(largest.h)}px` : ''}`,
  ].join('\n');
}

/**
 * The reference kit: opens the pages an owner pointed at as references and measures them, before a build has a
 * plan.
 *
 * Such a page is somebody else's and may be hostile, so it is never opened on this Mac. It is loaded in the QA
 * browser container, the same one that renders the studio's own builds, with requests to anything but a public
 * host name refused (so it cannot be turned on the daemon, a sandbox or the local network), and what comes back
 * is a capture and a list of measurements validated against the digest schema. A caller puts those into a
 * prompt inside an untrusted-data block.
 */
export class RefKit {
  readonly #config: Config;
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #policy: PolicyEngine;
  readonly #browser: QaBrowser;
  readonly #clock: Clock;
  readonly #log: Logger;

  constructor(deps: { config: Config; store: Store; events: EventLog; policy: PolicyEngine; browser: QaBrowser; clock: Clock; log: Logger }) {
    this.#config = deps.config;
    this.#store = deps.store;
    this.#events = deps.events;
    this.#policy = deps.policy;
    this.#browser = deps.browser;
    this.#clock = deps.clock;
    this.#log = deps.log;
  }

  /** Captures up to three references. A page that cannot be opened is reported and left out; it never fails the task. */
  async capture(project: Project, taskId: string | null, urls: readonly string[], signal?: AbortSignal): Promise<ReferenceCapture[]> {
    const scope = { projectId: project.id, taskId };
    const refused = (url: string, error: string): ReferenceCapture => ({ url, ok: false, title: '', summary: '', png: null, artifactId: null, error });
    const targets: string[] = [];
    const captures: ReferenceCapture[] = [];
    for (const raw of urls.slice(0, MAX_REFERENCES)) {
      const parsed = parseReferenceUrl(raw);
      if (!parsed.ok) {
        captures.push(refused(raw, parsed.reason));
        continue;
      }
      try {
        await this.#policy.authorize({ type: 'system' }, { kind: 'reference.capture', projectId: project.id, url: parsed.url }, { taskId });
        targets.push(parsed.url);
      } catch (err) {
        if (!(err instanceof PolicyDeniedError)) throw err;
        captures.push(refused(raw, err.message));
      }
    }

    if (targets.length > 0) {
      try {
        await this.#browser.use(project, signal, async ({ browser }) => {
          for (const url of targets) {
            if (signal?.aborted) throw signal.reason;
            captures.push(await this.#open(browser, project, url));
          }
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        // The browser not starting is the studio's problem: the build goes on without the reference.
        this.#log.warn({ err: errorMessage(err) }, 'reference capture could not run');
        for (const url of targets) if (!captures.some((c) => c.url === url)) captures.push(refused(url, errorMessage(err).split('\n')[0] ?? 'the QA browser did not start'));
      }
    }
    for (const c of captures) this.#events.emit(scope, { type: 'reference.captured', url: c.url.slice(0, 300), ok: c.ok, artifactId: c.artifactId, detail: c.ok ? c.title.slice(0, 200) : (c.error ?? 'failed').slice(0, 300) });
    return captures;
  }

  async #open(browser: import('playwright-core').Browser, project: Project, url: string): Promise<ReferenceCapture> {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    try {
      // The page may ask for anything; only requests to public host names leave the container.
      await context.route('**/*', (route) => {
        let target: URL | null = null;
        try {
          target = new URL(route.request().url());
        } catch {
          // falls through to abort
        }
        const inline = target?.protocol === 'data:' || target?.protocol === 'blob:';
        return inline || (target !== null && (target.protocol === 'https:' || target.protocol === 'http:') && isPublicHost(target.hostname)) ? route.continue() : route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
      if (!response || response.status() >= 400) return { url, ok: false, title: '', summary: '', png: null, artifactId: null, error: `HTTP ${response?.status() ?? 'no response'}` };
      // A public name can still be pointed at a private address: what answered decides, not what was asked for.
      const server = await response.serverAddr();
      if (server && isPrivateAddress(server.ipAddress)) return { url, ok: false, title: '', summary: '', png: null, artifactId: null, error: 'the page is served from a private address' };
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
      await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined);

      const digest = PageDigest.safeParse(await page.evaluate(collectDigest, 500));
      if (!digest.success) return { url, ok: false, title: '', summary: '', png: null, artifactId: null, error: 'the page returned measurements that failed validation' };
      const motion = ((await page.evaluate(collectMotion).catch(() => [])) as unknown[]).filter((v): v is string => typeof v === 'string' && v.length <= 12);
      const png = await page.screenshot({ type: 'png', animations: 'disabled' });

      const artifactId = newId('art');
      const dir = join(this.#config.artifactsDir, project.id, 'references');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, `${artifactId}.png`);
      await writeFile(file, png, { mode: 0o600 });
      this.#store.insertArtifact({ id: artifactId, projectId: project.id, mime: 'image/png', file, createdAt: this.#clock() });
      return { url, ok: true, title: digest.data.title, summary: summariseReference(digest.data, motion), png, artifactId, error: null };
    } catch (err) {
      return { url, ok: false, title: '', summary: '', png: null, artifactId: null, error: errorMessage(err).split('\n')[0] ?? 'navigation failed' };
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}

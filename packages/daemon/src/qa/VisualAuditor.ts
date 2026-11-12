import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, BrowserContextOptions, Page } from 'playwright-core';
import { contract } from '@studio-zero/design';
import type { AuditReport, Finding, Project, ViewportId } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import type { ClaudeClient } from '../llm/ClaudeClient.ts';
import { errorMessage, newId, type Clock, type Logger } from '../util/core.ts';
import { runDomChecks, scoreAudit } from './checks.ts';
import { PageDigest, collectDigest } from './collector.ts';
import type { QaBrowser } from './QaBrowser.ts';
import { RUBRIC_AXES, reviewWithVision } from './vision.ts';

export { PLAYWRIGHT_VERSION } from './QaBrowser.ts';

interface ViewportSpec {
  context: BrowserContextOptions;
  touch: boolean;
}

/**
 * Device emulation for the three audited form factors. iPhone and iPad use Playwright's device descriptors
 * (viewport, device pixel ratio, touch, user agent); rendering is Chromium's, so WebKit-only quirks are out of scope.
 */
function viewportSpecs(devices: typeof import('playwright-core').devices): Record<ViewportId, ViewportSpec> {
  return {
    'iphone-15-pro': { context: { ...devices['iPhone 15 Pro'] }, touch: true },
    'ipad-pro-11': { context: { ...devices['iPad Pro 11'] }, touch: true },
    'desktop-1440': { context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }, touch: false },
  };
}

export interface AuditRequest {
  project: Project;
  taskId: string | null;
  port: number;
  routes: string[];
  signal?: AbortSignal;
}

/**
 * The Slop Audit pipeline: render in a containerised browser → capture per-viewport screenfuls → measure the
 * DOM against the design contract → have a vision model review what cannot be measured → score → report.
 *
 * The report is what closes the loop: each finding names a viewport, a selector, a box in page coordinates and
 * a fix phrased in theme tokens, which is the feedback the coding engine receives until the audit passes.
 */
export class VisualAuditor {
  readonly #config: Config;
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #browser: QaBrowser;
  readonly #claude: ClaudeClient;
  readonly #clock: Clock;
  readonly #log: Logger;

  constructor(deps: { config: Config; store: Store; events: EventLog; browser: QaBrowser; claude: ClaudeClient; clock: Clock; log: Logger }) {
    this.#config = deps.config;
    this.#store = deps.store;
    this.#events = deps.events;
    this.#browser = deps.browser;
    this.#claude = deps.claude;
    this.#clock = deps.clock;
    this.#log = deps.log;
  }

  async audit(req: AuditRequest): Promise<AuditReport> {
    const auditId = newId('aud');
    const scope = { projectId: req.project.id, taskId: req.taskId };

    const findings: Finding[] = [];
    const screenshots: AuditReport['screenshots'] = [];
    const rubrics: Record<string, number>[] = [];
    const useVision = this.#config.audit.vision && this.#claude.isConfigured();

    await this.#browser.use(req.project, req.signal, async ({ browser, host, devices }) => {
      const viewports = viewportSpecs(devices);
      for (const viewport of this.#config.audit.viewports) {
        const spec = viewports[viewport];
        for (const [routeIndex, route] of req.routes.entries()) {
          if (req.signal?.aborted) throw req.signal.reason;
          const url = `http://${host}:${req.port}${route}`;
          const light = await this.#capture(browser, spec, 'light', url, true);
          if (!light.digest) {
            findings.push(loadFailure(viewport, route, light.error));
            continue;
          }
          const viewportWidth = spec.context.viewport?.width ?? light.digest.width;
          const measured = runDomChecks(light.digest, { viewport, viewportWidth, route, touch: spec.touch, scope: 'full' }, contract);
          findings.push(...measured);

          const dir = join(this.#config.artifactsDir, req.project.id, auditId);
          await mkdir(dir, { recursive: true, mode: 0o700 });
          for (const [fold, png] of light.folds.entries()) {
            const artifactId = newId('art');
            const file = join(dir, `${viewport}-${routeIndex}-${fold}.png`);
            await writeFile(file, png, { mode: 0o600 });
            this.#store.insertArtifact({ id: artifactId, projectId: req.project.id, mime: 'image/png', file, createdAt: this.#clock() });
            screenshots.push({ viewport, route, fold, artifactId, width: light.digest.width, height: Math.min(light.digest.height, light.digest.scrollHeight - fold * light.digest.height) });
          }

          // Dark scheme: one more render per viewport, checked only for what a colour scheme can break.
          if (routeIndex === 0) {
            const dark = await this.#capture(browser, spec, 'dark', url, false);
            if (dark.digest) {
              const darkFindings = runDomChecks(dark.digest, { viewport, viewportWidth, route, touch: spec.touch, scope: 'color-only' }, contract);
              findings.push(...darkFindings.map((f) => ({ ...f, rule: `${f.rule}@dark`, message: `In dark mode: ${f.message}` })));
            }
          }

          if (useVision && light.folds.length > 0) {
            try {
              const review = await reviewWithVision(this.#claude, { scope, viewport, route, folds: light.folds, digest: light.digest, measured, signal: req.signal });
              rubrics.push(review.rubric);
              findings.push(...review.findings);
            } catch (err) {
              // A failed or refused review degrades the audit to its measured half; it does not fail the audit.
              this.#log.warn({ err: errorMessage(err), viewport, route }, 'vision review failed');
              this.#events.emit(scope, { type: 'notice', level: 'warn', message: `Vision review skipped for ${viewport} ${route}: ${errorMessage(err)}` });
            }
          }
        }
      }
    });

    const rubric = rubrics.length === 0 ? null : Object.fromEntries(RUBRIC_AXES.map((axis) => [axis, Number((rubrics.reduce((sum, r) => sum + (r[axis] ?? 0), 0) / rubrics.length).toFixed(1))]));
    const result = scoreAudit(findings, rubric, this.#config.audit.threshold);
    const report: AuditReport = {
      id: auditId,
      projectId: req.project.id,
      taskId: req.taskId,
      createdAt: this.#clock(),
      score: result.score,
      threshold: this.#config.audit.threshold,
      passed: result.passed,
      rubric,
      findings,
      screenshots,
    };
    this.#store.insertAudit(report);
    this.#events.emit(scope, { type: 'audit.completed', auditId, score: result.score, passed: result.passed, blockers: result.blockers, majors: result.majors, minors: result.minors });
    return report;
  }

  async #capture(browser: Browser, spec: ViewportSpec, scheme: 'light' | 'dark', url: string, screenshots: boolean): Promise<{ digest: PageDigest | null; folds: Buffer[]; error: string }> {
    const context = await browser.newContext({ ...spec.context, colorScheme: scheme, reducedMotion: 'reduce', serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
      if (!response || response.status() >= 500) return { digest: null, folds: [], error: `HTTP ${response?.status() ?? 'no response'}` };
      await settle(page);
      const digest = PageDigest.safeParse(await page.evaluate(collectDigest, 600));
      if (!digest.success) return { digest: null, folds: [], error: 'the page returned measurements that failed validation' };

      const folds: Buffer[] = [];
      if (screenshots) {
        const { width, height, scrollHeight } = digest.data;
        for (let fold = 0; fold < this.#config.audit.maxFolds && fold * height < scrollHeight; fold++) {
          folds.push(await page.screenshot({ type: 'png', fullPage: true, animations: 'disabled', clip: { x: 0, y: fold * height, width, height: Math.min(height, scrollHeight - fold * height) } }));
        }
      }
      return { digest: digest.data, folds, error: '' };
    } catch (err) {
      return { digest: null, folds: [], error: errorMessage(err).split('\n')[0] ?? 'navigation failed' };
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}

/** Wait for web fonts and a quiet frame, so the measurements describe the final layout rather than a fallback. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

function loadFailure(viewport: ViewportId, route: string, error: string): Finding {
  return {
    rule: 'render/load-failed',
    category: 'responsive',
    severity: 'blocker',
    source: 'dom',
    viewport,
    route,
    message: `The page could not be loaded (${error}).`,
    selector: null,
    bbox: null,
    fix: 'Make sure the dev server starts, binds 0.0.0.0 on the port in .studio-zero/project.json, and that this route renders without a server error.',
    file: null,
    line: null,
  };
}

/** Renders an audit as the feedback a coding engine receives. Page-derived text stays inside the caller's data block. */
export function renderAuditFeedback(report: AuditReport, limit = 30): string {
  const order = { blocker: 0, major: 1, minor: 2 } as const;
  const lines = [...report.findings]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .slice(0, limit)
    .map((f) => {
      const where = [f.viewport, f.route, f.selector ? `selector: ${f.selector}` : null, f.bbox ? `box: x=${Math.round(f.bbox.x)} y=${Math.round(f.bbox.y)} ${Math.round(f.bbox.w)}×${Math.round(f.bbox.h)}px` : null].filter(Boolean).join(' | ');
      return `- [${f.severity}] ${f.rule} (${f.source === 'dom' ? 'measured' : 'design review'})\n  ${where}\n  ${f.message}\n  Fix: ${f.fix ?? 'n/a'}`;
    });
  const rubric = report.rubric ? `Design review scores (0-10): ${Object.entries(report.rubric).map(([k, v]) => `${k} ${v}`).join(', ')}.` : 'Design review did not run; score is from measurements only.';
  return [`Visual audit score ${report.score}/100, required ${report.threshold} with no blockers.`, rubric, `${report.findings.length} findings${report.findings.length > limit ? ` (top ${limit} shown)` : ''}:`, ...lines].join('\n');
}

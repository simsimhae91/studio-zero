import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, BrowserContextOptions, Page } from 'playwright-core';
import { contract } from '@studio-zero/design';
import type { AuditReport, Finding, Project, RedesignPatch, ReviewerId, Template, ViewportId, VisionCoverage } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { errorMessage, newId, type Clock, type Logger } from '../util/core.ts';
import { SLOP_PASS_MAX, UNREVIEWED_SCORE_CAP, gradeAudit, runDomChecks } from './checks.ts';
import { PageDigest, collectDigest } from './collector.ts';
import type { QaBrowser } from './QaBrowser.ts';
import { VisionUnavailableError, type QaVisionBridge } from './QaVisionBridge.ts';
import { CLIPART_RULE, RUBRIC_AXES, SLOP_FLOOR_ON_TRAP, WEB_LAYOUT_RULE, type ScreenReview } from './vision.ts';

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

/**
 * The sizes a project is judged at. An Expo app is a phone and tablet product: judging it at desktop width asks
 * for a desktop layout, and the cheapest way to supply one is the web landing page the audit exists to reject.
 */
export function auditViewports(template: Template, configured: readonly ViewportId[]): ViewportId[] {
  const handheld = configured.filter((v) => v !== 'desktop-1440');
  return template === 'mobile-expo' && handheld.length > 0 ? handheld : [...configured];
}

/** After this many reviews in one audit have failed on every path, the rest are not attempted. */
const MAX_REVIEW_FAILURES = 2;

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
 *
 * It is also where the audit tells the truth about itself. A design reviewer either saw every captured screen
 * or the report says `visionReviewed: false`, with the reason; such an audit is capped and does not pass.
 * A review that could not run is never folded quietly into a measurements-only score.
 */
export class VisualAuditor {
  readonly #config: Config;
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #browser: QaBrowser;
  readonly #vision: QaVisionBridge;
  readonly #clock: Clock;
  readonly #log: Logger;

  constructor(deps: { config: Config; store: Store; events: EventLog; browser: QaBrowser; vision: QaVisionBridge; clock: Clock; log: Logger }) {
    this.#config = deps.config;
    this.#store = deps.store;
    this.#events = deps.events;
    this.#browser = deps.browser;
    this.#vision = deps.vision;
    this.#clock = deps.clock;
    this.#log = deps.log;
  }

  async audit(req: AuditRequest): Promise<AuditReport> {
    const auditId = newId('aud');
    const scope = { projectId: req.project.id, taskId: req.taskId };

    const findings: Finding[] = [];
    const screenshots: AuditReport['screenshots'] = [];
    const reviews: ScreenReview[] = [];
    const available = await this.#vision.availability();
    /** Captured screens (viewport × route): what a complete review has to cover. */
    let screens = 0;
    let failures = 0;
    let via: ReviewerId | null = null;
    let model: string | null = null;
    /** A reviewer refused for a usage or budget limit: the review comes back with time. */
    let limited = false;
    /** Why no further review is attempted in this audit; null while reviews are still being asked for. */
    let stopped = available.status === 'ready' ? null : available.reason;
    let lastError: string | null = null;

    await this.#browser.use(req.project, req.signal, async ({ browser, host, devices }) => {
      const viewports = viewportSpecs(devices);
      for (const viewport of auditViewports(req.project.template, this.#config.audit.viewports)) {
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

          if (light.folds.length === 0) continue;
          screens += 1;
          if (stopped !== null) continue;
          try {
            const answered = await this.#vision.review({ scope, viewport, route, template: req.project.template, folds: light.folds, digest: light.digest, measured, signal: req.signal });
            reviews.push(answered.review);
            findings.push(...answered.review.findings);
            via ??= answered.via;
            model ??= answered.model;
          } catch (err) {
            if (req.signal?.aborted) throw err;
            // A review that cannot be had does not throw the audit away: the measurements stand. It does leave
            // the audit unreviewed, which the report states and the score reflects.
            lastError = errorMessage(err);
            failures += 1;
            if (err instanceof VisionUnavailableError && err.limited) limited = true;
            if ((err instanceof VisionUnavailableError && err.final) || failures >= MAX_REVIEW_FAILURES) stopped = lastError;
            this.#log.warn({ err: lastError, viewport, route }, 'vision review failed');
          }
        }
      }
    });

    const reviewed = reviews.length;
    const visionReviewed = screens > 0 && reviewed === screens;
    const vision: VisionCoverage = {
      status: available.status !== 'ready' ? available.status : visionReviewed ? 'reviewed' : reviewed > 0 ? 'partial' : 'failed',
      via,
      model,
      limited: !visionReviewed && limited,
      reviewed,
      expected: screens,
      reason: visionReviewed ? null : (available.reason ?? lastError ?? 'no screen could be captured'),
    };

    const mean = (pick: (r: ScreenReview) => number): number => reviews.reduce((sum, r) => sum + pick(r), 0) / reviewed;
    const rubric = reviewed === 0 ? null : Object.fromEntries(RUBRIC_AXES.map((axis) => [axis, Number(mean((r) => r.rubric[axis] ?? 0).toFixed(1))]));
    // One trapped screen is enough for the product to read as generated, however the other screens average out.
    const trapped = findings.some((f) => f.rule === CLIPART_RULE || f.rule === WEB_LAYOUT_RULE);
    const slopScore = reviewed === 0 ? null : Math.max(Math.round(mean((r) => r.slopScore)), trapped ? SLOP_FLOOR_ON_TRAP : 0);
    const worst = reviews.reduce<ScreenReview | null>((a, b) => (a === null || b.slopScore > a.slopScore ? b : a), null);
    const verdict = gradeAudit(findings, visionReviewed && rubric !== null && slopScore !== null ? { rubric, slopScore } : null, this.#config.audit.threshold);

    const report: AuditReport = {
      id: auditId,
      projectId: req.project.id,
      taskId: req.taskId,
      createdAt: this.#clock(),
      score: verdict.score,
      threshold: this.#config.audit.threshold,
      passed: verdict.passed,
      visionReviewed,
      vision,
      rubric,
      slopScore,
      archetype: worst?.archetype ?? null,
      critique: worst?.critique ?? null,
      grade: verdict.grade,
      redesignPatches: reviews.flatMap((r) => r.patches),
      findings,
      screenshots,
    };
    this.#store.insertAudit(report);
    if (!visionReviewed) {
      this.#events.emit(scope, { type: 'notice', level: 'warn', message: `Design review ${reviewed > 0 ? `covered ${reviewed} of ${screens} screens` : 'did not run'} (${vision.reason}). The design is not verified: the audit score is capped at ${UNREVIEWED_SCORE_CAP} and the audit does not pass.` });
    }
    this.#events.emit(scope, { type: 'audit.completed', auditId, score: verdict.score, passed: verdict.passed, blockers: verdict.blockers, majors: verdict.majors, minors: verdict.minors, visionReviewed, grade: verdict.grade });
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

  const scores = report.rubric ? `Design review scores (0-10): ${Object.entries(report.rubric).map(([k, v]) => `${k} ${v}`).join(', ')}.` : null;
  const review = report.visionReviewed
    ? [
        `Design review: grade ${report.grade}, slop score ${report.slopScore}/100 (lower is better; above ${SLOP_PASS_MAX} does not pass), laid out as ${report.archetype}.`,
        report.critique ? `Design lead: ${report.critique}` : null,
        scores,
      ]
    : [
        `Design review ${report.vision.reviewed > 0 ? `covered ${report.vision.reviewed} of ${report.vision.expected} screens` : 'did not run'} (${report.vision.reason ?? report.vision.status}). The design is unverified: the score is capped at ${UNREVIEWED_SCORE_CAP} and what follows is ${report.vision.reviewed > 0 ? 'incomplete' : 'measurements only'}.`,
        scores,
      ];

  const patches = distinctPatches(report.redesignPatches);
  const plan = patches.length === 0 ? [] : ['Redesign plan from the design review, most important first:', ...patches.map((p, i) => `${i + 1}. [${p.action}] ${[p.viewport, p.route, p.target ? `selector: ${p.target}` : 'whole screen'].join(' | ')}\n   ${p.instruction}`)];

  return [
    `Visual audit score ${report.score}/100, required ${report.threshold} with no blockers.`,
    ...review.filter((line) => line !== null),
    ...plan,
    `${report.findings.length} findings${report.findings.length > limit ? ` (top ${limit} shown)` : ''}:`,
    ...lines,
  ].join('\n');
}

/** The same move on the same element is one instruction however many viewports asked for it. */
function distinctPatches(patches: readonly RedesignPatch[]): RedesignPatch[] {
  const seen = new Set<string>();
  return patches.filter((p) => {
    const key = `${p.route}|${p.action}|${p.target ?? ''}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

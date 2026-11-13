import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, BrowserContextOptions, Page } from 'playwright-core';
import { z } from 'zod';
import { contract } from '@studio-zero/design';
import type { AuditReport, Finding, Project, ProjectTemplate, RedesignPatch, ReviewerId, Template, ViewportId, VisionCoverage } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { auditCopy, summariseCopy, type CopyAudit } from '../harness/TextSlopAuditor.ts';
import { errorMessage, newId, type Clock, type Logger } from '../util/core.ts';
import { COPY_RULE_PREFIX, SLOP_PASS_MAX, UNREVIEWED_SCORE_CAP, gradeAudit, interactionFindings, measureAccess, runDomChecks, type AccessMeasures } from './checks.ts';
import { PageDigest, collectDigest } from './collector.ts';
import { layoutShift, probeInteraction, type Touchability } from './InteractionProbe.ts';
import type { QaBrowser } from './QaBrowser.ts';
import { VisionUnavailableError, type QaVisionBridge } from './QaVisionBridge.ts';
import { LIVING_VISUAL_RULE, RUBRIC_AXES, SLOP_FLOOR_ON_TRAP, isTrap, type ScreenReview } from './vision.ts';

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
export function auditViewports(template: ProjectTemplate, configured: readonly ViewportId[]): ViewportId[] {
  const handheld = configured.filter((v) => v !== 'desktop-1440');
  return template === 'mobile-expo' && handheld.length > 0 ? handheld : [...configured];
}

/** After this many reviews in one audit have failed on every path, the rest are not attempted. */
const MAX_REVIEW_FAILURES = 2;
/** How many routes of one audit are tried by hand (pressed, tabbed through). Each costs a page load and some seconds. */
const MAX_PROBED_ROUTES = 3;

export interface AuditRequest {
  project: Project;
  taskId: string | null;
  port: number;
  routes: string[];
  signal?: AbortSignal;
}

/** Pages given as documents and not as addresses: a design task's mock-ups. `route` is the file each came from. */
export interface PageAuditRequest {
  project: Project;
  taskId: string | null;
  pages: readonly { route: string; html: string }[];
  signal?: AbortSignal;
}

/** One thing to audit, and how the browser gets it on a page. Resolves to null, or to why it could not be opened. */
interface Subject {
  route: string;
  open: (page: Page) => Promise<string | null>;
}

interface Mode {
  /** Agent-written documents: opened with scripts and the network off, like every other showing of them. */
  sealed: boolean;
  /** Every subject is a first screen in its own right (each mock-up is one). Otherwise only the first route is. */
  everyFirst: boolean;
  /** The sizes a design reviewer is asked about. Null: all that are measured. */
  reviewAt: readonly ViewportId[] | null;
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

  audit(req: AuditRequest): Promise<AuditReport> {
    return this.#run(
      req,
      (host) => req.routes.map((route) => ({
        route,
        open: async (page) => {
          const response = await page.goto(`http://${host}:${req.port}${route}`, { waitUntil: 'networkidle', timeout: 45_000 });
          // A refusal or "not found" is the server's own page. Measuring it, or asking a reviewer about it, judges nothing of the product.
          return !response || response.status() >= 400 ? `HTTP ${response?.status() ?? 'no response'}: the route did not serve the app` : null;
        },
      })),
      { sealed: false, everyFirst: false, reviewAt: null },
    ).then((ran) => ran.report);
  }

  /**
   * The same audit over a design task's mock-up pages: the same measurements against the same contract, the
   * same copy lint, the same reviewer. What is built is held to these; a drawing of it that was not would be a
   * promise nobody had checked, and the owner chooses a build by it.
   *
   * Each page is a first screen and is judged as one, in light and in dark. The reviewer is asked once per
   * page, at the size the product is first met at, and is told it is looking at a mock-up. `slopByRoute` is
   * that reviewer's score for each page it saw.
   */
  auditPages(req: PageAuditRequest): Promise<{ report: AuditReport; slopByRoute: Map<string, number> }> {
    const primary: ViewportId = req.project.template === 'mobile-expo' ? 'iphone-15-pro' : 'desktop-1440';
    const measured = auditViewports(req.project.template, this.#config.audit.viewports);
    return this.#run(
      { ...req, routes: req.pages.map((p) => p.route) },
      () => req.pages.map(({ route, html }) => ({ route, open: async (page) => (await page.setContent(html, { waitUntil: 'load', timeout: 20_000 }), null) })),
      { sealed: true, everyFirst: true, reviewAt: [measured.includes(primary) ? primary : (measured[0] ?? primary)] },
    );
  }

  async #run(req: Omit<AuditRequest, 'port'>, subjectsFor: (host: string) => Subject[], mode: Mode): Promise<{ report: AuditReport; slopByRoute: Map<string, number> }> {
    const auditId = newId('aud');
    const scope = { projectId: req.project.id, taskId: req.taskId };

    const findings: Finding[] = [];
    const screenshots: AuditReport['screenshots'] = [];
    const reviews: ScreenReview[] = [];
    const copy: CopyAudit[] = [];
    const measures: AccessMeasures = { contrast: { passed: 0, total: 0 }, touchTargets: { passed: 0, total: 0 }, pressAnswer: { passed: 0, total: 0 }, focusVisible: { passed: 0, total: 0 }, layoutShift: null };
    // The studio's own repository has no template an owner could pick; its screens are a web application's.
    const template: Template = req.project.template === 'studio-core' ? 'web-vite-react' : req.project.template;
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
      const subjects = subjectsFor(host);
      const audited = auditViewports(req.project.template, this.#config.audit.viewports);
      // Screens are tried by hand at one size: the one the product is first used at. A phone app under a thumb; a
      // web product at a desk, where the pointer hovers and the keyboard is a way in.
      const tried: ViewportId = req.project.template !== 'mobile-expo' && audited.includes('desktop-1440') ? 'desktop-1440' : (audited[0] ?? 'iphone-15-pro');
      for (const viewport of audited) {
        const spec = viewports[viewport];
        for (const [routeIndex, subject] of subjects.entries()) {
          if (req.signal?.aborted) throw req.signal.reason;
          const route = subject.route;
          const first = mode.everyFirst || routeIndex === 0;
          const light = await this.#capture(browser, spec, 'light', subject, true, mode.sealed);
          if (!light.digest) {
            findings.push(loadFailure(viewport, route, light.error));
            continue;
          }
          const viewportWidth = spec.context.viewport?.width ?? light.digest.width;
          const measured = runDomChecks(light.digest, { viewport, viewportWidth, route, touch: spec.touch, scope: 'full' }, contract);
          findings.push(...measured);
          // The words, read apart from how they are set. The design reviewer below is not shown these findings as
          // measured defects to skip: copy is on its rubric too, and it reads the page as a picture.
          const words = auditCopy(light.digest, { viewport, route }, contract);
          copy.push(words);
          findings.push(...words.findings);
          const access = measureAccess(light.digest, { touch: spec.touch }, contract);
          for (const key of ['contrast', 'touchTargets'] as const) {
            measures[key].passed += access[key].passed;
            measures[key].total += access[key].total;
          }
          if (light.shift !== null) measures.layoutShift = Math.max(measures.layoutShift ?? 0, light.shift);
          // Tried by hand: pressed and held, tabbed through. On a page of its own, since trying leaves marks.
          const probe = viewport === tried && routeIndex < MAX_PROBED_ROUTES ? await this.#probe(browser, spec, subject, mode.sealed) : null;
          if (probe) {
            measures.pressAnswer.passed += probe.press.answered;
            measures.pressAnswer.total += probe.press.probed;
            measures.focusVisible.passed += probe.focus.visible;
            measures.focusVisible.total += probe.focus.probed;
          }
          findings.push(...interactionFindings(probe, viewport === tried ? light.shift : null, { viewport, route, touch: spec.touch }));

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
          if (first) {
            const dark = await this.#capture(browser, spec, 'dark', subject, false, mode.sealed);
            if (dark.digest) {
              const darkFindings = runDomChecks(dark.digest, { viewport, viewportWidth, route, touch: spec.touch, scope: 'color-only' }, contract);
              findings.push(...darkFindings.map((f) => ({ ...f, rule: `${f.rule}@dark`, message: `In dark mode: ${f.message}` })));
            }
          }

          if (light.folds.length === 0 || (mode.reviewAt !== null && !mode.reviewAt.includes(viewport))) continue;
          screens += 1;
          if (stopped !== null) continue;
          try {
            const answered = await this.#vision.review({ scope, viewport, route, template, firstScreen: first, mockup: mode.sealed, folds: light.folds, digest: light.digest, measured, signal: req.signal });
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
    const trapped = findings.some(isTrap);
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
      copy: summariseCopy(copy),
      measures,
      // Only a reviewer who saw the first screen can say whether there was anything on it to look at.
      livingVisual: reviews.some((r) => mode.everyFirst || r.route === req.routes[0]) ? !findings.some((f) => f.rule === LIVING_VISUAL_RULE && f.severity === 'blocker') : null,
    };
    this.#store.insertAudit(report);
    if (!visionReviewed) {
      this.#events.emit(scope, { type: 'notice', level: 'warn', message: `Design review ${reviewed > 0 ? `covered ${reviewed} of ${screens} screens` : 'did not run'} (${vision.reason}). The design is not verified: the audit score is capped at ${UNREVIEWED_SCORE_CAP} and the audit does not pass.` });
    }
    this.#events.emit(scope, { type: 'audit.completed', auditId, score: verdict.score, passed: verdict.passed, blockers: verdict.blockers, majors: verdict.majors, minors: verdict.minors, visionReviewed, grade: verdict.grade });
    return { report, slopByRoute: new Map(reviews.map((r) => [r.route, r.slopScore])) };
  }

  /**
   * Tries one screen by hand (see `probeInteraction`). In a context of its own: motion is left as most people
   * have it, because a press that is answered by movement has not failed just because the audit's other pages
   * ask for less of it. Null when the page would not open; that is already a finding from the capture.
   */
  async #probe(browser: Browser, spec: ViewportSpec, subject: Subject, sealed: boolean): Promise<Touchability | null> {
    const context = await browser.newContext({ ...spec.context, serviceWorkers: 'block', ...(sealed ? { javaScriptEnabled: false, offline: true } : {}) });
    try {
      const page = await context.newPage();
      if ((await subject.open(page)) !== null) return null;
      await settle(page, sealed);
      return await probeInteraction(page, { touch: spec.touch });
    } catch (err) {
      this.#log.warn({ err: errorMessage(err), route: subject.route }, 'a screen could not be tried by hand');
      return null;
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async #capture(browser: Browser, spec: ViewportSpec, scheme: 'light' | 'dark', subject: Subject, screenshots: boolean, sealed: boolean): Promise<{ digest: PageDigest | null; folds: Buffer[]; shift: number | null; error: string }> {
    const context = await browser.newContext({ ...spec.context, colorScheme: scheme, reducedMotion: 'reduce', serviceWorkers: 'block', ...(sealed ? { javaScriptEnabled: false, offline: true } : {}) });
    try {
      const page = await context.newPage();
      const failed = await subject.open(page);
      if (failed !== null) return { digest: null, folds: [], shift: null, error: failed };
      await settle(page, sealed);
      const digest = PageDigest.safeParse(await page.evaluate(collectDigest, 600));
      if (!digest.success) return { digest: null, folds: [], shift: null, error: 'the page returned measurements that failed validation' };
      // A sealed page runs nothing that could be waited on, and has nothing arriving late to shift it.
      const shift = sealed || !screenshots ? null : z.number().min(0).max(100).nullable().catch(null).parse(await page.evaluate(layoutShift).catch(() => null));

      const folds: Buffer[] = [];
      if (screenshots) {
        const { width, height, scrollHeight } = digest.data;
        for (let fold = 0; fold < this.#config.audit.maxFolds && fold * height < scrollHeight; fold++) {
          folds.push(await page.screenshot({ type: 'png', fullPage: true, animations: 'disabled', clip: { x: 0, y: fold * height, width, height: Math.min(height, scrollHeight - fold * height) } }));
        }
      }
      return { digest: digest.data, folds, shift, error: '' };
    } catch (err) {
      return { digest: null, folds: [], shift: null, error: errorMessage(err).split('\n')[0] ?? 'navigation failed' };
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}

/**
 * Wait for web fonts and a quiet frame, so the measurements describe the final layout rather than a fallback.
 * A sealed page runs no callbacks of its own for the studio to wait on, and its fonts are inside it: it gets a
 * moment to lay out instead.
 */
async function settle(page: Page, sealed = false): Promise<void> {
  if (sealed) return page.waitForTimeout(250);
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
      return `- [${f.severity}] ${f.rule} (${f.rule.startsWith(COPY_RULE_PREFIX) ? 'copy lint' : f.source === 'dom' ? 'measured' : 'design review'})\n  ${where}\n  ${f.message}\n  Fix: ${f.fix ?? 'n/a'}`;
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

  const habits = report.findings.filter((f) => f.rule.startsWith(COPY_RULE_PREFIX) && f.severity !== 'minor').length;
  return [
    `Visual audit score ${report.score}/100, required ${report.threshold} with no blockers${habits > 0 ? ` and no copy habits (${habits} found: rewrite the quoted wording, do not restyle it)` : ''}.`,
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

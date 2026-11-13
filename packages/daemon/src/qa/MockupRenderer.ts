import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import type { AuditReport, Finding, FlowWalk, MockupMeasures, Project, ViewportId } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { SCREEN_SPEC_FILE, readScreenSpec, type FlowTask } from '../scratch/ScreenSpec.ts';
import { errorMessage, newId, type Clock, type Logger } from '../util/core.ts';
import { COPY_RULE_PREFIX, distinctDefects } from './checks.ts';
import { contactSheet, type Tile } from './filmstrip.ts';
import { walkFlow, walkProblems } from './FlowWalker.ts';
import { withFaces } from './mockupFaces.ts';
import type { QaBrowser } from './QaBrowser.ts';
import { findingLines, type VisualAuditor } from './VisualAuditor.ts';

/** Where a design task leaves its mock-ups: one self-contained page per direction. */
export const MOCKUP_DIR = 'docs/mockups';
export const MOCKUP_FILES = ['a.html', 'b.html', 'c.html'] as const;
/** Where a mock-up's pictures are kept. A page points at them as `assets/<name>`; the studio puts them inside the page. */
export const MOCKUP_ASSET_DIR = `${MOCKUP_DIR}/assets`;
/** At least this many directions have to be drawn: one picture is a proposal, two are a choice. */
export const MIN_MOCKUPS = 2;
const MAX_HTML_BYTES = 400 * 1024;
/** One picture, and all the pictures of one page, as files. Past these a page is no longer something to send whole. */
const MAX_ASSET_BYTES = 900 * 1024;
const MAX_PAGE_ASSET_BYTES = 2400 * 1024;

/** A reference to one of the page's pictures, where a URL goes: after a quote or an opening bracket, up to the closing one. */
const ASSET_REF = /(["'(])(?:\.\/)?assets\/([A-Za-z0-9][A-Za-z0-9_.-]{0,80}\.(png|jpe?g|webp))(?=["')])/g;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' } as const;

/** A mock-up page as it is shown and measured: complete in itself. */
export interface MockupSource {
  /** Path in the workspace, e.g. `docs/mockups/b.html`. */
  file: string;
  html: string;
}

/** One direction as the owner sees it: a picture, the direction's own name and one-line idea, and what was measured on it. */
export interface MockupOption {
  file: string;
  /** From the page's <title> and description. Written by a model: shown as text, never interpreted. */
  title: string;
  idea: string;
  artifactId: string;
  width: number;
  height: number;
  /** The core flow as a browser carried it out on this page. Null when there was no flow to walk, or it could not be walked. */
  flow?: FlowWalk | null;
  /** What this page's audit came to. Null when the audit did not run. */
  measures?: MockupMeasures | null;
}

/** A design task's mock-ups, drawn and measured. */
export interface MockupMeasurement {
  options: MockupOption[];
  /** The audit over all the pages. Null when it could not run (no browser, no auditor). */
  audit: AuditReport | null;
  /** What the walks found wrong, page by page, as sentences for the pages' author. */
  flowProblems: { file: string; problems: string[] }[];
}

/**
 * One page as the studio's measurement sees it, for the engine that is still drawing it. `missing`: there is
 * no such page. `not-drawn`: the browser could not be had; that is the studio's failure and says nothing of the page.
 */
export type MockupCheck =
  | { status: 'missing' }
  | { status: 'not-drawn' }
  | {
      status: 'measured';
      option: MockupOption;
      /** Why the core flow was not walked, when it was not: the screen spec does not hold. */
      specProblems: string[];
      flowProblems: string[];
      /** Distinct defects over every size. Null when the page was drawn but could not be measured. */
      findings: Finding[] | null;
      viewports: ViewportId[];
    };

/** A check as the text its engine reads. The page's own words appear in it: callers fence it as data. */
export function renderMockupCheck(file: string, check: Extract<MockupCheck, { status: 'measured' }>): string {
  const lines = [`${file} as the studio shows and measures it: scripts off, network off${check.viewports.length > 0 ? `, at ${check.viewports.join(', ')}, in light and in dark` : ''}.`, ''];
  const walked = check.option.flow?.tasks ?? [];
  if (check.specProblems.length > 0) {
    lines.push(`Core flow: not walked. ${SCREEN_SPEC_FILE} does not hold as the screen spec, so there is no flow to carry out:`, ...check.specProblems.slice(0, 6).map((line) => `- ${line}`));
  } else if (check.flowProblems.length > 0) {
    lines.push(`Core flow: ${walked.filter((t) => t.reached).length} of ${walked.length} task(s) could be carried out to their outcome.`, ...check.flowProblems.map((line) => `- ${line}`));
  } else if (walked.length > 0) {
    lines.push(`Core flow: every task was carried out to its outcome (${walked.map((t) => `${t.id}: ${t.presses} press${t.presses === 1 ? '' : 'es'}${t.scrolls > 0 ? `, ${t.scrolls} scrolled to` : ''}`).join('; ')}).`);
  } else {
    lines.push('Core flow: could not be walked on this page.');
  }
  lines.push('');
  if (check.findings === null) {
    lines.push('The page was drawn but could not be measured this time. It is measured again when you stop.');
  } else {
    const count = (severity: Finding['severity']): number => check.findings!.filter((f) => f.severity === severity).length;
    lines.push(`Measured: ${count('blocker')} blocker, ${count('major')} major, ${count('minor')} minor.`, ...findingLines(check.findings, 24));
    if (check.findings.length > 24) lines.push(`(${check.findings.length - 24} more, of lower severity)`);
  }
  const clean = check.specProblems.length === 0 && check.flowProblems.length === 0 && check.findings !== null && !check.findings.some((f) => f.severity !== 'minor');
  lines.push('', clean ? 'Nothing here holds the page back. What is left is a judgement this check does not make: a design reviewer looks at the page once, after you stop.' : 'Fix these in the page itself and check it again. Blockers and majors hold a page back; minors do not.');
  return lines.join('\n');
}

/**
 * Draws a design task's directions so the owner can choose with their eyes, and measures them so the choice is
 * not only by eye.
 *
 * Before this, a deep-track task ended in four documents and a button: the owner approved a build without
 * having seen anything, and found out what the words meant an hour and a million tokens later. Then the task
 * also wrote each direction as one self-contained HTML page, and those pages were turned into pictures. A
 * picture of one frozen moment still said nothing about how the thing is operated, and nobody had checked the
 * page: text ran under toasts, titles fell back to the system serif, and where a photograph belonged there was
 * a sentence describing it.
 *
 * So a mock-up is now a page that can be operated (CSS states, still no scripts), and it is put through what a
 * build is put through: the audit (`VisualAuditor.auditPages`), and a walk through the core flow of the screen
 * spec (`walkFlow`), filmed. The pictures it points at and the theme's faces are put inside the page first, so
 * that what is measured here is exactly what the owner's app shows.
 *
 * A mock-up is a page an agent wrote, so it is rendered like any other page the studio did not write: in the
 * QA browser container, with scripts off and the network off. What crosses back to the host is pictures,
 * numbers, and two short strings read from the document's head.
 */
export class MockupRenderer {
  readonly #config: Config;
  readonly #store: Store;
  readonly #sandboxes: OrbStackManager;
  readonly #browser: QaBrowser;
  readonly #auditor: (Pick<VisualAuditor, 'auditPages'> & Partial<Pick<VisualAuditor, 'measurePages'>>) | null;
  readonly #clock: Clock;
  readonly #log: Logger;

  constructor(deps: { config: Config; store: Store; sandboxes: OrbStackManager; browser: QaBrowser; auditor?: (Pick<VisualAuditor, 'auditPages'> & Partial<Pick<VisualAuditor, 'measurePages'>>) | null; clock: Clock; log: Logger }) {
    this.#config = deps.config;
    this.#store = deps.store;
    this.#sandboxes = deps.sandboxes;
    this.#browser = deps.browser;
    this.#auditor = deps.auditor ?? null;
    this.#clock = deps.clock;
    this.#log = deps.log;
  }

  /** One mock-up page, complete in itself: its pictures and the theme's faces inside it. Null when the file is not there. */
  async page(project: Project, file: string, signal?: AbortSignal): Promise<MockupSource | null> {
    if (!MOCKUP_FILES.some((name) => `${MOCKUP_DIR}/${name}` === file)) return null;
    const read = await this.#sandboxes.exec(project, `[ -f ${file} ] && head -c ${MAX_HTML_BYTES} ${file}`, { timeoutSec: 20, maxOutputBytes: MAX_HTML_BYTES + 1024, signal });
    if (read.exitCode !== 0 || read.stdout.trim() === '') return null;
    return { file, html: withFaces(await this.#withPictures(project, read.stdout, signal)) };
  }

  /** Whichever of the mock-up pages exist, each complete in itself. */
  async pages(project: Project, signal?: AbortSignal): Promise<MockupSource[]> {
    const pages: MockupSource[] = [];
    for (const name of MOCKUP_FILES) {
      const page = await this.page(project, `${MOCKUP_DIR}/${name}`, signal);
      if (page) pages.push(page);
    }
    return pages;
  }

  /**
   * Puts a page's pictures inside it. A page points at `assets/<name>.jpg`; shown with the network off, that
   * address leads nowhere, so each file is read from the workspace and written into the page as data. Only
   * plain names in the mock-ups' own asset folder are read, and only pictures. A file that is missing or too
   * large is left as it was: the page then shows a broken picture, which the audit sees.
   */
  async #withPictures(project: Project, html: string, signal?: AbortSignal): Promise<string> {
    const names = [...new Set([...html.matchAll(ASSET_REF)].map((m) => m[2]!))].filter((name) => !name.includes('..'));
    if (names.length === 0) return html;
    const data = new Map<string, string>();
    let total = 0;
    for (const name of names.slice(0, 12)) {
      const file = `${MOCKUP_ASSET_DIR}/${name}`;
      // The size first, so a large file is never read; then the bytes as text the exec channel can carry.
      const res = await this.#sandboxes.exec(project, `[ -f ${file} ] && [ "$(wc -c < ${file})" -le ${MAX_ASSET_BYTES} ] && base64 < ${file} | tr -d '\\n'`, { timeoutSec: 30, maxOutputBytes: Math.ceil(MAX_ASSET_BYTES * 1.4) + 1024, signal });
      const encoded = res.stdout.trim();
      if (res.exitCode !== 0 || !/^[A-Za-z0-9+/]+=*$/.test(encoded)) continue;
      total += encoded.length;
      if (total > MAX_PAGE_ASSET_BYTES * 1.4) break;
      const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase() as keyof typeof MIME;
      data.set(name, `data:${MIME[ext]};base64,${encoded}`);
    }
    return html.replace(ASSET_REF, (whole, open: string, name: string) => (data.has(name) ? `${open}${data.get(name)!}` : whole));
  }

  /** Renders whichever of the mock-up files exist. An empty list means none could be drawn; that never fails a task. */
  async render(project: Project, signal?: AbortSignal, tasks: readonly FlowTask[] = []): Promise<MockupOption[]> {
    try {
      return await this.#draw(project, await this.pages(project, signal), tasks, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      // The sandbox not answering is the studio's problem: the documents stand, and the owner is told there are no pictures.
      this.#log.warn({ projectId: project.id, err: errorMessage(err) }, 'mock-ups could not be read');
      return [];
    }
  }

  /** Draws pages that have been read, and walks `tasks` on each. */
  async #draw(project: Project, pages: readonly MockupSource[], tasks: readonly FlowTask[], signal?: AbortSignal): Promise<MockupOption[]> {
    const options: MockupOption[] = [];
    if (pages.length === 0) return options;
    try {

      // A phone product is looked at on a phone; everything else at a desk.
      const phone = project.template === 'mobile-expo';
      const frame = phone ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
      const dir = join(this.#config.artifactsDir, project.id, 'mockups');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const keep = async (bytes: Uint8Array): Promise<string> => {
        const artifactId = newId('art');
        const target = join(dir, `${artifactId}.png`);
        await writeFile(target, bytes, { mode: 0o600 });
        this.#store.insertArtifact({ id: artifactId, projectId: project.id, mime: 'image/png', file: target, createdAt: this.#clock() });
        return artifactId;
      };
      await this.#browser.use(project, signal, async ({ browser }) => {
        // Scripts off, network off: nothing in the page gets to run or to call out. It is still operated, by CSS states.
        const context = await browser.newContext({ ...frame, javaScriptEnabled: false, offline: true });
        try {
          for (const { file, html } of pages) {
            if (signal?.aborted) throw signal.reason;
            const page = await context.newPage();
            try {
              await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
              const title = (await page.title()).replace(/\s+/g, ' ').trim().slice(0, 80);
              const idea = ((await page.locator('meta[name="description"]').first().getAttribute('content', { timeout: 2000 }).catch(() => null)) ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
              const artifactId = await keep(await page.screenshot({ type: 'png', animations: 'disabled' }));
              const flow = tasks.length === 0 ? null : await this.#walk(browser, page, tasks, { phone, keep }).catch((err: unknown) => {
                if (signal?.aborted) throw err;
                this.#log.warn({ projectId: project.id, file, err: errorMessage(err) }, 'a mock-up could not be walked');
                return null;
              });
              options.push({ file, title: title || file, idea, artifactId, width: frame.viewport.width, height: frame.viewport.height, flow });
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

  /** Walks the core flow on a page that is open and at rest, and keeps the film of it. */
  async #walk(browser: Browser, page: Page, tasks: readonly FlowTask[], p: { phone: boolean; keep: (bytes: Uint8Array) => Promise<string> }): Promise<FlowWalk> {
    const walk = await walkFlow(page, tasks, { touch: p.phone });
    // The sheet is laid out by the studio's own script, so in a context where scripts run. It loads nothing but the frames.
    const tile: Tile = p.phone ? { width: 236, height: 512, caption: 28, columns: 6, gap: 8 } : { width: 480, height: 300, caption: 28, columns: 3, gap: 8 };
    // The captions are the studio's and are read by the owner: where in the flow each picture was taken.
    const frames = walk.frames.map((f) => ({ jpeg: f.jpeg, label: f.task === null ? '처음 화면' : `${f.task + 1}단계 · ${f.step}번째 누름 뒤` }));
    const sheets = await browser.newContext({ offline: true });
    try {
      const { sheet } = await contactSheet(() => sheets.newPage(), frames, { tile });
      return { tasks: walk.tasks, filmArtifactId: await p.keep(sheet) };
    } catch {
      return { tasks: walk.tasks, filmArtifactId: null };
    } finally {
      await sheets.close().catch(() => undefined);
    }
  }

  /**
   * One page, as its engine asks to see it while still drawing: drawn, its core flow walked and filmed, and
   * measured at every size, with no reviewer asked and nothing recorded as an audit. The same browser, the same
   * checks and the same contract the finished set is held to, so what this says is what that will say.
   */
  async check(project: Project, file: string, signal?: AbortSignal): Promise<MockupCheck> {
    const page = await this.page(project, file, signal);
    if (!page) return { status: 'missing' };
    let specProblems: string[] = [];
    let tasks: FlowTask[] = [];
    try {
      const spec = readScreenSpec((await this.#sandboxes.readFile(project, SCREEN_SPEC_FILE, 400_000)).content);
      if (spec.ok) tasks = spec.spec.tasks.map(({ id, goal, outcome }) => ({ id, goal, outcome }));
      else specProblems = spec.problems;
    } catch (err) {
      if (signal?.aborted) throw err;
      specProblems = [`${SCREEN_SPEC_FILE} is missing.`];
    }
    const [option] = await this.#draw(project, [page], tasks, signal);
    if (!option) return { status: 'not-drawn' };
    const touch = project.template === 'mobile-expo';
    const flowProblems = tasks.length === 0 ? [] : option.flow ? walkProblems(option.flow, tasks, { touch }) : ['the page could not be walked: the browser gave up on it before the first press.'];
    let findings: Finding[] | null = null;
    let viewports: ViewportId[] = [];
    if (this.#auditor?.measurePages) {
      try {
        const measured = await this.#auditor.measurePages({ project, taskId: null, pages: [{ route: page.file, html: page.html }], signal });
        findings = distinctDefects(measured.findings);
        viewports = measured.viewports;
      } catch (err) {
        if (signal?.aborted) throw err;
        this.#log.warn({ projectId: project.id, file, err: errorMessage(err) }, 'a mock-up could not be measured for its engine');
      }
    }
    const measures: MockupMeasures | null = findings === null ? null : { blockers: findings.filter((f) => f.severity === 'blocker').length, majors: findings.filter((f) => f.severity === 'major').length, copyHabits: findings.filter((f) => f.rule.startsWith(COPY_RULE_PREFIX) && f.severity !== 'minor').length, slopScore: null };
    return { status: 'measured', option: { ...option, measures }, specProblems, flowProblems, findings, viewports };
  }

  /**
   * Everything the studio can say about a design task's mock-ups without being asked: each page drawn, its
   * core flow walked and filmed, and all of them audited. Whatever part cannot be had (no browser, no
   * reviewer) is left out and said so by its absence; none of it throws.
   */
  async measure(project: Project, p: { taskId: string | null; tasks: readonly FlowTask[]; signal?: AbortSignal }): Promise<MockupMeasurement> {
    let pages: MockupSource[];
    try {
      pages = await this.pages(project, p.signal);
    } catch (err) {
      if (p.signal?.aborted) throw err;
      this.#log.warn({ projectId: project.id, err: errorMessage(err) }, 'mock-ups could not be read');
      return { options: [], audit: null, flowProblems: [] };
    }
    const drawn = await this.#draw(project, pages, p.tasks, p.signal);
    if (drawn.length === 0) return { options: [], audit: null, flowProblems: [] };
    const touch = project.template === 'mobile-expo';
    const flowProblems = drawn.flatMap((o) => {
      const problems = o.flow ? walkProblems(o.flow, p.tasks, { touch }) : [];
      return problems.length > 0 ? [{ file: o.file, problems }] : [];
    });

    let audited: Awaited<ReturnType<VisualAuditor['auditPages']>> | null = null;
    if (this.#auditor) {
      try {
        audited = await this.#auditor.auditPages({ project, taskId: p.taskId, pages: pages.map((page) => ({ route: page.file, html: page.html })), signal: p.signal });
      } catch (err) {
        if (p.signal?.aborted) throw err;
        this.#log.warn({ projectId: project.id, err: errorMessage(err) }, 'mock-ups could not be audited');
      }
    }
    const defects = audited ? distinctDefects(audited.report.findings) : [];
    const options = drawn.map((o): MockupOption => {
      if (!audited) return { ...o, measures: null };
      const mine = defects.filter((f) => f.route === o.file);
      return {
        ...o,
        measures: {
          blockers: mine.filter((f) => f.severity === 'blocker').length,
          majors: mine.filter((f) => f.severity === 'major').length,
          copyHabits: mine.filter((f) => f.rule.startsWith(COPY_RULE_PREFIX) && f.severity !== 'minor').length,
          slopScore: audited.slopByRoute.get(o.file) ?? null,
        },
      };
    });
    return { options, audit: audited?.report ?? null, flowProblems };
  }
}

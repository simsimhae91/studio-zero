import { lintSources } from '@studio-zero/design';
import { isAdopted, type AuditReport, type Eval, type EvalSpec, type Finding, type Project } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { scoreAudit } from '../qa/checks.ts';
import { renderAuditFeedback, type VisualAuditor } from '../qa/VisualAuditor.ts';
import { extractorScript, parseExtraction } from '../sandbox/extract.ts';
import { SCREEN_SPEC_FILE, coreStates, readScreenSpec, stateLabel, type NamedState } from '../scratch/ScreenSpec.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { errorMessage, excerpt, newId, type Clock } from '../util/core.ts';
import { ensureDevServer } from './devServer.ts';
import { readProjectFile } from './projectFile.ts';

export interface EvalOutcome {
  eval: Eval;
  passed: boolean;
  /**
   * The check could not reach a verdict, and nothing in the work is known to be wrong: the visual audit's
   * measurements are clean but no design reviewer saw the screens. Not a pass, and not a failure to send back
   * to the engine, which has nothing to fix.
   */
  unverified?: boolean;
  /**
   * Unverified for a reason that passes with time: every reviewer that could have judged it is at a usage or
   * budget limit. The task waits for one of them instead of ending without a verdict.
   */
  waitable?: boolean;
  /** Human- and model-readable account of the failure (or a one-line pass note). Contains sandbox/page content. */
  detail: string;
  audit: AuditReport | null;
}

const MAX_COMMAND_EVALS = 12;

/**
 * The project's regression suite. Definitions live in the daemon's database, not in the workspace, so the
 * agent whose work is being checked can neither edit nor delete them; only the owner can disable one.
 *
 * Three kinds: a shell command that must exit 0, the static slop lint, and the visual audit.
 */
export class EvalRunner {
  readonly #config: Config;
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #sandboxes: OrbStackManager;
  readonly #auditor: VisualAuditor;
  readonly #clock: Clock;

  constructor(deps: { config: Config; store: Store; events: EventLog; sandboxes: OrbStackManager; auditor: VisualAuditor; clock: Clock }) {
    this.#config = deps.config;
    this.#store = deps.store;
    this.#events = deps.events;
    this.#sandboxes = deps.sandboxes;
    this.#auditor = deps.auditor;
    this.#clock = deps.clock;
  }

  /**
   * Every project starts with the two design gates. Command evals are earned later, from commands that passed.
   * The studio's own repository starts with its test suite and its build instead of a visual audit: what has
   * to hold there is that the studio still works.
   */
  seed(project: Project): void {
    // A product that was brought in has its own design: the slop lint reads a project against the house's theme
    // and would find a stranger's product guilty of not being ours. The browser's switch it gets like any other.
    if (!isAdopted(project)) this.#add(project.id, 'slop-lint', { kind: 'slop-lint', maxMajor: 0 }, null);
    if (project.template === 'studio-core') {
      this.#add(project.id, 'tests', { kind: 'command', command: 'pnpm test', timeoutSec: 900 }, null);
      this.#add(project.id, 'build', { kind: 'command', command: 'pnpm build', timeoutSec: 600 }, null);
      return;
    }
    this.#add(project.id, 'visual-audit', { kind: 'visual', routes: ['/'], minScore: this.#config.audit.threshold }, null);
  }

  /**
   * Promotes a command the agent ran successfully into a standing regression check. Refused when its exit code is
   * not its own verdict (see `keepsItsVerdict`), and when it is a check the project already has, however it was
   * typed: the type check the compiler gate runs first in every round, or a command already kept.
   */
  addCommandEval(projectId: string, name: string, command: string, timeoutSec: number, originTaskId: string): boolean {
    const existing = this.#store.listEvals(projectId);
    if (existing.filter((e) => e.spec.kind === 'command').length >= MAX_COMMAND_EVALS) return false;
    if (!keepsItsVerdict(command)) return false;
    const bare = bareCommand(command);
    if (/^(pnpm|yarn|npm run)( --silent)? typecheck$/.test(bare)) return false;
    if (existing.some((e) => e.spec.kind === 'command' && bareCommand(e.spec.command) === bare)) return false;
    return this.#add(projectId, name, { kind: 'command', command, timeoutSec }, originTaskId);
  }

  #add(projectId: string, name: string, spec: EvalSpec, originTaskId: string | null): boolean {
    return this.#store.insertEvalIfAbsent({ id: newId('evl'), projectId, name, spec, enabled: true, originTaskId, createdAt: this.#clock() });
  }

  /**
   * Whether this project's checks may use the browser. The visual eval is the owner's switch for that: with it
   * off, nothing in a verification round starts the browser container, the smoke load included.
   */
  usesBrowser(projectId: string): boolean {
    return this.#store.listEvals(projectId).some((e) => e.enabled && e.spec.kind === 'visual');
  }

  /**
   * Runs every enabled eval. `extraRoutes` are audited in addition to the project's own (e.g. routes a plan
   * added). `commandsOnly` leaves out the design gates (slop lint, visual audit). `devServerRunning` says a
   * check earlier in this round already started the dev server on the current code, so it is not restarted.
   */
  async runAll(project: Project, taskId: string | null, opts: { extraRoutes?: string[]; commandsOnly?: boolean; devServerRunning?: boolean; signal?: AbortSignal } = {}): Promise<EvalOutcome[]> {
    const outcomes: EvalOutcome[] = [];
    const evals = this.#store.listEvals(project.id).filter((e) => e.enabled && !(opts.commandsOnly && e.spec.kind !== 'command'));
    // Cheap checks first: there is no point starting a browser for a build that does not compile.
    const order = { command: 0, 'slop-lint': 1, visual: 2 } as const;
    for (const ev of evals.sort((a, b) => order[a.spec.kind] - order[b.spec.kind])) {
      if (opts.signal?.aborted) throw opts.signal.reason;
      if (ev.spec.kind === 'visual' && outcomes.some((o) => !o.passed && o.eval.spec.kind === 'command')) continue;
      const started = Date.now();
      let outcome: EvalOutcome;
      try {
        outcome = await this.#run(project, taskId, ev, opts);
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        outcome = { eval: ev, passed: false, detail: `eval could not run: ${errorMessage(err)}`, audit: null };
      }
      const durationMs = Date.now() - started;
      this.#store.insertEvalRun({ evalId: ev.id, taskId, passed: outcome.passed, durationMs, detail: excerpt(outcome.detail, 4000), createdAt: this.#clock() });
      this.#events.emit({ projectId: project.id, taskId }, { type: 'eval.result', evalId: ev.id, name: ev.name, passed: outcome.passed, ...(outcome.unverified ? { unverified: true } : {}), durationMs, detail: excerpt(outcome.detail, 800) });
      outcomes.push(outcome);
    }
    return outcomes;
  }

  async #run(project: Project, taskId: string | null, ev: Eval, opts: { extraRoutes?: string[]; devServerRunning?: boolean; signal?: AbortSignal }): Promise<EvalOutcome> {
    const spec = ev.spec;
    switch (spec.kind) {
      case 'command': {
        const res = await this.#sandboxes.exec(project, spec.command, { timeoutSec: spec.timeoutSec, signal: opts.signal });
        const passed = res.exitCode === 0;
        return { eval: ev, passed, audit: null, detail: passed ? `exit 0 in ${res.durationMs}ms` : `\`${spec.command}\` exited ${res.exitCode}${res.timedOut ? ' (timed out)' : ''}\n${excerpt(`${res.stdout}\n${res.stderr}`.trim(), 6000)}` };
      }
      case 'slop-lint': {
        const findings = await this.lint(project);
        const serious = findings.filter((f) => f.severity !== 'minor');
        const passed = serious.length <= spec.maxMajor;
        return { eval: ev, passed, audit: null, detail: passed ? `${findings.length} minor findings` : renderLintFeedback(findings) };
      }
      case 'visual': {
        const file = await readProjectFile(this.#sandboxes, project, this.#config);
        const routes = [...new Set([...spec.routes, ...file.routes, ...(opts.extraRoutes ?? [])])].slice(0, 8);
        const server = await ensureDevServer(this.#sandboxes, project, file, { reuse: opts.devServerRunning === true, current: true });
        if (!server.ready) {
          return { eval: ev, passed: false, audit: null, detail: `The dev server (\`${file.dev.command}\`) did not answer on port ${file.dev.port} within 90s.\n${excerpt(server.log, 4000)}` };
        }
        // The states the screen spec lists on the core flow's screens: looked at where the project says they can be seen, and said where it does not.
        const owed = await this.#owedStates(project);
        const shown = owed.flatMap((state) => {
          const at = file.states.find((s) => s.screen === state.screen && s.name.trim() === state.name);
          return at ? [{ label: stateLabel(state), route: at.route }] : [];
        });
        const missingStates = owed.filter((state) => !file.states.some((s) => s.screen === state.screen && s.name.trim() === state.name)).map(stateLabel);
        const audit = await this.#auditor.audit({ project, taskId, port: file.dev.port, routes, states: shown.slice(0, 6), missingStates, signal: opts.signal });
        return { eval: ev, audit, ...visualOutcome(audit, spec.minScore) };
      }
    }
  }

  /**
   * A draft's one look (see `VisualAuditor.measureDraft`): the first route the project lists, on the dev server
   * the smoke gate has just loaded. Null when the server is not there to look at. Not an eval: nothing passes
   * or fails by it.
   */
  async measureDraft(project: Project, taskId: string, opts: { signal?: AbortSignal } = {}): Promise<AuditReport | null> {
    const file = await readProjectFile(this.#sandboxes, project, this.#config);
    const listed = this.#store.listEvals(project.id).flatMap((e) => (e.enabled && e.spec.kind === 'visual' ? e.spec.routes : []));
    // The smoke gate loaded the app a moment ago: its server is either answering or this is not the time to start one.
    if (!(await this.#sandboxes.waitForHttp(project, file.dev.port, '/', 2))) return null;
    return this.#auditor.measureDraft({ project, taskId, port: file.dev.port, routes: [[...listed, ...file.routes][0] ?? '/'], signal: opts.signal });
  }

  /** The states this project's screen spec owes a way to see. None when it has no spec, or one that does not hold. */
  async #owedStates(project: Project): Promise<NamedState[]> {
    const res = await this.#sandboxes.exec(project, `[ -f ${SCREEN_SPEC_FILE} ] && head -c 262144 ${SCREEN_SPEC_FILE}`, { timeoutSec: 20, maxOutputBytes: 300_000 }).catch(() => null);
    if (!res || res.exitCode !== 0 || res.stdout.trim() === '') return [];
    const spec = readScreenSpec(res.stdout);
    return spec.ok ? coreStates(spec.spec) : [];
  }

  /** Static slop lint over the workspace sources. Also used on its own by Kirby's before/after measurement. */
  async lint(project: Project): Promise<Finding[]> {
    const limits = { maxFiles: 1500, maxFileBytes: 300_000, maxTotalBytes: 12_000_000 };
    const res = await this.#sandboxes.exec(project, 'node -', { stdin: extractorScript(limits), timeoutSec: 60, maxOutputBytes: limits.maxTotalBytes * 2 });
    if (res.exitCode !== 0) throw new Error(`source extraction failed: ${excerpt(res.stderr, 300)}`);
    const { files } = parseExtraction(res.stdout, limits);
    return lintSources(files.flatMap((f) => (f.content === null ? [] : [{ path: f.path, content: f.content }])));
  }
}

/**
 * Whether a command's exit code is its own verdict. An engine trims its output as it works (`pnpm test 2>&1 |
 * tail -25`), and that line exits with the pager's code: kept as a check it passes whatever the tests did. So
 * does one that ends by throwing the code away (`|| true`). Quoted text is not shell syntax and is not read.
 */
export function keepsItsVerdict(command: string): boolean {
  const syntax = command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '""');
  const piped = /(^|[^|])\|([^|]|$)/.test(syntax);
  const thrownAway = /(\|\||;)\s*(true|:)\s*($|[;&)])/.test(syntax);
  return !piped && !thrownAway;
}

/** A command without what an engine wraps round it: going to the workspace first, a time limit, folding the error stream in. */
export function bareCommand(command: string): string {
  return command
    .trim()
    .replace(/^cd\s+\S+\s*&&\s*/, '')
    .replace(/^timeout\s+(-\S+\s+)*\d+\S*\s+/, '')
    .replace(/\s+2>&1$/, '')
    .replace(/\s+/g, ' ');
}

/**
 * What a finished audit means for the visual eval. An audit that is unreviewed and otherwise clean is
 * `unverified`: the only thing between it and a pass is the review that did not happen, and that is the
 * studio's to fix (a login, a budget), not the engine's. Any measured or reviewed defect makes it a plain failure.
 */
export function visualOutcome(audit: AuditReport, minScore: number): Pick<EvalOutcome, 'passed' | 'unverified' | 'waitable' | 'detail'> {
  const passed = audit.passed && audit.score >= minScore;
  const unverified = !passed && !audit.visionReviewed && scoreAudit(audit.findings, null, minScore).passed;
  return { passed, ...(unverified ? { unverified } : {}), ...(unverified && audit.vision.limited ? { waitable: true } : {}), detail: passed ? `score ${audit.score}/100, grade ${audit.grade}` : renderAuditFeedback(audit) };
}

export function renderLintFeedback(findings: readonly Finding[], limit = 40): string {
  const order = { blocker: 0, major: 1, minor: 2 } as const;
  const lines = [...findings]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .slice(0, limit)
    .map((f) => `- [${f.severity}] ${f.rule} at ${f.file}:${f.line}\n  ${f.message}\n  Fix: ${f.fix ?? 'n/a'}`);
  return [`Slop lint: ${findings.length} findings${findings.length > limit ? ` (top ${limit} shown)` : ''}. Major findings must be zero.`, ...lines].join('\n');
}

import { lintSources } from '@studio-zero/design';
import type { AuditReport, Eval, EvalSpec, Finding, Project } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { renderAuditFeedback, type VisualAuditor } from '../qa/VisualAuditor.ts';
import { extractorScript, parseExtraction } from '../sandbox/extract.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { errorMessage, excerpt, newId, type Clock } from '../util/core.ts';
import { ensureDevServer } from './devServer.ts';
import { readProjectFile } from './projectFile.ts';

export interface EvalOutcome {
  eval: Eval;
  passed: boolean;
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

  /** Every project starts with the two design gates. Command evals are earned later, from commands that passed. */
  seed(project: Project): void {
    this.#add(project.id, 'slop-lint', { kind: 'slop-lint', maxMajor: 0 }, null);
    this.#add(project.id, 'visual-audit', { kind: 'visual', routes: ['/'], minScore: this.#config.audit.threshold }, null);
  }

  /** Promotes a command the agent ran successfully into a standing regression check. */
  addCommandEval(projectId: string, name: string, command: string, timeoutSec: number, originTaskId: string): boolean {
    const existing = this.#store.listEvals(projectId);
    if (existing.filter((e) => e.spec.kind === 'command').length >= MAX_COMMAND_EVALS) return false;
    if (existing.some((e) => e.spec.kind === 'command' && e.spec.command === command)) return false;
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
      this.#events.emit({ projectId: project.id, taskId }, { type: 'eval.result', evalId: ev.id, name: ev.name, passed: outcome.passed, durationMs, detail: excerpt(outcome.detail, 800) });
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
        const server = await ensureDevServer(this.#sandboxes, project, file, { reuse: opts.devServerRunning === true });
        if (!server.ready) {
          return { eval: ev, passed: false, audit: null, detail: `The dev server (\`${file.dev.command}\`) did not answer on port ${file.dev.port} within 90s.\n${excerpt(server.log, 4000)}` };
        }
        const audit = await this.#auditor.audit({ project, taskId, port: file.dev.port, routes, signal: opts.signal });
        const passed = audit.passed && audit.score >= spec.minScore;
        return { eval: ev, passed, audit, detail: passed ? `score ${audit.score}/100` : renderAuditFeedback(audit) };
      }
    }
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

export function renderLintFeedback(findings: readonly Finding[], limit = 40): string {
  const order = { blocker: 0, major: 1, minor: 2 } as const;
  const lines = [...findings]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .slice(0, limit)
    .map((f) => `- [${f.severity}] ${f.rule} at ${f.file}:${f.line}\n  ${f.message}\n  Fix: ${f.fix ?? 'n/a'}`);
  return [`Slop lint: ${findings.length} findings${findings.length > limit ? ` (top ${limit} shown)` : ''}. Major findings must be zero.`, ...lines].join('\n');
}

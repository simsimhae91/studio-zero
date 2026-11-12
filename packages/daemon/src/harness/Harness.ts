import { z } from 'zod';
import type { Phase, Project, Task, TaskState } from '@studio-zero/protocol';
import { EngineId, type Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { textBlock, type ClaudeClient } from '../llm/ClaudeClient.ts';
import type { ModelRouter } from '../llm/ModelRouter.ts';
import { ApprovalDeniedError, type PolicyEngine } from '../policy/PolicyEngine.ts';
import type { SmokeRunner } from '../qa/SmokeTester.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { untrusted, type UntrustedSource } from '../trust/dataBlock.ts';
import { errorMessage, excerpt, type Clock, type Logger } from '../util/core.ts';
import type { WorkspaceProvisioner } from './bootstrap.ts';
import type { CompilerGate } from './CompilerGate.ts';
import type { EvalRunner } from './EvalRunner.ts';
import type { EngineResult, EngineSession } from './engines/Engine.ts';
import type { LessonBook } from './LessonBook.ts';
import { DRAFT_BRIEF, IDEATION_BRIEF, IDEATION_REQUIRED_FILES, PLANNER_SYSTEM_PROMPT, codingSystemPrompt } from './prompts.ts';
import type { ReflectionAgent } from './ReflectionAgent.ts';

export const INTEGRATION_BRANCH = 'main';
/** How many times one task may ask the owner for more tokens. */
const MAX_BUDGET_EXTENSIONS = 2;
const PLANNER_MODEL = 'claude-fable-5-2';

const Plan = z.object({
  summary: z.string().describe('Two or three sentences: what will change and why this shape.'),
  steps: z.array(z.string()).describe('Ordered, concrete steps. Each names what is done and where.'),
  auditRoutes: z.array(z.string()).describe('Paths of the running app to review visually afterwards, e.g. "/" or "/settings". Empty when nothing visible changes.'),
  openQuestions: z.array(z.string()).describe('Assumptions made where the request was ambiguous. Empty when there were none.'),
});
type Plan = z.infer<typeof Plan>;

/** One thing a verification round found wrong. `detail` is tool or page output: it reaches the engine inside a data block. */
interface Failure {
  name: string;
  source: UntrustedSource;
  detail: string;
  /** Set for the compiler gate, whose feedback names the command and its exit code. */
  compiler?: { command: string; exitCode: number };
}

class Cancelled extends Error {}

/** Abort reason used when the daemon is stopping, as opposed to the owner cancelling a task. */
export class ShutdownSignal extends Error {
  constructor() {
    super('daemon shutting down');
    this.name = 'ShutdownSignal';
  }
}

/**
 * One task, end to end: Plan → Execute → Verify → Reflect → Evolve. One engine does the work; what decides
 * whether it is done is execution, not a second model's opinion of the first.
 *
 *   Plan     route to an engine (table lookup), checkpoint the workspace, branch, load lessons, draft a plan.
 *   Execute  the engine works in the sandbox through the Toolbox.
 *   Verify   the daemon checks the work itself, cheapest and least arguable first:
 *              1. the compiler gate: the type check (or tests) in the sandbox; a failure goes back verbatim;
 *              2. the smoke gate: the running app in a headless browser, listening for exceptions, console
 *                 errors and 5xx responses;
 *              3. the project's evals: regression commands, then the design gates (slop lint, visual audit).
 *            A round stops at the first stage that fails, and the engine gets up to `verifyRounds` corrections.
 *            The engine's own claim of success is never the gate.
 *   Reflect  a judge model reads the trace and proposes lessons and regression checks.
 *   Evolve   code decides which proposals are kept; the lesson files are re-rendered.
 *
 * A `fast` task (Draft 0) is the same loop with the model-judged parts left out: no planning call before the
 * engine starts, no design gates, no reflection. Compiler, smoke load and regression commands still gate it.
 *
 * Whatever happens, the workspace is left recoverable: there is a checkpoint from before the task, the work is
 * committed on its own branch, and a failed task puts the workspace back on the integration branch.
 */
export class Harness {
  readonly #config: Config;
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #policy: PolicyEngine;
  readonly #sandboxes: OrbStackManager;
  readonly #provisioner: WorkspaceProvisioner;
  readonly #router: ModelRouter;
  readonly #claude: ClaudeClient;
  readonly #evals: EvalRunner;
  readonly #compiler: CompilerGate;
  readonly #smoke: SmokeRunner;
  readonly #lessons: LessonBook;
  readonly #reflection: ReflectionAgent;
  readonly #clock: Clock;
  readonly #log: Logger;

  constructor(deps: {
    config: Config;
    store: Store;
    events: EventLog;
    policy: PolicyEngine;
    sandboxes: OrbStackManager;
    provisioner: WorkspaceProvisioner;
    router: ModelRouter;
    claude: ClaudeClient;
    evals: EvalRunner;
    compiler: CompilerGate;
    smoke: SmokeRunner;
    lessons: LessonBook;
    reflection: ReflectionAgent;
    clock: Clock;
    log: Logger;
  }) {
    this.#config = deps.config;
    this.#store = deps.store;
    this.#events = deps.events;
    this.#policy = deps.policy;
    this.#sandboxes = deps.sandboxes;
    this.#provisioner = deps.provisioner;
    this.#router = deps.router;
    this.#claude = deps.claude;
    this.#evals = deps.evals;
    this.#compiler = deps.compiler;
    this.#smoke = deps.smoke;
    this.#lessons = deps.lessons;
    this.#reflection = deps.reflection;
    this.#clock = deps.clock;
    this.#log = deps.log;
  }

  async run(initial: Task, signal: AbortSignal): Promise<void> {
    const project = this.#store.getProject(initial.projectId);
    if (!project) {
      this.#finish(initial, 'failed', { error: 'project no longer exists' });
      return;
    }
    const scope = { projectId: project.id, taskId: initial.id };
    const ideation = initial.kind === 'ideate';
    const draft = initial.track === 'fast';
    const branch = initial.branch ?? `sz/${initial.id}`;
    let task = initial;
    let session: EngineSession | null = null;
    let onBranch = false;
    let appliedLessons: string[] = [];

    const phase = (p: Phase, round: number): void => {
      task = this.#store.updateTask(task.id, { phase: p });
      this.#events.emit(scope, { type: 'task.phase', phase: p, round });
    };
    const onWaiting = (waiting: boolean): void => {
      task = this.#store.updateTask(task.id, { state: waiting ? 'awaiting_approval' : 'running' });
      this.#events.emit(scope, { type: 'task.state', state: task.state, error: null });
    };
    const checkCancel = (): void => {
      if (signal.aborted || this.#store.isCancelRequested(task.id)) throw new Cancelled();
    };

    try {
      this.#events.emit(scope, { type: 'task.state', state: 'running', error: null });
      await this.#provisioner.ensure(project);

      // ------------------------------------------------------------------ Plan
      phase('plan', 0);
      const route = await this.#router.route(task.kind, EngineId.nullable().catch(null).parse(task.enginePref));
      this.#events.emit(scope, { type: 'route.decided', taskKind: task.kind, engine: route.candidate.engine, model: route.candidate.model, effort: route.candidate.effort, considered: route.considered });
      const base = await this.#sandboxes.checkpoint(project, `before ${task.kind} ${task.id}`, task.id);
      this.#events.emit(scope, { type: 'checkpoint.created', checkpointId: base.id, label: base.label });
      await this.#sandboxes.startBranch(project, branch, task.baseBranch ?? INTEGRATION_BRANCH);
      onBranch = true;
      // The branch the engine works on may predate a kit the prompt is about to promise it.
      await this.#provisioner.ensure(project);
      task = this.#store.updateTask(task.id, { engine: route.candidate.engine, model: route.candidate.model, branch, baseCheckpointId: base.id });

      const lessons = this.#lessons.forTask(project.id);
      appliedLessons = lessons.ids;
      // A draft goes straight to the engine: the planning call is a model round trip the owner would wait through.
      const plan = !draft && (task.kind === 'build' || task.kind === 'refactor' || task.kind === 'kirby_materialize') ? await this.#plan(project, task, lessons.text, signal) : null;
      if (plan) this.#events.emit(scope, { type: 'plan.created', summary: plan.summary, steps: plan.steps, auditRoutes: plan.auditRoutes, appliedLessonIds: lessons.ids });
      checkCancel();

      // --------------------------------------------------------------- Execute
      phase('execute', 1);
      const engineSession = (session = await route.engine.open({ project, task, route: route.candidate, system: codingSystemPrompt(project.template), signal, onWaiting }));
      // Sends a message to the engine. If the task's own budget runs out mid-way, the owner is asked whether to
      // extend it (an approval, so it reaches the phone) and the engine carries on from where it stopped.
      let extensions = 0;
      const send = async (content: string): Promise<EngineResult> => {
        let result = await engineSession.send(content);
        while (result.stopped === 'budget') {
          const spent = this.#store.getTask(task.id)?.spentTokens ?? 0;
          if (result.deniedRule !== 'budget.task') throw new Error(`the project's daily token budget is used up (task has spent ${spent} tokens)`);
          if (extensions >= MAX_BUDGET_EXTENSIONS) throw new Error(`token budget exhausted after ${extensions} extensions (${spent} tokens used)`);
          try {
            await this.#policy.authorize({ type: 'system' }, { kind: 'task.extend-budget', projectId: project.id, taskId: task.id, addTokens: initial.budgetTokens }, { taskId: task.id, signal, onWaiting });
          } catch (err) {
            if (err instanceof ApprovalDeniedError) throw new Error(`token budget exhausted (${spent} tokens used) and an extension was not approved`);
            throw err;
          }
          extensions += 1;
          this.#store.extendTaskBudget(task.id, initial.budgetTokens);
          result = await engineSession.send('Your token budget was extended. Continue from where you stopped.');
        }
        return result;
      };

      let result = await send(executeMessage(task, plan, lessons.text));
      checkCancel();

      // ---------------------------------------------------------------- Verify
      const corrections = this.#config.budgets.verifyRounds;
      let unverified: string[] = [];
      for (let round = 1; ; round++) {
        phase('verify', round);
        const checked = ideation ? { failures: await this.#verifyIdeation(project), unverified: [] } : await this.#verify(project, task, plan, signal);
        const failures = checked.failures;
        unverified = checked.unverified;
        checkCancel();
        if (failures.length === 0) break;
        if (round > corrections) throw new Error(`verification still failing after ${corrections} corrections: ${failures.map((f) => f.name).join(', ')}`);

        phase('execute', round + 1);
        result = await send(repairMessage(failures));
        checkCancel();
      }

      await this.#sandboxes.commitAll(project, commitSubject(task));
      const notes = plan && plan.openQuestions.length > 0 ? `\n\nAssumptions made: ${plan.openQuestions.join(' | ')}` : '';
      // The work passed every check that could run. What could not be checked is said, not left to be assumed.
      const caveat = unverified.length > 0 ? `\n\nNot verified: ${unverified.join(' | ')}` : '';
      task = this.#finish(task, 'succeeded', { summary: excerpt(result.finalText || 'Task completed.', 1500) + notes + caveat });
    } catch (err) {
      if (signal.aborted && signal.reason instanceof ShutdownSignal) {
        // Not a verdict on the task: leave it in flight so the queue re-queues it on the next boot.
        if (onBranch) await this.#parkBranch(project, task, 'interrupted');
        await session?.close().catch(() => undefined);
        return;
      }
      const cancelled = err instanceof Cancelled || signal.aborted;
      if (!cancelled) this.#log.error({ taskId: task.id, err: errorMessage(err) }, 'task failed');
      if (onBranch) await this.#parkBranch(project, task, cancelled ? 'cancelled' : 'failed');
      task = this.#finish(task, cancelled ? 'cancelled' : 'failed', { error: cancelled ? 'cancelled by the owner' : errorMessage(err) });
    } finally {
      await session?.close().catch(() => undefined);
    }

    // ------------------------------------------------------- Reflect, Evolve
    if (task.state !== 'cancelled' && !ideation && !draft && this.#claude.isConfigured()) {
      this.#store.updateTask(task.id, { phase: 'reflect' });
      this.#events.emit(scope, { type: 'task.phase', phase: 'reflect', round: 0 });
      try {
        await this.#reflection.reflect(project, task, appliedLessons);
      } catch (err) {
        // Learning is best-effort: a failed reflection never changes the outcome of the task it reflects on.
        this.#log.warn({ taskId: task.id, err: errorMessage(err) }, 'reflection failed');
      }
      this.#store.updateTask(task.id, { phase: null });
    }
  }

  async #plan(project: Project, task: Task, lessonText: string, signal: AbortSignal): Promise<Plan | null> {
    if (!this.#claude.isConfigured()) return null; // bridge-only installs: the engine plans for itself
    const listing = await this.#sandboxes.exec(project, 'git ls-files --cached --others --exclude-standard | head -n 400', { timeoutSec: 30 });
    const plan = await this.#claude.structured({
      scope: { projectId: project.id, taskId: task.id },
      model: PLANNER_MODEL,
      effort: 'high',
      system: PLANNER_SYSTEM_PROMPT,
      schema: Plan,
      maxTokens: 8000,
      signal,
      content: [
        textBlock(`Owner's request (${task.kind}):\n${task.prompt}`),
        ...(lessonText ? [textBlock(lessonText)] : []),
        textBlock(`Project stack template: ${project.template}. Files in the workspace:\n${untrusted('sandbox-output', listing.stdout.trim() || '(empty workspace)')}`),
      ],
    });
    // The routes end up in URLs the QA browser visits; only plain app paths are kept.
    return { ...plan, steps: plan.steps.slice(0, 20), auditRoutes: plan.auditRoutes.filter((r) => /^\/[\w\-./~%]*$/.test(r) && r.length <= 200).slice(0, 6), openQuestions: plan.openQuestions.slice(0, 6) };
  }

  /**
   * One verification round. Stages run in order of cost and of how little there is to argue about, and the round
   * ends at the first stage that fails: there is no point loading a page that does not compile, or measuring
   * the layout of one that throws on load.
   */
  async #verify(project: Project, task: Task, plan: Plan | null, signal: AbortSignal): Promise<{ failures: Failure[]; unverified: string[] }> {
    const scope = { projectId: project.id, taskId: task.id };

    const compiled = await this.#compiler.run(project, signal);
    if (compiled) {
      this.#events.emit(scope, { type: 'gate.result', gate: 'compiler', name: compiled.command, passed: compiled.passed, exitCode: compiled.exitCode, durationMs: compiled.durationMs, detail: compiled.passed ? '' : excerpt(compiled.output, 2000) });
      if (!compiled.passed) return { failures: [{ name: 'compiler', source: 'sandbox-output', detail: compiled.output, compiler: { command: compiled.command, exitCode: compiled.exitCode } }], unverified: [] };
    }

    // The owner's switch for browser-backed checks is the visual eval: with it off, nothing here starts a browser.
    const browser = this.#evals.usesBrowser(project.id);
    let served = false;
    if (browser) {
      try {
        const smoke = await this.#smoke.run(project, { extraRoutes: plan?.auditRoutes, signal });
        served = smoke.passed;
        this.#events.emit(scope, { type: 'gate.result', gate: 'smoke', name: smoke.routes.join(' '), passed: smoke.passed, exitCode: null, durationMs: smoke.durationMs, detail: excerpt(smoke.detail, 2000) });
        if (!smoke.passed) return { failures: [{ name: 'smoke', source: 'browser-page', detail: smoke.detail }], unverified: [] };
      } catch (err) {
        if (signal.aborted) throw err;
        // The browser not starting is the studio's problem, not a defect in the work: say so and carry on.
        this.#log.warn({ taskId: task.id, err: errorMessage(err) }, 'smoke gate could not run');
        this.#events.emit(scope, { type: 'notice', level: 'warn', message: `Smoke test skipped: ${errorMessage(err)}` });
      }
    }

    const outcomes = await this.#evals.runAll(project, task.id, { extraRoutes: plan?.auditRoutes, commandsOnly: task.track === 'fast', devServerRunning: served, signal });
    // An unverified check is not sent back for repair: the engine cannot produce the review that did not run.
    return {
      failures: outcomes.filter((o) => !o.passed && !o.unverified).map((o) => ({ name: o.eval.name, source: o.eval.spec.kind === 'visual' ? 'browser-page' : 'sandbox-output', detail: o.detail })),
      unverified: outcomes.filter((o) => o.unverified).map((o) => `${o.eval.name}: the design review did not run (${o.audit?.vision.reason ?? 'no reason recorded'}), so the design is not vouched for`),
    };
  }

  /** Ideation produces documents, not screens: the check is that each required document exists and has substance. */
  async #verifyIdeation(project: Project): Promise<Failure[]> {
    const script = IDEATION_REQUIRED_FILES.map((f) => `[ "$(wc -c < '${f}' 2>/dev/null || echo 0)" -ge 400 ] || echo '${f}'`).join('\n');
    const res = await this.#sandboxes.exec(project, script, { timeoutSec: 30 });
    const missing = res.stdout.trim().split('\n').filter(Boolean);
    return missing.length === 0 ? [] : [{ name: 'ideation-documents', source: 'sandbox-output', detail: `Missing or nearly empty: ${missing.join(', ')}` }];
  }

  /** Keep the unfinished work on its branch for inspection and put the workspace back on the integration branch. */
  async #parkBranch(project: Project, task: Task, why: string): Promise<void> {
    try {
      await this.#sandboxes.stopProcess(project, 'dev');
      await this.#sandboxes.commitAll(project, `wip: ${task.id} (${why})`);
      await this.#sandboxes.checkout(project, INTEGRATION_BRANCH);
    } catch (err) {
      this.#log.warn({ taskId: task.id, err: errorMessage(err) }, 'could not park task branch');
    }
  }

  #finish(task: Task, state: Extract<TaskState, 'succeeded' | 'failed' | 'cancelled'>, patch: { summary?: string; error?: string }): Task {
    const updated = this.#store.updateTask(task.id, { state, phase: null, finishedAt: this.#clock(), ...patch });
    this.#events.emit({ projectId: task.projectId, taskId: task.id }, { type: 'task.state', state, error: patch.error ?? null });
    return updated;
  }
}

function executeMessage(task: Task, plan: Plan | null, lessonText: string): string {
  const parts = [task.kind === 'ideate' ? IDEATION_BRIEF : '', task.track === 'fast' && task.kind !== 'ideate' ? DRAFT_BRIEF : '', `The owner's request:\n${task.prompt}`];
  if (plan) parts.push(`Plan drafted for this request (follow it unless the code shows it is wrong; say so if you deviate):\n${plan.summary}\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`);
  if (lessonText) parts.push(lessonText);
  return parts.filter(Boolean).join('\n\n');
}

/**
 * What the engine is told after a failed round. A compiler failure keeps its own frame (the command and the exit
 * code are the daemon's; the output inside is the tool's, fenced as data like any other sandbox output).
 */
export function repairMessage(failures: readonly Failure[]): string {
  const blocks = failures.map((f) => {
    const data = untrusted(f.source, excerpt(f.detail, 12_000), { check: f.name });
    return f.compiler ? `<compiler_error exit_code="${f.compiler.exitCode}" command="${f.compiler.command}">\n${data}\n</compiler_error>\nFix this compilation error immediately.` : `Check "${f.name}" failed:\n${data}`;
  });
  return `The harness verified your work and it did not pass. Fix the cause of every failure below in the code, then stop so it can be verified again. The checks themselves are not yours to change.\n\n${blocks.join('\n\n')}`;
}

function commitSubject(task: Task): string {
  const prefix = { build: 'feat', refactor: 'refactor', inline_edit: 'fix', ideate: 'docs', kirby_materialize: 'refactor' }[task.kind];
  return `${prefix}: ${task.prompt.split('\n')[0]!.replace(/\s+/g, ' ').slice(0, 68)}\n\nStudio Zero task ${task.id}`;
}

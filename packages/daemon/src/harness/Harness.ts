import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { AcceptanceVerdict, Effort, ReviewerId, ReviewerPref, ScreenSpec as ScreenSpecShape, type AuditReport, type Phase, type Project, type Task, type TaskState } from '@studio-zero/protocol';
import { EngineId, type Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { pngBlock, textBlock, type ClaudeClient } from '../llm/ClaudeClient.ts';
import type { EnginePick, ModelRouter } from '../llm/ModelRouter.ts';
import { ApprovalDeniedError, type PolicyEngine } from '../policy/PolicyEngine.ts';
import { flowTotals } from '../qa/FlowWalker.ts';
import { MOCKUP_DIR, type MockupMeasurement, type MockupRenderer } from '../qa/MockupRenderer.ts';
import type { ReferenceCapture, RefKit } from '../qa/RefKit.ts';
import type { SmokeRunner } from '../qa/SmokeTester.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { ANCHOR_FILE, AnchorTableShape, anchorTableJson, readAnchorTable, renderAnchorTable, type AnchorRead, type AnchorTable } from '../scratch/AnchorTable.ts';
import { SCREEN_SPEC_FILE, readScreenSpec, renderScreenSpec, type FlowTask, type ScreenSpecRead } from '../scratch/ScreenSpec.ts';
import { untrusted, type UntrustedSource } from '../trust/dataBlock.ts';
import { errorMessage, excerpt, type Clock, type Logger } from '../util/core.ts';
import type { WorkspaceProvisioner } from './bootstrap.ts';
import type { BuildMeter } from './BuildMeter.ts';
import type { CompilerGate } from './CompilerGate.ts';
import { visualOutcome, type EvalRunner } from './EvalRunner.ts';
import type { EngineResult, EngineSession } from './engines/Engine.ts';
import { countCompilerErrors, emptyRun, renderEvidence, type Ledger, type RunRecord } from './Ledger.ts';
import type { LessonBook } from './LessonBook.ts';
import { ANCHOR_BRIEF, DRAFT_BRIEF, IDEATION_BRIEF, IDEATION_REQUIRED_FILES, IDEATION_REVISION_BRIEF, PLANNER_SYSTEM_PROMPT, SCREEN_SPEC_RULES, codingSystemPrompt } from './prompts.ts';
import type { ReflectionAgent } from './ReflectionAgent.ts';
import { renderCritique, renderPatch, type Acceptance, type PlanCritique, type SandwichReviewer } from './SandwichReviewer.ts';
import type { SelfHosting } from './SelfHosting.ts';
import { copyBlock } from './TextSlopAuditor.ts';

export const INTEGRATION_BRANCH = 'main';
/** How many times one task may ask the owner for more tokens. */
const MAX_BUDGET_EXTENSIONS = 2;
const PLANNER_MODEL = 'claude-fable-5-2';

/** What the planner is asked to return. Exported so the shape can be put to a real model in a test. */
export const Plan = z.object({
  summary: z.string().describe('Two or three sentences: what will change and why this shape.'),
  steps: z.array(z.string()).describe('Ordered, concrete steps. Each names what is done and where.'),
  auditRoutes: z.array(z.string()).describe('Paths of the running app to review visually afterwards, e.g. "/" or "/settings". Empty when nothing visible changes.'),
  openQuestions: z.array(z.string()).describe('Assumptions made where the request was ambiguous. Empty when there were none.'),
  anchor: AnchorTableShape.nullable().describe('The anchor table, when the request says one is needed. null otherwise.'),
  screens: ScreenSpecShape.nullable().describe('The screen spec, when the request says one is needed. null otherwise.'),
});
type Plan = z.infer<typeof Plan>;

/** How many times an engine may correct an anchor table it was asked to write, before the task is refused. */
const ANCHOR_CORRECTIONS = 2;
/**
 * How many times an engine reworks its mock-ups after they were measured. Past this they go to the owner with
 * what was found said beside them: a drawing is for the owner to judge, and a measurement that would not come
 * clean is something they are told, not a reason to throw the design away.
 */
const MOCKUP_CORRECTIONS = 2;

/** One thing a verification round found wrong. `detail` is tool or page output: it reaches the engine inside a data block. */
interface Failure {
  name: string;
  source: UntrustedSource;
  detail: string;
  /** Set for the compiler gate, whose feedback names the command and its exit code. */
  compiler?: { command: string; exitCode: number };
}

class Cancelled extends Error {}

/**
 * Where a suspended task left off: what the engine last said, the parts of its plan the checks still read,
 * whether its one acceptance review has already been spent, and who reviewed it with what result. The last is
 * for the receipt: a task that waited out a usage limit is still the task those reviewers looked at.
 */
const Resume = z.object({
  finalText: z.string(),
  plan: Plan.partial({ anchor: true, screens: true }).nullable(),
  accepted: z.boolean().default(false),
  review: z.object({ plan: ReviewerId.nullable().catch(null), acceptance: ReviewerId.nullable().catch(null), verdict: AcceptanceVerdict.nullable().catch(null) }).nullable().default(null),
});
const resumeKey = (taskId: string): string => `task.resume:${taskId}`;

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
 *   Plan     route to an engine (table lookup), checkpoint the workspace, branch, load lessons, measure any
 *            reference pages, draft a plan. A design task (a build whose design gates are on) then gets its
 *            anchor table: written, checked and committed before a line of code, or the task is refused.
 *            Another vendor's model red-teams the plan and the table, once.
 *   Execute  the engine works in the sandbox through the Toolbox, alone.
 *   Verify   the daemon checks the work itself, cheapest and least arguable first:
 *              1. the compiler gate: the type check (or tests) in the sandbox; a failure goes back verbatim;
 *              2. the smoke gate: the running app in a headless browser, listening for exceptions, console
 *                 errors and 5xx responses;
 *              3. the project's evals: regression commands, then the design gates (slop lint, visual audit).
 *            A round stops at the first stage that fails, and the engine gets up to `verifyRounds` corrections.
 *            The engine's own claim of success is never the gate.
 *            When every check has passed, the other vendor's model looks once more: it accepts the result or
 *            sends it back with a single corrective patch, which is verified like any other change. The
 *            receipt says `patched` only when the engine changed the workspace in answer and it verified again.
 *   Reflect  a judge model reads the trace and proposes lessons and regression checks.
 *   Evolve   code decides which proposals are kept; the lesson files are re-rendered.
 *
 * A design task (`ideate`) writes documents and mock-ups and no product code, and is verified as that: its
 * documents are there, its screen spec holds, and its mock-up pages are measured the way a build's screens are
 * (audited, and the spec's core flow walked on each). The first two are owed; what the measurement finds is
 * reworked a bounded number of times and then shown to the owner beside the mock-ups.
 *
 * A `fast` task (Draft 0) is the same loop with the model-judged parts left out: no planning call before the
 * engine starts, no anchor table, no cross-checks, no design gates, no reflection. Compiler, smoke load and
 * regression commands still gate it.
 *
 * Every task that reaches a verdict leaves a receipt in the ledger: what its code, design and cost measured.
 *
 * A task can also stop short of a verdict. When everything that could be checked passed but the design review
 * could not be had because every reviewer is at a usage limit, the work is committed and the task is
 * `suspended`: it holds no engine and no slot. When a reviewer answers again the task is queued, and this loop
 * picks it up at Verify, on the same branch, without planning or executing a second time.
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
  readonly #refkit: RefKit;
  readonly #reviewer: SandwichReviewer;
  readonly #ledger: Ledger;
  readonly #build: BuildMeter;
  readonly #mockups: Pick<MockupRenderer, 'measure'> | null;
  readonly #core: SelfHosting | null;
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
    refkit: RefKit;
    reviewer: SandwichReviewer;
    ledger: Ledger;
    build: BuildMeter;
    mockups?: Pick<MockupRenderer, 'measure'> | null;
    selfHosting?: SelfHosting | null;
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
    this.#refkit = deps.refkit;
    this.#reviewer = deps.reviewer;
    this.#ledger = deps.ledger;
    this.#build = deps.build;
    this.#mockups = deps.mockups ?? null;
    this.#core = deps.selfHosting ?? null;
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
    // Held in an object because it is opened from inside a closure, on first use.
    const engine: { session: EngineSession | null } = { session: null };
    let onBranch = false;
    let appliedLessons: string[] = [];
    const resume = this.#resumeState(initial.id);
    // A build whose design gates are on is a design task: it owes an anchor table before code.
    const design = initial.kind === 'build' && !draft && this.#evals.usesBrowser(project.id);
    // The two cross-checks by another vendor's model go with a full build, unless the owner switched them off.
    const crossChecked = initial.kind === 'build' && !draft && this.#config.review.sandwich;
    const reviewerPref = ReviewerPref.nullable().catch(null).parse(initial.reviewerPref);
    const record = emptyRun();
    if (resume?.review) Object.assign(record, { planReviewer: resume.review.plan, acceptanceReviewer: resume.review.acceptance, verdict: resume.review.verdict });
    let anchor: AnchorTable | null = null;
    let accepted = resume?.accepted ?? false;
    /** The pages the owner pointed at, as captured before the build. Empty on a task picked up after a suspension. */
    let references: ReferenceCapture[] = [];

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

      // The engine is routed and opened when it is first needed. A resumed task needs one only if verification
      // finds something to repair.
      let route: Awaited<ReturnType<ModelRouter['route']>> | null = null;
      const routed = async (): Promise<Awaited<ReturnType<ModelRouter['route']>>> => (route ??= await this.#router.route(task.kind, pickOf(task)));
      const open = async (): Promise<EngineSession> => {
        const decided = await routed();
        return (engine.session ??= await decided.engine.open({ project, task, route: decided.candidate, system: codingSystemPrompt(project.template), signal, onWaiting }));
      };
      // Sends a message to the engine. If the task's own budget runs out mid-way, the owner is asked whether to
      // extend it (an approval, so it reaches the phone) and the engine carries on from where it stopped.
      let extensions = 0;
      const send = async (content: string): Promise<EngineResult> => {
        const engineSession = await open();
        let result = await engineSession.send(content);
        while (result.stopped === 'budget') {
          const spent = this.#store.getTask(task.id)?.spentTokens ?? 0;
          if (result.deniedRule !== 'budget.task') throw new Error(`the project's daily token budget is used up (task has spent ${spent} tokens)`);
          if (extensions >= MAX_BUDGET_EXTENSIONS) throw new Error(`token budget exhausted after ${extensions} extensions (${spent} tokens used)`);
          try {
            await this.#policy.authorize({ type: 'system' }, { kind: 'task.extend-budget', projectId: project.id, taskId: task.id, addTokens: initial.budgetTokens, spentTokens: spent }, { taskId: task.id, signal, onWaiting });
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

      let plan: Plan | null;
      let result: EngineResult;
      if (resume) {
        // The work exists, committed on its branch. Go back to it; what is left is the verdict.
        await this.#sandboxes.checkout(project, branch);
        onBranch = true;
        plan = resume.plan ? { ...resume.plan, anchor: null, screens: null } : null;
        result = { finalText: resume.finalText, stopped: 'completed' };
      } else {
        // ---------------------------------------------------------------- Plan
        phase('plan', 0);
        // The studio's own repository: start from what is committed in the checkout now.
        if (project.template === 'studio-core') await this.#core?.sync(project, { signal });
        const decided = await routed();
        this.#events.emit(scope, { type: 'route.decided', taskKind: task.kind, engine: decided.candidate.engine, model: decided.candidate.model, effort: decided.candidate.effort, considered: decided.considered });
        const base = await this.#sandboxes.checkpoint(project, `before ${task.kind} ${task.id}`, task.id);
        this.#events.emit(scope, { type: 'checkpoint.created', checkpointId: base.id, label: base.label });
        await this.#sandboxes.startBranch(project, branch, task.baseBranch ?? INTEGRATION_BRANCH);
        onBranch = true;
        // The branch the engine works on may predate a kit the prompt is about to promise it.
        await this.#provisioner.ensure(project);
        // The table has a level for every engine; it is recorded only where the engine was actually run at one.
        task = this.#store.updateTask(task.id, { engine: decided.candidate.engine, model: decided.candidate.model, effort: decided.engine.efforts.length > 0 ? decided.candidate.effort : null, branch, baseCheckpointId: base.id });

        const lessons = this.#lessons.forTask(project.id);
        appliedLessons = lessons.ids;
        // What the builder is handed before it builds decides more than how the build is organised. So first:
        // the references the owner pointed at, measured in the browser container; the anchor table; one red team.
        references = task.references.length > 0 && !draft ? await this.#refkit.capture(project, task.id, task.references, signal) : [];
        const existing = design ? await this.#readAnchor(project) : null;
        const specAtStart = design ? await this.#readSpec(project) : null;
        // A draft goes straight to the engine: the planning call is a model round trip the owner would wait through.
        plan = !draft && (task.kind === 'build' || task.kind === 'refactor' || task.kind === 'kirby_materialize') ? await this.#plan(project, task, lessons.text, signal, { anchor: design && existing?.ok !== true, screens: design && specAtStart?.ok !== true, references }) : null;
        if (plan) this.#events.emit(scope, { type: 'plan.created', summary: plan.summary, steps: plan.steps, auditRoutes: plan.auditRoutes, appliedLessonIds: lessons.ids });
        checkCancel();

        if (design) {
          anchor = await this.#anchor(project, task, { existing, drafted: plan?.anchor ?? null, references, send, checkCancel });
          checkCancel();
        }
        // The other half of what is fixed before code: what each screen does. Kept if the project has one that
        // holds; otherwise the planner's draft is checked and committed, and failing that the engine is told to
        // write it first. Either way the work is not accepted without one (see `#verify`).
        const specOwed = design ? await this.#screenSpec(project, task, specAtStart, plan?.screens ?? null) : null;
        let critique: PlanCritique | null = null;
        if (crossChecked && (plan !== null || anchor !== null)) {
          // The plan was drafted by Claude when there is one; otherwise what is reviewed is the engine's own work.
          const checked = await this.#reviewer.redTeam({ scope, author: plan !== null ? 'native-claude' : decided.candidate.engine, pref: reviewerPref, request: task.prompt, plan: plan ? planText(plan) : null, anchor: anchor ? renderAnchorTable(anchor) : null, signal });
          record.planReviewer = checked.reviewer;
          critique = checked.result;
          checkCancel();
        }

        // ------------------------------------------------------------- Execute
        phase('execute', 1);
        await open();
        // A design task that starts where a finished design already is (the owner sent it back with notes) revises it.
        const revising = ideation && (await this.#ideationDocuments(project)).length === 0;
        result = await send(executeMessage(task, plan, lessons.text, { anchor, critique, references, revising, specOwed }));
        checkCancel();
      }

      // ---------------------------------------------------------------- Verify
      let unverified: string[] = [];
      let waitingOn: string | null = null;
      let round = 0;
      /** A design task's mock-ups as last measured, and what was still wrong with them when the reworking stopped. */
      let drawn: MockupMeasurement | null = null;
      let outstanding: string[] = [];
      /** Verifies, and has the engine repair what failed, until a round is clean or the corrections run out. */
      const verifyUntilClean = async (): Promise<void> => {
        const corrections = this.#config.budgets.verifyRounds;
        let reworks = 0;
        for (let used = 0; ; ) {
          round += 1;
          phase('verify', round);
          const looked = ideation ? await this.#verifyIdeation(project, task, signal) : null;
          const checked = looked ?? (await this.#verify(project, task, plan, signal, { design, record }));
          record.rounds = round;
          const failures = checked.failures;
          unverified = checked.unverified;
          waitingOn = checked.waitingOn;
          if (looked) drawn = looked.drawn;
          checkCancel();
          if (failures.length === 0) return;
          if (looked?.advisory) {
            // What the measurement found on the mock-ups: reworked a bounded number of times, then said.
            if (reworks >= MOCKUP_CORRECTIONS) {
              outstanding = failures.map((f) => f.name);
              return;
            }
            reworks += 1;
          } else {
            if (used >= corrections) throw new Error(`verification still failing after ${corrections} corrections: ${failures.map((f) => f.name).join(', ')}`);
            used += 1;
          }

          phase('execute', round + 1);
          result = await send(repairMessage(failures));
          checkCancel();
        }
      };
      await verifyUntilClean();

      // ------------------------------------------------------------ Acceptance
      // The one look after the build, by the other vendor's model. Not while a design review is still owed
      // (it reads that review's verdict), and never twice for one task.
      if (crossChecked && !accepted && waitingOn === null) {
        accepted = true;
        const lead = EngineId.catch('native-claude').parse(task.engine);
        // The table as the work leaves it: the engine may have revised it, and a resumed task reads it afresh.
        const kept = design ? await this.#readAnchor(project) : null;
        const tableNow = kept?.ok ? kept.table : anchor;
        const screens = await this.#readSpec(project);
        const checked = await this.#reviewer.accept({
          scope,
          author: lead,
          pref: reviewerPref,
          request: task.prompt,
          plan: plan ? planText(plan) : null,
          anchor: tableNow ? renderAnchorTable(tableNow) : null,
          spec: screens?.ok ? renderScreenSpec(screens.spec) : null,
          evidence: renderEvidence(record),
          copy: record.audit?.copy && record.audit.copy.texts.length > 0 ? copyBlock(record.audit.copy.texts) : null,
          captures: await this.#firstScreen(record.audit),
          states: await this.#stateScreens(record.audit),
          references: references.filter((r) => r.ok).map((r) => ({ url: r.url, summary: r.summary, png: r.png })),
          ownMeasure: record.audit?.ownMeasure ?? null,
          signal,
        });
        record.acceptanceReviewer = checked.reviewer;
        record.verdict = checked.result?.verdict ?? null;
        checkCancel();
        if (checked.result?.verdict === 'patch') {
          // Whether the patch landed is observed, not assumed: the engine is free to argue with a point instead
          // of acting on it, and work that was clean before the patch is still clean if it does nothing.
          const tree = (): Promise<string | null> => this.#sandboxes.workspaceTree(project).catch(() => null);
          const issuedOn = await tree();
          phase('execute', round + 1);
          result = await send(patchMessage(checked.result));
          checkCancel();
          const answeredWith = await tree();
          await verifyUntilClean();
          // Past this line the patched work has passed every check again. Until then, and if nothing changed, the verdict stays `patch`.
          if (issuedOn !== null && answeredWith !== null && issuedOn !== answeredWith) record.verdict = 'patched';
        }
      }

      await this.#sandboxes.commitAll(project, commitSubject(task));
      if (waitingOn !== null) {
        // Nothing is known to be wrong and the one judgement still owed cannot be had today. The work stays on
        // its branch; the task steps out of the queue's way until a reviewer is back.
        this.#store.kvSet(resumeKey(task.id), JSON.stringify({ finalText: excerpt(result.finalText, 6000), plan: plan ? { ...plan, anchor: null, screens: null } : null, accepted, review: { plan: record.planReviewer, acceptance: record.acceptanceReviewer, verdict: record.verdict } } satisfies z.infer<typeof Resume>));
        task = this.#store.updateTask(task.id, { state: 'suspended', phase: null });
        this.#events.emit(scope, { type: 'notice', level: 'warn', message: `The design review is waiting on a usage limit (${waitingOn}). The work is committed on ${branch}; this task is suspended and resumes at verification by itself when a reviewer answers.` });
        this.#events.emit(scope, { type: 'task.state', state: 'suspended', error: null });
        return;
      }
      // A design task's directions are drawn, so the owner chooses a build by looking at it and not by reading about
      // it. They are the ones the last verification round measured: what the owner sees is what was checked.
      if (ideation && this.#mockups) {
        const options = (drawn as MockupMeasurement | null)?.options ?? [];
        if (options.length > 0) this.#events.emit(scope, { type: 'mockups.rendered', options });
        else this.#events.emit(scope, { type: 'notice', level: 'warn', message: 'The mock-ups could not be drawn (the QA browser did not start, or no mock-up page was found). The documents are complete.' });
        if (outstanding.length > 0) {
          unverified = [...unverified, `the mock-ups were reworked ${MOCKUP_CORRECTIONS} times and the measurement still finds problems (${outstanding.join(', ')}); they are shown with what was found`];
        }
      }
      // The production build, for the ledger. It runs after the commit and gates nothing; a failure is said.
      if (!draft && !ideation) {
        const built = await this.#build.run(project, signal).catch((err: unknown) => {
          if (signal.aborted) throw err;
          this.#log.warn({ taskId: task.id, err: errorMessage(err) }, 'the build could not be measured');
          return null;
        });
        if (built) {
          this.#events.emit(scope, { type: 'gate.result', gate: 'build', name: built.command, passed: built.passed, exitCode: built.exitCode, durationMs: built.durationMs, detail: built.passed ? '' : excerpt(built.output, 2000) });
          if (built.passed) record.build = { ms: built.durationMs, bytes: built.bundleBytes };
          else unverified = [...unverified, `the production build (${built.command}) exits ${built.exitCode}`];
        }
      }
      // A finished task on the studio's own repository leaves its sandbox as a feature branch in the checkout.
      if (project.template === 'studio-core' && this.#core) {
        try {
          const exported = await this.#core.export(project, { id: task.id, prompt: task.prompt, branch });
          if (!exported) this.#events.emit(scope, { type: 'notice', level: 'info', message: 'This task committed nothing, so there is no branch to hand over.' });
        } catch (err) {
          this.#log.warn({ taskId: task.id, err: errorMessage(err) }, 'could not export the Core branch');
          unverified = [...unverified, `the work is committed in the Core sandbox on ${branch} but could not be copied to the checkout (${errorMessage(err)})`];
        }
      }
      const notes = plan && plan.openQuestions.length > 0 ? `\n\nAssumptions made: ${plan.openQuestions.join(' | ')}` : '';
      // The work passed every check that could run. What could not be checked is said, not left to be assumed.
      const caveat = unverified.length > 0 ? `\n\nNot verified: ${unverified.join(' | ')}` : '';
      task = this.#finish(task, 'succeeded', { summary: excerpt(result.finalText || 'Task completed.', 1500) + notes + caveat });
    } catch (err) {
      if (signal.aborted && signal.reason instanceof ShutdownSignal) {
        // Not a verdict on the task: leave it in flight so the queue re-queues it on the next boot.
        if (onBranch) await this.#parkBranch(project, task, 'interrupted');
        await engine.session?.close().catch(() => undefined);
        return;
      }
      const cancelled = err instanceof Cancelled || signal.aborted;
      if (!cancelled) this.#log.error({ taskId: task.id, err: errorMessage(err) }, 'task failed');
      if (onBranch) await this.#parkBranch(project, task, cancelled ? 'cancelled' : 'failed');
      task = this.#finish(task, cancelled ? 'cancelled' : 'failed', { error: cancelled ? 'cancelled by the owner' : errorMessage(err) });
    } finally {
      await engine.session?.close().catch(() => undefined);
    }

    // ---------------------------------------------------------------- Ledger
    // A task that reached a verdict leaves a receipt, pass or fail. Documents-only work has nothing to measure.
    if ((task.state === 'succeeded' || task.state === 'failed') && !ideation) {
      await this.#ledger.record(project, task, record).catch((err: unknown) => this.#log.warn({ taskId: task.id, err: errorMessage(err) }, 'could not write the ledger entry'));
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

  async #plan(project: Project, task: Task, lessonText: string, signal: AbortSignal, want: { anchor: boolean; screens: boolean; references: readonly ReferenceCapture[] }): Promise<Plan | null> {
    if (!this.#claude.isConfigured()) return null; // bridge-only installs: the engine plans for itself
    const captured = want.references.filter((r) => r.ok);
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
        textBlock(want.anchor ? 'This task needs an anchor table: fill in "anchor".' : 'No anchor table is needed from you for this task: set "anchor" to null.'),
        textBlock(want.screens ? 'This task needs a screen spec: fill in "screens".' : 'No screen spec is needed from you for this task: set "screens" to null.'),
        ...(await this.#approvedDesign(project, task)),
        // The planner is shown the references themselves; the engine, which has no eyes, gets the measurements.
        ...captured.flatMap((r) => [
          textBlock(referenceBlock(r)),
          ...(r.png ? [pngBlock(r.png)] : []),
          // The same page watched: read left to right, top to bottom. The captions are the studio's.
          ...(r.film ? [textBlock('The same page as frames over time, then down the scroll. Read it as a sequence: what enters, what keeps moving, what the scroll reveals.'), pngBlock(r.film)] : []),
        ]),
      ],
    });
    // The routes end up in URLs the QA browser visits; only plain app paths are kept.
    return { ...plan, screens: want.screens ? (plan.screens ?? null) : null, steps: plan.steps.slice(0, 20), auditRoutes: plan.auditRoutes.filter((r) => /^\/[\w\-./~%]*$/.test(r) && r.length <= 200).slice(0, 6), openQuestions: plan.openQuestions.slice(0, 6), anchor: want.anchor ? (plan.anchor ?? null) : null };
  }

  /**
   * The screen spec a design build owes before code. Returns null when the project has one that holds (its
   * own, or the planner's draft, which is committed here), and otherwise what is wrong, for the engine to be
   * told to write it first.
   */
  async #screenSpec(project: Project, task: Task, atStart: ScreenSpecRead | null, drafted: unknown): Promise<string[] | null> {
    if (atStart?.ok) return null;
    const scope = { projectId: project.id, taskId: task.id };
    const started = Date.now();
    const read = drafted === null || drafted === undefined ? null : readScreenSpec(drafted);
    if (read?.ok) {
      await this.#sandboxes.writeFile(project, SCREEN_SPEC_FILE, `${JSON.stringify(read.spec, null, 2)}\n`);
      await this.#sandboxes.commitAll(project, `docs: screen spec\n\nStudio Zero task ${task.id}`);
      this.#events.emit(scope, { type: 'gate.result', gate: 'screens', name: SCREEN_SPEC_FILE, passed: true, exitCode: null, durationMs: Date.now() - started, detail: '' });
      return null;
    }
    return read ? read.problems : atStart ? atStart.problems : [`${SCREEN_SPEC_FILE} is missing.`];
  }

  /** The screen spec as the workspace has it: read and checked, or null when there is no such file. */
  async #readSpec(project: Project): Promise<ScreenSpecRead | null> {
    const res = await this.#sandboxes.exec(project, `[ -f ${SCREEN_SPEC_FILE} ] && head -c 262144 ${SCREEN_SPEC_FILE}`, { timeoutSec: 20, maxOutputBytes: 300_000 });
    return res.exitCode !== 0 || res.stdout.trim() === '' ? null : readScreenSpec(res.stdout);
  }

  /**
   * What a build that follows a design task is planned from: the screen spec, and the head of the mock-up page
   * the owner picked (its name, its one-line idea, its theme seed). Without these the planner drafted the plan
   * and the anchor table from the request and a file listing alone, and could describe a direction other than
   * the one that was approved. Both were written by a model, so they travel as data.
   */
  async #approvedDesign(project: Project, task: Task): Promise<ReturnType<typeof textBlock>[]> {
    const blocks: ReturnType<typeof textBlock>[] = [];
    const spec = await this.#readSpec(project);
    if (spec?.ok) blocks.push(textBlock(`The product's screen spec (${SCREEN_SPEC_FILE}), written and approved before this build. The plan covers its screens and keeps its core flow; do not plan a different product:\n${untrusted('sandbox-output', renderScreenSpec(spec.spec, 8000))}`));
    const picked = new RegExp(`${MOCKUP_DIR}/[abc]\\.html`).exec(task.prompt)?.[0];
    if (picked) {
      const head = await this.#sandboxes.exec(project, `[ -f ${picked} ] && head -c 6000 ${picked}`, { timeoutSec: 20, maxOutputBytes: 8000 });
      const read = (pattern: RegExp): string => (pattern.exec(head.stdout)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);
      const title = read(/<title[^>]*>([^<]*)<\/title>/i);
      const idea = read(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
      if (head.exitCode === 0 && (title !== '' || idea !== '')) {
        blocks.push(textBlock(`The owner approved the mock-up page ${picked} as the direction to build. The anchor table states this direction (its idea, what its first screen leads with), not another:\n${untrusted('sandbox-output', `name: ${title}\nhow it makes the core moment work: ${idea}`)}`));
      }
    }
    return blocks;
  }

  /** The anchor table as the workspace has it: read and checked, or null when there is no such file. */
  async #readAnchor(project: Project): Promise<AnchorRead | null> {
    const res = await this.#sandboxes.exec(project, `[ -f ${ANCHOR_FILE} ] && head -c 65536 ${ANCHOR_FILE}`, { timeoutSec: 20 });
    return res.exitCode !== 0 || res.stdout.trim() === '' ? null : readAnchorTable(res.stdout);
  }

  /**
   * The gate before code. A design task proceeds only with a valid anchor table committed in its workspace:
   * the one an earlier task left, the one the planner just drafted, or one the engine writes in a round of its
   * own when there is neither. The check is the same for all three (`checkAnchorTable`), and an engine that
   * cannot produce a table that passes it does not get to start building.
   */
  async #anchor(project: Project, task: Task, p: { existing: AnchorRead | null; drafted: unknown; references: readonly ReferenceCapture[]; send: (content: string) => Promise<EngineResult>; checkCancel: () => void }): Promise<AnchorTable> {
    const scope = { projectId: project.id, taskId: task.id };
    const started = Date.now();
    const gate = (passed: boolean, detail: string): void => void this.#events.emit(scope, { type: 'gate.result', gate: 'anchor', name: ANCHOR_FILE, passed, exitCode: null, durationMs: Date.now() - started, detail });
    const committed = async (table: AnchorTable, author: 'planner' | 'engine' | 'workspace'): Promise<AnchorTable> => {
      if (author !== 'workspace') await this.#sandboxes.commitAll(project, `docs: anchor table\n\nStudio Zero task ${task.id}`);
      gate(true, '');
      this.#events.emit(scope, { type: 'anchor.committed', author, idea: table.idea, directions: [...table.directions], livingVisual: table.firstScreen.livingVisual });
      return table;
    };
    if (p.existing?.ok) return committed(p.existing.table, 'workspace');

    let problems = p.existing?.problems ?? [];
    if (p.drafted !== null && p.drafted !== undefined) {
      const drafted = readAnchorTable(p.drafted);
      if (drafted.ok) {
        await this.#sandboxes.writeFile(project, ANCHOR_FILE, anchorTableJson(drafted.table));
        return committed(drafted.table, 'planner');
      }
      problems = drafted.problems;
      // The planner's draft is where the engine starts from, with what was wrong with it.
      await this.#sandboxes.writeFile(project, ANCHOR_FILE, `${JSON.stringify(p.drafted, null, 2)}\n`);
    }
    for (let attempt = 0; attempt <= ANCHOR_CORRECTIONS; attempt++) {
      await p.send(anchorMessage(task, p.references, problems));
      p.checkCancel();
      const read = await this.#readAnchor(project);
      if (read?.ok) return committed(read.table, 'engine');
      problems = read ? read.problems : [`${ANCHOR_FILE} was not written.`];
    }
    gate(false, problems.join('\n'));
    throw new Error(`blocked before any code: ${ANCHOR_FILE} is missing or incomplete after ${ANCHOR_CORRECTIONS} corrections (${excerpt(problems.join(' '), 400)})`);
  }

  /** The first screen as the last audit captured it: the top of the first route, at up to two sizes. */
  async #firstScreen(audit: AuditReport | null): Promise<Uint8Array[]> {
    const route = audit?.screenshots[0]?.route;
    const tops = (audit?.screenshots ?? []).filter((shot) => shot.fold === 0 && shot.route === route).slice(0, 2);
    const captures: Uint8Array[] = [];
    for (const shot of tops) {
      const artifact = this.#store.getArtifact(shot.artifactId);
      const png = artifact ? await readFile(artifact.file).catch(() => null) : null;
      if (png) captures.push(png);
    }
    return captures;
  }

  /** The screen spec's states as the last audit photographed them: the top of each, up to four. */
  async #stateScreens(audit: AuditReport | null): Promise<{ label: string; png: Uint8Array }[]> {
    const shots = (audit?.screenshots ?? []).filter((shot) => shot.state !== undefined && shot.fold === 0).slice(0, 4);
    const states: { label: string; png: Uint8Array }[] = [];
    for (const shot of shots) {
      const artifact = this.#store.getArtifact(shot.artifactId);
      const png = artifact ? await readFile(artifact.file).catch(() => null) : null;
      if (png) states.push({ label: shot.state!, png });
    }
    return states;
  }

  /**
   * One verification round. Stages run in order of cost and of how little there is to argue about, and the round
   * ends at the first stage that fails: there is no point loading a page that does not compile, or measuring
   * the layout of one that throws on load.
   */
  #resumeState(taskId: string): z.infer<typeof Resume> | null {
    const stored = this.#store.kvGet(resumeKey(taskId));
    if (stored === null) return null;
    try {
      return Resume.parse(JSON.parse(stored));
    } catch {
      return null; // unreadable: run the task from the start, as if it had never been suspended
    }
  }

  async #verify(project: Project, task: Task, plan: Pick<Plan, 'auditRoutes'> | null, signal: AbortSignal, run: { design: boolean; record: RunRecord }): Promise<{ failures: Failure[]; unverified: string[]; waitingOn: string | null }> {
    const scope = { projectId: project.id, taskId: task.id };
    const record = run.record;

    const compiled = await this.#compiler.run(project, signal);
    if (compiled) {
      record.compilerErrors = countCompilerErrors(compiled.output, compiled.passed);
      record.firstCompilerErrors ??= record.compilerErrors;
      this.#events.emit(scope, { type: 'gate.result', gate: 'compiler', name: compiled.command, passed: compiled.passed, exitCode: compiled.exitCode, durationMs: compiled.durationMs, detail: compiled.passed ? '' : excerpt(compiled.output, 2000) });
      if (!compiled.passed) return { failures: [{ name: 'compiler', source: 'sandbox-output', detail: compiled.output, compiler: { command: compiled.command, exitCode: compiled.exitCode } }], unverified: [], waitingOn: null };
    }

    // The engine may revise the anchor table as it builds; it may not leave the work without a valid one.
    if (run.design) {
      const table = await this.#readAnchor(project);
      if (!table?.ok) {
        const detail = table ? table.problems.join('\n') : `${ANCHOR_FILE} is missing.`;
        this.#events.emit(scope, { type: 'gate.result', gate: 'anchor', name: ANCHOR_FILE, passed: false, exitCode: null, durationMs: 0, detail });
        return { failures: [{ name: 'anchor-table', source: 'sandbox-output', detail: `${ANCHOR_FILE} no longer holds as the anchor table for this work:\n${detail}` }], unverified: [], waitingOn: null };
      }
    }

    // And it may not be left without a screen spec that holds: what the screens do is fixed like what they are built around.
    if (run.design) {
      const spec = await this.#readSpec(project);
      if (!spec?.ok) {
        const detail = spec ? spec.problems.join('\n') : `${SCREEN_SPEC_FILE} is missing.`;
        this.#events.emit(scope, { type: 'gate.result', gate: 'screens', name: SCREEN_SPEC_FILE, passed: false, exitCode: null, durationMs: 0, detail });
        return { failures: [{ name: 'screen-spec', source: 'sandbox-output', detail: `${SCREEN_SPEC_FILE} does not hold as the screen spec for this work. Write or correct it in the shape you were given:\n${detail}` }], unverified: [], waitingOn: null };
      }
    }

    // The owner's switch for browser-backed checks is the visual eval: with it off, nothing here starts a browser.
    const browser = this.#evals.usesBrowser(project.id);
    let served = false;
    if (browser) {
      try {
        const smoke = await this.#smoke.run(project, { extraRoutes: plan?.auditRoutes, signal });
        served = smoke.passed;
        this.#events.emit(scope, { type: 'gate.result', gate: 'smoke', name: smoke.routes.join(' '), passed: smoke.passed, exitCode: null, durationMs: smoke.durationMs, detail: excerpt(smoke.detail, 2000) });
        if (!smoke.passed) return { failures: [{ name: 'smoke', source: 'browser-page', detail: smoke.detail }], unverified: [], waitingOn: null };
        record.flow = await this.#walkApp(project, task, signal);
      } catch (err) {
        if (signal.aborted) throw err;
        // The browser not starting is the studio's problem, not a defect in the work: say so and carry on.
        this.#log.warn({ taskId: task.id, err: errorMessage(err) }, 'smoke gate could not run');
        this.#events.emit(scope, { type: 'notice', level: 'warn', message: `Smoke test skipped: ${errorMessage(err)}` });
      }
    }

    const outcomes = await this.#evals.runAll(project, task.id, { extraRoutes: plan?.auditRoutes, commandsOnly: task.track === 'fast', devServerRunning: served, signal });
    const commands = outcomes.filter((o) => o.eval.spec.kind === 'command');
    record.checksPassed = commands.filter((o) => o.passed).length;
    record.checksFailed = commands.filter((o) => !o.passed).map((o) => o.eval.name);
    record.audit = outcomes.findLast((o) => o.audit !== null)?.audit ?? record.audit;
    // An unverified check is not sent back for repair: the engine cannot produce the review that did not run.
    const failures = outcomes.filter((o) => !o.passed && !o.unverified).map((o): Failure => ({ name: o.eval.name, source: o.eval.spec.kind === 'visual' ? 'browser-page' : 'sandbox-output', detail: o.detail }));
    // When the review is only out of quota and nothing else is wrong, the task waits for it instead of ending unjudged.
    const waiting = failures.length === 0 ? outcomes.find((o) => o.waitable) : undefined;
    return {
      failures,
      unverified: outcomes.filter((o) => o.unverified).map((o) => `${o.eval.name}: the design review did not run (${o.audit?.vision.reason ?? 'no reason recorded'}), so the design is not vouched for`),
      waitingOn: waiting ? (waiting.audit?.vision.reason ?? 'every design reviewer is at its usage limit') : null,
    };
  }

  /**
   * The screen spec's core flow, carried out on the app the smoke gate has just loaded. A measurement for the
   * receipt and for the acceptance reviewer, and not a gate: the counts are new, and a flow that needs a camera
   * or a login cannot be pressed through in a headless browser, so a walk that stops is said, not sent back for
   * repair. Null when the project has no screen spec, or the walk could not be had.
   */
  async #walkApp(project: Project, task: Task, signal: AbortSignal): Promise<RunRecord['flow']> {
    if (!this.#smoke.walk) return null;
    try {
      const spec = await this.#readSpec(project);
      if (!spec?.ok) return null;
      const tasks: FlowTask[] = spec.spec.tasks.map(({ id, goal, outcome }) => ({ id, goal, outcome }));
      const walked = await this.#smoke.walk(project, tasks, { signal });
      if (!walked) return null;
      const totals = flowTotals(walked.tasks, tasks.length);
      const through = totals.reached === totals.tasks;
      this.#events.emit({ projectId: project.id, taskId: task.id }, { type: 'notice', level: through ? 'info' : 'warn', message: `Core flow walked on the running app (${walked.route}): ${totals.reached} of ${totals.tasks} task(s) carried out, ${totals.presses} press(es), ${totals.scrolls} scroll(s).${through ? '' : ` ${walked.problems[0] ?? ''}`}` });
      return { ...totals, problems: walked.problems };
    } catch (err) {
      if (signal.aborted) throw err;
      this.#log.warn({ taskId: task.id, err: errorMessage(err) }, 'the core flow could not be walked on the app');
      return null;
    }
  }

  /** What a design task owes as files: each required document exists and has substance. */
  async #ideationDocuments(project: Project): Promise<Failure[]> {
    const script = IDEATION_REQUIRED_FILES.map((f) => `[ "$(wc -c < '${f}' 2>/dev/null || echo 0)" -ge 400 ] || echo '${f}'`).join('\n');
    const res = await this.#sandboxes.exec(project, script, { timeoutSec: 30 });
    const missing = res.stdout.trim().split('\n').filter(Boolean);
    return missing.length === 0 ? [] : [{ name: 'ideation-documents', source: 'sandbox-output', detail: `Missing or nearly empty: ${missing.join(', ')}` }];
  }

  /**
   * One verification round of a design task. Two things are owed and fail the task if they cannot be had: the
   * documents, and a screen spec that holds. Then the mock-ups are measured, and what that finds is `advisory`:
   * the engine is sent back to rework them a bounded number of times, and after that the owner is shown the
   * mock-ups with the findings instead of a failed task.
   *
   * A design review that could not run leaves the mock-ups measured and not judged; that is said and not
   * waited for. The owner is the one who chooses between them.
   */
  async #verifyIdeation(project: Project, task: Task, signal: AbortSignal): Promise<{ failures: Failure[]; unverified: string[]; waitingOn: null; advisory: boolean; drawn: MockupMeasurement | null }> {
    const scope = { projectId: project.id, taskId: task.id };
    const owed = (failures: Failure[]) => ({ failures, unverified: [], waitingOn: null, advisory: false, drawn: null });
    const missing = await this.#ideationDocuments(project);
    if (missing.length > 0) return owed(missing);

    const started = Date.now();
    const spec: ScreenSpecRead = (await this.#readSpec(project)) ?? { ok: false, problems: [`${SCREEN_SPEC_FILE} is missing or empty.`] };
    this.#events.emit(scope, { type: 'gate.result', gate: 'screens', name: SCREEN_SPEC_FILE, passed: spec.ok, exitCode: null, durationMs: Date.now() - started, detail: spec.ok ? '' : spec.problems.join('\n') });
    if (!spec.ok) return owed([{ name: 'screen-spec', source: 'sandbox-output', detail: `${SCREEN_SPEC_FILE} does not hold as the screen spec yet. Correct exactly these, keeping its shape:\n${spec.problems.map((line) => `- ${line}`).join('\n')}` }]);
    if (!this.#mockups) return owed([]);

    const tasks: FlowTask[] = spec.spec.tasks.map(({ id, goal, outcome }) => ({ id, goal, outcome }));
    const walkStarted = Date.now();
    const drawn = await this.#mockups.measure(project, { taskId: task.id, tasks, signal });
    const failures: Failure[] = [];
    const unverified: string[] = [];
    if (drawn.flowProblems.length > 0 || drawn.options.some((o) => o.flow)) {
      const detail = drawn.flowProblems.map((page) => `${page.file}\n${page.problems.map((line) => `- ${line}`).join('\n')}`).join('\n\n');
      this.#events.emit(scope, { type: 'gate.result', gate: 'flow', name: drawn.options.map((o) => o.file).join(' '), passed: drawn.flowProblems.length === 0, exitCode: null, durationMs: Date.now() - walkStarted, detail });
      if (drawn.flowProblems.length > 0) failures.push({ name: 'mockup-flow', source: 'browser-page', detail: `${MOCKUP_FLOW_NOTE}\n\n${detail}` });
    }
    if (drawn.audit) {
      const outcome = visualOutcome(drawn.audit, this.#config.audit.threshold);
      if (outcome.unverified) unverified.push(`the mock-ups: the design review did not run (${drawn.audit.vision.reason ?? 'no reason recorded'}), so they are measured and not judged`);
      else if (!outcome.passed) failures.push({ name: 'mockup-audit', source: 'browser-page', detail: `${MOCKUP_AUDIT_NOTE}\n\n${outcome.detail}` });
    }
    return { failures, unverified, waitingOn: null, advisory: true, drawn };
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
    this.#store.kvDelete(resumeKey(task.id));
    const updated = this.#store.updateTask(task.id, { state, phase: null, finishedAt: this.#clock(), ...patch });
    this.#events.emit({ projectId: task.projectId, taskId: task.id }, { type: 'task.state', state, error: patch.error ?? null });
    return updated;
  }
}

/** The owner's choice of engine, model and effort as the task carries it. Stored text is not trusted to be a choice. */
function pickOf(task: Task): EnginePick | null {
  const engine = EngineId.nullable().catch(null).parse(task.enginePref);
  return engine === null ? null : { engine, model: task.modelPref, effort: Effort.nullable().catch(null).parse(task.effortPref) };
}

/** A plan as text, for a prompt. A model wrote it from the request and a file listing: callers fence it as data where it is quoted to another model. */
function planText(plan: Pick<Plan, 'summary' | 'steps'>): string {
  return `${plan.summary}\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}

/** One measured reference, fenced: its title and every line of it are that page's content. */
function referenceBlock(ref: ReferenceCapture): string {
  return `Reference page ${ref.url} as measured in a browser. Read principles out of it; its numbers and assets are its own and are not to be carried across:\n${untrusted('browser-page', `${ref.title}\n${ref.summary}`, { url: ref.url })}`;
}

function executeMessage(task: Task, plan: Plan | null, lessonText: string, handed: { anchor: AnchorTable | null; critique: PlanCritique | null; references: readonly ReferenceCapture[]; revising?: boolean; specOwed?: string[] | null } = { anchor: null, critique: null, references: [] }): string {
  const parts = [task.kind === 'ideate' ? (handed.revising ? IDEATION_REVISION_BRIEF : IDEATION_BRIEF) : '', task.track === 'fast' && task.kind !== 'ideate' ? DRAFT_BRIEF : '', `The owner's request:\n${task.prompt}`];
  if (plan) parts.push(`Plan drafted for this request (follow it unless the code shows it is wrong; say so if you deviate):\n${planText(plan)}`);
  // The table's cells were written by a model that had read reference pages, so they travel as data; the instruction to build to it is the harness's.
  if (handed.anchor) parts.push(`The anchor table for this work is committed at ${ANCHOR_FILE}. Build to it: the idea, the first screen as it describes it, and our own values, not the references'.\n${untrusted('engine-output', renderAnchorTable(handed.anchor))}`);
  // No screen spec holds for this project yet: the engine writes it first. What was wrong is tool output, so it travels as data.
  if (handed.specOwed) {
    parts.push(`This project has no screen spec that holds yet. Before any interface code, write ${SCREEN_SPEC_FILE}, then build to it; the work is not accepted without one. ${SCREEN_SPEC_RULES}${handed.specOwed.length > 0 ? `\n\nWhat the check found:\n${untrusted('sandbox-output', handed.specOwed.map((line) => `- ${line}`).join('\n'))}` : ''}`);
  }
  for (const ref of handed.references.filter((r) => r.ok)) parts.push(referenceBlock(ref));
  if (handed.critique) {
    parts.push(
      `Before this build, a model from another vendor red-teamed the plan${handed.anchor ? ' and the anchor table' : ''}. It is one reviewer's reading, given once. Where it is right, change course${handed.anchor ? ` (and correct ${ANCHOR_FILE} first, keeping its shape)` : ''}; where it is wrong, carry on and say why in your final message.\n${untrusted('engine-output', renderCritique(handed.critique))}`,
    );
  }
  if (lessonText) parts.push(lessonText);
  return parts.filter(Boolean).join('\n\n');
}

/** The pre-code round: the engine is asked for the anchor table and nothing else. */
function anchorMessage(task: Task, references: readonly ReferenceCapture[], problems: readonly string[]): string {
  const parts = [ANCHOR_BRIEF, `The owner's request:\n${task.prompt}`, ...references.filter((r) => r.ok).map(referenceBlock)];
  if (problems.length > 0) parts.push(`The table in ${ANCHOR_FILE} was checked and does not hold yet. Correct exactly these:\n${problems.map((p) => `- ${p}`).join('\n')}`);
  return parts.join('\n\n');
}

/** Said above what a walk found, so the findings read as being about the pages and the two attributes they are walked by. */
const MOCKUP_FLOW_NOTE = `The studio opened each mock-up page in a browser, with scripts off as it is always shown, and carried out the core flow of ${SCREEN_SPEC_FILE} on it: for each task it pressed the control marked data-step="<task>:1", then "<task>:2" and so on, and then looked for something visible carrying data-done="<task>". These pages could not be walked to the end, or have controls in the flow that fall short. Fix the pages: the states are CSS states (checked inputs, :has(), <details>, :focus-within, :placeholder-shown), and each page opens in the state before the person acts.`;

/** Said above a mock-up audit: the same findings a build gets, pointed at pages of plain HTML and CSS. */
const MOCKUP_AUDIT_NOTE = 'The studio audited the mock-up pages under docs/mockups/ as it audits a built screen: measured from the DOM at each size, their words read as plain text, and a design reviewer shown each page. Each finding names its page as the route. Fix the pages themselves (their markup and their own CSS). Where a fix names a theme utility (text-fg, bg-surface, rounded-lg), use the theme value behind it, which the page keeps in its :root.';

/** The acceptance reviewer's single corrective patch, as the engine receives it. */
function patchMessage(acceptance: Acceptance): string {
  return `The work passed the harness's own checks, and a model from another vendor then reviewed it against the request and the anchor table. It did not accept it as it is and issued one corrective patch. Carry it out, then stop so the work can be verified again. There is no further review after this one, so make the changes completely; if a point is mistaken about what was asked, leave it and say why in your final message.\n\n${untrusted('engine-output', renderPatch(acceptance))}`;
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

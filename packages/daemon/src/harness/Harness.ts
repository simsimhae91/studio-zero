import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AcceptanceVerdict, Effort, ReviewerId, ReviewerPref, ScreenSpec as ScreenSpecShape, type AuditReport, type Phase, type PlanFeedback, type ProductMap, type Project, type Task, type TaskState } from '@studio-zero/protocol';
import { EngineId, type Config } from '../config.ts';
import { classifyQuotaFailure } from '../app/QuotaTracker.ts';
import type { PlanVersionRow, Store } from '../db/Store.ts';
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
import { DIRECTIONS_FILE, directionThemeFile, readDirections, renderDirection, type Direction, type DirectionId, type DirectionsRead } from '../scratch/Directions.ts';
import { renderScenarioFeedback, type ScenarioRunnerLike, type ScreenLook } from '../qa/ScenarioRunner.ts';
import { variantOf } from '../arms/kit.ts';
import { SCREEN_DOC_FILE, SCREEN_SPEC_FILE, readScreenSpec, renderScreenSpec, screenSpecMarkdown, type FlowTask, type ScreenSpecRead } from '../scratch/ScreenSpec.ts';
import { untrusted, type UntrustedSource } from '../trust/dataBlock.ts';
import { errorMessage, excerpt, newId, type Clock, type Logger } from '../util/core.ts';
import type { WorkspaceProvisioner } from './bootstrap.ts';
import type { BuildMeter } from './BuildMeter.ts';
import type { CompilerGate } from './CompilerGate.ts';
import { visualOutcome, type EvalRunner } from './EvalRunner.ts';
import type { EngineResult, EngineSession } from './engines/Engine.ts';
import { countCompilerErrors, emptyRun, renderEvidence, type Ledger, type RunRecord } from './Ledger.ts';
import type { LessonBook } from './LessonBook.ts';
import { materialFor } from './handbook.ts';
import { ANCHOR_BRIEF, CONTINUED_BRIEF, DEEP_DIVE_BRIEF, DRAFT_BRIEF, MILESTONE_BRIEF, DRAW_ALL_BRIEF, IDEATION_BRIEF, IDEATION_REQUIRED_FILES, IDEATION_REVISION_BRIEF, PLAN_REVISION_BRIEF, PLANNER_SYSTEM_PROMPT, SCREEN_SPEC_RULES, codingSystemPrompt, directionBrief } from './prompts.ts';
import { hashPlan, renderPlanMarkdown, type PlanGate } from './PlanGate.ts';
import { chosenTheme, writeProjectTheme } from './themeSeed.ts';
import type { ReflectionAgent } from './ReflectionAgent.ts';
import { PlanCritique, renderCritique, renderPatch, type Acceptance, type SandwichReviewer } from './SandwichReviewer.ts';
import { foldListing } from './fileListing.ts';
import { uncovered } from '../product/coverage.ts';
import { PRODUCT_DOC_FILE, PRODUCT_MAP_FILE, renderProductMap } from '../product/ProductMap.ts';
import type { SelfHosting } from './SelfHosting.ts';
import { copyBlock } from './TextSlopAuditor.ts';

export const INTEGRATION_BRANCH = 'main';
const HOUR_MS = 60 * 60 * 1000;
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
/** How many times a design task's lead engine is sent back to its directions table before it draws the directions itself, one after another. */
const DIRECTION_CORRECTIONS = 1;

/** One thing a verification round found wrong. `detail` is tool or page output: it reaches the engine inside a data block. */
interface Failure {
  name: string;
  source: UntrustedSource;
  detail: string;
  /** Set for the compiler gate, whose feedback names the command and its exit code. */
  compiler?: { command: string; exitCode: number };
}

class Cancelled extends Error {}
/** The owner asked to see the plan and the task cannot go on without their word: it stops, with this as its reason. */
class PlanReviewStopped extends Error {}

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
 *            Another vendor's model red-teams the plan and the table, once. A task the owner submitted with
 *            `reviewPlan` then waits for their word on the plan (see `PlanGate` and `#reviewPlan`); others do not.
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
 * shown to the owner beside the mock-ups, and is nobody's to rework: the engine drew with the same measurement
 * in hand.
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
 * A task can also stop short for a while. When its engine (or the session brain) is refused by a subscription
 * for a usage limit, and the refusal names when the limit resets, within `quotaPark.maxWaitHours`, the
 * unfinished work is committed on its branch and the task is `parked` until then. The queue wakes it at that
 * time, queued as an interrupted task is after a restart, and it goes on from that commit on its branch, told
 * that the work is there (a design task starts its documents again). After
 * `quotaPark.maxParks` waits the next such refusal fails the task, with `parkCapHit` on the failure. A refusal
 * that names no reset time fails the task as any other error does.
 *
 * Whatever happens, the workspace is left recoverable: there is a checkpoint from before the task, the work is
 * committed on its own branch, and a failed task puts the workspace back on the integration branch.
 */
/** What a task's screen spec is held to: whether it must say how the product works, and whether the short plan of a draft will do. */
/** How many rounds that only corrected the screen plan are not charged to a task's corrections. */
const FREE_PLAN_ROUNDS = 3;

interface SpecDemand {
  works: boolean;
  draft: boolean;
  /** A product built to a map: a scenario a feature, so many more of them than a first version has. */
  wide?: boolean;
}

/** The milestone of a product map a task builds: the map, and which of its milestones (from 0). */
interface Building {
  map: ProductMap;
  index: number;
  /** Whether what was measured on the walked screens has been sent back already: it is, once. */
  sentBack: boolean;
}

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
  readonly #scenarios: ScenarioRunnerLike | null;
  readonly #lessons: LessonBook;
  readonly #reflection: ReflectionAgent;
  readonly #refkit: RefKit;
  readonly #reviewer: SandwichReviewer;
  readonly #ledger: Ledger;
  readonly #build: BuildMeter;
  readonly #mockups: Pick<MockupRenderer, 'measure'> | null;
  readonly #core: SelfHosting | null;
  readonly #gate: PlanGate | null;
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
    /** Walks the plan's scenarios on the running build. Without one, a build is not held to them. */
    scenarios?: ScenarioRunnerLike | null;
    lessons: LessonBook;
    reflection: ReflectionAgent;
    refkit: RefKit;
    reviewer: SandwichReviewer;
    ledger: Ledger;
    build: BuildMeter;
    mockups?: Pick<MockupRenderer, 'measure'> | null;
    selfHosting?: SelfHosting | null;
    /** Where a task submitted with `reviewPlan` waits for the owner's word on its plan. Without one, no task waits. */
    planGate?: PlanGate | null;
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
    this.#scenarios = deps.scenarios ?? null;
    this.#lessons = deps.lessons;
    this.#reflection = deps.reflection;
    this.#refkit = deps.refkit;
    this.#reviewer = deps.reviewer;
    this.#ledger = deps.ledger;
    this.#build = deps.build;
    this.#mockups = deps.mockups ?? null;
    this.#core = deps.selfHosting ?? null;
    this.#gate = deps.planGate ?? null;
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
    /** A design task's other conversations: one per direction, each drawing its own page while the lead writes on. */
    const lanes = new Map<DirectionId, EngineSession>();
    const closeAll = async (): Promise<void> => {
      await Promise.all([engine.session, ...lanes.values()].map((session) => session?.close().catch(() => undefined)));
    };
    let onBranch = false;
    /** Whether this run goes on from work the task committed before a usage limit stopped it. */
    let continued = false;
    let appliedLessons: string[] = [];
    const resume = this.#resumeState(initial.id);
    // A task that stopped (a restart, a usage limit) with its plan already in front of the owner goes back to that
    // stored version, waiting or decided, and is not planned again.
    const held = initial.reviewPlan && this.#gate ? this.#gate.latest(initial.id) : null;
    // A build whose design gates are on is a design task: it owes an anchor table before code.
    const design = initial.kind === 'build' && !draft && this.#evals.usesBrowser(project.id);
    // A build of a product is held to its screen plan as a product that works: who uses it, how they get in,
    // what each does and what is kept. A draft writes the short plan; it does not get to skip it.
    // What is taken from another repository is built as a build is: it is something the product now does.
    const working = (initial.kind === 'build' || initial.kind === 'kirby_materialize') && this.#evals.usesBrowser(project.id) && variantOf(project.template) !== null;
    // A milestone of a product map: built on the map, its plan as wide as the map, each feature built so far walked.
    const mapped = initial.milestone === null || initial.milestone === undefined ? null : (this.#store.getRoadmap(project.id)?.map ?? null);
    const building: Building | null = mapped && mapped.milestones[initial.milestone ?? -1] ? { map: mapped, index: initial.milestone!, sentBack: false } : null;
    const specFor: SpecDemand | null = design || working ? { works: working, draft, ...(building ? { wide: true } : {}) } : null;
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
      /** An extension being asked for now. Conversations that run out together share the one question. */
      let extending: Promise<void> | null = null;
      const sendTo = async (engineSession: EngineSession, content: string): Promise<EngineResult> => {
        let result = await engineSession.send(content);
        while (result.stopped === 'budget') {
          const spent = this.#store.getTask(task.id)?.spentTokens ?? 0;
          if (result.deniedRule !== 'budget.task') throw new Error(`the project's daily token budget is used up (task has spent ${spent} tokens)`);
          extending ??= (async () => {
            if (extensions >= MAX_BUDGET_EXTENSIONS) throw new Error(`token budget exhausted after ${extensions} extensions (${spent} tokens used)`);
            try {
              await this.#policy.authorize({ type: 'system' }, { kind: 'task.extend-budget', projectId: project.id, taskId: task.id, addTokens: initial.budgetTokens, spentTokens: spent }, { taskId: task.id, signal, onWaiting });
            } catch (err) {
              if (err instanceof ApprovalDeniedError) throw new Error(`token budget exhausted (${spent} tokens used) and an extension was not approved`);
              throw err;
            }
            extensions += 1;
            this.#store.extendTaskBudget(task.id, initial.budgetTokens);
          })().finally(() => {
            extending = null;
          });
          await extending;
          result = await engineSession.send('Your token budget was extended. Continue from where you stopped.');
        }
        return result;
      };
      const send = async (content: string): Promise<EngineResult> => sendTo(await open(), content);
      /** One more conversation with the task's engine, beside the main one. */
      const openLane = async (lane: DirectionId): Promise<EngineSession> => {
        const decided = await routed();
        const session = await decided.engine.open({ project, task, route: decided.candidate, system: codingSystemPrompt(project.template), signal, onWaiting, lane });
        lanes.set(lane, session);
        return session;
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
        // Woken from a usage limit, a task goes on from the work it committed when it stopped: the limit has
        // only just reset, and doing the same work twice is the surest way back to it. A design task starts its
        // documents again, as any other run does: a half-written set would be read as a design to revise.
        // A held plan's anchor table and screen spec are committed on the branch: it is gone back to as well.
        continued = (await this.#sandboxes.startBranch(project, branch, task.baseBranch ?? INTEGRATION_BRANCH, { keep: (task.parkCount > 0 && !ideation) || held !== null })) && task.parkCount > 0 && !ideation;
        onBranch = true;
        // The branch the engine works on may predate a kit the prompt is about to promise it.
        await this.#provisioner.ensure(project);
        // The map a milestone is built to is in the workspace before the engine opens it: the brief points at the file.
        if (building) await this.#writeProductMap(project, building.map);
        // The table has a level for every engine; it is recorded only where the engine was actually run at one.
        task = this.#store.updateTask(task.id, { engine: decided.candidate.engine, model: decided.candidate.model, effort: decided.engine.efforts.length > 0 ? decided.candidate.effort : null, branch, baseCheckpointId: base.id });

        const lessons = this.#lessons.forTask(project.id);
        appliedLessons = lessons.ids;
        // What the builder is handed before it builds decides more than how the build is organised. So first:
        // the references the owner pointed at, measured in the browser container; the anchor table; one red team.
        references = task.references.length > 0 && !draft ? await this.#refkit.capture(project, task.id, task.references, signal) : [];
        const existing = design ? await this.#readAnchor(project) : null;
        const specAtStart = specFor ? await this.#readSpec(project, specFor) : null;
        // A draft goes straight to the engine: the planning call is a model round trip the owner would wait through.
        plan = held ? storedPlan(held) : !draft && (task.kind === 'build' || task.kind === 'refactor' || task.kind === 'kirby_materialize') ? await this.#plan(project, task, lessons.text, signal, { anchor: design && existing?.ok !== true, screens: design && specAtStart?.ok !== true, references }) : null;
        if (plan && !held) this.#events.emit(scope, { type: 'plan.created', summary: plan.summary, steps: plan.steps, auditRoutes: plan.auditRoutes, appliedLessonIds: lessons.ids });
        checkCancel();

        if (design) {
          anchor = await this.#anchor(project, task, { existing, drafted: plan?.anchor ?? null, references, send, checkCancel });
          checkCancel();
        }
        // The other half of what is fixed before code: what each screen does. Kept if the project has one that
        // holds; otherwise the planner's draft is checked and committed, and failing that the engine is told to
        // write it first. Either way the work is not accepted without one (see `#verify`).
        let specOwed = specFor ? await this.#screenSpec(project, task, specAtStart, plan?.screens ?? null, specFor) : null;
        // A held plan was cross-reviewed when it was stored; that critique is the one it is built with.
        let critique: PlanCritique | null = held ? storedCritique(held) : null;
        if (crossChecked && (plan !== null || anchor !== null) && held === null) {
          // The plan was drafted by Claude when there is one; otherwise what is reviewed is the engine's own work.
          const checked = await this.#reviewer.redTeam({ scope, author: plan !== null ? 'native-claude' : decided.candidate.engine, pref: reviewerPref, request: task.prompt, plan: plan ? planText(plan) : null, anchor: anchor ? renderAnchorTable(anchor) : null, signal });
          record.planReviewer = checked.reviewer;
          critique = checked.result;
          checkCancel();
        }

        // ---------------------------------------------------------- Plan review
        // Only when the owner asked to see the plan first. Without that, nothing here runs and nothing waits.
        if (task.reviewPlan && this.#gate) {
          if (plan === null) {
            this.#events.emit(scope, { type: 'notice', level: 'warn', message: 'The owner asked to see the plan before code, but this task drafts no plan of its own (the daemon has no model to plan with), so there is nothing to show: the engine plans for itself.' });
          } else {
            ({ plan, critique, anchor, specOwed } = await this.#reviewPlan(project, task, this.#gate, {
              plan,
              critique,
              anchor,
              specOwed,
              held,
              existing,
              specAtStart,
              specFor,
              design,
              crossChecked,
              reviewerPref,
              lessonText: lessons.text,
              references,
              record,
              send,
              checkCancel,
              signal,
            }));
            task = this.#store.getTask(task.id) ?? task;
          }
        }

        // ------------------------------------------------------------- Execute
        phase('execute', 1);
        await open();
        // A design task that starts where a finished design already is (the owner sent it back with notes) revises it.
        const revising = ideation && (await this.#ideationDocuments(project)).length === 0;
        result = await send(executeMessage(task, plan, lessons.text, { anchor, critique, references, revising, specOwed, template: project.template, continued }));
        checkCancel();
        // A new design: its directions are drawn from the table the lead just wrote, each by an engine of its own.
        if (ideation && !revising) {
          result = await this.#drawDirections(project, task, { send, sendTo, openLane, lanes, checkCancel });
          checkCancel();
        }
      }

      // ---------------------------------------------------------------- Verify
      let unverified: string[] = [];
      let waitingOn: string | null = null;
      let round = 0;
      /** A design task's mock-ups as measured, and what the measurement found wrong with them. */
      let drawn: MockupMeasurement | null = null;
      let outstanding: string[] = [];
      /** Verifies, and has the engine repair what failed, until a round is clean or the corrections run out. */
      const verifyUntilClean = async (): Promise<void> => {
        const corrections = this.#config.budgets.verifyRounds;
        let planRounds = 0;
        for (let used = 0; ; ) {
          round += 1;
          phase('verify', round);
          const looked = ideation ? await this.#verifyIdeation(project, task, signal) : null;
          const checked = looked ?? (await this.#verify(project, task, plan, signal, { design, spec: specFor, record, building }));
          record.rounds = round;
          const failures = checked.failures;
          unverified = checked.unverified;
          waitingOn = checked.waitingOn;
          if (looked) drawn = looked.drawn;
          checkCancel();
          if (failures.length === 0) return;
          if (looked?.advisory) {
            // What the measurement found on the mock-ups is said, and nobody is sent back. A drawing is for the
            // owner to judge; the engine had the same measurement to work with while it drew (`check_mockup`).
            // The one real run of the loop this replaces: a rework turn took 21 minutes and a million tokens,
            // moved the grade from F to D, and broke the flow that had walked.
            outstanding = failures.map((f) => f.name);
            return;
          }
          // What was measured on a milestone's walked screens is sent back once and never again (`#walkedScreens`),
          // so it cannot loop, and it is not charged to the corrections a product that does not yet work needs.
          const looksOnly = failures.every((f) => f.name === 'looks');
          // A plan that does not hold yet (its shape, a feature with no scenario) is a document to correct: a
          // turn of seconds that says nothing about whether the product works. The first real build to a map
          // spent all three corrections on it and failed at the first check of the product itself. A few such
          // rounds are not charged; past them it is charged like anything else, so it cannot go on for ever.
          // (A design task's documents are its work, and it is held to them as before.)
          const planOnly = !ideation && failures.every((f) => f.name === 'screen-spec' || f.name === 'coverage') && planRounds < FREE_PLAN_ROUNDS;
          if (planOnly) planRounds += 1;
          const free = looksOnly || planOnly;
          if (!free && used >= corrections) throw new Error(`verification still failing after ${corrections} corrections: ${failures.map((f) => f.name).join(', ')}`);
          if (!free) used += 1;

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
          unverified = [...unverified, `the measurement finds problems on the mock-ups (${outstanding.join(', ')}); they are shown with what was found`];
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
        await closeAll();
        return;
      }
      const cancelled = err instanceof Cancelled || signal.aborted;
      // Stopped at the plan review: not a failure of the work, which has not started, and not a verdict to learn from.
      const stopped = err instanceof PlanReviewStopped;
      // A subscription that refused for a usage limit and said when it resets: the task waits for that, a few
      // times at most, instead of failing on something time alone fixes.
      const limit = cancelled || stopped ? null : classifyQuotaFailure({ engine: task.engine, error: err }, this.#clock());
      const soonEnough = limit !== null && limit.resetAt - this.#clock() <= this.#config.quotaPark.maxWaitHours * HOUR_MS;
      const parks = this.#store.getTask(task.id)?.parkCount ?? task.parkCount;
      const { maxParks } = this.#config.quotaPark;
      if (limit !== null && soonEnough && parks < maxParks) {
        this.#log.warn({ taskId: task.id, subscription: limit.subscription, resumeAt: limit.resetAt }, 'task parked on a usage limit');
        if (onBranch) await this.#parkBranch(project, task, 'waiting for a usage limit to reset');
        const parked = this.#store.parkTask(task.id, limit.resetAt);
        if (parked) {
          task = parked;
          this.#events.emit(scope, { type: 'task.parked', subscription: limit.subscription, resumeAt: limit.resetAt, parkCount: parked.parkCount });
          this.#events.emit(scope, { type: 'task.state', state: 'parked', error: null });
          return;
        }
      }
      if (!cancelled && !stopped) this.#log.error({ taskId: task.id, err: errorMessage(err) }, 'task failed');
      if (onBranch) await this.#parkBranch(project, task, cancelled || stopped ? 'cancelled' : 'failed');
      task = this.#finish(task, cancelled || stopped ? 'cancelled' : 'failed', { error: cancelled ? 'cancelled by the owner' : errorMessage(err) }, limit !== null && soonEnough && maxParks > 0 && parks >= maxParks);
    } finally {
      await closeAll();
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

  /** `revise`: the plan the owner sent back, as they read it, and their notes on it. It goes in the user turn; the system prompt is the same. */
  async #plan(project: Project, task: Task, lessonText: string, signal: AbortSignal, want: { anchor: boolean; screens: boolean; references: readonly ReferenceCapture[] }, revise?: { previous: string; feedback: readonly PlanFeedback[] }): Promise<Plan | null> {
    if (!this.#claude.isConfigured()) return null; // bridge-only installs: the engine plans for itself
    const captured = want.references.filter((r) => r.ok);
    // Every file while they fit; beyond that the layout, deepest folders folded first (see `foldListing`).
    const listed = await this.#sandboxes.exec(project, 'git ls-files --cached --others --exclude-standard', { timeoutSec: 30, maxOutputBytes: 4 * 1024 * 1024 });
    const listing = foldListing(listed.stdout.split('\n')).join('\n');
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
        textBlock(`Project stack template: ${project.template}. Files in the workspace:\n${untrusted('sandbox-output', listing || '(empty workspace)')}`),
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
        ...(revise ? [textBlock(PLAN_REVISION_BRIEF), textBlock(`The plan you drafted before:\n${untrusted('engine-output', revise.previous)}`), textBlock(`The owner's notes on it:\n${ownerNotes(revise.feedback)}`)] : []),
      ],
    });
    // The routes end up in URLs the QA browser visits; only plain app paths are kept.
    return { ...plan, screens: want.screens ? (plan.screens ?? null) : null, steps: plan.steps.slice(0, 20), auditRoutes: plan.auditRoutes.filter((r) => /^\/[\w\-./~%]*$/.test(r) && r.length <= 200).slice(0, 6), openQuestions: plan.openQuestions.slice(0, 6), anchor: want.anchor ? (plan.anchor ?? null) : null };
  }

  /**
   * The owner's look at the plan before code (see `PlanGate`). The plan, as cross-reviewed, is stored and the task
   * waits. Sent back, it is planned again with the owner's notes in the planner's user turn, its anchor table and
   * screen spec are checked and committed again, it is cross-reviewed again, and it waits again; the gate caps
   * how often. Approved, the build follows the version the owner approved, read back from where it is stored and
   * held to the hash they approved. No answer by the deadline stops the task, with its versions kept.
   */
  async #reviewPlan(
    project: Project,
    task: Task,
    gate: PlanGate,
    s: {
      plan: Plan;
      critique: PlanCritique | null;
      anchor: AnchorTable | null;
      specOwed: string[] | null;
      held: PlanVersionRow | null;
      existing: AnchorRead | null;
      specAtStart: ScreenSpecRead | null;
      specFor: SpecDemand | null;
      design: boolean;
      crossChecked: boolean;
      reviewerPref: ReviewerPref | null;
      lessonText: string;
      references: readonly ReferenceCapture[];
      record: RunRecord;
      send: (content: string) => Promise<EngineResult>;
      checkCancel: () => void;
      signal: AbortSignal;
    },
  ): Promise<{ plan: Plan; critique: PlanCritique | null; anchor: AnchorTable | null; specOwed: string[] | null }> {
    const scope = { projectId: project.id, taskId: task.id };
    let { critique, anchor, specOwed } = s;
    let outcome = await (s.held ? gate.wait(scope, s.held, s.signal) : gate.open(scope, s.plan, critique, s.signal));
    for (;;) {
      s.checkCancel();
      if (outcome.outcome === 'timeout') {
        throw new PlanReviewStopped(`계획 ${outcome.row.version}번째 안을 ${this.#config.planReview.timeoutHours}시간 기다렸지만 답이 없어 작업을 멈췄습니다. 계획은 남아 있습니다. 진행하려면 같은 요청을 다시 보내 주세요.`);
      }
      const stored = storedPlan(outcome.row);
      if (outcome.outcome === 'approved') {
        // What runs is what was approved: the stored plan, rendered again and held to the hash the owner saw.
        if (hashPlan(renderPlanMarkdown(stored)) !== outcome.row.sha256) throw new PlanReviewStopped(`저장된 계획 ${outcome.row.version}번째 안이 승인한 내용과 다릅니다. 코드를 쓰기 전에 멈췄습니다.`);
        this.#events.emit(scope, { type: 'notice', level: 'info', message: `The owner approved version ${outcome.row.version} of the plan. The build follows it.` });
        return { plan: stored, critique, anchor, specOwed };
      }

      // Sent back with notes: the same planning again, told what the owner said about the version they read.
      const want = { anchor: stored.anchor !== null, screens: stored.screens !== null, references: s.references };
      const revised = await this.#plan(project, task, s.lessonText, s.signal, want, { previous: outcome.row.planMarkdown, feedback: outcome.row.feedback });
      if (!revised) throw new Error('the plan could not be drafted again: the daemon has no model to plan with');
      this.#events.emit(scope, { type: 'plan.created', summary: revised.summary, steps: revised.steps, auditRoutes: revised.auditRoutes, appliedLessonIds: [] });
      s.checkCancel();
      // A table or spec the planner drafted is the planner's to redraw; one the project already had stays.
      if (s.design) {
        anchor = await this.#anchor(project, task, { existing: want.anchor ? null : s.existing, drafted: revised.anchor, references: s.references, send: s.send, checkCancel: s.checkCancel });
        s.checkCancel();
      }
      if (s.specFor) specOwed = await this.#screenSpec(project, task, want.screens ? null : s.specAtStart, revised.screens, s.specFor);
      critique = null;
      if (s.crossChecked) {
        const checked = await this.#reviewer.redTeam({ scope, author: 'native-claude', pref: s.reviewerPref, request: task.prompt, plan: planText(revised), anchor: anchor ? renderAnchorTable(anchor) : null, signal: s.signal });
        s.record.planReviewer = checked.reviewer;
        critique = checked.result;
        s.checkCancel();
      }
      outcome = await gate.open(scope, revised, critique, s.signal);
    }
  }

  /**
   * The screen spec a design build owes before code. Returns null when the project has one that holds (its
   * own, or the planner's draft, which is committed here), and otherwise what is wrong, for the engine to be
   * told to write it first.
   */
  async #screenSpec(project: Project, task: Task, atStart: ScreenSpecRead | null, drafted: unknown, demand: SpecDemand): Promise<string[] | null> {
    if (atStart?.ok) return null;
    const scope = { projectId: project.id, taskId: task.id };
    const started = Date.now();
    const read = drafted === null || drafted === undefined ? null : readScreenSpec(drafted, demand);
    if (read?.ok) {
      await this.#sandboxes.writeFile(project, SCREEN_SPEC_FILE, `${JSON.stringify(read.spec, null, 2)}\n`);
      await this.#writeScreenDoc(project, read);
      await this.#sandboxes.commitAll(project, `docs: screen spec\n\nStudio Zero task ${task.id}`);
      this.#events.emit(scope, { type: 'gate.result', gate: 'screens', name: SCREEN_SPEC_FILE, passed: true, exitCode: null, durationMs: Date.now() - started, detail: '' });
      return null;
    }
    return read ? read.problems : atStart ? atStart.problems : [`${SCREEN_SPEC_FILE} is missing.`];
  }

  /** The screen spec as the workspace has it: read and checked, or null when there is no such file. */
  async #readSpec(project: Project, demand: Partial<SpecDemand> = {}): Promise<ScreenSpecRead | null> {
    const res = await this.#sandboxes.exec(project, `[ -f ${SCREEN_SPEC_FILE} ] && head -c 262144 ${SCREEN_SPEC_FILE}`, { timeoutSec: 20, maxOutputBytes: 300_000 });
    return res.exitCode !== 0 || res.stdout.trim() === '' ? null : readScreenSpec(res.stdout, demand);
  }

  /**
   * What was measured on the screens a milestone's scenarios stood on. Blockers and majors go back to the builder
   * once. What that one round does not clear is written against the milestone as work still owed, and the
   * milestone is not held on it: a product is not left half built over a contrast ratio, and the owner is told
   * the ratio. Each screen's picture is kept either way.
   */
  async #walkedScreens(project: Project, task: Task, building: Building, looks: readonly ScreenLook[]): Promise<Failure | null> {
    const scope = { projectId: project.id, taskId: task.id };
    const lines = [
      ...new Set(
        looks.flatMap((look) =>
          look.findings
            .filter((finding) => finding.severity !== 'minor')
            .map((finding) => `Screen ${look.screen} (scenario "${look.scenario}"), ${finding.severity}, ${finding.rule}: ${finding.message}${finding.selector ? ` At ${finding.selector}.` : ''}${finding.fix ? ` ${finding.fix}` : ''}`),
        ),
      ),
    ];
    const shots: { screen: string; artifactId: string }[] = [];
    const dir = join(this.#config.artifactsDir, project.id, task.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    for (const look of looks) {
      if (!look.png) continue;
      const artifactId = newId('art');
      const file = join(dir, `${artifactId}.png`);
      await writeFile(file, look.png, { mode: 0o600 });
      this.#store.insertArtifact({ id: artifactId, projectId: project.id, mime: 'image/png', file, createdAt: this.#clock() });
      shots.push({ screen: look.screen, artifactId });
    }
    // The same findings as the owner reads them on the roadmap: which screen, how heavy, and the measurement.
    const owed = [
      ...new Set(
        looks.flatMap((look) =>
          look.findings.filter((finding) => finding.severity !== 'minor').map((finding) => `${look.screen} 화면 (시나리오 ${look.scenario}) · ${finding.severity === 'blocker' ? '막는 결함' : '큰 결함'} · ${finding.rule}: ${finding.message}`),
        ),
      ),
    ];
    const sendBack = lines.length > 0 && !building.sentBack;
    this.#events.emit(scope, { type: 'gate.result', gate: 'looks', name: `${looks.length} screens`, passed: lines.length === 0, exitCode: null, durationMs: 0, detail: lines.length === 0 ? `${looks.length} screens measured as the walk stood on them: nothing above minor` : excerpt(lines.join('\n'), 3000) });
    this.#store.noteMilestone(project.id, building.index, { shots, debt: sendBack ? [] : owed.slice(0, 60) }, this.#clock());
    if (!sendBack) {
      if (lines.length > 0) this.#events.emit(scope, { type: 'notice', level: 'warn', message: `마일스톤 ${building.index + 1}: 걸은 화면에서 잰 결함 ${lines.length}건이 한 번 고친 뒤에도 남았습니다. 로드맵에 남은 일로 적었습니다.` });
      return null;
    }
    building.sentBack = true;
    return {
      name: 'looks',
      source: 'browser-page',
      detail: `Every scenario reached its end. The studio then measured each screen its people stood on, signed in, at the size they were walked at. These are measurements, not opinions; fix each in the code of the screen it names, and change nothing about how the scenarios are walked:\n${lines.map((line) => `- ${line}`).join('\n')}`,
    };
  }

  /** Puts the product map and its written-out form in the workspace, where they differ from what is there. Committed with the task's work. */
  async #writeProductMap(project: Project, map: ProductMap): Promise<void> {
    const files: [string, string][] = [
      [PRODUCT_MAP_FILE, `${JSON.stringify(map, null, 2)}\n`],
      [PRODUCT_DOC_FILE, renderProductMap(map)],
    ];
    for (const [path, content] of files) {
      const held = await this.#sandboxes.exec(project, `cat ${path} 2>/dev/null; true`, { timeoutSec: 15, maxOutputBytes: 600_000 });
      if (held.stdout !== content) await this.#sandboxes.writeFile(project, path, content);
    }
  }

  /**
   * Writes the plan out for a person to read, beside the JSON it is made from, whenever that JSON holds and
   * the document on disk says something else. The owner reads this one; nobody edits it.
   */
  async #writeScreenDoc(project: Project, read: ScreenSpecRead): Promise<void> {
    if (!read.ok) return;
    const doc = screenSpecMarkdown(read.spec);
    const held = await this.#sandboxes.exec(project, `cat ${SCREEN_DOC_FILE} 2>/dev/null; true`, { timeoutSec: 15, maxOutputBytes: 600_000 });
    if (held.stdout !== doc) await this.#sandboxes.writeFile(project, SCREEN_DOC_FILE, doc);
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

  async #verify(project: Project, task: Task, plan: Pick<Plan, 'auditRoutes'> | null, signal: AbortSignal, run: { design: boolean; spec: SpecDemand | null; record: RunRecord; building?: Building | null }): Promise<{ failures: Failure[]; unverified: string[]; waitingOn: string | null }> {
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
    if (run.spec) {
      const spec = await this.#readSpec(project, run.spec);
      if (spec?.ok) await this.#writeScreenDoc(project, spec);
      if (!spec?.ok) {
        const detail = spec ? spec.problems.join('\n') : `${SCREEN_SPEC_FILE} is missing.`;
        this.#events.emit(scope, { type: 'gate.result', gate: 'screens', name: SCREEN_SPEC_FILE, passed: false, exitCode: null, durationMs: 0, detail });
        return { failures: [{ name: 'screen-spec', source: 'sandbox-output', detail: `${SCREEN_SPEC_FILE} does not hold as the screen spec for this work. Write or correct it in the shape you were given:\n${detail}` }], unverified: [], waitingOn: null };
      }
      // A milestone is not done while a feature built so far has nothing that walks it: what the plan does not list, nobody checks.
      if (run.building) {
        const missing = uncovered(run.building.map, spec.spec, run.building.index);
        this.#events.emit(scope, { type: 'gate.result', gate: 'coverage', name: `milestone ${run.building.index + 1}`, passed: missing.length === 0, exitCode: null, durationMs: 0, detail: excerpt(missing.join('\n'), 2000) });
        if (missing.length > 0) return { failures: [{ name: 'coverage', source: 'sandbox-output', detail: `Every feature of the milestones built so far is walked by a scenario of the screen plan. These are not:\n${missing.map((line) => `- ${line}`).join('\n')}` }], unverified: [], waitingOn: null };
      }
    }

    // The owner's switch for browser-backed checks is the visual eval: with it off, nothing here starts a browser.
    const browser = this.#evals.usesBrowser(project.id);
    let served = false;
    const notWalked: string[] = [];
    if (browser) {
      try {
        const smoke = await this.#smoke.run(project, { extraRoutes: plan?.auditRoutes, signal });
        served = smoke.passed;
        this.#events.emit(scope, { type: 'gate.result', gate: 'smoke', name: smoke.routes.join(' '), passed: smoke.passed, exitCode: null, durationMs: smoke.durationMs, detail: excerpt(smoke.detail, 2000) });
        if (!smoke.passed) return { failures: [{ name: 'smoke', source: 'browser-page', detail: smoke.detail }], unverified: [], waitingOn: null };
        // It runs. Does it work? The plan's scenarios are walked as people who sign up, and the build is held to them.
        // A task that is not a build owes no plan, and changes a product that may have one: what worked before
        // it has to work after it, so a plan that is there and holds is walked for it too. (The first proposal
        // implemented on a real project was a module of twenty lines, checked for everything but this.)
        const planned = !this.#scenarios ? null : run.spec?.works ? await this.#readSpec(project, run.spec) : run.spec === null && variantOf(project.template) !== null ? await this.#readSpec(project, { works: true, draft: true }) : null;
        if (planned?.ok && planned.spec.scenarios.length > 0 && this.#scenarios) {
          try {
            const walked = await this.#scenarios.run(project, planned.spec, { signal, look: !!run.building });
            this.#events.emit(scope, { type: 'gate.result', gate: 'scenarios', name: planned.spec.scenarios.map((scenario) => scenario.id).join(' '), passed: walked.passed, exitCode: null, durationMs: walked.durationMs, detail: walked.passed ? walked.detail : excerpt(renderScenarioFeedback(walked), 3000) });
            if (!walked.passed) return { failures: [{ name: 'scenarios', source: 'browser-page', detail: renderScenarioFeedback(walked) }], unverified: [], waitingOn: null };
            // It works. The screens its people stood on, signed in, are the ones the audit never opens: measured here.
            if (run.building && walked.looks && walked.looks.length > 0) {
              const found = await this.#walkedScreens(project, task, run.building, walked.looks);
              if (found) return { failures: [found], unverified: [], waitingOn: null };
            }
          } catch (err) {
            if (signal.aborted) throw err;
            // The backend or the browser not answering is the studio's problem. It is said, and the work is not vouched for.
            this.#log.warn({ taskId: task.id, err: errorMessage(err) }, 'the scenarios could not be walked');
            this.#events.emit(scope, { type: 'notice', level: 'warn', message: `The scenarios were not walked: ${errorMessage(err)}` });
            notWalked.push(`scenarios: not walked (${errorMessage(err)}), so that the product works is not vouched for`);
          }
        }
        // The bare core-flow walk opens the product signed out: where people sign in, the scenarios above are that walk.
        if (!(planned?.ok && planned.spec.entry !== null)) record.flow = await this.#walkApp(project, task, signal);
        // A draft is held to nothing past this point, and is still looked at once: measured at the size it
        // is first met at, with no reviewer, for the owner to see. A look that cannot be had is said and no more.
        // (A milestone's screens were measured where its people stood, signed in: the door too. One more look at
        // the door as a visitor would say less, and say it as if it were the product's first screen.)
        if (task.track === 'fast' && !run.building) {
          try {
            record.audit = (await this.#evals.measureDraft(project, task.id, { signal })) ?? record.audit;
          } catch (err) {
            if (signal.aborted) throw err;
            this.#events.emit(scope, { type: 'notice', level: 'info', message: `The draft was not measured: ${errorMessage(err)}` });
          }
        }
      } catch (err) {
        if (signal.aborted) throw err;
        // The browser not starting is the studio's problem, not a defect in the work: say so and carry on.
        this.#log.warn({ taskId: task.id, err: errorMessage(err) }, 'smoke gate could not run');
        this.#events.emit(scope, { type: 'notice', level: 'warn', message: `Smoke test skipped: ${errorMessage(err)}` });
      }
    }

    // In a product, what is taken from another repository runs as a draft (`Studio.kirbyMaterialize`), so it is
    // not held to the visual audit: held to it on the full track, a twenty-line module spent three rounds
    // redrawing the first screen of a product that had been built as a draft and had never cleared that bar.
    // In the studio's own repository it runs on the full track, where there is no visual audit to be held to.
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
      unverified: [...notWalked, ...outcomes.filter((o) => o.unverified).map((o) => `${o.eval.name}: the design review did not run (${o.audit?.vision.reason ?? 'no reason recorded'}), so the design is not vouched for`)],
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
   * it is shown to the owner beside the pages and sent back to nobody. The engine was given the same
   * measurement to draw with; a drawing is the owner's to judge, and a rework turn is the most expensive
   * thing a design task can do.
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
    // A design is of a product that works: its plan says who uses it, how they get in, what they do and what is kept.
    const spec: ScreenSpecRead = (await this.#readSpec(project, { works: variantOf(project.template) !== null })) ?? { ok: false, problems: [`${SCREEN_SPEC_FILE} is missing or empty.`] };
    await this.#writeScreenDoc(project, spec);
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
      if (drawn.flowProblems.length > 0) failures.push({ name: 'mockup-flow', source: 'browser-page', detail });
    }
    if (drawn.audit) {
      const outcome = visualOutcome(drawn.audit, this.#config.audit.threshold);
      if (outcome.unverified) unverified.push(`the mock-ups: the design review did not run (${drawn.audit.vision.reason ?? 'no reason recorded'}), so they are measured and not judged`);
      else if (!outcome.passed) failures.push({ name: 'mockup-audit', source: 'browser-page', detail: outcome.detail });
    }
    return { failures, unverified, waitingOn: null, advisory: true, drawn };
  }

  async #readDirections(project: Project): Promise<DirectionsRead> {
    const res = await this.#sandboxes.exec(project, `[ -f ${DIRECTIONS_FILE} ] && head -c 65536 ${DIRECTIONS_FILE}`, { timeoutSec: 20, maxOutputBytes: 80_000 });
    return res.exitCode !== 0 || res.stdout.trim() === '' ? { ok: false, problems: [`${DIRECTIONS_FILE} is missing or empty.`] } : readDirections(res.stdout);
  }

  /**
   * Draws a new design's directions side by side: one conversation per row of the directions table, each
   * given that row and the scene they all share and nothing of the others' pages, while the lead engine
   * writes the deep dive.
   *
   * One engine used to write page a, then b, then c in the conversation that had written the documents. That
   * took the three in a row (seventeen minutes of a real forty-minute task before the owner saw anything),
   * and what made them different was a sentence asking that they be. Here the difference is in what each
   * engine is handed, and is checked before anyone draws.
   *
   * A table that does not hold after being sent back is not a reason to fail a design: the lead then draws
   * every direction itself, in turn. A direction whose engine fails is said; the others stand.
   */
  async #drawDirections(
    project: Project,
    task: Task,
    p: { send: (content: string) => Promise<EngineResult>; sendTo: (session: EngineSession, content: string) => Promise<EngineResult>; openLane: (lane: DirectionId) => Promise<EngineSession>; lanes: Map<DirectionId, EngineSession>; checkCancel: () => void },
  ): Promise<EngineResult> {
    const scope = { projectId: project.id, taskId: task.id };
    const started = Date.now();
    // The pages are drawn against the screen spec as well as the table, so both are looked at before anyone
    // draws. The spec is still owed at verification, where a spec that never comes to hold fails the task.
    const specProblems = async (): Promise<string[]> => {
      const spec = await this.#readSpec(project);
      return spec === null ? [`${SCREEN_SPEC_FILE} is missing or empty.`] : spec.ok ? [] : spec.problems;
    };
    let read = await this.#readDirections(project);
    let spec = await specProblems();
    for (let asked = 0; (!read.ok || spec.length > 0) && asked < DIRECTION_CORRECTIONS; asked++) {
      if (!read.ok) this.#events.emit(scope, { type: 'gate.result', gate: 'directions', name: DIRECTIONS_FILE, passed: false, exitCode: null, durationMs: Date.now() - started, detail: read.problems.join('\n') });
      const owed = [
        read.ok ? null : `${DIRECTIONS_FILE} does not hold as the directions table yet:\n${untrusted('sandbox-output', read.problems.map((line) => `- ${line}`).join('\n'), { check: 'directions' })}`,
        spec.length === 0 ? null : `${SCREEN_SPEC_FILE} does not hold as the screen spec yet:\n${untrusted('sandbox-output', spec.map((line) => `- ${line}`).join('\n'), { check: 'screen-spec' })}`,
      ].filter((block) => block !== null);
      await p.send(`Before the directions are drawn, correct exactly these, keeping each file's shape, and change nothing else. Do not start the fifth pass yet.\n\n${owed.join('\n\n')}`);
      p.checkCancel();
      read = await this.#readDirections(project);
      spec = await specProblems();
    }
    this.#events.emit(scope, { type: 'gate.result', gate: 'directions', name: DIRECTIONS_FILE, passed: read.ok, exitCode: null, durationMs: Date.now() - started, detail: read.ok ? '' : read.problems.join('\n') });
    if (!read.ok) {
      this.#events.emit(scope, { type: 'notice', level: 'warn', message: `${DIRECTIONS_FILE} does not hold, so the directions are not drawn side by side: one engine draws them in turn.` });
      return p.send(DRAW_ALL_BRIEF);
    }

    const { scene, directions } = read.table;
    // Each direction's theme is generated here, from its row, and left in a file only that direction reads. It
    // is the tokens alone: a mock-up carries its face inside itself, so there is no font file for it to point at.
    for (const row of directions) await this.#sandboxes.writeFile(project, directionThemeFile(row.id), chosenTheme(row.theme).tokensCss);
    // The project's own theme is the recommended direction's, as it was when one engine drew them all. It is
    // set before anyone draws: an engine that finds a placeholder there is told to choose a theme itself.
    await writeProjectTheme(this.#sandboxes, project, chosenTheme(directions[0]!.theme));
    const draw = async (row: Direction): Promise<void> => {
      const session = await p.openLane(row.id);
      const others = directions.filter((other) => other.id !== row.id).map((other) => `${other.id}: ${other.concept.trim()}`).join('\n');
      await p.sendTo(
        session,
        directionBrief({
          file: `${MOCKUP_DIR}/${row.id}.html`,
          themeFile: directionThemeFile(row.id),
          seed: untrusted('sandbox-output', JSON.stringify(row.theme), { file: DIRECTIONS_FILE, field: 'theme' }),
          scene: untrusted('sandbox-output', scene.trim(), { file: DIRECTIONS_FILE, field: 'scene' }),
          row: untrusted('sandbox-output', renderDirection(row), { file: DIRECTIONS_FILE, direction: row.id }),
          others: untrusted('sandbox-output', others, { file: DIRECTIONS_FILE, field: 'others' }),
          template: project.template,
        }),
      );
    };
    this.#events.emit(scope, { type: 'notice', level: 'info', message: `${directions.length} directions are being drawn side by side (${directions.map((row) => row.id).join(', ')}), each by its own engine, while the deep dive is written.` });
    const [lead, ...drawn] = await Promise.allSettled([p.send(DEEP_DIVE_BRIEF), ...directions.map(draw)]);
    p.checkCancel();
    // Each has drawn its page, or failed to: there is nothing more to ask of them.
    await Promise.all([...p.lanes.values()].map((session) => session.close().catch(() => undefined)));
    p.lanes.clear();
    for (const [i, outcome] of drawn.entries()) {
      // Whether the page is there all the same is found out by the checks.
      if (outcome.status === 'rejected') this.#events.emit(scope, { type: 'notice', level: 'warn', message: `Direction ${directions[i]!.id} was not finished by its engine (${excerpt(errorMessage(outcome.reason), 300)}). The other directions stand.` });
    }
    if (lead!.status === 'rejected') throw lead.reason;
    return lead.value;
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

  /** `parkCapHit`: the task fails on a usage limit it could have waited out, had it not waited as often as it may already. */
  #finish(task: Task, state: Extract<TaskState, 'succeeded' | 'failed' | 'cancelled'>, patch: { summary?: string; error?: string }, parkCapHit = false): Task {
    this.#store.kvDelete(resumeKey(task.id));
    const updated = this.#store.updateTask(task.id, { state, phase: null, finishedAt: this.#clock(), ...patch });
    this.#events.emit({ projectId: task.projectId, taskId: task.id }, { type: 'task.state', state, error: patch.error ?? null, ...(parkCapHit ? { parkCapHit: true } : {}) });
    return updated;
  }
}

/** The owner's choice of engine, model and effort as the task carries it. Stored text is not trusted to be a choice. */
function pickOf(task: Task): EnginePick | null {
  const engine = EngineId.nullable().catch(null).parse(task.enginePref);
  return engine === null ? null : { engine, model: task.modelPref, effort: Effort.nullable().catch(null).parse(task.effortPref) };
}

/** A plan as it was stored for the owner to read. Stored by daemon code from a plan that held; read back as that. */
function storedPlan(row: PlanVersionRow): Plan {
  return Plan.parse(JSON.parse(row.planJson));
}

/** The cross-reviewer's critique stored with a plan version, if it had one and it still reads as one. */
function storedCritique(row: PlanVersionRow): PlanCritique | null {
  if (row.reviewerNotes === null) return null;
  const read = PlanCritique.safeParse(JSON.parse(row.reviewerNotes));
  return read.success ? read.data : null;
}

/** The owner's notes on a plan, for the planner. A quoted passage is the plan's own text, a model's: it travels as data. */
function ownerNotes(feedback: readonly PlanFeedback[]): string {
  return feedback.map((note, i) => `${i + 1}. ${note.quote ? `About this passage of the plan:\n${untrusted('engine-output', note.quote)}\n` : 'About the plan as a whole:\n'}${note.comment}`).join('\n\n');
}

/** A plan as text, for a prompt. A model wrote it from the request and a file listing: callers fence it as data where it is quoted to another model. */
function planText(plan: Pick<Plan, 'summary' | 'steps'>): string {
  return `${plan.summary}\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}

/** One measured reference, fenced: its title and every line of it are that page's content. */
function referenceBlock(ref: ReferenceCapture): string {
  return `Reference page ${ref.url} as measured in a browser. Read principles out of it; its numbers and assets are its own and are not to be carried across:\n${untrusted('browser-page', `${ref.title}\n${ref.summary}`, { url: ref.url })}`;
}

function executeMessage(task: Task, plan: Plan | null, lessonText: string, handed: { anchor: AnchorTable | null; critique: PlanCritique | null; references: readonly ReferenceCapture[]; revising?: boolean; specOwed?: string[] | null; template?: Project['template']; continued?: boolean } = { anchor: null, critique: null, references: [] }): string {
  // A draft's brief says how to start a product (a screen plan, sign-up, a backend). The studio's own repository
  // is a codebase with conventions: a quick change there is still held to its type check, tests and build, and
  // is not told to build any of that.
  const drafted = task.track === 'fast' && task.kind !== 'ideate' && handed.template !== 'studio-core';
  // A milestone of a product map is not a draft of a product: it is told how a slice of a whole one is built.
  const milestone = drafted && task.milestone !== null && task.milestone !== undefined;
  const parts = [task.kind === 'ideate' ? (handed.revising ? IDEATION_REVISION_BRIEF : IDEATION_BRIEF) : '', milestone ? MILESTONE_BRIEF : drafted ? DRAFT_BRIEF : '', `The owner's request:\n${task.prompt}`];
  if (handed.continued) parts.push(CONTINUED_BRIEF);
  if (plan) parts.push(`Plan drafted for this request (follow it unless the code shows it is wrong; say so if you deviate):\n${planText(plan)}`);
  // The table's cells were written by a model that had read reference pages, so they travel as data; the instruction to build to it is the harness's.
  if (handed.anchor) parts.push(`The anchor table for this work is committed at ${ANCHOR_FILE}. Build to it: the idea, the first screen as it describes it, and our own values, not the references'.\n${untrusted('engine-output', renderAnchorTable(handed.anchor))}`);
  // No screen spec holds for this project yet: the engine writes it first. What was wrong is tool output, so it travels as data.
  if (handed.specOwed && task.track === 'fast') {
    // A draft's brief has already said to write the short plan and given its shape. What is added here is what
    // is wrong with one that is already in the workspace.
    const found = handed.specOwed.filter((line) => line !== `${SCREEN_SPEC_FILE} is missing.`);
    if (found.length > 0) parts.push(`${SCREEN_SPEC_FILE} is in this workspace and does not hold as the screen plan yet. Correct it before any interface code; the work is not accepted without one that holds. What the check found:\n${untrusted('sandbox-output', found.map((line) => `- ${line}`).join('\n'))}`);
  } else if (handed.specOwed) {
    parts.push(`This project has no screen spec that holds yet. Before any interface code, write ${SCREEN_SPEC_FILE}, then build to it; the work is not accepted without one. ${SCREEN_SPEC_RULES}${handed.specOwed.length > 0 ? `\n\nWhat the check found:\n${untrusted('sandbox-output', handed.specOwed.map((line) => `- ${line}`).join('\n'))}` : ''}`);
  }
  for (const ref of handed.references.filter((r) => r.ok)) parts.push(referenceBlock(ref));
  if (handed.critique) {
    parts.push(
      `Before this build, a model from another vendor red-teamed the plan${handed.anchor ? ' and the anchor table' : ''}. It is one reviewer's reading, given once. Where it is right, change course${handed.anchor ? ` (and correct ${ANCHOR_FILE} first, keeping its shape)` : ''}; where it is wrong, carry on and say why in your final message.\n${untrusted('engine-output', renderCritique(handed.critique))}`,
    );
  }
  if (lessonText) parts.push(lessonText);
  // A draft is built from no approved page, so what a screen is made of reaches it here: last, where the design lab found it acted on.
  if (drafted && handed.template && handed.template !== 'studio-core') {
    parts.push(`${milestone ? 'What every screen of this milestone is made of.' : 'One more thing is not left to defaults in a draft: what its first screen is made of.'} This is the handbook's last section, said again here because it is the first thing the owner sees.\n\n${materialFor(handed.template)}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

/** The pre-code round: the engine is asked for the anchor table and nothing else. */
function anchorMessage(task: Task, references: readonly ReferenceCapture[], problems: readonly string[]): string {
  const parts = [ANCHOR_BRIEF, `The owner's request:\n${task.prompt}`, ...references.filter((r) => r.ok).map(referenceBlock)];
  if (problems.length > 0) parts.push(`The table in ${ANCHOR_FILE} was checked and does not hold yet. Correct exactly these:\n${problems.map((p) => `- ${p}`).join('\n')}`);
  return parts.join('\n\n');
}



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
  const prefix = { build: 'feat', refactor: 'refactor', inline_edit: 'fix', ideate: 'docs', kirby_materialize: 'feat' }[task.kind];
  return `${prefix}: ${task.prompt.split('\n')[0]!.replace(/\s+/g, ' ').slice(0, 68)}\n\nStudio Zero task ${task.id}`;
}

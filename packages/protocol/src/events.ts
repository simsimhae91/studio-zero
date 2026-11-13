import { z } from 'zod';
import { ScratchState } from './ax.ts';
import { AdvisorId, ApprovalState, DesignGrade, FlowWalk, LessonState, MockupMeasures, Origin, Phase, PowerMode, ProposalState, ReviewerId, ReviewerPref, SandboxState, TaskKind, TaskState } from './domain.ts';

/** One direction of a design task as the owner sees it: a picture, the page's own name and idea, and what was measured on it. */
const MockupOption = z.object({
  file: z.string(),
  title: z.string(),
  idea: z.string(),
  artifactId: z.string(),
  width: z.number(),
  height: z.number(),
  flow: FlowWalk.nullable().optional(),
  measures: MockupMeasures.nullable().optional(),
});

/**
 * Every state change in the daemon is an append-only event with a monotonically increasing `seq`.
 * Clients render from the stream and resume with `sinceSeq` after a reconnect, so a flaky tunnel never loses state.
 */
export const EventBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('task.state'), state: TaskState, error: z.string().nullable() }),
  z.object({ type: z.literal('task.phase'), phase: Phase, round: z.number().int() }),
  z.object({
    type: z.literal('route.decided'),
    taskKind: TaskKind,
    engine: z.string(),
    model: z.string(),
    effort: z.string(),
    considered: z.array(z.object({ engine: z.string(), available: z.boolean(), reason: z.string() })),
  }),
  z.object({
    type: z.literal('plan.created'),
    summary: z.string(),
    steps: z.array(z.string()),
    auditRoutes: z.array(z.string()),
    appliedLessonIds: z.array(z.string()),
  }),
  z.object({ type: z.literal('agent.text'), text: z.string() }),
  // `lane` names which of a task's engines made the call, when more than one is working at once (a design
  // task draws its directions side by side: "a", "b", "c"). Absent on the task's one main conversation.
  z.object({ type: z.literal('tool.call'), callId: z.string(), tool: z.string(), input: z.string(), lane: z.string().optional() }),
  z.object({
    type: z.literal('tool.result'),
    callId: z.string(),
    ok: z.boolean(),
    exitCode: z.number().int().nullable(),
    durationMs: z.number().int(),
    /** Head/tail excerpt. This is sandbox output: clients must render it as inert text. */
    preview: z.string(),
  }),
  z.object({
    type: z.literal('policy.decision'),
    actionKind: z.string(),
    actor: z.string(),
    effect: z.enum(['allow', 'deny', 'require_approval']),
    rule: z.string(),
    reason: z.string(),
  }),
  z.object({ type: z.literal('approval.requested'), approvalId: z.string(), actionKind: z.string(), summary: z.string(), expiresAt: z.number().int() }),
  z.object({ type: z.literal('approval.resolved'), approvalId: z.string(), state: ApprovalState, via: Origin.nullable() }),
  z.object({ type: z.literal('checkpoint.created'), checkpointId: z.string(), label: z.string() }),
  z.object({ type: z.literal('checkpoint.restored'), checkpointId: z.string() }),
  z.object({
    type: z.literal('eval.result'),
    evalId: z.string(),
    name: z.string(),
    passed: z.boolean(),
    /** Set when the check could not reach a verdict (the design review did not run): not a pass, and nothing the engine can fix. */
    unverified: z.boolean().optional(),
    durationMs: z.number().int(),
    detail: z.string(),
  }),
  /**
   * A built-in execution gate ran: the compiler (type check or tests) or the headless smoke load. Unlike an
   * eval these are not rows the owner manages; `detail` is raw tool or browser output and is rendered as text.
   */
  z.object({
    type: z.literal('gate.result'),
    /**
     * `anchor`: the anchor table a design task owes before code. `build`: the production build, measured for the ledger.
     * `screens`: the screen spec a design task owes. `flow`: the core flow of that spec, walked on the mock-ups.
     */
    gate: z.enum(['compiler', 'smoke', 'anchor', 'build', 'screens', 'flow']),
    /** What ran: the command line for the compiler gate, the routes for the smoke gate. */
    name: z.string(),
    passed: z.boolean(),
    exitCode: z.number().int().nullable(),
    durationMs: z.number().int(),
    detail: z.string(),
  }),
  z.object({
    type: z.literal('audit.completed'),
    auditId: z.string(),
    score: z.number(),
    passed: z.boolean(),
    blockers: z.number().int(),
    majors: z.number().int(),
    minors: z.number().int(),
    /** Absent on events recorded before design-review coverage was tracked. False: nobody judged the design. */
    visionReviewed: z.boolean().optional(),
    grade: DesignGrade.nullable().optional(),
  }),
  z.object({
    type: z.literal('usage'),
    source: z.enum(['native', 'gateway', 'bridge']),
    model: z.string(),
    inputTokens: z.number().int(),
    /** The part of `inputTokens` re-read from the provider's prompt cache. A budget charges it at a tenth. */
    cachedTokens: z.number().int().optional(),
    outputTokens: z.number().int(),
    usdMicros: z.number().int(),
  }),
  z.object({
    type: z.literal('reflection.completed'),
    outcome: z.enum(['clean', 'recovered', 'failed']),
    lessonsAccepted: z.number().int(),
    lessonsRejected: z.number().int(),
    evalsAdded: z.number().int(),
  }),
  z.object({ type: z.literal('lesson.changed'), lessonId: z.string(), state: LessonState, title: z.string() }),
  z.object({ type: z.literal('kirby.ingested'), ingestId: z.string(), repoUrl: z.string(), files: z.number().int(), gaps: z.number().int() }),
  z.object({ type: z.literal('kirby.proposal'), proposalId: z.string(), title: z.string(), state: ProposalState }),
  z.object({ type: z.literal('sandbox.state'), state: SandboxState }),
  z.object({ type: z.literal('git.merged'), branch: z.string(), into: z.string(), commit: z.string() }),
  /** The owner sent a message to a running task. It is delivered at the engine's next turn, without stopping it. */
  z.object({ type: z.literal('steer.queued'), text: z.string() }),
  z.object({ type: z.literal('steer.delivered'), count: z.number().int() }),
  z.object({ type: z.literal('checkpoint.forked'), checkpointId: z.string(), branch: z.string() }),
  z.object({ type: z.literal('scratch.entry'), scratchId: z.string(), seq: z.number().int() }),
  z.object({ type: z.literal('scratch.state'), scratchId: z.string(), state: ScratchState }),
  /** The agent is working on a scratchpad turn (true) or has finished it (false). */
  z.object({ type: z.literal('scratch.thinking'), scratchId: z.string(), active: z.boolean(), error: z.string().nullable() }),
  z.object({ type: z.literal('knowledge.state'), jobId: z.string(), state: z.enum(['running', 'succeeded', 'failed']), step: z.string().nullable() }),
  z.object({ type: z.literal('project.changed'), name: z.string() }),
  /** An owner asked another vendor's model one question. `answer` is that model's raw reply: rendered as text, never interpreted. */
  z.object({ type: z.literal('advisor.answered'), advisor: AdvisorId, question: z.string(), ok: z.boolean(), answer: z.string(), durationMs: z.number().int() }),
  /** A reference page the owner pointed at was opened in the QA browser container and measured. `detail` is page content or an error: inert text. */
  z.object({ type: z.literal('reference.captured'), url: z.string(), ok: z.boolean(), artifactId: z.string().nullable(), detail: z.string() }),
  /**
   * The anchor table a design task is built to was written and committed, before any code. `author` says who
   * filled it in: the planner, the engine in a round of its own, or an earlier task (`workspace`).
   */
  z.object({ type: z.literal('anchor.committed'), author: z.enum(['planner', 'engine', 'workspace']), idea: z.string(), directions: z.array(z.string()), livingVisual: z.string() }),
  /**
   * One of a task's two cross-checks by another vendor's model: `plan` before the build, `acceptance` after it.
   * `reviewer` is null and `reason` set when it could not be had; a task is never failed for that.
   * `points` are that model's words: rendered as text, never interpreted.
   */
  z.object({
    type: z.literal('review.completed'),
    stage: z.enum(['plan', 'acceptance']),
    reviewer: ReviewerId.nullable(),
    verdict: z.enum(['noted', 'pass', 'patch']).nullable(),
    points: z.array(z.string()),
    reason: z.string().nullable(),
    durationMs: z.number().int(),
  }),
  /**
   * A design task's directions, drawn: one picture per mock-up page it wrote. `title` and `idea` come from the
   * page's own head and are a model's words. The owner picks one of these to build.
   *
   * `flow` is the core flow as a browser carried it out on that page, and `measures` what the page's audit came
   * to. Both are the daemon's own counts; they are absent on events from before mock-ups were measured, and
   * null when that measurement could not be had.
   */
  z.object({ type: z.literal('mockups.rendered'), options: z.array(MockupOption) }),
  /**
   * One direction as it stands while the task is still drawing: the engine asked the studio to measure the page,
   * and what the studio drew to do that is shown to the owner at once. Not a verdict and not the set to choose
   * from: `measures` has no reviewer's score, and the page may be changed again. `mockups.rendered` replaces these.
   */
  z.object({ type: z.literal('mockups.drafted'), option: MockupOption }),
  /** A picture made for the product by a subscription's image tool and written into the workspace. `purpose` is the engine's own sentence. */
  z.object({ type: z.literal('image.generated'), path: z.string(), purpose: z.string(), width: z.number().int(), height: z.number().int(), bytes: z.number().int(), durationMs: z.number() }),
  z.object({ type: z.literal('ledger.recorded'), entryId: z.string(), proof: z.string() }),
  z.object({ type: z.literal('power.changed'), mode: PowerMode }),
  z.object({ type: z.literal('quota.changed'), subscription: ReviewerPref, state: z.enum(['ok', 'limited']), resetsAt: z.number().int().nullable() }),
  /** A finished task on the studio's own repository was copied out to this Mac's checkout as a feature branch. Nothing is merged by this. */
  z.object({ type: z.literal('selfhost.exported'), branch: z.string(), base: z.string(), files: z.number().int(), insertions: z.number().int(), deletions: z.number().int() }),
  z.object({ type: z.literal('selfhost.merged'), branch: z.string(), into: z.string(), commit: z.string() }),
  z.object({ type: z.literal('notice'), level: z.enum(['info', 'warn', 'error']), message: z.string() }),
]);
export type EventBody = z.infer<typeof EventBody>;
export type EventType = EventBody['type'];

export const EventEnvelope = z.object({
  seq: z.number().int(),
  at: z.number().int(),
  projectId: z.string().nullable(),
  taskId: z.string().nullable(),
  body: EventBody,
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

export const EventFilter = z.object({
  projectId: z.string().optional(),
  taskId: z.string().optional(),
});
export type EventFilter = z.infer<typeof EventFilter>;

export function matchesFilter(e: Pick<EventEnvelope, 'projectId' | 'taskId'>, f: EventFilter): boolean {
  if (f.taskId !== undefined && e.taskId !== f.taskId) return false;
  if (f.projectId !== undefined && e.projectId !== f.projectId) return false;
  return true;
}

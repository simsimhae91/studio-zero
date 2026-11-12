import { z } from 'zod';
import { ScratchState } from './ax.ts';
import { ApprovalState, LessonState, Origin, Phase, ProposalState, SandboxState, TaskKind, TaskState } from './domain.ts';

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
  z.object({ type: z.literal('tool.call'), callId: z.string(), tool: z.string(), input: z.string() }),
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
  }),
  z.object({
    type: z.literal('usage'),
    source: z.enum(['native', 'gateway', 'bridge']),
    model: z.string(),
    inputTokens: z.number().int(),
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

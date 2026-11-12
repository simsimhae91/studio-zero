import { z } from 'zod';
import {
  Approval,
  ApprovalState,
  AuditReport,
  Checkpoint,
  CredentialMeta,
  Eval,
  Lesson,
  LessonState,
  McpServerInfo,
  Project,
  ProposalCard,
  SandboxInfo,
  Slug,
  Task,
  TaskKind,
  Template,
} from './domain.ts';
import { AxResponse, Calibration, DocumentKind, KnowledgeJob, PromotionResult, Readiness, ResearchReport, ScratchEntry, ScratchMode, ScratchMove, Scratchpad, TextFinding } from './ax.ts';
import { EventEnvelope, EventFilter } from './events.ts';

const empty = z.object({});

/**
 * The RPC contract. One table drives the server's validation, the client's types and the docs.
 * Every method is validated on the way in AND on the way out, so a handler bug cannot leak a malformed payload.
 */
export const methods = {
  'system.status': {
    params: empty,
    result: z.object({
      version: z.string(),
      protocol: z.number().int(),
      uptimeSec: z.number().int(),
      runtime: z.object({ context: z.string(), reachable: z.boolean(), detail: z.string() }),
      relays: z.array(z.object({ id: z.enum(['telegram', 'slack', 'ntfy']), state: z.enum(['disabled', 'connected', 'degraded']) })),
      queue: z.object({ queued: z.number().int(), running: z.number().int() }),
      engines: z.array(z.object({ id: z.string(), available: z.boolean(), reason: z.string() })),
    }),
  },

  'projects.create': { params: z.object({ name: z.string().min(1).max(80), slug: Slug, template: Template }), result: Project },
  'projects.list': { params: empty, result: z.object({ projects: z.array(Project) }) },
  /** Removes the sandbox and the project's records. The workspace volume is kept unless `deleteWorkspace` is set. */
  'projects.delete': { params: z.object({ projectId: z.string(), deleteWorkspace: z.boolean() }), result: z.object({ deleted: z.literal(true) }) },

  'sandbox.info': { params: z.object({ projectId: z.string() }), result: SandboxInfo },
  'sandbox.start': { params: z.object({ projectId: z.string() }), result: SandboxInfo },
  'sandbox.stop': { params: z.object({ projectId: z.string() }), result: SandboxInfo },
  /** Throws away the container filesystem (installed packages, caches) and recreates it from the image. The workspace volume is kept. */
  'sandbox.recreate': { params: z.object({ projectId: z.string() }), result: SandboxInfo },

  /** Starts the project's dev server in its sandbox (as described in `.studio-zero/project.json`) and waits until it answers. */
  'preview.start': { params: z.object({ projectId: z.string() }), result: z.object({ containerPort: z.number().int(), localhost: z.string(), orbLocal: z.string() }) },
  'preview.stop': { params: z.object({ projectId: z.string() }), result: z.object({ stopped: z.literal(true) }) },

  'tasks.submit': {
    params: z.object({
      projectId: z.string(),
      kind: TaskKind.exclude(['kirby_materialize']),
      prompt: z.string().min(1).max(20_000),
      budgetTokens: z.number().int().min(10_000).max(50_000_000).optional(),
      /** Start from this branch instead of the integration branch (to continue a fork). */
      baseBranch: z.string().min(1).max(120).optional(),
    }),
    result: Task,
  },
  /** Sends a message to a running task without stopping it. The engine reads it at its next turn. */
  'tasks.steer': { params: z.object({ taskId: z.string(), message: z.string().min(1).max(4000) }), result: z.object({ queued: z.literal(true) }) },
  'tasks.get': { params: z.object({ taskId: z.string() }), result: Task },
  'tasks.list': { params: z.object({ projectId: z.string().optional(), limit: z.number().int().min(1).max(200).optional() }), result: z.object({ tasks: z.array(Task) }) },
  'tasks.cancel': { params: z.object({ taskId: z.string() }), result: Task },

  'approvals.list': { params: z.object({ state: ApprovalState.optional() }), result: z.object({ approvals: z.array(Approval) }) },
  'approvals.resolve': { params: z.object({ approvalId: z.string(), decision: z.enum(['approve', 'deny']) }), result: Approval },

  'checkpoints.list': { params: z.object({ projectId: z.string() }), result: z.object({ checkpoints: z.array(Checkpoint) }) },
  /** Restores the workspace to a checkpoint. A safety checkpoint of the current state is taken first, so a rollback is itself undoable. */
  'checkpoints.rollback': { params: z.object({ projectId: z.string(), checkpointId: z.string() }), result: z.object({ restored: Checkpoint, safety: Checkpoint }) },

  /** Makes a branch that starts at a checkpoint, so a different direction can be tried from that point without losing this one. */
  'checkpoints.fork': { params: z.object({ projectId: z.string(), checkpointId: z.string() }), result: z.object({ branch: z.string() }) },

  'git.merge': { params: z.object({ projectId: z.string(), branch: z.string().min(1).max(120) }), result: z.object({ commit: z.string(), into: z.string() }) },

  'audits.run': { params: z.object({ projectId: z.string(), routes: z.array(z.string()).min(1).max(8).optional() }), result: AuditReport },
  'audits.get': { params: z.object({ auditId: z.string() }), result: AuditReport },
  'audits.list': {
    params: z.object({ projectId: z.string(), limit: z.number().int().min(1).max(100).optional() }),
    result: z.object({ audits: z.array(AuditReport.pick({ id: true, taskId: true, createdAt: true, score: true, passed: true })) }),
  },

  'lessons.list': { params: z.object({ projectId: z.string().optional(), state: LessonState.optional() }), result: z.object({ lessons: z.array(Lesson) }) },
  'lessons.setState': { params: z.object({ lessonId: z.string(), state: z.enum(['active', 'retired', 'quarantined']) }), result: Lesson },

  'evals.list': { params: z.object({ projectId: z.string() }), result: z.object({ evals: z.array(Eval) }) },
  'evals.setEnabled': { params: z.object({ evalId: z.string(), enabled: z.boolean() }), result: Eval },

  /** Clones and analyses a foreign repository in a throwaway container, then emits proposal cards as events. */
  'kirby.ingest': {
    params: z.object({ projectId: z.string(), repoUrl: z.string().max(300), maxProposals: z.number().int().min(1).max(8).optional() }),
    result: z.object({ ingestId: z.string() }),
  },
  'kirby.proposals': { params: z.object({ projectId: z.string() }), result: z.object({ proposals: z.array(ProposalCard) }) },
  /** Implements a proposal on its own branch, runs the regression evals and attaches the real diff and measured deltas. */
  'kirby.materialize': { params: z.object({ proposalId: z.string() }), result: Task },
  'kirby.reject': { params: z.object({ proposalId: z.string() }), result: ProposalCard },

  // Scratchpad: thinking, research and drafting without a sandbox. Promotion turns one into a project or a document.
  'scratch.create': { params: z.object({ opening: z.string().min(1).max(8000), mode: ScratchMode }), result: Scratchpad },
  'scratch.list': { params: empty, result: z.object({ scratchpads: z.array(Scratchpad) }) },
  'scratch.get': {
    params: z.object({ scratchId: z.string() }),
    result: z.object({ scratchpad: Scratchpad, entries: z.array(ScratchEntry), spec: z.string(), decisionLog: z.string(), readiness: Readiness, thinking: z.boolean(), jobs: z.array(KnowledgeJob) }),
  },
  'scratch.say': { params: z.object({ scratchId: z.string(), text: z.string().min(1).max(8000) }), result: z.object({ accepted: z.literal(true) }) },
  'scratch.respond': { params: z.object({ scratchId: z.string(), response: AxResponse }), result: z.object({ accepted: z.literal(true) }) },
  /** Runs one of the named techniques on the scratchpad: eight divergent takes, five simulated users, a red-team review, or convergence into a spec. */
  'scratch.move': { params: z.object({ scratchId: z.string(), move: ScratchMove }), result: z.object({ accepted: z.literal(true) }) },
  'scratch.promote': {
    params: z.object({ scratchId: z.string(), target: z.enum(['build', 'document']), template: Template.optional(), documentKind: DocumentKind.optional() }),
    result: PromotionResult,
  },
  'scratch.archive': { params: z.object({ scratchId: z.string() }), result: Scratchpad },

  'research.start': { params: z.object({ question: z.string().min(4).max(2000), depth: z.enum(['brief', 'deep']), scratchId: z.string().optional() }), result: KnowledgeJob },
  'documents.compile': {
    params: z.object({ title: z.string().min(1).max(200), kind: DocumentKind, brief: z.string().min(1).max(20_000), researchJobId: z.string().optional(), scratchId: z.string().optional() }),
    result: KnowledgeJob,
  },
  'knowledge.list': { params: empty, result: z.object({ jobs: z.array(KnowledgeJob) }) },
  'knowledge.get': { params: z.object({ jobId: z.string() }), result: z.object({ job: KnowledgeJob, markdown: z.string(), report: ResearchReport.nullable(), lint: z.array(TextFinding) }) },
  /** Renders a finished document as a styled PDF and returns the artifact that holds it. */
  'documents.export': { params: z.object({ jobId: z.string() }), result: z.object({ artifactId: z.string() }) },

  'ax.calibration': { params: empty, result: Calibration },

  // External tool servers (MCP). Configured by the owner; used by agents through the daemon, one approved tool at a time.
  'mcp.list': { params: empty, result: z.object({ servers: z.array(McpServerInfo) }) },
  'mcp.add': {
    params: z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/), name: z.string().min(1).max(60), url: z.string().min(8).max(300), auth: z.enum(['bearer', 'none']), about: z.string().max(300) }),
    result: McpServerInfo,
  },
  'mcp.remove': { params: z.object({ serverId: z.string() }), result: z.object({ removed: z.literal(true) }) },
  'mcp.revoke': { params: z.object({ serverId: z.string(), projectId: z.string() }), result: z.object({ revoked: z.number().int() }) },

  'vault.list': { params: empty, result: z.object({ credentials: z.array(CredentialMeta) }) },
  /** Inbound only. There is deliberately no `vault.get`: secrets never travel from the daemon to a client. */
  'vault.set': { params: z.object({ id: CredentialMeta.shape.id, secret: z.string().min(1).max(8192) }), result: CredentialMeta },
  'vault.delete': { params: z.object({ id: CredentialMeta.shape.id }), result: z.object({ deleted: z.boolean() }) },

  'events.history': {
    params: EventFilter.extend({ sinceSeq: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(1000).optional() }),
    result: z.object({ events: z.array(EventEnvelope) }),
  },
} as const;

export type MethodName = keyof typeof methods;
export type ParamsOf<M extends MethodName> = z.input<(typeof methods)[M]['params']>;
export type ResultOf<M extends MethodName> = z.output<(typeof methods)[M]['result']>;

export const methodNames = Object.keys(methods) as MethodName[];
export function isMethodName(name: string): name is MethodName {
  return Object.hasOwn(methods, name);
}

export const RpcErrorCode = z.enum([
  'unauthorized',
  'invalid_params',
  'unknown_method',
  'not_found',
  'conflict',
  /** The deterministic policy engine refused the action. Not retryable without changing the request. */
  'policy_denied',
  /** A human denied the approval or it expired. */
  'approval_denied',
  /** A dependency (container runtime, provider) is not reachable. Retryable. */
  'unavailable',
  'internal',
]);
export type RpcErrorCode = z.infer<typeof RpcErrorCode>;

export const RpcError = z.object({ code: RpcErrorCode, message: z.string() });
export type RpcError = z.infer<typeof RpcError>;

// ------------------------------------------------------------------ frames

/** First frame on every connection. Anything else before it closes the socket with 4401. */
const HelloFrame = z.object({ t: z.literal('hello'), protocol: z.number().int(), token: z.string().min(16).max(256), client: z.string().max(64) });
const ReqFrame = z.object({ t: z.literal('req'), id: z.string().max(64), method: z.string().max(64), params: z.unknown() });
const SubFrame = z.object({ t: z.literal('sub'), id: z.string().max(64), filter: EventFilter, sinceSeq: z.number().int().min(0).optional() });
const UnsubFrame = z.object({ t: z.literal('unsub'), id: z.string().max(64) });

export const ClientFrame = z.discriminatedUnion('t', [HelloFrame, ReqFrame, SubFrame, UnsubFrame]);
export type ClientFrame = z.infer<typeof ClientFrame>;

export const ServerFrame = z.discriminatedUnion('t', [
  z.object({ t: z.literal('ready'), protocol: z.number().int(), version: z.string(), headSeq: z.number().int() }),
  z.object({ t: z.literal('res'), id: z.string(), result: z.unknown() }),
  z.object({ t: z.literal('err'), id: z.string(), error: RpcError }),
  z.object({ t: z.literal('evt'), sub: z.string(), event: EventEnvelope }),
  /** The subscription was dropped (slow consumer). Resubscribe with `sinceSeq` = last seen seq. */
  z.object({ t: z.literal('sub_closed'), sub: z.string(), reason: z.string() }),
]);
export type ServerFrame = z.infer<typeof ServerFrame>;

/** WebSocket close codes used by the daemon. */
export const CloseCode = {
  unauthorized: 4401,
  protocolMismatch: 4406,
  badFrame: 4400,
  helloTimeout: 4408,
} as const;

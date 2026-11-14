import { z } from 'zod';
import {
  AdvisorId,
  Approval,
  ApprovalState,
  AuditReport,
  Checkpoint,
  CredentialMeta,
  Effort,
  EngineModel,
  Eval,
  ExternalApi,
  FileEntry,
  Lesson,
  LedgerEntry,
  LessonState,
  McpServerInfo,
  ModelId,
  PowerMode,
  PowerState,
  Project,
  ProposalCard,
  SandboxInfo,
  SandboxState,
  SelfHostStatus,
  Session,
  Slug,
  SubscriptionQuota,
  ReviewerPref,
  Schedule,
  Task,
  TaskKind,
  TaskTrack,
  Template,
  OwnerSettings,
  PlanFeedback,
  PlanVersion,
} from './domain.ts';
import { AxResponse, Calibration, DocumentKind, KnowledgeJob, PromotionResult, Readiness, ResearchReport, ScratchEntry, ScratchMode, ScratchMove, Scratchpad, TextFinding } from './ax.ts';
import { EventEnvelope, EventFilter } from './events.ts';
import { ReviewDiff, ReviewOutcome, ReviewResult } from './review.ts';

const empty = z.object({});

/**
 * The RPC contract. One table drives the server's validation, the client's types and the docs.
 * Every method is validated on the way in AND on the way out, so a handler bug cannot leak a malformed payload.
 */
const McpServerId = z.string().regex(/^[a-z][a-z0-9-]{1,30}$/);
/** Which engine runs a task, when the owner chooses instead of the routing table. */
export const EnginePref = z.enum(['native-claude', 'claude-code', 'codex', 'cursor', 'antigravity']);
export type EnginePref = z.infer<typeof EnginePref>;
/** A path inside the project's workspace, relative to /workspace. The daemon confines it again. */
const WorkspacePath = z.string().min(1).max(1024);
/** A page to take design principles from. Checked again by the daemon before anything opens it. */
const ReferenceUrl = z.string().min(12).max(300);
const TerminalId = z.string().min(1).max(64);
const TerminalSize = { cols: z.number().int().min(2).max(500), rows: z.number().int().min(1).max(300) };

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
      /** How the daemon's own model calls (planning, judging, scratchpad, writing) travel: an API key, the owner's Claude subscription, or not at all. */
      brain: z.enum(['api', 'session', 'none']),
    }),
  },

  /**
   * The owner's settings as the configuration file has them, and what stands between a change and its effect.
   * `writable` is false on a connection that was not opened on the daemon's own Mac: such a client reads and
   * cannot change. `restartRequired` is true while the file differs from what the daemon started with.
   * `supervised` says whether something will start the daemon again if it stops itself.
   */
  'config.get': { params: empty, result: z.object({ settings: OwnerSettings, writable: z.boolean(), restartRequired: z.boolean(), supervised: z.boolean(), file: z.string(), logFile: z.string().nullable() }) },
  /** Writes the settings to the file. Refused (`policy_denied`) on a connection that is not local. Takes effect at the next start. */
  'config.set': { params: z.object({ settings: OwnerSettings }), result: z.object({ settings: OwnerSettings, restartRequired: z.boolean() }) },
  /** Stops the daemon so that its supervisor starts it again. Local connections only; refused while anything is in flight. */
  'system.restart': { params: empty, result: z.object({ accepted: z.literal(true) }) },

  /**
   * What can be chosen on an engine. `models` is what the vendor's own tooling lists for this login: empty when the
   * list could not be read, and the task can still be left to the usual model. `efforts` is the levels the engine
   * takes as a setting of their own: empty where the vendor folds the level into the model's name. Both are empty
   * for an engine that is not available.
   */
  'engines.models': { params: z.object({ engine: EnginePref }), result: z.object({ models: z.array(EngineModel), efforts: z.array(Effort) }) },

  'projects.create': { params: z.object({ name: z.string().min(1).max(80), slug: Slug, template: Template }), result: Project },
  /**
   * `live` says, per project, whether its sandbox is running and whether a task is using it right now. It is
   * read from the container engine in one call; when the engine cannot be reached every sandbox reads `absent`.
   */
  'projects.list': { params: empty, result: z.object({ projects: z.array(Project), live: z.array(z.object({ projectId: z.string(), sandbox: SandboxState, busy: z.boolean(), /** A task of this project waits for the owner's word on its plan. */ planWaiting: z.boolean().optional() })) }) },
  /** Changes the display name. The slug (and with it the container and volume names) stays as it was. */
  'projects.rename': { params: z.object({ projectId: z.string(), name: Project.shape.name }), result: Project },
  /**
   * From an idea to a running task in one call, without questions. The daemon names the project (a short title
   * and slug distilled from the idea), picks a template unless one is given, creates it and starts the first task:
   * `fast` builds a working draft straight away; `deep` writes the PRD, data model and API specification first.
   */
  'projects.ignite': {
    params: z.object({ idea: z.string().min(1).max(20_000), track: z.enum(['fast', 'deep']), template: Template.optional(), engine: EnginePref.optional(), model: ModelId.optional(), effort: Effort.optional() }),
    result: z.object({ project: Project, task: Task }),
  },
  /** Removes the sandbox and the project's records. The workspace volume is kept unless `deleteWorkspace` is set. */
  'projects.delete': { params: z.object({ projectId: z.string(), deleteWorkspace: z.boolean() }), result: z.object({ deleted: z.literal(true) }) },

  'sessions.list': { params: z.object({ projectId: z.string() }), result: z.object({ sessions: z.array(Session) }) },
  'sessions.create': { params: z.object({ projectId: z.string(), name: Session.shape.name }), result: Session },
  'sessions.rename': { params: z.object({ sessionId: z.string(), name: Session.shape.name }), result: Session },
  /** Removes the session. Its tasks are kept and move to the project's default stream. */
  'sessions.delete': { params: z.object({ sessionId: z.string() }), result: z.object({ deleted: z.literal(true) }) },

  'sandbox.info': { params: z.object({ projectId: z.string() }), result: SandboxInfo },
  'sandbox.start': { params: z.object({ projectId: z.string() }), result: SandboxInfo },
  'sandbox.stop': { params: z.object({ projectId: z.string() }), result: SandboxInfo },
  /** Throws away the container filesystem (installed packages, caches) and recreates it from the image. The workspace volume is kept. */
  'sandbox.recreate': { params: z.object({ projectId: z.string() }), result: SandboxInfo },

  // The workspace as files. Listings follow .gitignore and always leave out .git, node_modules and build output.
  'files.list': {
    params: z.object({ projectId: z.string(), path: WorkspacePath.optional(), depth: z.number().int().min(1).max(6).optional() }),
    result: z.object({ entries: z.array(FileEntry), truncated: z.boolean() }),
  },
  /** Text files only. `binary` is set (and `content` empty) for anything else; `truncated` when the file is larger than the read limit. */
  'files.read': {
    params: z.object({ projectId: z.string(), path: WorkspacePath }),
    result: z.object({ content: z.string(), encoding: z.literal('utf-8'), size: z.number().int(), truncated: z.boolean(), binary: z.boolean() }),
  },
  'files.write': { params: z.object({ projectId: z.string(), path: WorkspacePath, content: z.string().max(400_000) }), result: z.object({ written: z.boolean() }) },

  /**
   * One of a design task's mock-up pages as the studio shows and measures it: the page with the pictures it
   * points at and the theme's faces carried inside it, so it needs nothing from outside. `html` is null when
   * the page is not there. An agent wrote it: a client seals it before showing it.
   */
  'mockups.page': { params: z.object({ projectId: z.string(), file: z.enum(['docs/mockups/a.html', 'docs/mockups/b.html', 'docs/mockups/c.html']) }), result: z.object({ html: z.string().nullable() }) },

  /**
   * An interactive shell in the project's sandbox, on a real pseudo-terminal. The terminal belongs to the
   * connection that opened it: its output arrives as `terminal.output` frames on that socket, keystrokes go
   * back as `terminal.data` frames, and it is killed when the socket closes.
   */
  'terminal.spawn': { params: z.object({ projectId: z.string(), ...TerminalSize }), result: z.object({ terminalId: TerminalId }) },
  'terminal.resize': { params: z.object({ terminalId: TerminalId, ...TerminalSize }), result: z.object({ resized: z.literal(true) }) },
  'terminal.kill': { params: z.object({ terminalId: TerminalId }), result: z.object({ killed: z.boolean() }) },

  /** Starts the project's dev server in its sandbox (as described in `.studio-zero/project.json`) and waits until it answers. A server that is already answering is left running. */
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
      /** Run on this engine. Left out, the routing table picks; chosen and unavailable, the task fails instead of quietly using another. */
      engine: EnginePref.optional(),
      /**
       * Have that engine run this model. Only together with `engine`: a model is named the way its engine names it.
       * Left out, the engine runs the one the routing table lists for it. The vendor decides whether it can be run.
       */
      model: ModelId.optional(),
      /**
       * Have that engine think this hard. Only together with `engine`, and only on an engine that has effort as a
       * setting of its own (`engines.models` says which levels). Left out: the routing table's level for this kind of task.
       */
      effort: Effort.optional(),
      /** The session (task stream) to file this task under. Left out: the project's default stream. */
      sessionId: z.string().optional(),
      /** Left out: `full`. */
      track: TaskTrack.optional(),
      /** Cross-check this task with this subscription. Left out: the one paired with the engine, never the engine's own vendor. */
      reviewer: ReviewerPref.optional(),
      /** Up to three pages to take design principles from. Each is opened only inside the QA browser container. */
      references: z.array(ReferenceUrl).max(3).optional(),
      /**
       * Stop after planning (and the plan's cross-review) until the owner approves the plan or asks for changes
       * (`plans.resolve`). Left out: the daemon's `planReview.defaultOn`, which is off. Only a task that plans
       * (a full-track build, refactor or materialisation) has a plan to show.
       */
      reviewPlan: z.boolean().optional(),
    }),
    result: Task,
  },
  /** Sends a message to a running task without stopping it. The engine reads it at its next turn. */
  'tasks.steer': { params: z.object({ taskId: z.string(), message: z.string().min(1).max(4000) }), result: z.object({ queued: z.literal(true) }) },
  'tasks.get': { params: z.object({ taskId: z.string() }), result: Task },
  'tasks.list': { params: z.object({ projectId: z.string().optional(), limit: z.number().int().min(1).max(200).optional() }), result: z.object({ tasks: z.array(Task) }) },
  'tasks.cancel': { params: z.object({ taskId: z.string() }), result: Task },
  /** Queues a suspended task again now, without waiting for the daemon's own check that a reviewer is back. */
  'tasks.resume': { params: z.object({ taskId: z.string() }), result: Task },

  /**
   * The owner's schedules: a prompt submitted as a task once at a time, or every so many minutes. Each run is a
   * `tasks.submit` as the owner, queued behind whatever the project is running; a run is skipped while the
   * task from the one before is still queued, running or parked. Times are epoch milliseconds.
   */
  'schedules.list': { params: z.object({ projectId: z.string().optional() }), result: z.object({ schedules: z.array(Schedule) }) },
  /**
   * `at` (in the future), `everyMinutes` (an hour or more), or both. Alone, `at` is one run and `everyMinutes`
   * starts one interval from now; together the first run is `at` and the rest follow at that interval.
   */
  'schedules.create': {
    params: z.object({
      projectId: z.string(),
      kind: TaskKind.exclude(['kirby_materialize']),
      prompt: z.string().min(1).max(20_000),
      engine: EnginePref.optional(),
      model: ModelId.optional(),
      at: z.number().int().positive().optional(),
      everyMinutes: z.number().int().min(60).max(60 * 24 * 366).optional(),
    }),
    result: Schedule,
  },
  /** Pauses or resumes. A resumed interval picks up at its next time from now: what was missed while paused does not run. */
  'schedules.setEnabled': { params: z.object({ scheduleId: z.string(), enabled: z.boolean() }), result: Schedule },
  'schedules.delete': { params: z.object({ scheduleId: z.string() }), result: z.object({ deleted: z.literal(true) }) },

  /** A task's plan versions, oldest first (empty for a task that was never stopped for plan review), and how many more times it may be sent back. */
  'plans.list': { params: z.object({ taskId: z.string() }), result: z.object({ versions: z.array(PlanVersion), revisionsLeft: z.number().int() }) },
  /**
   * The owner's verdict on the plan a task is waiting with. `version` and `planHash` must be those of the version
   * waiting now, or the call is refused (`conflict`): a verdict is bound to the plan it was given on. `changes`
   * needs at least one feedback item, and is refused once `planReview.maxRevisions` revisions have been asked for.
   */
  'plans.resolve': {
    params: z.object({ taskId: z.string(), version: z.number().int().min(1), planHash: z.string().regex(/^[0-9a-f]{64}$/), verdict: z.enum(['approve', 'changes']), feedback: z.array(PlanFeedback).max(20).optional() }),
    result: PlanVersion,
  },

  'approvals.list': { params: z.object({ state: ApprovalState.optional() }), result: z.object({ approvals: z.array(Approval) }) },
  'approvals.resolve': { params: z.object({ approvalId: z.string(), decision: z.enum(['approve', 'deny']) }), result: Approval },

  'checkpoints.list': { params: z.object({ projectId: z.string() }), result: z.object({ checkpoints: z.array(Checkpoint) }) },
  /** Restores the workspace to a checkpoint. A safety checkpoint of the current state is taken first, so a rollback is itself undoable. */
  'checkpoints.rollback': { params: z.object({ projectId: z.string(), checkpointId: z.string() }), result: z.object({ restored: Checkpoint, safety: Checkpoint }) },

  /** Makes a branch that starts at a checkpoint, so a different direction can be tried from that point without losing this one. */
  'checkpoints.fork': { params: z.object({ projectId: z.string(), checkpointId: z.string() }), result: z.object({ branch: z.string() }) },

  'git.merge': { params: z.object({ projectId: z.string(), branch: z.string().min(1).max(120) }), result: z.object({ commit: z.string(), into: z.string() }) },

  /**
   * The diff of a task's branch against the branch it started from, read with git inside the project's sandbox
   * (the studio's own project included). Parsed and checked line by line on the daemon; `truncated` when a size
   * or count limit cut it short.
   */
  'reviews.diff': { params: z.object({ taskId: z.string() }), result: ReviewDiff },
  /**
   * The owner's review of that diff. `approved` goes to the same merge the task's merge button makes (`git.merge`,
   * or `selfhost.merge` on Studio Zero Core) and is refused where that merge is; `annotated` starts a task on the
   * reviewed branch whose request is the comments, each with its file, lines, label and the quoted code. A comment
   * whose lines are not in one hunk of the current diff refuses the whole review (`conflict`). Each accepted
   * review is recorded.
   */
  'reviews.submit': { params: z.object({ taskId: z.string(), result: ReviewResult }), result: ReviewOutcome },

  'audits.run': { params: z.object({ projectId: z.string(), routes: z.array(z.string()).min(1).max(8).optional() }), result: AuditReport },
  'audits.get': { params: z.object({ auditId: z.string() }), result: AuditReport },
  'audits.list': {
    params: z.object({ projectId: z.string(), limit: z.number().int().min(1).max(100).optional() }),
    result: z.object({ audits: z.array(AuditReport.pick({ id: true, taskId: true, createdAt: true, score: true, passed: true })) }),
  },
  /**
   * Starts a task that redesigns the audited screens from that audit's design review: its critique, its redesign
   * plan and its findings. The task continues from the branch the audit looked at and runs the full checks, so
   * the result is audited again.
   */
  'audits.redesign': { params: z.object({ auditId: z.string() }), result: Task },

  /** The project's receipts, newest first: one per finished task, each with its deltas against the one before. */
  'ledger.list': { params: z.object({ projectId: z.string(), limit: z.number().int().min(1).max(200).optional() }), result: z.object({ entries: z.array(LedgerEntry) }) },

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
  /** `reviewPlan`: stop after planning until the owner approves the plan (`plans.resolve`). Only where the build plans: the studio's own repository. */
  'kirby.materialize': { params: z.object({ proposalId: z.string(), reviewPlan: z.boolean().optional() }), result: Task },
  'kirby.reject': { params: z.object({ proposalId: z.string() }), result: ProposalCard },

  // Scratchpad: thinking, research and drafting without a sandbox. Promotion turns one into a project or a document.
  'scratch.create': { params: z.object({ opening: z.string().min(1).max(8000), mode: ScratchMode }), result: Scratchpad },
  // `archived: true` lists the notes that were put away, and only those.
  'scratch.list': { params: z.object({ archived: z.boolean().optional() }), result: z.object({ scratchpads: z.array(Scratchpad) }) },
  'scratch.get': {
    params: z.object({ scratchId: z.string() }),
    result: z.object({ scratchpad: Scratchpad, entries: z.array(ScratchEntry), spec: z.string(), decisionLog: z.string(), readiness: Readiness, thinking: z.boolean(), jobs: z.array(KnowledgeJob) }),
  },
  'scratch.say': { params: z.object({ scratchId: z.string(), text: z.string().min(1).max(8000) }), result: z.object({ accepted: z.literal(true) }) },
  'scratch.respond': { params: z.object({ scratchId: z.string(), response: AxResponse }), result: z.object({ accepted: z.literal(true) }) },
  /** Runs one of the named techniques on the scratchpad: eight divergent takes, five simulated users, a red-team review, or convergence into a spec. */
  'scratch.move': { params: z.object({ scratchId: z.string(), move: ScratchMove }), result: z.object({ accepted: z.literal(true) }) },
  'scratch.promote': {
    params: z.object({
      scratchId: z.string(),
      target: z.enum(['build', 'document']),
      template: Template.optional(),
      documentKind: DocumentKind.optional(),
      /** Who runs the project's first build, as on `tasks.submit`: an engine, and with it a model and an effort. Read for a build only. */
      engine: EnginePref.optional(),
      model: ModelId.optional(),
      effort: Effort.optional(),
    }),
    result: PromotionResult,
  },
  'scratch.archive': { params: z.object({ scratchId: z.string() }), result: Scratchpad },
  /** Brings an archived note back into the list. */
  'scratch.restore': { params: z.object({ scratchId: z.string() }), result: Scratchpad },
  'scratch.rename': { params: z.object({ scratchId: z.string(), title: z.string().trim().min(1).max(120) }), result: Scratchpad },
  /** Removes a note with its conversation, spec and decisions. Refused while it is thinking or a job of its own is running. */
  'scratch.delete': { params: z.object({ scratchId: z.string() }), result: z.object({ deleted: z.literal(true) }) },
  /** Stops the turn a note is thinking through. `stopped` is false when there was none. */
  'scratch.stop': { params: z.object({ scratchId: z.string() }), result: z.object({ stopped: z.boolean() }) },

  'research.start': { params: z.object({ question: z.string().min(4).max(2000), depth: z.enum(['brief', 'deep']), scratchId: z.string().optional() }), result: KnowledgeJob },
  'documents.compile': {
    params: z.object({ title: z.string().min(1).max(200), kind: DocumentKind, brief: z.string().min(1).max(20_000), researchJobId: z.string().optional(), scratchId: z.string().optional() }),
    result: KnowledgeJob,
  },
  'knowledge.list': { params: empty, result: z.object({ jobs: z.array(KnowledgeJob) }) },
  /** Stops a running research or document job. It ends as failed, with the reason saying it was stopped. */
  'knowledge.cancel': { params: z.object({ jobId: z.string() }), result: z.object({ accepted: z.literal(true) }) },
  /** Starts a failed job again from what it was asked. A new job; the failed one stays on record. */
  'knowledge.retry': { params: z.object({ jobId: z.string() }), result: KnowledgeJob },
  'knowledge.get': { params: z.object({ jobId: z.string() }), result: z.object({ job: KnowledgeJob, markdown: z.string(), report: ResearchReport.nullable(), lint: z.array(TextFinding) }) },
  /** Renders a finished document as a styled PDF and returns the artifact that holds it. */
  'documents.export': { params: z.object({ jobId: z.string() }), result: z.object({ artifactId: z.string() }) },

  'ax.calibration': { params: empty, result: Calibration },

  /**
   * A second opinion: one question to another vendor's model through its subscription CLI. Single pass, no tools,
   * no memory of earlier questions. The answer also lands in the event stream as `advisor.answered`.
   */
  'advisor.ask': {
    params: z.object({ projectId: z.string(), taskId: z.string().optional(), advisor: AdvisorId, question: z.string().min(1).max(8000) }),
    result: z.object({ advisor: AdvisorId, answer: z.string(), durationMs: z.number().int() }),
  },

  // This Mac: keeping it awake, and what the daemon has seen of each subscription.
  'power.get': { params: empty, result: PowerState },
  'power.set': { params: z.object({ mode: PowerMode }), result: PowerState },
  'quota.get': { params: empty, result: z.object({ at: z.number().int(), subscriptions: z.array(SubscriptionQuota) }) },

  /** The studio's own repository as a project. Read-only: what a task there would start from and whether its result could be merged. */
  'selfhost.status': { params: empty, result: SelfHostStatus },
  /**
   * Merges the feature branch a Core task exported into the base branch of this Mac's checkout, fast-forward
   * only, and only when that checkout is clean and on the base branch. Otherwise it is refused and nothing moves.
   */
  'selfhost.merge': { params: z.object({ taskId: z.string() }), result: z.object({ branch: z.string(), into: z.string(), commit: z.string() }) },

  // External tool servers (MCP). Configured by the owner; used by agents through the daemon, one approved tool at a time.
  'mcp.list': { params: empty, result: z.object({ servers: z.array(McpServerInfo) }) },
  'mcp.add': {
    params: z.discriminatedUnion('transport', [
      z.object({ transport: z.literal('http'), id: McpServerId, name: z.string().min(1).max(60), about: z.string().max(300), url: z.string().min(8).max(300), auth: z.enum(['bearer', 'none']) }),
      /** A program on the daemon's Mac that speaks MCP on stdio: Blender, Unity, Aseprite and other local tools. */
      z.object({ transport: z.literal('stdio'), id: McpServerId, name: z.string().min(1).max(60), about: z.string().max(300), command: z.string().min(1).max(300), args: z.array(z.string().max(500)).max(24), tokenEnv: z.string().regex(/^[A-Z][A-Z0-9_]{1,60}$/).optional() }),
    ]),
    result: McpServerInfo,
  },
  'mcp.remove': { params: z.object({ serverId: z.string() }), result: z.object({ removed: z.literal(true) }) },
  'mcp.revoke': { params: z.object({ serverId: z.string(), projectId: z.string() }), result: z.object({ revoked: z.number().int() }) },

  // Outside APIs a project's own code calls with the owner's key. The key is stored once and never read back.
  'external.list': { params: z.object({ projectId: z.string() }), result: z.object({ apis: z.array(ExternalApi) }) },
  /** Connects an API (or replaces its keys). Inbound only, like `vault.set`. */
  'external.set': {
    params: z.object({
      projectId: z.string(),
      name: ExternalApi.shape.name,
      origin: z.string().min(12).max(200),
      variables: z.array(z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]{0,30}$/, 'capital letters, digits and underscores'), secret: z.string().min(1).max(8192) })).min(1).max(6),
    }),
    result: ExternalApi,
  },
  'external.remove': { params: z.object({ projectId: z.string(), name: ExternalApi.shape.name }), result: z.object({ removed: z.literal(true) }) },

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
/** Keystrokes (and pasted text) for a terminal this connection opened. Not acknowledged; a frame for an unknown terminal is dropped. */
const TerminalDataFrame = z.object({ t: z.literal('terminal.data'), terminalId: TerminalId, data: z.string().max(256 * 1024) });

export const ClientFrame = z.discriminatedUnion('t', [HelloFrame, ReqFrame, SubFrame, UnsubFrame, TerminalDataFrame]);
export type ClientFrame = z.infer<typeof ClientFrame>;

export const ServerFrame = z.discriminatedUnion('t', [
  z.object({ t: z.literal('ready'), protocol: z.number().int(), version: z.string(), headSeq: z.number().int() }),
  z.object({ t: z.literal('res'), id: z.string(), result: z.unknown() }),
  z.object({ t: z.literal('err'), id: z.string(), error: RpcError }),
  z.object({ t: z.literal('evt'), sub: z.string(), event: EventEnvelope }),
  /** The subscription was dropped (slow consumer). Resubscribe with `sinceSeq` = last seen seq. */
  z.object({ t: z.literal('sub_closed'), sub: z.string(), reason: z.string() }),
  /** Raw terminal output (ANSI sequences included), decoded as UTF-8. */
  z.object({ t: z.literal('terminal.output'), terminalId: z.string(), data: z.string() }),
  /** The terminal's shell ended, or the terminal was killed. No further frames follow for this id. */
  z.object({ t: z.literal('terminal.exit'), terminalId: z.string(), exitCode: z.number().int().nullable(), reason: z.string() }),
]);
export type ServerFrame = z.infer<typeof ServerFrame>;

/** WebSocket close codes used by the daemon. */
export const CloseCode = {
  unauthorized: 4401,
  protocolMismatch: 4406,
  badFrame: 4400,
  helloTimeout: 4408,
} as const;

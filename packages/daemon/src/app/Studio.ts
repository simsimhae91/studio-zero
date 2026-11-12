import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Approval,
  ApprovalState,
  AxResponse,
  Calibration,
  DocumentKind,
  KnowledgeJob,
  McpServerInfo,
  PromotionResult,
  ResearchReport,
  ScratchMode,
  ScratchMove,
  Scratchpad,
  TextFinding,
  AdvisorId,
  AuditReport,
  Checkpoint,
  CredentialMeta,
  Eval,
  EventEnvelope,
  EventFilter,
  Lesson,
  LessonState,
  Origin,
  Project,
  ProposalCard,
  ResultOf,
  SandboxInfo,
  Session,
  Task,
  TaskKind,
  TaskTrack,
  Template,
} from '@studio-zero/protocol';
import { PROTOCOL_VERSION } from '@studio-zero/protocol';
import type { ConfidenceCalibration } from '../ax/Calibration.ts';
import type { SteeringQueue } from '../ax/Steering.ts';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import type { WorkspaceProvisioner } from '../harness/bootstrap.ts';
import { ensureDevServer } from '../harness/devServer.ts';
import type { EvalRunner } from '../harness/EvalRunner.ts';
import { INTEGRATION_BRANCH } from '../harness/Harness.ts';
import type { LessonBook } from '../harness/LessonBook.ts';
import { readProjectFile } from '../harness/projectFile.ts';
import type { KirbyEngine } from '../kirby/KirbyEngine.ts';
import type { KnowledgeService } from '../knowledge/KnowledgeService.ts';
import type { McpRegistry } from '../mcp/McpRegistry.ts';
import type { ClaudeClient } from '../llm/ClaudeClient.ts';
import type { ModelRouter } from '../llm/ModelRouter.ts';
import type { Actor } from '../policy/actions.ts';
import { toApproval, type PolicyEngine } from '../policy/PolicyEngine.ts';
import type { VisualAuditor } from '../qa/VisualAuditor.ts';
import type { TaskQueue } from '../queue/TaskQueue.ts';
import { SandboxError, sandboxNames, type OrbStackManager } from '../sandbox/OrbStackManager.ts';
import type { PtyManager, TerminalSink } from '../sandbox/PtyManager.ts';
import type { FileContent, FileListing, SandboxFileService } from '../sandbox/SandboxFileService.ts';
import { assertBranchName } from '../sandbox/scripts.ts';
import { PromotionWorkflow, type PromotionHost } from '../scratch/PromotionWorkflow.ts';
import type { ScratchService, ScratchView } from '../scratch/ScratchService.ts';
import { Secret, errorMessage, excerpt, newId, type Clock, type Logger } from '../util/core.ts';
import { CredentialIds, type KeychainVault } from '../vault/KeychainVault.ts';
import { ConflictError, NotFoundError, UnavailableError } from './errors.ts';
import type { ProjectNamer } from './ProjectNamer.ts';

/** A vendor CLI that can be asked one question with no tools in reach (see `CliBridgeEngine.ask`). */
export interface Advisor {
  readonly id: string;
  availability(): Promise<{ available: boolean; reason: string }>;
  ask(req: { system: string; question: string; signal?: AbortSignal; timeoutMs?: number }): Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}

/** A constant: the owner's question is the only thing that changes, and it travels as the prompt, not in here. */
export const ADVISOR_SYSTEM_PROMPT = `The owner of a software project, who is building it with another AI system, is asking you for a second opinion. Answer the question directly and concretely, in the language it is asked in. Lead with your recommendation, then give the reasoning that would change someone's mind, including what would make you wrong. Keep it to a few short paragraphs. You cannot see the project: where the answer depends on something you were not told, say what it depends on instead of guessing.`;
const advisorLabel: Record<AdvisorId, string> = { codex: 'Codex', gemini: 'Gemini (Antigravity)' };

export interface StudioDeps {
  config: Config;
  store: Store;
  events: EventLog;
  policy: PolicyEngine;
  sandboxes: OrbStackManager;
  provisioner: WorkspaceProvisioner;
  queue: TaskQueue;
  vault: KeychainVault;
  claude: ClaudeClient;
  router: ModelRouter;
  auditor: VisualAuditor;
  evals: EvalRunner;
  lessons: LessonBook;
  kirby: KirbyEngine;
  scratch: ScratchService;
  knowledge: KnowledgeService;
  calibration: ConfidenceCalibration;
  steering: SteeringQueue;
  mcp: McpRegistry;
  files: SandboxFileService;
  pty: PtyManager;
  namer: ProjectNamer;
  advisors: Record<AdvisorId, Advisor>;
  relayStates: () => ResultOf<'system.status'>['relays'];
  clock: Clock;
  log: Logger;
  version: string;
}

/**
 * The application layer: every operation an owner can ask for, with the actor passed in explicitly.
 * The WebSocket RPC handlers and the Telegram relay are thin adapters over this class, so a command behaves
 * identically, and is policy-checked identically, whichever channel it arrives on.
 */
/** Shown when nothing can think: neither way in to a model is set up. */
const NO_MODEL = '쓸 수 있는 모델이 없습니다. Claude Code에 로그인하거나(터미널에서 claude 실행), 설정에서 Anthropic API 키를 저장해 주세요.';

export class Studio implements PromotionHost {
  readonly #d: StudioDeps;
  readonly #startedAt: number;
  readonly #background = new Set<Promise<void>>();
  readonly #promotion: PromotionWorkflow;

  constructor(deps: StudioDeps) {
    this.#d = deps;
    this.#startedAt = deps.clock();
    this.#promotion = new PromotionWorkflow({ scratch: deps.scratch, policy: deps.policy, sandboxes: deps.sandboxes, host: this });
  }

  async status(): Promise<ResultOf<'system.status'>> {
    const [runtime, engines] = await Promise.all([this.#d.sandboxes.probe(), this.#d.router.status()]);
    return {
      version: this.#d.version,
      protocol: PROTOCOL_VERSION,
      uptimeSec: Math.floor((this.#d.clock() - this.#startedAt) / 1000),
      runtime: { context: this.#d.config.runtime.dockerContext, ...runtime },
      relays: this.#d.relayStates(),
      queue: this.#d.store.countTasks(),
      engines,
      brain: this.#d.claude.mode(),
    };
  }

  // -------------------------------------------------------------- projects

  #newProject(p: { name: string; slug: string; template: Template }): Project {
    if (this.#d.store.getProjectBySlug(p.slug)) throw new ConflictError(`a project with slug "${p.slug}" already exists`);
    const project: Project = { id: newId('prj'), slug: p.slug, name: p.name, template: p.template, createdAt: this.#d.clock() };
    this.#d.store.insertProject(project);
    this.#d.evals.seed(project);
    return project;
  }

  /** Creates a project and returns once its sandbox and workspace are ready. Used by promotion, which writes into it next. */
  async createProjectAndProvision(_actor: Actor, p: { name: string; slug: string; template: Template }): Promise<Project> {
    const project = this.#newProject(p);
    await this.#provision(project);
    return project;
  }

  createProject(_actor: Actor, p: { name: string; slug: string; template: Template }): Project {
    const project = this.#newProject(p);
    // Provisioning can take a while on first use (image pull), so it runs behind the response. A task
    // submitted meanwhile simply provisions on its own; both paths are idempotent.
    const job: Promise<void> = this.#provision(project)
      .then(() => undefined)
      .catch((err: unknown) => {
        this.#d.log.warn({ projectId: project.id, err: errorMessage(err) }, 'sandbox provisioning failed');
        this.#d.events.emit({ projectId: project.id, taskId: null }, { type: 'notice', level: 'warn', message: `Sandbox for ${project.name} is not ready: ${errorMessage(err)}` });
      })
      .catch(() => undefined)
      .finally(() => this.#background.delete(job));
    this.#background.add(job);
    return project;
  }

  /** Resolves when background provisioning has finished. Awaited on shutdown, before the database closes. */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.#background]);
  }

  listProjects(): Project[] {
    return this.#d.store.listProjects();
  }

  /** The projects, and for each whether its sandbox is up and a task is using it: what a project list shows at a glance. */
  async projectsOverview(): Promise<ResultOf<'projects.list'>> {
    const projects = this.listProjects();
    const busy = this.#d.store.busyProjectIds();
    let states = new Map<string, 'running' | 'stopped'>();
    try {
      states = await this.#d.sandboxes.states();
    } catch {
      // The container engine is not reachable: every sandbox reads as absent, and the list still loads.
    }
    return { projects, live: projects.map((p) => ({ projectId: p.id, sandbox: states.get(sandboxNames(p.slug).container) ?? ('absent' as const), busy: busy.has(p.id) })) };
  }

  /** The display name only. The slug names the container, the volume and the preview host, so it stays. */
  renameProject(_actor: Actor, projectId: string, name: string): Project {
    this.getProject(projectId);
    const renamed = this.#d.store.renameProject(projectId, name.trim().replace(/\s+/g, ' '))!;
    this.#d.events.emit({ projectId, taskId: null }, { type: 'project.changed', name: renamed.name });
    return renamed;
  }

  /**
   * An idea to a running task, with no questions in between. The project gets a distilled name and slug, a
   * template that fits unless one was given, and its first task: a working draft (`fast`), or the product
   * definition documents first (`deep`).
   */
  async igniteProject(actor: Actor, p: { idea: string; track: 'fast' | 'deep'; template?: Template; engine?: string }, origin: Origin): Promise<{ project: Project; task: Task }> {
    const identity = await this.#d.namer.name(p.idea, p.template);
    let slug = identity.slug;
    for (let n = 2; this.#d.store.getProjectBySlug(slug); n++) slug = `${identity.slug.slice(0, 36).replace(/-+$/, '')}-${n}`;
    const project = this.createProject(actor, { name: identity.name, slug, template: identity.template });
    const task = await this.submitTask(actor, { projectId: project.id, kind: p.track === 'deep' ? 'ideate' : 'build', prompt: p.idea, track: p.track === 'deep' ? 'full' : 'fast', engine: p.engine }, origin);
    return { project, task };
  }

  /** Removes the sandbox, the project's records and its screenshots. Events stay: they are the audit trail. */
  async deleteProject(actor: Actor, projectId: string, deleteWorkspace: boolean): Promise<void> {
    const project = this.getProject(projectId);
    await this.#d.policy.authorize(actor, { kind: 'project.delete', projectId, deleteWorkspace });
    this.#assertIdle(projectId, 'delete the project');
    for (const task of this.#d.store.listTasks(projectId, 200)) if (task.state === 'queued') this.#d.queue.cancel(task.id);
    await this.#d.pty.closeProject(projectId);
    await this.settle();
    await this.#d.sandboxes.destroy(project, { deleteWorkspace });
    this.#d.store.deleteProject(projectId);
    await rm(join(this.#d.config.artifactsDir, projectId), { recursive: true, force: true });
  }

  getProject(projectId: string): Project {
    const project = this.#d.store.getProject(projectId);
    if (!project) throw new NotFoundError(`project ${projectId}`);
    return project;
  }

  async #provision(project: Project): Promise<SandboxInfo> {
    const info = await this.#d.provisioner.ensure(project);
    this.#d.events.emit({ projectId: project.id, taskId: null }, { type: 'sandbox.state', state: info.state });
    return info;
  }

  // -------------------------------------------------------------- sessions

  listSessions(projectId: string): Session[] {
    this.getProject(projectId);
    return this.#d.store.listSessions(projectId);
  }

  createSession(projectId: string, name: string): Session {
    this.getProject(projectId);
    const session: Session = { id: newId('ses'), projectId, name: name.trim(), createdAt: this.#d.clock() };
    this.#d.store.insertSession(session);
    return session;
  }

  renameSession(sessionId: string, name: string): Session {
    this.#session(sessionId);
    return this.#d.store.renameSession(sessionId, name.trim())!;
  }

  /** The session goes; its tasks stay and fall back to the project's default stream. */
  deleteSession(sessionId: string): void {
    this.#session(sessionId);
    this.#d.store.deleteSession(sessionId);
  }

  #session(sessionId: string): Session {
    const session = this.#d.store.getSession(sessionId);
    if (!session) throw new NotFoundError(`session ${sessionId}`);
    return session;
  }

  // ----------------------------------------------------------------- files

  listFiles(projectId: string, path: string | undefined, depth: number | undefined): Promise<FileListing> {
    const project = this.getProject(projectId);
    return this.#inSandbox(project, () => this.#d.files.list(project, path ?? '.', depth ?? 1));
  }

  readFile(projectId: string, path: string): Promise<FileContent> {
    const project = this.getProject(projectId);
    return this.#inSandbox(project, () => this.#d.files.read(project, path));
  }

  async writeFile(actor: Actor, projectId: string, path: string, content: string): Promise<void> {
    const project = this.getProject(projectId);
    await this.#d.policy.authorize(actor, { kind: 'sandbox.write', projectId, path });
    await this.#inSandbox(project, () => this.#d.files.write(project, path, content));
  }

  /** Files live on the sandbox's volume, so looking at them needs the container. A stopped sandbox is started once and the call retried. */
  async #inSandbox<T>(project: Project, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof SandboxError) || !/is not available/.test(err.message)) throw err;
      await this.#provision(project);
      return fn();
    }
  }

  // -------------------------------------------------------------- terminal

  /** Opens a shell in the project's sandbox for one client connection (`owner`), starting the sandbox if it is down. */
  async spawnTerminal(actor: Actor, projectId: string, size: { cols: number; rows: number }, owner: string, sink: TerminalSink): Promise<string> {
    const project = this.getProject(projectId);
    await this.#d.policy.authorize(actor, { kind: 'sandbox.terminal', projectId });
    await this.#provision(project);
    return this.#d.pty.spawn(project, size, owner, sink);
  }

  resizeTerminal(owner: string, terminalId: string, cols: number, rows: number): Promise<void> {
    return this.#d.pty.resize(owner, terminalId, cols, rows);
  }

  killTerminal(owner: string, terminalId: string): Promise<boolean> {
    return this.#d.pty.kill(owner, terminalId);
  }

  // --------------------------------------------------------------- advisor

  /**
   * A second opinion, when the owner asks for one: a single question to another vendor's model, which can see
   * nothing and touch nothing. Not part of any task's loop; its answer is advice for the owner to weigh.
   */
  async askAdvisor(actor: Actor, p: { projectId: string; taskId?: string; advisor: AdvisorId; question: string }): Promise<{ advisor: AdvisorId; answer: string; durationMs: number }> {
    this.getProject(p.projectId);
    if (p.taskId !== undefined && this.getTask(p.taskId).projectId !== p.projectId) throw new ConflictError('that task belongs to another project');
    await this.#d.policy.authorize(actor, { kind: 'advisor.ask', projectId: p.projectId, advisor: p.advisor });
    const engine = this.#d.advisors[p.advisor];
    const status = await engine.availability();
    if (!status.available) throw new UnavailableError(`${advisorLabel[p.advisor]} CLI를 쓸 수 없습니다. ${status.reason}`);

    const scope = { projectId: p.projectId, taskId: p.taskId ?? null };
    const started = Date.now();
    try {
      const reply = await engine.ask({ system: ADVISOR_SYSTEM_PROMPT, question: p.question });
      // Metered against the project, not against a task: the question is the owner's, not part of a task's work.
      const usage = { source: 'bridge' as const, model: `${engine.id}:default`, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, usdMicros: 0 };
      this.#d.store.addUsage({ projectId: p.projectId, taskId: null, ...usage }, this.#d.clock());
      const answer = excerpt(reply.text.trim() || '(빈 응답)', 24_000);
      const durationMs = Date.now() - started;
      this.#d.events.emit(scope, { type: 'advisor.answered', advisor: p.advisor, question: p.question, ok: true, answer, durationMs });
      return { advisor: p.advisor, answer, durationMs };
    } catch (err) {
      this.#d.events.emit(scope, { type: 'advisor.answered', advisor: p.advisor, question: p.question, ok: false, answer: errorMessage(err), durationMs: Date.now() - started });
      throw new UnavailableError(`${advisorLabel[p.advisor]}가 답하지 못했습니다. ${errorMessage(err)}`);
    }
  }

  // --------------------------------------------------------------- sandbox

  sandboxInfo(projectId: string): Promise<SandboxInfo> {
    return this.#d.sandboxes.info(this.getProject(projectId));
  }

  async sandboxLifecycle(actor: Actor, projectId: string, op: 'start' | 'stop' | 'recreate'): Promise<SandboxInfo> {
    const project = this.getProject(projectId);
    await this.#d.policy.authorize(actor, { kind: 'sandbox.lifecycle', projectId, op });
    if (op !== 'start') {
      this.#assertIdle(projectId, `${op} the sandbox`);
      await this.#d.pty.closeProject(projectId);
    }
    const info = op === 'start' ? await this.#provision(project) : op === 'stop' ? await this.#d.sandboxes.stop(project) : await this.#d.sandboxes.recreate(project);
    this.#d.events.emit({ projectId, taskId: null }, { type: 'sandbox.state', state: info.state });
    return info;
  }

  /**
   * Makes the live preview available and returns where the host can reach it. A dev server that is already
   * answering (a task's own checks start one) is left running, so opening the preview never restarts the app
   * under a task that is verifying it.
   */
  async startPreview(actor: Actor, projectId: string): Promise<{ containerPort: number; localhost: string; orbLocal: string }> {
    const project = this.getProject(projectId);
    const info = await this.#provision(project);
    const file = await readProjectFile(this.#d.sandboxes, project, this.#d.config);
    await this.#d.policy.authorize(actor, { kind: 'sandbox.exec', projectId, command: file.dev.command });
    const url = info.previewUrls.find((p) => p.containerPort === file.dev.port);
    if (!url) throw new UnavailableError(`port ${file.dev.port} is not one of the sandbox's preview ports (${this.#d.config.runtime.previewPorts.join(', ')})`);
    const server = await ensureDevServer(this.#d.sandboxes, project, file, { reuse: true });
    if (!server.ready) throw new UnavailableError(`the dev server (${file.dev.command}) did not answer on port ${file.dev.port}: ${excerpt(server.log, 400)}`);
    return url;
  }

  async stopPreview(_actor: Actor, projectId: string): Promise<void> {
    await this.#d.sandboxes.stopProcess(this.getProject(projectId), 'dev');
  }

  // ----------------------------------------------------------------- tasks

  async submitTask(actor: Actor, p: { projectId: string; kind: TaskKind; prompt: string; budgetTokens?: number; branch?: string; baseBranch?: string; engine?: string; sessionId?: string; track?: TaskTrack }, origin: Origin): Promise<Task> {
    this.getProject(p.projectId);
    if (p.sessionId !== undefined && this.#session(p.sessionId).projectId !== p.projectId) throw new ConflictError('that session belongs to another project');
    if (p.baseBranch !== undefined) {
      try {
        assertBranchName(p.baseBranch);
      } catch (err) {
        throw new ConflictError(errorMessage(err));
      }
    }
    const budgetTokens = p.budgetTokens ?? this.#d.config.budgets.taskTokens;
    await this.#d.policy.authorize(actor, { kind: 'task.submit', projectId: p.projectId, taskKind: p.kind, budgetTokens });
    const task = this.#d.store.insertTask({ id: newId('tsk'), projectId: p.projectId, kind: p.kind, prompt: p.prompt, origin, budgetTokens, branch: p.branch ?? null, baseBranch: p.baseBranch ?? null, enginePref: p.engine ?? null, sessionId: p.sessionId ?? null, track: p.track ?? 'full', createdAt: this.#d.clock() });
    this.#d.events.emit({ projectId: task.projectId, taskId: task.id }, { type: 'task.state', state: 'queued', error: null });
    this.#d.queue.pump();
    return task;
  }

  getTask(taskId: string): Task {
    const task = this.#d.store.getTask(taskId);
    if (!task) throw new NotFoundError(`task ${taskId}`);
    return task;
  }

  listTasks(projectId: string | undefined, limit: number): Task[] {
    return this.#d.store.listTasks(projectId, limit);
  }

  /** Non-blocking steering: the message is read by the engine at its next turn; the task keeps running. */
  async steerTask(actor: Actor, taskId: string, message: string): Promise<void> {
    const task = this.getTask(taskId);
    if (task.state !== 'running' && task.state !== 'awaiting_approval') throw new ConflictError(`task is ${task.state}; there is nothing to steer`);
    await this.#d.policy.authorize(actor, { kind: 'task.steer', projectId: task.projectId, taskId });
    this.#d.steering.push(taskId, message);
    this.#d.events.emit({ projectId: task.projectId, taskId }, { type: 'steer.queued', text: message });
  }

  cancelTask(taskId: string): Task {
    this.getTask(taskId);
    this.#d.queue.cancel(taskId);
    return this.getTask(taskId);
  }

  // ------------------------------------------------------------- approvals

  listApprovals(state: ApprovalState | undefined): Approval[] {
    return this.#d.store.listApprovals(state).map(toApproval);
  }

  /** `via` is set by the adapter from the transport the decision arrived on; only owner channels call this. */
  resolveApproval(approvalId: string, decision: 'approve' | 'deny', via: Origin): Approval {
    const resolved = this.#d.policy.resolveApproval(approvalId, decision, via);
    if (resolved) return resolved;
    const existing = this.#d.store.getApproval(approvalId);
    if (!existing) throw new NotFoundError(`approval ${approvalId}`);
    throw new ConflictError(`approval is already ${existing.state === 'pending' ? 'expired' : existing.state}`);
  }

  // ------------------------------------------------- checkpoints and merge

  listCheckpoints(projectId: string): Checkpoint[] {
    this.getProject(projectId);
    return this.#d.store.listCheckpoints(projectId).map(({ headSha: _head, branch: _branch, ...checkpoint }) => checkpoint);
  }

  async rollback(actor: Actor, projectId: string, checkpointId: string): Promise<{ restored: Checkpoint; safety: Checkpoint }> {
    const project = this.getProject(projectId);
    await this.#d.policy.authorize(actor, { kind: 'checkpoint.rollback', projectId, checkpointId });
    this.#assertIdle(projectId, 'roll back');
    const result = await this.#d.sandboxes.rollback(project, checkpointId);
    const scope = { projectId, taskId: null };
    this.#d.events.emit(scope, { type: 'checkpoint.created', checkpointId: result.safety.id, label: result.safety.label });
    this.#d.events.emit(scope, { type: 'checkpoint.restored', checkpointId });
    return result;
  }

  /** Time travel, the non-destructive way: a new branch that starts at a checkpoint. A task can then be started from it. */
  async forkCheckpoint(actor: Actor, projectId: string, checkpointId: string): Promise<string> {
    const project = this.getProject(projectId);
    await this.#d.policy.authorize(actor, { kind: 'checkpoint.fork', projectId, checkpointId });
    const branch = await this.#d.sandboxes.fork(project, checkpointId);
    this.#d.events.emit({ projectId, taskId: null }, { type: 'checkpoint.forked', checkpointId, branch });
    return branch;
  }

  /**
   * Merges a branch into the integration branch. Checkpoint first; if the integration branch moved since the
   * branch was verified, the merged result is re-checked against the regression commands and rolled back if it
   * fails. A merge either lands verified or leaves no trace.
   */
  async merge(actor: Actor, projectId: string, branch: string): Promise<{ commit: string; into: string }> {
    const project = this.getProject(projectId);
    try {
      assertBranchName(branch);
    } catch (err) {
      throw new ConflictError(errorMessage(err));
    }
    await this.#d.policy.authorize(actor, { kind: 'git.merge', projectId, branch, into: INTEGRATION_BRANCH });
    this.#assertIdle(projectId, 'merge');
    const scope = { projectId, taskId: null };

    const linear = (await this.#d.sandboxes.exec(project, `git merge-base --is-ancestor ${INTEGRATION_BRANCH} '${branch}'`, { timeoutSec: 30 })).exitCode === 0;
    const safety = await this.#d.sandboxes.checkpoint(project, `before merging ${branch}`.slice(0, 120));
    this.#d.events.emit(scope, { type: 'checkpoint.created', checkpointId: safety.id, label: safety.label });
    await this.#d.sandboxes.stopProcess(project, 'dev');
    const commit = await this.#d.sandboxes.merge(project, branch, INTEGRATION_BRANCH);

    if (!linear) {
      const failed = (await this.#d.evals.runAll(project, null, { commandsOnly: true })).filter((o) => !o.passed);
      if (failed.length > 0) {
        await this.#d.sandboxes.rollback(project, safety.id);
        this.#d.events.emit(scope, { type: 'checkpoint.restored', checkpointId: safety.id });
        throw new ConflictError(`merge undone: ${INTEGRATION_BRANCH} had moved and the merged result fails ${failed.map((f) => f.eval.name).join(', ')}. ${excerpt(failed[0]!.detail, 300)}`);
      }
    }
    this.#d.events.emit(scope, { type: 'git.merged', branch, into: INTEGRATION_BRANCH, commit });
    this.#d.kirby.markMerged(projectId, branch);
    return { commit, into: INTEGRATION_BRANCH };
  }

  // ---------------------------------------------------------------- audits

  async runAudit(_actor: Actor, projectId: string, routes: string[] | undefined): Promise<AuditReport> {
    const project = this.getProject(projectId);
    this.#assertIdle(projectId, 'run an audit');
    await this.#provision(project);
    const file = await readProjectFile(this.#d.sandboxes, project, this.#d.config);
    const server = await ensureDevServer(this.#d.sandboxes, project, file, { reuse: false });
    if (!server.ready) throw new UnavailableError(`the dev server did not answer on port ${file.dev.port}: ${excerpt(server.log, 400)}`);
    return this.#d.auditor.audit({ project, taskId: null, port: file.dev.port, routes: routes ?? file.routes });
  }

  getAudit(auditId: string): AuditReport {
    const audit = this.#d.store.getAudit(auditId);
    if (!audit) throw new NotFoundError(`audit ${auditId}`);
    return audit;
  }

  listAudits(projectId: string, limit: number): Pick<AuditReport, 'id' | 'taskId' | 'createdAt' | 'score' | 'passed'>[] {
    return this.#d.store.listAudits(projectId, limit);
  }

  // ------------------------------------------------------ lessons and evals

  listLessons(projectId: string | undefined, state: LessonState | undefined): Lesson[] {
    return this.#d.store.listLessons(projectId, state);
  }

  async setLessonState(actor: Actor, lessonId: string, state: 'active' | 'retired' | 'quarantined'): Promise<Lesson> {
    const lesson = this.#d.store.getLesson(lessonId);
    if (!lesson) throw new NotFoundError(`lesson ${lessonId}`);
    if (state === 'active') await this.#d.policy.authorize(actor, { kind: 'lesson.activate', lessonId, scope: lesson.scope, projectId: lesson.projectId });
    const updated = this.#d.lessons.setState(lessonId, state)!;
    const project = lesson.projectId ? this.#d.store.getProject(lesson.projectId) : this.#d.store.listProjects()[0];
    if (project) await this.#d.lessons.render(project);
    return updated;
  }

  listEvals(projectId: string): Eval[] {
    this.getProject(projectId);
    return this.#d.store.listEvals(projectId);
  }

  async setEvalEnabled(actor: Actor, evalId: string, enabled: boolean): Promise<Eval> {
    const ev = this.#d.store.getEval(evalId);
    if (!ev) throw new NotFoundError(`eval ${evalId}`);
    if (!enabled) await this.#d.policy.authorize(actor, { kind: 'eval.disable', projectId: ev.projectId, evalId });
    return this.#d.store.setEvalEnabled(evalId, enabled)!;
  }

  // ----------------------------------------------------------------- kirby

  async kirbyIngest(actor: Actor, projectId: string, repoUrl: string, maxProposals: number): Promise<{ ingestId: string }> {
    const project = this.getProject(projectId);
    await this.#d.policy.authorize(actor, { kind: 'kirby.ingest', projectId, repoUrl });
    if (!this.#d.claude.isConfigured()) throw new UnavailableError(NO_MODEL);
    await this.#provision(project);
    return { ingestId: this.#d.kirby.ingest(project, repoUrl, maxProposals) };
  }

  kirbyProposals(projectId: string): ProposalCard[] {
    this.getProject(projectId);
    return this.#d.store.listProposalRows(projectId).map((r) => r.card);
  }

  async kirbyMaterialize(actor: Actor, proposalId: string, origin: Origin): Promise<Task> {
    const { project, prompt, branch } = this.#d.kirby.materializePrompt(proposalId);
    await this.#d.policy.authorize(actor, { kind: 'kirby.materialize', projectId: project.id, proposalId });
    const task = await this.submitTask(actor, { projectId: project.id, kind: 'kirby_materialize', prompt, branch }, origin);
    this.#d.kirby.attachTask(proposalId, task);
    return task;
  }

  kirbyReject(proposalId: string): ProposalCard {
    return this.#d.kirby.reject(proposalId);
  }

  // ------------------------------------------------- scratchpad & promotion

  async createScratchpad(actor: Actor, p: { opening: string; mode: ScratchMode }, origin: Origin): Promise<Scratchpad> {
    if (!this.#d.claude.isConfigured()) throw new UnavailableError(NO_MODEL);
    if (p.mode !== 'think') await this.#d.policy.authorize(actor, { kind: 'knowledge.run', jobKind: p.mode === 'research' ? 'research' : 'document' });
    const pad = this.#d.scratch.create(p.opening, p.mode);
    if (p.mode === 'research') this.#d.knowledge.startResearch({ question: p.opening, depth: 'deep', scratchId: pad.id }, origin);
    if (p.mode === 'document') this.#d.knowledge.compileDocument({ title: pad.title, kind: 'report', brief: p.opening, scratchId: pad.id }, origin);
    return pad;
  }

  listScratchpads(): Scratchpad[] {
    return this.#d.scratch.list();
  }

  scratchView(scratchId: string): ScratchView {
    return this.#d.scratch.view(scratchId);
  }

  scratchSay(scratchId: string, text: string): void {
    this.#d.scratch.say(scratchId, text);
  }

  scratchRespond(scratchId: string, response: AxResponse): void {
    this.#d.scratch.respond(scratchId, response);
  }

  scratchMove(scratchId: string, move: ScratchMove): void {
    this.#d.scratch.move(scratchId, move);
  }

  promoteScratchpad(actor: Actor, p: { scratchId: string; target: 'build' | 'document'; template?: Template; documentKind?: DocumentKind }, origin: Origin): Promise<PromotionResult> {
    return this.#promotion.promote(actor, p.scratchId, p.target, { template: p.template, documentKind: p.documentKind }, origin);
  }

  archiveScratchpad(scratchId: string): Scratchpad {
    return this.#d.scratch.archive(scratchId);
  }

  // -------------------------------------------------------------- knowledge

  async startResearch(actor: Actor, p: { question: string; depth: 'brief' | 'deep'; scratchId?: string }, origin: Origin): Promise<KnowledgeJob> {
    await this.#d.policy.authorize(actor, { kind: 'knowledge.run', jobKind: 'research' });
    if (!this.#d.claude.isConfigured()) throw new UnavailableError(NO_MODEL);
    return this.#d.knowledge.startResearch(p, origin);
  }

  async compileDocument(actor: Actor, p: { title: string; kind: DocumentKind; brief: string; researchJobId?: string; scratchId?: string }, origin: Origin): Promise<KnowledgeJob> {
    await this.#d.policy.authorize(actor, { kind: 'knowledge.run', jobKind: 'document' });
    if (!this.#d.claude.isConfigured()) throw new UnavailableError(NO_MODEL);
    return this.#d.knowledge.compileDocument(p, origin);
  }

  getKnowledge(jobId: string): { job: KnowledgeJob; markdown: string; report: ResearchReport | null; lint: TextFinding[] } {
    return this.#d.knowledge.get(jobId);
  }

  listKnowledge(): KnowledgeJob[] {
    return this.#d.knowledge.list();
  }

  exportDocument(jobId: string): Promise<string> {
    return this.#d.knowledge.exportPdf(jobId);
  }

  calibration(): Calibration {
    return this.#d.calibration.stats();
  }

  // ---------------------------------------------------------- tool servers

  mcpList(): McpServerInfo[] {
    return this.#d.mcp.list();
  }

  mcpAdd(actor: Actor, p: Parameters<McpRegistry['add']>[1]): Promise<McpServerInfo> {
    return this.#d.mcp.add(actor, p);
  }

  mcpRemove(actor: Actor, serverId: string): Promise<void> {
    return this.#d.mcp.remove(actor, serverId);
  }

  mcpRevoke(actor: Actor, serverId: string, projectId: string): Promise<number> {
    return this.#d.mcp.revoke(actor, serverId, projectId);
  }

  // ----------------------------------------------------------------- vault

  vaultList(): CredentialMeta[] {
    return this.#d.store.listCredentials();
  }

  async vaultSet(actor: Actor, id: string, secret: Secret): Promise<CredentialMeta> {
    await this.#d.policy.authorize(actor, { kind: 'vault.write', credentialId: id });
    // A pasted key that picked up a space or a line break fails later, far from here, as an authentication error.
    if (/\s/.test(secret.expose())) throw new ConflictError('값에 공백이나 줄바꿈이 들어 있습니다. 키만 붙여 넣어 주세요.');
    if (id === CredentialIds.anthropicApiKey && (await this.#d.claude.checkKey(secret)) === 'rejected') {
      throw new ConflictError('Anthropic이 이 키를 받아들이지 않습니다 (401). 저장하지 않았습니다. Console에서 발급한 API 키(sk-ant-api…)인지, 전체를 복사했는지 확인해 주세요. Claude 구독 로그인은 API 키가 아니며, 구독은 Claude Code 엔진으로 쓰입니다.');
    }
    await this.#d.vault.set(id, secret);
    this.#d.claude.invalidate();
    return this.#d.store.upsertCredential(id, this.#d.clock());
  }

  async vaultDelete(actor: Actor, id: string): Promise<boolean> {
    await this.#d.policy.authorize(actor, { kind: 'vault.delete', credentialId: id });
    const deleted = await this.#d.vault.delete(id);
    this.#d.store.deleteCredential(id);
    this.#d.claude.invalidate();
    return deleted;
  }

  history(filter: EventFilter, sinceSeq: number, limit: number): EventEnvelope[] {
    return this.#d.events.history(filter, sinceSeq, limit);
  }

  #assertIdle(projectId: string, what: string): void {
    const busy = this.#d.store.listTasks(projectId, 20).find((t) => t.state === 'running' || t.state === 'awaiting_approval');
    if (busy) throw new ConflictError(`cannot ${what} while task ${busy.id} is using the workspace`);
  }
}

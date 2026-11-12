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
  Task,
  TaskKind,
  Template,
} from '@studio-zero/protocol';
import { PROTOCOL_VERSION } from '@studio-zero/protocol';
import type { ConfidenceCalibration } from '../ax/Calibration.ts';
import type { SteeringQueue } from '../ax/Steering.ts';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import type { WorkspaceProvisioner } from '../harness/bootstrap.ts';
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
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { assertBranchName } from '../sandbox/scripts.ts';
import { PromotionWorkflow, type PromotionHost } from '../scratch/PromotionWorkflow.ts';
import type { ScratchService, ScratchView } from '../scratch/ScratchService.ts';
import { Secret, errorMessage, excerpt, newId, type Clock, type Logger } from '../util/core.ts';
import { CredentialIds, type KeychainVault } from '../vault/KeychainVault.ts';
import { ConflictError, NotFoundError, UnavailableError } from './errors.ts';

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

  /** Removes the sandbox, the project's records and its screenshots. Events stay: they are the audit trail. */
  async deleteProject(actor: Actor, projectId: string, deleteWorkspace: boolean): Promise<void> {
    const project = this.getProject(projectId);
    await this.#d.policy.authorize(actor, { kind: 'project.delete', projectId, deleteWorkspace });
    this.#assertIdle(projectId, 'delete the project');
    for (const task of this.#d.store.listTasks(projectId, 200)) if (task.state === 'queued') this.#d.queue.cancel(task.id);
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

  // --------------------------------------------------------------- sandbox

  sandboxInfo(projectId: string): Promise<SandboxInfo> {
    return this.#d.sandboxes.info(this.getProject(projectId));
  }

  async sandboxLifecycle(actor: Actor, projectId: string, op: 'start' | 'stop' | 'recreate'): Promise<SandboxInfo> {
    const project = this.getProject(projectId);
    await this.#d.policy.authorize(actor, { kind: 'sandbox.lifecycle', projectId, op });
    if (op !== 'start') this.#assertIdle(projectId, `${op} the sandbox`);
    const info = op === 'start' ? await this.#provision(project) : op === 'stop' ? await this.#d.sandboxes.stop(project) : await this.#d.sandboxes.recreate(project);
    this.#d.events.emit({ projectId, taskId: null }, { type: 'sandbox.state', state: info.state });
    return info;
  }

  /** Runs the project's dev server for the live preview and returns where the host can reach it. */
  async startPreview(actor: Actor, projectId: string): Promise<{ containerPort: number; localhost: string; orbLocal: string }> {
    const project = this.getProject(projectId);
    const info = await this.#provision(project);
    const file = await readProjectFile(this.#d.sandboxes, project, this.#d.config);
    await this.#d.policy.authorize(actor, { kind: 'sandbox.exec', projectId, command: file.dev.command });
    const url = info.previewUrls.find((p) => p.containerPort === file.dev.port);
    if (!url) throw new UnavailableError(`port ${file.dev.port} is not one of the sandbox's preview ports (${this.#d.config.runtime.previewPorts.join(', ')})`);
    await this.#d.sandboxes.startProcess(project, 'dev', file.dev.command);
    if (!(await this.#d.sandboxes.waitForHttp(project, file.dev.port, '/', 90))) {
      throw new UnavailableError(`the dev server (${file.dev.command}) did not answer on port ${file.dev.port}: ${excerpt(await this.#d.sandboxes.processLog(project, 'dev'), 400)}`);
    }
    return url;
  }

  async stopPreview(_actor: Actor, projectId: string): Promise<void> {
    await this.#d.sandboxes.stopProcess(this.getProject(projectId), 'dev');
  }

  // ----------------------------------------------------------------- tasks

  async submitTask(actor: Actor, p: { projectId: string; kind: TaskKind; prompt: string; budgetTokens?: number; branch?: string; baseBranch?: string }, origin: Origin): Promise<Task> {
    this.getProject(p.projectId);
    if (p.baseBranch !== undefined) {
      try {
        assertBranchName(p.baseBranch);
      } catch (err) {
        throw new ConflictError(errorMessage(err));
      }
    }
    const budgetTokens = p.budgetTokens ?? this.#d.config.budgets.taskTokens;
    await this.#d.policy.authorize(actor, { kind: 'task.submit', projectId: p.projectId, taskKind: p.kind, budgetTokens });
    const task = this.#d.store.insertTask({ id: newId('tsk'), projectId: p.projectId, kind: p.kind, prompt: p.prompt, origin, budgetTokens, branch: p.branch ?? null, baseBranch: p.baseBranch ?? null, createdAt: this.#d.clock() });
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
      const failed = (await this.#d.evals.runAll(project, null, { skipVisual: true })).filter((o) => !o.passed);
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
    await this.#d.sandboxes.startProcess(project, 'dev', file.dev.command);
    if (!(await this.#d.sandboxes.waitForHttp(project, file.dev.port, '/', 90))) {
      throw new UnavailableError(`the dev server did not answer on port ${file.dev.port}: ${excerpt(await this.#d.sandboxes.processLog(project, 'dev'), 400)}`);
    }
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
    if (!this.#d.claude.isConfigured()) throw new UnavailableError('Kirby needs an Anthropic API key in the vault to write proposals');
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
    if (!this.#d.claude.isConfigured()) throw new UnavailableError('a scratchpad needs an Anthropic API key in the vault');
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
    if (!this.#d.claude.isConfigured()) throw new UnavailableError('research needs an Anthropic API key in the vault');
    return this.#d.knowledge.startResearch(p, origin);
  }

  async compileDocument(actor: Actor, p: { title: string; kind: DocumentKind; brief: string; researchJobId?: string; scratchId?: string }, origin: Origin): Promise<KnowledgeJob> {
    await this.#d.policy.authorize(actor, { kind: 'knowledge.run', jobKind: 'document' });
    if (!this.#d.claude.isConfigured()) throw new UnavailableError('writing a document needs an Anthropic API key in the vault');
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

  mcpAdd(actor: Actor, p: { id: string; name: string; url: string; auth: 'bearer' | 'none'; about: string }): Promise<McpServerInfo> {
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

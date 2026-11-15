import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  Approval,
  ApprovalState,
  AxResponse,
  Calibration,
  DocumentKind,
  EngineModel,
  DocumentAnnotation,
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
  ExternalApi,
  LedgerEntry,
  Lesson,
  LessonState,
  PowerMode,
  PowerState,
  ReviewerPref,
  SelfHostStatus,
  SubscriptionQuota,
  Origin,
  PlanFeedback,
  PlanVersion,
  Project,
  ProposalCard,
  RepoStatus,
  RepoUpdate,
  ResultOf,
  ReviewDiff,
  ReviewOutcome,
  Roadmap,
  SandboxInfo,
  Schedule,
  Session,
  Task,
  TaskKind,
  TaskTrack,
  Template,
} from '@studio-zero/protocol';
import { CORE_PROJECT_ID, PROTOCOL_VERSION, ReviewResult, isAdopted, rootOf } from '@studio-zero/protocol';
import type { ConfidenceCalibration } from '../ax/Calibration.ts';
import type { SteeringQueue } from '../ax/Steering.ts';
import type { Config, Effort, EngineId } from '../config.ts';
import { isLight, type Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import type { WorkspaceProvisioner } from '../harness/bootstrap.ts';
import { ensureDevServer } from '../harness/devServer.ts';
import { countBlocking, formatReviewFeedback, readTaskDiff } from '../harness/DiffReview.ts';
import type { EvalRunner } from '../harness/EvalRunner.ts';
import { INTEGRATION_BRANCH } from '../harness/Harness.ts';
import type { Ledger } from '../harness/Ledger.ts';
import type { LessonBook } from '../harness/LessonBook.ts';
import type { PlanGate } from '../harness/PlanGate.ts';
import type { SelfHosting } from '../harness/SelfHosting.ts';
import { readProjectFile } from '../harness/projectFile.ts';
import type { KirbyEngine } from '../kirby/KirbyEngine.ts';
import type { KnowledgeService } from '../knowledge/KnowledgeService.ts';
import type { McpRegistry } from '../mcp/McpRegistry.ts';
import type { ClaudeClient } from '../llm/ClaudeClient.ts';
import { noEffortSetting, type ModelRouter } from '../llm/ModelRouter.ts';
import type { Actor } from '../policy/actions.ts';
import { parseReferenceUrl, toApproval, type PolicyEngine } from '../policy/PolicyEngine.ts';
import { renderAuditFeedback, type VisualAuditor } from '../qa/VisualAuditor.ts';
import type { TaskQueue } from '../queue/TaskQueue.ts';
import { SandboxError, productDir, sandboxNames, type OrbStackManager } from '../sandbox/OrbStackManager.ts';
import type { PtyManager, TerminalSink } from '../sandbox/PtyManager.ts';
import type { FileContent, FileListing, SandboxFileService } from '../sandbox/SandboxFileService.ts';
import { assertBranchName, depsScript, fromProduct } from '../sandbox/scripts.ts';
import type { Gate } from '../repo/Gate.ts';
import { inspect, linkCheckout, slugOf } from '../repo/Adoption.ts';
import { runCommand } from '../util/run.ts';
import { WORKSPACE_DIR } from '../policy/PolicyEngine.ts';
import { SCREEN_SPEC_FILE, readScreenSpec } from '../scratch/ScreenSpec.ts';
import type { MockupRenderer } from '../qa/MockupRenderer.ts';
import { PromotionWorkflow, type PromotionHost } from '../scratch/PromotionWorkflow.ts';
import type { ScratchService, ScratchView } from '../scratch/ScratchService.ts';
import { untrusted } from '../trust/dataBlock.ts';
import type { CaffeinateManager } from '../util/CaffeinateManager.ts';
import { Secret, errorMessage, excerpt, newId, type Clock, type Logger } from '../util/core.ts';
import { shq } from '../util/run.ts';
import { CredentialIds, type KeychainVault } from '../vault/KeychainVault.ts';
import { ConflictError, NotFoundError, UnavailableError } from './errors.ts';
import type { ProjectArms } from '../arms/ProjectArms.ts';
import type { Slots } from '../sandbox/Slots.ts';
import type { ExternalApis } from './ExternalApis.ts';
import type { ProjectNamer } from './ProjectNamer.ts';
import type { QuotaTracker } from './QuotaTracker.ts';
import type { RoadmapRunner } from './RoadmapRunner.ts';
import { nextSlot } from './Scheduler.ts';

/** A vendor CLI that can be asked one question with no tools in reach (see `CliBridgeEngine.ask`). */
export interface Advisor {
  readonly id: string;
  availability(): Promise<{ available: boolean; reason: string }>;
  ask(req: { system: string; question: string; signal?: AbortSignal; timeoutMs?: number }): Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}

/** A constant: the owner's question is the only thing that changes, and it travels as the prompt, not in here. */
export const ADVISOR_SYSTEM_PROMPT = `The owner of a software project, who is building it with another AI system, is asking you for a second opinion. Answer the question directly and concretely, in the language it is asked in. Lead with your recommendation, then give the reasoning that would change someone's mind, including what would make you wrong. Keep it to a few short paragraphs. You cannot see the project: where the answer depends on something you were not told, say what it depends on instead of guessing.`;
const advisorLabel: Record<AdvisorId, string> = { codex: 'Codex', gemini: 'Gemini (Antigravity)' };

/** The lockfiles a product's dependencies are installed by, as `depsScript` looks for them. */
const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'];

export interface StudioDeps {
  config: Config;
  store: Store;
  events: EventLog;
  policy: PolicyEngine;
  sandboxes: OrbStackManager;
  provisioner: WorkspaceProvisioner;
  queue: TaskQueue;
  planGate: PlanGate;
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
  mockups: Pick<MockupRenderer, 'page'>;
  pty: PtyManager;
  namer: ProjectNamer;
  ledger: Ledger;
  power: CaffeinateManager;
  quota: QuotaTracker;
  selfHosting: SelfHosting;
  external: ExternalApis;
  arms: Pick<ProjectArms, 'rest' | 'forget' | 'has' | 'applySchema'>;
  gate: Gate;
  slots: Pick<Slots, 'perProject' | 'landing'>;
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
/**
 * A model is named the way its engine names it, and effort is a setting only some engines have: neither can be
 * chosen while the engine is left to the routing table, and an effort cannot be asked of an engine that has none.
 */
function assertPick(p: { engine?: EngineId; model?: string; effort?: Effort }, router: ModelRouter): void {
  if (p.model !== undefined && p.engine === undefined) throw new ConflictError('a model is chosen together with the engine that runs it: name the engine as well');
  if (p.effort === undefined) return;
  if (p.engine === undefined) throw new ConflictError('an effort is chosen together with the engine that runs at it: name the engine as well');
  if (!router.efforts(p.engine).includes(p.effort)) throw new ConflictError(noEffortSetting(p.engine));
}

/** Shown when nothing can think: neither way in to a model is set up. */
/** The owner's side of a redesign task. The first line is what the task is called in the stream and in the commit. */
const REDESIGN_REQUEST = `디자인 심사 결과대로 화면을 다시 디자인해 주세요.
아래 심사 결과의 재설계 계획을 먼저 적용하고, 블로커와 주요 지적을 모두 해결한 뒤 멈춰 주세요. 기능과 데이터 흐름은 그대로 두고, 화면의 구조와 표현만 바꿉니다.`;

/** Where the power mode is kept, so a restarted daemon holds the Mac awake as it was asked to. */
const POWER_KEY = 'power.mode';
const CORE_FIXED = 'Studio Zero Core는 스튜디오 자신의 저장소입니다. 이름을 바꾸거나 삭제할 수 없습니다.';

/** The longest prompt a schedule keeps: the same as a task takes (`tasks.submit`). */
const SCHEDULE_PROMPT_MAX = 20_000;
/** The shortest interval between a schedule's runs, in minutes. Each run is paid work nobody is watching. */
const SCHEDULE_MIN_INTERVAL = 60;

const NO_MODEL = '쓸 수 있는 모델이 없습니다. Claude Code에 로그인하거나(터미널에서 claude 실행), 설정에서 Anthropic API 키를 저장해 주세요.';

export class Studio implements PromotionHost {
  readonly #d: StudioDeps;
  #runner: RoadmapRunner | null = null;
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

  engineCatalog(engine: EngineId): Promise<{ models: EngineModel[]; efforts: Effort[] }> {
    return this.#d.router.catalog(engine);
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
    // A plan in front of the owner is their turn: the list says so instead of calling the project busy.
    const planWaiting = new Set(this.#d.store.listTasksInState('awaiting_plan_review').map((t) => t.projectId));
    let states = new Map<string, 'running' | 'stopped'>();
    try {
      states = await this.#d.sandboxes.states();
    } catch {
      // The container engine is not reachable: every sandbox reads as absent, and the list still loads.
    }
    return { projects, live: projects.map((p) => ({ projectId: p.id, sandbox: states.get(sandboxNames(p.slug).container) ?? ('absent' as const), busy: busy.has(p.id), planWaiting: planWaiting.has(p.id) })) };
  }

  /** The display name only. The slug names the container, the volume and the preview host, so it stays. */
  renameProject(_actor: Actor, projectId: string, name: string): Project {
    this.getProject(projectId);
    if (projectId === CORE_PROJECT_ID) throw new ConflictError(CORE_FIXED);
    const renamed = this.#d.store.renameProject(projectId, name.trim().replace(/\s+/g, ' '))!;
    this.#d.events.emit({ projectId, taskId: null }, { type: 'project.changed', name: renamed.name });
    return renamed;
  }

  /**
   * An idea to a running task, with no questions in between. The project gets a distilled name and slug, a
   * template that fits unless one was given, and its first task: a working draft (`fast`), or the product
   * definition documents first (`deep`).
   */
  async igniteProject(actor: Actor, p: { idea: string; track: 'fast' | 'deep'; template?: Template; engine?: EngineId; model?: string; effort?: Effort }, origin: Origin): Promise<{ project: Project; task: Task }> {
    // Refused before anything is named or created: a project must not be left behind by a request that could never start.
    assertPick(p, this.#d.router);
    const identity = await this.#d.namer.name(p.idea, p.template);
    let slug = identity.slug;
    for (let n = 2; this.#d.store.getProjectBySlug(slug); n++) slug = `${identity.slug.slice(0, 36).replace(/-+$/, '')}-${n}`;
    const project = this.createProject(actor, { name: identity.name, slug, template: identity.template });
    const task = await this.submitTask(actor, { projectId: project.id, kind: p.track === 'deep' ? 'ideate' : 'build', prompt: p.idea, track: p.track === 'deep' ? 'full' : 'fast', engine: p.engine, model: p.model, effort: p.effort }, origin);
    return { project, task };
  }

  /** Removes the sandbox, the project's records and its screenshots. Events stay: they are the audit trail. */
  async deleteProject(actor: Actor, projectId: string, deleteWorkspace: boolean): Promise<void> {
    const project = this.getProject(projectId);
    if (projectId === CORE_PROJECT_ID) throw new ConflictError(CORE_FIXED);
    await this.#d.policy.authorize(actor, { kind: 'project.delete', projectId, deleteWorkspace });
    this.#assertIdle(projectId, 'delete the project');
    for (const task of this.#d.store.listTasks(projectId, 200)) if (task.state === 'queued') this.#d.queue.cancel(task.id);
    await this.#d.pty.closeProject(projectId);
    await this.settle();
    // The project's keys for outside APIs go with it: nothing is left in the Keychain under its name.
    await this.#d.external.forgetProject(project);
    // Its backend goes too, with every user and row in it: they were the project's, and nothing else points at them.
    await this.#d.arms.forget(project);
    await this.#d.sandboxes.destroy(project, { deleteWorkspace });
    // Its repository on this Mac goes with the workspace it mirrors. A clone the owner made keeps what it has.
    if (deleteWorkspace) await this.#d.gate.forget(project);
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

  /** A mock-up page as the studio measured it: its pictures and the theme's faces inside it. Null when there is no such page. */
  async mockupPage(projectId: string, file: string): Promise<string | null> {
    const project = this.getProject(projectId);
    return (await this.#inSandbox(project, () => this.#d.mockups.page(project, file)))?.html ?? null;
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
    // A stopped sandbox's backend is stopped with it: its data and its address are kept, and it is back in a second or two.
    if (op === 'stop') await this.#d.arms.rest(project);
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
    // A product that was brought in and not fitted yet has nothing the studio knows how to start: say that, not a dev server's last words.
    if (!server.ready && isAdopted(project) && !(await this.#planned(project))) throw new UnavailableError(`이 제품은 아직 스튜디오에 맞추지 않아 프리뷰를 띄울 수 없습니다. 저장소 탭의 "스튜디오에 맞추기"(sz fit ${project.slug})를 먼저 하세요.`);
    if (!server.ready) throw new UnavailableError(`the dev server (${file.dev.command}) did not answer on port ${file.dev.port}: ${excerpt(server.log, 400)}`);
    return url;
  }

  async stopPreview(_actor: Actor, projectId: string): Promise<void> {
    await this.#d.sandboxes.stopProcess(this.getProject(projectId), 'dev');
  }

  // ----------------------------------------------------------------- tasks

  async submitTask(actor: Actor, p: { projectId: string; kind: TaskKind; prompt: string; budgetTokens?: number; branch?: string; baseBranch?: string; engine?: EngineId; model?: string; effort?: Effort; sessionId?: string; track?: TaskTrack; reviewer?: ReviewerPref; references?: string[]; reviewPlan?: boolean; milestone?: number }, origin: Origin): Promise<Task> {
    const adopted = isAdopted(this.getProject(p.projectId));
    if (p.kind === 'adopt' && !adopted) throw new ConflictError('맞추기는 들여온 프로젝트의 작업입니다. 스튜디오가 지은 프로젝트는 처음부터 맞게 지어집니다.');
    if (p.kind === 'ideate' && adopted) throw new ConflictError('들여온 제품에는 처음부터 기획하는 디자인 작업을 두지 않습니다. 바꿀 것은 만들기나 빠른 수정으로 내세요.');
    // A product that was brought in and has not been fitted cannot be run, walked or measured here: a task on
    // it would be judged by a dev server that does not start. What it stands on (main, or the branch it is
    // asked to start from) has to hold a plan first; the fit is the task that writes one.
    if (adopted && p.kind !== 'adopt') {
      const project = this.getProject(p.projectId);
      const base = p.baseBranch ?? INTEGRATION_BRANCH;
      const fitted = await this.#inSandbox(project, () => this.#plannedAt(project, base)).catch(() => false);
      if (!fitted) throw new ConflictError(`이 제품은 아직 ${base}에 걷기 계획이 없어 스튜디오가 돌리고 검사할 수 없습니다. 먼저 맞추고(sz fit ${project.slug}), 그 브랜치를 main에 합친 뒤에 내세요.`);
    }
    assertPick(p, this.#d.router);
    // A reference is refused here, before the task exists, so a mistyped address is not found out mid-build.
    const references = (p.references ?? []).map((raw) => {
      const parsed = parseReferenceUrl(raw);
      if (!parsed.ok) throw new ConflictError(`레퍼런스로 쓸 수 없는 주소입니다 (${raw.slice(0, 80)}): ${parsed.reason}`);
      return parsed.url;
    });
    if (p.sessionId !== undefined && this.#session(p.sessionId).projectId !== p.projectId) throw new ConflictError('that session belongs to another project');
    if (p.baseBranch !== undefined) {
      try {
        assertBranchName(p.baseBranch);
      } catch (err) {
        throw new ConflictError(errorMessage(err));
      }
    }
    const budgetTokens = p.budgetTokens ?? this.#d.config.budgets.taskTokens;
    // Decided once, here, and kept with the task: a restart or a changed default does not change what was asked.
    // Only a task that plans has a plan to show; a draft or a design task goes on as it always has.
    // A small edit or a full check on a project with slots is the fine gear: always the fast track, in a slot.
    // A product that was brought in keeps its own design: the full track's design gates and cross-checks are the
    // house's, so everything on it runs on the fast track (compiler, plan, smoke, scenarios, commands).
    const track = isLight({ kind: p.kind, projectId: p.projectId }, this.#d.slots.perProject) || adopted ? 'fast' : (p.track ?? 'full');
    const reviewPlan = (p.reviewPlan ?? this.#d.config.planReview.defaultOn) && track === 'full' && (p.kind === 'build' || p.kind === 'refactor' || p.kind === 'kirby_materialize');
    await this.#d.policy.authorize(actor, { kind: 'task.submit', projectId: p.projectId, taskKind: p.kind, budgetTokens });
    const task = this.#d.store.insertTask({ id: newId('tsk'), projectId: p.projectId, kind: p.kind, prompt: p.prompt, origin, budgetTokens, branch: p.branch ?? null, baseBranch: p.baseBranch ?? null, enginePref: p.engine ?? null, modelPref: p.model ?? null, effortPref: p.effort ?? null, sessionId: p.sessionId ?? null, track, reviewerPref: p.reviewer ?? null, references, reviewPlan, milestone: p.milestone ?? null, createdAt: this.#d.clock() });
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

  /** Queues a suspended task again now, instead of waiting for the daemon to notice that a reviewer is back. */
  resumeTask(taskId: string): Task {
    const task = this.getTask(taskId);
    if (task.state !== 'suspended') throw new ConflictError(`task is ${task.state}; only a suspended task can be resumed`);
    this.#d.queue.resume(taskId);
    return this.getTask(taskId);
  }

  cancelTask(taskId: string): Task {
    this.getTask(taskId);
    this.#d.queue.cancel(taskId);
    return this.getTask(taskId);
  }

  // --------------------------------------------------------------- roadmap

  /** A project's product map and how far it is built, or null. */
  getRoadmap(projectId: string): Roadmap | null {
    this.getProject(projectId);
    return this.#roadmaps().get(projectId);
  }

  /** Has the product map written from the owner's words (see `RoadmapRunner.plan`). */
  async planRoadmap(actor: Actor, projectId: string, request: string): Promise<Roadmap> {
    const project = this.#productOf(projectId);
    await this.#d.policy.authorize(actor, { kind: 'roadmap.configure', projectId, op: 'plan' });
    if (!this.#d.claude.isConfigured()) throw new UnavailableError(NO_MODEL);
    return this.#roadmaps().plan(project, request);
  }

  async runRoadmap(actor: Actor, projectId: string, opts: { autoMerge?: boolean } = {}): Promise<Roadmap> {
    this.#productOf(projectId);
    await this.#d.policy.authorize(actor, { kind: 'roadmap.configure', projectId, op: 'run' });
    return this.#roadmaps().run(projectId, opts);
  }

  async stopRoadmap(actor: Actor, projectId: string): Promise<Roadmap> {
    this.#productOf(projectId);
    await this.#d.policy.authorize(actor, { kind: 'roadmap.configure', projectId, op: 'stop' });
    return this.#roadmaps().stop(projectId);
  }

  /** A roadmap builds a product. The studio's own repository is changed a task at a time, each read before it is merged. */
  #productOf(projectId: string): Project {
    if (projectId === CORE_PROJECT_ID) throw new ConflictError('Studio Zero Core에는 로드맵을 두지 않습니다. 스튜디오 자신의 코드는 작업 하나씩 읽고 합칩니다.');
    const project = this.getProject(projectId);
    // A roadmap builds a product from nothing to the end of a map, on the house's contract (its backend, its kits, its design).
    if (isAdopted(project)) throw new ConflictError('들여온 제품에는 아직 로드맵을 두지 않습니다. 로드맵은 스튜디오의 약속(백엔드, 키트, 디자인)으로 처음부터 짓는 길입니다.');
    return project;
  }

  /** The runner is made after the studio it submits through, and handed in (`compose.ts`). */
  #roadmaps(): RoadmapRunner {
    if (!this.#runner) throw new UnavailableError('the roadmap runner is not set up');
    return this.#runner;
  }

  useRoadmaps(runner: RoadmapRunner): void {
    this.#runner = runner;
  }

  // ----------------------------------------------------------- plan review

  /** A task's plan versions as the owner was shown them, oldest first. */
  listPlanVersions(taskId: string): { versions: PlanVersion[]; revisionsLeft: number } {
    this.getTask(taskId);
    return { versions: this.#d.planGate.list(taskId), revisionsLeft: this.#d.planGate.revisionsLeft(taskId) };
  }

  /**
   * The owner's verdict on the plan a task is waiting with. Policy first (only an owner answers for a plan), then
   * the gate, which refuses a version or hash that is not the one waiting.
   */
  async resolvePlanReview(actor: Actor, p: { taskId: string; version: number; planHash: string; verdict: 'approve' | 'changes'; feedback?: PlanFeedback[] }): Promise<PlanVersion> {
    const task = this.getTask(p.taskId);
    await this.#d.policy.authorize(actor, { kind: 'plan.review.resolve', projectId: task.projectId, taskId: task.id, version: p.version, planHash: p.planHash });
    return this.#d.planGate.resolve(task.id, p.version, p.planHash, p.verdict, p.feedback ?? []);
  }

  // ------------------------------------------------------------- schedules

  listSchedules(projectId: string | undefined): Schedule[] {
    if (projectId !== undefined) this.getProject(projectId);
    return this.#d.store.listSchedules(projectId);
  }

  /**
   * Saves a prompt to be submitted as a task later: once `at` a time, or every `everyMinutes`. With both, the
   * first run is `at` and the rest follow every `everyMinutes` after it ("every day at seven"); with the interval
   * alone the first run is one interval from now. Only the owner can (`schedule.configure`); each run is then an
   * ordinary `submitTask`, held to the same rules and budgets.
   */
  async createSchedule(actor: Actor, p: { projectId: string; kind: Exclude<TaskKind, 'kirby_materialize'>; prompt: string; engine?: EngineId; model?: string; at?: number; everyMinutes?: number }): Promise<Schedule> {
    this.getProject(p.projectId);
    assertPick(p, this.#d.router);
    if (p.prompt.trim() === '') throw new ConflictError('예약할 작업 내용이 비어 있습니다.');
    if (p.prompt.length > SCHEDULE_PROMPT_MAX) throw new ConflictError(`작업 내용은 ${SCHEDULE_PROMPT_MAX.toLocaleString('en-US')}자까지 예약할 수 있습니다.`);
    if (p.at === undefined && p.everyMinutes === undefined) throw new ConflictError('언제 돌릴지 정해 주세요: 정한 시각(at), 반복 간격(every), 또는 둘 다(그 시각부터 반복).');
    const now = this.#d.clock();
    if (p.everyMinutes !== undefined && (!Number.isInteger(p.everyMinutes) || p.everyMinutes < SCHEDULE_MIN_INTERVAL)) throw new ConflictError(`반복 간격은 ${SCHEDULE_MIN_INTERVAL}분 이상이어야 합니다.`);
    if (p.at !== undefined && p.at <= now) throw new ConflictError('예약 시각이 이미 지났습니다.');
    const every = p.everyMinutes ?? null;
    await this.#d.policy.authorize(actor, { kind: 'schedule.configure', projectId: p.projectId, op: 'create', scheduleId: null, taskKind: p.kind, every });
    return this.#d.store.insertSchedule({
      id: newId('sch'),
      projectId: p.projectId,
      kind: p.kind,
      prompt: p.prompt,
      engine: p.engine ?? null,
      model: p.model ?? null,
      mode: every === null ? 'at' : 'every',
      runAt: p.at ?? null,
      intervalMinutes: every,
      enabled: true,
      nextDueAt: p.at ?? now + every! * 60 * 1000,
      lastFiredAt: null,
      lastTaskId: null,
      createdAt: now,
    });
  }

  /** Pauses or resumes a schedule. Resumed, it runs at its next time from now: slots missed while it was paused do not run. */
  async setScheduleEnabled(actor: Actor, scheduleId: string, enabled: boolean): Promise<Schedule> {
    const schedule = this.#schedule(scheduleId);
    await this.#d.policy.authorize(actor, { kind: 'schedule.configure', projectId: schedule.projectId, op: enabled ? 'resume' : 'pause', scheduleId, taskKind: schedule.kind, every: schedule.intervalMinutes });
    if (!enabled) return this.#d.store.setScheduleEnabled(scheduleId, false, schedule.nextDueAt)!;
    const now = this.#d.clock();
    if (schedule.mode === 'at' || schedule.intervalMinutes === null) {
      if (schedule.runAt === null || schedule.runAt <= now || schedule.lastFiredAt !== null) throw new ConflictError('이 예약은 시각이 지났습니다. 새로 예약해 주세요.');
      return this.#d.store.setScheduleEnabled(scheduleId, true, schedule.runAt)!;
    }
    const from = schedule.nextDueAt ?? schedule.createdAt + schedule.intervalMinutes * 60 * 1000;
    return this.#d.store.setScheduleEnabled(scheduleId, true, nextSlot(from, schedule.intervalMinutes, now))!;
  }

  async deleteSchedule(actor: Actor, scheduleId: string): Promise<void> {
    const schedule = this.#schedule(scheduleId);
    await this.#d.policy.authorize(actor, { kind: 'schedule.configure', projectId: schedule.projectId, op: 'delete', scheduleId, taskKind: schedule.kind, every: schedule.intervalMinutes });
    this.#d.store.deleteSchedule(scheduleId);
  }

  #schedule(scheduleId: string): Schedule {
    const schedule = this.#d.store.getSchedule(scheduleId);
    if (!schedule) throw new NotFoundError(`schedule ${scheduleId}`);
    return schedule;
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
    this.#assertIdle(projectId, 'roll back', { lightToo: false });
    // Under the lock a landing holds: a small edit is not put on a main that is being taken back.
    return this.#d.slots.landing(projectId, async () => {
      const result = await this.#d.sandboxes.rollback(project, checkpointId);
      const scope = { projectId, taskId: null };
      this.#d.events.emit(scope, { type: 'checkpoint.created', checkpointId: result.safety.id, label: result.safety.label });
      this.#d.events.emit(scope, { type: 'checkpoint.restored', checkpointId });
      return result;
    });
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
    // Inside its sandbox the Core project's branches lead nowhere: its work is merged in the checkout itself.
    if (projectId === CORE_PROJECT_ID) throw new ConflictError('Studio Zero Core의 작업은 이 Mac의 저장소로 내보낸 기능 브랜치를 병합합니다 (selfhost.merge).');
    await this.#d.policy.authorize(actor, { kind: 'git.merge', projectId, branch, into: INTEGRATION_BRANCH });
    this.#assertIdle(projectId, 'merge', { lightToo: false });
    // One thing moves a project's main at a time: this merge, or a small edit landing from a slot.
    return this.#d.slots.landing(projectId, () => this.#merge(project, branch));
  }

  async #merge(project: Project, branch: string): Promise<{ commit: string; into: string }> {
    const projectId = project.id;
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

  // ----------------------------------------------------------- code review

  /** The diff of a task's branch against the branch it started from, read with git in the project's sandbox. */
  async reviewDiff(taskId: string): Promise<ReviewDiff> {
    const task = this.getTask(taskId);
    const project = this.getProject(task.projectId);
    return this.#inSandbox(project, () => readTaskDiff(this.#d.sandboxes, project, task, this.#taskStart(task)));
  }

  /** The commit a task's workspace stood at when it began: what its base checkpoint recorded. Null for a task that has none. */
  #taskStart(task: Task): string | null {
    return task.baseCheckpointId === null ? null : (this.#d.store.getCheckpoint(task.baseCheckpointId)?.headSha ?? null);
  }

  /**
   * The owner's line-by-line review of a finished task's code, dispatched on its decision and on nothing else.
   * `approved` is the merge the task's own merge button makes: `selfHostMerge` on Studio Zero Core, `merge`
   * anywhere else. `annotated` is a new task on the reviewed branch whose request is the comments, the way a
   * change is asked for after any task (`submitTask`). No action of its own: each way inherits the policy and the
   * guards of the call it makes, and a review is recorded only once that call has gone through.
   */
  async submitReview(actor: Actor, taskId: string, submitted: ReviewResult, origin: Origin): Promise<ReviewOutcome> {
    const parsed = ReviewResult.safeParse(submitted);
    if (!parsed.success) throw new ConflictError(`the review is not valid: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    const result = parsed.data;
    const task = this.getTask(taskId);
    if (!task.branch) throw new ConflictError('this task has no branch to review');
    if (task.state !== 'succeeded' && task.state !== 'failed' && task.state !== 'cancelled') throw new ConflictError(`task is ${task.state}; its code can be reviewed once it has finished`);
    const blockingCount = countBlocking(result);
    const record = (rerunTaskId: string | null): string => {
      const id = newId('rev');
      this.#d.store.insertTaskReview({ id, taskId, decision: result.decision, comments: result.comments, blockingCount, rerunTaskId, createdAt: this.#d.clock() });
      return id;
    };

    if (result.decision === 'approved') {
      // As the task's own merge button: only work that passed is offered for merging.
      if (task.state !== 'succeeded') throw new ConflictError(`task is ${task.state}; only a task that succeeded is merged`);
      const into = task.projectId === CORE_PROJECT_ID ? (await this.selfHostMerge(actor, taskId)).into : (await this.merge(actor, task.projectId, task.branch)).into;
      return { reviewId: record(null), decision: 'approved', blockingCount, mergedInto: into, rerunTaskId: null };
    }

    // The quoted code comes from the diff as the daemon reads it now; a comment on lines that are not there refuses the review.
    const project = this.getProject(task.projectId);
    const diff = await this.#inSandbox(project, () => readTaskDiff(this.#d.sandboxes, project, task, this.#taskStart(task)));
    const prompt = formatReviewFeedback(result, diff, task);
    const rerun = await this.submitTask(
      actor,
      {
        projectId: task.projectId,
        kind: task.kind === 'refactor' || task.kind === 'inline_edit' ? task.kind : 'build',
        prompt,
        track: task.track,
        baseBranch: task.branch,
        ...(task.sessionId ? { sessionId: task.sessionId } : {}),
      },
      origin,
    );
    return { reviewId: record(rerun.id), decision: 'annotated', blockingCount, mergedInto: null, rerunTaskId: rerun.id };
  }

  // ---------------------------------------------------------------- audits

  async runAudit(_actor: Actor, projectId: string, routes: string[] | undefined): Promise<AuditReport> {
    const project = this.getProject(projectId);
    this.#assertIdle(projectId, 'run an audit', { lightToo: false });
    await this.#provision(project);
    const file = await readProjectFile(this.#d.sandboxes, project, this.#d.config);
    const server = await ensureDevServer(this.#d.sandboxes, project, file, { reuse: false });
    if (!server.ready) throw new UnavailableError(`the dev server did not answer on port ${file.dev.port}: ${excerpt(server.log, 400)}`);
    return this.#d.auditor.audit({ project, taskId: null, port: file.dev.port, routes: routes ?? file.routes });
  }

  /**
   * One click from the audit: a task that redesigns the audited screens from the design review. It continues
   * from the code the audit looked at (the audited task's branch while that is unmerged, otherwise whatever is
   * checked out) and runs the full checks, so the result faces the same reviewer.
   */
  async redesignFromAudit(actor: Actor, auditId: string, origin: Origin): Promise<Task> {
    const audit = this.getAudit(auditId);
    if (audit.findings.length === 0 && audit.redesignPatches.length === 0) throw new ConflictError('this audit found nothing to redesign');
    const project = this.getProject(audit.projectId);
    await this.#provision(project);
    const audited = audit.taskId ? (this.#d.store.getTask(audit.taskId)?.branch ?? null) : null;
    // Prints the branch to continue from, or nothing when the audited code is already on the integration branch.
    const script = audited
      ? `git rev-parse -q --verify ${shq(`refs/heads/${audited}`)} >/dev/null && ! git merge-base --is-ancestor ${shq(audited)} ${INTEGRATION_BRANCH} && echo ${shq(audited)}; true`
      : `b=$(git rev-parse --abbrev-ref HEAD); [ "$b" != HEAD ] && [ "$b" != ${INTEGRATION_BRANCH} ] && ! git merge-base --is-ancestor "$b" ${INTEGRATION_BRANCH} && echo "$b"; true`;
    const baseBranch = (await this.#d.sandboxes.exec(project, script, { timeoutSec: 30 })).stdout.trim() || undefined;
    // The review is a model's reading of a page the engine built: it reaches the engine as data, like every audit.
    const prompt = `${REDESIGN_REQUEST}\n\n${untrusted('browser-page', excerpt(renderAuditFeedback(audit), 14_000), { check: 'visual-audit' })}`;
    return this.submitTask(actor, { projectId: project.id, kind: 'build', prompt, track: 'full', ...(baseBranch ? { baseBranch } : {}) }, origin);
  }

  getAudit(auditId: string): AuditReport {
    const audit = this.#d.store.getAudit(auditId);
    if (!audit) throw new NotFoundError(`audit ${auditId}`);
    return audit;
  }

  listAudits(projectId: string, limit: number): Pick<AuditReport, 'id' | 'taskId' | 'createdAt' | 'score' | 'passed'>[] {
    return this.#d.store.listAudits(projectId, limit);
  }

  // ---------------------------------------------------------------- ledger

  listLedger(projectId: string, limit: number): LedgerEntry[] {
    this.getProject(projectId);
    return this.#d.ledger.list(projectId, limit);
  }

  // -------------------------------------------------------------- this Mac

  powerState(): PowerState {
    return this.#d.power.state;
  }

  async setPower(actor: Actor, mode: PowerMode): Promise<PowerState> {
    await this.#d.policy.authorize(actor, { kind: 'power.set', mode });
    let state: PowerState;
    try {
      state = this.#d.power.set(mode);
    } catch (err) {
      throw new UnavailableError(errorMessage(err));
    }
    this.#d.store.kvSet(POWER_KEY, state.mode);
    return state;
  }

  /** Holds the Mac awake again as it was being held when the daemon last stopped. */
  async restorePower(): Promise<void> {
    const saved = this.#d.store.kvGet(POWER_KEY);
    if (saved !== 'system' && saved !== 'display') return;
    await this.setPower({ type: 'system' }, saved).catch((err: unknown) => this.#d.log.warn({ err: errorMessage(err) }, 'could not restore the power mode'));
  }

  /** The power mode changed, by the owner or because caffeinate ended by itself: tell every client. */
  announcePower(mode: PowerMode): void {
    this.#d.events.emit({ projectId: null, taskId: null }, { type: 'power.changed', mode });
  }

  async quota(): Promise<{ at: number; subscriptions: SubscriptionQuota[] }> {
    return this.#d.quota.snapshot(await this.#d.router.status());
  }

  // ---------------------------------------------------------- self-hosting

  // ------------------------------------------------------------ repository

  /**
   * Whether a branch of a project holds a screen plan with scenarios: whether what stands on it can be walked at
   * all. Read from the branch itself, whatever the workspace has checked out. Throws when the sandbox is not up.
   */
  async #plannedAt(project: Project, branch: string): Promise<boolean> {
    assertBranchName(branch);
    const file = rootOf(project) === '' ? SCREEN_SPEC_FILE : `${rootOf(project)}/${SCREEN_SPEC_FILE}`;
    const shown = await this.#d.sandboxes.exec(project, `git show '${branch}:${file}' 2>/dev/null | head -c 1048576`, { cwd: WORKSPACE_DIR, timeoutSec: 20, maxOutputBytes: 1100 * 1024 });
    if (shown.exitCode !== 0 || shown.stdout.trim() === '') return false;
    try {
      const read = readScreenSpec(JSON.parse(shown.stdout), { works: true, draft: true, wide: true });
      return read.ok && read.spec.scenarios.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Whether a project's main can be walked. A stopped sandbox is not started to find out: it is then answered
   * from whether the project has ever been walked in full.
   */
  async #planned(project: Project): Promise<boolean> {
    try {
      return await this.#plannedAt(project, INTEGRATION_BRANCH);
    } catch {
      return this.#d.store.getWalks(project.id) !== null;
    }
  }

  async repoStatus(projectId: string): Promise<RepoStatus> {
    const project = this.getProject(projectId);
    const open = projectId !== CORE_PROJECT_ID && this.#d.gate.isOpen(project);
    const path = open ? this.#d.gate.pathOf(project) : null;
    const quoted = path === null ? null : /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`;
    return {
      open,
      path,
      cloneCommand: quoted === null ? null : `git clone -o studio ${quoted} ${project.slug}`,
      branches: open ? await this.#d.gate.branches(project) : [],
      adopted: project.adopted ?? null,
      root: rootOf(project),
      planned: await this.#planned(project),
    };
  }

  /** The project's repository on this Mac, made if it is not there yet and brought up to the project's branches. */
  async repoOpen(actor: Actor, projectId: string): Promise<RepoStatus> {
    const project = this.getProject(projectId);
    if (projectId === CORE_PROJECT_ID) throw new ConflictError('Studio Zero Core의 저장소는 이 Mac의 체크아웃 자체입니다. 따로 여는 문이 없습니다.');
    await this.#d.policy.authorize(actor, { kind: 'repo.open', projectId });
    await this.#inSandbox(project, () => this.#d.gate.open(project));
    return this.repoStatus(projectId);
  }

  /**
   * A push to a project's repository, from its receive hook. Taken whole into the project's sandbox or not at
   * all, under the lock everything that moves the project's main holds. The owner's code is not gated: what
   * follows a push to main (dependencies, the schema, the preview, a full check) is the studio catching up.
   */
  async repoReceive(actor: Actor, p: { projectId: string; updates: RepoUpdate[]; pack: string | null }): Promise<{ accepted: boolean; lines: string[] }> {
    const project = this.getProject(p.projectId);
    await this.#d.policy.authorize(actor, { kind: 'repo.receive', projectId: p.projectId, branches: p.updates.map((update) => update.ref.replace(/^refs\/heads\//, '')) });
    const live = new Set<Task['state']>(['queued', 'running', 'awaiting_approval', 'awaiting_plan_review', 'suspended', 'parked']);
    const held = (branch: string): string | null => this.#d.store.listTasks(p.projectId, 200).find((task) => live.has(task.state) && (task.branch ?? `sz/${task.id}`) === branch)?.id ?? null;
    const received = await this.#d.slots.landing(p.projectId, () => this.#d.gate.receive(project, p.updates, p.pack, held));
    if (received.stale) {
      // The gate was behind the sandbox (the daemon was down when something moved): a fetch now gets the pusher what they lack.
      await this.#d.gate.publish(project).catch((err: unknown) => this.#d.log.warn({ projectId: project.id, err: errorMessage(err) }, 'the repository could not be brought up to date'));
    }
    if (!received.accepted) return { accepted: false, lines: received.lines };
    const main = received.moved.find((move) => move.branch === INTEGRATION_BRANCH);
    const lines = [...received.lines];
    if (main && main.old !== null && main.new !== null) lines.push(...(await this.#afterMainMoved(project, main.old, main.new).catch((err: unknown) => [`받은 뒤 처리에서 걸렸습니다: ${errorMessage(err)}`])));
    return { accepted: true, lines };
  }

  /** What the studio does once the owner has moved a project's main: returns what the pusher is told of it. */
  async #afterMainMoved(project: Project, old: string, now: string): Promise<string[]> {
    const lines: string[] = [];
    const listed = await this.#d.sandboxes.exec(project, `git diff --name-only ${old} ${now}; echo "@@$(git symbolic-ref --quiet --short HEAD || true)"`, { cwd: WORKSPACE_DIR, timeoutSec: 60 });
    const out = listed.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    const onMain = out.includes(`@@${INTEGRATION_BRANCH}`);
    const changed = out.filter((line) => !line.startsWith('@@')).map((file) => fromProduct(rootOf(project), file));
    const background = (what: string, job: Promise<unknown>): void => {
      const tracked: Promise<void> = job.then(() => undefined, (err: unknown) => {
        this.#d.log.warn({ projectId: project.id, err: errorMessage(err) }, what);
        this.#d.events.emit({ projectId: project.id, taskId: null }, { type: 'notice', level: 'warn', message: `${what}: ${errorMessage(err)}` });
      }).finally(() => this.#background.delete(tracked));
      this.#background.add(tracked);
    };

    // The working files followed only if the workspace stands on main; a heavy task's branch has its own.
    if (onMain && changed.some((file) => LOCKFILES.includes(file))) {
      lines.push('잠금 파일이 바뀌어 의존성을 다시 놓습니다.');
      background('의존성을 다시 놓지 못했습니다', this.#d.sandboxes.exec(project, depsScript({ workspace: productDir(project) }), { cwd: WORKSPACE_DIR, timeoutSec: 900 }).then((res) => {
        if (res.exitCode !== 0) throw new Error(excerpt(res.stderr || res.stdout, 400));
      }));
    }
    if (onMain && changed.some((file) => file.startsWith('supabase/')) && this.#d.arms.has(project)) {
      const applied = await this.#d.arms.applySchema(project);
      lines.push(applied.ok ? `스키마: ${applied.text.split('\n')[0]}` : `스키마를 넣지 못했습니다. main은 받았고, 백엔드는 그대로입니다. 고쳐서 다시 올리세요.\n${excerpt(applied.text, 600)}`);
      if (!applied.ok) this.#d.events.emit({ projectId: project.id, taskId: null }, { type: 'notice', level: 'warn', message: `소유자가 올린 main의 스키마를 백엔드에 넣지 못했습니다:\n${excerpt(applied.text, 600)}` });
    }
    if (onMain) background('프리뷰를 새 코드로 맞추지 못했습니다', this.#refreshPreview(project));
    if (this.#d.config.repos.checkOnPush && (await this.#planned(project))) {
      const waiting = this.#d.store.listTasks(project.id, 100).find((task) => task.kind === 'check' && task.state === 'queued');
      const check = waiting ?? (await this.submitTask({ type: 'system' }, { projectId: project.id, kind: 'check', prompt: '소유자가 main에 올린 뒤의 전체 점검' }, 'system'));
      lines.push(waiting ? `전체 점검이 이미 줄 서 있습니다 (${check.id}).` : `전체 점검을 걸었습니다 (${check.id}): 올린 코드로 제품 전체를 걷고 화면 기준을 새로 적습니다.`);
    }
    return lines;
  }

  /** A preview that is being looked at shows main as it now is; one that is not running is not started. */
  async #refreshPreview(project: Project): Promise<void> {
    const active = new Set<Task['state']>(['running', 'awaiting_approval', 'awaiting_plan_review']);
    if (this.#d.store.listTasks(project.id, 40).some((task) => active.has(task.state) && !isLight(task, this.#d.slots.perProject))) return;
    const file = await readProjectFile(this.#d.sandboxes, project, this.#d.config);
    if (!(await this.#d.sandboxes.waitForHttp(project, file.dev.port, '/', 1))) return;
    await ensureDevServer(this.#d.sandboxes, project, file, { reuse: true, current: true });
  }

  /**
   * Brings a checkout on this Mac in as a project. Read through git and from what is committed; its base branch
   * becomes the project's main, by way of the project's repository on this Mac, which the checkout then has as
   * the remote `studio`. No engine runs. At the end the studio's main is the owner's, commit for commit: what
   * the studio adds to the repository comes later, on a task's branch, for the owner to merge.
   */
  async adoptProject(actor: Actor, p: { path: string; dir?: string; base?: string; name?: string; slug?: string }): Promise<ResultOf<'projects.adopt'>> {
    await this.#d.policy.authorize(actor, { kind: 'project.adopt', path: p.path });
    // A path typed into a field is typed the way a person writes one: from their home.
    const path = p.path.trim() === '~' ? homedir() : p.path.trim().startsWith('~/') ? join(homedir(), p.path.trim().slice(2)) : p.path.trim();
    const found = await inspect(runCommand, path, { dir: p.dir?.trim() || undefined, base: p.base?.trim() || undefined });
    const already = this.#d.store.listProjects().find((project) => project.adopted?.path === found.repo && rootOf(project) === found.root);
    if (already) throw new ConflictError(`이 저장소는 이미 들여왔습니다: ${already.slug}`);
    const wanted = p.slug ?? slugOf(found.name);
    let slug = wanted;
    for (let n = 2; this.#d.store.getProjectBySlug(slug); n++) {
      if (p.slug !== undefined) throw new ConflictError(`${p.slug}: 이미 있는 프로젝트 이름입니다.`);
      slug = `${wanted.slice(0, 36).replace(/-+$/, '')}-${n}`;
    }
    const project: Project = { id: newId('prj'), slug, name: (p.name ?? found.name).trim().slice(0, 80) || slug, template: found.template, createdAt: this.#d.clock(), root: found.root, adopted: { path: found.repo, base: found.base } };
    this.#d.store.insertProject(project);
    this.#d.evals.seed(project);
    let remote: 'added' | 'kept' | 'differs';
    try {
      await this.#d.gate.seed(project, { repo: found.repo, base: found.base });
      await this.#d.sandboxes.ensure(project);
      await this.#d.gate.fill(project);
      remote = await linkCheckout(runCommand, found.repo, this.#d.gate.pathOf(project));
    } catch (err) {
      // Half a project is worse than none: what was made for it is taken down, and the checkout was not touched.
      await this.#d.sandboxes.destroy(project, { deleteWorkspace: true }).catch(() => undefined);
      await this.#d.gate.forget(project).catch(() => undefined);
      this.#d.store.deleteProject(project.id);
      throw err;
    }
    this.#d.events.emit({ projectId: project.id, taskId: null }, { type: 'notice', level: 'info', message: `${found.repo}의 ${found.base}을(를) 들여왔습니다 (${found.template}${found.root ? `, 제품 폴더 ${found.root}/` : ''}). 의존성을 설치하는 중입니다.` });
    // Installing can take minutes: it runs behind the answer, as a new project's provisioning does.
    const job: Promise<void> = this.#provision(project)
      .then(() => this.#d.events.emit({ projectId: project.id, taskId: null }, { type: 'notice', level: 'info', message: '의존성 설치가 끝났습니다.' }))
      .then(() => undefined)
      .catch((err: unknown) => {
        this.#d.log.warn({ projectId: project.id, err: errorMessage(err) }, 'an adopted project could not be provisioned');
        this.#d.events.emit({ projectId: project.id, taskId: null }, { type: 'notice', level: 'warn', message: `의존성을 설치하지 못했습니다: ${errorMessage(err)}` });
      })
      .finally(() => this.#background.delete(job));
    this.#background.add(job);

    const gate = this.#d.gate.pathOf(project);
    const lines = [
      `${project.slug}: 들여왔습니다 (${found.template}${found.root ? `, 제품 폴더 ${found.root}/` : ''}).`,
      `main은 ${found.repo}의 ${found.base}입니다 (${found.commit.slice(0, 7)}, 커밋 ${found.commits}개).${found.uncommitted > 0 ? ` 커밋되지 않은 변경 ${found.uncommitted}개는 가지 않았습니다.` : ''}`,
      remote === 'added' ? `체크아웃에 원격 studio를 달았습니다: ${gate}` : remote === 'kept' ? `체크아웃에 원격 studio가 이미 이 저장소를 가리킵니다: ${gate}` : `체크아웃에 studio라는 원격이 이미 다른 곳을 가리켜 건드리지 않았습니다. 다른 이름으로 다세요: git remote add <이름> ${gate}`,
      `받기: git fetch studio    보내기: git push studio ${found.base === INTEGRATION_BRANCH ? INTEGRATION_BRANCH : `${found.base}:${INTEGRATION_BRANCH}`}  (main은 앞으로만)`,
      ...(found.base === INTEGRATION_BRANCH ? [] : [`스튜디오 안에서 이 브랜치의 이름은 ${INTEGRATION_BRANCH}입니다.`]),
      `의존성을 설치하는 중입니다. 다음: sz fit ${project.slug} (스튜디오가 걷고 잴 수 있게 맞추기. 구독을 씁니다)`,
    ];
    return { project, gate, remote, base: found.base, uncommitted: found.uncommitted, lines };
  }

  selfHostStatus(): Promise<SelfHostStatus> {
    return this.#d.selfHosting.status();
  }

  /** The owner's merge of a Core task's exported branch into this Mac's checkout. */
  async selfHostMerge(actor: Actor, taskId: string): Promise<{ branch: string; into: string; commit: string }> {
    const task = this.getTask(taskId);
    if (task.projectId !== CORE_PROJECT_ID) throw new ConflictError('that task is not on Studio Zero Core');
    const branch = this.#d.selfHosting.exportedBranch(taskId);
    if (branch === null) throw new NotFoundError(`an exported branch for task ${taskId}`);
    await this.#d.policy.authorize(actor, { kind: 'selfhost.merge', projectId: task.projectId, branch });
    const merged = await this.#d.selfHosting.merge(taskId);
    // A proposal built there is merged by this, as one in a product is by `merge`.
    if (task.branch) this.#d.kirby.markMerged(task.projectId, task.branch);
    return merged;
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

  async kirbyMaterialize(actor: Actor, proposalId: string, origin: Origin, opts: { reviewPlan?: boolean } = {}): Promise<Task> {
    const { project, prompt, branch } = this.#d.kirby.materializePrompt(proposalId);
    await this.#d.policy.authorize(actor, { kind: 'kirby.materialize', projectId: project.id, proposalId });
    // In a product, a draft: held to compiling, loading and the plan's scenarios, which the thing built is added
    // to. In the studio's own repository, planned first and held to everything that repository is held to: what
    // is built there is what builds every project after it.
    const track = project.template === 'studio-core' ? 'full' : 'fast';
    // The owner may ask to read the plan first, as for any task that plans (`submitTask` drops it for a draft).
    const task = await this.submitTask(actor, { projectId: project.id, kind: 'kirby_materialize', prompt, branch, track, ...(opts.reviewPlan !== undefined ? { reviewPlan: opts.reviewPlan } : {}) }, origin);
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

  listScratchpads(archived = false): Scratchpad[] {
    return this.#d.scratch.list(archived);
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

  /**
   * A build takes the owner's pick of engine, model and effort to the project's first task. The pick is checked
   * here, before the workflow creates anything: a note must not become a project whose first task can never start.
   * A document is written by the studio's own writer, so a pick sent along with one is not read.
   */
  async promoteScratchpad(actor: Actor, p: { scratchId: string; target: 'build' | 'document'; template?: Template; documentKind?: DocumentKind; engine?: EngineId; model?: string; effort?: Effort }, origin: Origin): Promise<PromotionResult> {
    const pick = p.target === 'build' ? { engine: p.engine, model: p.model, effort: p.effort } : {};
    assertPick(pick, this.#d.router);
    return this.#promotion.promote(actor, p.scratchId, p.target, { template: p.template, documentKind: p.documentKind, ...pick }, origin);
  }

  /** The latest document published from a note that finished, as Markdown. What a build from that note starts from. */
  publishedPlan(scratchId: string): string | null {
    const latest = this.#d.scratch
      .view(scratchId)
      .jobs.filter((job) => job.kind === 'document' && job.state === 'succeeded')
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0];
    const markdown = latest ? this.#d.knowledge.get(latest.id).markdown.trim() : '';
    return markdown === '' ? null : markdown;
  }

  /**
   * What a restart would cut short, as a sentence for the owner; null when nothing is in flight. A task that is
   * interrupted is queued again and starts over, and a job or a note's turn is simply lost.
   */
  inFlight(): string | null {
    const { running, queued } = this.#d.store.countTasks();
    const jobs = this.#d.knowledge.list().filter((job) => job.state === 'running').length;
    const parts = [running > 0 ? `진행 중인 작업 ${running}건` : null, queued > 0 ? `대기 중인 작업 ${queued}건` : null, jobs > 0 ? `조사·문서 작업 ${jobs}건` : null, this.#d.scratch.busy ? '생각 중인 작업 노트' : null].filter((part) => part !== null);
    return parts.length === 0 ? null : parts.join(', ');
  }

  archiveScratchpad(scratchId: string): Scratchpad {
    return this.#d.scratch.archive(scratchId);
  }

  restoreScratchpad(scratchId: string): Scratchpad {
    return this.#d.scratch.restore(scratchId);
  }

  renameScratchpad(scratchId: string, title: string): Scratchpad {
    return this.#d.scratch.rename(scratchId, title);
  }

  /** Removes a note for good. Not while something of its own is still running: that would finish into nothing. */
  deleteScratchpad(scratchId: string): void {
    if (this.#d.knowledge.busyFor(scratchId)) throw new ConflictError('이 노트의 조사나 문서 작업이 아직 진행 중입니다. 멈춘 뒤에 지울 수 있습니다.');
    this.#d.scratch.remove(scratchId);
  }

  stopScratchpad(scratchId: string): boolean {
    return this.#d.scratch.stop(scratchId);
  }

  cancelKnowledge(jobId: string): void {
    this.#d.knowledge.cancel(jobId);
  }

  async retryKnowledge(actor: Actor, jobId: string): Promise<KnowledgeJob> {
    const job = this.#d.knowledge.get(jobId).job;
    await this.#d.policy.authorize(actor, { kind: 'knowledge.run', jobKind: job.kind });
    return this.#d.knowledge.retry(jobId);
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

  /**
   * The owner's notes on a finished document, sent at once: starts the document's next revision. The same rule as
   * writing a document in the first place (the owner's own call), and the same model route and budget.
   */
  async reviseDocument(actor: Actor, p: { jobId: string; contentHash: string; annotations: DocumentAnnotation[]; note?: string }, origin: Origin): Promise<KnowledgeJob> {
    await this.#d.policy.authorize(actor, { kind: 'knowledge.run', jobKind: 'document' });
    if (!this.#d.claude.isConfigured()) throw new UnavailableError(NO_MODEL);
    return this.#d.knowledge.revise(p, origin);
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

  // ---------------------------------------------------------- outside APIs

  listExternalApis(projectId: string): ExternalApi[] {
    this.getProject(projectId);
    return this.#d.external.list(projectId);
  }

  /** Connects an outside API and its keys to a project, and puts the stand-ins in its workspace if the sandbox is up. */
  async setExternalApi(actor: Actor, p: { projectId: string; name: string; origin: string; variables: { name: string; secret: Secret }[] }): Promise<ExternalApi> {
    const project = this.getProject(p.projectId);
    const api = await this.#d.external.set(actor, project, p);
    this.#refreshStandIns(project);
    return api;
  }

  async removeExternalApi(actor: Actor, projectId: string, name: string): Promise<void> {
    const project = this.getProject(projectId);
    await this.#d.external.remove(actor, project, name);
    this.#refreshStandIns(project);
  }

  /** Rewrites the workspace's list of connected APIs behind the response. A sandbox that is down gets it when it next comes up. */
  #refreshStandIns(project: Project): void {
    if (this.#d.store.busyProjectIds().has(project.id)) return; // a task is in the workspace: it picks the file up at its next start
    const job: Promise<void> = this.#d.sandboxes
      .info(project)
      .then((info) => (info.state === 'running' ? this.#d.provisioner.ensure(project).then(() => undefined) : undefined))
      .catch((err: unknown) => this.#d.log.warn({ projectId: project.id, err: errorMessage(err) }, 'could not write the outside API stand-ins'))
      .finally(() => this.#background.delete(job));
    this.#background.add(job);
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

  /**
   * `lightToo: false` for what only the project's own workspace is needed for (a merge, a rollback, an audit):
   * a small edit or a full check at work in a slot is not in its way.
   */
  #assertIdle(projectId: string, what: string, opts: { lightToo: boolean } = { lightToo: true }): void {
    const busy = this.#d.store.listTasks(projectId, 40).find((t) => (t.state === 'running' || t.state === 'awaiting_approval' || t.state === 'awaiting_plan_review') && (opts.lightToo || !isLight(t, this.#d.slots.perProject)));
    if (busy) throw new ConflictError(`cannot ${what} while task ${busy.id} is using the workspace`);
  }
}

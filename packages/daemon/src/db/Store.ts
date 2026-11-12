import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import {
  AuditReport,
  AxBlock,
  AxResponse,
  EventBody,
  EvalSpec,
  ProposalCard,
  ResearchReport,
  TextFinding,
  UNREVIEWED_SCORE_CAP,
  type Confidence,
  type KnowledgeJob,
  type ScratchEntry,
  type ScratchMode,
  type ScratchState,
  type Scratchpad,
  type SpecSection,
  type Approval,
  type ApprovalState,
  type Checkpoint,
  type CredentialMeta,
  type Eval,
  type EventEnvelope,
  type EventFilter,
  type Lesson,
  type LessonState,
  type Origin,
  type Phase,
  type Project,
  type ProposalState,
  type Session,
  type Task,
  type TaskKind,
  type TaskState,
  type TaskTrack,
  type Template,
} from '@studio-zero/protocol';
import { migrate } from './schema.ts';

type Row = Record<string, SQLInputValue>;

export interface SandboxRow {
  projectId: string;
  container: string;
  volume: string;
  network: string;
  image: string;
  gatewayTokenHash: string;
}

export interface CheckpointRow extends Checkpoint {
  headSha: string;
  branch: string;
}

export interface ApprovalRow extends Approval {
  actionJson: string;
}

export interface UsageEntry {
  projectId: string;
  taskId: string | null;
  source: 'native' | 'gateway' | 'bridge';
  model: string;
  inputTokens: number;
  outputTokens: number;
  usdMicros: number;
}

export interface LessonEvidence {
  taskId: string;
  seqs: number[];
}

export interface ProposalRow {
  card: ProposalCard;
  brief: string;
}

/** The budget scope for work that has no project: scratchpads, research, documents. Never listed as a project. */
export const STUDIO_PROJECT_ID = 'prj_studio';

export interface DecisionRow {
  id: string;
  scratchId: string;
  question: string;
  chosen: string;
  why: string;
  rejected: { option: string; why: string }[];
  confidence: Confidence;
  /** `owner` when the owner picked it from a choice; `agent` when the agent settled it within its confidence. */
  decidedBy: 'owner' | 'agent';
  createdAt: number;
}

export interface KnowledgeRow {
  job: KnowledgeJob;
  input: unknown;
  markdown: string;
  report: ResearchReport | null;
  lint: TextFinding[];
}

export interface IngestRow {
  id: string;
  projectId: string;
  repoUrl: string;
  commit: string | null;
  state: 'running' | 'done' | 'failed';
  profileJson: string | null;
  error: string | null;
}

export interface McpServerRow {
  id: string;
  name: string;
  transport: 'http' | 'stdio';
  url: string;
  /** stdio: the program, as an absolute path resolved when the server was added. */
  command: string | null;
  args: string[];
  tokenEnv: string | null;
  auth: 'bearer' | 'none' | 'oauth';
  about: string;
  builtin: boolean;
  addedAt: number;
}

const str = (v: SQLInputValue | undefined): string => v as string;
const num = (v: SQLInputValue | undefined): number => Number(v);
const mcpServerRow = (r: Record<string, SQLInputValue>): McpServerRow => ({ id: str(r.id), name: str(r.name), transport: str(r.transport) as McpServerRow['transport'], url: str(r.url), command: r.command === null ? null : str(r.command), args: JSON.parse(str(r.args_json)) as string[], tokenEnv: r.token_env === null ? null : str(r.token_env), auth: str(r.auth) as McpServerRow['auth'], about: str(r.about), builtin: num(r.builtin) === 1, addedAt: num(r.added_at) });
const nstr = (v: SQLInputValue | undefined): string | null => (v == null ? null : (v as string));
const nnum = (v: SQLInputValue | undefined): number | null => (v == null ? null : Number(v));

/**
 * The only module that speaks SQL. Synchronous on purpose: `node:sqlite` is in-process, every statement is
 * sub-millisecond at this scale, and synchronous transactions cannot interleave with other daemon work.
 */
export class Store {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    migrate(this.#db);
  }

  close(): void {
    this.#db.close();
  }

  tx<T>(fn: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.#db.exec('COMMIT');
      return out;
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
  }

  readonly #statements = new Map<string, StatementSync>();

  #stmt(sql: string): StatementSync {
    let stmt = this.#statements.get(sql);
    if (!stmt) {
      stmt = this.#db.prepare(sql);
      // Callers pass whole domain objects; keys a statement does not name are ignored rather than fatal.
      stmt.setAllowUnknownNamedParameters(true);
      this.#statements.set(sql, stmt);
    }
    return stmt;
  }

  #run(sql: string, params: Row = {}): number {
    return Number(this.#stmt(sql).run(params).changes);
  }

  #get(sql: string, params: Row = {}): Row | undefined {
    return this.#stmt(sql).get(params) as Row | undefined;
  }

  #all(sql: string, params: Row = {}): Row[] {
    return this.#stmt(sql).all(params) as Row[];
  }

  // ------------------------------------------------------------- projects

  insertProject(p: Project): void {
    this.#run('INSERT INTO projects (id, slug, name, template, created_at) VALUES (:id, :slug, :name, :template, :createdAt)', { ...p });
  }

  getProject(id: string): Project | null {
    const r = this.#get('SELECT * FROM projects WHERE id = :id', { id });
    return r ? toProject(r) : null;
  }

  getProjectBySlug(slug: string): Project | null {
    const r = this.#get('SELECT * FROM projects WHERE slug = :slug', { slug });
    return r ? toProject(r) : null;
  }

  deleteProject(id: string): void {
    this.#run('DELETE FROM projects WHERE id = :id', { id });
  }

  renameProject(id: string, name: string): Project | null {
    this.#run('UPDATE projects SET name = :name WHERE id = :id', { id, name });
    return this.getProject(id);
  }

  // ------------------------------------------------------------- sessions

  insertSession(s: Session): void {
    this.#run('INSERT INTO sessions (id, project_id, name, created_at) VALUES (:id, :projectId, :name, :createdAt)', { ...s });
  }

  getSession(id: string): Session | null {
    const r = this.#get('SELECT * FROM sessions WHERE id = :id', { id });
    return r ? toSession(r) : null;
  }

  listSessions(projectId: string): Session[] {
    return this.#all('SELECT * FROM sessions WHERE project_id = :projectId ORDER BY created_at, id', { projectId }).map(toSession);
  }

  renameSession(id: string, name: string): Session | null {
    this.#run('UPDATE sessions SET name = :name WHERE id = :id', { id, name });
    return this.getSession(id);
  }

  deleteSession(id: string): void {
    this.#run('DELETE FROM sessions WHERE id = :id', { id });
  }

  /** Projects with a task that holds their workspace right now. */
  busyProjectIds(): Set<string> {
    return new Set(this.#all(`SELECT DISTINCT project_id FROM tasks WHERE state IN ('running', 'awaiting_approval')`).map((r) => str(r.project_id)));
  }

  /** Projects the owner made. The studio's own budget scope (see `STUDIO_PROJECT_ID`) is not one of them. */
  listProjects(): Project[] {
    return this.#all('SELECT * FROM projects WHERE id <> :studio ORDER BY created_at', { studio: STUDIO_PROJECT_ID }).map(toProject);
  }

  /** Makes sure the row that scratchpad and knowledge work is metered against exists. */
  ensureStudioProject(now: number): void {
    this.#run(`INSERT INTO projects (id, slug, name, template, created_at) VALUES (:id, 'studio-zero-home', 'Studio', 'web-vite-react', :now) ON CONFLICT (id) DO NOTHING`, { id: STUDIO_PROJECT_ID, now });
  }

  // ------------------------------------------------------------ sandboxes

  upsertSandbox(s: SandboxRow, now: number): void {
    this.#run(
      `INSERT INTO sandboxes (project_id, container, volume, network, image, gateway_token_hash, created_at)
       VALUES (:projectId, :container, :volume, :network, :image, :gatewayTokenHash, :now)
       ON CONFLICT (project_id) DO UPDATE SET image = excluded.image, gateway_token_hash = excluded.gateway_token_hash`,
      { ...s, now },
    );
  }

  getSandbox(projectId: string): SandboxRow | null {
    const r = this.#get('SELECT * FROM sandboxes WHERE project_id = :projectId', { projectId });
    return r ? toSandbox(r) : null;
  }

  getSandboxByTokenHash(hash: string): SandboxRow | null {
    const r = this.#get('SELECT * FROM sandboxes WHERE gateway_token_hash = :hash', { hash });
    return r ? toSandbox(r) : null;
  }

  // ---------------------------------------------------------------- tasks

  insertTask(t: { id: string; projectId: string; kind: TaskKind; prompt: string; origin: Origin; budgetTokens: number; branch: string | null; baseBranch?: string | null; enginePref?: string | null; sessionId?: string | null; track?: TaskTrack; createdAt: number }): Task {
    this.#run(
      `INSERT INTO tasks (id, project_id, kind, prompt, origin, state, branch, base_branch, engine_pref, session_id, track, budget_tokens, created_at)
       VALUES (:id, :projectId, :kind, :prompt, :origin, 'queued', :branch, :baseBranch, :enginePref, :sessionId, :track, :budgetTokens, :createdAt)`,
      { ...t, baseBranch: t.baseBranch ?? null, enginePref: t.enginePref ?? null, sessionId: t.sessionId ?? null, track: t.track ?? 'full' },
    );
    return this.getTask(t.id)!;
  }

  getTask(id: string): Task | null {
    const r = this.#get('SELECT * FROM tasks WHERE id = :id', { id });
    return r ? toTask(r) : null;
  }

  listTasks(projectId: string | undefined, limit: number): Task[] {
    return projectId === undefined
      ? this.#all('SELECT * FROM tasks ORDER BY created_at DESC LIMIT :limit', { limit }).map(toTask)
      : this.#all('SELECT * FROM tasks WHERE project_id = :projectId ORDER BY created_at DESC LIMIT :limit', { projectId, limit }).map(toTask);
  }

  countTasks(): { queued: number; running: number } {
    const r = this.#get(
      `SELECT COALESCE(SUM(state = 'queued'), 0) AS queued, COALESCE(SUM(state IN ('running', 'awaiting_approval')), 0) AS running FROM tasks`,
    )!;
    return { queued: num(r.queued), running: num(r.running) };
  }

  /**
   * Atomically claims the oldest queued task whose project has nothing in flight. One task per project at a time:
   * the workspace volume is shared mutable state.
   */
  claimNextTask(now: number): Task | null {
    return this.tx(() => {
      const r = this.#get(
        `SELECT id FROM tasks t WHERE state = 'queued'
           AND NOT EXISTS (SELECT 1 FROM tasks r WHERE r.project_id = t.project_id AND r.state IN ('running', 'awaiting_approval'))
         ORDER BY created_at LIMIT 1`,
      );
      if (!r) return null;
      this.#run(`UPDATE tasks SET state = 'running', attempt = attempt + 1, started_at = COALESCE(started_at, :now) WHERE id = :id`, { id: str(r.id), now });
      return this.getTask(str(r.id));
    });
  }

  /** After a crash nothing is really running. Re-queue interrupted tasks once; fail the ones that already used their retry. */
  recoverInterruptedTasks(now: number, maxAttempts: number): { requeued: string[]; failed: string[] } {
    return this.tx(() => {
      const rows = this.#all(`SELECT id, attempt FROM tasks WHERE state IN ('running', 'awaiting_approval')`);
      const requeued: string[] = [];
      const failed: string[] = [];
      for (const r of rows) {
        if (num(r.attempt) < maxAttempts) {
          this.#run(`UPDATE tasks SET state = 'queued', phase = NULL WHERE id = :id`, { id: str(r.id) });
          requeued.push(str(r.id));
        } else {
          this.#run(`UPDATE tasks SET state = 'failed', error = 'daemon restarted during execution', finished_at = :now WHERE id = :id`, { id: str(r.id), now });
          failed.push(str(r.id));
        }
      }
      return { requeued, failed };
    });
  }

  updateTask(
    id: string,
    patch: Partial<{
      state: TaskState;
      phase: Phase | null;
      engine: string;
      model: string;
      branch: string;
      baseCheckpointId: string;
      summary: string;
      error: string | null;
      finishedAt: number;
    }>,
  ): Task {
    const columns: Record<string, string> = {
      state: 'state',
      phase: 'phase',
      engine: 'engine',
      model: 'model',
      branch: 'branch',
      baseCheckpointId: 'base_checkpoint_id',
      summary: 'summary',
      error: 'error',
      finishedAt: 'finished_at',
    };
    const sets: string[] = [];
    const params: Row = { id };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      sets.push(`${columns[key]!} = :${key}`);
      params[key] = value;
    }
    if (sets.length > 0) this.#run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = :id`, params);
    const task = this.getTask(id);
    if (!task) throw new Error(`task ${id} not found`);
    return task;
  }

  extendTaskBudget(id: string, addTokens: number): void {
    this.#run('UPDATE tasks SET budget_tokens = budget_tokens + :addTokens WHERE id = :id', { id, addTokens });
  }

  /** Tasks whose work is done and whose remaining checks are waiting on something outside the task. Oldest first. */
  listSuspendedTasks(): Task[] {
    return this.#all(`SELECT * FROM tasks WHERE state = 'suspended' ORDER BY created_at`).map(toTask);
  }

  /** Puts a suspended task back in the queue. A resume is not a retry after a crash, so the attempt count starts over. */
  resumeTask(id: string): Task | null {
    return this.#run(`UPDATE tasks SET state = 'queued', attempt = 0 WHERE id = :id AND state = 'suspended'`, { id }) > 0 ? this.getTask(id) : null;
  }

  requestCancel(id: string): void {
    this.#run('UPDATE tasks SET cancel_requested = 1 WHERE id = :id', { id });
  }

  isCancelRequested(id: string): boolean {
    return num(this.#get('SELECT cancel_requested AS c FROM tasks WHERE id = :id', { id })?.c) === 1;
  }

  // --------------------------------------------------------------- events

  appendEvent(e: { at: number; projectId: string | null; taskId: string | null; body: EventBody }): EventEnvelope {
    const info = this.#stmt('INSERT INTO events (at, project_id, task_id, type, body_json) VALUES (:at, :projectId, :taskId, :type, :body)').run({
      at: e.at,
      projectId: e.projectId,
      taskId: e.taskId,
      type: e.body.type,
      body: JSON.stringify(e.body),
    });
    return { seq: Number(info.lastInsertRowid), at: e.at, projectId: e.projectId, taskId: e.taskId, body: e.body };
  }

  listEvents(filter: EventFilter, sinceSeq: number, limit: number): EventEnvelope[] {
    const where = ['seq > :sinceSeq'];
    const params: Row = { sinceSeq, limit };
    if (filter.taskId !== undefined) {
      where.push('task_id = :taskId');
      params.taskId = filter.taskId;
    }
    if (filter.projectId !== undefined) {
      where.push('project_id = :projectId');
      params.projectId = filter.projectId;
    }
    return this.#all(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY seq LIMIT :limit`, params).map((r) => ({
      seq: num(r.seq),
      at: num(r.at),
      projectId: nstr(r.project_id),
      taskId: nstr(r.task_id),
      body: EventBody.parse(JSON.parse(str(r.body_json))),
    }));
  }

  headSeq(): number {
    return num(this.#get('SELECT COALESCE(MAX(seq), 0) AS s FROM events')!.s);
  }

  // ------------------------------------------------------------ approvals

  insertApproval(a: ApprovalRow): void {
    this.#run(
      `INSERT INTO approvals (id, project_id, task_id, action_kind, action_hash, action_json, summary, state, requested_at, expires_at)
       VALUES (:id, :projectId, :taskId, :actionKind, :actionHash, :actionJson, :summary, :state, :requestedAt, :expiresAt)`,
      {
        id: a.id,
        projectId: a.projectId,
        taskId: a.taskId,
        actionKind: a.actionKind,
        actionHash: a.actionHash,
        actionJson: a.actionJson,
        summary: a.summary,
        state: a.state,
        requestedAt: a.requestedAt,
        expiresAt: a.expiresAt,
      },
    );
  }

  getApproval(id: string): ApprovalRow | null {
    const r = this.#get('SELECT * FROM approvals WHERE id = :id', { id });
    return r ? toApproval(r) : null;
  }

  listApprovals(state: ApprovalState | undefined): ApprovalRow[] {
    return state === undefined
      ? this.#all('SELECT * FROM approvals ORDER BY requested_at DESC LIMIT 200').map(toApproval)
      : this.#all('SELECT * FROM approvals WHERE state = :state ORDER BY requested_at DESC LIMIT 200', { state }).map(toApproval);
  }

  /** Moves a pending, unexpired approval to `approved` or `denied`. Returns null when it is no longer resolvable. */
  resolveApproval(id: string, state: 'approved' | 'denied', via: Origin, now: number): ApprovalRow | null {
    const changed = this.#run(
      `UPDATE approvals SET state = :state, resolved_at = :now, resolved_via = :via WHERE id = :id AND state = 'pending' AND expires_at > :now`,
      { id, state, via, now },
    );
    return changed === 1 ? this.getApproval(id) : null;
  }

  /** Single-use: an approved grant flips to `consumed` exactly once. */
  consumeApproval(id: string, actionHash: string, now: number): boolean {
    return (
      this.#run(`UPDATE approvals SET state = 'consumed' WHERE id = :id AND action_hash = :actionHash AND state = 'approved' AND expires_at > :now`, {
        id,
        actionHash,
        now,
      }) === 1
    );
  }

  /** An approved-but-unused grant for the same action and task (e.g. the daemon restarted between approve and execute). */
  findUsableApproval(actionHash: string, taskId: string | null, now: number): ApprovalRow | null {
    const r = this.#get(
      `SELECT * FROM approvals WHERE action_hash = :actionHash AND task_id IS :taskId AND state IN ('approved', 'pending') AND expires_at > :now
       ORDER BY requested_at DESC LIMIT 1`,
      { actionHash, taskId, now },
    );
    return r ? toApproval(r) : null;
  }

  expireApprovals(now: number): ApprovalRow[] {
    const due = this.#all(`SELECT * FROM approvals WHERE state = 'pending' AND expires_at <= :now`, { now }).map(toApproval);
    if (due.length > 0) this.#run(`UPDATE approvals SET state = 'expired', resolved_at = :now WHERE state = 'pending' AND expires_at <= :now`, { now });
    return due.map((a) => ({ ...a, state: 'expired' as const, resolvedAt: now }));
  }

  insertPolicyDecision(d: { at: number; actor: string; actionKind: string; actionHash: string; projectId: string | null; taskId: string | null; effect: string; rule: string; reason: string }): void {
    this.#run(
      `INSERT INTO policy_decisions (at, actor, action_kind, action_hash, project_id, task_id, effect, rule, reason)
       VALUES (:at, :actor, :actionKind, :actionHash, :projectId, :taskId, :effect, :rule, :reason)`,
      { ...d },
    );
  }

  // ---------------------------------------------------------------- usage

  addUsage(u: UsageEntry, now: number): void {
    this.tx(() => {
      this.#run(
        `INSERT INTO usage_ledger (at, project_id, task_id, source, model, input_tokens, output_tokens, usd_micros)
         VALUES (:now, :projectId, :taskId, :source, :model, :inputTokens, :outputTokens, :usdMicros)`,
        { ...u, now },
      );
      if (u.taskId !== null) {
        this.#run('UPDATE tasks SET spent_tokens = spent_tokens + :tokens, spent_usd_micros = spent_usd_micros + :usd WHERE id = :id', {
          id: u.taskId,
          tokens: u.inputTokens + u.outputTokens,
          usd: u.usdMicros,
        });
      }
    });
  }

  projectTokensSince(projectId: string, since: number): number {
    return num(this.#get('SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS t FROM usage_ledger WHERE project_id = :projectId AND at >= :since', { projectId, since })!.t);
  }

  // ---------------------------------------------------------- checkpoints

  insertCheckpoint(c: CheckpointRow): void {
    this.#run(
      `INSERT INTO checkpoints (id, project_id, task_id, label, commit_sha, head_sha, branch, created_at)
       VALUES (:id, :projectId, :taskId, :label, :commit, :headSha, :branch, :createdAt)`,
      { ...c },
    );
  }

  getCheckpoint(id: string): CheckpointRow | null {
    const r = this.#get('SELECT * FROM checkpoints WHERE id = :id', { id });
    return r ? toCheckpoint(r) : null;
  }

  listCheckpoints(projectId: string): CheckpointRow[] {
    return this.#all('SELECT * FROM checkpoints WHERE project_id = :projectId ORDER BY created_at DESC LIMIT 200', { projectId }).map(toCheckpoint);
  }

  // --------------------------------------------------- audits & artifacts

  insertAudit(report: AuditReport): void {
    this.#run(
      'INSERT INTO audits (id, project_id, task_id, score, passed, report_json, created_at) VALUES (:id, :projectId, :taskId, :score, :passed, :json, :createdAt)',
      { id: report.id, projectId: report.projectId, taskId: report.taskId, score: report.score, passed: report.passed ? 1 : 0, json: JSON.stringify(report), createdAt: report.createdAt },
    );
  }

  getAudit(id: string): AuditReport | null {
    const r = this.#get('SELECT report_json FROM audits WHERE id = :id', { id });
    if (!r) return null;
    const stored = JSON.parse(str(r.report_json)) as Record<string, unknown>;
    if ('visionReviewed' in stored) return AuditReport.parse(stored);
    // A report written before design-review coverage was tracked says only whether a rubric came back. One
    // without a rubric was scored on measurements alone and may say "100, passed". It is read back the way
    // such an audit is reported now: unreviewed, capped, not passed. The row itself is left as it was written.
    const reviewed = stored.rubric !== null && stored.rubric !== undefined;
    const legacy = {
      visionReviewed: reviewed,
      vision: { status: reviewed ? 'reviewed' : 'failed', via: null, model: null, limited: false, reviewed: 0, expected: 0, reason: reviewed ? null : 'this audit was recorded without a design review' },
      slopScore: null,
      archetype: null,
      critique: null,
      grade: null,
      redesignPatches: [],
    };
    const verdict = reviewed ? {} : { score: Math.min(Number(stored.score), UNREVIEWED_SCORE_CAP), passed: false };
    return AuditReport.parse({ ...stored, ...legacy, ...verdict });
  }

  listAudits(projectId: string, limit: number): Pick<AuditReport, 'id' | 'taskId' | 'createdAt' | 'score' | 'passed'>[] {
    return this.#all('SELECT id, task_id, created_at, score, passed FROM audits WHERE project_id = :projectId ORDER BY created_at DESC LIMIT :limit', { projectId, limit }).map((r) => ({
      id: str(r.id),
      taskId: nstr(r.task_id),
      createdAt: num(r.created_at),
      score: num(r.score),
      passed: num(r.passed) === 1,
    }));
  }

  insertArtifact(a: { id: string; projectId: string; mime: string; file: string; createdAt: number }): void {
    this.#run('INSERT INTO artifacts (id, project_id, mime, file, created_at) VALUES (:id, :projectId, :mime, :file, :createdAt)', { ...a });
  }

  getArtifact(id: string): { id: string; projectId: string; mime: string; file: string } | null {
    const r = this.#get('SELECT * FROM artifacts WHERE id = :id', { id });
    return r ? { id: str(r.id), projectId: str(r.project_id), mime: str(r.mime), file: str(r.file) } : null;
  }

  // -------------------------------------------------------------- lessons

  insertLesson(l: Lesson, evidence: LessonEvidence[]): void {
    this.#run(
      `INSERT INTO lessons (id, scope, project_id, kind, title, trigger, guidance, state, confirmations, harms, origin_task_id, evidence_json, created_at, updated_at)
       VALUES (:id, :scope, :projectId, :kind, :title, :trigger, :guidance, :state, :confirmations, :harms, :originTaskId, :evidence, :createdAt, :updatedAt)`,
      { ...l, evidence: JSON.stringify(evidence) },
    );
  }

  getLesson(id: string): Lesson | null {
    const r = this.#get('SELECT * FROM lessons WHERE id = :id', { id });
    return r ? toLesson(r) : null;
  }

  /** Lessons visible to a project: its own plus global ones. `projectId` undefined lists everything. */
  listLessons(projectId: string | undefined, state: LessonState | undefined): Lesson[] {
    const where: string[] = [];
    const params: Row = {};
    if (projectId !== undefined) {
      where.push(`(scope = 'global' OR project_id = :projectId)`);
      params.projectId = projectId;
    }
    if (state !== undefined) {
      where.push('state = :state');
      params.state = state;
    }
    return this.#all(`SELECT * FROM lessons ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at`, params).map(toLesson);
  }

  setLessonState(id: string, state: LessonState, now: number): Lesson | null {
    this.#run('UPDATE lessons SET state = :state, updated_at = :now WHERE id = :id', { id, state, now });
    return this.getLesson(id);
  }

  /** Adds supporting evidence from another task. Evidence from a task already counted is ignored. */
  confirmLesson(id: string, evidence: LessonEvidence, now: number): Lesson | null {
    return this.tx(() => {
      const r = this.#get('SELECT evidence_json FROM lessons WHERE id = :id', { id });
      if (!r) return null;
      const all = JSON.parse(str(r.evidence_json)) as LessonEvidence[];
      if (!all.some((e) => e.taskId === evidence.taskId)) {
        all.push(evidence);
        this.#run('UPDATE lessons SET confirmations = confirmations + 1, evidence_json = :json, updated_at = :now WHERE id = :id', { id, json: JSON.stringify(all), now });
      }
      return this.getLesson(id);
    });
  }

  harmLesson(id: string, now: number): Lesson | null {
    this.#run('UPDATE lessons SET harms = harms + 1, updated_at = :now WHERE id = :id', { id, now });
    return this.getLesson(id);
  }

  // ---------------------------------------------------------------- evals

  /** Inserts an eval; an existing eval with the same name is left untouched (evals are never silently weakened). */
  insertEvalIfAbsent(e: Eval): boolean {
    return (
      this.#run(
        `INSERT INTO evals (id, project_id, name, spec_json, enabled, origin_task_id, created_at)
         VALUES (:id, :projectId, :name, :spec, :enabled, :originTaskId, :createdAt) ON CONFLICT (project_id, name) DO NOTHING`,
        { id: e.id, projectId: e.projectId, name: e.name, spec: JSON.stringify(e.spec), enabled: e.enabled ? 1 : 0, originTaskId: e.originTaskId, createdAt: e.createdAt },
      ) === 1
    );
  }

  getEval(id: string): Eval | null {
    const r = this.#get('SELECT * FROM evals WHERE id = :id', { id });
    return r ? toEval(r) : null;
  }

  listEvals(projectId: string): Eval[] {
    return this.#all('SELECT * FROM evals WHERE project_id = :projectId ORDER BY created_at', { projectId }).map(toEval);
  }

  setEvalEnabled(id: string, enabled: boolean): Eval | null {
    this.#run('UPDATE evals SET enabled = :enabled WHERE id = :id', { id, enabled: enabled ? 1 : 0 });
    return this.getEval(id);
  }

  insertEvalRun(r: { evalId: string; taskId: string | null; passed: boolean; durationMs: number; detail: string; createdAt: number }): void {
    this.#run('INSERT INTO eval_runs (eval_id, task_id, passed, duration_ms, detail, created_at) VALUES (:evalId, :taskId, :passed, :durationMs, :detail, :createdAt)', {
      ...r,
      passed: r.passed ? 1 : 0,
    });
  }

  // ---------------------------------------------------------------- kirby

  insertIngest(i: { id: string; projectId: string; repoUrl: string; createdAt: number }): void {
    this.#run(`INSERT INTO kirby_ingests (id, project_id, repo_url, state, created_at) VALUES (:id, :projectId, :repoUrl, 'running', :createdAt)`, { ...i });
  }

  finishIngest(id: string, result: { commit: string; profileJson: string } | { error: string }): void {
    if ('error' in result) this.#run(`UPDATE kirby_ingests SET state = 'failed', error = :error WHERE id = :id`, { id, error: result.error });
    else this.#run(`UPDATE kirby_ingests SET state = 'done', commit_sha = :commit, profile_json = :profileJson WHERE id = :id`, { id, ...result });
  }

  getIngest(id: string): IngestRow | null {
    const r = this.#get('SELECT * FROM kirby_ingests WHERE id = :id', { id });
    if (!r) return null;
    return {
      id: str(r.id),
      projectId: str(r.project_id),
      repoUrl: str(r.repo_url),
      commit: nstr(r.commit_sha),
      state: str(r.state) as IngestRow['state'],
      profileJson: nstr(r.profile_json),
      error: nstr(r.error),
    };
  }

  insertProposal(card: ProposalCard, brief: string): void {
    this.#run(
      'INSERT INTO kirby_proposals (id, project_id, ingest_id, state, card_json, brief, created_at) VALUES (:id, :projectId, :ingestId, :state, :json, :brief, :createdAt)',
      { id: card.id, projectId: card.projectId, ingestId: card.ingestId, state: card.state, json: JSON.stringify(card), brief, createdAt: card.createdAt },
    );
  }

  getProposal(id: string): ProposalRow | null {
    const r = this.#get('SELECT card_json, brief FROM kirby_proposals WHERE id = :id', { id });
    return r ? { card: ProposalCard.parse(JSON.parse(str(r.card_json))), brief: str(r.brief) } : null;
  }

  getProposalByBranch(projectId: string, branch: string): ProposalRow | null {
    return this.listProposalRows(projectId).find((p) => p.card.branch === branch) ?? null;
  }

  listProposalRows(projectId: string): ProposalRow[] {
    return this.#all('SELECT card_json, brief FROM kirby_proposals WHERE project_id = :projectId ORDER BY created_at DESC', { projectId }).map((r) => ({
      card: ProposalCard.parse(JSON.parse(str(r.card_json))),
      brief: str(r.brief),
    }));
  }

  updateProposal(id: string, patch: Partial<Omit<ProposalCard, 'id'>> & { state?: ProposalState }): ProposalCard {
    return this.tx(() => {
      const row = this.getProposal(id);
      if (!row) throw new Error(`proposal ${id} not found`);
      const card = ProposalCard.parse({ ...row.card, ...patch });
      this.#run('UPDATE kirby_proposals SET state = :state, card_json = :json WHERE id = :id', { id, state: card.state, json: JSON.stringify(card) });
      return card;
    });
  }

  // ------------------------------------------- credentials / relay / kv

  upsertCredential(id: string, now: number): CredentialMeta {
    this.#run('INSERT INTO credentials (id, created_at, updated_at) VALUES (:id, :now, :now) ON CONFLICT (id) DO UPDATE SET updated_at = :now', { id, now });
    const r = this.#get('SELECT * FROM credentials WHERE id = :id', { id })!;
    return { id: str(r.id), createdAt: num(r.created_at), updatedAt: num(r.updated_at) };
  }

  deleteCredential(id: string): boolean {
    return this.#run('DELETE FROM credentials WHERE id = :id', { id }) === 1;
  }

  // ------------------------------------------------------- tool servers

  /** Catalog rows follow the code: a changed address replaces the stored one, and what was allowed on the old address goes with it. */
  upsertBuiltinMcpServer(s: Pick<McpServerRow, 'id' | 'name' | 'url' | 'auth' | 'about'>, now: number): void {
    const existing = this.getMcpServer(s.id);
    if (existing && existing.url !== s.url) this.#run('DELETE FROM mcp_grants WHERE server_id = :id', { id: s.id });
    this.#run(
      `INSERT INTO mcp_servers (id, name, url, auth, about, builtin, added_at) VALUES (:id, :name, :url, :auth, :about, 1, :now)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, url = excluded.url, auth = excluded.auth, about = excluded.about, builtin = 1`,
      { id: s.id, name: s.name, url: s.url, auth: s.auth, about: s.about, now },
    );
  }

  insertMcpServer(s: McpServerRow): void {
    this.#run(
      'INSERT INTO mcp_servers (id, name, transport, url, command, args_json, token_env, auth, about, builtin, added_at) VALUES (:id, :name, :transport, :url, :command, :argsJson, :tokenEnv, :auth, :about, :builtin, :addedAt)',
      { id: s.id, name: s.name, transport: s.transport, url: s.url, command: s.command, argsJson: JSON.stringify(s.args), tokenEnv: s.tokenEnv, auth: s.auth, about: s.about, builtin: s.builtin ? 1 : 0, addedAt: s.addedAt },
    );
  }

  getMcpServer(id: string): McpServerRow | null {
    const r = this.#all('SELECT * FROM mcp_servers WHERE id = :id', { id })[0];
    return r ? mcpServerRow(r) : null;
  }

  listMcpServers(): McpServerRow[] {
    return this.#all('SELECT * FROM mcp_servers ORDER BY builtin DESC, id').map(mcpServerRow);
  }

  deleteMcpServer(id: string): void {
    this.#run('DELETE FROM mcp_servers WHERE id = :id AND builtin = 0', { id });
  }

  hasMcpGrant(projectId: string, serverId: string, tool: string): boolean {
    return this.#all('SELECT 1 AS x FROM mcp_grants WHERE project_id = :projectId AND server_id = :serverId AND tool = :tool', { projectId, serverId, tool }).length > 0;
  }

  grantMcpTool(projectId: string, serverId: string, tool: string, now: number): void {
    this.#run('INSERT INTO mcp_grants (project_id, server_id, tool, granted_at) VALUES (:projectId, :serverId, :tool, :now) ON CONFLICT DO NOTHING', { projectId, serverId, tool, now });
  }

  listMcpGrants(serverId: string): { projectId: string; tool: string }[] {
    return this.#all('SELECT project_id, tool FROM mcp_grants WHERE server_id = :serverId ORDER BY project_id, tool', { serverId }).map((r) => ({ projectId: str(r.project_id), tool: str(r.tool) }));
  }

  revokeMcpGrants(serverId: string, projectId: string): number {
    const n = this.listMcpGrants(serverId).filter((g) => g.projectId === projectId).length;
    this.#run('DELETE FROM mcp_grants WHERE server_id = :serverId AND project_id = :projectId', { serverId, projectId });
    return n;
  }

  hasCredential(id: string): boolean {
    return this.#get('SELECT 1 AS x FROM credentials WHERE id = :id', { id }) !== undefined;
  }

  listCredentials(): CredentialMeta[] {
    return this.#all('SELECT * FROM credentials ORDER BY id').map((r) => ({ id: str(r.id), createdAt: num(r.created_at), updatedAt: num(r.updated_at) }));
  }

  getChat(channel: string, chatId: string): { activeProjectId: string | null; refineTaskId: string | null } {
    const r = this.#get('SELECT * FROM relay_chats WHERE channel = :channel AND chat_id = :chatId', { channel, chatId });
    return { activeProjectId: nstr(r?.active_project_id), refineTaskId: nstr(r?.refine_task_id) };
  }

  setChat(channel: string, chatId: string, patch: { activeProjectId?: string | null; refineTaskId?: string | null }): void {
    const cur = this.getChat(channel, chatId);
    const next = { ...cur, ...patch };
    this.#run(
      `INSERT INTO relay_chats (channel, chat_id, active_project_id, refine_task_id) VALUES (:channel, :chatId, :activeProjectId, :refineTaskId)
       ON CONFLICT (channel, chat_id) DO UPDATE SET active_project_id = excluded.active_project_id, refine_task_id = excluded.refine_task_id`,
      { channel, chatId, activeProjectId: next.activeProjectId, refineTaskId: next.refineTaskId },
    );
  }

  listChats(channel: string): { chatId: string; activeProjectId: string | null }[] {
    return this.#all('SELECT chat_id, active_project_id FROM relay_chats WHERE channel = :channel', { channel }).map((r) => ({
      chatId: str(r.chat_id),
      activeProjectId: nstr(r.active_project_id),
    }));
  }

  // ----------------------------------------------------------- scratchpads

  insertScratchpad(s: Scratchpad): void {
    this.#run('INSERT INTO scratchpads (id, title, mode, state, project_id, created_at, updated_at) VALUES (:id, :title, :mode, :state, :projectId, :createdAt, :updatedAt)', { ...s });
  }

  getScratchpad(id: string): Scratchpad | null {
    const r = this.#get('SELECT * FROM scratchpads WHERE id = :id', { id });
    return r ? toScratchpad(r) : null;
  }

  listScratchpads(): Scratchpad[] {
    return this.#all(`SELECT * FROM scratchpads WHERE state <> 'archived' ORDER BY updated_at DESC LIMIT 200`).map(toScratchpad);
  }

  updateScratchpad(id: string, patch: Partial<{ title: string; state: ScratchState; projectId: string }>, now: number): Scratchpad {
    const cur = this.getScratchpad(id);
    if (!cur) throw new Error(`scratchpad ${id} not found`);
    const next = { ...cur, ...patch, updatedAt: now };
    this.#run('UPDATE scratchpads SET title = :title, state = :state, project_id = :projectId, updated_at = :updatedAt WHERE id = :id', { ...next });
    return next;
  }

  appendScratchEntry(e: Omit<ScratchEntry, 'seq'>): ScratchEntry {
    const info = this.#stmt('INSERT INTO scratch_entries (scratch_id, at, author, text, response_json, blocks_json) VALUES (:scratchId, :at, :author, :text, :response, :blocks)').run({
      scratchId: e.scratchId,
      at: e.at,
      author: e.author,
      text: e.text,
      response: e.response ? JSON.stringify(e.response) : null,
      blocks: JSON.stringify(e.blocks),
    });
    this.#run('UPDATE scratchpads SET updated_at = :at WHERE id = :scratchId', { at: e.at, scratchId: e.scratchId });
    return { ...e, seq: Number(info.lastInsertRowid) };
  }

  listScratchEntries(scratchId: string): ScratchEntry[] {
    return this.#all('SELECT * FROM scratch_entries WHERE scratch_id = :scratchId ORDER BY seq', { scratchId }).map((r) => ({
      seq: num(r.seq),
      scratchId: str(r.scratch_id),
      at: num(r.at),
      author: str(r.author) as ScratchEntry['author'],
      text: nstr(r.text),
      response: r.response_json == null ? null : AxResponse.parse(JSON.parse(str(r.response_json))),
      blocks: (JSON.parse(str(r.blocks_json)) as unknown[]).map((b) => AxBlock.parse(b)),
    }));
  }

  setSpecSection(scratchId: string, section: SpecSection, content: string, now: number): void {
    this.#run(
      `INSERT INTO scratch_spec (scratch_id, section, content, updated_at) VALUES (:scratchId, :section, :content, :now)
       ON CONFLICT (scratch_id, section) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
      { scratchId, section, content, now },
    );
  }

  getSpec(scratchId: string): Partial<Record<SpecSection, string>> {
    return Object.fromEntries(this.#all('SELECT section, content FROM scratch_spec WHERE scratch_id = :scratchId', { scratchId }).map((r) => [str(r.section), str(r.content)]));
  }

  insertDecision(d: DecisionRow): void {
    this.#run(
      `INSERT INTO decisions (id, scratch_id, question, chosen, why, rejected_json, confidence, decided_by, created_at)
       VALUES (:id, :scratchId, :question, :chosen, :why, :rejected, :confidence, :decidedBy, :createdAt)`,
      { ...d, rejected: JSON.stringify(d.rejected) },
    );
  }

  listDecisions(scratchId: string): DecisionRow[] {
    return this.#all('SELECT * FROM decisions WHERE scratch_id = :scratchId ORDER BY created_at, id', { scratchId }).map((r) => ({
      id: str(r.id),
      scratchId: str(r.scratch_id),
      question: str(r.question),
      chosen: str(r.chosen),
      why: str(r.why),
      rejected: JSON.parse(str(r.rejected_json)) as DecisionRow['rejected'],
      confidence: str(r.confidence) as Confidence,
      decidedBy: str(r.decided_by) as DecisionRow['decidedBy'],
      createdAt: num(r.created_at),
    }));
  }

  // ----------------------------------------------------------- calibration

  insertOutcome(confidence: Confidence, agreed: boolean, now: number): void {
    this.#run('INSERT INTO ax_outcomes (at, confidence, agreed) VALUES (:now, :confidence, :agreed)', { now, confidence, agreed: agreed ? 1 : 0 });
  }

  /** The most recent outcomes for one confidence level, newest first. */
  recentOutcomes(confidence: Confidence, limit: number): boolean[] {
    return this.#all('SELECT agreed FROM ax_outcomes WHERE confidence = :confidence ORDER BY id DESC LIMIT :limit', { confidence, limit }).map((r) => num(r.agreed) === 1);
  }

  outcomeTotals(): { confidence: Confidence; total: number; overridden: number }[] {
    return this.#all('SELECT confidence, COUNT(*) AS total, SUM(agreed = 0) AS overridden FROM ax_outcomes GROUP BY confidence').map((r) => ({
      confidence: str(r.confidence) as Confidence,
      total: num(r.total),
      overridden: num(r.overridden),
    }));
  }

  // ------------------------------------------------------------- knowledge

  insertKnowledgeJob(j: KnowledgeJob, input: unknown): void {
    this.#run(
      `INSERT INTO knowledge_jobs (id, kind, title, state, origin, scratch_id, input_json, created_at) VALUES (:id, :kind, :title, :state, :origin, :scratchId, :input, :createdAt)`,
      { id: j.id, kind: j.kind, title: j.title, state: j.state, origin: j.origin, scratchId: j.scratchId, input: JSON.stringify(input), createdAt: j.createdAt },
    );
  }

  getKnowledgeJob(id: string): KnowledgeRow | null {
    const r = this.#get('SELECT * FROM knowledge_jobs WHERE id = :id', { id });
    return r ? toKnowledge(r) : null;
  }

  listKnowledgeJobs(scratchId?: string): KnowledgeRow[] {
    return scratchId === undefined
      ? this.#all('SELECT * FROM knowledge_jobs ORDER BY created_at DESC LIMIT 100').map(toKnowledge)
      : this.#all('SELECT * FROM knowledge_jobs WHERE scratch_id = :scratchId ORDER BY created_at', { scratchId }).map(toKnowledge);
  }

  finishKnowledgeJob(id: string, result: { markdown: string; report: ResearchReport | null; lint: TextFinding[] } | { error: string }, now: number): void {
    if ('error' in result) this.#run(`UPDATE knowledge_jobs SET state = 'failed', error = :error, finished_at = :now WHERE id = :id`, { id, error: result.error, now });
    else {
      this.#run(`UPDATE knowledge_jobs SET state = 'succeeded', markdown = :markdown, report_json = :report, lint_json = :lint, finished_at = :now WHERE id = :id`, {
        id,
        markdown: result.markdown,
        report: result.report ? JSON.stringify(result.report) : null,
        lint: JSON.stringify(result.lint),
        now,
      });
    }
  }

  addKnowledgeTokens(id: string, tokens: number): void {
    this.#run('UPDATE knowledge_jobs SET spent_tokens = spent_tokens + :tokens WHERE id = :id', { id, tokens });
  }

  /** After a crash nothing is running: knowledge jobs do not resume, so they are marked failed. */
  failInterruptedKnowledgeJobs(now: number): void {
    this.#run(`UPDATE knowledge_jobs SET state = 'failed', error = 'daemon restarted during the job', finished_at = :now WHERE state = 'running'`, { now });
  }

  kvGet(key: string): string | null {
    return nstr(this.#get('SELECT value FROM kv WHERE key = :key', { key })?.value);
  }

  kvDelete(key: string): void {
    this.#run('DELETE FROM kv WHERE key = :key', { key });
  }

  kvSet(key: string, value: string): void {
    this.#run('INSERT INTO kv (key, value) VALUES (:key, :value) ON CONFLICT (key) DO UPDATE SET value = excluded.value', { key, value });
  }
}

function toScratchpad(r: Row): Scratchpad {
  return {
    id: str(r.id),
    title: str(r.title),
    mode: str(r.mode) as ScratchMode,
    state: str(r.state) as ScratchState,
    projectId: nstr(r.project_id),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function toKnowledge(r: Row): KnowledgeRow {
  return {
    job: {
      id: str(r.id),
      kind: str(r.kind) as KnowledgeJob['kind'],
      title: str(r.title),
      state: str(r.state) as KnowledgeJob['state'],
      origin: str(r.origin) as Origin,
      scratchId: nstr(r.scratch_id),
      error: nstr(r.error),
      spentTokens: num(r.spent_tokens),
      createdAt: num(r.created_at),
      finishedAt: nnum(r.finished_at),
    },
    input: JSON.parse(str(r.input_json)) as unknown,
    markdown: str(r.markdown),
    report: r.report_json == null ? null : ResearchReport.parse(JSON.parse(str(r.report_json))),
    lint: (JSON.parse(str(r.lint_json)) as unknown[]).map((f) => TextFinding.parse(f)),
  };
}

function toSession(r: Row): Session {
  return { id: str(r.id), projectId: str(r.project_id), name: str(r.name), createdAt: num(r.created_at) };
}

function toProject(r: Row): Project {
  return { id: str(r.id), slug: str(r.slug), name: str(r.name), template: str(r.template) as Template, createdAt: num(r.created_at) };
}

function toSandbox(r: Row): SandboxRow {
  return {
    projectId: str(r.project_id),
    container: str(r.container),
    volume: str(r.volume),
    network: str(r.network),
    image: str(r.image),
    gatewayTokenHash: str(r.gateway_token_hash),
  };
}

function toTask(r: Row): Task {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    kind: str(r.kind) as TaskKind,
    prompt: str(r.prompt),
    origin: str(r.origin) as Origin,
    state: str(r.state) as TaskState,
    phase: nstr(r.phase) as Phase | null,
    engine: nstr(r.engine),
    model: nstr(r.model),
    branch: nstr(r.branch),
    budgetTokens: num(r.budget_tokens),
    spentTokens: num(r.spent_tokens),
    spentUsdMicros: num(r.spent_usd_micros),
    baseCheckpointId: nstr(r.base_checkpoint_id),
    baseBranch: nstr(r.base_branch),
    enginePref: nstr(r.engine_pref),
    sessionId: nstr(r.session_id),
    track: str(r.track) as TaskTrack,
    summary: nstr(r.summary),
    error: nstr(r.error),
    createdAt: num(r.created_at),
    startedAt: nnum(r.started_at),
    finishedAt: nnum(r.finished_at),
  };
}

function toApproval(r: Row): ApprovalRow {
  return {
    id: str(r.id),
    projectId: nstr(r.project_id),
    taskId: nstr(r.task_id),
    actionKind: str(r.action_kind),
    actionHash: str(r.action_hash),
    actionJson: str(r.action_json),
    summary: str(r.summary),
    state: str(r.state) as ApprovalState,
    requestedAt: num(r.requested_at),
    expiresAt: num(r.expires_at),
    resolvedAt: nnum(r.resolved_at),
    resolvedVia: nstr(r.resolved_via) as Origin | null,
  };
}

function toCheckpoint(r: Row): CheckpointRow {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    taskId: nstr(r.task_id),
    label: str(r.label),
    commit: str(r.commit_sha),
    headSha: str(r.head_sha),
    branch: str(r.branch),
    createdAt: num(r.created_at),
  };
}

function toLesson(r: Row): Lesson {
  return {
    id: str(r.id),
    scope: str(r.scope) as Lesson['scope'],
    projectId: nstr(r.project_id),
    kind: str(r.kind) as Lesson['kind'],
    title: str(r.title),
    trigger: str(r.trigger),
    guidance: str(r.guidance),
    state: str(r.state) as LessonState,
    confirmations: num(r.confirmations),
    harms: num(r.harms),
    originTaskId: nstr(r.origin_task_id),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function toEval(r: Row): Eval {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    name: str(r.name),
    spec: EvalSpec.parse(JSON.parse(str(r.spec_json))),
    enabled: num(r.enabled) === 1,
    originTaskId: nstr(r.origin_task_id),
    createdAt: num(r.created_at),
  };
}

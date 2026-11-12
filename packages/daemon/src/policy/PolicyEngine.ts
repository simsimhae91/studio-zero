import { posix } from 'node:path';
import type { Approval, Origin } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { ApprovalRow, Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { destinationOf } from '../mcp/destination.ts';
import { canonicalJson, newId, sha256Hex, type Clock } from '../util/core.ts';
import { Action, actionProjectId, actorLabel, describeAction, type Actor } from './actions.ts';

export const WORKSPACE_DIR = '/workspace';

export type Decision = { effect: 'allow'; rule: string; reason: string } | { effect: 'deny'; rule: string; reason: string } | { effect: 'require_approval'; rule: string; reason: string };

export class PolicyDeniedError extends Error {
  readonly rule: string;
  constructor(rule: string, reason: string) {
    super(`denied by policy (${rule}): ${reason}`);
    this.name = 'PolicyDeniedError';
    this.rule = rule;
  }
}

export class ApprovalDeniedError extends Error {
  readonly approvalId: string;
  constructor(approvalId: string, state: string) {
    super(`approval ${approvalId} was ${state}`);
    this.name = 'ApprovalDeniedError';
    this.approvalId = approvalId;
  }
}

interface Facts {
  store: Store;
  config: Config;
  now: number;
}

type Rule = { id: string; evaluate: (actor: Actor, action: Action, facts: Facts) => Omit<Decision, 'rule'> | undefined };

const allow = (reason: string): Omit<Decision, 'rule'> => ({ effect: 'allow', reason });
const deny = (reason: string): Omit<Decision, 'rule'> => ({ effect: 'deny', reason });
const ask = (reason: string): Omit<Decision, 'rule'> => ({ effect: 'require_approval', reason });

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The rule table. Ordered; the first rule that returns a decision wins; no match means deny.
 *
 * None of this consults a model. Rules read the typed action, the actor the transport established, and facts
 * from the database. A fully prompt-injected agent can therefore do exactly what this table lets an `agent` do.
 */
const rules: Rule[] = [
  {
    id: 'project.must-exist',
    evaluate: (_actor, action, { store }) => {
      const projectId = actionProjectId(action);
      return projectId !== null && store.getProject(projectId) === null ? deny(`unknown project ${projectId}`) : undefined;
    },
  },
  {
    id: 'budget.task',
    evaluate: (_actor, action, { store }) => {
      if (action.kind !== 'llm.request' || action.taskId === null) return undefined;
      const task = store.getTask(action.taskId);
      if (!task) return deny(`unknown task ${action.taskId}`);
      return task.spentTokens >= task.budgetTokens ? deny(`task budget exhausted (${task.spentTokens}/${task.budgetTokens} tokens)`) : undefined;
    },
  },
  {
    id: 'budget.project-daily',
    evaluate: (_actor, action, { store, config, now }) => {
      if (action.kind !== 'llm.request') return undefined;
      const used = store.projectTokensSince(action.projectId, now - DAY_MS);
      return used >= config.budgets.projectDailyTokens ? deny(`project daily budget exhausted (${used}/${config.budgets.projectDailyTokens} tokens in 24h)`) : allow('within task and project budgets');
    },
  },
  {
    // Secrets enter through the local control socket only. Not chat (it would transit Telegram), never an agent.
    id: 'vault.local-owner-only',
    evaluate: (actor, action) => {
      if (action.kind !== 'vault.write' && action.kind !== 'vault.delete') return undefined;
      return actor.type === 'owner' && actor.via === 'desktop' ? allow('owner on the control socket') : deny('credentials can only be managed from an authenticated desktop client');
    },
  },
  {
    id: 'mcp.configure-local-owner-only',
    evaluate: (actor, action) => {
      if (action.kind !== 'mcp.configure') return undefined;
      return actor.type === 'owner' && actor.via === 'desktop' ? allow('owner on the control socket') : deny('tool servers can only be managed from an authenticated desktop client');
    },
  },
  {
    // A call to an outside service is an effect no container holds in. An agent gets a tool there only after the
    // owner allowed that tool for that project, and the allowance is a database row, not a sentence in a prompt.
    id: 'mcp.call',
    evaluate: (actor, action, { store }) => {
      if (action.kind === 'mcp.search') return allow('listing tools changes nothing');
      if (action.kind !== 'mcp.call') return undefined;
      const server = store.getMcpServer(action.serverId);
      if (!server) return deny(`unknown tool server ${action.serverId}`);
      if (destinationOf(server) !== action.host) return deny('the tool server is not the one this call was prepared for');
      if (actor.type === 'owner') return allow('owner-initiated');
      return store.hasMcpGrant(action.projectId, action.serverId, action.tool) ? allow('the owner allowed this tool for this project') : ask('first use of this external tool in this project');
    },
  },
  {
    // Irreversible when the workspace goes with it: the desk only, like credentials.
    id: 'project.delete-local-owner-only',
    evaluate: (actor, action) => {
      if (action.kind !== 'project.delete') return undefined;
      return actor.type === 'owner' && actor.via === 'desktop' ? allow('owner on the control socket') : deny('projects can only be deleted from an authenticated desktop client');
    },
  },
  {
    id: 'sandbox.write-inside-workspace',
    evaluate: (_actor, action) => {
      if (action.kind !== 'sandbox.write') return undefined;
      const resolved = posix.resolve(WORKSPACE_DIR, action.path);
      return resolved === WORKSPACE_DIR || resolved.startsWith(`${WORKSPACE_DIR}/`) ? allow('path is inside the workspace') : deny(`path escapes ${WORKSPACE_DIR}`);
    },
  },
  {
    id: 'sandbox.exec-contained',
    evaluate: (_actor, action) => (action.kind === 'sandbox.exec' ? allow('runs inside the project container, which holds no credentials') : undefined),
  },
  {
    id: 'sandbox.lifecycle',
    evaluate: (actor, action) => {
      if (action.kind !== 'sandbox.lifecycle') return undefined;
      return actor.type === 'agent' ? deny('agents do not control sandbox lifecycle') : allow(`${actor.type} may ${action.op} the sandbox`);
    },
  },
  {
    id: 'task.submit',
    evaluate: (actor, action) => {
      if (action.kind !== 'task.submit') return undefined;
      return actor.type === 'agent' ? deny('agents cannot start tasks') : allow(`${actor.type} may start tasks`);
    },
  },
  {
    // Things only the owner starts, from any of their channels: redirecting a task, branching history,
    // turning a scratchpad into a project, starting research or a document.
    id: 'owner-initiated',
    evaluate: (actor, action) => {
      if (action.kind !== 'task.steer' && action.kind !== 'checkpoint.fork' && action.kind !== 'scratch.promote' && action.kind !== 'knowledge.run') return undefined;
      return actor.type === 'owner' ? allow('owner-initiated') : deny(`only the owner can ${action.kind}`);
    },
  },
  {
    // Spending more than was agreed is the owner's call. The harness asks; the agent never can.
    id: 'task.extend-budget',
    evaluate: (actor, action) => {
      if (action.kind !== 'task.extend-budget') return undefined;
      if (actor.type === 'agent') return deny('agents cannot raise their own budget');
      return actor.type === 'owner' ? allow('owner-granted') : ask('the task has used its token budget');
    },
  },
  {
    id: 'git.merge',
    evaluate: (actor, action, { config }) => {
      if (action.kind !== 'git.merge') return undefined;
      if (!config.approvals.protectedBranches.includes(action.into)) return allow(`"${action.into}" is not a protected branch`);
      return actor.type === 'owner' ? allow('owner merges into a protected branch') : ask(`"${action.into}" is protected`);
    },
  },
  {
    id: 'checkpoint.rollback',
    evaluate: (actor, action) => {
      if (action.kind !== 'checkpoint.rollback') return undefined;
      return actor.type === 'agent' ? ask('a rollback discards workspace changes') : allow(`${actor.type} may restore checkpoints`);
    },
  },
  {
    id: 'kirby.source-allowlist',
    evaluate: (_actor, action, { config }) => {
      if (action.kind !== 'kirby.ingest') return undefined;
      const check = parseRepoUrl(action.repoUrl, config.kirby.allowedHosts);
      return check.ok ? undefined : deny(check.reason);
    },
  },
  {
    id: 'kirby.owner-initiated',
    evaluate: (actor, action) => {
      if (action.kind !== 'kirby.ingest' && action.kind !== 'kirby.materialize') return undefined;
      return actor.type === 'owner' ? allow('owner-initiated') : ask('pulling in or applying third-party code needs the owner');
    },
  },
  {
    id: 'lesson.activate',
    evaluate: (actor, action, { store }) => {
      if (action.kind !== 'lesson.activate') return undefined;
      if (actor.type === 'owner') return allow('owner-activated');
      if (actor.type === 'agent') return deny('agents cannot change their own standing guidance');
      const lesson = store.getLesson(action.lessonId);
      if (!lesson) return deny(`unknown lesson ${action.lessonId}`);
      if (lesson.scope === 'global') return ask('global lessons affect every project');
      return lesson.confirmations >= 2 && lesson.harms === 0 ? allow('independently confirmed by two tasks with no recorded harm') : ask('not yet independently confirmed');
    },
  },
  {
    id: 'eval.disable',
    evaluate: (actor, action) => {
      if (action.kind !== 'eval.disable') return undefined;
      return actor.type === 'owner' ? allow('owner may disable a regression eval') : deny('only the owner can weaken the regression suite');
    },
  },
];

export function parseRepoUrl(raw: string, allowedHosts: readonly string[]): { ok: true; url: string; host: string; path: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'only https:// repositories are accepted' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'URLs with embedded credentials are rejected' };
  if (url.port !== '' || url.search !== '' || url.hash !== '') return { ok: false, reason: 'repository URL must not carry a port, query or fragment' };
  if (!allowedHosts.includes(url.hostname)) return { ok: false, reason: `host ${url.hostname} is not in kirby.allowedHosts` };
  if (!/^\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+){1,3}$/.test(url.pathname)) return { ok: false, reason: 'repository path must look like /owner/name' };
  return { ok: true, url: `https://${url.hostname}${url.pathname}`, host: url.hostname, path: url.pathname };
}

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
}

export interface AuthorizeContext {
  taskId?: string | null;
  signal?: AbortSignal;
  /** Invoked with `true` when the call starts waiting on a human and `false` when it stops. */
  onWaiting?: (waiting: boolean) => void;
}

export class PolicyEngine {
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #config: Config;
  readonly #clock: Clock;
  readonly #waiters = new Map<string, Waiter[]>();
  #sweeper: NodeJS.Timeout | null = null;

  constructor(deps: { store: Store; events: EventLog; config: Config; clock: Clock }) {
    this.#store = deps.store;
    this.#events = deps.events;
    this.#config = deps.config;
    this.#clock = deps.clock;
  }

  /** Starts the expiry sweep. Approvals also expire lazily on resolve, so the sweep only exists to wake waiters. */
  start(intervalMs = 5_000): void {
    this.#sweeper ??= setInterval(() => this.sweepExpired(), intervalMs);
    this.#sweeper.unref();
  }

  stop(): void {
    if (this.#sweeper) clearInterval(this.#sweeper);
    this.#sweeper = null;
    for (const [id, waiters] of this.#waiters) for (const w of waiters) w.reject(new ApprovalDeniedError(id, 'abandoned (daemon shutting down)'));
    this.#waiters.clear();
  }

  /** Pure decision: validates the action, runs the rule table, records the outcome. Never blocks. */
  evaluate(actor: Actor, rawAction: Action, taskId: string | null = null): Decision {
    const action = Action.parse(rawAction);
    const facts: Facts = { store: this.#store, config: this.#config, now: this.#clock() };
    let decision: Decision = { effect: 'deny', rule: 'default.fail-closed', reason: 'no rule allows this action' };
    for (const rule of rules) {
      const out = rule.evaluate(actor, action, facts);
      if (out) {
        decision = { ...out, rule: rule.id } as Decision;
        break;
      }
    }
    const projectId = actionProjectId(action);
    this.#store.insertPolicyDecision({
      at: facts.now,
      actor: actorLabel(actor),
      actionKind: action.kind,
      actionHash: hashAction(action),
      projectId,
      taskId,
      effect: decision.effect,
      rule: decision.rule,
      reason: decision.reason,
    });
    if (decision.effect !== 'allow') {
      this.#events.emit({ projectId, taskId }, { type: 'policy.decision', actionKind: action.kind, actor: actorLabel(actor), ...decision });
    }
    return decision;
  }

  /**
   * Gate in front of an executor. Returns when the action may proceed; throws `PolicyDeniedError` or
   * `ApprovalDeniedError` otherwise. When approval is required this waits for a human, and the grant is bound
   * to the hash of this exact action and consumed on use, so it cannot be replayed or applied to another action.
   */
  async authorize(actor: Actor, action: Action, ctx: AuthorizeContext = {}): Promise<void> {
    const taskId = ctx.taskId ?? (actor.type === 'agent' ? actor.taskId : null);
    const decision = this.evaluate(actor, action, taskId);
    if (decision.effect === 'allow') return;
    if (decision.effect === 'deny') throw new PolicyDeniedError(decision.rule, decision.reason);

    const actionHash = hashAction(action);
    const approval = this.#store.findUsableApproval(actionHash, taskId, this.#clock()) ?? this.#requestApproval(action, actionHash, taskId);
    if (approval.state === 'pending') {
      ctx.onWaiting?.(true);
      try {
        await this.#waitFor(approval.id, ctx.signal);
      } finally {
        ctx.onWaiting?.(false);
      }
    }
    if (!this.#store.consumeApproval(approval.id, actionHash, this.#clock())) {
      throw new ApprovalDeniedError(approval.id, this.#store.getApproval(approval.id)?.state ?? 'missing');
    }
    this.#events.emit({ projectId: approval.projectId, taskId }, { type: 'approval.resolved', approvalId: approval.id, state: 'consumed', via: null });
  }

  /** Called from an owner channel (control socket or allow-listed Telegram user). */
  resolveApproval(approvalId: string, decision: 'approve' | 'deny', via: Origin): Approval | null {
    const row = this.#store.resolveApproval(approvalId, decision === 'approve' ? 'approved' : 'denied', via, this.#clock());
    if (!row) return null;
    this.#events.emit({ projectId: row.projectId, taskId: row.taskId }, { type: 'approval.resolved', approvalId, state: row.state, via });
    this.#settle(approvalId, row.state === 'approved' ? null : new ApprovalDeniedError(approvalId, row.state));
    return toApproval(row);
  }

  sweepExpired(): void {
    for (const row of this.#store.expireApprovals(this.#clock())) {
      this.#events.emit({ projectId: row.projectId, taskId: row.taskId }, { type: 'approval.resolved', approvalId: row.id, state: 'expired', via: null });
      this.#settle(row.id, new ApprovalDeniedError(row.id, 'expired'));
    }
  }

  #requestApproval(action: Action, actionHash: string, taskId: string | null): ApprovalRow {
    const now = this.#clock();
    const row: ApprovalRow = {
      id: newId('apr'),
      projectId: actionProjectId(action),
      taskId,
      actionKind: action.kind,
      actionHash,
      actionJson: canonicalJson(action),
      summary: describeAction(action),
      state: 'pending',
      requestedAt: now,
      expiresAt: now + this.#config.approvals.ttlSec * 1000,
      resolvedAt: null,
      resolvedVia: null,
    };
    this.#store.insertApproval(row);
    this.#events.emit(
      { projectId: row.projectId, taskId },
      { type: 'approval.requested', approvalId: row.id, actionKind: row.actionKind, summary: row.summary, expiresAt: row.expiresAt },
    );
    return row;
  }

  #waitFor(approvalId: string, signal: AbortSignal | undefined): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => reject(signal!.reason instanceof Error ? signal!.reason : new Error('aborted'));
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const waiter: Waiter = {
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        reject: (err) => {
          signal?.removeEventListener('abort', onAbort);
          reject(err);
        },
      };
      const list = this.#waiters.get(approvalId) ?? [];
      list.push(waiter);
      this.#waiters.set(approvalId, list);
    });
  }

  #settle(approvalId: string, err: Error | null): void {
    const waiters = this.#waiters.get(approvalId) ?? [];
    this.#waiters.delete(approvalId);
    for (const w of waiters) err ? w.reject(err) : w.resolve();
  }
}

export function hashAction(action: Action): string {
  return sha256Hex(canonicalJson(action));
}

export function toApproval(row: ApprovalRow): Approval {
  const { actionJson: _actionJson, ...approval } = row;
  return approval;
}

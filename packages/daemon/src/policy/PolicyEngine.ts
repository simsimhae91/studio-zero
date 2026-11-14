import { posix } from 'node:path';
import { CORE_PROJECT_ID, type Approval, type Origin } from '@studio-zero/protocol';
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
    // A key for an outside API is a credential like any other: it enters at the desk and nowhere else.
    id: 'external.configure-local-owner-only',
    evaluate: (actor, action) => {
      if (action.kind !== 'external.configure') return undefined;
      return actor.type === 'owner' && actor.via === 'desktop' ? allow('owner on the control socket') : deny('outside APIs and their keys can only be connected from an authenticated desktop client');
    },
  },
  {
    // The owner connecting an API to a project is the grant. The call goes where that connection says and
    // nowhere else, so a steered agent can reach that one host with that one key and no further.
    id: 'external.call-connected-only',
    evaluate: (_actor, action, { store }) => {
      if (action.kind !== 'external.call') return undefined;
      const api = store.listExternalApis(action.projectId).find((a) => a.name === action.name);
      if (!api) return deny(`no outside API named "${action.name}" is connected to this project`);
      return hostOf(api.origin) === action.host ? allow('the owner connected this API to this project') : deny('the connection is not the one this call was prepared for');
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
    // A shell someone types into. The container holds it as it holds every command, but it is the owner's
    // hands, at the desk: not something an agent opens for itself, and not something to drive from a chat app.
    id: 'sandbox.terminal-local-owner-only',
    evaluate: (actor, action) => {
      if (action.kind !== 'sandbox.terminal') return undefined;
      return actor.type === 'owner' && actor.via === 'desktop' ? allow('owner on the control socket; the shell runs inside the project container') : deny('terminals can only be opened from an authenticated desktop client');
    },
  },
  {
    // A picture costs a call on the owner's subscription, so a task has an allowance and no more.
    id: 'image.within-task-allowance',
    evaluate: (_actor, action, { store, config }) => {
      if (action.kind !== 'image.generate') return undefined;
      if (!config.images.enabled) return deny('image generation is switched off in the configuration');
      if (action.taskId === null) return allow('a picture the owner asked for');
      const made = store.countTaskEvents(action.taskId, 'image.generated');
      return made >= config.images.perTask ? deny(`this task has had its ${config.images.perTask} pictures; design with what there is`) : allow(`picture ${made + 1} of ${config.images.perTask} for this task`);
    },
  },
  {
    // A reference is a page someone else controls. Only a public https page is opened, only in the QA browser
    // container, and only because the owner named it: an agent cannot point the studio's browser anywhere.
    id: 'reference.public-pages-only',
    evaluate: (actor, action) => {
      if (action.kind !== 'reference.capture') return undefined;
      const check = parseReferenceUrl(action.url);
      if (!check.ok) return deny(check.reason);
      return actor.type === 'agent' ? deny('agents do not choose which pages the studio opens') : allow('a public page the owner named, opened in the QA browser container');
    },
  },
  {
    id: 'power.owner-only',
    evaluate: (actor, action) => {
      if (action.kind !== 'power.set') return undefined;
      return actor.type === 'agent' ? deny('agents do not control whether this Mac sleeps') : allow(`${actor.type} may change the power mode`);
    },
  },
  {
    // The harness copies a verified Core task's branch out as a new `feature/` ref. Only the harness, only for
    // the Core project, only under that prefix: an agent cannot write refs into the checkout, and no existing
    // branch can be named.
    id: 'selfhost.export-harness-only',
    evaluate: (actor, action) => {
      if (action.kind !== 'selfhost.export') return undefined;
      if (action.projectId !== CORE_PROJECT_ID) return deny('only the Core project is exported to the studio\'s checkout');
      if (!/^feature\/[a-z0-9][a-z0-9-]{0,60}$/.test(action.branch)) return deny('exports go to a new feature/ branch');
      return actor.type === 'system' ? allow('the harness exports verified work as a feature branch; nothing is merged') : deny('only the harness exports a task\'s branch');
    },
  },
  {
    // The one path by which work leaves a sandbox and lands in files this daemon runs from. The desk only.
    id: 'selfhost.merge-local-owner-only',
    evaluate: (actor, action) => {
      if (action.kind !== 'selfhost.merge') return undefined;
      return actor.type === 'owner' && actor.via === 'desktop' ? allow('owner on the control socket') : deny('the studio\'s own repository can only be merged into from an authenticated desktop client');
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
    // turning a scratchpad into a project, starting research or a document, asking another model's opinion.
    id: 'owner-initiated',
    evaluate: (actor, action) => {
      if (action.kind !== 'task.steer' && action.kind !== 'checkpoint.fork' && action.kind !== 'scratch.promote' && action.kind !== 'knowledge.run' && action.kind !== 'advisor.ask') return undefined;
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

const hostOf = (origin: string): string => {
  try {
    return new URL(origin).host;
  } catch {
    return '';
  }
};

/**
 * Where an outside API lives: an https origin on a public host name, with an optional port, and nothing after it.
 * The origin is fixed when the owner connects the API; a call can choose its path but never its destination.
 */
export function parseApiOrigin(raw: string): { ok: true; origin: string; host: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'only https:// APIs can be connected' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'URLs with embedded credentials are rejected' };
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') return { ok: false, reason: 'give the origin only (scheme, host and port), without a path or a query' };
  if (!isPublicHost(url.hostname)) return { ok: false, reason: `${url.hostname} is not a public host name` };
  return { ok: true, origin: url.origin, host: url.host };
}

/** Names that resolve inside this Mac or its networks, whatever DNS says about them. */
const INTERNAL_NAME = /(?:^|\.)(?:localhost|local|internal|lan|home\.arpa|intranet|corp|test|invalid|example)$/i;

/** True for an address no public page lives at: loopback, private ranges, link-local, carrier NAT, unspecified. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/i.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb');
}

/** A host a page in the QA browser may talk to: a public name. Not an address, not a single label (a container's name), not a private suffix. */
export function isPublicHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  return host.includes('.') && !host.includes(':') && !/^[\d.]+$/.test(host) && !INTERNAL_NAME.test(host);
}

/**
 * A page the owner named as a design reference. https only, a public host name, the default port, no embedded
 * credentials: nothing that could be an address inside this Mac, its containers or its network.
 */
export function parseReferenceUrl(raw: string): { ok: true; url: string; host: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'only https:// pages can be used as a reference' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'URLs with embedded credentials are rejected' };
  if (url.port !== '' && url.port !== '443') return { ok: false, reason: 'a reference URL must use the default https port' };
  if (!isPublicHost(url.hostname)) return { ok: false, reason: `${url.hostname} is not a public host name` };
  url.hash = '';
  return { ok: true, url: url.toString(), host: url.hostname };
}

/** Hosts where a repository is always two names deep, so a page inside one can be cut back to it. */
const TWO_DEEP = new Set(['github.com', 'codeberg.org']);

/**
 * Reads what a person pasted as the address of a repository: what the address bar held (a page inside the
 * repository, with a query or a fragment), the address without its scheme, or the one the "clone" box gives.
 * What comes out is built again from an allowed host and a path of plain names, and nothing else of the input
 * reaches a command.
 */
export function parseRepoUrl(raw: string, allowedHosts: readonly string[]): { ok: true; url: string; host: string; path: string } | { ok: false; reason: string } {
  const typed = raw.trim();
  const ssh = /^git@([A-Za-z0-9.-]+):(.+)$/.exec(typed);
  const address = ssh ? `https://${ssh[1]}/${ssh[2]}` : allowedHosts.some((host) => typed.startsWith(`${host}/`)) ? `https://${typed}` : typed;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'only https:// repositories are accepted' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'URLs with embedded credentials are rejected' };
  if (url.port !== '') return { ok: false, reason: 'repository URL must not carry a port' };
  if (!allowedHosts.includes(url.hostname)) return { ok: false, reason: `host ${url.hostname} is not in kirby.allowedHosts` };
  // A page inside a repository names the repository first. GitLab marks where it ends with "/-/".
  let path = url.pathname.replace(/\/+$/, '');
  const inside = path.indexOf('/-/');
  if (inside !== -1) path = path.slice(0, inside);
  else if (TWO_DEEP.has(url.hostname)) path = path.split('/').slice(0, 3).join('/');
  path = path.replace(/\.git$/, '');
  if (!/^\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+){1,3}$/.test(path)) return { ok: false, reason: 'repository path must look like /owner/name' };
  return { ok: true, url: `https://${url.hostname}${path}`, host: url.hostname, path };
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

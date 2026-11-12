import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CORE_PROJECT_ID, type Project, type SelfHostStatus, type Task } from '@studio-zero/protocol';
import { ConflictError, NotFoundError, UnavailableError } from '../app/errors.ts';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import type { PolicyEngine } from '../policy/PolicyEngine.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { assertBranchName } from '../sandbox/scripts.ts';
import { errorMessage, excerpt, type Logger } from '../util/core.ts';
import { runCommand, shq, type CommandRunner, type RunResult } from '../util/run.ts';

/** The branch a sandbox integrates on, whatever the base branch of the checkout is called. */
const WORKSPACE_BRANCH = 'main';
const IN_BUNDLE = '/tmp/sz/core-in.bundle';
const OUT_BUNDLE = '/tmp/sz/core-out.bundle';
/** Installing a workspace of this size from a cold cache takes minutes; a lockfile that has not changed takes none. */
const INSTALL_TIMEOUT_SEC = 900;
const MAX_EXPORT_BYTES = 96 * 1024 * 1024;

const Exported = z.object({ branch: z.string(), base: z.string(), files: z.number(), insertions: z.number(), deletions: z.number(), merged: z.boolean() });
type Exported = z.infer<typeof Exported>;
const exportKey = (taskId: string): string => `selfhost.export:${taskId}`;

/** The repository this code is running from: the nearest folder above this file that holds the workspace. */
export function findRepoRoot(from: string = fileURLToPath(import.meta.url)): string | null {
  let dir = dirname(from);
  for (let i = 0; i < 7; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml')) && existsSync(join(dir, 'packages', 'daemon', 'package.json'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** A branch name for a task's work: readable where the request allows it, unique by the task's id. */
export function featureBranch(task: Pick<Task, 'id' | 'prompt'>): string {
  const words = (task.prompt.split('\n')[0] ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36).replace(/-+$/, '');
  return `feature/${words || 'change'}-${task.id.slice(-6).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

/**
 * Self-hosting: the studio's own repository as its first project.
 *
 * The obvious way to let a studio work on itself is to point the agent at its own files. That would hand a
 * model a shell on this Mac, in the directory the daemon runs from, and with it everything the sandbox exists
 * to withhold. So the Core project is a sandbox like any other, and the repository reaches it and returns from
 * it as git objects only:
 *
 *   in    the base branch of this Mac's checkout is bundled and fetched into the Core workspace before each
 *         task, so the task starts from what is committed here (uncommitted changes are not seen);
 *   work  the task runs in the container through the same harness as every project: the type check, the test
 *         suite and the build gate it, and nothing it runs executes on the host;
 *   out   a finished task's branch is bundled in the container and fetched into this checkout as
 *         `feature/…`. That adds a ref and objects. No file in the working tree changes and nothing runs;
 *   merge the owner, at the desk, moves the base branch forward to that feature branch: fast-forward only, and
 *         only when the checkout is clean and on the base branch. Until then the running studio is untouched.
 *
 * What the agent wrote therefore reaches the code this daemon runs from by exactly one path, a merge the owner
 * makes after reading the branch.
 */
export class SelfHosting {
  readonly #config: Config;
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #policy: PolicyEngine;
  readonly #sandboxes: OrbStackManager;
  readonly #run: CommandRunner;
  readonly #log: Logger;
  #repo: Promise<{ repo: string } | { repo: null; reason: string }> | null = null;

  constructor(deps: { config: Config; store: Store; events: EventLog; policy: PolicyEngine; sandboxes: OrbStackManager; log: Logger; run?: CommandRunner }) {
    this.#config = deps.config;
    this.#store = deps.store;
    this.#events = deps.events;
    this.#policy = deps.policy;
    this.#sandboxes = deps.sandboxes;
    this.#run = deps.run ?? runCommand;
    this.#log = deps.log;
  }

  get #base(): string {
    return this.#config.selfHosting.baseBranch;
  }

  #git(repo: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<RunResult> {
    // The owner's repository, read and written without their prompts or pagers getting in the way.
    return this.#run('git', ['-C', repo, ...args], { timeoutMs: opts.timeoutMs ?? 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' }, maxOutputBytes: 8 * 1024 * 1024 });
  }

  /** Where the repository is, checked once: it has to be a git checkout that has the base branch. */
  #locate(): Promise<{ repo: string } | { repo: null; reason: string }> {
    return (this.#repo ??= (async () => {
      if (!this.#config.selfHosting.enabled) return { repo: null, reason: 'self-hosting is switched off (selfHosting.enabled in config.json)' };
      const candidate = this.#config.selfHosting.repoPath ?? findRepoRoot();
      if (!candidate) return { repo: null, reason: 'the daemon is not running from a checkout of its repository; set selfHosting.repoPath' };
      try {
        const repo = await realpath(candidate);
        const top = await this.#git(repo, ['rev-parse', '--show-toplevel']);
        if (top.exitCode !== 0 || (await realpath(top.stdout.trim())) !== repo) return { repo: null, reason: `${candidate} is not the root of a git checkout` };
        if ((await this.#git(repo, ['rev-parse', '-q', '--verify', `refs/heads/${this.#base}`])).exitCode !== 0) return { repo: null, reason: `${candidate} has no branch "${this.#base}" (selfHosting.baseBranch)` };
        return { repo };
      } catch (err) {
        return { repo: null, reason: `${candidate} cannot be used: ${errorMessage(err)}` };
      }
    })());
  }

  async #mustLocate(): Promise<string> {
    const located = await this.#locate();
    if (located.repo === null) throw new UnavailableError(`Studio Zero Core is not available: ${located.reason}`);
    return located.repo;
  }

  /** Creates the pinned project if the repository is there. Called once at boot; null when self-hosting is not available. */
  async mount(now: number): Promise<Project | null> {
    const located = await this.#locate();
    if (located.repo === null) {
      this.#log.info({ reason: located.reason }, 'self-hosting not mounted');
      return null;
    }
    return this.#store.ensureCoreProject(now);
  }

  /** A dry run: what a Core task would start from and whether its result could be merged, without changing anything. */
  async status(): Promise<SelfHostStatus> {
    const located = await this.#locate();
    if (located.repo === null) return { available: false, detail: located.reason, repoPath: null, baseBranch: null, head: null, clean: null, projectId: null, pending: [] };
    const repo = located.repo;
    const [head, dirty, current] = await Promise.all([this.#git(repo, ['rev-parse', `refs/heads/${this.#base}`]), this.#git(repo, ['status', '--porcelain']), this.#git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])]);
    const clean = dirty.exitCode === 0 && dirty.stdout.trim() === '';
    const on = current.stdout.trim();
    const project = this.#store.getProject(CORE_PROJECT_ID);
    const pending = project ? this.#store.listTasks(project.id, 200).flatMap((task) => { const e = this.#exported(task.id); return e && !e.merged ? [{ taskId: task.id, branch: e.branch, files: e.files, insertions: e.insertions, deletions: e.deletions }] : []; }) : [];
    return {
      available: true,
      detail: `tasks start from ${this.#base} at ${head.stdout.trim().slice(0, 12)}${clean ? '' : '; the checkout has uncommitted changes, which tasks do not see'}${on === this.#base ? '' : `; the checkout is on ${on}, so a merge would be refused`}`,
      repoPath: repo,
      baseBranch: this.#base,
      head: head.exitCode === 0 ? head.stdout.trim() : null,
      clean,
      projectId: project?.id ?? null,
      pending,
    };
  }

  /**
   * Brings the Core workspace to the base branch as it is committed in this checkout, and installs dependencies
   * when the lockfile has changed. With `onlyIfEmpty` it does that only for a workspace that has never been
   * filled: a look at the files should not move a branch a task may be on.
   */
  async sync(project: Project, opts: { onlyIfEmpty?: boolean; signal?: AbortSignal } = {}): Promise<void> {
    if (opts.onlyIfEmpty && (await this.#sandboxes.exec(project, 'test -f pnpm-workspace.yaml', { timeoutSec: 15 })).exitCode === 0) return;
    const repo = await this.#mustLocate();
    const scratch = await mkdtemp(join(tmpdir(), 'sz-core-'));
    try {
      const bundle = join(scratch, 'in.bundle');
      const made = await this.#git(repo, ['bundle', 'create', bundle, this.#base], { timeoutMs: 180_000 });
      if (made.exitCode !== 0) throw new UnavailableError(`could not bundle ${this.#base}: ${excerpt(made.stderr, 300)}`);
      const put = await this.#sandboxes.exec(project, `mkdir -p /tmp/sz && cat > ${IN_BUNDLE}`, { stdin: await readFile(bundle), timeoutSec: 120, signal: opts.signal });
      if (put.exitCode !== 0) throw new UnavailableError(`could not copy the repository into the Core sandbox: ${excerpt(put.stderr, 300)}`);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
    // Every task's work is committed on its own branch, so nothing uncommitted here is worth keeping: -f.
    const fetched = await this.#sandboxes.exec(project, `set -eu\ngit fetch -q --no-tags ${IN_BUNDLE} ${shq(this.#base)}\ngit checkout -q -f -B ${WORKSPACE_BRANCH} FETCH_HEAD\nrm -f ${IN_BUNDLE}`, { timeoutSec: 180, signal: opts.signal });
    if (fetched.exitCode !== 0) throw new UnavailableError(`could not bring the Core workspace to ${this.#base}: ${excerpt(fetched.stderr, 300)}`);
    // The lockfile's hash is kept inside node_modules, so a fresh container (no node_modules) installs again.
    const installed = await this.#sandboxes.exec(project, `want=$(git hash-object pnpm-lock.yaml)\n[ "$(cat node_modules/.sz-lock 2>/dev/null)" = "$want" ] && exit 0\n${SelfHosting.INSTALL} && echo "$want" > node_modules/.sz-lock`, { timeoutSec: INSTALL_TIMEOUT_SEC, signal: opts.signal });
    if (installed.exitCode !== 0) throw new UnavailableError(`dependencies could not be installed in the Core sandbox${installed.timedOut ? ' (timed out)' : ''}: ${excerpt(installed.stderr || installed.stdout, 400)}`);
  }

  /** How dependencies are installed in the Core sandbox: exactly what the lockfile says. */
  static readonly INSTALL = 'pnpm install --frozen-lockfile';

  /**
   * Copies a finished task's branch out to this checkout as a feature branch. A ref and its objects are added;
   * the working tree and the base branch are not touched. Returns null when the task committed nothing.
   */
  async export(project: Project, task: Pick<Task, 'id' | 'prompt' | 'branch'>): Promise<Exported | null> {
    const already = this.#exported(task.id);
    if (already) return already;
    if (!task.branch) return null;
    assertBranchName(task.branch);
    const repo = await this.#mustLocate();
    const branch = featureBranch(task);
    assertBranchName(branch);
    await this.#policy.authorize({ type: 'system' }, { kind: 'selfhost.export', projectId: project.id, branch }, { taskId: task.id });

    // Only what the task added: the base it started from is already in this checkout.
    const made = await this.#sandboxes.exec(project, `set -eu\nmkdir -p /tmp/sz\n[ -n "$(git rev-list -n 1 ${WORKSPACE_BRANCH}..${shq(task.branch)})" ] || exit 7\ngit bundle create -q ${OUT_BUNDLE} ${WORKSPACE_BRANCH}..${shq(task.branch)}\nbase64 < ${OUT_BUNDLE}\nrm -f ${OUT_BUNDLE}`, { timeoutSec: 180, maxOutputBytes: MAX_EXPORT_BYTES });
    if (made.exitCode === 7) return null;
    if (made.exitCode !== 0 || made.truncated) throw new UnavailableError(made.truncated ? 'the change is too large to copy out of the Core sandbox' : `could not bundle ${task.branch}: ${excerpt(made.stderr, 300)}`);

    const scratch = await mkdtemp(join(tmpdir(), 'sz-core-'));
    try {
      const bundle = join(scratch, 'out.bundle');
      await writeFile(bundle, Buffer.from(made.stdout, 'base64'), { mode: 0o600 });
      // Objects from a sandbox are checked as they come in. No force: an existing branch of that name is left alone.
      const fetched = await this.#git(repo, ['-c', 'fetch.fsckObjects=true', 'fetch', '-q', '--no-tags', bundle, `refs/heads/${task.branch}:refs/heads/${branch}`], { timeoutMs: 180_000 });
      if (fetched.exitCode !== 0) throw new UnavailableError(`could not add ${branch} to the checkout: ${excerpt(fetched.stderr, 300)}`);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
    const stat = (await this.#git(repo, ['diff', '--shortstat', `${this.#base}...${branch}`])).stdout;
    const pick = (re: RegExp): number => Number(re.exec(stat)?.[1] ?? 0);
    const exported: Exported = { branch, base: this.#base, files: pick(/(\d+) files? changed/), insertions: pick(/(\d+) insertions?\(\+\)/), deletions: pick(/(\d+) deletions?\(-\)/), merged: false };
    this.#store.kvSet(exportKey(task.id), JSON.stringify(exported));
    this.#events.emit({ projectId: project.id, taskId: task.id }, { type: 'selfhost.exported', branch, base: this.#base, files: exported.files, insertions: exported.insertions, deletions: exported.deletions });
    return exported;
  }

  /**
   * The owner's merge of an exported feature branch into the base branch of this checkout. Fast-forward only,
   * with the checkout clean and on the base branch; anything else is refused with the reason and nothing moves.
   * The caller has authorised the action.
   */
  async merge(taskId: string): Promise<{ branch: string; into: string; commit: string }> {
    const exported = this.#exported(taskId);
    if (!exported) throw new NotFoundError(`an exported branch for task ${taskId}`);
    if (exported.merged) throw new ConflictError(`${exported.branch} is already merged`);
    const repo = await this.#mustLocate();
    const on = (await this.#git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    if (on !== exported.base) throw new ConflictError(`the checkout is on "${on}", not "${exported.base}". Switch to ${exported.base} and try again, or merge ${exported.branch} yourself.`);
    const dirty = (await this.#git(repo, ['status', '--porcelain'])).stdout.trim();
    if (dirty !== '') throw new ConflictError(`the checkout has uncommitted changes (${dirty.split('\n').length} path(s)). Commit or stash them first; ${exported.branch} is kept.`);
    const merged = await this.#git(repo, ['merge', '-q', '--ff-only', exported.branch], { timeoutMs: 120_000 });
    if (merged.exitCode !== 0) throw new ConflictError(`${exported.base} has moved since this task started, so ${exported.branch} cannot be fast-forwarded onto it. Rebase or merge it yourself. ${excerpt(merged.stderr, 200)}`);
    const commit = (await this.#git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
    this.#store.kvSet(exportKey(taskId), JSON.stringify({ ...exported, merged: true } satisfies Exported));
    const task = this.#store.getTask(taskId);
    this.#events.emit({ projectId: task?.projectId ?? CORE_PROJECT_ID, taskId }, { type: 'selfhost.merged', branch: exported.branch, into: exported.base, commit });
    return { branch: exported.branch, into: exported.base, commit };
  }

  /** The branch a task's work was exported as, for the policy check that precedes a merge. */
  exportedBranch(taskId: string): string | null {
    return this.#exported(taskId)?.branch ?? null;
  }

  #exported(taskId: string): Exported | null {
    const stored = this.#store.kvGet(exportKey(taskId));
    if (stored === null) return null;
    const parsed = Exported.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  }
}

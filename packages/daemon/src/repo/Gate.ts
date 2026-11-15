import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { CORE_PROJECT_ID, NO_COMMIT, type Project, type RepoStatus, type RepoUpdate } from '@studio-zero/protocol';
import { ConflictError, UnavailableError } from '../app/errors.ts';
import type { Config } from '../config.ts';
import type { EventLog } from '../events/EventLog.ts';
import { WORKSPACE_DIR } from '../policy/PolicyEngine.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { INTEGRATION_BRANCH, LIST_BRANCHES, assertBranchName, gateFillScript, gateOutScript, receiveScript, type ReceiveUpdate } from '../sandbox/scripts.ts';
import { KeyedMutex, errorMessage, excerpt, type Logger } from '../util/core.ts';
import { runCommand, type CommandRunner, type RunResult } from '../util/run.ts';

/** The folder of a gate where a push's objects wait for the studio to take them. */
export const INCOMING_DIR = 'sz-incoming';
const HEADS = 'refs/heads/';
const TIMEOUT_SEC = 300;
/** The most a repository that is brought in may weigh as one bundle. It passes through memory on its way into the sandbox. */
const MAX_FILL_BYTES = 2 * 1024 * 1024 * 1024;

/** How the receive hook of a gate reaches the daemon: the node that runs it and the studio's command line. */
export interface HookCommand {
  node: string;
  cli: string;
}

/** What a push did, branch by branch, for whoever tells the owner and whoever acts on a moved main. */
export interface Received {
  accepted: boolean;
  /** What the pusher is told, in their language. */
  lines: string[];
  moved: { branch: string; old: string | null; new: string | null; commits: number }[];
  /** Refused because the gate was behind the sandbox: the caller brings the gate up to date, so that a fetch gets the pusher what they lack. */
  stale?: boolean;
}

const shq = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * A project's repository on this Mac: the gate.
 *
 * A project's code lives in its sandbox, where the owner's tools cannot reach it. The gate is a bare git
 * repository on the host that mirrors the project's branches, so the owner can clone it, fetch what the studio
 * made and push what they made. One rule holds it together: **the gate's branches are the sandbox's branches.**
 * The sandbox is where the truth is; the gate is its mirror, and a push stays at the gate only if the sandbox
 * took it.
 *
 *   out   `publish` copies the sandbox's branches to the gate as git objects (a bundle, checked as it is
 *         fetched: these objects were written in a sandbox). Checkpoints (`refs/sz/*`) stay inside.
 *   in    the gate's `pre-receive` hook runs the studio's command line, which packs what the push brings and
 *         asks the daemon. `receive` puts the pack into the sandbox and moves the branches there, all of them
 *         or none; only then does the hook let git move them at the gate. The integration branch moves
 *         forward only, and whoever calls `receive` holds the project's landing lock, so a push, a small
 *         edit's landing and a merge move it one at a time.
 *
 * A gate exists only once the owner has asked for it (`open`) or brought a repository in through it (`seed`):
 * until then nothing of a project is on the host's disk. The studio's own repository has no gate; it has its
 * own way out (`SelfHosting`).
 */
export class Gate {
  readonly #config: Config;
  readonly #events: EventLog;
  readonly #sandboxes: OrbStackManager;
  readonly #run: CommandRunner;
  readonly #log: Logger;
  readonly #hook: HookCommand;
  readonly #locks = new KeyedMutex();

  constructor(deps: { config: Config; events: EventLog; sandboxes: OrbStackManager; log: Logger; hook: HookCommand; run?: CommandRunner }) {
    this.#config = deps.config;
    this.#events = deps.events;
    this.#sandboxes = deps.sandboxes;
    this.#log = deps.log;
    this.#hook = deps.hook;
    this.#run = deps.run ?? runCommand;
  }

  pathOf(project: Pick<Project, 'slug'>): string {
    return join(this.#config.reposDir, `${project.slug}.git`);
  }

  isOpen(project: Pick<Project, 'slug'>): boolean {
    return existsSync(join(this.pathOf(project), 'HEAD'));
  }

  /** Host git on a gate, without the owner's prompts or pager. */
  #git(repo: string, args: string[], opts: { timeoutMs?: number; stdin?: string | Uint8Array } = {}): Promise<RunResult> {
    return this.#run('git', ['-C', repo, ...args], { timeoutMs: opts.timeoutMs ?? TIMEOUT_SEC * 1000, stdin: opts.stdin, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' }, maxOutputBytes: 8 * 1024 * 1024 });
  }

  #assertOurs(project: Pick<Project, 'id'>): void {
    if (project.id === CORE_PROJECT_ID) throw new ConflictError('Studio Zero Core의 저장소는 이 Mac의 체크아웃 자체입니다. 따로 여는 문이 없습니다.');
  }

  /** Makes the gate's repository if it is not there, and writes its hook as this daemon would have it. */
  async #make(project: Project): Promise<string> {
    const repo = this.pathOf(project);
    if (!this.isOpen(project)) {
      mkdirSync(this.#config.reposDir, { recursive: true, mode: 0o700 });
      const made = await this.#run('git', ['init', '-q', '--bare', '-b', INTEGRATION_BRANCH, repo], { timeoutMs: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
      if (made.exitCode !== 0) throw new UnavailableError(`could not make the repository at ${repo}: ${excerpt(made.stderr, 300)}`);
    }
    this.#writeHook(project);
    return repo;
  }

  /**
   * The gate's one hook. It is the studio's file, rewritten whenever the gate is touched: the paths in it are
   * this installation's. A push runs it as whoever pushes, on this Mac.
   */
  #writeHook(project: Project): void {
    const repo = this.pathOf(project);
    mkdirSync(join(repo, 'hooks'), { recursive: true });
    mkdirSync(join(repo, INCOMING_DIR), { recursive: true, mode: 0o700 });
    const file = join(repo, 'hooks', 'pre-receive');
    const head = `#!/bin/sh\n# Written by Studio Zero; rewritten whenever the studio touches this repository.\n# A push here is taken into the project's sandbox by the studio, or refused with the reason.\n`;
    // An installation that cannot say where its command line is has no way to ask the daemon: it refuses, and says so.
    const text = this.#hook.cli === '' ? `${head}echo 'Studio Zero: 이 설치에서는 명령줄(sz)의 위치를 알 수 없어 push를 받지 못합니다.' >&2\nexit 1\n` : `${head}exec ${shq(this.#hook.node)} ${shq(this.#hook.cli)} gate-receive ${shq(project.id)}\n`;
    writeFileSync(file, text, { mode: 0o755 });
    chmodSync(file, 0o755);
  }

  /** Rewrites the hook of every gate that exists, at boot: the daemon may have moved since they were written. */
  refreshHooks(projects: readonly Project[]): void {
    for (const project of projects) {
      if (project.id === CORE_PROJECT_ID || !this.isOpen(project)) continue;
      try {
        this.#writeHook(project);
      } catch (err) {
        this.#log.warn({ projectId: project.id, err: errorMessage(err) }, 'could not rewrite the repository hook');
      }
    }
  }

  /** Makes the gate if it is not there and brings it to the sandbox's branches. The owner's doing. */
  async open(project: Project): Promise<void> {
    this.#assertOurs(project);
    await this.#locks.run(project.id, () => this.#make(project));
    await this.publish(project);
  }

  async #branchesAt(repo: string): Promise<Map<string, string>> {
    const listed = await this.#git(repo, ['for-each-ref', '--format=%(objectname) %(refname:strip=2)', 'refs/heads']);
    if (listed.exitCode !== 0) throw new UnavailableError(`could not read the repository at ${repo}: ${excerpt(listed.stderr, 300)}`);
    return readBranches(listed.stdout);
  }

  async #branchesIn(project: Project): Promise<Map<string, string>> {
    const listed = await this.#sandboxes.exec(project, LIST_BRANCHES, { cwd: WORKSPACE_DIR, timeoutSec: 30 });
    if (listed.exitCode !== 0) throw new UnavailableError(`could not read the project's branches: ${excerpt(listed.stderr, 300)}`);
    return readBranches(listed.stdout);
  }

  /**
   * Brings the gate to the sandbox's branches: made, moved (backwards too: a rollback is the truth as well) and
   * removed. Returns how many it touched; 0 for a gate that is not open, which is left that way.
   */
  publish(project: Project): Promise<number> {
    if (project.id === CORE_PROJECT_ID || !this.isOpen(project)) return Promise.resolve(0);
    return this.#locks.run(project.id, async () => {
      const repo = this.pathOf(project);
      const [inside, outside] = [await this.#branchesIn(project), await this.#branchesAt(repo)];
      const changed = [...inside].filter(([branch, commit]) => outside.get(branch) !== commit);
      const gone = [...outside.keys()].filter((branch) => !inside.has(branch));
      if (changed.length === 0 && gone.length === 0) return 0;

      // A branch that went to a commit the gate already holds (a rollback, a branch made from another) needs no objects.
      const known = new Set<string>();
      for (const [, commit] of changed) if ((await this.#git(repo, ['cat-file', '-e', `${commit}^{commit}`])).exitCode === 0) known.add(commit);
      const need = changed.filter(([, commit]) => !known.has(commit));
      if (need.length > 0) {
        const made = await this.#sandboxes.exec(project, gateOutScript({ workspace: WORKSPACE_DIR, branches: need.map(([branch]) => branch), have: [...new Set(outside.values())] }), { cwd: WORKSPACE_DIR, timeoutSec: TIMEOUT_SEC, maxOutputBytes: Math.ceil(this.#config.repos.maxPackMb * 1024 * 1024 * 1.4) });
        if (made.exitCode !== 0 || made.truncated) throw new UnavailableError(made.truncated ? `the project's branches are more than ${this.#config.repos.maxPackMb} MB to copy out at once (repos.maxPackMb)` : `could not bundle the project's branches: ${excerpt(made.stderr, 300)}`);
        const scratch = await mkdtemp(join(tmpdir(), 'sz-gate-'));
        try {
          const bundle = join(scratch, 'out.bundle');
          await writeFile(bundle, Buffer.from(made.stdout, 'base64'), { mode: 0o600 });
          // Written in a sandbox: checked as they come in. A fetch runs no hook.
          const fetched = await this.#git(repo, ['-c', 'fetch.fsckObjects=true', 'fetch', '-q', '--no-tags', '--force', bundle, ...need.map(([branch]) => `+${HEADS}${branch}:${HEADS}${branch}`)]);
          if (fetched.exitCode !== 0) throw new UnavailableError(`could not take the project's branches into ${repo}: ${excerpt(fetched.stderr, 300)}`);
        } finally {
          await rm(scratch, { recursive: true, force: true });
        }
      }
      for (const [branch, commit] of changed.filter(([, commit]) => known.has(commit))) await this.#git(repo, ['update-ref', `${HEADS}${branch}`, commit]);
      for (const branch of gone) await this.#git(repo, ['update-ref', '-d', `${HEADS}${branch}`]);
      const touched = changed.length + gone.length;
      this.#events.emit({ projectId: project.id, taskId: null }, { type: 'repo.published', branches: touched });
      return touched;
    });
  }

  /**
   * Starts a gate from a checkout on this Mac: its `base` branch becomes the gate's integration branch. Both
   * are the owner's repositories on the host, so this is git talking to git. Returns the commit.
   */
  async seed(project: Project, from: { repo: string; base: string }): Promise<string> {
    this.#assertOurs(project);
    assertBranchName(from.base);
    return this.#locks.run(project.id, async () => {
      if (this.isOpen(project)) throw new ConflictError(`${this.pathOf(project)} is already there`);
      const repo = await this.#make(project);
      const fetched = await this.#git(repo, ['fetch', '-q', '--no-tags', from.repo, `+${HEADS}${from.base}:${HEADS}${INTEGRATION_BRANCH}`], { timeoutMs: 15 * 60_000 });
      if (fetched.exitCode !== 0) {
        await rm(repo, { recursive: true, force: true });
        throw new UnavailableError(`could not read ${from.base} from ${from.repo}: ${excerpt(fetched.stderr, 300)}`);
      }
      return (await this.#git(repo, ['rev-parse', `${HEADS}${INTEGRATION_BRANCH}`])).stdout.trim();
    });
  }

  /** Puts the gate's integration branch into a sandbox that holds nothing yet: how a repository that was brought in arrives. */
  async fill(project: Project): Promise<string> {
    return this.#locks.run(project.id, async () => {
      const repo = this.pathOf(project);
      const scratch = await mkdtemp(join(tmpdir(), 'sz-gate-'));
      try {
        const bundle = join(scratch, 'in.bundle');
        const made = await this.#git(repo, ['bundle', 'create', '-q', bundle, `${HEADS}${INTEGRATION_BRANCH}`], { timeoutMs: 15 * 60_000 });
        if (made.exitCode !== 0) throw new UnavailableError(`could not bundle ${INTEGRATION_BRANCH}: ${excerpt(made.stderr, 300)}`);
        if (statSync(bundle).size > MAX_FILL_BYTES) throw new ConflictError(`the repository is ${Math.round(statSync(bundle).size / 1024 / 1024)} MB as one bundle, more than the studio brings in at once`);
        const put = await this.#sandboxes.exec(project, gateFillScript({ workspace: WORKSPACE_DIR, branch: INTEGRATION_BRANCH, into: INTEGRATION_BRANCH }), { cwd: WORKSPACE_DIR, stdin: await readFile(bundle), timeoutSec: 900 });
        if (put.exitCode !== 0) throw new UnavailableError(`could not put the repository into the sandbox: ${excerpt(put.stderr, 300)}`);
        return put.stdout.trim().split('\n').at(-1) ?? '';
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    });
  }

  /**
   * A push, as the gate's hook reports it. Everything is taken or nothing is: a refusal changes nothing in the
   * sandbox, and the hook then refuses the push at the gate. `held` says which branches a task is at work on
   * (they are not the pusher's to move), and the caller holds the project's landing lock.
   */
  receive(project: Project, updates: readonly RepoUpdate[], pack: string | null, held: (branch: string) => string | null): Promise<Received> {
    this.#assertOurs(project);
    return this.#locks.run(project.id, async (): Promise<Received> => {
      const refuse = (...lines: string[]): Received => ({ accepted: false, lines, moved: [] });
      if (!this.isOpen(project)) return refuse('이 저장소는 스튜디오가 연 문이 아닙니다.');
      const wanted: ReceiveUpdate[] = [];
      for (const update of updates) {
        if (!update.ref.startsWith(HEADS)) return refuse(`${update.ref}: 브랜치만 받습니다. 태그와 그 밖의 ref는 받지 않습니다.`);
        const branch = update.ref.slice(HEADS.length);
        try {
          assertBranchName(branch);
        } catch {
          return refuse(`${branch}: 스튜디오가 쓸 수 없는 브랜치 이름입니다.`);
        }
        if (branch === INTEGRATION_BRANCH && update.new === NO_COMMIT) return refuse(`${INTEGRATION_BRANCH}은 지울 수 없습니다.`);
        const holder = branch === INTEGRATION_BRANCH ? null : held(branch);
        if (holder !== null) return refuse(`${branch}: 작업 ${holder}이(가) 이 브랜치에서 일하는 중입니다. 그 작업이 끝나거나 멈춘 뒤에 올리세요.`);
        wanted.push({ branch, old: update.old, new: update.new });
      }

      let bytes: Uint8Array | null = null;
      if (pack !== null) {
        // The hook wrote it; all the same, it is a path a caller named, and only the gate's own folder is read.
        const incoming = await realpath(join(this.pathOf(project), INCOMING_DIR));
        const file = await realpath(pack).catch(() => null);
        if (file === null || !file.startsWith(incoming + sep)) return refuse('보낸 객체를 찾지 못했습니다(스튜디오 쪽 문제입니다).');
        const size = statSync(file).size;
        if (size > this.#config.repos.maxPackMb * 1024 * 1024) return refuse(`한 번에 받는 크기는 ${this.#config.repos.maxPackMb} MB까지입니다(이 push는 ${Math.round(size / 1024 / 1024)} MB). 나눠서 올리거나 설정의 repos.maxPackMb를 올리세요.`);
        bytes = await readFile(file);
      }

      let taken;
      try {
        await this.#sandboxes.ensure(project);
        taken = await this.#sandboxes.exec(project, receiveScript({ workspace: WORKSPACE_DIR, into: INTEGRATION_BRANCH, pack: bytes !== null, updates: wanted }), { cwd: WORKSPACE_DIR, stdin: bytes ?? '', timeoutSec: TIMEOUT_SEC });
      } catch (err) {
        return refuse(`프로젝트의 샌드박스에 닿지 못했습니다: ${errorMessage(err)}`);
      }
      const said = taken.stdout.split('\n').map((line) => line.trim().split(' ')).filter((words) => words[0] === 'ok' || words[0] === 'no');
      if (taken.exitCode === 3) {
        const stale = said.some((words) => words[1] === 'stale');
        return { accepted: false, moved: [], lines: said.filter((words) => words[0] === 'no').map((words) => refusal(words[1] ?? '', words.slice(2).join(' '))), ...(stale ? { stale: true } : {}) };
      }
      if (taken.exitCode !== 0) return refuse(`스튜디오가 받지 못했습니다: ${excerpt(taken.stderr || taken.stdout, 300)}`);

      const moved = wanted.map((update) => ({ branch: update.branch, old: update.old === NO_COMMIT ? null : update.old, new: update.new === NO_COMMIT ? null : update.new, commits: Number(said.find((words) => words[0] === 'ok' && words[1] === update.branch)?.[2] ?? 0) }));
      for (const move of moved) this.#events.emit({ projectId: project.id, taskId: null }, { type: 'repo.received', ...move });
      return { accepted: true, moved, lines: moved.map((move) => (move.new === null ? `${move.branch}: 지웠습니다.` : move.old === null ? `${move.branch}: 새 브랜치로 받았습니다(커밋 ${move.commits}개).` : `${move.branch}: 받았습니다(커밋 ${move.commits}개).`)) };
    });
  }

  /** The gate's branches, newest first, for the owner to read. Empty for a gate that is not open. */
  async branches(project: Project): Promise<RepoStatus['branches']> {
    if (!this.isOpen(project)) return [];
    const listed = await this.#git(this.pathOf(project), ['for-each-ref', '--sort=-committerdate', '--format=%(refname:strip=2)%09%(objectname)%09%(committerdate:unix)%09%(contents:subject)', 'refs/heads']);
    if (listed.exitCode !== 0) return [];
    return listed.stdout.split('\n').filter(Boolean).slice(0, 200).map((line) => {
      const [name = '', commit = '', at = '0', ...subject] = line.split('\t');
      return { name, commit, at: Number(at) * 1000, subject: excerpt(subject.join('\t'), 160) };
    });
  }

  /** Removes the gate, when its project is deleted. A clone of it somewhere keeps what it has. */
  async forget(project: Pick<Project, 'slug' | 'id'>): Promise<void> {
    await this.#locks.run(project.id, () => rm(this.pathOf(project), { recursive: true, force: true }));
  }
}

function readBranches(text: string): Map<string, string> {
  const branches = new Map<string, string>();
  for (const line of text.split('\n')) {
    const at = line.indexOf(' ');
    if (at === 40) branches.set(line.slice(41).trim(), line.slice(0, 40));
  }
  return branches;
}

/** Why a branch of a push was refused, as the pusher reads it. */
function refusal(why: string, branch: string): string {
  if (why === 'stale') return `${branch}: 스튜디오가 그사이 움직였습니다. git fetch studio 후에 다시 올리세요.`;
  if (why === 'back') return `${branch}: 앞으로만 움직입니다. git fetch studio 후 studio/${branch} 위에 올려서(rebase 또는 merge) 다시 push하세요.`;
  if (why === 'held') return `${branch}: 스튜디오의 작업 공간이 지금 이 브랜치에 서 있습니다. 작업이 끝난 뒤에 올리세요.`;
  if (why === 'dirty') return `${branch}: 스튜디오 작업 공간에 커밋되지 않은 변경이 이 push가 건드리는 파일에 있습니다. 스튜디오에서 그것을 커밋하거나 버린 뒤에 다시 올리세요.`;
  if (why === 'missing') return `${branch}: 올린 커밋이 도착하지 않았습니다(스튜디오 쪽 문제입니다). 다시 올려 보세요.`;
  return `${branch}: 받지 못했습니다 (${why}).`;
}

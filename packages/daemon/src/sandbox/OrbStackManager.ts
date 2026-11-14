import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isIPv4 } from 'node:net';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, posix } from 'node:path';
import type { Checkpoint, Project, SandboxInfo } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { CheckpointRow, SandboxRow, Store } from '../db/Store.ts';
import { WORKSPACE_DIR } from '../policy/PolicyEngine.ts';
import { KeyedMutex, newId, sha256Hex, type Clock } from '../util/core.ts';
import { runCommand, shq, type CommandRunner, type RunResult } from '../util/run.ts';
import { resolveDockerBin } from './dockerBin.ts';
import {
  assertBranchName,
  checkpointScript,
  treeScript,
  commitAllScript,
  diffScript,
  initWorkspaceScript,
  mergeScript,
  rollbackScript,
  startBranchScript,
  startProcessScript,
  stopProcessScript,
  waitHttpScript,
} from './scripts.ts';

/** uid:gid the sandbox runs as. Matches the `node` user of the official Node images. */
const SANDBOX_USER = '1000:1000';
const QA_BROWSER = 'sz-qa-browser';
const QA_BROWSER_PORT = 3000;
/** Run by Node inside the QA browser's container: listens on a port of its own loopback and pipes each connection to that port on the host. */
const QA_FORWARDER =
  'const net=require("net");const port=Number(process.argv[1]);net.createServer((c)=>{const u=net.connect(port,"host.docker.internal");c.pipe(u);u.pipe(c);const end=()=>{c.destroy();u.destroy();};c.on("error",end);u.on("error",end);c.on("close",end);u.on("close",end);}).on("error",()=>process.exit(0)).listen(port,"127.0.0.1");';

/** The sandbox image: the base plus the package manager the project templates and the coding prompt assume. */
const sandboxDockerfile = (base: string): string => `FROM ${base}
RUN npm install -g pnpm@12 && npm cache clean --force
`;

/** The Hangul face the studio ships, at the release installed here: the same files go into mock-up pages (`qa/mockupFaces.ts`). */
const PRETENDARD_VERSION = (createRequire(import.meta.url)('pretendard/package.json') as { version: string }).version;

/**
 * What fontconfig in the QA image is told about the Hangul face: it is the face for Korean, and the face behind
 * `sans-serif` and `system-ui`. Installing the file alone is not enough: the image's own rules still answered a
 * Korean character, or a page that fell to the generic family, with WenQuanYi Zen Hei.
 */
const PRETENDARD_FONTCONFIG = [
  '<?xml version="1.0"?>',
  '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
  '<fontconfig>',
  '<alias binding="strong"><family>sans-serif</family><prefer><family>Pretendard Variable</family></prefer></alias>',
  '<alias binding="strong"><family>system-ui</family><prefer><family>Pretendard Variable</family></prefer></alias>',
  '<match target="pattern"><test name="lang" compare="contains"><string>ko</string></test><edit name="family" mode="prepend" binding="strong"><string>Pretendard Variable</string></edit></match>',
  '</fontconfig>',
];

/**
 * The QA browser image. Microsoft's Playwright image ships the browsers but not the `playwright` package that
 * provides `run-server`, so that is installed once into a derived image, and the browser container starts without
 * touching the network. The image also gets the Hangul face: its own Korean fallback is WenQuanYi Zen Hei, a
 * Chinese face, which is what every screenshot of a Korean product showed the reviewer until the face was put in.
 * A built product still has to load the face itself (the audit measures that); this is what a page that has not
 * is photographed in. Exported for its test; the tag is the recipe's hash, so a change here rebuilds the image.
 */
export const qaBrowserDockerfile = (playwrightVersion: string, baseOverride: string | undefined): string => `FROM ${baseOverride ?? `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`}
RUN npm install -g playwright@${playwrightVersion} && npm cache clean --force
RUN mkdir -p /usr/share/fonts/truetype/pretendard && cd /tmp && npm pack pretendard@${PRETENDARD_VERSION} --silent && tar -xzf pretendard-${PRETENDARD_VERSION}.tgz --strip-components=4 -C /usr/share/fonts/truetype/pretendard package/dist/public/variable/PretendardVariable.ttf && rm pretendard-${PRETENDARD_VERSION}.tgz && npm cache clean --force
RUN printf '%s\\n' ${PRETENDARD_FONTCONFIG.map((line) => `'${line}'`).join(' ')} > /etc/fonts/conf.d/40-pretendard.conf && fc-cache -f
`;

export class SandboxError extends Error {
  readonly detail: string;
  constructor(message: string, detail = '') {
    super(detail ? `${message}: ${detail}` : message);
    this.name = 'SandboxError';
    this.detail = detail;
  }
}

export interface ExecOptions {
  /** Relative to /workspace, or absolute inside it. */
  cwd?: string;
  timeoutSec?: number;
  stdin?: string | Uint8Array;
  maxOutputBytes?: number;
  onStdout?: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
}

type ContainerState = 'absent' | 'running' | 'stopped';

/**
 * Drives project sandboxes on OrbStack through its Docker-compatible engine (`docker --context orbstack`).
 *
 * One project = one container + one named volume + one bridge network:
 * - the container is disposable (`recreate` resets installed packages and caches),
 * - the volume holds /workspace and survives everything short of project deletion,
 * - the network lets the QA browser reach the dev server by container name and nothing else.
 *
 * Hardening applied to every sandbox: non-root user, all capabilities dropped, no-new-privileges, CPU / memory /
 * pid limits, no host mounts, no Docker socket. The environment is assembled here from typed inputs; there is
 * no parameter through which a caller could hand a provider key to a container.
 */
export class OrbStackManager {
  readonly #config: Config;
  readonly #store: Store;
  readonly #clock: Clock;
  readonly #run: CommandRunner;
  readonly #dockerBin: string;
  /** Lifecycle operations on one project never interleave: two callers must not both create its container. */
  readonly #lifecycle = new KeyedMutex();
  #globals: Promise<string[]> | null = null;

  constructor(deps: { config: Config; store: Store; clock: Clock; run?: CommandRunner }) {
    this.#config = deps.config;
    this.#store = deps.store;
    this.#clock = deps.clock;
    this.#run = deps.run ?? runCommand;
    // With an injected runner (tests) the name is passed through; otherwise find the real binary once.
    this.#dockerBin = deps.run ? deps.config.runtime.dockerBin : resolveDockerBin(deps.config.runtime.dockerBin);
  }

  // ------------------------------------------------------------ lifecycle

  async probe(): Promise<{ reachable: boolean; detail: string }> {
    try {
      const res = await this.#docker(['version', '--format', '{{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}'], { timeoutMs: 8_000 });
      return res.exitCode === 0 ? { reachable: true, detail: res.stdout.trim() } : { reachable: false, detail: lastLine(res.stderr) };
    } catch (err) {
      return { reachable: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Creates (or starts) the project's sandbox and makes sure /workspace is a git repository. Idempotent and safe to call concurrently. */
  ensure(project: Place): Promise<SandboxInfo> {
    return this.#lifecycle.run(lifeKey(project), () => this.#ensure(project));
  }

  async #ensure(project: Place): Promise<SandboxInfo> {
    const slot = slotOf(project);
    const names = sandboxNames(project.slug, slot);
    const state = await this.#containerState(names.container);
    if (state === 'running' && this.#store.getSandbox(project.id, slot)) return this.info(project);
    if (state === 'stopped' && this.#store.getSandbox(project.id, slot)) {
      await this.#must(['start', names.container], 'could not start sandbox');
      return this.info(project);
    }
    if (state !== 'absent') await this.#must(['rm', '-f', names.container], 'could not remove stale sandbox container');

    // A slot is a clone of the project: it reads the project's own volume, so that has to be there first.
    if (slot > 0 && !this.#store.getSandbox(project.id)) throw new SandboxError(`slot ${slot} of ${project.slug} has no project sandbox to be a clone of`);
    const image = await this.#sandboxImage();
    await this.#ensureNetwork(names.network, project.id);
    await this.#ensureVolume(names.volume, project.id, await this.#baseImage());

    // Scoped to this sandbox, useless anywhere else: the gateway maps it back to the project and swaps in the
    // real provider key on the host side. Only its hash is stored.
    const gatewayToken = `szg_${randomBytes(24).toString('base64url')}`;
    const gateway = `http://host.docker.internal:${this.#config.gateway.port}`;
    const plainEnv: Record<string, string> = {
      SZ_PROJECT: project.slug,
      SZ_GATEWAY_URL: gateway,
      ANTHROPIC_BASE_URL: `${gateway}/anthropic`,
      OPENAI_BASE_URL: `${gateway}/openai/v1`,
      CI: '1',
    };
    // SDKs and CLIs inside the sandbox find the gateway token where they expect a provider key.
    const tokenEnv: Record<string, string> = { ANTHROPIC_API_KEY: gatewayToken, OPENAI_API_KEY: gatewayToken };

    const rt = this.#config.runtime;
    const args = [
      'run', '--detach',
      '--name', names.container,
      '--hostname', slot > 0 ? `${project.slug}-s${slot}` : project.slug,
      '--label', `studio-zero.project=${project.id}`,
      // A slot is not listed with the projects' sandboxes (`states`): it is the project's, not one more project.
      '--label', slot > 0 ? 'studio-zero.role=slot' : 'studio-zero.role=sandbox',
      ...(slot > 0 ? ['--label', `studio-zero.slot=${slot}`] : []),
      '--network', names.network,
      // volume-nocopy: without it, the first mount of an empty volume copies the ownership of the container's
      // own /workspace (created root-owned for --workdir) onto the volume and undoes the chown below.
      '--mount', `type=volume,source=${names.volume},target=${WORKSPACE_DIR},volume-nocopy`,
      // The project's own workspace, to read: a slot clones from it, follows its branches and copies its
      // installed dependencies. It can write nothing there; what it makes leaves as a bundle (`Slots`).
      ...(slot > 0 ? ['--mount', `type=volume,source=${sandboxNames(project.slug).volume},target=${SLOT_MAIN_DIR},readonly`] : []),
      '--workdir', WORKSPACE_DIR,
      '--user', SANDBOX_USER,
      '--cpus', String(rt.cpus),
      '--memory', `${rt.memoryMb}m`,
      '--pids-limit', String(rt.pidsLimit),
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--init',
      '--restart', 'unless-stopped',
      // Loopback-only, engine-assigned host ports. Remote clients reach previews through the tunnel, not the LAN.
      ...rt.previewPorts.flatMap((port) => ['--publish', `127.0.0.1::${port}`]),
      ...Object.entries(plainEnv).flatMap(([name, value]) => ['--env', `${name}=${value}`]),
      // Name-only `--env`: the token travels in the docker client's environment, not in its argument list.
      ...Object.keys(tokenEnv).flatMap((name) => ['--env', name]),
      image,
      'sleep', 'infinity',
    ];
    await this.#must(args, 'could not create sandbox', { env: { ...process.env, ...tokenEnv } });
    this.#store.upsertSandbox({ projectId: project.id, slot, ...names, image, gatewayTokenHash: sha256Hex(gatewayToken) }, this.#clock());

    // A slot's workspace is not begun here: it is cloned from the project's when the slot is first taken.
    if (slot > 0) return this.info(project);
    const init = await this.exec(project, initWorkspaceScript(WORKSPACE_DIR), { timeoutSec: 60 });
    if (init.exitCode !== 0) throw new SandboxError('could not initialise workspace', init.stderr);
    return this.info(project);
  }

  stop(project: Place): Promise<SandboxInfo> {
    return this.#lifecycle.run(lifeKey(project), async () => {
      const { container } = sandboxNames(project.slug, slotOf(project));
      if ((await this.#containerState(container)) === 'running') await this.#must(['stop', '--time', '10', container], 'could not stop sandbox');
      return this.info(project);
    });
  }

  /** Environment reset: a fresh container from the image, same workspace volume, new gateway token. */
  recreate(project: Place): Promise<SandboxInfo> {
    return this.#lifecycle.run(lifeKey(project), async () => {
      const { container } = sandboxNames(project.slug, slotOf(project));
      if ((await this.#containerState(container)) !== 'absent') await this.#must(['rm', '-f', container], 'could not remove sandbox');
      return this.#ensure(project);
    });
  }

  /**
   * Removes container and network. The workspace volume is only removed when `deleteWorkspace` is set. The
   * project's slots go with it, volumes and all: a slot holds nothing the project's repository does not.
   */
  destroy(project: Project, opts: { deleteWorkspace: boolean }): Promise<void> {
    return this.#lifecycle.run(project.id, async () => {
      const names = sandboxNames(project.slug);
      for (const row of this.#store.listSandboxes(project.id).filter((s) => s.slot > 0)) {
        await this.#docker(['rm', '-f', row.container]);
        await this.#docker(['volume', 'rm', row.volume]);
        this.#store.deleteSandbox(project.id, row.slot);
      }
      await this.#docker(['rm', '-f', names.container]);
      await this.#docker(['network', 'rm', names.network]);
      if (opts.deleteWorkspace) await this.#docker(['volume', 'rm', names.volume]);
    });
  }

  /**
   * Which sandboxes exist and whether they are running, by container name, from a single engine call.
   * A project whose container was never created (or was removed) is simply not in the map.
   */
  async states(): Promise<Map<string, 'running' | 'stopped'>> {
    const res = await this.#docker(['ps', '--all', '--filter', 'label=studio-zero.role=sandbox', '--format', '{{.Names}}\t{{.State}}'], { timeoutMs: 8_000 });
    if (res.exitCode !== 0) throw new SandboxError('container runtime is not reachable', lastLine(res.stderr));
    const states = new Map<string, 'running' | 'stopped'>();
    for (const line of res.stdout.split('\n')) {
      const [name, state] = line.trim().split('\t');
      if (name) states.set(name, state === 'running' ? 'running' : 'stopped');
    }
    return states;
  }

  /**
   * Where the container engine's API listens, e.g. `unix:///Users/me/.orbstack/run/docker.sock`. The interactive
   * terminal speaks to it directly, because a pseudo-terminal cannot be had through the `docker` command line
   * without one on this side.
   */
  async engineEndpoint(): Promise<string> {
    const flags = await this.#globalFlags();
    return flags[flags.indexOf('--host') + 1]!;
  }

  async info(project: Place): Promise<SandboxInfo> {
    const names = sandboxNames(project.slug, slotOf(project));
    const state = await this.#containerState(names.container);
    return {
      projectId: project.id,
      state,
      container: names.container,
      image: this.#store.getSandbox(project.id, slotOf(project))?.image ?? this.#config.runtime.image ?? this.#config.runtime.baseImage,
      previewUrls: state === 'running' ? await this.#previewUrls(names.container) : [],
    };
  }

  // ----------------------------------------------------------------- exec

  /**
   * Runs a bash script inside the sandbox. A non-zero exit is a normal result, not an exception: callers decide
   * what failure means. Throws only when the container itself cannot be reached.
   */
  async exec(project: Place, script: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const { container } = sandboxNames(project.slug, slotOf(project));
    const cwd = resolveInWorkspace(opts.cwd ?? '.');
    const timeoutSec = Math.min(opts.timeoutSec ?? this.#config.runtime.execTimeoutSec, 3600);
    const res = await this.#docker(
      // `timeout` runs inside the container, so an overrunning command is killed there, not just abandoned.
      ['exec', '--interactive', '--workdir', cwd, container, 'timeout', '--kill-after=5', `${timeoutSec}`, 'bash', '-c', script],
      {
        stdin: opts.stdin,
        timeoutMs: (timeoutSec + 20) * 1000,
        maxOutputBytes: opts.maxOutputBytes ?? 2 * 1024 * 1024,
        onStdout: opts.onStdout,
        signal: opts.signal,
      },
    );
    if (res.exitCode !== 0 && /No such container|is not running|Cannot connect to the Docker daemon|context .* not found/i.test(res.stderr)) {
      throw new SandboxError(`sandbox ${container} is not available`, lastLine(res.stderr));
    }
    return {
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
      truncated: res.truncated,
      timedOut: res.timedOut || res.exitCode === 124 || res.exitCode === 137,
      durationMs: res.durationMs,
    };
  }

  async readFile(project: Place, path: string, maxBytes = 512 * 1024): Promise<{ content: string; truncated: boolean }> {
    const target = resolveInWorkspace(path);
    const res = await this.exec(project, `head -c ${maxBytes + 1} -- ${shq(target)}`, { timeoutSec: 30, maxOutputBytes: maxBytes + 1024 });
    if (res.exitCode !== 0) throw new SandboxError(`cannot read ${path}`, lastLine(res.stderr));
    const truncated = Buffer.byteLength(res.stdout) > maxBytes;
    return { content: truncated ? res.stdout.slice(0, maxBytes) : res.stdout, truncated };
  }

  async writeFile(project: Place, path: string, content: string | Uint8Array): Promise<void> {
    const target = resolveInWorkspace(path);
    const res = await this.exec(project, `mkdir -p -- ${shq(posix.dirname(target))} && cat > ${shq(target)}`, { stdin: content, timeoutSec: 30 });
    if (res.exitCode !== 0) throw new SandboxError(`cannot write ${path}`, lastLine(res.stderr));
  }

  /** Starts a named long-running process (the dev server) detached from the exec session. Replaces a running one. */
  async startProcess(project: Place, name: string, command: string): Promise<void> {
    await this.stopProcess(project, name);
    const { container } = sandboxNames(project.slug, slotOf(project));
    await this.#must(['exec', '--detach', container, 'setsid', 'bash', '-c', startProcessScript({ name, command, workspace: WORKSPACE_DIR })], `could not start ${name}`);
  }

  async stopProcess(project: Place, name: string): Promise<void> {
    await this.exec(project, stopProcessScript(name), { timeoutSec: 20 });
  }

  async waitForHttp(project: Place, port: number, path: string, timeoutSec: number): Promise<boolean> {
    const res = await this.exec(project, waitHttpScript({ url: `http://127.0.0.1:${port}${path}`, timeoutSec }), { timeoutSec: timeoutSec + 10 });
    return res.exitCode === 0;
  }

  async processLog(project: Place, name: string, tailLines = 80): Promise<string> {
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(name)) throw new SandboxError('invalid process name');
    return (await this.exec(project, `tail -n ${tailLines} /tmp/sz/${name}.log 2>/dev/null || true`, { timeoutSec: 10 })).stdout;
  }

  /**
   * One-shot container with no volume and no credentials, removed on exit. Used to clone and read repositories
   * the owner pointed Kirby at, so third-party code never lands in a project workspace unreviewed.
   */
  async runEphemeral(opts: { script: string; stdin?: string; timeoutSec: number; maxOutputBytes: number }): Promise<RunResult> {
    const name = `sz-tmp-${randomBytes(6).toString('hex')}`;
    const args = [
      'run', '--rm', '--interactive',
      '--name', name,
      '--label', 'studio-zero.role=ephemeral',
      '--user', SANDBOX_USER,
      '--cpus', '1', '--memory', '1024m', '--pids-limit', '256',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--read-only',
      '--tmpfs', '/tmp:rw,exec,size=1g,uid=1000,gid=1000',
      '--env', 'HOME=/tmp',
      await this.#baseImage(),
      'timeout', '--kill-after=5', `${opts.timeoutSec}`, 'bash', '-c', opts.script,
    ];
    try {
      return await this.#docker(args, { stdin: opts.stdin, timeoutMs: (opts.timeoutSec + 30) * 1000, maxOutputBytes: opts.maxOutputBytes });
    } finally {
      await this.#docker(['rm', '-f', name]).catch(() => undefined);
    }
  }

  // ------------------------------------------------- checkpoints & git

  /** Sub-second snapshot of the whole working tree (see `checkpointScript`). */
  async checkpoint(project: Place, label: string, taskId: string | null = null): Promise<Checkpoint> {
    const id = newId('ckp');
    const res = await this.exec(project, checkpointScript({ workspace: WORKSPACE_DIR, id, label }), { timeoutSec: 120 });
    const match = /^([0-9a-f]{40,64}) ([0-9a-f]{40,64}|none) (\S+)\s*$/.exec(res.stdout.trim());
    if (res.exitCode !== 0 || !match) throw new SandboxError('checkpoint failed', lastLine(res.stderr) || res.stdout);
    const row: CheckpointRow = { id, projectId: project.id, taskId, label, commit: match[1]!, headSha: match[2]!, branch: match[3]!, createdAt: this.#clock() };
    this.#store.insertCheckpoint(row);
    return toCheckpoint(row);
  }

  /** What the workspace holds right now, as a tree id (see `treeScript`): equal ids mean no file differs. */
  async workspaceTree(project: Place): Promise<string> {
    const res = await this.exec(project, treeScript({ workspace: WORKSPACE_DIR }), { timeoutSec: 120 });
    const tree = res.stdout.trim();
    if (res.exitCode !== 0 || !/^[0-9a-f]{40,64}$/.test(tree)) throw new SandboxError('could not read the workspace tree', lastLine(res.stderr) || res.stdout);
    return tree;
  }

  /** Restores a checkpoint after first checkpointing the present, so the rollback can itself be rolled back. */
  async rollback(project: Place, checkpointId: string): Promise<{ restored: Checkpoint; safety: Checkpoint }> {
    const row = this.#store.getCheckpoint(checkpointId);
    if (!row || row.projectId !== project.id) throw new SandboxError(`checkpoint ${checkpointId} does not belong to this project`);
    const safety = await this.checkpoint(project, `before rollback to ${row.label}`.slice(0, 120));
    const res = await this.exec(project, rollbackScript({ workspace: WORKSPACE_DIR, id: row.id, headSha: row.headSha, branch: row.branch }), { timeoutSec: 120 });
    if (res.exitCode !== 0) throw new SandboxError('rollback failed', lastLine(res.stderr));
    return { restored: toCheckpoint(row), safety };
  }

  /**
   * A branch that starts at a checkpoint: the workspace exactly as it was then, as a line of history of its own.
   * Nothing on the current branch changes. Forking the same checkpoint twice gives the same branch.
   */
  async fork(project: Place, checkpointId: string): Promise<string> {
    const row = this.#store.getCheckpoint(checkpointId);
    if (!row || row.projectId !== project.id) throw new SandboxError(`checkpoint ${checkpointId} does not belong to this project`);
    const branch = `fork/${checkpointId.slice(-10)}`;
    const res = await this.exec(project, `git rev-parse -q --verify ${shq(`refs/heads/${branch}`)} >/dev/null || git branch -- ${shq(branch)} ${row.commit}`, { timeoutSec: 30 });
    if (res.exitCode !== 0) throw new SandboxError('could not create the fork', lastLine(res.stderr));
    return branch;
  }

  /**
   * Puts the workspace on a task's branch, started from `from`. With `keep`, a branch of that name that already
   * holds work of its own is kept as it is. Returns whether it was: true means the task goes on from earlier work.
   */
  async startBranch(project: Place, branch: string, from: string, opts: { keep?: boolean } = {}): Promise<boolean> {
    const res = await this.exec(project, startBranchScript({ workspace: WORKSPACE_DIR, branch, from, keep: opts.keep }), { timeoutSec: 60 });
    if (res.exitCode !== 0) throw new SandboxError(`cannot start branch ${branch}`, lastLine(res.stderr));
    return lastLine(res.stdout) === 'kept';
  }

  async checkout(project: Place, branch: string): Promise<void> {
    assertBranchName(branch);
    const res = await this.exec(project, `git checkout -q ${shq(branch)}`, { timeoutSec: 60 });
    if (res.exitCode !== 0) throw new SandboxError(`cannot check out ${branch}`, lastLine(res.stderr));
  }

  /**
   * Commits what is in the working tree. With `only`, commits what is under those paths and leaves the rest
   * as it lies: for a caller that wrote a few files on a branch whose other contents are not its to judge.
   */
  async commitAll(project: Place, message: string, only?: readonly string[]): Promise<string> {
    const res = await this.exec(project, commitAllScript({ workspace: WORKSPACE_DIR, message, ...(only ? { only } : {}) }), { timeoutSec: 120 });
    if (res.exitCode !== 0) throw new SandboxError('commit failed', lastLine(res.stderr));
    return res.stdout.trim().split('\n').at(-1) ?? '';
  }

  async merge(project: Place, branch: string, into: string): Promise<string> {
    const res = await this.exec(project, mergeScript({ workspace: WORKSPACE_DIR, branch, into }), { timeoutSec: 120 });
    if (res.exitCode !== 0) throw new SandboxError(res.exitCode === 3 ? `merging ${branch} into ${into} conflicts` : 'merge failed', lastLine(res.stderr));
    return res.stdout.trim().split('\n').at(-1) ?? '';
  }

  async diff(project: Place, base: string, branch: string, maxBytes = 400_000): Promise<{ diff: string; stat: { files: number; insertions: number; deletions: number }; truncated: boolean }> {
    const res = await this.exec(project, diffScript({ workspace: WORKSPACE_DIR, base, branch }), { timeoutSec: 60, maxOutputBytes: maxBytes });
    if (res.exitCode !== 0) throw new SandboxError('diff failed', lastLine(res.stderr));
    const [statLine = '', diff = ''] = res.stdout.split('---sz-diff---\n');
    const pick = (re: RegExp): number => Number(re.exec(statLine)?.[1] ?? 0);
    return {
      diff,
      stat: { files: pick(/(\d+) files? changed/), insertions: pick(/(\d+) insertions?\(\+\)/), deletions: pick(/(\d+) deletions?\(-\)/) },
      truncated: res.truncated,
    };
  }

  // ----------------------------------------------------------- QA browser

  /**
   * Starts (if needed) the shared headless-browser container and returns the Playwright WebSocket endpoint.
   * The browser runs in its own container so page content never executes on the host or beside the daemon;
   * it starts on demand and `stopQaBrowser` returns its memory when audits are idle.
   */
  async ensureQaBrowser(playwrightVersion: string, baseImageOverride?: string): Promise<string> {
    if (!/^\d+\.\d+\.\d+$/.test(playwrightVersion)) throw new SandboxError(`unexpected Playwright version: ${playwrightVersion}`);
    let path = this.#store.kvGet('qa.browser.path');
    const state = await this.#containerState(QA_BROWSER);
    if (state !== 'running' || path === null || this.#store.kvGet('qa.browser.version') !== playwrightVersion) {
      await this.#docker(['rm', '-f', QA_BROWSER]);
      path = randomBytes(18).toString('base64url');
      const image = await this.#qaBrowserImage(playwrightVersion, baseImageOverride);
      await this.#must(
        [
          'run', '--detach',
          '--name', QA_BROWSER,
          '--label', 'studio-zero.role=qa-browser',
          '--user', 'pwuser',
          '--init',
          '--shm-size', '1g',
          '--cpus', '2', '--memory', '2048m',
          '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
          '--publish', `127.0.0.1::${QA_BROWSER_PORT}`,
          image,
          'playwright', 'run-server', '--port', String(QA_BROWSER_PORT), '--host', '0.0.0.0', '--path', `/${path}`,
        ],
        'could not start QA browser',
      );
      this.#store.kvSet('qa.browser.path', path);
      this.#store.kvSet('qa.browser.version', playwrightVersion);
    }
    const port = (await this.#publishedPorts(QA_BROWSER)).get(QA_BROWSER_PORT);
    if (port === undefined) throw new SandboxError('QA browser port is not published');
    return `ws://127.0.0.1:${port}/${path}`;
  }

  /** Joins the QA browser to a project's network so it can load `http://<sandbox>:<port>`. Idempotent. */
  /**
   * Puts the QA browser on the project's network and returns where the project answers from there: the
   * sandbox's address on that network, not its name.
   *
   * A dev server checks the Host header it is asked by. Vite (and webpack's dev server) answer a request
   * addressed to an IP, and refuse one addressed to a name they were not told about with 403 "Blocked request.
   * This host is not allowed." Opened as `http://sz-<slug>:<port>`, every Vite project answered the QA browser
   * with that refusal, and the audit photographed and reviewed the refusal as if it were the product. The
   * name stays as the fallback for an engine that will not say the address.
   */
  async attachQaBrowser(project: Place): Promise<string> {
    const names = sandboxNames(project.slug, slotOf(project));
    const res = await this.#docker(['network', 'connect', names.network, QA_BROWSER]);
    if (res.exitCode !== 0 && !/already exists/i.test(res.stderr)) throw new SandboxError('could not attach QA browser to project network', lastLine(res.stderr));
    const found = await this.#docker(['container', 'inspect', '--format', `{{with index .NetworkSettings.Networks "${names.network}"}}{{.IPAddress}}{{end}}`, names.container], { timeoutMs: 15_000 });
    const address = found.stdout.trim();
    return found.exitCode === 0 && isIPv4(address) ? address : names.container;
  }

  /**
   * Makes `127.0.0.1:<port>` inside the QA browser's container lead to the same port on this machine.
   *
   * A product's page calls its backend at the address that was built into it, `127.0.0.1:<port>`, which is
   * right in the owner's browser and means the container itself in this one. So the container is given a
   * listener on that port that passes every connection out to the host: the page under audit is then the page
   * the owner sees, calling the same address. It carries any TCP, so realtime's WebSocket goes through too. A
   * second listener on a port finds it taken and leaves; all of them end with the container.
   */
  async forwardQaBrowser(port: number): Promise<void> {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new SandboxError(`cannot forward port ${port}`);
    const res = await this.#docker(['exec', '--detach', QA_BROWSER, 'node', '-e', QA_FORWARDER, String(port)], { timeoutMs: 20_000 });
    if (res.exitCode !== 0) throw new SandboxError('could not open a way from the QA browser to the project\'s backend', lastLine(res.stderr));
  }

  async detachQaBrowser(project: Place): Promise<void> {
    await this.#docker(['network', 'disconnect', sandboxNames(project.slug).network, QA_BROWSER]);
  }

  async stopQaBrowser(): Promise<void> {
    await this.#docker(['rm', '-f', QA_BROWSER]);
  }

  // ------------------------------------------------------------- internals

  async #docker(args: string[], opts: Parameters<CommandRunner>[2] = {}): Promise<RunResult> {
    return this.#run(this.#dockerBin, [...(await this.#globalFlags()), ...args], { timeoutMs: 120_000, ...opts });
  }

  #globalFlags(): Promise<string[]> {
    this.#globals ??= this.#resolveGlobals().catch((err: unknown) => {
      this.#globals = null; // not cached: the engine may simply not be running yet
      throw err;
    });
    return this.#globals;
  }

  /**
   * The docker client flags every command gets: the engine's socket, and a client config directory that belongs
   * to the daemon. A 24/7 daemon must not depend on the interactive user's `~/.docker/config.json`: a
   * credential helper named there (and since uninstalled, or one that wants to show a dialog) makes even
   * anonymous pulls of public images fail. Private registries are out of scope; point `runtime.image` at a
   * locally available image for those.
   */
  async #resolveGlobals(): Promise<string[]> {
    const rt = this.#config.runtime;
    let host = rt.dockerHost;
    if (host === undefined) {
      const res = await this.#run(this.#dockerBin, ['context', 'inspect', rt.dockerContext, '--format', '{{.Endpoints.docker.Host}}'], { timeoutMs: 15_000 });
      host = res.exitCode === 0 ? res.stdout.trim() : '';
      const orbstackSocket = join(homedir(), '.orbstack/run/docker.sock');
      if (host === '' && rt.dockerContext === 'orbstack' && existsSync(orbstackSocket)) host = `unix://${orbstackSocket}`;
      if (host === '') throw new SandboxError(`docker context "${rt.dockerContext}" was not found`, lastLine(res.stderr));
    }
    const configDir = join(this.#config.home, 'docker');
    mkdirSync(join(configDir, 'cli-plugins'), { recursive: true, mode: 0o700 });
    if (!existsSync(join(configDir, 'config.json'))) writeFileSync(join(configDir, 'config.json'), '{}\n', { mode: 0o600 });
    // Image builds go through the buildx plugin, which the client looks for in its config directory.
    const buildx = join(dirname(this.#dockerBin), 'docker-buildx');
    const link = join(configDir, 'cli-plugins', 'docker-buildx');
    if (isAbsolute(this.#dockerBin) && existsSync(buildx) && !existsSync(link)) symlinkSync(buildx, link);
    return ['--config', configDir, '--host', host];
  }

  async #must(args: string[], what: string, opts: Parameters<CommandRunner>[2] = {}): Promise<RunResult> {
    const res = await this.#docker(args, opts);
    if (res.exitCode !== 0) throw new SandboxError(what, lastLine(res.stderr));
    return res;
  }

  async #containerState(name: string): Promise<ContainerState> {
    const res = await this.#docker(['container', 'inspect', '--format', '{{.State.Running}}', name], { timeoutMs: 15_000 });
    if (res.exitCode !== 0) {
      if (/No such (container|object)/i.test(res.stderr)) return 'absent';
      throw new SandboxError('container runtime is not reachable', lastLine(res.stderr));
    }
    return res.stdout.trim() === 'true' ? 'running' : 'stopped';
  }

  /**
   * Pulls an image if it is not present. A separate step with its own long timeout: left to `docker run`, a
   * first-time pull of a large image would be cut off by the ordinary command timeout.
   */
  async #ensureImage(image: string): Promise<void> {
    if ((await this.#docker(['image', 'inspect', '--format', '{{.Id}}', image], { timeoutMs: 15_000 })).exitCode === 0) return;
    const res = await this.#docker(['pull', '--quiet', image], { timeoutMs: 20 * 60 * 1000 });
    if (res.exitCode !== 0) throw new SandboxError(`could not pull image ${image}`, lastLine(res.stderr));
  }

  /** The plain base image, pulled if needed. Enough for one-shot containers that only need git and node. */
  async #baseImage(): Promise<string> {
    const image = this.#config.runtime.image ?? this.#config.runtime.baseImage;
    await this.#ensureImage(image);
    return image;
  }

  /** The QA browser image (`qaBrowserDockerfile`), built once per recipe and kept under the recipe's hash. */
  async #qaBrowserImage(version: string, baseOverride: string | undefined): Promise<string> {
    const dockerfile = qaBrowserDockerfile(version, baseOverride);
    const tag = `studio-zero/qa-browser:${sha256Hex(dockerfile).slice(0, 12)}`;
    if ((await this.#docker(['image', 'inspect', '--format', '{{.Id}}', tag], { timeoutMs: 15_000 })).exitCode === 0) return tag;
    await this.#ensureImage(/^FROM (\S+)/.exec(dockerfile)![1]!);
    const res = await this.#docker(['build', '--quiet', '--tag', tag, '-'], { stdin: dockerfile, timeoutMs: 20 * 60 * 1000 });
    if (res.exitCode !== 0) throw new SandboxError('could not build the QA browser image', lastLine(res.stderr));
    return tag;
  }

  /** The image sandboxes run: the configured one as is, or one built once from the base and tagged by its recipe. */
  async #sandboxImage(): Promise<string> {
    if (this.#config.runtime.image !== undefined) return this.#baseImage();
    const dockerfile = sandboxDockerfile(this.#config.runtime.baseImage);
    const tag = `studio-zero/sandbox:${sha256Hex(dockerfile).slice(0, 12)}`;
    if ((await this.#docker(['image', 'inspect', '--format', '{{.Id}}', tag], { timeoutMs: 15_000 })).exitCode === 0) return tag;
    await this.#ensureImage(this.#config.runtime.baseImage);
    // `docker build -` reads the Dockerfile from stdin and sends no build context.
    const res = await this.#docker(['build', '--quiet', '--tag', tag, '-'], { stdin: dockerfile, timeoutMs: 20 * 60 * 1000 });
    if (res.exitCode !== 0) throw new SandboxError('could not build the sandbox image', lastLine(res.stderr));
    return tag;
  }

  async #ensureNetwork(network: string, projectId: string): Promise<void> {
    const res = await this.#docker(['network', 'create', '--label', `studio-zero.project=${projectId}`, network]);
    if (res.exitCode !== 0 && !/already exists/i.test(res.stderr)) throw new SandboxError('could not create network', lastLine(res.stderr));
  }

  async #ensureVolume(volume: string, projectId: string, image: string): Promise<void> {
    const exists = (await this.#docker(['volume', 'inspect', volume], { timeoutMs: 15_000 })).exitCode === 0;
    if (exists) return;
    await this.#must(['volume', 'create', '--label', `studio-zero.project=${projectId}`, volume], 'could not create workspace volume');
    // A fresh named volume is root-owned. Hand it to the sandbox user once, in a throwaway root container.
    await this.#must(
      ['run', '--rm', '--user', '0:0', '--network', 'none', '--mount', `type=volume,source=${volume},target=${WORKSPACE_DIR},volume-nocopy`, image, 'chown', SANDBOX_USER, WORKSPACE_DIR],
      'could not prepare workspace volume',
    );
  }

  async #publishedPorts(container: string): Promise<Map<number, number>> {
    const res = await this.#docker(['port', container], { timeoutMs: 15_000 });
    return res.exitCode === 0 ? parsePortOutput(res.stdout) : new Map();
  }

  async #previewUrls(container: string): Promise<SandboxInfo['previewUrls']> {
    const ports = await this.#publishedPorts(container);
    return [...ports].map(([containerPort, hostPort]) => ({
      containerPort,
      localhost: `http://localhost:${hostPort}`,
      // OrbStack serves every container at <name>.orb.local on the Mac, straight to the container port.
      orbLocal: `http://${container}.orb.local:${containerPort}`,
    }));
  }
}

/**
 * A project, or one of its slots. A slot is a clone of the project in a container of its own (see `Slots`):
 * `slot` counts them from 1, and nothing but this layer reads it. Whatever is handed a project and passes it
 * on down to here reaches the slot instead, with no word of its own changed, which is how a task that runs in
 * a slot uses the same harness, tools, dev server and walk as one that runs in the project's workspace.
 */
export type Place = Project & { slot?: number };

/** 0 for the project's own sandbox. */
export const slotOf = (place: Place): number => place.slot ?? 0;

/** Where a slot sees the project's own workspace, read-only. */
export const SLOT_MAIN_DIR = '/main';

const lifeKey = (place: Place): string => (slotOf(place) > 0 ? `${place.id}#${slotOf(place)}` : place.id);

/**
 * The names of a project's sandbox, or with `slot` of one of its slots. A slot shares the project's network (the
 * QA browser reaches it there) and has a container and a volume of its own. A slot's container name could be
 * another project's (`sz-a-s1` is slot 1 of `a` and the sandbox of a project called `a-s1`): the store keeps
 * container names unique, so the second of the two to be made is refused rather than shared.
 */
export function sandboxNames(slug: string, slot = 0): Pick<SandboxRow, 'container' | 'volume' | 'network'> {
  if (!/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) throw new SandboxError(`invalid project slug: ${JSON.stringify(slug)}`);
  if (!Number.isInteger(slot) || slot < 0 || slot > 9) throw new SandboxError(`invalid slot: ${JSON.stringify(slot)}`);
  return slot > 0 ? { container: `sz-${slug}-s${slot}`, volume: `sz-${slug}-s${slot}-ws`, network: `sz-${slug}-net` } : { container: `sz-${slug}`, volume: `sz-${slug}-ws`, network: `sz-${slug}-net` };
}

/** Lexically confines a path to /workspace. This is hygiene for file tools; the container is the actual boundary. */
export function resolveInWorkspace(path: string): string {
  const resolved = posix.resolve(WORKSPACE_DIR, path);
  if (resolved !== WORKSPACE_DIR && !resolved.startsWith(`${WORKSPACE_DIR}/`)) throw new SandboxError(`path escapes ${WORKSPACE_DIR}: ${path}`);
  return resolved;
}

/** Parses `docker port` output (`3000/tcp -> 127.0.0.1:55001`) into container port → host port. */
export function parsePortOutput(output: string): Map<number, number> {
  const ports = new Map<number, number>();
  for (const line of output.split('\n')) {
    const match = /^(\d+)\/tcp -> (?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]):(\d+)$/i.exec(line.trim());
    if (match && !ports.has(Number(match[1]))) ports.set(Number(match[1]), Number(match[2]));
  }
  return ports;
}

function lastLine(text: string): string {
  return text.trim().split('\n').at(-1)?.slice(0, 400) ?? '';
}

function toCheckpoint(row: CheckpointRow): Checkpoint {
  return { id: row.id, projectId: row.projectId, taskId: row.taskId, label: row.label, commit: row.commit, createdAt: row.createdAt };
}

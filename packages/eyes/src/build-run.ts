import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * A build run started by `sz-codex-build` holds the project it works in: its contracts are recorded by its own
 * workers, each verdict by one who did not build. (2026-11-23: the owner's Codex session started the runner, and
 * went on doing the same milestone by hand in the same folder. At 76 minutes the runner stopped on a file left
 * uncommitted, and the session finished the build with agents it spawned, which carried its whole conversation:
 * the "independent" verifiers had read the builder's conclusions, the rule that a look after a fix tries new cases
 * only where the fix reached no longer applied, and twelve screens and a keyboard flow were shot three times,
 * twice within two minutes, for changes that did not reach them.)
 *
 * The run keeps a record in the repository's git folder, where nothing commits it: who runs (its pid), since when,
 * and the hash of a token only its workers are given. While the record is there, the ledger takes nothing from a
 * process without that token: while the run works, to wait for it; once it has stopped, to start it again, since it
 * resumes from `.sz`.
 */

export const BUILD_RUN_NAME = 'sz-build-run.json';
export const BUILD_TOKEN_ENV = 'SZ_BUILD_TOKEN';

export type BuildRun = { pid: number; tokenHash: string; startedAt: string; request: string; stoppedAt?: string; stopped?: string };

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** The git folder that holds the record: the repository's common one, so a worktree under `.sz/trees/` finds the same. */
function gitFolderOf(project: string): string | null {
  for (let dir = resolve(project); ; dir = dirname(dir)) {
    const dot = join(dir, '.git');
    const stat = lstatSync(dot, { throwIfNoEntry: false });
    if (stat?.isDirectory()) return dot;
    if (stat?.isFile()) {
      const own = /^gitdir: (.+)$/m.exec(readFileSync(dot, 'utf8'))?.[1];
      if (!own) return null;
      const index = resolve(dir, own.trim());
      const common = join(index, 'commondir');
      return existsSync(common) ? resolve(index, readFileSync(common, 'utf8').trim()) : index;
    }
    if (dirname(dir) === dir) return null;
  }
}

/** Where a project's run record is kept: in its git folder, or under `.sz` when it has none. */
export function buildRunFile(project: string): string {
  const git = gitFolderOf(project);
  return git ? join(git, BUILD_RUN_NAME) : join(resolve(project), '.sz', BUILD_RUN_NAME);
}

export function readBuildRun(project: string): BuildRun | null {
  try {
    return JSON.parse(readFileSync(buildRunFile(project), 'utf8')) as BuildRun;
  } catch {
    return null;
  }
}

/** Whether a process lives. A sandbox that may not ask says EPERM: that is taken as alive. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Starts the record of a run, and returns the token its workers are given. Refused while another run that has not
 * stopped is alive in the same repository; a record of a run that stopped (or died without a word) is replaced:
 * this run is the one that resumes it.
 */
export function startBuildRun(project: string, request: string, pid = process.pid): string {
  const earlier = readBuildRun(project);
  if (earlier && !earlier.stoppedAt && earlier.pid !== pid && alive(earlier.pid))
    throw new Error(`another build run (pid ${earlier.pid}, started ${earlier.startedAt}) is working in this project: wait for it to end, or end it first`);
  const token = randomBytes(24).toString('hex');
  const file = buildRunFile(project);
  mkdirSync(dirname(file), { recursive: true });
  const run: BuildRun = { pid, tokenHash: hash(token), startedAt: new Date().toISOString(), request: request.slice(0, 300) };
  writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
  return token;
}

/** A run that ended with its result: nothing is held any more. */
export function endBuildRun(project: string): void {
  rmSync(buildRunFile(project), { force: true });
}

/** A run that stopped on an error: the record stays, saying why, until a run starts again. */
export function stopBuildRun(project: string, why: string): void {
  const run = readBuildRun(project);
  if (!run) return;
  writeFileSync(buildRunFile(project), `${JSON.stringify({ ...run, stoppedAt: new Date().toISOString(), stopped: why.slice(0, 600) }, null, 2)}\n`);
}

/** Why the ledger refuses this process now, or null when it may record. */
export function heldByBuildRun(project: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const run = readBuildRun(project);
  if (!run) return null;
  const token = env[BUILD_TOKEN_ENV];
  if (token && hash(token) === run.tokenHash) return null;
  const file = buildRunFile(project);
  const since = `started ${run.startedAt}`;
  if (!run.stoppedAt && alive(run.pid))
    return `a build run (sz-codex-build, pid ${run.pid}, ${since}) is working in this project, and only its own workers record its contracts. Wait for it: its stage lines say where it is, and it ends with its result. Change nothing in the project beside it. If no sz-codex-build is running any more, run it again from this project with the same JSON: it resumes from .sz.`;
  const why = run.stopped ? `stopped: ${run.stopped}` : 'ended without saying why';
  return `the build run ${since} ${why}. Its contracts are recorded only by its own workers, so that each verdict comes from one who did not build. Run sz-codex-build again from this project with the same JSON: it resumes from .sz (contracts, verdicts and commits stay). Do not carry the build on by hand or with agents you start. Only if the owner says to finish without it: remove ${file} first.`;
}

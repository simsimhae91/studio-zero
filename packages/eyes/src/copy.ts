import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { allContracts } from './contract.ts';
import { fingerprint } from './fingerprint.ts';
import { EyesError } from './ios.ts';

/**
 * A copy of a product for someone to run beside it: the files of one commit, the dependencies as they are
 * installed in the project's folder, and a stack name of its own, so that it shares no database and no port
 * with the project or with another copy. It is not a repository: what a verifier writes is committed in the
 * project. What the product stored is never copied: a copy starts with its own.
 *
 * Whoever verifies beside others, whoever shows the product to the owner while it is still being verified, and
 * whoever runs flows that would disturb each other on one copy each made these by hand (2026-11-17: fourteen in
 * one first pass, each a `git archive`, a `cp -cR node_modules` and an edit of `project_id`).
 */
export interface Copy {
  folder: string;
  commit: string;
  /** What was cloned from the project's folder, relative to it: dependencies, and what was asked for. */
  cloned: string[];
  /** The stack's name in the copy, when the product has a Supabase configuration; null otherwise. */
  stack: string | null;
  /** Checks an open contract holds that were taken from the project's folder, because the commit does not have them so. */
  carried: string[];
  /** Checks an open contract holds that differ in the project with no correction recorded: left as committed. */
  stale: string[];
}

/** Left in every copy, so that a folder of the product's own is never taken for one. */
export const COPY_MARK = '.sz-copy.json';

const run = (file: string, args: string[], cwd?: string): { code: number | null; out: string; err: string } => {
  const res = spawnSync(file, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { code: res.status, out: res.stdout ?? '', err: res.error?.message || res.stderr || res.signal || `exit ${res.status}` };
};

/** Clones a folder: on this machine's file system a clone costs no time and no space until one side changes. */
function clone(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  const cp = process.platform === 'darwin' ? '/bin/cp' : 'cp';
  const cloned = process.platform === 'darwin' ? run(cp, ['-c', '-R', from, to]) : { code: 1, out: '', err: '' };
  if (cloned.code === 0) return;
  rmSync(to, { recursive: true, force: true });
  const copied = run(cp, ['-R', from, to]);
  if (copied.code !== 0) throw new EyesError(`${from} could not be copied: ${copied.err.trim().split('\n')[0] ?? ''}`);
}

/** The name the Supabase command line would accept, as it cleans one itself. */
const stackName = (name: string): string => name.replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 40);

/**
 * The checks the project's open contracts hold: each frozen path, the contract that holds it and the fingerprint
 * the contract stamped it with. A copy is made from what is committed, and a contract holds more than that while
 * it is open: a flow whoever verified wrote at the first look, a check an arbiter corrected. They are committed
 * when the work closes; until then a copy made from the commit has the old check, or none.
 */
function heldChecks(project: string): { path: string; print: string | undefined; contract: string }[] {
  return allContracts(project)
    .filter(({ contract }) => contract.closedAt === null && contract.frozenAt !== null)
    .flatMap(({ contract }) => contract.frozen.map((path) => ({ path, print: contract.frozenPrints[path], contract: contract.id })));
}

/** The files under a path of the project, relative to the project: the path itself when it is a file. */
function filesUnder(project: string, path: string): string[] {
  const at = join(project, path);
  const stat = lstatSync(at, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink()) return [];
  if (!stat.isDirectory()) return [path];
  return readdirSync(at).filter((entry) => entry !== 'node_modules' && entry !== '.git').sort().flatMap((entry) => filesUnder(project, join(path, entry)));
}

export function makeCopy(project: string, folder: string, opts: { at?: string; with?: readonly string[] }): Copy {
  const from = resolve(project);
  const to = resolve(folder);
  if (!existsSync(from)) throw new EyesError(`${from} is not there`);
  const inside = relative(from, to);
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) throw new EyesError(`a copy lives outside the project's folder (it would be taken for part of the product): ${to}`);
  if (existsSync(to) && readdirSync(to).length > 0) throw new EyesError(`${to} is not empty: a copy is made in a folder of its own`);
  const at = opts.at ?? 'HEAD';
  const found = run('git', ['-C', from, 'rev-parse', '--verify', '--quiet', `${at}^{commit}`]);
  if (found.code !== 0) throw new EyesError(/not a git repository/i.test(found.err) ? `${from} is not a git repository: a copy is made from what is committed` : `no commit "${at}" in ${from}`);
  const commit = found.out.trim();
  const tracked = run('git', ['-C', from, 'ls-tree', '-r', '--name-only', commit]).out.split('\n').filter(Boolean);
  // What is asked for besides: looked at before anything is written, so that a refused copy leaves nothing behind.
  const extra = (opts.with ?? []).map((path) => path.replace(/\/+$/, ''));
  for (const path of extra) {
    const rel = relative(from, resolve(from, path));
    if (isAbsolute(path) || rel === '' || rel.startsWith('..')) throw new EyesError(`--with takes a path inside the project: ${path}`);
    if (!existsSync(join(from, rel))) throw new EyesError(`${path} is not there in ${from}: build it first, as the map says`);
    if (tracked.some((file) => file === rel || file.startsWith(`${rel}/`))) throw new EyesError(`${path} is part of what is committed, and the copy has it as committed: --with is for what is built or installed and not in git`);
  }
  const hadFolder = existsSync(to);
  try {
    mkdirSync(to, { recursive: true });
    // Everything of the commit but the pictures kept as evidence: thousands of files nobody runs.
    // The native Codex sandbox admits /bin/sh; looking up sh through the session's PATH can return EPERM.
    const shell = process.platform === 'darwin' ? '/bin/sh' : 'sh';
    const unpacked = run(shell, ['-c', 'git -C "$1" archive "$2" -- . ":(exclude).sz/evidence" | tar -x -C "$3"', 'sh', from, commit, to]);
    if (unpacked.code !== 0) throw new EyesError(`the files of ${commit.slice(0, 7)} could not be laid out in ${to}: ${unpacked.err.trim().split('\n')[0]}`);
    // Dependencies where they are installed: beside each package file of the commit.
    const depth = (dir: string): number => (dir === '.' ? 0 : dir.split('/').length);
    const packages = tracked.filter((file) => basename(file) === 'package.json').map((file) => dirname(file)).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
    const cloned: string[] = [];
    for (const rel of [...packages.map((dir) => (dir === '.' ? 'node_modules' : `${dir}/node_modules`)), ...extra.map((path) => relative(from, resolve(from, path)))]) {
      if (cloned.includes(rel) || !existsSync(join(from, rel)) || existsSync(join(to, rel))) continue;
      clone(join(from, rel), join(to, rel));
      cloned.push(rel);
    }
    // A stack is told from another by its name: two copies under one name would share containers and a database.
    let stack: string | null = null;
    const config = join(to, 'supabase', 'config.toml');
    if (existsSync(config)) {
      const text = readFileSync(config, 'utf8');
      const named = /^project_id\s*=\s*"([^"]*)"/m.exec(text);
      if (named) {
        stack = stackName(`${named[1]}-${basename(to)}`);
        writeFileSync(config, text.replace(/^project_id\s*=\s*"[^"]*"/m, `project_id = "${stack}"`));
      }
    }
    // A copy of HEAD is run against the checks the open contracts hold, though the commit does not have them so
    // yet. Only a check whose fingerprint in the project is the one its contract stamped is taken: a frozen file
    // changed with no correction recorded is left as committed and said, since taking it would put a bent check
    // in front of whoever verifies. Nothing else of the working folder comes along, and a copy of an earlier
    // commit (--at) is that commit. (2026-11-26: three verifiers copied `.sz/flows` into their copies by hand,
    // nineteen times, and one ran the flow as it was before its correction.)
    const carried: string[] = [];
    const stale: string[] = [];
    if (opts.at === undefined) {
      for (const held of heldChecks(from)) {
        const rel = relative(from, resolve(from, held.path));
        if (isAbsolute(held.path) || rel === '' || rel.startsWith('..')) continue;
        const differ = filesUnder(from, rel).filter((file) => !existsSync(join(to, file)) || !readFileSync(join(to, file)).equals(readFileSync(join(from, file))));
        if (differ.length === 0) continue;
        const name = `${held.path} (${held.contract})`;
        if (held.print === undefined || fingerprint(from, held.path) !== held.print) {
          if (!stale.includes(name)) stale.push(name);
          continue;
        }
        for (const file of differ) {
          mkdirSync(dirname(join(to, file)), { recursive: true });
          writeFileSync(join(to, file), readFileSync(join(from, file)));
        }
        if (!carried.includes(name)) carried.push(name);
      }
    }
    writeFileSync(join(to, COPY_MARK), `${JSON.stringify({ of: from, commit, made: new Date().toISOString() })}\n`);
    return { folder: to, commit, cloned, stack, carried: carried.sort(), stale: stale.sort() };
  } catch (err) {
    if (hadFolder) for (const entry of readdirSync(to)) rmSync(join(to, entry), { recursive: true, force: true });
    else rmSync(to, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Ends a copy: every stack started in it is stopped, and only then is the folder removed. A stack is known by the
 * folder it was started in, so once the folder is gone nothing stops it by name. (2026-11-19: a verifier stopped
 * its two copies' stacks with a flag the command does not have, threw the refusal away, and removed the folders;
 * the two stacks were found running an hour after the run had ended.)
 *
 * The stacks are found by what the command line keeps of them and stopped each by its id, never by a stop run
 * from the folder: that one finds the stack by the folder and its git branch together, and says "none" with
 * exit 0 when the copy has since been made a repository. (The same night a copy was ended that way with its
 * stack up, and was reported stopped.)
 */
export async function endCopy(folder: string, stacks: { of: (folder: string) => string[]; stop: (id: string, cwd: string) => Promise<boolean> }): Promise<{ folder: string; stacks: number }> {
  const to = resolve(folder);
  if (!existsSync(to)) throw new EyesError(`${to} is not there`);
  if (!existsSync(join(to, COPY_MARK))) throw new EyesError(`${to} was not made by sz-eyes copy (it has no ${COPY_MARK}): nothing was stopped and nothing removed. Only a copy is ended this way, never a folder of the product's own`);
  const ids = stacks.of(to);
  for (const id of ids) {
    if (!(await stacks.stop(id, to))) throw new EyesError(`the stack ${id.slice(0, 12)} of ${to} did not stop (what the command said is above), so the folder is kept: once it is gone the stack can only be stopped by its id. Stop it (sz-eyes supabase stop --stack-id ${id.slice(0, 12)}), and run this again`);
  }
  rmSync(to, { recursive: true, force: true });
  return { folder: to, stacks: ids.length };
}

/** What the command prints: what was made, how it is used, and the folder alone on the last line. */
export function copyText(copy: Copy, project: string): string {
  return [
    `a copy of ${resolve(project)} at ${copy.commit.slice(0, 7)}: its committed files${copy.cloned.length > 0 ? '' : ' (no installed dependencies were found to clone: install them there as the map says)'}`,
    ...(copy.cloned.length > 0 ? [`dependencies and built folders cloned: ${copy.cloned.join(', ')}`] : []),
    ...(copy.stack ? [`its stack is its own: started in that folder (sz-eyes supabase start), it shares no database with the project or with another copy, and ending the copy stops it. supabase/config.toml names it ${copy.stack}`] : []),
    `Nothing the product stored was copied. Launch it there the way the map says, on a port of its own (PORT=$(sz-eyes port)), keep the process id. When you are done, end what you started by that id and then end the copy: sz-eyes copy ${copy.folder} --end${copy.stack ? " (it stops the copy's stack and then removes the folder; never remove the folder yourself, since a stack whose folder is gone cannot be stopped from it)" : ' (it removes the folder)'}. It is not a repository: what you write to keep (a flow, a test) goes in the project's folder.`,
    ...(copy.carried.length > 0 ? [`checks its open contract holds, taken from the project's folder because the commit does not have them so: ${copy.carried.join(', ')}. Everything else in the copy is what is committed`] : []),
    ...(copy.stale.length > 0 ? [`changed in the project with no correction recorded, so the copy has them as committed: ${copy.stale.join(', ')} (sz-eyes contract frozen <id> says which, git diff shows what). A check run from this copy is the committed one, not the project's`] : []),
    copy.folder,
  ].join('\n');
}

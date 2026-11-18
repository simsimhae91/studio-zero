import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
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
}

const run = (file: string, args: string[], cwd?: string): { code: number | null; out: string; err: string } => {
  const res = spawnSync(file, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { code: res.status, out: res.stdout ?? '', err: res.stderr ?? '' };
};

/** Clones a folder: on this machine's file system a clone costs no time and no space until one side changes. */
function clone(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  const cloned = process.platform === 'darwin' ? run('cp', ['-c', '-R', from, to]) : { code: 1, out: '', err: '' };
  if (cloned.code === 0) return;
  rmSync(to, { recursive: true, force: true });
  const copied = run('cp', ['-R', from, to]);
  if (copied.code !== 0) throw new EyesError(`${from} could not be copied: ${copied.err.trim().split('\n')[0] ?? ''}`);
}

/** The name the Supabase command line would accept, as it cleans one itself. */
const stackName = (name: string): string => name.replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 40);

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
    const unpacked = spawnSync('sh', ['-c', 'git -C "$1" archive "$2" -- . ":(exclude).sz/evidence" | tar -x -C "$3"', 'sh', from, commit, to], { encoding: 'utf8' });
    if (unpacked.status !== 0) throw new EyesError(`the files of ${commit.slice(0, 7)} could not be laid out in ${to}: ${(unpacked.stderr ?? '').trim().split('\n')[0] ?? ''}`);
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
    return { folder: to, commit, cloned, stack };
  } catch (err) {
    if (hadFolder) for (const entry of readdirSync(to)) rmSync(join(to, entry), { recursive: true, force: true });
    else rmSync(to, { recursive: true, force: true });
    throw err;
  }
}

/** What the command prints: what was made, how it is used, and the folder alone on the last line. */
export function copyText(copy: Copy, project: string): string {
  return [
    `a copy of ${resolve(project)} at ${copy.commit.slice(0, 7)}: its committed files${copy.cloned.length > 0 ? '' : ' (no installed dependencies were found to clone: install them there as the map says)'}`,
    ...(copy.cloned.length > 0 ? [`dependencies and built folders cloned: ${copy.cloned.join(', ')}`] : []),
    ...(copy.stack ? [`its stack is its own: started in that folder (sz-eyes supabase start), it shares no database with the project or with another copy, and it is stopped from that folder (sz-eyes supabase stop). supabase/config.toml names it ${copy.stack}`] : []),
    'Nothing the product stored was copied. Launch it there the way the map says, on a port of its own (PORT=$(sz-eyes port)), keep the process id, and when you are done end what you started and remove the folder. It is not a repository: what you write to keep (a flow, a test) goes in the project\'s folder.',
    copy.folder,
  ].join('\n');
}

import { posix } from 'node:path';
import { z } from 'zod';
import type { FileEntry, Project } from '@studio-zero/protocol';
import { ConflictError, NotFoundError } from '../app/errors.ts';
import { WORKSPACE_DIR } from '../policy/PolicyEngine.ts';
import { excerpt } from '../util/core.ts';
import { SandboxError, resolveInWorkspace, type OrbStackManager } from './OrbStackManager.ts';

/** Never listed, whatever .gitignore says: version-control internals, installed packages, build output. */
export const OMITTED_DIRECTORIES = ['.git', 'node_modules', '.next', 'dist', 'build', '.expo', '.turbo', '.cache', 'coverage', '.pnpm-store'];

const MAX_ENTRIES = 4000;
/** Largest file the viewer is handed in one piece. Anything longer arrives cut at this size and marked. */
export const MAX_READ_BYTES = 1024 * 1024;

export interface FileListing {
  entries: FileEntry[];
  /** True when the listing stopped at the entry limit. */
  truncated: boolean;
}

export interface FileContent {
  content: string;
  encoding: 'utf-8';
  size: number;
  truncated: boolean;
  binary: boolean;
}

/**
 * Lists a directory level by level. Each level's names go through `git check-ignore` in one batch, so the
 * listing is what the repository considers its own files, including directories that are still empty.
 * Symbolic links are reported as files and never followed.
 */
function listScript(config: { root: string; depth: number; max: number; omit: readonly string[] }): string {
  return `
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const cfg = ${JSON.stringify(config)};
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
function ignored(paths) {
  if (paths.length === 0) return new Set();
  const res = spawnSync('git', ['check-ignore', '-z', '--stdin'], { input: paths.join('\\0') + '\\0', maxBuffer: 32 * 1024 * 1024 });
  return new Set(res.status === 0 ? res.stdout.toString('utf8').split('\\0').filter(Boolean) : []);
}
function main() {
  let st;
  try { st = fs.statSync(cfg.root); } catch { return out({ error: 'missing' }); }
  if (!st.isDirectory()) return out({ error: 'not-a-directory' });
  let count = 0, truncated = false, level = [cfg.root];
  for (let depth = 1; depth <= cfg.depth && level.length > 0 && !truncated; depth++) {
    const found = [];
    for (const dir of level) {
      let names;
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const name of names) if (!cfg.omit.includes(name)) found.push(dir === '.' ? name : dir + '/' + name);
    }
    const skip = ignored(found);
    const next = [];
    for (const p of found) {
      if (skip.has(p)) continue;
      let s;
      try { s = fs.lstatSync(p); } catch { continue; }
      if (count >= cfg.max) { truncated = true; break; }
      count++;
      const d = s.isDirectory();
      out({ p, d, s: d ? 0 : s.size, m: Math.round(s.mtimeMs) });
      if (d) next.push(p);
    }
    level = next;
  }
  out({ done: true, truncated });
}
main();
`;
}

/** Reads one regular file, after resolving links: a link that leaves the workspace is refused, not followed. */
function readScript(config: { path: string; max: number }): string {
  return `
const fs = require('node:fs');
const path = require('node:path');
const cfg = ${JSON.stringify(config)};
// No process.exit: a megabyte written to a pipe is still on its way out when the script reaches its last line.
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
function main() {
  let root, real;
  try { root = fs.realpathSync('.'); real = fs.realpathSync(cfg.path); } catch { return out({ error: 'missing' }); }
  if (real !== root && !real.startsWith(root + path.sep)) return out({ error: 'outside' });
  const st = fs.statSync(real);
  if (!st.isFile()) return out({ error: 'not-a-file' });
  const fd = fs.openSync(real, 'r');
  const buf = Buffer.alloc(Math.min(st.size, cfg.max));
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  const head = buf.subarray(0, n);
  const binary = head.subarray(0, 8192).includes(0);
  out({ size: st.size, truncated: st.size > n, binary, content: binary ? '' : head.toString('utf8') });
}
main();
`;
}

const EntryLine = z.object({ p: z.string().min(1).max(1024), d: z.boolean(), s: z.number().int().min(0), m: z.number().int().min(0) });
const DoneLine = z.object({ done: z.literal(true), truncated: z.boolean() });
const ErrorLine = z.object({ error: z.string() });
const ReadResult = z.object({ size: z.number().int().min(0), truncated: z.boolean(), binary: z.boolean(), content: z.string() });

/**
 * The workspace as files, for the owner's file explorer: list, read, write. Everything happens inside the
 * project's container, on the /workspace volume; nothing is mounted on or copied to the host.
 *
 * The scripts run next to code an agent wrote, so their output is treated like any other sandbox output:
 * schema-checked line by line, paths confined again on this side, limits enforced twice.
 */
export class SandboxFileService {
  readonly #sandboxes: OrbStackManager;

  constructor(deps: { sandboxes: OrbStackManager }) {
    this.#sandboxes = deps.sandboxes;
  }

  async list(project: Project, path = '.', depth = 1): Promise<FileListing> {
    const root = relative(path);
    const res = await this.#sandboxes.exec(project, 'node -', { cwd: WORKSPACE_DIR, stdin: listScript({ root, depth, max: MAX_ENTRIES, omit: OMITTED_DIRECTORIES }), timeoutSec: 30, maxOutputBytes: 8 * 1024 * 1024 });
    if (res.exitCode !== 0) throw new SandboxError(`cannot list ${path}`, excerpt(res.stderr, 300));

    const entries: FileEntry[] = [];
    let truncated = true; // until the terminating line proves the listing is complete
    for (const line of res.stdout.split('\n')) {
      if (line === '') continue;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        continue;
      }
      const failed = ErrorLine.safeParse(json);
      if (failed.success) throw failed.data.error === 'missing' ? new NotFoundError(`directory ${path}`) : new ConflictError(`${path} is not a directory`);
      const done = DoneLine.safeParse(json);
      if (done.success) {
        truncated = done.data.truncated;
        break;
      }
      const entry = EntryLine.safeParse(json);
      if (!entry.success || entries.length >= MAX_ENTRIES) continue;
      const segments = entry.data.p.split('/');
      // The listing must stay under the directory that was asked for, and never name what is always left out.
      if (entry.data.p.startsWith('/') || segments.some((seg) => seg === '' || seg === '..' || seg === '.' || OMITTED_DIRECTORIES.includes(seg))) continue;
      if (root !== '.' && !entry.data.p.startsWith(`${root}/`)) continue;
      entries.push({ path: entry.data.p, name: segments.at(-1)!, type: entry.data.d ? 'directory' : 'file', size: entry.data.s, mtime: entry.data.m });
    }
    // Directories first, then names: the order a file tree is read in.
    entries.sort((a, b) => {
      const [da, db] = [posix.dirname(a.path), posix.dirname(b.path)];
      if (da !== db) return da < db ? -1 : 1;
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });
    });
    return { entries, truncated };
  }

  async read(project: Project, path: string): Promise<FileContent> {
    const target = relative(path);
    if (target === '.') throw new ConflictError('the workspace root is a directory');
    const res = await this.#sandboxes.exec(project, 'node -', { cwd: WORKSPACE_DIR, stdin: readScript({ path: target, max: MAX_READ_BYTES }), timeoutSec: 30, maxOutputBytes: MAX_READ_BYTES * 7 });
    if (res.exitCode !== 0) throw new SandboxError(`cannot read ${path}`, excerpt(res.stderr, 300));
    let json: unknown;
    try {
      json = JSON.parse(res.stdout);
    } catch {
      throw new SandboxError(`cannot read ${path}`, 'the sandbox returned output that is not a file record');
    }
    const failed = ErrorLine.safeParse(json);
    if (failed.success) {
      if (failed.data.error === 'missing') throw new NotFoundError(`file ${path}`);
      throw new ConflictError(failed.data.error === 'outside' ? `${path} is a link that leaves the workspace` : `${path} is not a regular file`);
    }
    const file = ReadResult.parse(json);
    if (Buffer.byteLength(file.content) > MAX_READ_BYTES * 4) throw new SandboxError(`cannot read ${path}`, 'the sandbox returned more than the read limit');
    return { content: file.content, encoding: 'utf-8', size: file.size, truncated: file.truncated, binary: file.binary };
  }

  async write(project: Project, path: string, content: string): Promise<void> {
    const target = relative(path);
    if (target === '.') throw new ConflictError('the workspace root is a directory');
    // The repository's own bookkeeping is not a file to edit by hand: checkpoints and rollback live there.
    if (target.split('/').includes('.git')) throw new ConflictError('files under .git cannot be written from here');
    // The owner's file browser shows the whole repository, so its paths are from the repository's root wherever the product is.
    await this.#sandboxes.writeFile(project, posix.join(WORKSPACE_DIR, target), content);
  }
}

/** A caller's path as a path relative to the workspace root (`.` for the root itself). Throws when it escapes. */
function relative(path: string): string {
  return posix.relative(WORKSPACE_DIR, resolveInWorkspace(path)) || '.';
}

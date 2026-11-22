/**
 * What is left of a closed milestone's evidence: the page the owner reads, and every file a verdict, a notice or a
 * record names. The rest is removed before the milestone is committed.
 *
 * Each look takes its pictures again, and each look after a fix takes them once more under a folder of its own:
 * a web product's two milestones held 10,314 pictures, 2.1 GB, of which the page shows about a hundred
 * (2026-11-22); a phone milestone held 2.5 GB, a gigabyte of it films (2026-11-21). The verdicts point at the last
 * look's pictures. What they do not point at shows nothing that is still claimed.
 *
 * Kept on purpose when in doubt: a file is removed only if nothing names it, the folder it is in, or its own name.
 * A milestone that is open, or has a claim shown false, keeps everything: that is what the fix is worked from.
 */
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE_DIR, SZ_DIR, allContracts, type Contract } from './contract.ts';

export interface Pruned {
  kept: number;
  removed: string[];
  /** Bytes of what was removed (or would be, on a dry run). */
  bytes: number;
}

/** Why nothing of a contract's evidence may be removed yet, or null when it may. */
export function keepsAll(contract: Contract): string | null {
  if (contract.closedAt === null) return 'it is still open';
  const wrong = contract.claims.filter((claim) => claim.status === 'refuted').map((claim) => claim.id);
  if (wrong.length > 0) return `it has ${wrong.length === 1 ? 'a claim' : 'claims'} shown false (${wrong.join(', ')})`;
  return null;
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every file under a folder, by its path from it; a link is never followed and never listed. */
function filesUnder(folder: string, from = ''): string[] {
  const found: string[] = [];
  for (const name of readdirSync(join(folder, from))) {
    const path = from === '' ? name : `${from}/${name}`;
    const stat = lstatSync(join(folder, path));
    if (stat.isDirectory()) found.push(...filesUnder(folder, path));
    else if (stat.isFile()) found.push(path);
  }
  return found;
}

/** Everything written about the project's work that can name a file of evidence. */
function writings(projectDir: string): string {
  const texts: string[] = allContracts(projectDir).map(({ contract }) => JSON.stringify(contract));
  for (const name of ['standing.json', 'backlog.md', 'progress.md', 'spec.md', 'map.md']) {
    const file = join(projectDir, SZ_DIR, name);
    if (existsSync(file)) texts.push(readFileSync(file, 'utf8'));
  }
  return texts.join('\n');
}

/**
 * Removes from a closed contract's evidence folder what nothing names. `dry` only says what would go.
 * A path is named when a claim or a notice lists it as evidence, or when anything written about the work (every
 * contract's words, the standing record, the backlog, the progress file, the spec, the map) holds the file's path,
 * the path of a folder above it, or its own name.
 */
export function pruneEvidence(projectDir: string, contract: Contract, opts: { dry?: boolean } = {}): Pruned {
  const folder = join(projectDir, EVIDENCE_DIR, contract.id);
  if (!existsSync(folder)) return { kept: 0, removed: [], bytes: 0 };
  if (keepsAll(contract) !== null) return { kept: filesUnder(folder).length, removed: [], bytes: 0 };
  const own = `${EVIDENCE_DIR}/${contract.id}/`;
  const fromFolder = (path: string): string => (path.includes(own) ? path.slice(path.indexOf(own) + own.length) : path.replace(/^\.\//, ''));
  const listed = new Set(['report.html', ...contract.claims.flatMap((claim) => claim.evidence), ...contract.noticed.flatMap((item) => item.evidence)].map(fromFolder));
  const text = writings(projectDir);
  // Where a path ends in what was written: at the end, or before anything a path is not made of (a space, a quote,
  // a Korean particle), or before the full stop that ends a sentence.
  const PATH = 'A-Za-z0-9_/*-';
  const END = `(?=$|[^${PATH}.]|[.](?:$|[^${PATH}]))`;
  // A folder is named where its path ends there ("…/pairs/에 있어요", "the look2 folder") or goes on into a pattern
  // ("v6/noticed/exact-*.txt"). A path that goes on into a file names that file, not the folders above it: the last
  // look's picture of a screen does not keep every earlier look's. A folder of one name is a word like any other
  // ("keeps", "path", "steps": a claim's id is often its folder), and counts only where it is written as a
  // folder, with the stroke after it.
  const namesFolder = (dir: string): boolean => new RegExp(`${dir.includes('/') ? '' : '(?:^|[^\\w.-])'}${escaped(dir)}(?:/${dir.includes('/') ? '?' : ''}${END}|/[A-Za-z0-9_.-]*\\*)`, 'm').test(text);
  const named = new Map<string, boolean>();
  const folderNamed = (dir: string): boolean => {
    if (!named.has(dir)) named.set(dir, namesFolder(dir));
    return named.get(dir)!;
  };
  const stays = (path: string): boolean => {
    if (listed.has(path)) return true;
    const parts = path.split('/');
    const name = parts[parts.length - 1]!;
    // What keeps a folder's films out of git stays as long as the folder does.
    if (name === '.gitignore') return true;
    if (parts.length > 1 && text.includes(path)) return true;
    for (let depth = 1; depth < parts.length; depth++) if (folderNamed(parts.slice(0, depth).join('/'))) return true;
    // A file named alone ("probe.txt"), not as the end of another file's path, by a name long enough not to be a word.
    return name.length >= 8 && new RegExp(`(?:^|[^\\w./-])${escaped(name)}(?![\\w-])`, 'm').test(text);
  };
  const removed: string[] = [];
  let kept = 0;
  let bytes = 0;
  for (const path of filesUnder(folder)) {
    if (stays(path)) {
      // What keeps films out of git is no evidence: it is not counted, and goes when its folder is emptied.
      if (!path.endsWith('.gitignore')) kept += 1;
      continue;
    }
    bytes += lstatSync(join(folder, path)).size;
    removed.push(path);
    if (!opts.dry) rmSync(join(folder, path));
  }
  if (!opts.dry) {
    // Folders the removal emptied go with it, deepest first.
    const dirs = [...new Set(removed.flatMap((path) => path.split('/').slice(0, -1).map((_, depth, parts) => parts.slice(0, depth + 1).join('/'))))].sort((a, b) => b.length - a.length);
    for (const dir of dirs) {
      if (!existsSync(join(folder, dir))) continue;
      const left = readdirSync(join(folder, dir));
      if (left.length === 1 && left[0] === '.gitignore') rmSync(join(folder, dir, '.gitignore'));
      if (left.length === 0 || (left.length === 1 && left[0] === '.gitignore')) rmdirSync(join(folder, dir));
    }
  }
  return { kept, removed, bytes };
}

export function prunedText(contract: Contract, done: Pruned, dry: boolean): string {
  const mb = (done.bytes / 1024 ** 2).toFixed(done.bytes < 10 * 1024 ** 2 ? 1 : 0);
  if (done.removed.length === 0) return `${contract.id}: every one of its ${done.kept} evidence file(s) is named by a verdict, a notice or a record. Nothing ${dry ? 'would be' : 'was'} removed.`;
  return `${contract.id}: ${dry ? 'would remove' : 'removed'} ${done.removed.length} file(s), ${mb} MB, that no verdict, notice or record names; ${done.kept} ${dry ? 'would stay' : 'stay'} (the page, and what they name).`;
}

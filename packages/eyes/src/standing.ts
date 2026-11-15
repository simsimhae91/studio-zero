import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { SZ_DIR, addedLate, allContracts, type Claim, type Contract } from './contract.ts';
import { fingerprints } from './fingerprint.ts';

/**
 * A product that lives is changed many times, and each change is made by someone who was not there for the ones
 * before. What earlier work proved is a promise the product keeps: it stands until a later contract says, with
 * a reason the owner sees, that what was asked has changed. This is the record of those promises and of when
 * each was last shown to hold.
 */
export const STANDING_FILE = `${SZ_DIR}/standing.json`;

/** One look at a standing claim after the work that proved it was closed. */
export const Shown = z.object({
  status: z.enum(['holds', 'broken', 'unchecked']),
  at: z.string(),
  note: z.string().max(1200).default(''),
  /** The contract that was being worked on when it was looked at, if any. */
  during: z.string().nullable().default(null),
  /** A fingerprint of each file it is shown by (see `watched`), as they were when it was last shown to hold. */
  files: z.record(z.string(), z.string()).default({}),
});
export type Shown = z.infer<typeof Shown>;

const Ledger = z.object({ shown: z.record(z.string(), Shown).default({}) });
type Ledger = z.infer<typeof Ledger>;

function readLedger(projectDir: string): Ledger {
  const file = join(projectDir, STANDING_FILE);
  if (!existsSync(file)) return { shown: {} };
  return Ledger.parse(JSON.parse(readFileSync(file, 'utf8')));
}

/**
 * Why the record cannot be read, or null when it can. Two branches that each closed a contract leave a merge
 * conflict in it; until it is repaired nobody can tell which promises hold, so nothing is recorded or closed
 * over it, and a session is told instead of being left to think all is well.
 */
export function ledgerProblem(projectDir: string): string | null {
  try {
    readLedger(projectDir);
    return null;
  } catch (err) {
    return `${STANDING_FILE} cannot be read (${err instanceof Error ? err.message.split('\n')[0] : String(err)}): until it is repaired nobody can tell which promises hold. If it is a merge conflict, keep the entries of both sides (for the same claim, the one with the later "at"), then run \`sz-eyes standing\`.`;
  }
}

/** For reading only: a record that cannot be read is treated as empty, and `ledgerProblem` says why. */
function ledgerOrEmpty(projectDir: string): Ledger {
  try {
    return readLedger(projectDir);
  } catch {
    return { shown: {} };
  }
}

function writeLedger(projectDir: string, ledger: Ledger): void {
  const file = join(projectDir, STANDING_FILE);
  mkdirSync(dirname(file), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(ledger.shown).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, `${JSON.stringify(Ledger.parse({ shown: sorted }), null, 2)}\n`);
}

export const keyOf = (contract: string, claim: string): string => `${contract}/${claim}`;

const names = (claim: Claim, path: string): boolean => claim.shownBy.ref.includes(path.replace(/\/$/, ''));

/**
 * The frozen files a claim is shown by, whose change after it was last shown to hold has to be looked at. A
 * flow or test: the files it names, and the helpers no claim names (they serve every check). A command: all of
 * them, since a command usually runs the lot. A look, or what only the owner can judge: none.
 */
export function watched(contract: Contract, claim: Claim): string[] {
  const kind = claim.shownBy.kind;
  if (kind === 'look' || kind === 'owner') return [];
  if (kind === 'command') return contract.frozen;
  const checks = contract.claims.filter((c) => c.shownBy.kind === 'flow' || c.shownBy.kind === 'test');
  const named = contract.frozen.filter((path) => names(claim, path));
  const helpers = contract.frozen.filter((path) => !checks.some((c) => names(c, path)));
  return named.length > 0 ? [...named, ...helpers] : contract.frozen;
}

export interface Standing {
  key: string;
  contract: string;
  request: string;
  closedAt: string;
  claim: Claim;
  /** The last time it was looked at, or null when nobody has since its contract was closed without a record. */
  last: Shown | null;
  /** Files it is shown by that are not as they were when it was last shown to hold; null when that is not known. */
  changed: string[] | null;
}

export interface Retired {
  key: string;
  says: string;
  by: string;
  why: string;
}

/**
 * Every claim that stands: proven in a contract that is closed, and not replaced since. A claim is retired by a
 * contract that has been agreed (frozen), not by a draft of one.
 */
export function standing(projectDir: string): { stands: Standing[]; retired: Retired[] } {
  const all = allContracts(projectDir).map((entry) => entry.contract);
  const ledger = ledgerOrEmpty(projectDir);
  const retiredBy = new Map<string, { by: string; why: string }>();
  for (const contract of all) if (contract.frozenAt !== null) for (const s of contract.supersedes) retiredBy.set(keyOf(s.contract, s.claim), { by: contract.id, why: s.why });
  const stands: Standing[] = [];
  const retired: Retired[] = [];
  for (const contract of all) {
    if (contract.closedAt === null) continue;
    for (const claim of contract.claims) {
      if (claim.status !== 'proven') continue;
      const key = keyOf(contract.id, claim.id);
      const gone = retiredBy.get(key);
      if (gone) {
        retired.push({ key, says: claim.says, ...gone });
        continue;
      }
      const last = ledger.shown[key] ?? null;
      const watch = watched(contract, claim);
      const now = fingerprints(projectDir, watch);
      const stamped = last && Object.keys(last.files).length > 0 ? last.files : null;
      const changed = watch.length === 0 ? [] : stamped ? watch.filter((path) => stamped[path] !== now[path]).sort() : null;
      stands.push({ key, contract: contract.id, request: contract.request, closedAt: contract.closedAt, claim, last, changed });
    }
  }
  return { stands, retired };
}

/**
 * Write down a look at a standing claim. Shown to hold, it is stamped with the files it was shown against, so
 * that a later change to any of them is seen.
 */
export function recordShown(projectDir: string, key: string, look: { status: Shown['status']; note: string; during: string | null; at: string }): Shown {
  const { stands, retired } = standing(projectDir);
  const found = stands.find((s) => s.key === key);
  if (!found) {
    const gone = retired.find((r) => r.key === key);
    throw new Error(gone ? `${key} no longer stands: contract ${gone.by} replaced it (${gone.why})` : `${key} is not a standing claim. Standing: ${stands.map((s) => s.key).join(', ') || '(none)'}`);
  }
  const contract = allContracts(projectDir).find((entry) => entry.contract.id === found.contract)!.contract;
  const shown = Shown.parse({ ...look, files: look.status === 'holds' ? fingerprints(projectDir, watched(contract, found.claim)) : (found.last?.files ?? {}) });
  const ledger = readLedger(projectDir);
  ledger.shown[key] = shown;
  writeLedger(projectDir, ledger);
  return shown;
}

/** When a contract is closed, each claim it proved starts standing, stamped with the files as they are now. */
export function stampClosed(projectDir: string, contract: Contract, at: string): void {
  const ledger = readLedger(projectDir);
  for (const claim of contract.claims) if (claim.status === 'proven') ledger.shown[keyOf(contract.id, claim.id)] = Shown.parse({ status: 'holds', at, note: '', during: contract.id, files: fingerprints(projectDir, watched(contract, claim)) });
  writeLedger(projectDir, ledger);
}

/** Standing claims that were found broken while this contract was being worked on, and are still recorded so. */
export function brokenDuring(projectDir: string, contractId: string): Standing[] {
  return standing(projectDir).stands.filter((s) => s.last?.status === 'broken' && s.last.during === contractId);
}

/** What the owner is told, on a contract's evidence page, about everything that stood before this work. */
export interface Kept {
  total: number;
  holds: number;
  unchecked: number;
  notLooked: number;
  broken: { key: string; says: string; note: string }[];
  /** Frozen files of earlier contracts that changed since they were last shown against. */
  changed: string[];
  retired: { key: string; says: string; why: string; late: boolean }[];
}

export function keptFor(projectDir: string, contract: Contract): Kept {
  const { stands, retired } = standing(projectDir);
  const others = stands.filter((s) => s.contract !== contract.id);
  const looked = (status: Shown['status']): Standing[] => others.filter((s) => s.last?.during === contract.id && s.last.status === status);
  const broken = others.filter((s) => s.last?.status === 'broken');
  return {
    total: others.length,
    holds: looked('holds').length,
    unchecked: looked('unchecked').length,
    notLooked: others.filter((s) => s.last?.during !== contract.id && s.last?.status !== 'broken').length,
    broken: broken.map((s) => ({ key: s.key, says: s.claim.says, note: s.last?.note ?? '' })),
    changed: [...new Set(others.flatMap((s) => s.changed ?? []))].sort(),
    retired: retired.filter((r) => r.by === contract.id).map((r) => ({ key: r.key, says: r.says, why: r.why, late: contract.supersedes.some((s) => keyOf(s.contract, s.claim) === r.key && addedLate(contract, s)) })),
  };
}

const day = (iso: string): string => iso.slice(0, 10);

/** The standing claims as whoever re-shows them reads them. */
export function renderStanding(projectDir: string): string {
  const { stands, retired } = standing(projectDir);
  if (stands.length === 0 && retired.length === 0) return 'nothing stands yet: no closed contract of this project has a proven claim';
  const lines: string[] = [`${stands.length} claim(s) stand, proven by earlier work and to be kept true:`];
  for (const contract of [...new Set(stands.map((s) => s.contract))]) {
    const own = stands.filter((s) => s.contract === contract);
    lines.push('', `contract ${contract} (closed ${day(own[0]!.closedAt)}): ${own[0]!.request}`);
    for (const s of own) {
      const last = s.last ? `${s.last.status} ${day(s.last.at)}${s.last.during && s.last.during !== contract ? ` during ${s.last.during}` : ''}` : 'not looked at since it was closed';
      lines.push(`  - ${s.key} [${last}] ${s.claim.says}`, `      shown by ${s.claim.shownBy.kind}: ${s.claim.shownBy.ref}${s.last?.status === 'broken' && s.last.note ? `\n      broken: ${s.last.note}` : ''}`);
    }
    const changed = [...new Set(own.flatMap((s) => s.changed ?? []))];
    if (changed.length > 0) lines.push(`  check files changed since these were last shown to hold: ${changed.join(', ')} (read what changed: does each still check what its claim says?)`);
    else if (own.some((s) => s.changed === null)) lines.push('  (whether its check files changed since is not known: they are stamped the next time a claim is shown to hold)');
  }
  if (retired.length > 0) lines.push('', 'no longer standing (what was asked changed):', ...retired.map((r) => `  - ${r.key} ${r.says}\n      replaced by contract ${r.by}: ${r.why}`));
  return lines.join('\n');
}

/** One line for the start of a session, or nothing when no claim stands. */
export function standingSummary(projectDir: string): string {
  const { stands } = standing(projectDir);
  if (stands.length === 0) return '';
  const broken = stands.filter((s) => s.last?.status === 'broken').length;
  const changed = new Set(stands.flatMap((s) => s.changed ?? [])).size;
  return `${stands.length} claim(s) proven by earlier work stand (sz-eyes standing lists them)${broken > 0 ? `; ${broken} recorded broken` : ''}${changed > 0 ? `; ${changed} of their check file(s) changed since last shown` : ''}. A change keeps them true or says in its contract which it replaces.`;
}

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * A contract and the record of standing claims are each one file that several processes change: three verifiers
 * look at a product at once, and each records on the same contract. Each read the whole file, changed it and wrote
 * it back, so a verdict written first could be overwritten by the next writer and read back as unproven (16
 * verdicts recorded at the same moment lost 5 to 9). Whoever changes such a file does it inside this lock, and
 * writes it whole in one step.
 *
 * The lock is a folder beside the file. Making a folder that is already there fails, on every system, so of
 * two processes only one makes it. Inside it the holder leaves a token, `<pid>.<random>.json`, which says who
 * holds it in a message and lets a holder give back only what is its own. Nothing slow happens inside the lock
 * (only reading, changing and writing the file): it is held for milliseconds.
 */

/** The folder that is the lock of a file. */
export const lockPathOf = (target: string): string => `${target}.lock`;

/** Locks this process holds, by folder, with the token it left in each. */
const held = new Map<string, string>();
let givenBackAtExit = false;

const codeOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code;
const unique = (): string => `${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
const setting = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const pause = new Int32Array(new SharedArrayBuffer(4));
/** Sleeps without spinning: the thread is parked until the time is up. */
const sleep = (ms: number): void => void Atomics.wait(pause, 0, 0, Math.max(0, ms));

/** Who holds a lock, when its token can be read. */
function holderOf(lock: string): { pid: number; at: string } | null {
  try {
    const name = readdirSync(lock).find((entry) => entry.endsWith('.json'));
    if (!name) return null;
    const token = JSON.parse(readFileSync(join(lock, name), 'utf8')) as { pid?: unknown; at?: unknown };
    return typeof token.pid === 'number' && typeof token.at === 'string' ? { pid: token.pid, at: token.at } : null;
  } catch {
    return null;
  }
}

/**
 * A lock older than the stale time was abandoned (its process ended inside it), whoever made it: nothing
 * legitimate holds it for more than milliseconds. Whether its process is alive is not asked: process numbers are
 * reused, and a lock never reclaimed from a live number would stop every writer after one crash. It is moved
 * aside, never deleted where it is: of two processes that both find it stale only one moves it, the other finds
 * nothing to move and tries again, and neither can delete a lock someone has just taken afresh.
 */
function reclaimIfAbandoned(lock: string, staleMs: number): boolean {
  let age: number;
  try {
    age = Date.now() - statSync(lock).mtimeMs;
  } catch (err) {
    if (codeOf(err) === 'ENOENT') return false;
    throw err;
  }
  if (age <= staleMs) return false;
  const aside = `${lock}.${unique()}.abandoned`;
  try {
    renameSync(lock, aside);
  } catch (err) {
    if (codeOf(err) === 'ENOENT') return false;
    throw err;
  }
  rmSync(aside, { recursive: true, force: true });
  return true;
}

function acquire(target: string, lock: string): void {
  const staleMs = setting('SZ_LOCK_STALE_MS', 30_000);
  const timeoutMs = setting('SZ_LOCK_TIMEOUT_MS', 15_000);
  mkdirSync(dirname(lock), { recursive: true });
  const started = Date.now();
  let wait = 2;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (err) {
      if (codeOf(err) !== 'EEXIST') throw err;
    }
    if (reclaimIfAbandoned(lock, staleMs)) continue;
    const waited = Date.now() - started;
    if (waited >= timeoutMs) {
      const holder = holderOf(lock);
      throw new Error(
        `${target} is being changed by another process: waited ${waited} ms for its lock (${lock})${holder ? `, held by process ${holder.pid} since ${holder.at}` : ''}. A lock older than ${staleMs} ms is taken as abandoned: if no sz-eyes command is running, run this again after that.`,
      );
    }
    sleep(Math.min(wait + Math.random() * 3, timeoutMs - waited));
    wait = Math.min(50, wait * 2);
  }
  const token = join(lock, `${unique()}.json`);
  try {
    writeFileSync(token, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`);
  } catch (err) {
    rmSync(lock, { recursive: true, force: true });
    throw err;
  }
  held.set(lock, token);
  if (!givenBackAtExit) {
    givenBackAtExit = true;
    process.on('exit', () => {
      for (const lock of [...held.keys()]) {
        try {
          release(lock);
        } catch {
          // Exiting: what cannot be given back goes stale and is reclaimed.
        }
      }
    });
  }
}

/**
 * Gives back a lock: its own token first, then the folder. If the token is gone, this holder was held up past
 * the stale time and its lock was reclaimed: the folder there now is someone else's and is left alone. And a
 * folder holding someone else's token is never removed, since it is removed only when empty.
 */
function release(lock: string): void {
  const token = held.get(lock);
  held.delete(lock);
  if (token === undefined) return;
  try {
    unlinkSync(token);
  } catch (err) {
    if (codeOf(err) === 'ENOENT') return;
    throw err;
  }
  try {
    rmdirSync(lock);
  } catch (err) {
    const code = codeOf(err);
    if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw err;
  }
}

/**
 * Runs `run` while holding the lock of `target`, and gives it back however `run` ends. Waits while someone else
 * holds it, and throws after `SZ_LOCK_TIMEOUT_MS` (15 s) saying who. A process that already holds the lock and
 * asks for it again is refused at once: it would otherwise wait for itself.
 */
export function withFileLock<T>(target: string, run: () => T): T {
  const lock = lockPathOf(resolve(target));
  if (held.has(lock)) throw new Error(`this process already holds the lock of ${target}: taking it again would wait for itself forever`);
  acquire(target, lock);
  try {
    return run();
  } finally {
    release(lock);
  }
}

/**
 * Writes a file whole in one step: what is written goes to a file of its own beside it, which then takes its place. A
 * reader with no lock sees the whole file as it was or the whole file as it is now, never half of one.
 */
export function writeFileAtomic(target: string, data: string | Uint8Array): void {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.${unique()}.tmp`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

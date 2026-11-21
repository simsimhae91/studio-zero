/**
 * One Maestro driver held up for a simulator, for as long as the simulator is being looked at.
 *
 * Every `maestro` command starts a Java process and a driver on the simulator: eight seconds for a screen's tree
 * and eleven for a flow of two steps, on a quiet Mac, and most of the stops in a run that were not the product's
 * came at that start (2026-11-21: 31 times the driver's port refused or its check failed). Maestro's own
 * long-lived server keeps a driver up but serves every simulator through one port: asked for the second
 * simulator's screen it answered with the first's, so it cannot be used where two verifiers each have one.
 *
 * So the command line itself holds the driver: one flow whose only step waits in a request to this process, on a
 * port of that simulator's own. While it waits, the driver answers a screen's tree in a tenth of a second when
 * asked directly, and a flow started on the same port finds the driver already there. When the holder lets go the
 * flow ends, Maestro stops the driver, and nothing is left running.
 *
 * The holder ends by itself: when it is told to (`sz-eyes ios rest`), when the simulator is no longer up, when
 * nothing has asked for twenty minutes, or when its flow or its driver has gone.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { treeOfDriver, type MaestroNode } from './ios-driver.ts';
import { freePort } from './port.ts';

/** What is kept of a held driver, for whoever looks next. */
export interface Held {
  udid: string;
  /** The holder's own process. */
  pid: number;
  /** The driver's port on this machine: Maestro's commands for this simulator are given it. */
  port: number;
  /** The holder's own port: where it is told that it was used, and to let go. */
  door: number;
  /** The screen's size in points, as the driver gives it. */
  size: { w: number; h: number };
  /** Whether the tree read from the driver was the tree `maestro hierarchy` printed, when both were asked at the start. */
  agrees: boolean;
  at: string;
}

export const heldDir = (env: NodeJS.ProcessEnv = process.env): string => (env.SZ_HELD_DIR ? resolve(env.SZ_HELD_DIR) : join(homedir(), '.studio-zero', 'eyes', 'held'));
const fileOf = (udid: string): string => join(heldDir(), `${udid}.json`);
const startingOf = (udid: string): string => join(heldDir(), `${udid}.starting`);
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** The holder of a simulator's driver, if one is up. A record whose holder has gone is cleared away. */
export function heldNow(udid: string): Held | null {
  const file = fileOf(udid);
  if (!existsSync(file)) return null;
  try {
    const held = JSON.parse(readFileSync(file, 'utf8')) as Held;
    if (alive(held.pid)) return held;
  } catch {
    // An unreadable record is a stale one.
  }
  rmSync(file, { force: true });
  return null;
}

/** Asks the held driver something, as Maestro does. */
async function ask(port: number, path: string, body?: unknown, timeoutMs = 20_000): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}/${path}`, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`the driver answered ${response.status} to ${path}`);
  return response.json();
}

const treeFrom = async (port: number, size: { w: number; h: number }): Promise<MaestroNode> => treeOfDriver(await ask(port, 'viewHierarchy', { appIds: [], excludeKeyboardElements: false }), size);

/**
 * The screen's tree from the held driver, or null when it cannot be had that way (no holder, a holder whose
 * reading did not agree with Maestro's, a driver that does not answer): whoever asked then asks Maestro itself.
 */
export async function heldTree(held: Held): Promise<MaestroNode | null> {
  if (!held.agrees) return null;
  try {
    const tree = await treeFrom(held.port, held.size);
    touchHeld(held);
    return tree;
  } catch {
    return null;
  }
}

/** Whether a held driver still answers: another command that starts a driver of its own on the simulator ends the one that was held. */
export async function driverAnswers(held: Held): Promise<boolean> {
  try {
    await ask(held.port, 'deviceInfo', undefined, 5_000);
    return true;
  } catch {
    return false;
  }
}

/** Tells the holder that its driver was used just now, so that it does not go for want of use. */
export function touchHeld(held: Held): void {
  void fetch(`http://127.0.0.1:${held.door}/used`, { signal: AbortSignal.timeout(2_000) }).catch(() => undefined);
}

/**
 * The holder for a simulator: the one that is up, or one started now and waited for. Null when none could be
 * started in time; the commands then work as they did without one.
 */
export async function ensureHeld(udid: string, opts: { waitMs?: number; startMs?: number; cli?: string } = {}, again = true): Promise<Held | null> {
  const now = heldNow(udid);
  if (now) return now;
  const cli = opts.cli ?? fileURLToPath(new URL('./cli.ts', import.meta.url));
  mkdirSync(heldDir(), { recursive: true });
  const mark = startingOf(udid);
  // A mark left by a start that died does not stop the next one: its holder's process is gone, or no holder
  // ever took it over.
  const dead = (): boolean => {
    try {
      const pid = Number(readFileSync(mark, 'utf8'));
      if (Number.isInteger(pid) && pid > 0) return !alive(pid);
      return Date.now() - statSync(mark).mtimeMs > (opts.startMs ?? 20_000);
    } catch {
      return false;
    }
  };
  if (dead()) rmSync(mark, { force: true });
  // The mark is written here, before the holder's process exists, by whoever starts it: a process takes longer
  // to come up than a caller would wait for a sign of it, and a caller that saw no sign started a driver of its own
  // beside the one that was coming (two drivers fought over one simulator: "iOS driver not ready in time").
  let mine = false;
  try {
    writeFileSync(mark, 'starting', { flag: 'wx' });
    mine = true;
  } catch {
    // someone else is starting one: wait for theirs
  }
  if (mine) {
    const log = openSync(join(heldDir(), `${udid}.log`), 'a');
    try {
      spawn(process.execPath, [...process.execArgv, cli, 'ios', 'hold', udid], { detached: true, stdio: ['ignore', log, log] }).unref();
    } finally {
      closeSync(log);
    }
  }
  const until = Date.now() + (opts.waitMs ?? 120_000);
  while (Date.now() < until) {
    const held = heldNow(udid);
    if (held) return held;
    // A holder that gave up has taken the mark away again.
    if (!existsSync(mark)) return heldNow(udid);
    if (dead()) {
      rmSync(mark, { force: true });
      // Whoever was waiting on another's start that died starts one itself, once.
      return again && !mine ? ensureHeld(udid, opts, false) : heldNow(udid);
    }
    await pause(250);
  }
  return null;
}

/** Lets a simulator's driver go, and waits until its holder has ended. True when there was one. */
export async function releaseHeld(udid: string, waitMs = 20_000): Promise<boolean> {
  const held = heldNow(udid);
  if (!held) return false;
  await fetch(`http://127.0.0.1:${held.door}/release`, { signal: AbortSignal.timeout(3_000) }).catch(() => undefined);
  const until = Date.now() + waitMs;
  while (alive(held.pid) && Date.now() < until) await pause(200);
  return true;
}

const booted = (udid: string): boolean => {
  const res = spawnSync('xcrun', ['simctl', 'list', 'devices', 'booted'], { encoding: 'utf8', timeout: 20_000 });
  // When the question cannot be asked, the simulator is taken to be up: the other ends still apply.
  return res.status !== 0 || res.stdout.includes(udid);
};

/** The processes started by one, so that none is left when it has to be ended by force. */
const childrenOf = (pid: number): number[] => {
  const res = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.split('\n').map((line) => Number(line.trim())).filter((n) => Number.isInteger(n) && n > 0) : [];
};

/**
 * Holds a driver up for a simulator until it is let go. This is the whole life of the process `sz-eyes ios hold`
 * starts: it returns when the holder has ended, 0 when it held, 1 when it never could.
 */
export async function holdDriver(udid: string, opts: { idleMs?: number; checkMs?: number; say?: (line: string) => void; up?: (udid: string) => boolean } = {}): Promise<number> {
  const say = opts.say ?? (() => undefined);
  const idleMs = opts.idleMs ?? (process.env.SZ_HELD_IDLE_S ? Number(process.env.SZ_HELD_IDLE_S) * 1000 : 20 * 60_000);
  mkdirSync(heldDir(), { recursive: true });
  if (heldNow(udid)) {
    say('already held');
    return 0;
  }
  // One holder a simulator: whoever writes the mark first is the one.
  const mark = startingOf(udid);
  // The mark may be there already, written by whoever started this process: it is taken over. Only another
  // holder that is alive is stood back for.
  const other = Number(existsSync(mark) ? readFileSync(mark, 'utf8') : '');
  if (Number.isInteger(other) && other > 0 && other !== process.pid && alive(other)) {
    say('another holder is starting');
    return 0;
  }
  writeFileSync(mark, String(process.pid));

  const folder = mkdtempSync(join(tmpdir(), 'sz-hold-'));
  let letGo = false;
  let lastPoll = 0;
  let lastUsed = Date.now();
  const waiting = new Set<ServerResponse>();
  const answerAll = (): void => {
    for (const res of waiting) res.end('release');
    waiting.clear();
  };
  const server = createServer((req, res) => {
    if (req.url === '/hold') {
      lastPoll = Date.now();
      if (letGo) return void res.end('release');
      waiting.add(res);
      // A short wait and another, so that no request has to stay open longer than any client would let it.
      setTimeout(() => {
        if (waiting.delete(res)) res.end(letGo ? 'release' : 'again');
      }, 8_000);
      return;
    }
    if (req.url === '/used') lastUsed = Date.now();
    if (req.url === '/release') {
      letGo = true;
      answerAll();
    }
    res.end('ok');
  });
  const door = await new Promise<number>((done) => server.listen(0, '127.0.0.1', () => done((server.address() as { port: number }).port)));
  const port = await freePort();
  // The flow's one step asks this process and asks again until it is told to go, or until nobody answers.
  writeFileSync(join(folder, 'hold.js'), `var again = true\nwhile (again) {\n  try { again = http.get('http://127.0.0.1:${door}/hold').body !== 'release' } catch (e) { again = false }\n}\n`);
  writeFileSync(join(folder, 'hold.yaml'), 'appId: com.apple.Preferences\n---\n- runScript: hold.js\n');
  let maestro: ChildProcess | null = spawn('maestro', ['--driver-host-port', String(port), '--device', udid, 'test', '--no-ansi', join(folder, 'hold.yaml')], { cwd: folder, stdio: ['ignore', 'inherit', 'inherit'] });
  let ended = false;
  maestro.once('exit', () => {
    ended = true;
  });
  maestro.once('error', () => {
    ended = true;
  });

  const finish = async (code: number): Promise<number> => {
    letGo = true;
    answerAll();
    rmSync(fileOf(udid), { force: true });
    rmSync(mark, { force: true });
    if (maestro && !ended) {
      const until = Date.now() + 12_000;
      while (!ended && Date.now() < until) await pause(200);
      if (!ended && maestro.pid) {
        // It did not go by itself: it and what it started are ended, each by its own process id.
        const started = childrenOf(maestro.pid);
        maestro.kill('SIGTERM');
        await pause(1_500);
        for (const pid of started) if (alive(pid)) process.kill(pid, 'SIGTERM');
      }
    }
    maestro = null;
    server.close();
    rmSync(folder, { recursive: true, force: true });
    return code;
  };

  // Up when the flow's step has asked for the first time: the driver was started before the flow ran.
  const until = Date.now() + 120_000;
  while (lastPoll === 0 && !ended && Date.now() < until) await pause(200);
  if (lastPoll === 0) {
    say(ended ? 'Maestro ended before its driver was up' : 'the driver was not up within two minutes');
    return finish(1);
  }

  let size: { w: number; h: number };
  let agrees = false;
  try {
    const info = (await ask(port, 'deviceInfo')) as { widthPoints?: number; heightPoints?: number };
    if (!info.widthPoints || !info.heightPoints) throw new Error('the driver gave no size for the screen');
    size = { w: info.widthPoints, h: info.heightPoints };
    // Once, on the screen as it stands: is what is read from the driver what Maestro's own command prints? The
    // screen may move between two readings, so the driver is asked before and after, and again if neither agrees.
    for (let round = 0; round < 3 && !agrees; round++) {
      const before = await treeFrom(port, size);
      const printed = spawnSync('maestro', ['--driver-host-port', String(port), '--device', udid, 'hierarchy'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
      const start = printed.stdout.indexOf('{');
      if (printed.status !== 0 || start === -1) break;
      const theirs = JSON.parse(printed.stdout.slice(start)) as unknown;
      agrees = isDeepStrictEqual(before, theirs) || isDeepStrictEqual(await treeFrom(port, size), theirs);
    }
  } catch (err) {
    say(`the held driver could not be asked: ${err instanceof Error ? err.message : String(err)}`);
    return finish(1);
  }
  const held: Held = { udid, pid: process.pid, port, door, size, agrees, at: new Date().toISOString() };
  writeFileSync(`${fileOf(udid)}.tmp`, JSON.stringify(held));
  renameSync(`${fileOf(udid)}.tmp`, fileOf(udid));
  rmSync(mark, { force: true });
  say(`held: driver on port ${port}${agrees ? '' : ' (its tree did not agree with maestro hierarchy: looks ask Maestro itself)'}`);
  lastUsed = Date.now();

  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => (letGo = true));
  let checked = Date.now();
  while (!letGo) {
    await pause(200);
    if (ended) break;
    if (Date.now() - lastUsed > idleMs) break;
    // The flow asks every eight seconds: silence for half a minute means it has gone.
    if (Date.now() - lastPoll > 30_000) break;
    if (Date.now() - checked > (opts.checkMs ?? 15_000)) {
      checked = Date.now();
      if (!(opts.up ?? booted)(udid)) break;
      // A driver that has stopped answering is not held any more: whoever looks next starts another holder.
      if (!(await driverAnswers(held)) && !(await driverAnswers(held))) break;
    }
  }
  say('let go');
  return finish(0);
}

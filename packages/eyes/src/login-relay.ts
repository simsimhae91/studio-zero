import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { connect } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineEnv, findTool } from './engine.ts';
import { writeFileAtomic } from './lock.ts';
import { OAUTH_CALLBACK_PATH, dropBackends, flowIdOf, loginsDir, readBackends, relayCallback, relayPort, stackNames, type Backend } from './login.ts';

/**
 * The relay: the one address registered with each login provider, on a fixed port of this machine. A person who
 * signs in with Kakao or Google on any product built here is sent back to it, and it sends them on to the backend
 * that started their sign-in, with everything they carried. Which backend that is, it asks each registered
 * backend's own database, as the old daemon did (`ProjectArms.relay`): the auth service wrote the sign-in there
 * when it sent the person out, and `state` carries its id.
 *
 * It holds no key and no secret, and what a person carries back is never written down: the log says only to which
 * product a person was passed, or that none had started their sign-in.
 */

export const RELAY_VERSION = 1;
export const RELAY_WHAT = 'sz-eyes login relay';
/** Where the relay says what it is, so that a second start and a stop can tell it from anything else on the port. */
export const IDENTITY_PATH = '/sz-login-relay';
const PID_FILE = 'relay.json';
const LOG_FILE = 'relay.log';
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What a person who comes back with a sign-in no backend here started is shown: nothing of what is on this machine. */
const NOT_STARTED_HERE = 'This sign-in was not started by a product on this machine, or it has run out. Go back to the product and sign in again.\n이 로그인은 이 Mac의 제품이 시작한 것이 아니거나 시간이 지났습니다. 제품으로 돌아가 다시 로그인하세요.\n';

export class RelayError extends Error {
  /** True when the session's command sandbox is what stood in the way. */
  readonly sandboxed: boolean;
  constructor(message: string, sandboxed = false) {
    super(message);
    this.sandboxed = sandboxed;
  }
}

/** Whether a backend started the sign-in with this id. */
export type Knows = (backend: Backend, flow: string) => Promise<boolean>;

const firstLine = (text: string): string => text.trim().split('\n')[0]?.slice(0, 300) ?? '';
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** Runs a command and keeps what it printed, without holding up anything else the relay is doing. */
function run(file: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv; stdin?: string; timeoutMs?: number }): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(file, args, { env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 20_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', (err) => {
      clearTimeout(timer);
      done({ code: null, stdout, stderr: err.message });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(opts.stdin ?? '');
  });
}

/**
 * A product's database container, as the Supabase command line names it in its stack mode
 * (`supabase-<project>-database-<id>`), found through the container engine.
 */
export async function findDatabase(project: string, env: NodeJS.ProcessEnv): Promise<{ container: string | null; problem: string | null; docker: string | null; engine: NodeJS.ProcessEnv }> {
  const docker = findTool('docker', env);
  const engine = engineEnv(env);
  if (!docker) return { container: null, problem: 'no container engine client (docker) was found on this machine', docker, engine };
  const names = stackNames(project);
  for (const name of names) {
    const listed = await run(docker, ['ps', '--filter', `name=^supabase-${name.replace(/\./g, '\\.')}-database-`, '--format', '{{.Names}}'], { env: engine });
    if (listed.code !== 0) return { container: null, problem: `the container engine did not answer: ${firstLine(listed.stderr)}`, docker, engine };
    const found = listed.stdout.split('\n').map((line) => line.trim()).find((line) => line !== '');
    if (found) return { container: found, problem: null, docker, engine };
  }
  return { container: null, problem: `no running container is named ${names.map((name) => `supabase-${name}-database-*`).join(' or ')}`, docker, engine };
}

/**
 * Asks a backend's database whether it holds the sign-in, the way the old daemon did: one count in
 * `auth.flow_state`, through the database's own container, so that nothing on this machine needs a Postgres client.
 * Only a sign-in's id is ever put to a database, and it is a UUID by then.
 */
export function databaseKnows(env: NodeJS.ProcessEnv, log: (line: string) => void): Knows {
  return async (backend, flow) => {
    if (!UUID.test(flow)) return false;
    const db = await findDatabase(backend.project, env);
    if (!db.container || !db.docker) {
      log(`${backend.project}: its database was not asked: ${db.problem}`);
      return false;
    }
    const asked = await run(db.docker, ['exec', '-i', db.container, 'psql', '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '--single-transaction'], { env: db.engine, stdin: `select count(*) from auth.flow_state where id = '${flow}';\n`, timeoutMs: 30_000 });
    if (asked.code !== 0) {
      log(`${backend.project}: its database could not be asked: ${firstLine(asked.stderr)}`);
      return false;
    }
    return asked.stdout.trim() === '1';
  };
}

/** Whether anything listens at a backend's address: true, false when nothing does, null when it cannot be told. */
export function answers(api: string, timeoutMs = 1500): Promise<boolean | null> {
  const url = new URL(api);
  return new Promise((done) => {
    const socket = connect({ host: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname, port: Number(url.port) });
    const timer = setTimeout(() => {
      socket.destroy();
      done(null);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      done(true);
    });
    socket.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      done(err.code === 'ECONNREFUSED' ? false : null);
    });
  });
}

/**
 * Where a person who comes back from a provider is passed on to: the callback of the backend that sent them out,
 * with everything they carried. Null when no backend here started the sign-in they return from. The target is
 * always a registered backend on this machine; nothing in what the person carries is used as an address. A
 * backend that no longer answers is dropped from the registry here.
 */
export async function route(query: string, deps: { dir: string; knows: Knows; log: (line: string) => void }): Promise<string | null> {
  const state = new URLSearchParams(query).get('state') ?? '';
  const flow = state === '' ? null : flowIdOf(state);
  if (flow === null) {
    deps.log('a person came back with no sign-in that can be looked up');
    return null;
  }
  const reached = await Promise.all(readBackends(deps.dir).map(async (backend) => ({ backend, up: await answers(backend.api) })));
  const gone = reached.filter((r) => r.up === false).map((r) => r.backend);
  if (gone.length > 0) {
    dropBackends(deps.dir, gone);
    for (const backend of gone) deps.log(`dropped ${backend.project} (${backend.api}): it no longer answers`);
  }
  const live = reached.filter((r) => r.up !== false).map((r) => r.backend);
  const known = await Promise.all(live.map(async (backend) => ((await deps.knows(backend, flow).catch(() => false)) ? backend : null)));
  const to = known.find((backend): backend is Backend => backend !== null);
  if (!to) {
    deps.log(`no backend here started the sign-in a person came back from (${live.length} asked)`);
    return null;
  }
  deps.log(`a person was passed on to ${to.project}`);
  return `${to.api}/auth/v1/callback?${query}`;
}

/** The relay's server: the callback, the path where it says what it is, and nothing else. */
export function relayServer(deps: { dir: string; port: number; knows: Knows; log: (line: string) => void }): Server {
  return createServer((req, res) => {
    const raw = req.url ?? '/';
    const path = raw.split('?')[0];
    if (req.method === 'GET' && path === IDENTITY_PATH) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(`${JSON.stringify({ what: RELAY_WHAT, version: RELAY_VERSION, pid: process.pid, port: deps.port, callback: relayCallback(deps.port) })}\n`);
      return;
    }
    if (req.method === 'GET' && path === OAUTH_CALLBACK_PATH) {
      // No token is asked for: the browser arriving here is that person's own, sent by the provider, and all that
      // happens is that it is sent on, with what it carried, to the backend on this machine that started the sign-in.
      const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
      const plain = (): void => void res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(NOT_STARTED_HERE);
      const failed = (err: unknown): null => {
        deps.log(`a person came back and could not be passed on: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      };
      // Whatever one request does, the relay stays up for the next person.
      void route(query, deps)
        .catch(failed)
        .then((to) => {
          try {
            if (to === null) plain();
            else res.writeHead(302, { location: to, 'cache-control': 'no-store' }).end();
          } catch (err) {
            failed(err);
            if (!res.headersSent) plain();
            else res.end();
          }
        });
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found.\n');
  });
}

interface PidFile {
  pid: number;
  port: number;
  version: number;
}

function readPid(dir: string): PidFile | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, PID_FILE), 'utf8')) as Partial<PidFile>;
    return typeof parsed.pid === 'number' ? { pid: parsed.pid, port: Number(parsed.port), version: Number(parsed.version) } : null;
  } catch {
    return null;
  }
}

/** Runs the relay in this process until it is told to stop. What `start` runs, detached. */
export async function serveRelay(env: NodeJS.ProcessEnv): Promise<void> {
  const dir = loginsDir(env);
  const port = relayPort(env);
  mkdirSync(dir, { recursive: true });
  const log = (line: string): void => {
    try {
      appendFileSync(join(dir, LOG_FILE), `${new Date().toISOString()} ${line}\n`);
    } catch {
      // A log that cannot be written stops nobody from signing in.
    }
  };
  const server = relayServer({ dir, port, knows: databaseKnows(env, log), log });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => done());
  });
  writeFileAtomic(join(dir, PID_FILE), `${JSON.stringify({ pid: process.pid, port, version: RELAY_VERSION, started: new Date().toISOString() })}\n`);
  log(`up at ${relayCallback(port)} (pid ${process.pid})`);
  const end = (): void => {
    server.close();
    if (readPid(dir)?.pid === process.pid) rmSync(join(dir, PID_FILE), { force: true });
    log(`stopped (pid ${process.pid})`);
    process.exit(0);
  };
  process.once('SIGTERM', end);
  process.once('SIGINT', end);
}

type Holder = { kind: 'free' } | { kind: 'ours'; pid: number; version: number } | { kind: 'other'; what: string };

/** What holds the relay's port: nothing, a relay of ours (by what it says on its own path), or something else. */
export function whoHolds(port: number, timeoutMs = 2000): Promise<Holder> {
  return new Promise((done) => {
    const req = request({ host: '127.0.0.1', port, path: IDENTITY_PATH, method: 'GET', timeout: timeoutMs, headers: { connection: 'close' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        if (body.length < 4096) body += chunk;
      });
      res.on('end', () => {
        try {
          const said = JSON.parse(body) as { what?: unknown; pid?: unknown; version?: unknown };
          if (said.what === RELAY_WHAT && typeof said.pid === 'number') return done({ kind: 'ours', pid: said.pid, version: Number(said.version) });
        } catch {
          // Not ours.
        }
        const server = res.headers.server;
        done({ kind: 'other', what: `a server that answers HTTP ${res.statusCode}${server ? ` (server: ${server})` : ''}` });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      done({ kind: 'other', what: 'a process that takes connections and does not answer HTTP' });
    });
    req.on('error', (err: NodeJS.ErrnoException) => done(err.code === 'ECONNREFUSED' ? { kind: 'free' } : { kind: 'other', what: `something that ${err.code === 'ECONNRESET' ? 'closes every connection' : `fails (${err.code ?? err.message})`}` }));
    req.end();
  });
}

/** Which process listens on a port, when the machine says (a command's sandbox hides other processes). */
function processOn(port: number): string {
  const listed = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'], { encoding: 'utf8', timeout: 5000 });
  const pid = /^p(\d+)$/m.exec(listed.stdout ?? '')?.[1];
  const command = /^c(.+)$/m.exec(listed.stdout ?? '')?.[1];
  return pid ? `, process ${pid}${command ? ` (${command})` : ''}` : '';
}

/** True when this process is a relay of ours, by its command line. */
function isRelayProcess(pid: number): boolean {
  const shown = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 });
  return /\blogin relay serve\b/.test(shown.stdout ?? '');
}

/**
 * Why the relay may not be started from here, or null. Started inside a session's command sandbox it would stay
 * inside it, where the container engine is closed, and no returning person could be looked up.
 */
function engineClosed(env: NodeJS.ProcessEnv): Promise<string | null> {
  const host = engineEnv(env).DOCKER_HOST ?? (existsSync('/var/run/docker.sock') ? 'unix:///var/run/docker.sock' : undefined);
  if (!host?.startsWith('unix://')) return Promise.resolve(null);
  const path = host.slice('unix://'.length);
  return new Promise((done) => {
    const socket = connect(path);
    socket.once('connect', () => {
      socket.destroy();
      done(null);
    });
    socket.once('error', (err: NodeJS.ErrnoException) =>
      done(err.code === 'EPERM' || err.code === 'EACCES' ? `the relay is not started from inside the session's command sandbox: it asks each product's database through the container engine, which the sandbox closes (${err.code} on ${path}). Run it outside the sandbox (dangerouslyDisableSandbox: true on the Bash call)` : null),
    );
  });
}

/** The relay's environment: what it needs to reach the container engine, and no key or secret a caller held. */
const relayEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(env).filter(([name]) => !/SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|API_KEY|PRIVATE|^(KAKAO|GOOGLE)_CLIENT_ID$|^SUPABASE_AUTH_EXTERNAL_/i.test(name)));

/**
 * The relay up on its port: nothing is started when a relay of ours already answers there; an older one of ours
 * is replaced; a port held by anything else is said, with what holds it, and left alone.
 */
export async function ensureRelay(env: NodeJS.ProcessEnv): Promise<{ started: boolean; port: number; pid: number }> {
  const port = relayPort(env);
  const dir = loginsDir(env);
  let holder = await whoHolds(port);
  if (holder.kind === 'ours' && holder.version === RELAY_VERSION) return { started: false, port, pid: holder.pid };
  if (holder.kind === 'ours') {
    await stopRelay(env);
    holder = await whoHolds(port);
  }
  if (holder.kind !== 'free') {
    const what = holder.kind === 'ours' ? 'a relay of ours that would not stop' : holder.what;
    throw new RelayError(`port ${port} is held by ${what}${processOn(port)}: the relay cannot start there. It is the port of the address registered with the providers (${relayCallback(port)}): free it, or set SZ_LOGIN_RELAY_PORT to another port and register that address instead`);
  }
  const closed = await engineClosed(env);
  if (closed) throw new RelayError(closed, true);
  mkdirSync(dir, { recursive: true });
  const logFile = join(dir, LOG_FILE);
  const before = existsSync(logFile) ? statSync(logFile).size : 0;
  const fd = openSync(logFile, 'a');
  const child = spawn(process.execPath, [CLI, 'login', 'relay', 'serve'], { detached: true, stdio: ['ignore', fd, fd], env: relayEnv(env) });
  closeSync(fd);
  let exited = false;
  child.once('exit', () => (exited = true));
  child.unref();
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    await sleep(100);
    const now = await whoHolds(port, 1000);
    if (now.kind === 'ours') return { started: now.pid === child.pid, port, pid: now.pid };
    if (exited) break;
  }
  if (!exited) child.kill('SIGKILL');
  const said = existsSync(logFile) ? readFileSync(logFile).subarray(before).toString('utf8').trim().split('\n').slice(-5).join('\n') : '';
  throw new RelayError(`the relay did not start on port ${port}${said ? `:\n${said}` : ''}`);
}

/** Ends the relay: only a process that is ours, by what it says on its port or by its own command line. */
export async function stopRelay(env: NodeJS.ProcessEnv): Promise<{ text: string; code: number }> {
  const port = relayPort(env);
  const dir = loginsDir(env);
  const file = readPid(dir);
  const holder = await whoHolds(port);
  const end = async (pid: number): Promise<void> => {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return;
      throw new RelayError(`the relay (process ${pid}) could not be ended from here (${code}): a command inside the session's sandbox cannot signal it. Run this outside the sandbox`, code === 'EPERM');
    }
    // Ended is no longer answering on the port and no longer running as the relay. (Whether the process number is
    // still taken says less: an ended process stays in the table until whoever started it takes note.)
    const still = async (): Promise<boolean> => {
      const now = await whoHolds(port, 500);
      return (now.kind === 'ours' && now.pid === pid) || (alive(pid) && isRelayProcess(pid));
    };
    const until = Date.now() + 5000;
    while (Date.now() < until && (await still())) await sleep(50);
    if (await still()) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Gone in the meantime.
      }
    }
    if (readPid(dir)?.pid === pid) rmSync(join(dir, PID_FILE), { force: true });
  };
  if (holder.kind === 'ours') {
    await end(holder.pid);
    return { text: `stopped: the relay (process ${holder.pid}) at ${relayCallback(port)}`, code: 0 };
  }
  if (file !== null) {
    if (alive(file.pid) && isRelayProcess(file.pid)) {
      await end(file.pid);
      return { text: `stopped: a relay (process ${file.pid}) that no longer answered on port ${port}`, code: 0 };
    }
    rmSync(join(dir, PID_FILE), { force: true });
    return { text: `the relay was not running. Its pid file named process ${file.pid}, which is not the relay: left alone, and the pid file is removed`, code: 0 };
  }
  if (holder.kind === 'other') return { text: `the relay is not running. Port ${port} is held by ${holder.what}${processOn(port)}, which is not the relay: nothing was stopped`, code: 0 };
  return { text: 'the relay is not running: nothing to stop', code: 0 };
}

/** Whether the relay is up, on which address, and which backends it may pass people to. Exits 1 when it is down. */
export async function relayStatus(env: NodeJS.ProcessEnv): Promise<{ text: string; code: number }> {
  const port = relayPort(env);
  const dir = loginsDir(env);
  const holder = await whoHolds(port);
  const backends = readBackends(dir);
  const reach = await Promise.all(backends.map((backend) => answers(backend.api)));
  const lines = [
    holder.kind === 'ours'
      ? `the relay is up at ${relayCallback(port)} (listening on 127.0.0.1:${port}, process ${holder.pid}, version ${holder.version})`
      : `the relay is not running${holder.kind === 'other' ? `, and port ${port} is held by ${holder.what}${processOn(port)}` : ''}. Its address is ${relayCallback(port)}; sz-eyes login relay start (or sz-eyes supabase start) starts it`,
    backends.length === 0
      ? 'no backend is registered: sz-eyes supabase start registers a product\'s stack when the owner\'s keys are in the vault'
      : `backends registered (${backends.length}):\n${backends.map((b, i) => `  ${b.project}  ${b.api}  added ${b.added}${reach[i] === false ? '  (not answering: dropped when the relay next looks)' : ''}`).join('\n')}`,
  ];
  return { text: lines.join('\n'), code: holder.kind === 'ours' ? 0 : 1 };
}

const USAGE = 'sz-eyes login relay start|stop|status';

/** `sz-eyes login relay start|stop|status|serve`. */
export async function loginCommand(command: string | undefined, words: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<{ text: string; code: number }> {
  const verb = words[0];
  if (command !== 'relay') throw new RelayError(USAGE);
  if (verb === 'start') {
    const relay = await ensureRelay(env);
    return { text: relay.started ? `started: the relay is up at ${relayCallback(relay.port)} (process ${relay.pid})` : `already up: the relay at ${relayCallback(relay.port)} (process ${relay.pid}); nothing was started`, code: 0 };
  }
  if (verb === 'stop') return stopRelay(env);
  if (verb === 'status') return relayStatus(env);
  if (verb === 'serve') {
    await serveRelay(env);
    return new Promise(() => undefined);
  }
  throw new RelayError(USAGE);
}

import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Project } from '@studio-zero/protocol';
import type { CommandRunner, RunResult } from '../util/run.ts';
import { loginEnv, usable, withLogins, type LoginKeys, type Provider } from './logins.ts';

/**
 * A project's own backend: a Supabase stack (Postgres, auth, storage, realtime, functions, a mail catcher) that
 * runs on this machine beside the project's sandbox.
 *
 * It is what turns a build from a mock-up inside an app into something that works: a place where a sign-up is a
 * row, where what was written is still there after a restart, and where one user cannot read another's rows.
 * The studio starts it, with Supabase's own command line, in that tool's experimental stack mode: only the
 * database stays awake, the other services wake on their first request and go back to sleep, and every project
 * gets its own ports, its own users and its own data. Measured on the owner's Mac on 2026-11-14: about 65MiB
 * at rest, about 320MiB with auth, REST, storage and mail awake, 1 to 3 seconds to start once the images are
 * here. One stack shared between projects was not an option: users, keys and files would mix.
 *
 * Nothing here goes into a sandbox. A project is handed the address and the publishable key by whoever calls
 * this; the secret key and the database address stay with the daemon.
 */

/** What `supabase start --output-format json` answers with, as far as the studio reads it. */
const Started = z.object({ id: z.string(), env: z.record(z.string(), z.string()) });

export interface StackInfo {
  /** The stack's id in the command line's own registry. */
  id: string;
  /** Where a browser on this machine reaches the API, e.g. `http://127.0.0.1:21459`. Stable across restarts. */
  apiUrl: string;
  /** The same API as a project's sandbox container reaches it. */
  apiUrlFromSandbox: string;
  /** Safe to ship in what a browser downloads. */
  publishableKey: string;
  /** The keys that pass every row's guard, under each name the stack gives them. They never leave the daemon; they are kept to look for. */
  adminKeys: string[];
  /** Postgres, for the daemon's own use (applying a schema, taking a snapshot). */
  dbUrl: string;
  /** The catcher that holds the mail the stack would have sent, when the stack runs one. */
  mailUrl: string | null;
  /** The providers a person can sign in with besides email: those the owner's keys switch on. */
  logins: Provider[];
}

/** How a stack is set up for signing in through a provider: the keys, the one address providers send people back to, and where a person may land afterwards. */
export interface LoginSetup {
  keys: LoginKeys;
  callback: string;
  landings: readonly string[];
}

export class StackError extends Error {
  readonly detail: string;
  constructor(message: string, detail = '') {
    super(message);
    this.name = 'StackError';
    this.detail = detail;
  }
}

/** The first release of the command line that has the stack mode. */
export const MIN_CLI = [2, 119, 0] as const;
/** Left out of every stack: the dashboard and the analytics pipeline are for a person at a desk, and are the heaviest parts. */
const EXCLUDED = 'studio,analytics';
/** Long enough for the images to be fetched the first time (about 1.2GB). */
const START_TIMEOUT_MS = 10 * 60_000;

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Finds the Supabase command line the way the docker client is found: a launchd job's PATH does not hold Homebrew. */
export function resolveSupabaseBin(configured = 'supabase', env: NodeJS.ProcessEnv = process.env): string {
  if (configured.includes('/')) return configured;
  const onPath = (env.PATH ?? '').split(':').filter(Boolean).map((dir) => join(dir, configured));
  return [...onPath, '/opt/homebrew/bin/supabase', '/usr/local/bin/supabase', join(homedir(), '.local/bin/supabase')].find(isExecutableFile) ?? configured;
}

export interface SupabaseStackDeps {
  /** The daemon's home (`~/.studio-zero`): each project's stack is described under `arms/<project id>` there. */
  home: string;
  run: CommandRunner;
  /** Where the container engine listens (`OrbStackManager.engineEndpoint`). */
  engineEndpoint: () => Promise<string>;
  /** The docker client, so that its directory is on the command line's PATH. */
  dockerBin: string;
  /** The command line, used as given. Default: looked for on PATH and where Homebrew puts it. */
  supabaseBin?: string;
  /** The owner's keys for signing in with a provider, read when a stack is started. Without it, email only. */
  loginKeys?: () => Promise<LoginKeys>;
}

export class SupabaseStack {
  readonly #home: string;
  readonly #run: CommandRunner;
  readonly #engineEndpoint: () => Promise<string>;
  readonly #dockerBin: string;
  readonly #bin: string;
  readonly #loginKeys: () => Promise<LoginKeys>;
  /** The keys as last read, for the calls between two starts: the configuration names them, so every call needs them. */
  #keys: LoginKeys = {};
  #checked = false;

  constructor(deps: SupabaseStackDeps) {
    this.#home = deps.home;
    this.#run = deps.run;
    this.#engineEndpoint = deps.engineEndpoint;
    this.#dockerBin = deps.dockerBin;
    this.#bin = deps.supabaseBin ?? resolveSupabaseBin();
    this.#loginKeys = deps.loginKeys ?? (async () => ({}));
  }

  /** Where a project's stack is described. Outside any git repository, on purpose: inside one, the branch would be part of the stack's identity. */
  dir(project: Pick<Project, 'id'>): string {
    return join(this.#home, 'arms', project.id);
  }

  /**
   * The environment every call to the command line is made in.
   *
   * The container engine's configuration is the daemon's own (`~/.studio-zero/docker`, which the sandbox manager
   * keeps): the owner's may name a credential helper that is not installed, as it did on the machine this was
   * first run on, and an image pull then fails before it starts. The tool's telemetry is turned off on every
   * call: it is on by default and would send what the studio runs to the tool's maker.
   */
  async #env(): Promise<NodeJS.ProcessEnv> {
    const path = [dirname(this.#dockerBin), dirname(this.#bin), process.env.PATH ?? '/usr/bin:/bin'].filter((dir) => dir !== '.').join(':');
    return {
      HOME: process.env.HOME ?? homedir(),
      PATH: path,
      DOCKER_HOST: await this.#engineEndpoint(),
      DOCKER_CONFIG: join(this.#home, 'docker'),
      SUPABASE_EXPERIMENTAL_STACK: '1',
      SUPABASE_TELEMETRY_DISABLED: '1',
      DO_NOT_TRACK: '1',
      // The secret half of each provider's key, for the configuration's `env(...)`. It is in no file.
      ...loginEnv(this.#keys),
    };
  }

  async #cli(project: Pick<Project, 'id'>, args: readonly string[], timeoutMs: number): Promise<RunResult> {
    const cwd = this.dir(project);
    mkdirSync(cwd, { recursive: true, mode: 0o700 });
    return this.#run(this.#bin, args, { cwd, env: await this.#env(), timeoutMs });
  }

  /** The command line is there and new enough for the stack mode. Asked once in the life of the daemon. */
  async #check(project: Pick<Project, 'id'>): Promise<void> {
    if (this.#checked) return;
    let res: RunResult;
    try {
      res = await this.#cli(project, ['--version'], 20_000);
    } catch (err) {
      throw new StackError('the Supabase command line was not found: install it (brew install supabase/tap/supabase) to give projects a backend', String(err));
    }
    const version = /(\d+)\.(\d+)\.(\d+)/.exec(res.stdout);
    if (res.exitCode !== 0 || !version) throw new StackError('the Supabase command line did not say its version', lastLines(res.stderr));
    const got = version.slice(1, 4).map(Number);
    const tooOld = got[0]! < MIN_CLI[0] || (got[0] === MIN_CLI[0] && (got[1]! < MIN_CLI[1] || (got[1] === MIN_CLI[1] && got[2]! < MIN_CLI[2])));
    if (tooOld) throw new StackError(`the Supabase command line is ${got.join('.')}; ${MIN_CLI.join('.')} or later is needed (its stack mode)`);
    this.#checked = true;
  }

  /**
   * Brings the project's stack up and says where it is. Safe to call on a stack that is already up: it answers
   * with the same addresses. The first call on a machine fetches the images and can take minutes.
   */
  async start(project: Pick<Project, 'id'>, logins: Omit<LoginSetup, 'keys'> | null = null): Promise<StackInfo> {
    await this.#check(project);
    const fresh = !this.has(project);
    if (fresh) {
      // With the stack mode on, `init` writes a configuration with no fixed ports, which is what lets two projects run at once.
      const init = await this.#cli(project, ['init', '--yes'], 60_000);
      if (init.exitCode !== 0) throw new StackError('the project\'s backend could not be set up', lastLines(init.stderr || init.stdout));
    }
    if (logins) {
      this.#keys = await this.#loginKeys();
      const file = join(this.dir(project), 'supabase', 'config.toml');
      const held = readFileSync(file, 'utf8');
      const wanted = withLogins(held, this.#keys, logins.callback, logins.landings);
      if (wanted !== held) {
        writeFileSync(file, wanted, { mode: 0o600 });
        // A stack that is up read its configuration when it started. It is taken down so that the start below reads this one.
        if (!fresh) await this.#cli(project, ['stop'], 120_000);
      }
    }
    const res = await this.#cli(project, ['start', '--runtime', 'docker', '--exclude', EXCLUDED, '--output-format', 'json'], START_TIMEOUT_MS);
    if (res.exitCode !== 0) throw new StackError(res.timedOut ? 'the project\'s backend did not start in time' : 'the project\'s backend did not start', lastLines(res.stderr || res.stdout));
    return { ...readStarted(res.stdout), logins: logins ? usable(this.#keys) : [] };
  }

  /** Whether this project has a backend: its stack has been set up on this machine. */
  has(project: Pick<Project, 'id'>): boolean {
    return existsSync(join(this.dir(project), 'supabase', 'config.toml'));
  }

  /**
   * Runs a script in the stack's database as the role a migration runs as, all of it or none of it: one
   * transaction, stopped at the first error. The script is the studio's own; whatever a project wrote is inside
   * it as data (see `schema.ts`), because this is `psql` and `psql` obeys backslash commands it reads.
   *
   * It goes in through the database's own container, so the daemon needs no Postgres client of its own. The
   * command line names that container after the folder the stack is described in, which is the project's id.
   */
  async sql(project: Pick<Project, 'id'>, script: string): Promise<RunResult> {
    const env = await this.#env();
    const listed = await this.#run(this.#dockerBin, ['ps', '--filter', `name=^supabase-${project.id}-database-`, '--format', '{{.Names}}'], { env, timeoutMs: 20_000 });
    const db = listed.stdout.split('\n').map((name) => name.trim()).find((name) => name !== '');
    if (!db) throw new StackError('the project\'s database is not running', lastLines(listed.stderr));
    return this.#run(this.#dockerBin, ['exec', '-i', db, 'psql', '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '--single-transaction'], { env, stdin: script, timeoutMs: 180_000 });
  }

  /** Takes the stack down and keeps its data and its ports. Nothing to do, and no error, when it is not up. */
  async stop(project: Pick<Project, 'id'>): Promise<void> {
    if (!this.has(project)) return;
    const res = await this.#cli(project, ['stop'], 120_000);
    if (res.exitCode !== 0) throw new StackError('the project\'s backend did not stop', lastLines(res.stderr || res.stdout));
  }

  /** Deletes the stack and everything in it. For a project that is being removed: there is no way back from this. */
  async destroy(project: Pick<Project, 'id'>): Promise<void> {
    if (!this.has(project)) return;
    const res = await this.#cli(project, ['stack', 'destroy', '--yes'], 180_000);
    if (res.exitCode !== 0) throw new StackError('the project\'s backend could not be deleted', lastLines(res.stderr || res.stdout));
    // With its description gone the project no longer has a backend, and a later one starts from nothing.
    rmSync(this.dir(project), { recursive: true, force: true });
  }
}

const lastLines = (text: string, n = 6): string => text.trim().split('\n').slice(-n).join('\n').slice(0, 2000);

/** Reads the answer of `start`. The command line prints notices of its own around the JSON; the object is found among them. */
export function readStarted(stdout: string): StackInfo {
  const from = stdout.indexOf('{');
  const to = stdout.lastIndexOf('}');
  let parsed: z.infer<typeof Started>;
  try {
    parsed = Started.parse(JSON.parse(stdout.slice(from, to + 1)));
  } catch {
    throw new StackError('the project\'s backend started but did not say where it is', stdout.slice(0, 600));
  }
  const env = parsed.env;
  const apiUrl = env.API_URL;
  const publishableKey = env.PUBLISHABLE_KEY ?? env.ANON_KEY;
  const adminKeys = [env.SECRET_KEY, env.SERVICE_ROLE_KEY].filter((key): key is string => typeof key === 'string' && key !== '');
  if (!apiUrl || !publishableKey || adminKeys.length === 0 || !env.DB_URL) throw new StackError('the project\'s backend did not give its address and keys', Object.keys(env).join(', '));
  const sandbox = new URL(apiUrl);
  // A sandbox container's own 127.0.0.1 is itself; the host is this name there.
  sandbox.hostname = 'host.docker.internal';
  return { id: parsed.id, apiUrl, apiUrlFromSandbox: sandbox.origin, publishableKey, adminKeys, dbUrl: env.DB_URL, mailUrl: env.MAILPIT_URL ?? env.INBUCKET_URL ?? null, logins: [] };
}

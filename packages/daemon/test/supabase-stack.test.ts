// A project's own backend: the Supabase stack the studio starts beside its sandbox. What the studio asks of
// Supabase's command line, in which environment, and what it reads back; and, opt-in, the real thing.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MIN_CLI, StackError, SupabaseStack, readStarted } from '../src/arms/SupabaseStack.ts';
import { resolveDockerBin } from '../src/sandbox/dockerBin.ts';
import { runCommand, type CommandRunner, type RunOptions, type RunResult } from '../src/util/run.ts';

const ok = (stdout = ''): RunResult => ({ exitCode: 0, stdout, stderr: '', truncated: false, timedOut: false, durationMs: 1 });
const STARTED = JSON.stringify({
  id: '5544e7ce750573f1',
  runtime: 'docker',
  lazy_services: ['rest', 'auth'],
  env: { API_URL: 'http://127.0.0.1:21459', DB_URL: 'postgresql://postgres:postgres@127.0.0.1:20253/postgres', PUBLISHABLE_KEY: 'sb_publishable_abc', SECRET_KEY: 'sb_secret_xyz', ANON_KEY: 'anon.jwt', SERVICE_ROLE_KEY: 'service.jwt', MAILPIT_URL: 'http://127.0.0.1:32392' },
});

function fake(answers: Partial<Record<string, RunResult>> = {}): { run: CommandRunner; calls: { file: string; args: string[]; opts: RunOptions }[] } {
  const calls: { file: string; args: string[]; opts: RunOptions }[] = [];
  const run: CommandRunner = async (file, args, opts = {}) => {
    calls.push({ file, args: [...args], opts });
    const key = args[0] === 'stack' ? `stack ${args[1]}` : args[0]!;
    if (key === 'init') {
      mkdirSync(join(opts.cwd!, 'supabase'), { recursive: true });
      writeFileSync(join(opts.cwd!, 'supabase', 'config.toml'), '[experimental]\nstack = true\n');
    }
    return answers[key] ?? (key === '--version' ? ok('2.122.0\n') : key === 'start' ? ok(`A new version of Supabase CLI is available\n${STARTED}\n`) : ok());
  };
  return { run, calls };
}

test('a project\'s stack: set up once, started with the studio\'s own engine configuration and telemetry off, and read back', async () => {
  const home = mkdtempSync(join(tmpdir(), 'sz-arms-'));
  try {
    const { run, calls } = fake();
    const stack = new SupabaseStack({ home, run, engineEndpoint: async () => 'unix:///tmp/engine.sock', dockerBin: '/opt/orb/xbin/docker', supabaseBin: '/opt/homebrew/bin/supabase' });
    const project = { id: 'prj_dues' };
    const info = await stack.start(project);

    assert.deepEqual(info, {
      id: '5544e7ce750573f1',
      apiUrl: 'http://127.0.0.1:21459',
      apiUrlFromSandbox: 'http://host.docker.internal:21459',
      publishableKey: 'sb_publishable_abc',
      adminKeys: ['sb_secret_xyz', 'service.jwt'],
      dbUrl: 'postgresql://postgres:postgres@127.0.0.1:20253/postgres',
      mailUrl: 'http://127.0.0.1:32392',
      logins: [],
    });
    assert.deepEqual(calls.map((c) => c.args.join(' ')), ['--version', 'init --yes', 'start --runtime docker --exclude studio,analytics --output-format json']);
    for (const call of calls) {
      assert.equal(call.file, '/opt/homebrew/bin/supabase');
      assert.equal(call.opts.cwd, join(home, 'arms', 'prj_dues'), 'each project has a folder of its own, outside any repository');
      const env = call.opts.env!;
      assert.deepEqual([env.DOCKER_HOST, env.DOCKER_CONFIG, env.SUPABASE_EXPERIMENTAL_STACK, env.SUPABASE_TELEMETRY_DISABLED, env.DO_NOT_TRACK], ['unix:///tmp/engine.sock', join(home, 'docker'), '1', '1', '1']);
      assert.ok(env.PATH!.startsWith('/opt/orb/xbin:/opt/homebrew/bin:'), 'the docker client and the command line are on its PATH, whatever launchd gave the daemon');
      assert.deepEqual(Object.keys(env).sort(), ['DOCKER_CONFIG', 'DOCKER_HOST', 'DO_NOT_TRACK', 'HOME', 'PATH', 'SUPABASE_EXPERIMENTAL_STACK', 'SUPABASE_TELEMETRY_DISABLED'], 'and nothing else of the daemon\'s environment');
    }

    // Started again, it is not set up again, and the tool is not asked its version twice.
    await stack.start(project);
    assert.deepEqual(calls.slice(3).map((c) => c.args[0]), ['start']);
    await stack.stop(project);
    await stack.destroy(project);
    assert.deepEqual(calls.slice(4).map((c) => c.args.join(' ')), ['stop', 'stack destroy --yes']);
    // A project that never had a backend has nothing to stop or delete.
    await stack.stop({ id: 'prj_none' });
    await stack.destroy({ id: 'prj_none' });
    assert.equal(calls.length, 6);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a stack that cannot be had says why, in words an owner can act on', async () => {
  const home = mkdtempSync(join(tmpdir(), 'sz-arms-'));
  try {
    const make = (answers: Partial<Record<string, RunResult>>): SupabaseStack => new SupabaseStack({ home, run: fake(answers).run, engineEndpoint: async () => 'unix:///tmp/engine.sock', dockerBin: 'docker', supabaseBin: '/x/supabase' });
    await assert.rejects(make({ '--version': ok('2.118.9\n') }).start({ id: 'p1' }), (err: unknown) => err instanceof StackError && err.message === `the Supabase command line is 2.118.9; ${MIN_CLI.join('.')} or later is needed (its stack mode)`);
    await assert.rejects(make({ start: { ...ok(), exitCode: 1, stderr: 'pulling image\nerror getting credentials - err: exec: "docker-credential-desktop": executable file not found' } }).start({ id: 'p2' }), (err: unknown) => err instanceof StackError && err.message === 'the project\'s backend did not start' && err.detail.includes('docker-credential-desktop'));
    await assert.rejects(make({ start: { ...ok(), exitCode: 1, timedOut: true } }).start({ id: 'p3' }), /did not start in time/);
    await assert.rejects(make({ start: ok('Stack is ready.\n') }).start({ id: 'p4' }), /did not say where it is/);
    const missing = new SupabaseStack({ home, run: async () => Promise.reject(new Error('spawn /x/supabase ENOENT')), engineEndpoint: async () => 'unix:///tmp/engine.sock', dockerBin: 'docker', supabaseBin: '/x/supabase' });
    await assert.rejects(missing.start({ id: 'p5' }), /the Supabase command line was not found: install it/);
    // Older releases name the keys differently; the publishable and secret keys are read from either.
    const older = readStarted(JSON.stringify({ id: 'a', env: { API_URL: 'http://127.0.0.1:54321', DB_URL: 'postgresql://x', ANON_KEY: 'anon', SERVICE_ROLE_KEY: 'service' } }));
    assert.deepEqual([older.publishableKey, older.adminKeys, older.mailUrl, older.apiUrlFromSandbox], ['anon', ['service'], null, 'http://host.docker.internal:54321']);
    assert.throws(() => readStarted(JSON.stringify({ id: 'a', env: { API_URL: 'http://127.0.0.1:1' } })), /did not give its address and keys/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/**
 * The real thing, opt-in like the other tests that need the container engine: `SZ_TEST_ENGINE=1`. It starts a
 * stack of its own, carries out the first three lines of the working-prototype contract against it by hand
 * (sign up, come back after a restart, one user's rows closed to another), and deletes it.
 */
test('a real stack: a user signs up, the data outlives a restart, and another user reads nothing', { skip: process.env.SZ_TEST_ENGINE !== '1' && 'set SZ_TEST_ENGINE=1 to run (needs OrbStack and the Supabase command line)' }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'sz-arms-real-'));
  mkdirSync(join(home, 'docker'), { recursive: true });
  writeFileSync(join(home, 'docker', 'config.json'), '{}\n');
  const dockerBin = resolveDockerBin('docker');
  const socket = join(process.env.HOME ?? '', '.orbstack/run/docker.sock');
  const endpoint = existsSync(socket) ? `unix://${socket}` : 'unix:///var/run/docker.sock';
  const stack = new SupabaseStack({ home, run: runCommand, engineEndpoint: async () => endpoint, dockerBin });
  const project = { id: 'prj_stack_test' };
  try {
    const info = await stack.start(project);
    const call = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<{ status: number; json: unknown }> => {
      const res = await fetch(`${info.apiUrl}${path}`, { method: init.method ?? 'GET', headers: { apikey: info.publishableKey, 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const tokenOf = async (path: string, email: string): Promise<string> => ((await call(path, { method: 'POST', body: { email, password: 'correct-horse-9' } })).json as { access_token?: string }).access_token ?? '';

    // The schema goes in as the daemon would put it: over the database address, which no sandbox is given.
    const sql = `create table public.receipts (id bigint generated always as identity primary key, owner uuid not null default auth.uid(), memo text not null);
alter table public.receipts enable row level security;
create policy own on public.receipts for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
grant all on public.receipts to authenticated; grant select on public.receipts to anon; notify pgrst, 'reload schema';`;
    const db = (await runCommand(dockerBin, ['--host', endpoint, 'ps', '--format', '{{.Names}}'], { timeoutMs: 20_000 })).stdout.split('\n').find((name) => name.startsWith('supabase-') && name.includes('-database-'));
    assert.ok(db, 'the stack runs a database container');
    assert.equal((await runCommand(dockerBin, ['--host', endpoint, 'exec', '-i', db, 'psql', '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1'], { stdin: sql, timeoutMs: 60_000 })).exitCode, 0);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const a = await tokenOf('/auth/v1/signup', 'chongmu@example.com');
    const b = await tokenOf('/auth/v1/signup', 'hoewon@example.com');
    assert.ok(a.length > 100 && b.length > 100, 'two users signed up');
    assert.equal((await call('/rest/v1/receipts', { method: 'POST', token: a, body: { memo: '물·간식' } })).status, 201);
    assert.deepEqual((await call('/rest/v1/receipts?select=memo', { token: a })).json, [{ memo: '물·간식' }]);
    assert.deepEqual((await call('/rest/v1/receipts?select=memo', { token: b })).json, [], 'another user reads nothing');
    assert.deepEqual((await call('/rest/v1/receipts?select=memo')).json, [], 'and neither does someone signed out');

    await stack.stop(project);
    const again = await stack.start(project);
    assert.equal(again.apiUrl, info.apiUrl, 'it comes back at the same address');
    const back = await tokenOf('/auth/v1/token?grant_type=password', 'chongmu@example.com');
    assert.deepEqual((await call('/rest/v1/receipts?select=memo', { token: back })).json, [{ memo: '물·간식' }], 'and the row is still there');
  } finally {
    await stack.destroy(project).catch(() => undefined);
    rmSync(home, { recursive: true, force: true });
  }
});

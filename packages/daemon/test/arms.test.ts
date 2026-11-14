// A project's backend as the project meets it: the schema applied from its files, the address and the client
// put into its workspace, and the stack kept in step with the sandbox. With fakes, and opt-in for real.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import type { Project, ProjectTemplate } from '@studio-zero/protocol';
import { ARMS_KIT_DIR, ENV_FILE, armsKitFiles, envBlock, envNames, variantOf, withEnvBlock } from '../src/arms/kit.ts';
import { ProjectArms } from '../src/arms/ProjectArms.ts';
import { applyScript, plan, readApplied, readOutcome, sha256 } from '../src/arms/schema.ts';
import { SupabaseStack } from '../src/arms/SupabaseStack.ts';
import { resolveDockerBin } from '../src/sandbox/dockerBin.ts';
import type { OrbStackManager } from '../src/sandbox/OrbStackManager.ts';
import { runCommand, type CommandRunner, type RunResult } from '../src/util/run.ts';
import { dockerArgs, sampleProject, testDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
const ok = (stdout = ''): RunResult => ({ exitCode: 0, stdout, stderr: '', truncated: false, timedOut: false, durationMs: 1 });
const failed = (stderr: string, stdout = ''): RunResult => ({ ...ok(stdout), exitCode: 3, stderr });

const LEDGER = `create table public.entries (id bigint generated always as identity primary key, owner uuid not null default auth.uid(), memo text not null);
alter table public.entries enable row level security;
create policy own on public.entries for all to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
grant select, insert, update, delete on public.entries to authenticated;
grant select on public.entries to anon;
comment on table public.entries is 'a backslash \\ in a string is data';`;

test('what is applied: migrations once and in name order, the seed whenever it changes, and an edited migration held up', () => {
  const files = [{ name: '0002_b.sql', sql: 'b' }, { name: '0001_a.sql', sql: 'a' }, { name: '0010_c.sql', sql: 'c' }];
  assert.deepEqual(plan(files, 'seed', new Map()), { pending: [{ name: '0001_a.sql', sql: 'a' }, { name: '0002_b.sql', sql: 'b' }, { name: '0010_c.sql', sql: 'c' }], edited: [], seed: 'seed' });
  const applied = readApplied(`0001_a.sql\t${sha256('a')}\n0002_b.sql\t${sha256('was b')}\nseed.sql\t${sha256('seed')}\n`);
  assert.deepEqual(plan(files, 'seed', applied), { pending: [{ name: '0010_c.sql', sql: 'c' }], edited: ['0002_b.sql'], seed: null });
  assert.equal(plan(files, 'seed, changed', applied).seed, 'seed, changed');
  assert.equal(plan(files, '  \n', new Map()).seed, null, 'an empty seed is no seed');
  assert.equal(plan(files, null, new Map()).seed, null);
});

test('the script that applies them: each file as data psql cannot act on, a marker before it, the check last, one row recorded each', () => {
  const script = applyScript({ pending: [{ name: '0001_a.sql', sql: 'create table public.a (id int);\n\\! id' }], seed: 'insert into public.a values (1) on conflict do nothing;' }, 'feed');
  const order = ['create schema if not exists studio_zero;', '\\echo SZ_FILE 0001_a.sql\ndo $sz_run$ begin execute $sz_feed$\ncreate table public.a (id int);\n\\! id\n$sz_feed$; end $sz_run$;', `values ('0001_a.sql', '${sha256('create table public.a (id int);\n\\! id')}')`, '\\echo SZ_FILE supabase/seed.sql\ndo $sz_run$ begin execute $sz_feed$\ninsert into public.a values (1) on conflict do nothing;\n$sz_feed$;', `values ('seed.sql', '`, '\\echo SZ_FILE (the check)', "raise exception using message = 'SZ_GUARD'", "notify pgrst, 'reload schema';", "select 'SZ_TABLES ' || count(*)"];
  let at = -1;
  for (const part of order) {
    const next = script.indexOf(part, at + 1);
    assert.ok(next > at, `in order: ${part.slice(0, 50)}`);
    at = next;
  }
  // The only backslash commands in it are the studio's own markers: the file's is inside the quote.
  assert.deepEqual(script.split('\n').filter((line) => line.startsWith('\\')).map((line) => line.split(' ')[0]), ['\\echo', '\\!', '\\echo', '\\echo']);
  assert.equal(script.slice(0, script.indexOf('$sz_feed$')).includes('\\!'), false);
  // A file cannot close the quote it is in: the tag is random, and one that did would be refused, not run.
  assert.notEqual(applyScript({ pending: [], seed: 'x' }), applyScript({ pending: [], seed: 'x' }));
  assert.throws(() => applyScript({ pending: [{ name: '0001_a.sql', sql: 'select 1; $sz_feed$; end $sz_run$; drop schema auth cascade;' }], seed: null }, 'feed'), /contains the quoting tag/);

  assert.deepEqual(readOutcome(ok('SZ_FILE 0001_a.sql\nSZ_FILE (the check)\nSZ_TABLES 3\n')), { ok: true, tables: 3 });
  // The database's own words, as psql printed them on this Mac.
  assert.deepEqual(readOutcome(failed('ERROR:  SZ_GUARD\nDETAIL:  table loose: row level security is off (alter table loose enable row level security, then a policy)\nview all_notes: it reads as its owner and so past every policy (create view all_notes with (security_invoker = true) as ...)\nCONTEXT:  PL/pgSQL function inline_code_block line 14 at RAISE\n', 'SZ_FILE 0001_a.sql\nSZ_FILE (the check)\n')), {
    ok: false,
    kind: 'guard',
    holes: ['table loose: row level security is off (alter table loose enable row level security, then a policy)', 'view all_notes: it reads as its owner and so past every policy (create view all_notes with (security_invoker = true) as ...)'],
  });
  assert.deepEqual(readOutcome(failed('NOTICE:  schema "studio_zero" already exists, skipping\nERROR:  syntax error at or near "creat"\nLINE 3: creat table oops (id int);\n        ^\nQUERY:  \ncreate table public.t2 (id int primary key);\ncreat table oops (id int);\n\nCONTEXT:  PL/pgSQL function inline_code_block line 1 at EXECUTE\n', 'SZ_FILE 0001_a.sql\nSZ_FILE 0002_b.sql\n')), {
    ok: false,
    kind: 'sql',
    file: '0002_b.sql',
    error: 'ERROR:  syntax error at or near "creat"\nLINE 3: creat table oops (id int);\n        ^',
  });
});

test('the kit as a project receives it: the rules, the client for its framework, and the names the studio writes', async () => {
  const expected: Record<string, { paths: string[]; imports: string[] }> = {
    'web-vite-react': { paths: ['README.md', 'index.ts'], imports: ['@supabase/supabase-js'] },
    'web-next': { paths: ['README.md', 'index.ts', 'server.ts'], imports: ['@supabase/ssr', 'next/headers', 'next/server'] },
    'mobile-expo': { paths: ['README.md', 'index.ts'], imports: ['@react-native-async-storage/async-storage', '@supabase/supabase-js', 'react-native', 'react-native-url-polyfill/auto'] },
  };
  for (const [template, want] of Object.entries(expected) as [ProjectTemplate, (typeof expected)[string]][]) {
    const files = await armsKitFiles(template);
    assert.deepEqual(files.map((f) => f.path), want.paths, template);
    const code = files.filter((f) => f.path.endsWith('.ts'));
    for (const file of code) assert.doesNotMatch(file.content, /from\s+['"]\.{1,2}\/[^'"]+\.tsx?['"]/, `${template} ${file.path}`);
    const imported = new Set(code.flatMap((f) => [...f.content.matchAll(/(?:from|import)\s+['"]([^.'"][^'"]*)['"]/g)].map((m) => m[1]!)));
    assert.deepEqual([...imported].sort(), want.imports, template);
    // What the project is told to install covers what the kit imports that its framework does not bring.
    for (const name of want.imports.filter((n) => !/^(next|react-native)(\/|$)/.test(n))) assert.ok(variantOf(template)!.packages.some((p) => name === p || name.startsWith(`${p}/`)), `${template} installs ${name}`);
    // The client reads exactly the names the studio writes.
    const names = envNames(template)!;
    const source = code.map((f) => f.content).join('\n');
    for (const name of [names.url, names.key, ...(names.internalUrl ? [names.internalUrl] : [])]) assert.match(source, new RegExp(`\\b${name}\\b`), `${template} reads ${name}`);
    assert.match(files[0]!.content, /Every table in `public` has row level security on and at least one policy[\s\S]*security_invoker = true[\s\S]*A migration that is in is not edited[\s\S]*on conflict do nothing/);
  }
  assert.deepEqual(await armsKitFiles('studio-core'), []);
  assert.equal(envNames('studio-core'), null);

  const info = { apiUrl: 'http://127.0.0.1:21459', apiUrlFromSandbox: 'http://host.docker.internal:21459', publishableKey: 'sb_publishable_abc' };
  const vite = envBlock('web-vite-react', info)!;
  assert.deepEqual(vite.split('\n').filter((line) => !line.startsWith('#')), ['VITE_SUPABASE_URL=http://127.0.0.1:21459', 'VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_abc']);
  assert.deepEqual(envBlock('mobile-expo', info)!.split('\n').filter((line) => !line.startsWith('#')), ['EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:21459', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_abc']);
  // Only a framework with a server of its own is given the way out of the sandbox.
  assert.deepEqual(envBlock('web-next', info)!.split('\n').filter((line) => !line.startsWith('#')), ['NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:21459', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_abc', 'SUPABASE_INTERNAL_URL=http://host.docker.internal:21459']);

  // The studio's block is the studio's; every other line of the file is the project's.
  assert.equal(withEnvBlock('', vite), `${vite}\n`);
  const mixed = withEnvBlock('VITE_APP_NAME=Ledger\n', vite);
  assert.equal(mixed, `VITE_APP_NAME=Ledger\n\n${vite}\n`);
  assert.equal(withEnvBlock(mixed, vite), mixed, 'written again, nothing changes');
  const moved = withEnvBlock(`${mixed}VITE_AFTER=1\n`, envBlock('web-vite-react', { ...info, apiUrl: 'http://127.0.0.1:30000' })!);
  assert.match(moved, /^VITE_APP_NAME=Ledger\n\n# >>> Studio Zero backend[\s\S]*VITE_SUPABASE_URL=http:\/\/127\.0\.0\.1:30000[\s\S]*# <<< Studio Zero backend\nVITE_AFTER=1\n$/);
  assert.equal(moved.includes('21459'), false);
});

/** Supabase's command line and the database it runs, as far as the studio speaks to them. */
function fakeBackend(): { wrap: (base: CommandRunner) => CommandRunner; cli: string[]; scripts: string[]; answers: RunResult[] } {
  const cli: string[] = [];
  const scripts: string[] = [];
  const answers: RunResult[] = [];
  const started = JSON.stringify({ id: '5544e7ce750573f1', env: { API_URL: 'http://127.0.0.1:21459', DB_URL: 'postgresql://postgres:postgres@127.0.0.1:20253/postgres', PUBLISHABLE_KEY: 'sb_publishable_abc', SECRET_KEY: 'sb_secret_xyz' } });
  const wrap = (base: CommandRunner): CommandRunner => async (file, args, opts = {}) => {
    if (file === 'supabase') {
      cli.push(args.join(' '));
      if (args[0] === 'init') {
        mkdirSync(join(opts.cwd!, 'supabase'), { recursive: true });
        writeFileSync(join(opts.cwd!, 'supabase', 'config.toml'), '[experimental]\nstack = true\n');
      }
      return args[0] === '--version' ? ok('2.122.0\n') : args[0] === 'start' ? ok(started) : ok();
    }
    const docker = file === 'docker' ? dockerArgs(args) : [];
    if (docker[0] === 'ps' && docker.some((arg) => arg.startsWith('name=^supabase-'))) return ok(`${docker.find((arg) => arg.startsWith('name=^'))!.slice('name=^'.length)}f5681269aa11\n`);
    if (docker[0] === 'exec' && docker.includes('psql')) {
      scripts.push(String(opts.stdin));
      return answers.shift() ?? ok();
    }
    return base(file, args, opts);
  };
  return { wrap, cli, scripts, answers };
}

test('a project gets its backend with its first schema: started, its address and client in the workspace, and kept in step with the sandbox', async () => {
  const backend = fakeBackend();
  const d = await testDaemon({}, {}, backend.wrap);
  await d.daemon.start();
  try {
    const { studio, provisioner, toolbox, arms, config } = d.daemon;
    const project = studio.createProject(OWNER, { name: '회비 장부', slug: 'dues', template: 'web-vite-react' });
    await provisioner.ensure(project);
    const ctx = { project, taskId: 'tsk_none' };
    const at = (path: string): string => join(d.workspace, path);
    const apply = async (): Promise<{ content: string; isError: boolean }> => toolbox.call(ctx, 'apply_schema', {});

    // Until a schema is applied the project has no backend, and nothing of one is started or written.
    assert.equal(arms.has(project), false);
    assert.deepEqual(await arms.hostPorts(project), []);
    assert.equal(existsSync(at(ENV_FILE)), false);
    assert.equal(existsSync(at(ARMS_KIT_DIR)), false);
    assert.ok(toolbox.definitions().some((tool) => tool.name === 'apply_schema'));
    assert.equal(toolbox.mutates('apply_schema'), true);

    // Asked with nothing to apply, the studio says what to write and starts nothing.
    const empty = await apply();
    assert.equal(empty.isError, true);
    assert.match(empty.content, /supabase\/migrations\/ holds no \.sql file/);
    mkdirSync(at('supabase/migrations'), { recursive: true });
    writeFileSync(at('supabase/migrations/init.sql'), LEDGER);
    assert.match((await apply()).content, /A migration's name begins with its number[\s\S]*Rename: init\.sql/);
    assert.deepEqual(backend.cli, []);
    rmSync(at('supabase/migrations/init.sql'));

    // The first schema.
    writeFileSync(at('supabase/migrations/0001_ledger.sql'), LEDGER);
    writeFileSync(at('supabase/seed.sql'), "insert into public.clubs (code) values ('MANGWON') on conflict do nothing;\n");
    writeFileSync(at(ENV_FILE), 'VITE_APP_NAME=Ledger\n');
    backend.answers.push(ok(''), ok('SZ_FILE 0001_ledger.sql\nSZ_FILE supabase/seed.sql\nSZ_FILE (the check)\nSZ_TABLES 1\n'));
    const first = await apply();
    assert.equal(first.isError, false, first.content);
    assert.match(first.content, /Applied one migration \(0001_ledger\.sql\) and the seed\. public now has one table, each with row level security and a policy\./);
    assert.match(first.content, /Its client is in \.studio-zero\/arms-kit \(read its README\.md\), and needs: pnpm add @supabase\/supabase-js\. Its address and publishable key are in \.env\.local as VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY; restart the dev server/);
    assert.deepEqual(backend.cli, ['--version', 'init --yes', 'start --runtime docker --exclude studio,analytics --output-format json']);
    assert.equal(arms.has(project), true);
    assert.ok(existsSync(join(config.home, 'arms', project.id, 'supabase', 'config.toml')));
    // What the engine wrote went to the database as data, between quotes it cannot close.
    assert.equal(backend.scripts.length, 2);
    assert.match(backend.scripts[1]!, /\\echo SZ_FILE 0001_ledger\.sql\ndo \$sz_run\$ begin execute (\$sz_[0-9a-f]{24}\$)\ncreate table public\.entries[\s\S]*is 'a backslash \\ in a string is data';\n\1; end \$sz_run\$;/);

    // In the workspace: the project's own line kept, the studio's block added, the file kept out of every commit, the kit.
    const env = readFileSync(at(ENV_FILE), 'utf8');
    assert.match(env, /^VITE_APP_NAME=Ledger\n\n# >>> Studio Zero backend[\s\S]*\nVITE_SUPABASE_URL=http:\/\/127\.0\.0\.1:21459\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_abc\n# <<< Studio Zero backend\n$/);
    assert.match(readFileSync(at('.git/info/exclude'), 'utf8'), /^\.env\.local$/m);
    assert.match(readFileSync(at(`${ARMS_KIT_DIR}/index.ts`), 'utf8'), /import\.meta\.env\.VITE_SUPABASE_URL/);
    assert.ok(existsSync(at(`${ARMS_KIT_DIR}/README.md`)));
    // Nothing that opens the database is anywhere in the workspace.
    const everything = (await runCommand('grep', ['-rIl', '-e', 'sb_secret_xyz', '-e', '20253', d.workspace])).stdout.trim();
    assert.equal(everything, '');

    // Asked again with nothing new; then with a migration that is in and has been edited; then with a hole.
    const record = `0001_ledger.sql\t${sha256(LEDGER)}\nseed.sql\t${sha256(readFileSync(at('supabase/seed.sql'), 'utf8'))}\n`;
    backend.answers.push(ok(record));
    assert.match((await apply()).content, /Nothing new to apply: the migration is in and the seed has not changed\./);
    writeFileSync(at('supabase/migrations/0001_ledger.sql'), `${LEDGER}\n-- a second thought`);
    backend.answers.push(ok(record));
    const edited = await apply();
    assert.equal(edited.isError, true);
    assert.match(edited.content, /Nothing was applied\. 0001_ledger\.sql is in the database already and its file has changed since\. A migration that is in is not edited/);
    writeFileSync(at('supabase/migrations/0001_ledger.sql'), LEDGER);
    writeFileSync(at('supabase/migrations/0002_notes.sql'), 'create table public.notes (id int primary key);');
    backend.answers.push(ok(record), failed('ERROR:  SZ_GUARD\nDETAIL:  table notes: row level security is off (alter table notes enable row level security, then a policy)\nCONTEXT:  PL/pgSQL function inline_code_block line 14 at RAISE\n', 'SZ_FILE 0002_notes.sql\nSZ_FILE (the check)\n'));
    const open = await apply();
    assert.equal(open.isError, true);
    assert.match(open.content, /Nothing was applied, and the database is as it was\. The schema leaves these open to anyone with the publishable key, which is everyone:\n- table notes: row level security is off[\s\S]*Fix them in the migrations that have not been applied yet \(0002_notes\.sql\)/);
    assert.equal(backend.scripts.at(-1)!.includes('0001_ledger.sql'), false, 'what is in is not sent again');

    // From now on the backend comes up whenever the sandbox does, and the kit reaches a branch that lacks it.
    rmSync(at(ARMS_KIT_DIR), { recursive: true });
    const starts = (): number => backend.cli.filter((line) => line.startsWith('start ')).length;
    const before = starts();
    await provisioner.ensure(project);
    assert.equal(starts(), before + 1);
    assert.ok(existsSync(at(`${ARMS_KIT_DIR}/index.ts`)));
    assert.equal(readFileSync(at(ENV_FILE), 'utf8'), env);
    assert.deepEqual(await arms.hostPorts(project), [21459]);
    assert.equal(starts(), before + 1, 'asking where it is does not start it again');

    // Stopped with the sandbox, deleted with the project.
    await studio.sandboxLifecycle(OWNER, project.id, 'stop');
    assert.equal(backend.cli.at(-1), 'stop');
    await studio.deleteProject(OWNER, project.id, true);
    assert.equal(backend.cli.at(-1), 'stack destroy --yes');
    assert.equal(arms.has(project), false);
    assert.equal(existsSync(join(config.home, 'arms', project.id)), false);

    // The studio's own repository is not a product and gets none.
    assert.deepEqual(await arms.applySchema({ ...sampleProject('core'), template: 'studio-core' }), { ok: false, text: 'This kind of project has no backend of its own.' });
  } finally {
    await d.cleanup();
  }
});

/**
 * The real thing, opt-in like the other tests that need the container engine: `SZ_TEST_ENGINE=1`. A workspace on
 * disk stands in for the sandbox; the stack, the database and the API are real. It carries a schema through
 * every answer `apply_schema` can give and then uses the result as two users would.
 */
test('a real backend: a schema applied from files, refused whole when it leaves a hole, and two users kept apart', { skip: process.env.SZ_TEST_ENGINE !== '1' && 'set SZ_TEST_ENGINE=1 to run (needs OrbStack and the Supabase command line)' }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'sz-arms-real-'));
  const workspace = mkdtempSync(join(tmpdir(), 'sz-arms-ws-'));
  mkdirSync(join(home, 'docker'), { recursive: true });
  writeFileSync(join(home, 'docker', 'config.json'), '{}\n');
  mkdirSync(join(workspace, '.git/info'), { recursive: true });
  const socket = join(process.env.HOME ?? '', '.orbstack/run/docker.sock');
  const endpoint = existsSync(socket) ? `unix://${socket}` : 'unix:///var/run/docker.sock';
  const dockerBin = resolveDockerBin('docker');
  const stack = new SupabaseStack({ home, run: runCommand, engineEndpoint: async () => endpoint, dockerBin });
  const sandboxes = {
    exec: async (_project: Project, script: string) => runCommand('bash', ['-c', script], { cwd: workspace }),
    readFile: async (_project: Project, path: string) => ({ content: readFileSync(join(workspace, path), 'utf8'), truncated: false }),
    writeFile: async (_project: Project, path: string, content: string | Uint8Array) => {
      mkdirSync(dirname(join(workspace, path)), { recursive: true });
      writeFileSync(join(workspace, path), content);
    },
  } as unknown as OrbStackManager;
  const arms = new ProjectArms({ stack, sandboxes });
  const project: Project = { ...sampleProject('arms-real'), id: 'prj_arms_real_test', template: 'mobile-expo' };
  const put = (path: string, content: string): void => {
    mkdirSync(dirname(join(workspace, path)), { recursive: true });
    writeFileSync(join(workspace, path), content);
  };
  const scalar = async (sql: string): Promise<string> => (await stack.sql(project, `${sql}\n`)).stdout.trim();
  try {
    put('supabase/migrations/0001_ledger.sql', LEDGER);
    put('supabase/seed.sql', "insert into public.entries (id, owner, memo) overriding system value values (1000, '00000000-0000-0000-0000-000000000000', '시드') on conflict do nothing;\n");
    const first = await arms.applySchema(project);
    assert.equal(first.ok, true, first.text);
    assert.match(first.text, /Applied one migration \(0001_ledger\.sql\) and the seed\. public now has one table/);
    assert.match(first.text, /EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);

    const env = readFileSync(join(workspace, ENV_FILE), 'utf8');
    const url = /^EXPO_PUBLIC_SUPABASE_URL=(http:\/\/127\.0\.0\.1:\d+)$/m.exec(env)?.[1] ?? '';
    const key = /^EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=(\S+)$/m.exec(env)?.[1] ?? '';
    assert.ok(url && key, env);
    assert.ok(existsSync(join(workspace, ARMS_KIT_DIR, 'index.ts')));
    assert.deepEqual(await arms.hostPorts(project), [Number(new URL(url).port)]);

    // With nothing but what is in .env.local, as the product's own code would: two users, kept apart.
    const call = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<{ status: number; json: unknown }> => {
      const res = await fetch(`${url}${path}`, { method: init.method ?? 'GET', headers: { apikey: key, 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const signUp = async (email: string): Promise<string> => ((await call('/auth/v1/signup', { method: 'POST', body: { email, password: 'correct-horse-9' } })).json as { access_token?: string }).access_token ?? '';
    const a = await signUp('chongmu@example.com');
    const b = await signUp('hoewon@example.com');
    assert.ok(a.length > 100 && b.length > 100, 'two users signed up');
    // The API learns of a new table a moment after the schema commits.
    let made = 0;
    for (let i = 0; i < 20 && made !== 201; i++) {
      made = (await call('/rest/v1/entries', { method: 'POST', token: a, body: { memo: '물·간식' } })).status;
      if (made !== 201) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(made, 201);
    assert.deepEqual((await call('/rest/v1/entries?select=memo', { token: a })).json, [{ memo: '물·간식' }]);
    assert.deepEqual((await call('/rest/v1/entries?select=memo', { token: b })).json, []);
    assert.deepEqual((await call('/rest/v1/entries?select=memo')).json, []);
    assert.equal(await scalar('select count(*) from public.entries;'), '2', 'the seed row and the user\'s row are both there, and neither user sees the seed\'s');

    // A second migration that leaves a table open, with a good statement before it: none of it stays.
    put('supabase/migrations/0002_notes.sql', 'alter table public.entries add column amount integer;\ncreate table public.notes (id int primary key);\ncreate view public.all_entries as select * from public.entries;');
    const open = await arms.applySchema(project);
    assert.equal(open.ok, false);
    assert.match(open.text, /- table notes: row level security is off[\s\S]*- view all_entries: it reads as its owner/);
    assert.equal(await scalar("select (to_regclass('public.notes') is null)::text || ',' || (select count(*) from information_schema.columns where table_name = 'entries' and column_name = 'amount');"), 'true,0');

    // A statement that fails, in a file with a psql command in it: the command is never run, and the file is named.
    put('supabase/migrations/0002_notes.sql', 'alter table public.entries add column amount integer;\n\\! touch /tmp/sz-escaped\ncreate table public.notes (id int primary key);');
    const broken = await arms.applySchema(project);
    assert.equal(broken.ok, false);
    assert.match(broken.text, /0002_notes\.sql failed:\nERROR:\s+syntax error at or near "\\"/);
    const names = await runCommand(dockerBin, ['--host', endpoint, 'ps', '--filter', `name=^supabase-${project.id}-database-`, '--format', '{{.Names}}'], { timeoutMs: 20_000 });
    const escaped = await runCommand(dockerBin, ['--host', endpoint, 'exec', names.stdout.trim(), 'sh', '-c', 'test -e /tmp/sz-escaped && echo there || echo absent'], { timeoutMs: 20_000 });
    assert.equal(escaped.stdout.trim(), 'absent', 'nothing ran in the database\'s container');

    // Put right, it goes in; and a migration that is in cannot be edited afterwards.
    put('supabase/migrations/0002_notes.sql', 'alter table public.entries add column amount integer;\ncreate table public.notes (id int primary key);\nalter table public.notes enable row level security;\ncreate policy readers on public.notes for select to authenticated using (true);\ncreate view public.all_entries with (security_invoker = true) as select * from public.entries;');
    const second = await arms.applySchema(project);
    assert.equal(second.ok, true, second.text);
    assert.match(second.text, /Applied one migration \(0002_notes\.sql\)\. public now has 2 tables/);
    assert.match((await arms.applySchema(project)).text, /Nothing new to apply: the 2 migrations are in and the seed has not changed/);
    put('supabase/migrations/0001_ledger.sql', `${LEDGER}\n-- edited`);
    assert.match((await arms.applySchema(project)).text, /0001_ledger\.sql is in the database already and its file has changed since/);
    put('supabase/migrations/0001_ledger.sql', LEDGER);

    // The seed is applied again when it changes, and running it twice adds nothing twice.
    put('supabase/seed.sql', "insert into public.entries (id, owner, memo) overriding system value values (1000, '00000000-0000-0000-0000-000000000000', '시드') on conflict do nothing;\ninsert into public.entries (id, owner, memo) overriding system value values (1001, '00000000-0000-0000-0000-000000000000', '둘째') on conflict do nothing;\n");
    assert.match((await arms.applySchema(project)).text, /Applied the seed\./);
    assert.equal(await scalar('select count(*) from public.entries;'), '3');

    // Rested and woken, it is where it was with everything in it.
    await arms.rest(project);
    const again = await arms.ensure(project);
    assert.equal(again?.info.apiUrl, url);
    assert.deepEqual(again?.added, []);
    assert.equal(await scalar('select count(*) from public.entries;'), '3');
  } finally {
    await arms.forget(project).catch(() => undefined);
    assert.equal(arms.has(project), false);
    rmSync(home, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

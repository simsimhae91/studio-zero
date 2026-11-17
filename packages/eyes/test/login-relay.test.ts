// Signing in with Kakao and Google on a product built through the plugin: one address registered with each
// provider (the relay's), every product's own backend wired to it, and each returning person passed on to the
// backend that sent them out. Carried over from the old daemon (packages/daemon/src/arms/logins.ts and
// ProjectArms.relay), with stand-ins for everything outside this machine: two node:http servers for two
// products' auth services, a fake `docker` for their databases, a fake `supabase` for the command line, and a
// vault of made-up keys. Neither Kakao nor Google is contacted, and the owner's Keychain is never read.
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LOCAL_LANDINGS, apiUrlOf, flowIdOf, loginEnv, loginKeysOf, readBackends, registerBackend, usable, withLogins } from '../src/login.ts';
import { IDENTITY_PATH } from '../src/login-relay.ts';
import { freePort } from '../src/port.ts';
import type { SecretStore } from '../src/secrets.ts';
import { supabaseCommand } from '../src/supabase.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(HERE, '../src/cli.ts');
const LOGIN = join(HERE, '../src/login.ts');

// Made-up keys. Each secret is long and odd enough that finding it in a file can only mean it was written there.
const KAKAO_ID = 'a1b2c3d4e5f6';
const KAKAO_SECRET = 'kakao-secret-Zq81xVw0pLm3';
const GOOGLE_ID = '1234-abc.apps.googleusercontent.com';
const GOOGLE_SECRET = 'GOCSPX-made-up-Rt5uYh2Kd9';

const FLOW_A = '0b9f6a52-3c1e-4d1a-9f0e-6f2d1c3b4a59';
const FLOW_B = '7d1e2f30-4a5b-4c6d-8e7f-90a1b2c3d4e5';
const UNKNOWN = '11111111-2222-4333-8444-555555555555';
/** The form older auth services give `state`: a signed token that holds the sign-in's id. */
const tokenFor = (flow: string): string => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ provider: 'kakao', flow_state_id: flow, referrer: 'http://evil.example' })).toString('base64url')}.sig`;

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const vault = (kept: Record<string, string>): SecretStore => ({ get: async (id) => (id in kept ? { expose: () => kept[id]! } : null), set: async () => undefined });
const OWNER_KEYS = { 'login/kakao/client-id': KAKAO_ID, 'login/kakao/client-secret': KAKAO_SECRET, 'login/google/client-id': GOOGLE_ID, 'login/google/client-secret': GOOGLE_SECRET };

/** A product's auth service: answers whatever it is asked, and keeps what reached it. */
async function authService(name: string): Promise<{ url: string; port: number; seen: string[]; server: Server; close: () => Promise<void> }> {
  const seen: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    seen.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'text/plain' }).end(`auth service ${name}`);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, port, seen, server, close: () => new Promise<void>((done) => server.close(() => done())) };
}

/**
 * The container engine as far as the relay speaks to it: `docker ps` finds a stack's database by its name, and
 * `docker exec ... psql` answers whether that database holds a sign-in. Which database holds which sign-in is
 * read from a file the test changes. Every call is written down (the calls carry no secret).
 */
function fakeDockerMain(flowsFile: string, callsFile: string): void {
  const fs = require('node:fs');
  const args = process.argv.slice(2);
  fs.appendFileSync(callsFile, `${args.join(' ')}\n`);
  const flows = JSON.parse(fs.readFileSync(flowsFile, 'utf8'));
  if (args[0] === 'ps') {
    const filter = args[args.indexOf('--filter') + 1] || '';
    const found = /^name=\^supabase-(.+)-database-$/.exec(filter);
    const name = found && found[1] ? found[1].split('\\.').join('.') : '';
    if (Object.prototype.hasOwnProperty.call(flows, name)) process.stdout.write(`supabase-${name}-database-0123456789ab\n`);
    process.exit(0);
  } else if (args[0] === 'exec') {
    const name = String(args[2]).replace(/^supabase-/, '').replace(/-database-[0-9a-f]+$/, '');
    let sql = '';
    process.stdin.on('data', (chunk) => (sql += chunk));
    process.stdin.on('end', () => {
      const id = (/'([0-9a-f-]{36})'/.exec(sql) || [])[1];
      process.stdout.write(`${(flows[name] || []).includes(id) ? 1 : 0}\n`);
    });
  } else process.exit(0);
}

/**
 * The Supabase command line as far as `sz-eyes supabase` speaks to it. It never keeps a secret: it writes down
 * its arguments and a fingerprint of each secret it was handed in its environment.
 */
function fakeSupabaseMain(callsFile: string, apiUrl: string): void {
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  const args = process.argv.slice(2);
  const print = (name: string): string | null => (process.env[name] ? crypto.createHash('sha256').update(process.env[name]).digest('hex') : null);
  fs.appendFileSync(callsFile, `${JSON.stringify({ args, kakao: print('SZ_LOGIN_KAKAO_SECRET'), google: print('SZ_LOGIN_GOOGLE_SECRET') })}\n`);
  if (args[0] === 'start' && !args.includes('--help')) {
    process.stdout.write(`${JSON.stringify({ id: '5544e7ce750573f1', env: { API_URL: apiUrl, DB_URL: 'postgresql://postgres:postgres@127.0.0.1:20253/postgres', PUBLISHABLE_KEY: 'sb_publishable_abc', SECRET_KEY: 'sb_secret_xyz' } })}\n`);
  }
  process.exit(0);
}

const script = (file: string, main: (...args: string[]) => void, ...args: string[]): void => {
  writeFileSync(file, `#!${process.execPath}\n(${main.toString()})(${args.map((arg) => JSON.stringify(arg)).join(', ')});\n`);
  chmodSync(file, 0o755);
};

interface Machine {
  root: string;
  logins: string;
  port: number;
  env: NodeJS.ProcessEnv;
  flows: (map: Record<string, string[]>) => void;
  dockerCalls: () => string[];
  eyes: (...args: string[]) => { code: number | null; text: string };
  /** The command line run without stopping this process: for when it talks to a server this test is serving. */
  eyesLater: (...args: string[]) => Promise<{ code: number | null; text: string }>;
  relayPid: () => number | null;
  cleanup: () => Promise<void>;
}

/** A machine of the test's own: a folder for the registry and the relay, a free port for it, and a fake engine on its PATH. */
async function machine(): Promise<Machine> {
  const root = mkdtempSync(join(tmpdir(), 'sz-login-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const flowsFile = join(root, 'flows.json');
  const callsFile = join(root, 'docker-calls.txt');
  writeFileSync(flowsFile, '{}');
  writeFileSync(callsFile, '');
  script(join(bin, 'docker'), fakeDockerMain, flowsFile, callsFile);
  const logins = join(root, 'logins');
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { HOME: root, PATH: `${bin}:/usr/bin:/bin`, SZ_LOGINS_DIR: logins, SZ_LOGIN_RELAY_PORT: String(port), DOCKER_HOST: `unix://${join(root, 'no-engine.sock')}`, DOCKER_CONFIG: join(root, 'docker-config') };
  mkdirSync(join(root, 'docker-config'));
  writeFileSync(join(root, 'docker-config', 'config.json'), '{}\n');
  const relayPid = (): number | null => {
    try {
      return (JSON.parse(readFileSync(join(logins, 'relay.json'), 'utf8')) as { pid: number }).pid;
    } catch {
      return null;
    }
  };
  const eyes = (...args: string[]): { code: number | null; text: string } => {
    const run = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env, timeout: 30_000 });
    return { code: run.status, text: `${run.stdout}${run.stderr}` };
  };
  const eyesLater = (...args: string[]): Promise<{ code: number | null; text: string }> =>
    new Promise((done) => {
      const child = spawn(process.execPath, [CLI, ...args], { env });
      let text = '';
      child.stdout.on('data', (chunk) => (text += chunk));
      child.stderr.on('data', (chunk) => (text += chunk));
      child.once('close', (code) => done({ code, text }));
    });
  return {
    root,
    logins,
    port,
    env,
    flows: (map) => writeFileSync(flowsFile, JSON.stringify(map)),
    dockerCalls: () => readFileSync(callsFile, 'utf8').split('\n').filter(Boolean),
    eyes,
    eyesLater,
    relayPid,
    cleanup: async () => {
      eyes('login', 'relay', 'stop');
      const pid = relayPid();
      if (pid !== null && alive(pid)) process.kill(pid, 'SIGKILL');
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A product folder whose stack names itself `project`, as `supabase init` leaves it. */
function product(root: string, project: string, config = INIT_CONFIG(project)): string {
  const folder = join(root, project);
  mkdirSync(join(folder, 'supabase'), { recursive: true });
  writeFileSync(join(folder, 'supabase', 'config.toml'), config);
  return folder;
}

const INIT_CONFIG = (project: string): string => `# A string used to distinguish different Supabase projects on the same host.
project_id = "${project}"

[api]
enabled = true
port = 54321

[auth]
enabled = true
site_url = "http://127.0.0.1:3000"
# A list of *exact* URLs that auth providers are permitted to redirect to post authentication.
additional_redirect_urls = ["https://127.0.0.1:3000"]
jwt_expiry = 3600

[auth.email]
enable_signup = true

[auth.external.apple]
enabled = false
client_id = ""
secret = "env(SUPABASE_AUTH_EXTERNAL_APPLE_SECRET)"
redirect_uri = ""
url = ""
skip_nonce_check = false
email_optional = false

[edge_runtime]
enabled = true
`;

const comeBack = async (port: number, state: string): Promise<{ status: number; location: string | null; body: string }> => {
  const res = await fetch(`http://127.0.0.1:${port}/oauth/callback?code=abc&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
};

/** Every file under these folders, as text, to look for what must never be written. */
function everythingIn(...folders: string[]): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.push({ file: path, text: readFileSync(path, 'latin1') });
    }
  };
  for (const folder of folders) if (existsSync(folder)) walk(folder);
  return found;
}

// ------------------------------------------------------------------ the configuration writer (carried over)

test('signing in through a provider: the owner\'s one key each, one address to come back to, the secret in no file', () => {
  const toml = '[auth]\nsite_url = "http://127.0.0.1:3000"\nadditional_redirect_urls = ["https://127.0.0.1:3000"]\n\n[auth.email]\nenable_signup = true\n';
  const keys = { kakao: { clientId: 'a1b2c3d4e5f6', secret: 'kakao-secret-value' }, google: { clientId: '1234-abc.apps.googleusercontent.com', secret: 'GOCSPX-value' } };
  const landings = ['http://127.0.0.1:33034/**', 'http://localhost:33034/**'];
  const made = withLogins(toml, keys, 'http://localhost:49210/oauth/callback', landings);
  // One change from the old daemon's writer: the file is the product's own now, so the addresses it already
  // allowed are kept, and the product's are added after them.
  assert.equal(
    made,
    `[auth]\nsite_url = "http://127.0.0.1:3000"\nadditional_redirect_urls = ["https://127.0.0.1:3000", "http://127.0.0.1:33034/**", "http://localhost:33034/**"]\n\n[auth.email]\nenable_signup = true\n\n# >>> Studio Zero logins. Rewritten by the studio: do not edit between these lines.\n\n[auth.external.kakao]\nenabled = true\nclient_id = "a1b2c3d4e5f6"\nsecret = "env(SZ_LOGIN_KAKAO_SECRET)"\nredirect_uri = "http://localhost:49210/oauth/callback"\n\n[auth.external.google]\nenabled = true\nclient_id = "1234-abc.apps.googleusercontent.com"\nsecret = "env(SZ_LOGIN_GOOGLE_SECRET)"\nredirect_uri = "http://localhost:49210/oauth/callback"\n\n# <<< Studio Zero logins\n`,
  );
  assert.equal(made.includes('kakao-secret-value') || made.includes('GOCSPX-value'), false, 'the secret half is named, never written');
  assert.deepEqual(loginEnv(keys), { SZ_LOGIN_KAKAO_SECRET: 'kakao-secret-value', SZ_LOGIN_GOOGLE_SECRET: 'GOCSPX-value' });
  assert.equal(withLogins(made, keys, 'http://localhost:49210/oauth/callback', landings), made, 'written again, nothing changes: a stack is not restarted for nothing');
  // A key taken out of the vault takes its provider out; one that could not sit in a configuration file is not used.
  const one = withLogins(made, { kakao: keys.kakao, google: { clientId: 'x"\nenabled = false', secret: 's' } }, 'http://localhost:49210/oauth/callback', landings);
  assert.match(one, /\[auth\.external\.kakao\]/);
  assert.doesNotMatch(one, /auth\.external\.google|enabled = false/);
  assert.deepEqual(usable({ kakao: keys.kakao, google: { clientId: '1234-abc.apps.googleusercontent.com', secret: '' } }), ['kakao']);
  assert.doesNotMatch(withLogins(made, {}, 'http://localhost:49210/oauth/callback', landings), /auth\.external|Studio Zero logins/);

  // Which sign-in a returning person belongs to: its id, bare or inside the auth service's own token. Nothing else is read from it.
  const flow = '0b9f6a52-3c1e-4d1a-9f0e-6f2d1c3b4a59';
  assert.deepEqual([flowIdOf(flow), flowIdOf(tokenFor(flow)), flowIdOf('x'), flowIdOf(`a.${Buffer.from('{"flow_state_id":"1; drop table x"}').toString('base64url')}.c`), flowIdOf("' or 1=1 --")], [flow, flow, null, null, null]);
});

test('a product\'s own configuration: a provider it set up itself is taken into the block with what else it said, and the addresses it lands on are kept', () => {
  // As a session left it on 2026-11-16 (a phone app): its own Kakao and Google tables, named by variables.
  const own = `${INIT_CONFIG('battle-diet').replace('site_url = "http://127.0.0.1:3000"', 'site_url = "battlediet://auth"').replace('additional_redirect_urls = ["https://127.0.0.1:3000"]', 'additional_redirect_urls = [\n  "battlediet://**",\n  "exp://**",\n]')}
[auth.external.kakao]
enabled = true
client_id = "env(KAKAO_CLIENT_ID)"
secret = "env(KAKAO_CLIENT_SECRET)"
redirect_uri = ""
url = ""
skip_nonce_check = false
email_optional = true

[auth.external.google]
enabled = true
client_id = "env(GOOGLE_CLIENT_ID)"
secret = "env(GOOGLE_CLIENT_SECRET)"
redirect_uri = ""
skip_nonce_check = true

[storage]
enabled = true
`;
  const keys = { kakao: { clientId: KAKAO_ID, secret: KAKAO_SECRET }, google: { clientId: GOOGLE_ID, secret: GOOGLE_SECRET } };
  const made = withLogins(own, keys, 'http://localhost:49210/oauth/callback', LOCAL_LANDINGS);
  assert.equal(made.match(/^\[auth\.external\.kakao\]$/gm)?.length, 1, 'a table named twice is a file the command line cannot read');
  assert.equal(made.match(/^\[auth\.external\.google\]$/gm)?.length, 1);
  assert.match(made, /\[auth\.external\.kakao\]\nenabled = true\nclient_id = "a1b2c3d4e5f6"\nsecret = "env\(SZ_LOGIN_KAKAO_SECRET\)"\nredirect_uri = "http:\/\/localhost:49210\/oauth\/callback"\nurl = ""\nskip_nonce_check = false\nemail_optional = true\n/);
  assert.match(made, /\[auth\.external\.google\]\nenabled = true\nclient_id = "1234-abc\.apps\.googleusercontent\.com"\nsecret = "env\(SZ_LOGIN_GOOGLE_SECRET\)"\nredirect_uri = "http:\/\/localhost:49210\/oauth\/callback"\nskip_nonce_check = true\n/);
  assert.match(made, /additional_redirect_urls = \["battlediet:\/\/\*\*", "exp:\/\/\*\*", "http:\/\/localhost:\*", "http:\/\/localhost:\*\/\*\*", "http:\/\/127\.0\.0\.1:\*", "http:\/\/127\.0\.0\.1:\*\/\*\*"\]/, 'the deep link the phone app lands on stays');
  assert.match(made, /\[auth\.external\.apple\]\nenabled = false/, 'what is not a provider of the relay is left as it was');
  assert.match(made, /\n\[storage\]\nenabled = true\n/);
  assert.equal(made.includes(KAKAO_SECRET) || made.includes(GOOGLE_SECRET), false);
  assert.equal(withLogins(made, keys, 'http://localhost:49210/oauth/callback', LOCAL_LANDINGS), made, 'and written again, nothing changes');
  // Only Kakao's key in the vault: the product's own Google table is left as the product wrote it.
  const kakaoOnly = withLogins(own, { kakao: keys.kakao }, 'http://localhost:49210/oauth/callback', LOCAL_LANDINGS);
  assert.match(kakaoOnly, /\[auth\.external\.google\]\nenabled = true\nclient_id = "env\(GOOGLE_CLIENT_ID\)"/);
  assert.equal(kakaoOnly.match(/^\[auth\.external\.kakao\]$/gm)?.length, 1);
  // A list of landing addresses in a shape not read here is left alone, never named a second time; none at all gets one.
  const odd = withLogins('[auth]\nadditional_redirect_urls = [\n  # the app\n  "battlediet://**",\n]\n', keys, 'http://localhost:49210/oauth/callback', LOCAL_LANDINGS);
  assert.equal(odd.match(/^additional_redirect_urls/gm)?.length, 1);
  assert.match(odd, /# the app\n {2}"battlediet:\/\/\*\*",\n\]/);
  assert.match(withLogins('[auth]\nsite_url = "http://127.0.0.1:3000"\n', keys, 'http://localhost:49210/oauth/callback', ['http://localhost:*']), /^\[auth\]\nadditional_redirect_urls = \["http:\/\/localhost:\*"\]\nsite_url/);
});

test('the keys come from the vault itself; from the environment only where the vault cannot be read (the `secret run` form)', async () => {
  const all = await loginKeysOf(vault(OWNER_KEYS), {});
  assert.deepEqual(all.keys, { kakao: { clientId: KAKAO_ID, secret: KAKAO_SECRET }, google: { clientId: GOOGLE_ID, secret: GOOGLE_SECRET } });
  assert.deepEqual(all.missing, []);
  const half = await loginKeysOf(vault({ 'login/kakao/client-id': KAKAO_ID, 'login/kakao/client-secret': KAKAO_SECRET }), {});
  assert.deepEqual([Object.keys(half.keys), half.missing], [['kakao'], ['login/google/client-id', 'login/google/client-secret']]);
  const locked: SecretStore = { get: async () => Promise.reject(new Error('keychain read failed (exit 51)')), set: async () => undefined };
  const passed = await loginKeysOf(locked, { KAKAO_CLIENT_ID: KAKAO_ID, KAKAO_CLIENT_SECRET: KAKAO_SECRET });
  assert.deepEqual([passed.keys, passed.missing], [{ kakao: { clientId: KAKAO_ID, secret: KAKAO_SECRET } }, ['login/google/client-id', 'login/google/client-secret']]);
  assert.match(passed.vaultError ?? '', /keychain read failed/);
  // What the command line answers with: the address of the stack's API, in each form it is given.
  assert.equal(apiUrlOf('Starting...\n{"id":"a","env":{"API_URL":"http://127.0.0.1:21459","DB_URL":"x"}}\n'), 'http://127.0.0.1:21459');
  assert.equal(apiUrlOf('{"API_URL":"http://127.0.0.1:54321","ANON_KEY":"x"}'), 'http://127.0.0.1:54321');
  assert.equal(apiUrlOf('         API URL: http://127.0.0.1:54321\n     GraphQL URL: http://127.0.0.1:54321/graphql/v1\n'), 'http://127.0.0.1:54321');
  assert.equal(apiUrlOf('{"env":{"API_URL":"https://abcd.supabase.co"}}'), null, 'only a backend on this machine is ever passed a person');
  assert.equal(apiUrlOf('Stack is ready.'), null);
});

// ------------------------------------------------------------------ the registry

test('eight backends registered at the same moment are all kept', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sz-login-registry-'));
  try {
    const at = Date.now();
    const register = (i: number): Promise<number | null> =>
      new Promise((done) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', `const { registerBackend } = await import(${JSON.stringify(LOGIN)}); registerBackend(${JSON.stringify(dir)}, { project: '/products/p${i}', api: 'http://127.0.0.1:${21000 + i}' }, new Date(${at}));`], { stdio: 'ignore' });
        child.once('close', done);
      });
    const codes = await Promise.all(Array.from({ length: 8 }, (_, i) => register(i + 1)));
    assert.deepEqual(codes, [0, 0, 0, 0, 0, 0, 0, 0]);
    const kept = readBackends(dir);
    assert.deepEqual(kept.map((b) => b.project).sort(), Array.from({ length: 8 }, (_, i) => `/products/p${i + 1}`));
    assert.ok(kept.every((b) => b.added === new Date(at).toISOString()));
    // Registered again, a product keeps one entry, at the address it has now; an address another folder held is that folder's no longer.
    registerBackend(dir, { project: '/products/p1', api: 'http://127.0.0.1:22001' }, new Date());
    registerBackend(dir, { project: '/products/p9', api: 'http://127.0.0.1:21002' }, new Date());
    const now = readBackends(dir);
    assert.deepEqual(now.filter((b) => b.project === '/products/p1').map((b) => b.api), ['http://127.0.0.1:22001']);
    assert.equal(now.some((b) => b.project === '/products/p2'), false);
    assert.equal(now.length, 8);
    assert.throws(() => registerBackend(dir, { project: '/products/x', api: 'https://abcd.supabase.co' }, new Date()), /on this machine/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ the relay

test('the relay passes a returning person to the backend that started their sign-in and to no other, says plainly when none did, and forgets a backend that stopped answering', async () => {
  const m = await machine();
  const a = await authService('A');
  const b = await authService('B');
  try {
    const alpha = product(m.root, 'alpha');
    const beta = product(m.root, 'beta');
    registerBackend(m.logins, { project: alpha, api: a.url }, new Date());
    registerBackend(m.logins, { project: beta, api: b.url }, new Date());
    m.flows({ alpha: [FLOW_A], beta: [FLOW_B] });

    const started = m.eyes('login', 'relay', 'start');
    assert.equal(started.code, 0, started.text);
    assert.match(started.text, new RegExp(`http://localhost:${m.port}/oauth/callback`));

    const toA = await comeBack(m.port, FLOW_A);
    assert.deepEqual([toA.status, toA.location], [302, `${a.url}/auth/v1/callback?code=abc&state=${FLOW_A}`]);
    await fetch(toA.location!);
    assert.deepEqual([a.seen, b.seen], [[`/auth/v1/callback?code=abc&state=${FLOW_A}`], []], 'only the backend that sent them out sees them come back');

    const toB = await comeBack(m.port, tokenFor(FLOW_B));
    assert.deepEqual([toB.status, toB.location], [302, `${b.url}/auth/v1/callback?code=abc&state=${encodeURIComponent(tokenFor(FLOW_B))}`]);

    // A sign-in no backend here started: a plain page, no redirect, and nothing of what is on this machine.
    const nobody = await comeBack(m.port, UNKNOWN);
    assert.equal(nobody.status, 404);
    assert.equal(nobody.location, null);
    assert.match(nobody.body, /sign in again/);
    for (const told of [a.url, b.url, String(a.port), String(b.port), alpha, beta, 'supabase', 'docker']) assert.equal(nobody.body.includes(told), false, `the page says nothing of ${told}`);
    // What is not a sign-in's id is never put to a database.
    const asked = m.dockerCalls().filter((call) => call.startsWith('exec')).length;
    assert.equal((await comeBack(m.port, "x' or 1=1 --")).status, 404);
    assert.equal(m.dockerCalls().filter((call) => call.startsWith('exec')).length, asked);

    // The relay says what it is, on a path of its own.
    const identity = (await (await fetch(`http://127.0.0.1:${m.port}${IDENTITY_PATH}`)).json()) as { what: string; version: number; pid: number };
    assert.equal(identity.what, 'sz-eyes login relay');
    assert.equal(identity.pid, m.relayPid());

    // B stops: the next person through the relay still reaches A, and B is no longer registered.
    await b.close();
    const again = await comeBack(m.port, FLOW_A);
    assert.equal(again.location, `${a.url}/auth/v1/callback?code=abc&state=${FLOW_A}`);
    assert.deepEqual(readBackends(m.logins).map((entry) => entry.project), [alpha]);

    const status = m.eyes('login', 'relay', 'status');
    assert.equal(status.code, 0, status.text);
    assert.match(status.text, new RegExp(`up at http://localhost:${m.port}/oauth/callback`));
    assert.match(status.text, new RegExp(`${alpha.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+${a.url}`));
  } finally {
    await a.close();
    await b.close().catch(() => undefined);
    await m.cleanup();
  }
});

test('start twice starts one relay; a port held by something else is said and left alone; stop ends only a relay of ours', async () => {
  const m = await machine();
  let sleeper: ChildProcess | null = null;
  let squatter: Server | null = null;
  try {
    const first = m.eyes('login', 'relay', 'start');
    assert.equal(first.code, 0, first.text);
    const pid = m.relayPid();
    assert.ok(pid !== null && alive(pid));
    const second = m.eyes('login', 'relay', 'start');
    assert.equal(second.code, 0, second.text);
    assert.match(second.text, /already up/);
    assert.equal(m.relayPid(), pid, 'the second start started nothing');

    const down = m.eyes('login', 'relay', 'stop');
    assert.equal(down.code, 0, down.text);
    await waitFor(() => !alive(pid!));
    assert.equal(existsSync(join(m.logins, 'relay.json')), false);
    assert.equal(m.eyes('login', 'relay', 'status').code, 1, 'down is said with exit 1');

    // A process that is not the relay, named by a pid file: stop leaves it running.
    sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    await new Promise((done) => sleeper!.once('spawn', done));
    mkdirSync(m.logins, { recursive: true });
    writeFileSync(join(m.logins, 'relay.json'), JSON.stringify({ pid: sleeper.pid, port: m.port, version: 1 }));
    const careful = m.eyes('login', 'relay', 'stop');
    assert.equal(careful.code, 0, careful.text);
    assert.match(careful.text, /not the relay|left alone/);
    assert.ok(alive(sleeper.pid!), 'a process that is not ours is not ended');

    // Something else holds the port: start says what and exits 1, and starts nothing.
    squatter = createServer((_req, res) => res.writeHead(200, { server: 'other-app/2.0' }).end('hello'));
    await new Promise<void>((done) => squatter!.listen(m.port, '127.0.0.1', done));
    rmSync(join(m.logins, 'relay.json'), { force: true });
    const held = await m.eyesLater('login', 'relay', 'start');
    assert.equal(held.code, 1, held.text);
    assert.match(held.text, new RegExp(`port ${m.port} is held by`));
    assert.match(held.text, /other-app\/2\.0|HTTP 200/);
    assert.equal(m.relayPid(), null);
    const notOurs = await m.eyesLater('login', 'relay', 'stop');
    assert.match(notOurs.text, /not the relay|nothing/i);
  } finally {
    sleeper?.kill('SIGKILL');
    if (squatter) await new Promise((done) => squatter!.close(done));
    await m.cleanup();
  }
});

const waitFor = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const until = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > until) throw new Error('waited in vain');
    await new Promise((done) => setTimeout(done, 50));
  }
};

// ------------------------------------------------------------------ sz-eyes supabase start

test('supabase start with the owner\'s keys in the vault: the block names the relay, the secrets go by environment only, the backend is registered and one line says what to register', async () => {
  const m = await machine();
  const a = await authService('A');
  try {
    const own = INIT_CONFIG('alpha').replace('[edge_runtime]', '[auth.external.kakao]\nenabled = true\nclient_id = "env(KAKAO_CLIENT_ID)"\nsecret = "env(KAKAO_CLIENT_SECRET)"\nredirect_uri = ""\n\n[edge_runtime]');
    const folder = product(m.root, 'alpha', own);
    m.flows({ alpha: [] });
    const tool = join(m.root, 'bin', 'supabase');
    const calls = join(m.root, 'supabase-calls.jsonl');
    script(tool, fakeSupabaseMain, calls, a.url);
    const said: string[] = [];
    const printed: string[] = [];
    const deps = { tool, env: m.env, cwd: folder, store: vault(OWNER_KEYS), out: (text: string) => void printed.push(text), err: (text: string) => void said.push(text) };

    const code = await supabaseCommand(['start', '--runtime', 'docker', '--exclude', 'studio,analytics', '--output-format', 'json'], deps);
    assert.equal(code, 0, said.join(''));

    const config = readFileSync(join(folder, 'supabase', 'config.toml'), 'utf8');
    const callback = `http://localhost:${m.port}/oauth/callback`;
    assert.match(config, new RegExp(`\\[auth\\.external\\.kakao\\]\\nenabled = true\\nclient_id = "${KAKAO_ID}"\\nsecret = "env\\(SZ_LOGIN_KAKAO_SECRET\\)"\\nredirect_uri = "${callback}"`));
    assert.match(config, new RegExp(`\\[auth\\.external\\.google\\]\\nenabled = true\\nclient_id = "${GOOGLE_ID.replace(/\./g, '\\.')}"\\nsecret = "env\\(SZ_LOGIN_GOOGLE_SECRET\\)"\\nredirect_uri = "${callback}"`));
    assert.equal(config.match(/^\[auth\.external\.kakao\]$/gm)?.length, 1);
    assert.match(config, /additional_redirect_urls = \["https:\/\/127\.0\.0\.1:3000", "http:\/\/localhost:\*", "http:\/\/localhost:\*\/\*\*", "http:\/\/127\.0\.0\.1:\*", "http:\/\/127\.0\.0\.1:\*\/\*\*"\]/);

    // Handed over by environment: the command line got each secret; no file anywhere holds one.
    const ran = readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { args: string[]; kakao: string | null; google: string | null });
    assert.deepEqual(ran.map((call) => call.args[0]), ['stop', 'start'], 'a stack that was up is taken down so that it reads the new configuration');
    assert.deepEqual(ran.at(-1)!.args, ['start', '--runtime', 'docker', '--exclude', 'studio,analytics', '--output-format', 'json']);
    assert.deepEqual([ran.at(-1)!.kakao, ran.at(-1)!.google], [sha(KAKAO_SECRET), sha(GOOGLE_SECRET)]);
    for (const { file, text } of everythingIn(m.root)) for (const secret of [KAKAO_SECRET, GOOGLE_SECRET]) assert.equal(text.includes(secret), false, `${file} holds a secret`);
    assert.equal(said.join('').includes(KAKAO_SECRET) || printed.join('').includes(GOOGLE_SECRET), false);

    // Registered, and the relay is up.
    assert.deepEqual(readBackends(m.logins).map((entry) => [entry.project, entry.api]), [[folder, a.url]]);
    const identity = (await (await fetch(`http://127.0.0.1:${m.port}${IDENTITY_PATH}`)).json()) as { what: string };
    assert.equal(identity.what, 'sz-eyes login relay');

    // The one line, and the stack's own answer left as the last thing printed (sessions read it with tail -1).
    const lines = said.join('').split('\n').filter((line) => line.startsWith('sign-in:'));
    assert.equal(lines.length, 1, said.join(''));
    assert.match(lines[0]!, new RegExp(`^sign-in: kakao and google go through the relay\\. Register ${callback} once with each provider \\(once for every product, not per product\\)\\. The guide: .*docs/guides/studio-zero/shared-login-apps\\.html$`));
    assert.match(printed.join('').trim().split('\n').at(-1)!, /^\{"id":"5544e7ce750573f1"/);

    // Started again with nothing changed: not taken down, registered once.
    await supabaseCommand(['start', '--runtime', 'docker', '--exclude', 'studio,analytics', '--output-format', 'json'], deps);
    assert.deepEqual(readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((line) => (JSON.parse(line) as { args: string[] }).args[0]), ['stop', 'start', 'start']);
    assert.equal(readBackends(m.logins).length, 1);
    assert.equal(readFileSync(join(folder, 'supabase', 'config.toml'), 'utf8'), config);

    // Any other call on a stack wired to the relay is handed the secrets as well: the configuration names them.
    await supabaseCommand(['status'], deps);
    assert.deepEqual(readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { args: string[]; kakao: string | null }).at(-1), { args: ['status'], kakao: sha(KAKAO_SECRET), google: sha(GOOGLE_SECRET) });

    // A second product, with only Kakao's key in the vault: Kakao on, Google said to be off, both backends registered with the one relay.
    const other = product(m.root, 'beta');
    m.flows({ alpha: [], beta: [] });
    const otherTool = join(m.root, 'bin', 'supabase-beta');
    script(otherTool, fakeSupabaseMain, calls, 'http://127.0.0.1:21459');
    const half: string[] = [];
    const halfVault = vault({ 'login/kakao/client-id': KAKAO_ID, 'login/kakao/client-secret': KAKAO_SECRET });
    assert.equal(await supabaseCommand(['start', '--workdir', other, '--output-format', 'json'], { ...deps, tool: otherTool, cwd: m.root, store: halfVault, err: (text) => void half.push(text) }), 0);
    assert.match(half.join(''), new RegExp(`^sign-in: kakao goes through the relay\\. Register ${callback} once with Kakao \\(once for every product, not per product\\)\\. google is off: not in the vault: login/google/client-id, login/google/client-secret\\. The guide: `, 'm'));
    const otherConfig = readFileSync(join(other, 'supabase', 'config.toml'), 'utf8');
    assert.match(otherConfig, /\[auth\.external\.kakao\]/);
    assert.doesNotMatch(otherConfig, /\[auth\.external\.google\]/);
    assert.deepEqual(readBackends(m.logins).map((entry) => entry.project).sort(), [folder, other].sort());
  } finally {
    await a.close();
    await m.cleanup();
  }
});

test('supabase start with no keys in the vault changes nothing and says which keys are missing', async () => {
  const m = await machine();
  try {
    const folder = product(m.root, 'alpha');
    const before = readFileSync(join(folder, 'supabase', 'config.toml'), 'utf8');
    const tool = join(m.root, 'bin', 'supabase');
    const calls = join(m.root, 'supabase-calls.jsonl');
    script(tool, fakeSupabaseMain, calls, 'http://127.0.0.1:21459');
    const said: string[] = [];
    const code = await supabaseCommand(['start', '--output-format', 'json'], { tool, env: m.env, cwd: folder, store: vault({}), out: () => undefined, err: (text) => void said.push(text) });
    assert.equal(code, 0);
    assert.equal(readFileSync(join(folder, 'supabase', 'config.toml'), 'utf8'), before, 'the configuration is as it was');
    assert.equal(existsSync(join(m.logins, 'backends.json')), false, 'nothing is registered');
    assert.equal(m.relayPid(), null, 'no relay is started');
    assert.equal(m.eyes('login', 'relay', 'status').code, 1);
    assert.deepEqual(readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { args: string[]; kakao: string | null }), [{ args: ['start', '--output-format', 'json'], kakao: null, google: null }]);
    assert.match(said.join(''), /^sign-in: email only\. Not in the vault: login\/kakao\/client-id, login\/kakao\/client-secret, login\/google\/client-id, login\/google\/client-secret\./m);

    // Asking the command line how start is used (a session did, on 2026-11-16) starts and changes nothing, keys or not.
    await supabaseCommand(['start', '--help'], { tool, env: m.env, cwd: folder, store: vault(OWNER_KEYS), out: () => undefined, err: () => undefined });
    assert.equal(readFileSync(join(folder, 'supabase', 'config.toml'), 'utf8'), before);
    assert.equal(m.relayPid(), null);
    assert.deepEqual((JSON.parse(readFileSync(calls, 'utf8').split('\n').filter(Boolean).at(-1)!) as { args: string[] }).args, ['start', '--help']);
  } finally {
    await m.cleanup();
  }
});

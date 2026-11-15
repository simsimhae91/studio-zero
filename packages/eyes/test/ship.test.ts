// Putting a product where people reach it: what must stay on the server stays there, what answers is the
// version that was released, the release gate is the same lines every time, and what is live is not deleted.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readContract, CONTRACTS_DIR } from '../src/contract.ts';
import { engineEnv, hostedSupabaseCall } from '../src/engine.ts';
import { downloadsOf, filesOf, findLeaks, leakReport, renderLeaks, secretsFromEnv } from '../src/leaks.ts';
import { lookAtLive, renderLive, sameCommit, versionsIn } from '../src/live.ts';
import { classify, renderMigrations, statements } from '../src/migrations.ts';
import { findProducts, overviewPage, renderOverview, viewOf } from '../src/overview.ts';
import { GATE_LINES, gate, type Gate } from '../src/release.ts';
import { heldSecrets, hide, parseRun, runWithSecrets, setSecret, type SecretStore } from '../src/secrets.ts';
import { marksOf, renderStrangers, strangers } from '../src/strangers.ts';
import { closeBrowser, openBrowser, renderWalk, walkWeb } from '../src/web.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const eyes = (project: string, ...args: string[]): { code: number | null; text: string } => {
  const run = spawnSync(process.execPath, [join(HERE, '../src/cli.ts'), ...args, '--dir', project], { encoding: 'utf8' });
  return { code: run.status, text: `${run.stdout}${run.stderr}` };
};
/** The command line run without stopping this process: for when it talks to a server this test is serving. */
const eyesMeanwhile = (...args: string[]): Promise<number | null> => new Promise((done) => spawn(process.execPath, [join(HERE, '../src/cli.ts'), ...args], { stdio: 'ignore' }).once('close', done));
const serve = async (handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; url: string }> => {
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}` };
};
const jwt = (role: string): string => `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: 'supabase', role, exp: 1983812996 })).toString('base64url')}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`;

const ADMIN = 'k9Qw7LmZp2Xv4Ra8Tn3Yb6Ue';
const ENV = `# what the server holds
PORT=8770
NODE_ENV=production
ADMIN_KEY=${ADMIN}
export TOSS_SECRET_KEY="test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R"
DATABASE_URL=postgres://app:hunter2hunter2@db.example.com:5432/app
VITE_SUPABASE_URL=https://abc.supabase.co
SUPABASE_ANON_KEY=${jwt('anon')}
NEXT_PUBLIC_API_KEY=public-on-purpose-1234567890
PIN_SECRET=1234
`;

test('the secrets of a dotenv file are the values whose names say they open something, not what a build puts in the browser on purpose', () => {
  const { secrets, tooShort } = secretsFromEnv(ENV);
  assert.deepEqual(secrets.map((s) => s.name), ['ADMIN_KEY', 'TOSS_SECRET_KEY', 'DATABASE_URL']);
  assert.equal(secrets[1]!.value, 'test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R', 'quotes are not part of the value');
  assert.deepEqual(tooShort, ['PIN_SECRET'], 'four characters are found by chance in any script: said, not looked for');
});

test('a secret in what a browser downloads is found by its value and by its shape, and is never printed', () => {
  const { secrets } = secretsFromEnv(ENV);
  const files = [
    { url: 'https://x.test/', body: '<html><script src="/app.js"></script></html>' },
    { url: 'https://x.test/app.js', body: `const anon="${jwt('anon')}";fetch("/admin/${ADMIN}/counts");const pay="test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R"` },
    { url: 'https://x.test/vendor.js', body: `createClient(url,"${jwt('service_role')}");const s="sb_secret_abcdefghijklmnop1234";const pem="-----BEGIN PRIVATE KEY-----"` },
    { url: 'https://x.test/docs.js', body: 'const example="postgres://user:password@localhost/db";const k="pk_live_1234567890abcdefgh"' },
  ];
  const leaks = findLeaks(files, secrets);
  assert.deepEqual(
    leaks.map((leak) => [leak.where.replace('https://x.test', ''), leak.kind, leak.what]),
    [
      ['/app.js', 'value', 'ADMIN_KEY'],
      // The same key is in the dotenv file: named once, by its name, not again by its shape.
      ['/app.js', 'value', 'TOSS_SECRET_KEY'],
      ['/vendor.js', 'shape', 'a Supabase key with the service role (it passes every row guard)'],
      ['/vendor.js', 'shape', 'a Supabase secret key'],
      ['/vendor.js', 'shape', 'a private key'],
    ],
    'the anon key, a publishable key and a placeholder address are not secrets',
  );
  const report = leakReport(files, [], { named: secrets });
  const said = renderLeaks(report, 'https://x.test');
  assert.match(said, /5 LEAK\(S\)/);
  assert.match(said, /looked for: the values of ADMIN_KEY, TOSS_SECRET_KEY, DATABASE_URL/);
  for (const secret of secrets) assert.ok(!said.includes(secret.value), `${secret.name} is named, its value is not shown`);
  assert.ok(!said.includes(jwt('service_role')));
  assert.match(renderLeaks(leakReport(files.slice(0, 1), []), 'x'), /nothing secret in them[\s\S]*|no secret was named/);
});

test('a built folder is read as what would be served from it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eyes-built-'));
  try {
    mkdirSync(join(dir, 'assets'));
    mkdirSync(join(dir, 'node_modules/x'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), '<script src="assets/app.js"></script>');
    writeFileSync(join(dir, 'assets/app.js'), `const k="${ADMIN}"`);
    writeFileSync(join(dir, 'assets/logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    writeFileSync(join(dir, 'node_modules/x/index.js'), `const k="${ADMIN}"`);
    writeFileSync(join(dir, '.env.server'), `ADMIN_KEY=${ADMIN}\n`);
    assert.deepEqual(filesOf(dir).map((f) => f.url).sort(), ['.env.server', 'assets/app.js', 'index.html']);
    const found = eyes(dir, 'web', 'leaks', '--dir', dir, '--env', join(dir, '.env.server'));
    assert.equal(found.code, 1, found.text);
    assert.match(found.text, /ADMIN_KEY\n\s+in assets\/app\.js/);
    assert.ok(!found.text.includes(ADMIN));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('everything a browser is given is read: scripts, the source maps they name, and files served by mistake', async (t) => {
  const { server, url } = await serve((req, res) => {
    const send = (type: string, body: string, status = 200): void => void res.writeHead(status, { 'content-type': type }).end(body);
    if (req.url === '/') return send('text/html', '<!doctype html><title>t</title><script src="/app.js"></script><script>fetch("/api/me")</script>');
    if (req.url === '/app.js') return send('text/javascript', 'console.log(1)\n//# sourceMappingURL=app.js.map\n');
    if (req.url === '/app.js.map') return send('application/json', JSON.stringify({ version: 3, mappings: 'AAAA', sourcesContent: [`const adminKey = "${ADMIN}"`] }));
    if (req.url === '/api/me') return send('application/json', '{"name":"수아"}');
    if (req.url === '/.env') return send('text/plain', `ADMIN_KEY=${ADMIN}\n`);
    // Every other address gets the page: not the real file, so not a find.
    return send('text/html', '<!doctype html><title>t</title>');
  });
  try {
    const served = await downloadsOf(url).catch((err: unknown) => {
      if (/Chromium distribution 'chrome' is not found|Executable doesn't exist|ProcessSingleton/.test(String(err))) return null;
      throw err;
    });
    if (served === null) return t.skip('no Chrome on this machine');
    assert.deepEqual(served.files.map((f) => new URL(f.url).pathname).sort(), ['/', '/.env', '/api/me', '/app.js', '/app.js.map']);
    assert.deepEqual(served.maps.map((m) => new URL(m).pathname), ['/app.js.map']);
    assert.deepEqual(served.strays.map((s) => [new URL(s.where).pathname, s.kind]), [['/.env', 'file']], 'a page sent for every address is not the repository being served');
    const report = leakReport(served.files, [], { strays: served.strays, maps: served.maps, named: [{ name: 'ADMIN_KEY', value: ADMIN }] });
    assert.deepEqual(report.leaks.map((l) => [new URL(l.where).pathname, l.kind]).sort(), [['/.env', 'file'], ['/.env', 'value'], ['/app.js.map', 'value']]);
    assert.match(renderLeaks(report, url), /source maps are public \(1\)/);
  } finally {
    server.close();
  }
});

test('a service says which version it is, and what answers is compared with what was released', async () => {
  assert.deepEqual(versionsIn('{"ok":true,"commit":"955a9ea1c0ffee"}'), ['955a9ea1c0ffee']);
  assert.deepEqual(versionsIn('ok 955a9ea'), ['955a9ea']);
  assert.deepEqual(versionsIn('ok'), []);
  assert.ok(sameCommit('955a9ea', '955a9ea1c0ffee0123') && !sameCommit('955a9e', '955a9ea1') && !sameCommit('955a9ea', 'b36523e'));
  const page = '<!doctype html><html lang="ko"><head><title>엔빵</title><meta name="viewport" content="width=device-width"><meta property="og:title" content="엔빵"><meta property="og:image" content="/og.png"><link rel="icon" href="/i.png"></head><body><h1>엔빵</h1><a href="/privacy">개인정보 처리방침</a></body></html>';
  const good = await serve((req, res) => {
    if (req.url === '/healthz') return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"commit":"955a9ea1c0ffee"}');
    if (req.url === '/') return void res.writeHead(200, { 'content-type': 'text/html', 'x-content-type-options': 'nosniff' }).end(page);
    res.writeHead(404, { 'content-type': 'text/html' }).end(page);
  });
  const bad = await serve((req, res) => {
    if (req.url === '/healthz') return void res.writeHead(200).end('ok');
    if (req.url === '/') return void res.writeHead(200, { 'content-type': 'text/html' }).end('<html><body>모임 정산</body></html>');
    res.writeHead(500).end('boom');
  });
  try {
    const same = await lookAtLive(good.url, { commit: '955a9ea' });
    assert.deepEqual([same.status, same.version.same, same.problems, same.notices], [200, true, [], []]);
    assert.match(renderLive(same), /what answers is what was released/);
    const other = await lookAtLive(good.url, { commit: 'b36523e' });
    assert.match(other.problems.join('\n'), /what answers is version 955a9ea1c0ffee, not b36523e/);
    const silent = await lookAtLive(bad.url, { commit: 'b36523e' });
    assert.match(silent.problems.join('\n'), /does not say which version is running/);
    assert.match(silent.problems.join('\n'), /an address that does not exist answers 500/);
    assert.match(silent.notices.join('\n'), /no title[\s\S]*no viewport[\s\S]*language[\s\S]*og:title[\s\S]*no icon[\s\S]*개인정보 처리방침/);
    assert.equal(await eyesMeanwhile('web', 'live', good.url, '--commit', '955a9ea'), 0);
    assert.equal(await eyesMeanwhile('web', 'live', bad.url, '--commit', '955a9ea'), 1);
    const down = await lookAtLive('http://127.0.0.1:9', { commit: '955a9ea' });
    assert.match(down.problems[0]!, /nothing answers/);
  } finally {
    good.server.close();
    bad.server.close();
  }
});

const GATE: Gate = { place: 'fly', url: 'https://enbbang.example', commit: '955a9ea1c0ffee', previous: 'b36523e000', candidate: 'http://127.0.0.1:4000', check: 'SZ_URL=http://127.0.0.1:4000 npm run check', strangers: 'flow:flows/strangers.sh', data: 'bash scripts/rehearse.sh', backup: 'npm run backup', wayBack: 'fly deploy --image registry.fly.io/enbbang:b36523e', walk: 'flow:flows/live-walk.sh', errors: 'bash scripts/errors-since.sh', kept: 'bash scripts/counts.sh', env: ['.env.production'], migrations: ['migrations/0002_shared.sql'], versionAt: null };

test('the release gate is the same lines every time: each is shown or waived with a reason, never left out', () => {
  const full = gate(GATE, new Map());
  assert.deepEqual(full.claims.map((c) => c.id), GATE_LINES);
  assert.deepEqual(full.waived, []);
  assert.deepEqual(full.claims.find((c) => c.id === 'rc-strangers')!.shownBy, { kind: 'flow', ref: 'flows/strangers.sh' });
  assert.deepEqual(full.claims.find((c) => c.id === 'rc-stands')!.shownBy, { kind: 'command', ref: 'SZ_URL=http://127.0.0.1:4000 npm run check' }, 'a bare command with a colon in it is a command');
  assert.equal(full.claims.find((c) => c.id === 'live-same')!.shownBy.ref, 'sz-eyes web live https://enbbang.example --commit 955a9ea1c0ffee');
  assert.equal(full.claims.find((c) => c.id === 'rc-secrets')!.shownBy.ref, 'sz-eyes web leaks http://127.0.0.1:4000 --env .env.production');
  assert.equal(gate({ ...GATE, versionAt: '/version' }, new Map()).claims.find((c) => c.id === 'live-same')!.shownBy.ref, 'sz-eyes web live https://enbbang.example --commit 955a9ea1c0ffee --at /version', 'a product whose /healthz is promised to say something else says its version elsewhere');
  // Nothing given: every line the product has to say is named at once.
  assert.throws(() => gate({ ...GATE, check: null, strangers: null, walk: '', errors: null }, new Map()), /4 line\(s\) with no way to be shown[\s\S]*rc-stands[\s\S]*--check[\s\S]*rc-strangers[\s\S]*live-walk[\s\S]*live-quiet/);
  assert.throws(() => gate({ ...GATE, strangers: null }, new Map([['rc-strangers', 'n/a']])), /say why rc-strangers does not apply/);
  assert.throws(() => gate(GATE, new Map([['rc-fun', '재미는 주인이 본다']])), /not a line of the gate: rc-fun/);
  const noAccounts = gate({ ...GATE, strangers: null }, new Map([['rc-strangers', '계정이 없다: 링크를 아는 사람이 모두 같은 것을 본다']]));
  assert.ok(!noAccounts.claims.some((c) => c.id === 'rc-strangers'));
  assert.match(noAccounts.waived[0]!, /^rc-strangers \(남이 넣은 것은.*\): 계정이 없다/);
  // A first release has no live data to carry over, and says so itself.
  const firstTime = gate({ ...GATE, previous: null, data: null, kept: null }, new Map());
  assert.deepEqual(firstTime.waived.map((line) => line.split(' ')[0]), ['rc-data', 'rc-shape', 'live-kept']);
  // A release that changes no migration file has no change of shape to read.
  assert.match(gate({ ...GATE, migrations: [] }, new Map()).waived.join('\n'), /^rc-shape .*바뀐 마이그레이션 파일\(\.sql\)이 없다/);
  assert.equal(full.claims.find((c) => c.id === 'rc-shape')!.shownBy.ref, 'sz-eyes migrations look --since b36523e000 --until 955a9ea1c0ffee');
  assert.match(firstTime.waived[0]!, /첫 출하/);
  // A look at what is already live: only the second half.
  assert.deepEqual(gate({ ...GATE, candidate: null }, new Map()).claims.map((c) => c.id), ['live-same', 'live-walk', 'live-secrets', 'live-quiet', 'live-kept']);
});

test('from the command line: a release goes out from closed work and a commit, its claims do not join the standing promises, and it can be taken back', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-release-'));
  const git = (...args: string[]): string => spawnSync('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).stdout.trim();
  try {
    git('init', '-q');
    mkdirSync(join(project, 'flows'));
    writeFileSync(join(project, 'flows/live-walk.sh'), 'true\n');
    writeFileSync(join(project, 'server.mjs'), '// v1\n');
    git('add', '-A');
    git('commit', '-qm', 'v1');
    const v1 = git('rev-parse', 'HEAD');
    const common = ['--place', 'stage', '--url', 'http://127.0.0.1:4100', '--candidate', 'http://127.0.0.1:4101', '--check', 'npm run check', '--backup', 'npm run backup', '--way-back', 'bash scripts/back.sh', '--walk', 'flow:flows/live-walk.sh', '--errors', 'cat data/errors.log', '--without', 'rc-strangers|계정이 없는 제품이다: 링크가 곧 열쇠다', '--frozen', 'flows/live-walk.sh'];

    // Work that is still open is not released.
    assert.equal(eyes(project, 'contract', 'new', 'm1-split', '--lane', 'M', '--request', '나눠 낸다', '--claim', 'split|4만원씩|command:true').code, 0);
    assert.match(eyes(project, 'release', 'new', '--commit', 'HEAD', ...common).text, /work is still open: m1-split/);
    eyes(project, 'contract', 'freeze', 'm1-split');
    eyes(project, 'contract', 'claim', 'm1-split', 'split', '--status', 'proven', '--note', '돌려서 봤다');
    assert.equal(eyes(project, 'contract', 'close', 'm1-split').code, 0);
    // What goes out is a commit.
    writeFileSync(join(project, 'server.mjs'), '// v1 and something uncommitted\n');
    assert.match(eyes(project, 'release', 'new', '--commit', 'HEAD', ...common).text, /changes that are in no commit \(server\.mjs\)/);
    git('checkout', '-q', 'server.mjs');
    assert.match(eyes(project, 'release', 'new', '--commit', 'nope', ...common).text, /nope is not a commit/);
    assert.match(eyes(project, 'release', 'new', '--commit', 'HEAD', ...common.slice(0, 6)).text, /6 line\(s\) with no way to be shown/);

    const made = eyes(project, 'release', 'new', '--commit', 'HEAD', ...common);
    assert.equal(made.code, 0, made.text);
    assert.match(made.text, /# 출하 release-1[\s\S]*곳: stage \(http:\/\/127\.0\.0\.1:4100\)[\s\S]*되돌리는 길: `bash scripts\/back\.sh`/);
    const first = readContract(join(project, CONTRACTS_DIR, 'release-1.json'));
    assert.equal(first.release!.commit, v1, 'the whole name of the commit is kept');
    assert.equal(first.release!.previous, null);
    assert.deepEqual(first.claims.map((c) => c.id), ['rc-stands', 'rc-secrets', 'rc-backup', 'rc-back', 'live-same', 'live-walk', 'live-secrets', 'live-quiet']);
    assert.equal(first.notDoing.length, 4, 'no accounts, and a first release has no live data and no change of shape');
    assert.ok(first.frozenAt !== null && first.frozenPrints['flows/live-walk.sh']);
    // One release at a time to a place, and it owes its lines like any contract.
    assert.match(eyes(project, 'release', 'new', '--commit', 'HEAD', ...common).text, /release-1 is still open for stage/);
    assert.match(eyes(project, 'contract', 'status').text, /release-1[\s\S]*rc-stands: not shown yet/);
    for (const claim of first.claims) assert.equal(eyes(project, 'contract', 'claim', 'release-1', claim.id, '--status', 'proven', '--note', '돌려서 통과를 봤다').code, 0);
    assert.equal(eyes(project, 'contract', 'close', 'release-1').code, 0);
    // What the product keeps true on a developer's machine is the work's claims, not the release's.
    assert.match(eyes(project, 'standing').text, /^1 claim\(s\) stand/);
    assert.match(eyes(project, 'evidence', 'release-1').text, /report\.html/);
    const page = readFileSync(join(project, '.sz/evidence/release-1/report.html'), 'utf8');
    assert.match(page, /<title>출하 release-1<\/title>[\s\S]*되돌리는 길 <code>bash scripts\/back\.sh<\/code>[\s\S]*이번에 보지 않은 것과 까닭/);
    assert.match(eyes(project, 'release', 'list').text, new RegExp(`stage: ${v1.slice(0, 7)} is what was last released \\(release-1`));

    // The next release knows what it takes the place of, and now has live data to carry over.
    writeFileSync(join(project, 'server.mjs'), '// v2\n');
    git('add', '-A');
    git('commit', '-qm', 'v2');
    const v2 = git('rev-parse', 'HEAD');
    assert.match(eyes(project, 'release', 'new', '--commit', v2, ...common).text, /rc-data[\s\S]*--data[\s\S]*live-kept[\s\S]*--kept/);
    assert.equal(eyes(project, 'release', 'new', '--commit', v2, ...common, '--data', 'bash scripts/rehearse.sh', '--kept', 'bash scripts/counts.sh').code, 0);
    const second = readContract(join(project, CONTRACTS_DIR, 'release-2.json'));
    assert.equal(second.release!.previous, v1);
    assert.match(second.notDoing.join('\n'), /rc-shape .*바뀐 마이그레이션 파일/, 'v2 changed no migration file');
    // It failed on what is live and was taken back: what should answer is the first again.
    eyes(project, 'contract', 'claim', 'release-2', 'live-walk', '--status', 'refuted', '--note', '만들기를 눌러도 모임이 생기지 않는다');
    assert.match(eyes(project, 'release', 'back', 'release-2', '--note', 'short').text, /release back <id> --note/);
    const back = eyes(project, 'release', 'back', 'release-2', '--note', 'bash scripts/back.sh로 v1을 다시 띄웠고 healthz가 v1을 말한다');
    assert.match(back.text, new RegExp(`taken back: release-2\\. What should answer at stage now: ${v1.slice(0, 7)}`));
    assert.match(eyes(project, 'release', 'list').text, /release-2 .*출하 .* → .*: 되돌림/);
    assert.match(eyes(project, 'backlog').text, /출하 release-2\(.*\)를 되돌렸다/);
    assert.equal(eyes(project, 'contract', 'status').code, 0, 'a release that was taken back owes nothing more');

    // A look at what is live: the second half of the last release that stands, as a new contract.
    const look = eyes(project, 'release', 'check', '--place', 'stage');
    assert.equal(look.code, 0, look.text);
    const id = /contracts\/(live-[0-9-]+)\.json/.exec(look.text)![1]!;
    const checked = readContract(join(project, CONTRACTS_DIR, `${id}.json`));
    assert.deepEqual([checked.claims.map((c) => c.id), checked.release!.commit, checked.release!.candidate], [['live-same', 'live-walk', 'live-secrets', 'live-quiet'], v1, null]);
    assert.ok(checked.claims.every((c) => c.status === 'unproven'));
    assert.match(eyes(project, 'release', 'check', '--place', 'nowhere').text, /nothing released to nowhere stands/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

const live = (command: string): { code: number | null; text: string } => {
  const run = spawnSync(process.execPath, [join(HERE, '../../../plugin/hooks/guard-live.mjs')], { encoding: 'utf8', input: JSON.stringify({ cwd: tmpdir(), tool_name: 'Bash', tool_input: { command } }) });
  return { code: run.status, text: run.stderr };
};

test('what is live is not deleted or reset by an agent: a release changes it, and the way back undoes a release', () => {
  const refused = live('supabase db reset --linked');
  assert.equal(refused.code, 2);
  assert.match(refused.text, /delete or reset the hosted database[\s\S]*they run it themselves/);
  for (const command of [
    'supabase db reset --db-url "$PROD_DB_URL"',
    'supabase projects delete abcdefghijklmnop',
    'fly apps destroy enbbang --yes',
    'flyctl volumes destroy vol_123 -y',
    'fly postgres detach --app enbbang enbbang-db',
    'npx wrangler d1 delete enbbang-db',
    'wrangler delete --name enbbang',
    'wrangler r2 bucket delete uploads',
    'wrangler d1 execute enbbang-db --remote --command "DROP TABLE expenses"',
    'wrangler d1 time-travel restore enbbang-db --timestamp 2026-11-01T00:00:00Z',
    'vercel rm enbbang --yes',
    'vercel project rm enbbang',
    'firebase firestore:delete --all-collections --force',
    'gcloud sql instances delete enbbang-db',
    'terraform destroy -auto-approve',
    'psql "postgres://postgres:pw@db.abcd.supabase.co:5432/postgres" -c "drop table groups"',
    'psql postgres://app:pw@10.0.0.5/app -c \'TRUNCATE members\'',
    'pg_restore --clean -d postgres://app:pw@db.example.com/app dump.bin',
    'heroku pg:reset DATABASE --confirm enbbang',
    'gh repo delete someone/enbbang --yes',
    'cd infra && terraform apply -destroy',
  ]) assert.equal(live(command).code, 2, command);
  for (const command of [
    'supabase db reset',
    'sz-eyes supabase db reset',
    'supabase db push --yes',
    'supabase migration new add_shared_by',
    'fly deploy --image registry.fly.io/enbbang:b36523e',
    'fly volumes list',
    'fly releases --image --json',
    'wrangler deploy',
    'wrangler rollback 3f2a --message "live-walk failed"',
    'wrangler d1 execute enbbang-db --local --command "DROP TABLE scratch"',
    'wrangler d1 execute enbbang-db --remote --command "select count(*) from groups"',
    'wrangler d1 migrations apply enbbang-db --remote',
    'vercel deploy --prod',
    'vercel rollback',
    'psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "drop table scratch"',
    'psql "postgres://app:pw@db.example.com/app" -c "select count(*) from groups"',
    'docker volume rm sz-place-moim-data-test',
    'git commit -m "never run terraform destroy or fly apps destroy from an agent"',
    'echo "supabase db reset --linked 은 주인이 직접" >> .sz/map.md',
    'grep -rn "drop table" migrations/',
  ]) assert.equal(live(command).code, 0, command);
});

test('the door to the local Supabase stack does not open on a hosted project, and neither tool is given the owner\'s broken settings', () => {
  for (const args of [['db', 'push'], ['db', 'reset', '--linked'], ['link', '--project-ref', 'abcd'], ['projects', 'list'], ['secrets', 'set', 'A=b'], ['functions', 'deploy', 'hello'], ['db', 'dump', '--db-url', 'postgres://postgres:pw@db.abcd.supabase.co:5432/postgres'], ['login'], ['migration', 'repair', '--status', 'applied', '1']]) assert.ok(hostedSupabaseCall(args) !== null, args.join(' '));
  for (const args of [['start', '--exclude', 'studio,analytics'], ['stop'], ['status'], ['db', 'reset'], ['db', 'diff', '-f', 'add_table'], ['migration', 'new', 'init'], ['migration', 'up'], ['functions', 'serve'], ['gen', 'types', 'typescript', '--local'], ['db', 'dump', '--db-url', 'postgres://postgres:postgres@127.0.0.1:54322/postgres'], ['stack', 'destroy', '--yes']]) assert.equal(hostedSupabaseCall(args), null, args.join(' '));
  assert.match(eyes(tmpdir(), 'supabase', 'db', 'push').text, /not passed on: `supabase db push` acts on a hosted project/);

  const home = mkdtempSync(join(tmpdir(), 'eyes-home-'));
  try {
    mkdirSync(join(home, '.docker'));
    writeFileSync(join(home, '.docker/config.json'), '{"credsStore":"nonesuch-helper"}');
    const env = engineEnv({ PATH: '/usr/bin:/bin', DOCKER_CONFIG: join(home, '.docker') }, home);
    assert.deepEqual([env.SUPABASE_TELEMETRY_DISABLED, env.SUPABASE_EXPERIMENTAL_STACK, env.DO_NOT_TRACK], ['1', '1', '1']);
    assert.equal(env.DOCKER_CONFIG, join(home, '.studio-zero/docker'), 'a credential helper that is not installed: the harness uses an empty configuration of its own');
    assert.equal(readFileSync(join(home, '.docker/config.json'), 'utf8'), '{"credsStore":"nonesuch-helper"}', 'the owner\'s file is read, never changed');
    writeFileSync(join(home, '.docker/config.json'), '{}');
    assert.equal(engineEnv({ PATH: '/usr/bin:/bin', DOCKER_CONFIG: join(home, '.docker') }, home).DOCKER_CONFIG, join(home, '.docker'), 'settings that work are left as they are');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// A notes product with accounts. `holes` switches on the faults agents ship: a list that returns everyone's
// rows, a delete that does not ask whose the row is, and a write that needs no session.
const notesProduct = (holes: boolean) => {
  const notes: { id: number; owner: string; body: string }[] = [];
  let next = 1;
  const page = `<!doctype html><html lang="ko"><title>메모</title><body>
<form id="in"><input aria-label="이름" id="name"><button>들어가기</button></form>
<form id="add" hidden><input aria-label="메모" id="body"><button>적기</button></form><ul id="list"></ul><p id="who"></p>
<script>
const list = async () => {
  const mine = await (await fetch('/api/notes')).json();
  await fetch('/api/config');
  ${holes ? "await fetch('/api/notes?all=1');" : ''}
  document.querySelector('#list').innerHTML = mine.map((n) => '<li><span>' + n.body + '</span> <button data-id="' + n.id + '" aria-label="' + n.body + ' 지우기">지우기</button></li>').join('');
};
document.querySelector('#in').onsubmit = async (e) => { e.preventDefault(); await fetch('/api/login', { method: 'POST', body: JSON.stringify({ name: document.querySelector('#name').value }) }); document.querySelector('#add').hidden = false; document.querySelector('#who').textContent = '들어왔어요'; await list(); };
document.querySelector('#add').onsubmit = async (e) => { e.preventDefault(); await fetch('/api/notes', { method: 'POST', body: JSON.stringify({ body: document.querySelector('#body').value }) }); await list(); };
document.querySelector('#list').onclick = async (e) => { if (e.target.dataset.id) { await fetch('/api/notes/' + e.target.dataset.id, { method: 'DELETE' }); await list(); } };
</script></body></html>`;
  return serve((req, res) => {
    const who = /sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? null;
    const json = (status: number, body: unknown, extra: Record<string, string> = {}): void => void res.writeHead(status, { 'content-type': 'application/json', ...extra }).end(JSON.stringify(body));
    let sent = '';
    req.on('data', (chunk) => (sent += chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
      if (url.pathname === '/api/config') return json(200, { name: '메모', maxLength: 200, greeting: '안녕하세요, 메모입니다' });
      if (url.pathname === '/api/login') return json(200, { ok: true }, { 'set-cookie': `sid=${encodeURIComponent(JSON.parse(sent).name)}; Path=/; HttpOnly` });
      if (url.pathname === '/api/notes' && req.method === 'GET') {
        if (holes && url.searchParams.has('all')) return json(200, notes);
        return who ? json(200, notes.filter((n) => n.owner === who)) : json(401, { error: '로그인이 필요해요' });
      }
      if (url.pathname === '/api/notes' && req.method === 'POST') {
        if (!who && !holes) return json(401, { error: '로그인이 필요해요' });
        const note = { id: next++, owner: who ?? 'nobody', body: JSON.parse(sent).body };
        notes.push(note);
        return json(201, note);
      }
      const one = /^\/api\/notes\/(\d+)$/.exec(url.pathname);
      if (one && req.method === 'DELETE') {
        const at = notes.findIndex((n) => n.id === Number(one[1]) && (holes || n.owner === who));
        if (at < 0 || (!who && !holes)) return json(404, { error: '없어요' });
        notes.splice(at, 1);
        return json(200, { ok: true });
      }
      json(404, { error: '없어요' });
    });
  });
};

test('what one person stored is asked for again as nobody and as a second person, and only a product with holes gives it up', async (t) => {
  assert.deepEqual(marksOf(['type:이름=수아', 'type:메모=수아만-아는-메모-7f3', 'type:비밀번호=같은비밀번호', 'tap:적기'], ['type:이름=지훈', 'type:비밀번호=같은비밀번호']), ['수아만-아는-메모-7f3'], 'what both typed, and what is too short to be anyone\'s alone, marks nothing');
  const as = ['type:이름=수아', 'tap:들어가기', 'wait:들어왔어요', 'type:메모=수아만-아는-메모-7f3', 'tap:적기', 'wait:수아만-아는-메모-7f3', 'type:메모=지울-메모-수아-91c', 'tap:적기', 'wait:지울-메모-수아-91c 지우기', 'tap:지울-메모-수아-91c 지우기', 'gone:지울-메모-수아-91c 지우기'];
  const other = ['type:이름=지훈', 'tap:들어가기', 'wait:들어왔어요'];
  const browser = await openBrowser().catch((err: unknown) => {
    if (/Chromium distribution 'chrome' is not found|Executable doesn't exist|ProcessSingleton/.test(String(err))) return null;
    throw err;
  });
  if (browser === null) return t.skip('no Chrome on this machine');
  const tight = await notesProduct(false);
  const loose = await notesProduct(true);
  try {
    const sound = await strangers(tight.url, { as, other, open: ['/api/config'], browser });
    assert.deepEqual([sound.stopped, sound.findings, sound.open, sound.withOther], [null, [], ['/api/config'], true], renderStrangers(sound, tight.url));
    assert.ok(sound.reads >= 2 && sound.changes === 3, `two notes made and one removed: ${sound.reads} reads, ${sound.changes} changes`);
    assert.match(renderStrangers(sound, tight.url), /nothing of the first person's was given to anyone else/);

    const holed = await strangers(loose.url, { as, other, open: ['/api/config'], browser });
    const whys = holed.findings.map((f) => `${f.who}: ${f.method} ${new URL(f.url).pathname}${new URL(f.url).search}`);
    assert.ok(whys.includes('nobody: GET /api/notes?all=1') && whys.includes('another person: GET /api/notes?all=1'), whys.join('\n'));
    assert.ok(whys.includes('nobody: POST /api/notes'), 'a write with no session went through');
    assert.ok(whys.some((line) => /^nobody: DELETE \/api\/notes\/\d+$/.test(line)), `someone else removed the first person's note before they did:\n${whys.join('\n')}`);
    assert.equal(holed.stopped, null, 'the walk itself went to its end');
    assert.ok(!whys.some((line) => line.startsWith('another person: POST')), 'a second person making a note of their own is not a finding');
    assert.ok(!whys.some((line) => line.endsWith('GET /api/notes')), 'the list that gives each person their own is sound in both');
    assert.match(renderStrangers(holed, loose.url), /FINDING\(S\)[\s\S]*what only the first person stored \(it holds "수아만-아는-메모-7f3"\)/);

    // A walk that cannot be done proves nothing, and neither does one that asks a server for nothing.
    const stuck = await strangers(tight.url, { as: ['tap:없는 단추'], other, browser, stepTimeoutMs: 800 });
    assert.match(renderStrangers(stuck, tight.url), /the walk stopped, so nothing can be said: as the first person, tap:없는 단추/);
    const idle = await strangers(tight.url, { as: ['see:들어가기'], browser });
    assert.match(renderStrangers(idle, tight.url), /asked nothing of a server during the walk/, 'nothing asked of a server: not a pass');
    // From the command line, each on a product nobody has used yet.
    const [tight2, loose2] = [await notesProduct(false), await notesProduct(true)];
    try {
      assert.equal(await eyesMeanwhile('web', 'strangers', tight2.url, ...as.flatMap((step) => ['--as', step]), ...other.flatMap((step) => ['--other', step]), '--open', '/api/config'), 0);
      assert.equal(await eyesMeanwhile('web', 'strangers', loose2.url, ...as.flatMap((step) => ['--as', step]), ...other.flatMap((step) => ['--other', step]), '--open', '/api/config'), 1);
    } finally {
      tight2.server.close();
      loose2.server.close();
    }
  } finally {
    await closeBrowser(browser);
    tight.server.close();
    loose.server.close();
  }
});

test('a change to the shape of what is stored is read for what it can lose or break, and a rule on a new table is not one', () => {
  const sql = `-- 0002: share expenses; do not drop table anything; here
create table if not exists public.shares (id integer primary key, expense_id integer not null, member_id integer not null);
create unique index shares_once on public.shares (expense_id, member_id);
alter table shares add constraint shares_member foreign key (member_id) references members (id);
alter table expenses add column shared_by text; /* nullable: fine */
alter table expenses add column note text not null default '';
insert into settings (key, value) values ('greeting', 'drop table members; truncate');
create function tidy() returns void as $$ begin delete from scratch; end $$ language plpgsql;

alter table expenses add column kind text not null;
alter table members rename column name to display_name;
ALTER TABLE "expenses"
  DROP COLUMN memo;
alter table expenses alter column amount type integer;
alter table members alter column email set not null;
alter table members add constraint members_email unique (email);
create unique index members_name on members (name);
alter table members disable row level security;
drop policy "own rows" on members;
delete from sent;
delete from sent where group_id = 1;
alter table members alter column nick drop default;
drop table old_groups;`;
  assert.equal(statements('select 1; -- a; b\nselect \'x;y\'; /* c; d */ select $f$ a; b $f$;').length, 3, 'a semicolon in a comment, in quotes or in a function body ends nothing');
  const steps = classify([{ file: 'migrations/0002.sql', sql }]);
  const of = (kind: string): string[] => steps.filter((s) => s.kind === kind).map((s) => `${s.line}: ${s.statement.slice(0, 44)}`);
  assert.deepEqual(of('loses'), ['12: ALTER TABLE "expenses" DROP COLUMN memo', '20: delete from sent', '23: drop table old_groups']);
  assert.deepEqual(of('breaks'), ['11: alter table members rename column name to di', '14: alter table expenses alter column amount typ']);
  assert.deepEqual(of('can-fail').map((line) => line.split(':')[0]), ['10', '15', '16', '17'], 'a required column with no default, and rules added to tables that have rows');
  assert.deepEqual(of('opens').map((line) => line.split(':')[0]), ['18', '19'], 'row security turned off, and a policy removed');
  assert.deepEqual(steps.filter((s) => s.kind === 'opens').map((s) => s.statement.slice(0, 20)), ['alter table members ', 'drop policy "own row']);
  // On the table the same files create, a rule cannot fail on stored rows; text in quotes and bodies is data.
  assert.deepEqual(steps.slice(0, 7).map((s) => s.kind), ['adds', 'adds', 'adds', 'adds', 'adds', 'data', 'adds']);
  assert.equal(steps.find((s) => s.line === 21)!.kind, 'data', 'deleting some rows is a change of rows');
  assert.equal(steps.find((s) => s.line === 22)!.kind, 'other', 'dropping a default loses nothing');
  const said = renderMigrations(steps, ['migrations/0002.sql']);
  assert.match(said, /11 STATEMENT\(S\) THAT DO NOT GO OUT WITHOUT THE OWNER'S YES[\s\S]*migrations\/0002\.sql:11 \[breaks\] renames a table or a column/);
  assert.match(renderMigrations(classify([{ file: 'a.sql', sql: 'create table t (id integer primary key, name text not null unique);' }]), ['a.sql']), /nothing in them drops, renames, narrows or opens/);

  // From the command line, by the files that changed between two commits.
  const project = mkdtempSync(join(tmpdir(), 'eyes-shape-'));
  const git = (...args: string[]): string => spawnSync('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).stdout.trim();
  try {
    git('init', '-q');
    mkdirSync(join(project, 'migrations'));
    writeFileSync(join(project, 'migrations/0001_init.sql'), 'create table members (id integer primary key, name text not null);\n');
    git('add', '-A');
    git('commit', '-qm', 'v1');
    const v1 = git('rev-parse', 'HEAD');
    writeFileSync(join(project, 'migrations/0002_nick.sql'), 'alter table members add column nick text;\n');
    git('add', '-A');
    git('commit', '-qm', 'v2');
    const v2 = git('rev-parse', 'HEAD');
    writeFileSync(join(project, 'migrations/0003_rename.sql'), 'alter table members rename column nick to nickname;\n');
    git('add', '-A');
    git('commit', '-qm', 'v3');
    const safe = eyes(project, 'migrations', 'look', '--since', v1, '--until', v2);
    assert.equal(safe.code, 0, safe.text);
    assert.match(safe.text, /1 migration file\(s\), 1 statement\(s\): 1 add/);
    const renamed = eyes(project, 'migrations', 'look', '--since', v2);
    assert.equal(renamed.code, 1);
    assert.match(renamed.text, /migrations\/0003_rename\.sql:1 \[breaks\]/);
    assert.equal(eyes(project, 'migrations', 'look', 'migrations/0001_init.sql').code, 0);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('several products are read at once: what waits for the owner and what broke come first, then what is live where', () => {
  const root = mkdtempSync(join(tmpdir(), 'eyes-overview-'));
  const git = (dir: string, ...args: string[]): string => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).stdout.trim();
  try {
    const [a, b] = [join(root, 'enbbang'), join(root, 'maeum')];
    for (const dir of [a, b, join(root, 'not-a-product')]) mkdirSync(join(dir, 'flows'), { recursive: true });
    // One product: work closed, one thing left to the owner, released to a place, and then a promise broke.
    mkdirSync(join(a, '.sz'));
    writeFileSync(join(a, '.sz/map.md'), '# 지도: 엔빵\n\n## 무엇인가\n\n친구 모임의 정산 웹앱.\n');
    writeFileSync(join(a, '.sz/progress.md'), '# 진행\n\n- 2026-11-15 M1 닫음\n- 2026-11-15 mac-stage에 내보냄\n');
    writeFileSync(join(a, 'flows/split.sh'), 'true\n');
    git(a, 'init', '-q');
    assert.equal(eyes(a, 'contract', 'new', 'm1-split', '--lane', 'M', '--request', '나눠 낸다', '--claim', 'split|셋이 12만원이면 4만원씩|flow:flows/split.sh', '--claim', 'feel|숫자가 크게 느껴진다|owner:폰 사진').code, 0);
    eyes(a, 'contract', 'freeze', 'm1-split', '--frozen', 'flows/split.sh');
    eyes(a, 'contract', 'claim', 'm1-split', 'split', '--status', 'proven', '--note', '돌려서 통과를 봤다');
    eyes(a, 'contract', 'claim', 'm1-split', 'feel', '--status', 'unchecked', '--note', '폰 사진 두 장을 붙였다');
    eyes(a, 'evidence', 'm1-split');
    eyes(a, 'contract', 'close', 'm1-split');
    git(a, 'add', '-A');
    git(a, 'commit', '-qm', 'v1');
    const made = eyes(a, 'release', 'new', '--place', 'mac-stage', '--url', 'http://127.0.0.1:4100', '--candidate', 'http://127.0.0.1:4101', '--commit', 'HEAD', '--check', 'npm run check', '--backup', 'npm run backup', '--way-back', 'bash scripts/back.sh', '--walk', 'bash flows/live-walk.sh', '--errors', 'cat errors.log', '--without', 'rc-strangers|계정이 없는 제품이다: 링크가 곧 열쇠다');
    assert.equal(made.code, 0, made.text);
    for (const claim of readContract(join(a, CONTRACTS_DIR, 'release-1.json')).claims) eyes(a, 'contract', 'claim', 'release-1', claim.id, '--status', 'proven', '--note', '돌려서 통과를 봤다');
    assert.equal(eyes(a, 'contract', 'close', 'release-1').code, 0);
    assert.equal(eyes(a, 'standing', 'record', 'm1-split/split', '--status', 'broken', '--note', '4만원이 아니라 3만9천원이 나온다').code, 0);
    // Another: only a spec, nothing built.
    mkdirSync(join(b, '.sz'));
    writeFileSync(join(b, '.sz/spec.md'), '# 마음장부: 경조사비 장부\n\n2026-11-15 처음 씀.\n\n## 무엇이고 누구를 위한 것인가\n\n경조사비를 적어 두는 서비스.\n');

    assert.deepEqual(findProducts([root]), [a, b], 'a folder that holds projects: its children that have a .sz/');
    assert.deepEqual(findProducts([a]), [a]);
    const views = findProducts([root]).map((dir) => viewOf(dir)!);
    assert.equal(viewOf(join(root, 'not-a-product')), null);
    const [one, two] = views;
    assert.deepEqual([one!.name, one!.says, one!.stands, one!.broken.length, one!.open.length], ['엔빵', '친구 모임의 정산 웹앱.', 1, 1, 0]);
    assert.deepEqual(one!.waiting.map((w) => [w.text, w.page?.endsWith('.sz/evidence/m1-split/report.html')]), [['숫자가 크게 느껴진다: 폰 사진 두 장을 붙였다', true]]);
    assert.deepEqual(one!.live.map((l) => [l.place, l.url, l.release, l.checked, l.wayBack]), [['mac-stage', 'http://127.0.0.1:4100', 'release-1', null, 'bash scripts/back.sh']]);
    assert.equal(one!.last, '2026-11-15 mac-stage에 내보냄');
    assert.deepEqual([two!.name, two!.says, two!.live, two!.stands], ['마음장부: 경조사비 장부', '경조사비를 적어 두는 서비스.', [], 0]);
    // A look at what is live shows as when it was last looked at there.
    assert.equal(eyes(a, 'release', 'check', '--place', 'mac-stage').code, 0);
    assert.match(viewOf(a)!.live[0]!.checked!.verdict, /진행 중/);

    const said = renderOverview(findProducts([root]).map((dir) => viewOf(dir)!));
    assert.match(said, /^깨진 약속 1:\n  - 엔빵: 셋이 12만원이면 4만원씩 \(m1-split\/split\)\n\n주인의 판단을 기다리는 것 1:\n  - 엔빵: 숫자가 크게 느껴진다/);
    assert.match(said, /살아 있는 곳 mac-stage: http:\/\/127\.0\.0\.1:4100 · [0-9a-f]{7} \(\d{4}-\d\d-\d\d release-1\) · 마지막 점검/);
    assert.match(said, /마음장부: 경조사비 장부[\s\S]*아직 어디에도 내놓지 않음/);
    const out = eyes(root, 'overview', root, '--out', join(root, 'page/overview.html'));
    assert.equal(out.code, 0, out.text);
    const page = readFileSync(join(root, 'page/overview.html'), 'utf8');
    assert.match(page, /<title>작업실<\/title>[\s\S]*먼저 볼 것: 깨진 약속[\s\S]*주인의 판단을 기다리는 것[\s\S]*<h2>숫자가 크게 느껴진다<\/h2>[\s\S]*폰 사진 두 장을 붙였다[\s\S]*증거 페이지 열기/);
    assert.match(page, /<meta name="viewport"/);
    assert.equal(overviewPage([], '2026-11-15T00:00:00.000Z').includes('제품 0개'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a command is given the owner\'s keys by name, and a key it prints does not reach the session', async () => {
  const kept = new Map<string, string>();
  const store: SecretStore = { get: async (id) => (kept.has(id) ? { expose: () => kept.get(id)! } : null), set: async (id, secret) => void kept.set(id, secret.expose()) };
  assert.deepEqual(parseRun(['CLOUDFLARE_API_TOKEN=host/cloudflare/api-token', 'KAKAO=login/kakao/client-secret', '--', 'npx', 'wrangler', 'deploy', '--', 'x']), { bindings: [{ env: 'CLOUDFLARE_API_TOKEN', id: 'host/cloudflare/api-token' }, { env: 'KAKAO', id: 'login/kakao/client-secret' }], command: ['npx', 'wrangler', 'deploy', '--', 'x'] });
  assert.throws(() => parseRun(['TOKEN=host/cloudflare/api-token']), /secret run <NAME>=<vault id>/);
  assert.throws(() => parseRun(['TOKEN=the-actual-secret-value', '--', 'true']), /is not <NAME>=<vault id>/, 'a value where an id belongs is refused before anything runs');
  assert.equal(hide('token k9Qw7LmZp2Xv and again k9Qw7LmZp2Xv', [{ env: 'TOKEN', value: 'k9Qw7LmZp2Xv' }]), 'token [TOKEN: hidden] and again [TOKEN: hidden]');

  await setSecret(store, 'host/cloudflare/api-token', 'k9Qw7LmZp2Xv4Ra8Tn3Yb6Ue\n');
  assert.equal(kept.get('host/cloudflare/api-token'), 'k9Qw7LmZp2Xv4Ra8Tn3Yb6Ue', 'the newline a clipboard adds is not part of the key');
  await assert.rejects(setSecret(store, 'Bad Id', 'x'), /is not a vault id/);
  await assert.rejects(setSecret(store, 'host/x/y', ' \n'), /nothing came on stdin/);
  assert.deepEqual(await heldSecrets(store, ['host/cloudflare/api-token', 'host/fly/api-token']), [{ id: 'host/cloudflare/api-token', held: true }, { id: 'host/fly/api-token', held: false }]);

  let [out, err] = ['', ''];
  const io = { out: (text: string) => void (out += text), err: (text: string) => void (err += text) };
  // The command has the key (it can use it), and what it prints of it is taken out, on both streams.
  const code = await runWithSecrets(store, [{ env: 'TOKEN', id: 'host/cloudflare/api-token' }], [process.execPath, '-e', 'const t = process.env.TOKEN; console.log(`length ${t.length}`); console.log(`the key is ${t}`); process.stderr.write(`warn ${t}`); process.exit(t === "k9Qw7LmZp2Xv4Ra8Tn3Yb6Ue" ? 7 : 1)'], io);
  assert.equal(code, 7, 'the command\'s own exit is passed on');
  assert.equal(out, 'length 24\nthe key is [TOKEN: hidden]\n');
  assert.equal(err, 'warn [TOKEN: hidden]');
  await assert.rejects(runWithSecrets(store, [{ env: 'FLY', id: 'host/fly/api-token' }], ['true'], io), /not in the vault: host\/fly\/api-token[\s\S]*pbpaste \| sz-eyes secret set host\/fly\/api-token/);
  assert.match(eyes(tmpdir(), 'secret', 'run', 'TOKEN=not an id', '--', 'true').text, /is not <NAME>=<vault id>/);
});

test('a thing that moves by itself is asked with its time held still, and says the same every time', async (t) => {
  // A game in forty lines: a square that moves 100px a second while the right arrow is held, and a score that
  // goes up once a second after Space. It keeps time the way games do (frames, and the clock).
  const game = `<!doctype html><html lang="ko"><title>네모</title><canvas id="c" width="300" height="100"></canvas><p id="hud">0점</p><script>
const s = { x: 0, score: 0, started: false, since: 0, frames: 0 };
const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.key); if (e.key === ' ' && !s.started) { s.started = true; s.since = performance.now(); } });
addEventListener('keyup', (e) => keys.delete(e.key));
let last = performance.now();
const frame = (now) => {
  const dt = (now - last) / 1000; last = now; s.frames++;
  if (keys.has('ArrowRight')) s.x += 100 * dt;
  if (s.started) s.score = Math.floor((now - s.since) / 1000);
  document.querySelector('#hud').textContent = s.score + '점';
  const g = document.querySelector('#c').getContext('2d'); g.clearRect(0, 0, 300, 100); g.fillRect(s.x, 40, 20, 20);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
window.__game = { state: () => ({ x: Math.round(s.x), score: s.score, started: s.started }) };
</script></html>`;
  const { server, url } = await serve((_req, res) => void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(game));
  const browser = await openBrowser().catch((err: unknown) => {
    if (/Chromium distribution 'chrome' is not found|Executable doesn't exist|ProcessSingleton/.test(String(err))) return null;
    throw err;
  });
  if (browser === null) {
    server.close();
    return t.skip('no Chrome on this machine');
  }
  try {
    const steps = ['read:before=window.__game.state()', 'press:Space', 'run:3000', 'expect:window.__game.state().score === 3', 'hold:ArrowRight=500', 'read:after=window.__game.state()', 'see:3점'];
    const play = await walkWeb(url, steps, { clock: true, browser });
    assert.equal(play.passed, true, renderWalk(play, steps.length));
    assert.deepEqual(play.reads.before, { x: 0, score: 0, started: false });
    assert.deepEqual(play.reads.after, { x: 50, score: 3, started: true }, 'three seconds of its own time, then half a second with the key held');
    // Asked again, it says the same: its time moved only when it was told to.
    const again = await walkWeb(url, steps, { clock: true, browser });
    assert.deepEqual(again.reads, play.reads);
    assert.match(renderWalk(play, steps.length), /read after: \{"x":50,"score":3,"started":true\}/);
    // What is expected and is not so stops the walk, with what it is instead.
    const wrong = await walkWeb(url, ['press:Space', 'run:2000', 'expect:window.__game.state().score >= 5'], { clock: true, browser });
    assert.equal(wrong.passed, false);
    assert.match(wrong.steps.at(-1)!.why ?? '', /not so: window\.__game\.state\(\)\.score >= 5 \(it is false\)/);
    // With its time held, nothing happens that was not asked for.
    const still = await walkWeb(url, ['press:Space', 'read:s=window.__game.state().score'], { clock: true, browser });
    assert.equal(still.reads.s, 0);
  } finally {
    await closeBrowser(browser);
    server.close();
  }
});

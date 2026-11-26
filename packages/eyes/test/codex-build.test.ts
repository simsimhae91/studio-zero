import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startBuildRun } from '../src/build-run.ts';

const bridge = fileURLToPath(new URL('../../../plugin/codex/tools.mjs', import.meta.url));
const build = fileURLToPath(new URL('../../../plugin/bin/sz-codex-build', import.meta.url));
type ToolCall = { name: 'shell' | 'record' | 'electron'; arguments: { command?: string; args?: string[] } };
const shell = (command: string): ToolCall => ({ name: 'shell', arguments: { command } });
const record = (...args: string[]): ToolCall => ({ name: 'record', arguments: { args } });

function calls(root: string, role: string, ...tools: ToolCall[]) {
  return callsOfRun('', root, role, ...tools);
}

/** The same, from a worker of a build run, which is handed the run's token. */
function callsOfRun(token: string, root: string, role: string, ...tools: ToolCall[]) {
  const result = spawnSync(process.execPath, [bridge, root, role, 'triple', role + ':triple', ...(token ? [token] : [])], {
    input:
      tools.map((params, id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params })).join('\n') + '\n',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line).result);
}

test('native entry preserves owner gate before a model is called', () => {
  const r = spawnSync(build, { input: JSON.stringify({ request: 'build' }), encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(JSON.parse(r.stdout).error, /not started/);
  assert.doesNotMatch(r.stderr, /\[plan\]/);
});

test(
  'the installed local plugin finds both executables in its marketplace checkout',
  { skip: spawnSync('codex', ['--version']).status !== 0 && 'Codex CLI is not installed' },
  (t) => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'sz-plugin-test-')));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const env = { ...process.env, CODEX_HOME: home };
    const checkout = fileURLToPath(new URL('../../../', import.meta.url));
    const installed = spawnSync('codex', ['plugin', 'marketplace', 'add', checkout], { env, encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stderr);
    const added = spawnSync('codex', ['plugin', 'add', 'sz@studio-zero', '--json'], { env, encoding: 'utf8' });
    assert.equal(added.status, 0, added.stderr);
    const bin = join(JSON.parse(added.stdout).installedPath, 'bin');
    for (const name of ['sz-codex-build', 'sz-eyes']) {
      const result = spawnSync(join(bin, name), ['--help'], { env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(name));
    }
  },
);

test('builders cannot record verdicts or use owner or different-project overrides', () => {
  for (const r of calls(
    process.cwd(),
    'build',
    record('contract', 'claim', 'triple'),
    record('contract', 'built', 'other'),
    record('contract', 'freeze', 'triple', '--dir', '/tmp'),
    record('contract', 'judged', 'triple'),
    shell('killall node'),
  ))
    assert.equal(r.isError, true);
});

test(
  'real Codex sandbox enforces the build / verify / fix / close boundary',
  {
    skip:
      !process.env.SZ_TEST_CODEX_SANDBOX && 'set SZ_TEST_CODEX_SANDBOX=1 in a terminal that can create a Codex sandbox',
  },
  (t) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sz-contract-test-')));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, '.sz/evidence/triple'), { recursive: true });
    writeFileSync(join(root, 'app.mjs'), 'console.log(8)\n');
    writeFileSync(join(root, 'check.sh'), 'test "$(node app.mjs)" = 12\n');
    const run = (role: string, tool: ToolCall, fails = false) => {
      const [answer] = calls(root, role, tool);
      assert.equal(answer.isError, fails, answer.content[0].text);
    };
    run(
      'build',
      shell('git init -q && git add app.mjs && git -c user.name=Test -c user.email=test@localhost commit -qm initial'),
    );
    run(
      'build',
      record(
        'contract',
        'new',
        'triple',
        '--request',
        'Triple four',
        '--claim',
        'four|Four triples to twelve|test:check.sh',
      ),
    );
    run('build', record('contract', 'freeze', 'triple', '--frozen', 'check.sh'));
    run('build', shell('echo true > check.sh'), true);
    run('verifier', shell('echo bad > app.mjs'), true);
    if (process.platform === 'darwin') {
      const publish = fileURLToPath(new URL('../../../plugin/codex/electron-publish.py', import.meta.url));
      const [result] = calls(root, 'verifier', shell(
        `mkdir "$TMPDIR/pictures" && echo fixture > "$TMPDIR/pictures/look.png" && /usr/bin/python3 "${publish}" triple "$TMPDIR/pictures"`,
      ));
      assert.equal(result.isError, false, result.content[0].text);
      const path = result.content[0].text.trim().split('\n').at(-1);
      assert.equal(readFileSync(join(root, path), 'utf8'), 'fixture\n');
    }
    run('verifier', shell('sh check.sh'), true);
    run('verifier', record('contract', 'claim', 'triple', 'four', '--status', 'refuted', '--note', 'got 8'));
    run('close', record('contract', 'close', 'triple'), true);
    run('close', shell('echo wrong > app.mjs'), true);
    run('fix', shell("echo 'console.log(12)' > app.mjs"));
    run('verifier', shell('sh check.sh'));
    run('verifier', record('contract', 'claim', 'triple', 'four', '--status', 'proven', '--note', 'got 12'));
    run('close', record('contract', 'close', 'triple'));
    run('close', shell('sz-eyes evidence triple'));
    assert.match(readFileSync(join(root, '.sz/evidence/triple/report.html'), 'utf8'), /Four triples/);
    run('stage', shell('git worktree add -q .sz/trees/side -b sz/side'));
    const [side] = calls(
      join(root, '.sz/trees/side'),
      'build',
      shell(
        'echo side > side.txt && git add side.txt && git -c user.name=Test -c user.email=test@localhost commit -qm side',
      ),
    );
    assert.equal(side.isError, false, side.content[0].text);
  },
);

test(
  'real Codex sandbox hands a worker of a build run its token, and the ledger refuses one without it',
  {
    skip:
      !process.env.SZ_TEST_CODEX_SANDBOX && 'set SZ_TEST_CODEX_SANDBOX=1 in a terminal that can create a Codex sandbox',
  },
  (t) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sz-run-token-test-')));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, 'check.sh'), 'true\n');
    const git = spawnSync('sh', ['-c', 'git init -q && git add check.sh && git -c user.name=Test -c user.email=test@localhost commit -qm initial'], { cwd: root });
    assert.equal(git.status, 0);
    const token = startBuildRun(root, 'triple four');
    const ofRun = (role: string, tool: ToolCall) => callsOfRun(token, root, role, tool)[0];
    for (const [role, tool] of [
      ['build', record('contract', 'new', 'triple', '--request', 'Triple four', '--claim', 'four|Four triples to twelve|test:check.sh')],
      ['build', record('contract', 'freeze', 'triple', '--frozen', 'check.sh')],
      ['verifier', record('contract', 'claim', 'triple', 'four', '--status', 'proven', '--note', 'check.sh passed')],
    ] as const) {
      const answer = ofRun(role, tool);
      assert.equal(answer.isError, false, answer.content[0].text);
    }
    const [env, direct] = callsOfRun(token, root, 'verifier', shell('printenv SZ_BUILD_TOKEN || echo none'),
      shell('sz-eyes contract claim triple four --status proven --note checked'));
    assert.equal(env.content[0].text.trim(), 'none');
    assert.equal(env.isError, false, env.content[0].text);
    assert.equal(direct.isError, true);
    assert.match(direct.content[0].text, /not recorded: a build run/);
    const [outside] = calls(root, 'verifier', record('contract', 'claim', 'triple', 'four', '--status', 'refuted', '--note', 'a session beside the run'));
    assert.equal(outside.isError, true);
    assert.match(outside.content[0].text, /not recorded: a build run/);
  },
);

test('only the closer can write or prune the evidence of its own contract', () => {
  for (const [role, tool] of [
    ['build', record('evidence', 'triple')],
    ['close', record('evidence', 'other')],
    ['close', record('evidence', 'prune', 'other')],
    ['close', record('evidence', 'triple', '--dir', '/tmp')],
    ['close', record('evidence', 'prune', 'triple', '--anything')],
  ] as const) {
    const [answer] = calls(process.cwd(), role, tool);
    assert.equal(answer.isError, true);
  }
});

test('a locked run closes with its evidence pruned and committed, through the closer’s record tool', {
  skip: !process.env.SZ_TEST_CODEX_SANDBOX && 'set SZ_TEST_CODEX_SANDBOX=1 to exercise the native Codex sandbox',
}, async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sz-locked-close-')));
  const bin = realpathSync(mkdtempSync(join(tmpdir(), 'sz-scripted-close-')));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(bin, { recursive: true, force: true }); });
  writeFileSync(join(root, 'check.sh'), 'true\n');
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);
  const token = startBuildRun(root, 'triple four');
  const seed = [
    ...callsOfRun(token, root, 'build',
      record('contract', 'new', 'triple', '--request', 'triple four', '--claim', 'four|Four triples to twelve|test:check.sh'),
      record('contract', 'freeze', 'triple', '--frozen', 'check.sh'),
      record('contract', 'built', 'triple', '--launch', 'sh check.sh')),
    ...callsOfRun(token, root, 'verifier', record('contract', 'claim', 'triple', 'four', '--status', 'proven', '--note', 'check passed')),
  ];
  for (const answer of seed) assert.equal(answer.isError, false, answer.content[0].text);
  const folder = join(root, '.sz/evidence/triple');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'unreferenced.png'), 'old');
  const original = process.env.PATH;
  const codex = spawnSync('which', ['codex'], { encoding: 'utf8' }).stdout.trim();
  const commands = [
    record('evidence', 'triple'), record('contract', 'close', 'triple'), record('evidence', 'prune', 'triple'),
    shell('git add .sz check.sh && git -c user.email=test@localhost -c user.name=Test commit -qm closed'),
  ].map((params, id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params })).join('\n') + '\n';
  // Only the model is scripted. Both the bridge's tools and the runner's post-close checks use real codex sandbox.
  writeFileSync(join(bin, 'codex'), `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'sandbox') process.exit(spawnSync(${JSON.stringify(codex)}, args, { stdio: 'inherit' }).status ?? 1);
if (args[0] !== 'exec') process.exit(2);
fs.readFileSync(0);
const config = args.find((arg) => arg.startsWith('mcp_servers.sz.args='));
const bridge = JSON.parse(config.slice('mcp_servers.sz.args='.length));
const ran = spawnSync(process.execPath, bridge, { input: ${JSON.stringify(commands)}, encoding: 'utf8' });
if (ran.status !== 0) throw Error(ran.stderr);
for (const line of ran.stdout.trim().split('\\n')) {
  const { result } = JSON.parse(line);
  if (result.isError) throw Error(result.content[0].text);
}
fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ closed: true }));
`);
  chmodSync(join(bin, 'codex'), 0o755);
  process.env.PATH = bin + ':' + original;
  try {
    const { codexWorker } = await import(new URL('../../../plugin/codex/run.mjs', import.meta.url).href);
    const worker = codexWorker({ root, model: 'scripted', z: createRequire(import.meta.url)('zod'),
      log: () => {}, active: new Set(), holdProject: () => token, interrupted: () => false });
    const result = await worker(null, 'triple', 'close the milestone', { label: 'close:triple',
      schema: { type: 'object', properties: { closed: { type: 'boolean' } }, required: ['closed'] } });
    assert.equal(result.report, join(folder, 'report.html'));
  } finally {
    process.env.PATH = original;
  }
  assert.ok(JSON.parse(git('show', 'HEAD:.sz/contracts/triple.json').stdout).closedAt);
  assert.match(git('show', 'HEAD:.sz/evidence/triple/report.html').stdout, /Four triples to twelve/);
  assert.equal(existsSync(join(folder, 'unreferenced.png')), false);
});

test('researchers have no ledger role and only the review can file a backlog finding', async () => {
  const { authorizeRecord } = await import(bridge);
  const line = ['backlog', 'add', '요금이 다릅니다', '--from', 'red team: plan'];
  assert.doesNotThrow(() => authorizeRecord('redteam', 'triple', 'redteam:plan', line));
  for (const args of [['backlog', 'done', 'line', '--by', 'x'], ['contract', 'claim', 'triple', 'one', '--status', 'proven'], ['standing', 'record', 'triple/one'], [...line, '--dir', '/tmp']])
    assert.throws(() => authorizeRecord('redteam', 'triple', 'redteam:plan', args));
  assert.throws(() => authorizeRecord('facts', 'triple', 'facts', line));
});

test('whoever rules may give back a verdict that was not the claim\'s, and records no other verdict', async () => {
  // (2026-11-26: a ruling that a claim was shown false only by a case the running product does not come to has to
  // be written into the contract by whoever ruled, or its close is refused with "still owes".)
  const { authorizeRecord } = await import(bridge);
  const proven = ['contract', 'claim', 'triple', 'one', '--status', 'proven', '--note', '제 검사는 통과했고, 그 경우는 눈에 띈 것에 적었다'];
  assert.doesNotThrow(() => authorizeRecord('arbiter', 'triple', 'rule:triple', ['contract', 'notice', 'triple', 'VAD를 150배 늦춘 엔진에서만 나온다']));
  const shownFalse = () => 'refuted';
  assert.doesNotThrow(() => authorizeRecord('arbiter', 'triple', 'rule:triple:last', proven, shownFalse));
  assert.doesNotThrow(() => authorizeRecord('arbiter', 'triple', 'arbiter:triple', ['contract', 'notice', 'triple', '검사 셋이 같은 도우미를 쓴다']));
  // Only a claim that was looked at and found false is given back, and only by the ruling after a look: the
  // arbiter of a builder's disputes, who comes before any look, records no verdict.
  for (const status of ['unproven', 'unchecked', 'disputed', 'proven', undefined]) assert.throws(() => authorizeRecord('arbiter', 'triple', 'rule:triple', proven, () => status), String(status));
  assert.throws(() => authorizeRecord('arbiter', 'triple', 'arbiter:triple', proven, shownFalse));
  assert.throws(() => authorizeRecord('arbiter', 'triple', 'rule:triple', proven), 'with no way to read the claim, nothing is given back');
  // The CLI takes the last of a flag given twice: one that is given twice is refused.
  for (const more of [['--status', 'refuted'], ['--status', 'proven'], ['--note', ''], ['--note', 'x']])
    assert.throws(() => authorizeRecord('arbiter', 'triple', 'rule:triple', [...proven, ...more], shownFalse), more.join(' '));
  for (const args of [
    ['contract', 'claim', 'triple', 'one', '--status', 'refuted', '--note', 'x'],
    ['contract', 'claim', 'triple', 'one', '--status', 'unchecked', '--note', 'x'],
    ['contract', 'claim', 'triple', 'one', '--status', 'proven'],
    ['contract', 'claim', 'triple', 'one', '--status', 'proven', '--note', ' '],
    ['contract', 'claim', 'other', 'one', '--status', 'proven', '--note', 'x'],
    ['contract', 'close', 'triple'],
    [...proven, '--accepted', '닫아'],
  ])
    assert.throws(() => authorizeRecord('arbiter', 'triple', 'rule:triple', args, shownFalse), JSON.stringify(args));
  // A builder still records no verdict at all.
  assert.throws(() => authorizeRecord('build', 'triple', 'build:triple', proven));
});

test('a Codex reviewer writes only by filing a backlog line through record', {
  skip: !process.env.SZ_TEST_CODEX_SANDBOX && 'set SZ_TEST_CODEX_SANDBOX=1 in a terminal that can create a Codex sandbox',
}, (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sz-review-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  const token = startBuildRun(root, 'review');
  const [added, direct, add, done, product, git] = callsOfRun(token, root, 'redteam',
    record('backlog', 'add', '요금이 다릅니다', '--from', 'red team: triple'),
    shell('echo changed >> .sz/backlog.md'), shell('sz-eyes backlog add changed'),
    record('backlog', 'done', '요금', '--by', 'x'), shell('echo changed > app.mjs'), shell('git add .sz/backlog.md'));
  assert.equal(added.isError, false, added.content[0].text);
  for (const denied of [direct, add, done, product, git]) assert.equal(denied.isError, true, denied.content[0].text);
  const page = readFileSync(join(root, '.sz/backlog.md'), 'utf8');
  assert.match(page, /- \[ \] 요금이 다릅니다 \(red team: triple\)/);
  assert.doesNotMatch(page, /changed/);
});

test('the red team runs the milestone in a disposable copy and ends it without changing either worktree', {
  skip: !process.env.SZ_TEST_CODEX_SANDBOX && 'set SZ_TEST_CODEX_SANDBOX=1 in a terminal that can create a Codex sandbox',
}, (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sz-review-copy-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (cwd: string, ...args: string[]) => {
    const ran = spawnSync('git', ['-c', 'user.email=test@localhost', '-c', 'user.name=Test', ...args], { cwd, encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
    return ran.stdout.trim();
  };
  git(root, 'init', '-q');
  const app = "import { readFileSync, writeFileSync } from 'node:fs';\nwriteFileSync('saved.txt', readFileSync('version.txt'));\n";
  writeFileSync(join(root, 'app.mjs'), app);
  writeFileSync(join(root, 'version.txt'), 'main\n');
  writeFileSync(join(root, '.gitignore'), 'dist/\n');
  git(root, 'add', 'app.mjs', 'version.txt', '.gitignore');
  git(root, 'commit', '-qm', 'main product');
  const side = join(root, '.sz/trees/triple');
  git(root, 'worktree', 'add', '-qb', 'sz/triple', side);
  writeFileSync(join(side, 'version.txt'), 'milestone\n');
  git(side, 'commit', '-qam', 'milestone product');
  mkdirSync(join(side, 'dist'));
  cpSync(join(side, 'app.mjs'), join(side, 'dist/app.mjs'));
  const token = startBuildRun(root, 'review the milestone');

  const [home, copy, trial, end] = callsOfRun(token, side, 'redteam',
    shell('test -d "$HOME" && test "${HOME%/*}" = "$TMPDIR"'),
    shell('sz-eyes copy "$TMPDIR/review" --with dist'),
    shell('cd "$TMPDIR/review" && node dist/app.mjs && cat saved.txt'),
    shell('sz-eyes copy "$TMPDIR/review" --end && test ! -e "$TMPDIR/review"'));
  for (const result of [home, copy, trial, end]) assert.equal(result.isError, false, result.content[0].text);
  assert.equal(trial.content[0].text.trim(), 'milestone');
  assert.match(end.content[0].text, /ended: /);
  assert.equal(git(side, 'status', '--porcelain'), '');
  assert.equal(readFileSync(join(side, 'dist/app.mjs'), 'utf8'), app);
  assert.equal(readFileSync(join(root, 'version.txt'), 'utf8'), 'main\n');
  for (const source of [side, root]) assert.equal(existsSync(join(source, 'saved.txt')), false);
});

test('the fact reader can write only its page in the project', {
  skip: !process.env.SZ_TEST_CODEX_SANDBOX && 'set SZ_TEST_CODEX_SANDBOX=1 in a terminal that can create a Codex sandbox',
}, (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sz-research-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  const [page, none, product, ledger, git, claim] = calls(root, 'facts',
    shell('echo rule > .sz/facts.md'), shell('echo 2026-11-26 nothing published > .sz/facts.none'),
    shell('echo wrong > app.mjs'), shell('echo wrong > .sz/backlog.md'),
    shell('git add .sz/facts.md'), record('contract', 'claim', 'triple'));
  assert.equal(page.isError, false, page.content[0].text);
  assert.equal(readFileSync(join(root, '.sz/facts.md'), 'utf8'), 'rule\n');
  assert.equal(none.isError, false, none.content[0].text);
  assert.equal(readFileSync(join(root, '.sz/facts.none'), 'utf8'), '2026-11-26 nothing published\n');
  for (const denied of [product, ledger, git, claim]) assert.equal(denied.isError, true, denied.content[0].text);
});

test('a worker reads the dives kept outside any product, and not what the owner typed while digging', {
  skip: !process.env.SZ_TEST_CODEX_SANDBOX && 'set SZ_TEST_CODEX_SANDBOX=1 in a terminal that can create a Codex sandbox',
}, (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sz-dives-test-')));
  const dives = join(root, 'dives');
  const before = process.env.SZ_DIVES_DIR;
  t.after(() => {
    if (before === undefined) delete process.env.SZ_DIVES_DIR;
    else process.env.SZ_DIVES_DIR = before;
    rmSync(root, { recursive: true, force: true });
  });
  const project = join(root, 'product');
  mkdirSync(project);
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: project }).status, 0);
  mkdirSync(join(dives, '2026-11-24-settle'), { recursive: true });
  writeFileSync(join(dives, '2026-11-24-settle/dive.json'), JSON.stringify({ id: 'settle', createdAt: '2026-11-24T00:00:00.000Z', kind: 'plain', seed: '모임 정산이 귀찮아', lines: {}, closed: null }));
  writeFileSync(join(dives, '2026-11-24-settle/brief.md'), '# 밖에서 쓴 브리프\n');
  mkdirSync(join(dives, '.heard'));
  writeFileSync(join(dives, '.heard/s.jsonl'), '{"prompt":"주인이 친 말"}\n');
  process.env.SZ_DIVES_DIR = dives;
  // The review runs with a HOME of its own: the dives are still read from where they are kept.
  for (const role of ['plan', 'redteam']) {
    const [shown, brief, heard] = calls(project, role, shell('sz-eyes dive show'), shell('sz-eyes dive brief settle'), shell(`cat ${join(dives, '.heard/s.jsonl')}`));
    assert.equal(shown.isError, false, shown.content[0].text);
    assert.match(shown.content[0].text, /kept outside any product[\s\S]*settle: .*"모임 정산이 귀찮아"/);
    assert.equal(brief.isError, false, brief.content[0].text);
    assert.match(brief.content[0].text, /# 밖에서 쓴 브리프/);
    assert.equal(heard.isError, true, heard.content[0].text);
  }
});

const electron = (...args: string[]): ToolCall => ({ name: 'electron', arguments: { args } });

test('VM evidence cannot traverse a linked contract directory', { skip: process.platform !== 'darwin' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sz-evidence-link-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const product = join(root, 'source');
  const pictures = join(root, 'pictures');
  mkdirSync(product);
  mkdirSync(pictures);
  writeFileSync(join(pictures, 'look.png'), 'fixture');
  mkdirSync(join(root, '.sz/evidence'), { recursive: true });
  symlinkSync(product, join(root, '.sz/evidence/triple'));
  const publish = fileURLToPath(new URL('../../../plugin/codex/electron-publish.py', import.meta.url));
  const result = spawnSync('/usr/bin/python3', [publish, 'triple', pictures], { cwd: root });
  assert.notEqual(result.status, 0);
  assert.deepEqual(readdirSync(product), []);
});

test('the GUI tool rejects other roles and host path arguments before accessing a VM', () => {
  for (const [role, args] of [
    ['close', ['look', '.']],
    ['verifier', ['node', '/tmp/host-script.js']],
    ['start', ['node', '../another-project/index.js']],
    ['build', ['node', '--eval']],
  ] as const) {
    const [answer] = calls(process.cwd(), role, electron(...args));
    assert.equal(answer.isError, true);
    assert.match(answer.content[0].text, /unknown tool|project-relative/);
  }
});

test('local Mac VM opens Electron for start and runs a verifier flow with read-only source and checks', {
  skip: !process.env.SZ_TEST_ELECTRON_DIST && 'set SZ_TEST_ELECTRON_DIST to a Darwin arm64 Electron dist directory',
}, (t) => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'sz-electron-proof-')));
  if (!process.env.SZ_KEEP_ELECTRON_PROOF) t.after(() => rmSync(project, { recursive: true, force: true }));
  const exe = './dist/Electron.app/Contents/MacOS/Electron';
  cpSync(process.env.SZ_TEST_ELECTRON_DIST!, join(project, 'dist'), { recursive: true, verbatimSymlinks: true });
  writeFileSync(join(project, 'package.json'), '{"main":"main.cjs"}');
  writeFileSync(join(project, '.env'), 'LOCAL_ONLY=fixture');
  const frozen = 'Object.freeze({ claim: "window" });\n';
  writeFileSync(join(project, 'check.cjs'), frozen);
  writeFileSync(join(project, 'writes.cjs'), `
    const { appendFileSync } = require('node:fs');
    if (require('node:fs').existsSync(require('node:path').join(__dirname, '.env'))) throw Error('local environment file shared');
    module.exports = () => ['main.cjs','check.cjs'].map(name => {
      try { appendFileSync(require('node:path').join(__dirname,name),'unexpected write'); }
      catch (err) { if (['EROFS','EPERM','EACCES'].includes(err.code)) return err.code; throw err; }
      throw Error('write succeeded: '+name);
    }).join('/');
  `);
  writeFileSync(join(project, 'child.cjs'), "process.parentPort.postMessage(require('./writes.cjs')())");
  const main = `
    const { app, BrowserWindow, utilityProcess } = require('electron');
    const { writeFileSync } = require('node:fs');
    app.whenReady().then(async () => {
      const main = require('./writes.cjs')();
      const child = utilityProcess.fork(require.resolve('./child.cjs'));
      const denied = await new Promise((ok,fail) => { child.once('message',ok); child.once('exit',()=>fail(Error('child exited'))); });
      child.kill();
      const win = new BrowserWindow({width:800, height:500});
      const title = 'Window verified - main '+main+' - child '+denied;
      await win.loadURL('data:text/html,'+encodeURIComponent('<title>'+title+'</title><h1>Window verified</h1><p>'+title+'</p>'));
      console.log(title);
      if (process.env.SZ_FLOW) {
        const image = await win.webContents.capturePage();
        writeFileSync('/tmp/sz-evidence/flow.png', image.toPNG());
        app.quit();
      }
    }).catch(err => { console.error(err); app.exit(1); });
  `;
  writeFileSync(join(project, 'main.cjs'), main);
  writeFileSync(join(project, 'flow.cjs'), `
    const { spawnSync } = require('node:child_process');
    const r = spawnSync(${JSON.stringify(exe)}, ['.'], { stdio:'inherit', env:{...process.env,SZ_FLOW:'1'} });
    process.exit(r.status ?? 1);
  `);
  const setup = calls(project, 'build',
    record('contract', 'new', 'triple', '--request', 'Show a real window', '--claim', 'window|Window opens|test:check.cjs'),
    record('contract', 'freeze', 'triple', '--frozen', 'check.cjs'));
  for (const result of setup) assert.equal(result.isError, false, result.content[0].text);
  for (const [role, tool] of [
    ['start', electron('look', '.', '--electron', exe, '--window', 'Window verified')],
    ['verifier', electron('node', 'flow.cjs')],
  ] as const) {
    const [answer] = calls(project, role, tool);
    assert.equal(answer.isError, false, answer.content[0].text);
    assert.match(answer.content[0].text, /Window verified - main (?:EROFS|EPERM|EACCES)\/(?:EROFS|EPERM|EACCES) - child (?:EROFS|EPERM|EACCES)\/(?:EROFS|EPERM|EACCES)/);
    const path = answer.content[1].text.trim();
    assert.match(path, /^\.sz\/evidence\/triple\/electron-[a-f0-9]+\/[\w-]+\.png$/);
    const png = readFileSync(join(project, path));
    assert.ok(png.length > 1000);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(readFileSync(join(project, 'main.cjs'), 'utf8'), main);
    assert.equal(readFileSync(join(project, 'check.cjs'), 'utf8'), frozen);
    t.diagnostic(role + ' ' + join(project, path));
  }
});

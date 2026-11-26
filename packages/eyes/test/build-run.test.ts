import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildRunFile, endBuildRun, readBuildRun, startBuildRun, stopBuildRun } from '../src/build-run.ts';

// 2026-11-23, the owner's Codex build of yt_support: the runner stopped at 76 minutes on one file a fixer left
// uncommitted, and the session finished the build by hand, with agents that carried its conversation. These are
// the three things that would have kept it on the runner.

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const build = fileURLToPath(new URL('../../../plugin/bin/sz-codex-build', import.meta.url));
const runModule = new URL('../../../plugin/codex/run.mjs', import.meta.url).href;
const z = createRequire(fileURLToPath(new URL('../package.json', import.meta.url)))('zod');

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

function project(t: TestContext): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sz-build-run-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'app.mjs'), 'console.log(8)\n');
  git(root, 'init', '-q');
  git(root, 'add', 'app.mjs');
  git(root, 'commit', '-qm', 'initial');
  return root;
}

const eyes = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) => {
  const clean = { ...process.env };
  delete clean.SZ_BUILD_TOKEN;
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', env: { ...clean, ...env } });
};
const claim = ['contract', 'claim', 'triple', 'four', '--status', 'proven', '--note', 'printed twelve'];

test('while a build run works, the ledger takes its contracts only from its workers', (t) => {
  const root = project(t);
  const token = startBuildRun(root, 'finish the editor');
  assert.match(buildRunFile(root), /\.git\/sz-build-run\.json$/);
  assert.equal(git(root, 'status', '--porcelain'), '', 'the record is not something a commit can take');

  const outside = eyes(root, claim);
  assert.notEqual(outside.status, 0);
  assert.match(outside.stderr, /not recorded: a build run \(sz-codex-build, pid \d+/);
  assert.match(outside.stderr, /only its own workers record its contracts/);
  for (const args of [['contract', 'close', 'triple'], ['evidence', 'triple'], ['standing', 'record', 'triple/four', '--status', 'holds', '--note', 'looked again']])
    assert.match(eyes(root, args).stderr, /not recorded: a build run/, args.join(' '));

  // Its workers pass the hold (and then meet the ledger as it is: here, no such contract).
  const inside = eyes(root, claim, { SZ_BUILD_TOKEN: token });
  assert.doesNotMatch(inside.stderr, /not recorded/);
  assert.match(eyes(root, claim, { SZ_BUILD_TOKEN: 'a token read from somewhere' }).stderr, /not recorded/);

  // Reading is anyone's, and so is the owner's own verdict on a drawing.
  for (const args of [['contract', 'show', 'triple'], ['contract', 'judged', 'design', 'feel', '--verdict', 'yes', '--said', '좋아요']])
    assert.doesNotMatch(eyes(root, args).stderr, /not recorded/, args.join(' '));

  endBuildRun(root);
  assert.equal(existsSync(buildRunFile(root)), false);
  assert.doesNotMatch(eyes(root, claim).stderr, /not recorded/);
});

test('a run that stopped holds the ledger until it runs again, and says how', (t) => {
  const root = project(t);
  startBuildRun(root, 'finish the editor');
  stopBuildRun(root, 'fix:d3-editor:1: product changes still need a commit: e2e/helper.ts');
  const after = eyes(root, claim);
  assert.notEqual(after.status, 0);
  assert.match(after.stderr, /stopped: fix:d3-editor:1: product changes still need a commit/);
  assert.match(after.stderr, /Run sz-codex-build again from this project with the same JSON: it resumes from \.sz/);
  assert.match(after.stderr, /Do not carry the build on by hand or with agents you start/);

  // A new run replaces the record of the stopped one: it is the one that resumes.
  const again = startBuildRun(root, 'finish the editor');
  assert.equal(readBuildRun(root)?.stoppedAt, undefined);
  assert.doesNotMatch(eyes(root, claim, { SZ_BUILD_TOKEN: again }).stderr, /not recorded/);
});

test('a stopped run does not hold back the owner\'s word to close its contract as it is; a working one does', (t) => {
  // The words are the owner's, as a verdict on the drawing is: nobody else's record passes a run's hold.
  const root = project(t);
  for (const args of [
    ['contract', 'new', 'triple', '--request', 'triple four', '--claim', 'twelve|It prints twelve|command:node app.mjs', '--claim', 'fast|It answers at once|command:true'],
    ['contract', 'freeze', 'triple'],
    ['contract', 'claim', 'triple', 'twelve', '--status', 'refuted', '--note', 'it prints 8'],
    ['contract', 'claim', 'triple', 'fast', '--status', 'proven', '--note', 'ran it'],
    ['contract', 'new', 'fine', '--request', 'one more', '--claim', 'runs|It runs|command:true'],
    ['contract', 'freeze', 'fine'],
    ['contract', 'claim', 'fine', 'runs', '--status', 'proven', '--note', 'ran it'],
  ]) assert.equal(eyes(root, args).status, 0, args.join(' '));
  const close = ['contract', 'close', 'triple', '--accepted', '8이어도 이대로 닫아요'];

  startBuildRun(root, 'triple four');
  assert.match(eyes(root, close).stderr, /not recorded: a build run \(sz-codex-build, pid \d+/, 'while the run works, it waits like everything else');
  stopBuildRun(root, 'milestone "triple" still has 1 claim(s) shown false');
  assert.match(eyes(root, ['contract', 'close', 'triple']).stderr, /not recorded: the build run/, 'without their words it is anyone\'s close');
  assert.match(eyes(root, ['contract', 'close', 'triple', '--accepted', ' ']).stderr, /not recorded: the build run/);
  // A close that needs no word of theirs is anyone's close with a flag added: the hold keeps it.
  assert.match(eyes(root, ['contract', 'close', 'fine', '--accepted', '닫아요']).stderr, /not recorded: the build run/);
  const closed = eyes(root, close);
  assert.equal(closed.status, 0, closed.stderr);
  assert.match(closed.stdout, /^closed: triple/);
});

test('only a completed workflow releases the run; a stopped one can be read and the owner can judge it', async (t) => {
  const { closeRun } = await import(runModule);
  const runs = await import('../src/build-run.ts');
  const root = project(t);
  for (const args of [
    ['contract', 'new', 'triple', '--request', 'triple four', '--claim', 'feel|It feels right|owner:the product'],
    ['contract', 'freeze', 'triple'],
  ]) assert.equal(eyes(root, args).status, 0);

  for (const result of [{ error: 'no plan came back' }, { stopped: 'waiting at the drawing' }]) {
    const token = startBuildRun(root, 'triple four');
    closeRun(runs, root, null, {});
    assert.ok(readBuildRun(root));
    closeRun(runs, root, token, result);
    const run = readBuildRun(root);
    assert.ok(run?.stoppedAt);
    assert.equal(run.stopped, result.error || result.stopped);
    assert.match(eyes(root, claim, { SZ_BUILD_TOKEN: token }).stderr, /not recorded: the build run/);
    assert.match(eyes(root, claim).stderr, /not recorded: the build run/);
    assert.match(eyes(root, ['contract', 'status']).stdout, /contract triple .*still owes/);
    assert.equal(eyes(root, ['contract', 'show', 'triple']).status, 0);
  }
  const judged = eyes(root, ['contract', 'judged', 'triple', 'feel', '--verdict', 'yes', '--said', '이대로 지어요']);
  assert.equal(judged.status, 0, judged.stderr);
  closeRun(runs, root, startBuildRun(root, 'triple four'), { milestones: ['triple'] });
  assert.equal(readBuildRun(root), null);
});

test('a run that died without a word holds the ledger too; a second run is refused while the first lives', (t) => {
  const root = project(t);
  const dead = spawnSync(process.execPath, ['-e', '0']).pid!;
  startBuildRun(root, 'finish the editor', dead);
  assert.match(eyes(root, claim).stderr, /ended without saying why\. .*Run sz-codex-build again/s);

  startBuildRun(root, 'finish the editor');
  assert.throws(() => startBuildRun(root, 'something else', process.pid + 1), /another build run \(pid \d+/);
});

test('a run started before git exists still holds its ledger after the first commit and in linked worktrees', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sz-build-first-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const token = startBuildRun(root, 'make an editor');
  const original = buildRunFile(root);
  git(root, 'init', '-q');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'the first commit');
  assert.doesNotMatch(git(root, 'ls-files'), /sz-build-run\.json/);
  git(root, 'worktree', 'add', '-q', '.sz/trees/side', '-b', 'sz/side');
  const side = join(root, '.sz/trees/side');
  assert.equal(buildRunFile(side), original);
  assert.match(eyes(side, claim).stderr, /not recorded: a build run/);
  assert.doesNotMatch(eyes(side, claim, { SZ_BUILD_TOKEN: token }).stderr, /not recorded/);
  stopBuildRun(root, 'wait for the drawing');
  assert.equal(readBuildRun(side)?.stopped, 'wait for the drawing');
  endBuildRun(root);
  assert.equal(readBuildRun(side), null);
});

test('a milestone folder under .sz/trees finds the same record as the project', (t) => {
  const root = project(t);
  mkdirSync(join(root, '.sz/trees'), { recursive: true });
  git(root, 'worktree', 'add', '-q', '.sz/trees/side', '-b', 'sz/side');
  const token = startBuildRun(root, 'two at once');
  const side = join(root, '.sz/trees/side');
  assert.equal(buildRunFile(side), buildRunFile(root));
  assert.match(eyes(side, claim).stderr, /not recorded: a build run/);
  assert.doesNotMatch(eyes(side, claim, { SZ_BUILD_TOKEN: token }).stderr, /not recorded/);
});

/** A `codex` on PATH that plays the model: one worker makes a helper file and does not commit it. */
function fakeCodex(t: TestContext): { dir: string; log: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sz-fake-codex-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'calls.jsonl');
  writeFileSync(
    join(dir, 'codex'),
    `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const a = process.argv.slice(2);
if (a[0] === 'sandbox') {
  const i = a.indexOf('--');
  process.exit(spawnSync(a[i + 1], a.slice(i + 2), { stdio: 'inherit' }).status ?? 1);
}
if (a[0] !== 'exec') process.exit(2);
if (process.env.FAKE_MODE === 'fail') { process.stderr.write('the model is not reachable'); process.exit(1); }
const out = a[a.indexOf('--output-last-message') + 1];
const mcp = a.find((x) => x.startsWith('mcp_servers.sz.args='));
const [, cwd, role, contract, label, token] = JSON.parse(mcp.slice('mcp_servers.sz.args='.length));
const prompt = fs.readFileSync(0, 'utf8');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ label, role, token, prompt, held: fs.existsSync(path.join(cwd, '.git', 'sz-build-run.json')) }) + '\\n');
const git = (...args) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', ...args], { cwd });
const script = path.join(__dirname, 'steps.json');
if (fs.existsSync(script) && !label.endsWith(':left')) {
  const steps = JSON.parse(fs.readFileSync(script, 'utf8'));
  const attempt = fs.readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').length - 1;
  const step = steps[attempt];
  if (!step) throw Error('unexpected worker invocation ' + attempt);
  if (step.contract) {
    const folder = path.join(cwd, '.sz/contracts');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, contract + '.json'), JSON.stringify(step.contract));
  }
  if (step.left) fs.writeFileSync(path.join(cwd, 'helper.txt'), 'part of the build');
  fs.writeFileSync(out, JSON.stringify(step.result));
} else if (/left these files/.test(prompt)) {
  if (process.env.FAKE_MODE !== 'keeps-leaving') { git('add', 'helper.txt'); git('commit', '-qm', 'a helper the fix used'); }
  fs.writeFileSync(out, JSON.stringify({ committed: ['helper.txt'], removed: [] }));
} else {
  fs.writeFileSync(path.join(cwd, 'helper.txt'), 'made by the fixer\\n');
  fs.writeFileSync(out, JSON.stringify({ ok: true }));
}
`,
  );
  chmodSync(join(dir, 'codex'), 0o755);
  return { dir, log };
}

async function fakeWorker(root: string, dir: string, mode: string, contract: string | null = 'triple',
  options: Record<string, unknown> = { label: 'fix:triple:1', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } }) {
  const { codexWorker } = await import(runModule);
  const lines: string[] = [];
  let token: string | null = null;
  const worker = codexWorker({
    root,
    model: 'a-model',
    z,
    log: (line: string) => lines.push(line),
    active: new Set(),
    holdProject: () => (token ??= startBuildRun(root, 'finish the editor')),
    interrupted: () => false,
  });
  const path = process.env.PATH;
  process.env.PATH = `${dir}:${path}`;
  process.env.FAKE_MODE = mode;
  try {
    return { lines, result: await worker(null, contract, 'finish your assignment', options) };
  } finally {
    process.env.PATH = path;
    delete process.env.FAKE_MODE;
  }
}

test('a worker that leaves a file uncommitted is handed it back once, and the build goes on', async (t) => {
  const root = project(t);
  const { dir, log } = fakeCodex(t);
  const { lines, result } = await fakeWorker(root, dir, 'commits-when-asked');
  assert.deepEqual(result, { ok: true });
  // Cleanup has its own message so the hand-back count measures unfinished contract work only.
  assert.match(lines.join('\n'), /\[fix:triple:1\] left helper\.txt uncommitted: requesting one cleanup/);
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.match(git(root, 'log', '-1', '--format=%s'), /a helper the fix used/);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(calls.map((c) => [c.label, c.role]), [['fix:triple:1', 'fix'], ['fix:triple:1:left', 'fix']]);
  // Each worker was given the run's token, and the run held the project while they worked.
  assert.ok(calls.every((c) => typeof c.token === 'string' && c.token.length === 48 && c.token === calls[0].token && c.held));
});

test('a file still left after it was handed back stops the build, by name', async (t) => {
  const root = project(t);
  const { dir, log } = fakeCodex(t);
  await assert.rejects(fakeWorker(root, dir, 'keeps-leaving'), /fix:triple:1: product changes still need a commit after cleanup: helper\.txt/);
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2, 'handed back once, not again and again');
});

type Step = { result: Record<string, unknown>; contract?: object; left?: boolean };
async function scripted(t: TestContext, options: Record<string, unknown>, steps: Step[]) {
  const root = project(t);
  const { dir, log } = fakeCodex(t);
  writeFileSync(join(dir, 'steps.json'), JSON.stringify(steps));
  const { result } = await fakeWorker(root, dir, 'scripted', options.contractId ? null : 'triple', { schema: { type: 'object' }, ...options });
  const calls = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  return { result, calls };
}

function ledger(claims: Record<string, string>, notes: Record<string, string> = {}) {
  return {
    frozenAt: 'today',
    claims: Object.entries(claims).map(([id, status]) => ({
      id, status, note: notes[id] || '', says: 'shows ' + id, shownBy: { kind: id === 'feel' ? 'owner' : 'test', ref: id },
    })),
  };
}

const verifier = { label: 'verify:triple', agentType: 'sz:verifier' };
const verdict = (proven: string[]) => ({ proven, unchecked: [], refuted: [] });

test('a verifier gets only its outstanding share back, with earlier verdicts retained and newer ones taking precedence', async (t) => {
  const { result, calls } = await scripted(t, { ...verifier, claims: ['one', 'two', 'three', 'feel'] }, [
    { contract: ledger({ one: 'unproven', two: 'proven', three: 'proven', four: 'unproven', feel: 'unproven' }), result: { ...verdict(['two', 'three']), held: ['past/n'], noticed: ['before'] } },
    { contract: ledger({ one: 'proven', two: 'proven', three: 'refuted', four: 'unproven', feel: 'unproven' }, { three: 'the recorded case failed' }), result: { ...verdict(['one', 'three']), broken: [{ key: 'past/n', fact: 'new case' }], noticed: ['after'] } },
  ]);
  assert.equal(calls.length, 2);
  assert.match(calls[1].prompt, /one: no verdict yet/);
  assert.doesNotMatch(calls[1].prompt, /(?:four|feel): no verdict yet/);
  // After a hand-back, use contract order and the recorded observation wherever the model disagrees.
  assert.deepEqual(result, { proven: ['one', 'two'], unchecked: [], refuted: [{ id: 'three', fact: 'the recorded case failed' }], held: [], broken: [{ key: 'past/n', fact: 'new case' }], noticed: ['before', 'after'] });
});

test('an unchanged debt is said once; a debt that changes gets at most two hand-backs', async (t) => {
  const unchanged = { contract: ledger({ one: 'unproven' }), result: verdict(['one']) };
  const same = await scripted(t, verifier, [unchanged, unchanged]);
  assert.equal(same.calls.length, 2);
  assert.deepEqual(same.result.proven, []);
  assert.deepEqual(same.result.unchecked, [{ id: 'one', why: 'no verdict was recorded' }]);
  const three = await scripted(t, verifier, [
    { contract: ledger({ one: 'unproven', two: 'unproven', three: 'unproven' }), result: verdict([]) },
    { contract: ledger({ one: 'proven', two: 'unproven', three: 'unproven' }), result: verdict(['one']) },
    { contract: ledger({ one: 'proven', two: 'proven', three: 'unproven' }), result: verdict(['two', 'three']) },
  ]);
  assert.equal(three.calls.length, 3);
  assert.deepEqual(three.result.proven, ['one', 'two']);
  assert.deepEqual(three.result.unchecked, [{ id: 'three', why: 'no verdict was recorded' }]);
  assert.match(three.calls[2].prompt, /two: no verdict yet/);
  assert.doesNotMatch(three.calls[2].prompt, /one: no verdict yet/);
});

test('a sweep creates its missing contract; a stopped observation or a missing input is returned immediately', async (t) => {
  const sweep = { label: 'sweep:design', contractId: 'design' };
  const swept = { screens: 1, hold: 1, findings: [] };
  const made = await scripted(t, sweep, [
    { result: swept }, { contract: ledger({ screens: 'proven', feel: 'unproven' }), result: swept },
  ]);
  assert.equal(made.calls.length, 2);
  assert.match(made.calls[1].prompt, /the design contract `design` was not recorded/);
  for (const [options, result] of [
    [sweep, { ...swept, sandbox: 'cannot start browser' }],
    [{ label: 'build:triple' }, { blocked: 'requires a device' }],
    [{ label: 'build:triple' }, { notReal: [{ what: 'live tariff', needs: 'a key' }] }],
  ] as const) {
    const stopped = await scripted(t, options, [{ result }]);
    assert.equal(stopped.calls.length, 1);
    assert.deepEqual(stopped.result, result);
  }
});

test('the builder records that the product runs and its cleanup worker only commits the files left behind', async (t) => {
  const result = { contractId: 'triple', launch: 'node app.mjs' };
  const worked = await scripted(t, { label: 'build:triple' }, [
    { contract: ledger({ one: 'unproven' }), result },
    { contract: { ...ledger({ one: 'unproven' }), built: { launch: 'node app.mjs' } }, result, left: true },
  ]);
  assert.deepEqual(worked.calls.map((call) => call.label), ['build:triple', 'build:triple', 'build:triple:left']);
  assert.match(worked.calls[1].prompt, /sz-eyes contract built triple/);
  assert.deepEqual(worked.result, result);
});

test('a build that stops on an error keeps its record, and the runner says to run it again', (t) => {
  const root = project(t);
  const { dir } = fakeCodex(t);
  const r = spawnSync(build, {
    cwd: root,
    input: JSON.stringify({ request: 'finish the editor', asked: 'away' }),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_MODE: 'fail' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /the model is not reachable/);
  assert.match(r.stderr, /run sz-codex-build again from this project with the same JSON, and it resumes from \.sz/);
  const run = readBuildRun(root);
  assert.ok(run?.stoppedAt, 'the record says the run stopped');
  assert.match(run!.stopped!, /the model is not reachable/);
  assert.match(eyes(root, claim).stderr, /not recorded: the build run started .* stopped: /);
});

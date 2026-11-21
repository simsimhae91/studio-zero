// The holder of a simulator's driver, from start to letting go, with a stand-in for Maestro: a command that
// starts a driver on the port it is given, runs the holding flow's one step as Maestro does, and prints the
// hierarchy from that driver. No simulator and no Maestro are needed here; both were used for real on 2026-11-21
// (two simulators at once, ten looks and three flows each: 41 seconds held, 264 with a driver started every time).
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { treeOfDriver } from '../src/ios-driver.ts';
import { driverAnswers, heldDir, heldNow, heldTree, holdDriver, releaseHeld } from '../src/ios-hold.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ios-driver');
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** A `maestro` that behaves as far as the holder can tell: `test` holds, `hierarchy` prints what Maestro printed for the same screen. */
const STAND_IN = `#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--driver-host-port') + 1]);
const fixtures = process.env.STAND_IN_FIXTURES;
if (args.includes('hierarchy')) {
  if (process.env.STAND_IN_DISAGREES) { console.log(JSON.stringify({ attributes: { bounds: '[0,0][1,1]' }, children: [] })); process.exit(0); }
  console.log('some words Maestro says first');
  console.log(fs.readFileSync(path.join(fixtures, 'app-on01.maestro.json'), 'utf8'));
  process.exit(0);
}
const flow = args[args.length - 1];
const script = fs.readFileSync(path.join(path.dirname(flow), 'hold.js'), 'utf8');
const door = /http:\\/\\/127\\.0\\.0\\.1:\\d+\\/hold/.exec(script)[0];
const driver = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/deviceInfo') return res.end(JSON.stringify({ widthPixels: 1206, heightPixels: 2622, widthPoints: 402, heightPoints: 874 }));
  if (req.url === '/viewHierarchy') return res.end(fs.readFileSync(path.join(fixtures, 'app-on01.driver.json'), 'utf8'));
  res.statusCode = 404; res.end('{}');
});
driver.listen(port, '127.0.0.1', async () => {
  if (process.env.STAND_IN_DIES_AFTER_MS) setTimeout(() => driver.close(), Number(process.env.STAND_IN_DIES_AFTER_MS));
  for (;;) {
    let body = 'release';
    try { body = await (await fetch(door)).text(); } catch { body = 'release'; }
    if (body === 'release') break;
  }
  driver.close();
  process.exit(0);
});
`;

async function withStandIn(env: Record<string, string>, body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'eyes-hold-'));
  const before = { PATH: process.env.PATH, SZ_HELD_DIR: process.env.SZ_HELD_DIR };
  writeFileSync(join(dir, 'maestro'), STAND_IN);
  chmodSync(join(dir, 'maestro'), 0o755);
  Object.assign(process.env, { PATH: `${dir}:${before.PATH}`, SZ_HELD_DIR: join(dir, 'held'), STAND_IN_FIXTURES: fixtures, ...env });
  try {
    await body(dir);
  } finally {
    process.env.PATH = before.PATH;
    if (before.SZ_HELD_DIR === undefined) delete process.env.SZ_HELD_DIR;
    else process.env.SZ_HELD_DIR = before.SZ_HELD_DIR;
    for (const key of ['STAND_IN_FIXTURES', ...Object.keys(env)]) delete process.env[key];
    rmSync(dir, { recursive: true, force: true });
  }
}

const untilHeld = async (udid: string): Promise<NonNullable<ReturnType<typeof heldNow>>> => {
  for (let i = 0; i < 100; i++) {
    const held = heldNow(udid);
    if (held) return held;
    await pause(100);
  }
  throw new Error('no holder came up');
};

test('a driver is held up, answers the screen as Maestro prints it, and nothing is left when it is let go', async () => {
  await withStandIn({}, async () => {
    const said: string[] = [];
    const holding = holdDriver('SIM-1', { say: (line) => said.push(line), up: () => true });
    const held = await untilHeld('SIM-1');
    assert.deepEqual([held.udid, held.pid, held.size, held.agrees], ['SIM-1', process.pid, { w: 402, h: 874 }, true]);
    assert.ok(await driverAnswers(held));
    assert.deepEqual(await heldTree(held), treeOfDriver(JSON.parse(readFileSync(join(fixtures, 'app-on01.driver.json'), 'utf8')), { w: 402, h: 874 }));
    // A second holder for the same simulator stands back.
    assert.equal(await holdDriver('SIM-1', { say: (line) => said.push(line), up: () => true }), 0);
    assert.ok(said.includes('already held'));
    assert.equal(await releaseHeld('SIM-1', 100), true);
    assert.equal(await holding, 0);
    assert.equal(heldNow('SIM-1'), null);
    assert.equal(existsSync(join(heldDir(), 'SIM-1.json')), false);
    assert.equal(await driverAnswers(held), false, 'the driver went with the flow that held it');
    assert.equal(await releaseHeld('SIM-1'), false, 'nothing to let go');
    assert.deepEqual(said.slice(-1), ['let go']);
  });
});

test('a holder whose reading does not agree with Maestro says so, and the look then asks Maestro itself', async () => {
  await withStandIn({ STAND_IN_DISAGREES: '1' }, async () => {
    const holding = holdDriver('SIM-2', { up: () => true });
    const held = await untilHeld('SIM-2');
    assert.equal(held.agrees, false);
    assert.equal(await heldTree(held), null);
    await releaseHeld('SIM-2', 100);
    assert.equal(await holding, 0);
  });
});

test('a holder ends by itself: when nothing has asked for a while, when its simulator is down, when its driver has gone', async () => {
  await withStandIn({}, async () => {
    const idle = holdDriver('SIM-3', { idleMs: 600, up: () => true });
    await untilHeld('SIM-3');
    assert.equal(await idle, 0);
    assert.equal(heldNow('SIM-3'), null);
  });
  await withStandIn({ STAND_IN_DIES_AFTER_MS: '1500' }, async () => {
    // Its driver stops answering while the flow still waits: the holder notices at its next check.
    const gone = holdDriver('SIM-4', { up: () => true, checkMs: 400 });
    const held = await untilHeld('SIM-4');
    assert.equal(await gone, 0);
    assert.equal(await driverAnswers(held), false);
    assert.equal(heldNow('SIM-4'), null);
  });
  await withStandIn({}, async () => {
    let up = true;
    const down = holdDriver('SIM-5', { up: () => up, checkMs: 300 });
    await untilHeld('SIM-5');
    up = false;
    assert.equal(await down, 0);
    assert.equal(heldNow('SIM-5'), null);
  });
});

test('a record whose holder has gone is cleared away, and a holder that cannot start leaves nothing', async () => {
  await withStandIn({}, async (dir) => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, 'held'), { recursive: true });
    writeFileSync(join(dir, 'held', 'SIM-6.json'), JSON.stringify({ udid: 'SIM-6', pid: 2 ** 22 - 3, port: 1, door: 1, size: { w: 1, h: 1 }, agrees: true, at: '' }));
    assert.equal(heldNow('SIM-6'), null);
    assert.equal(existsSync(join(dir, 'held', 'SIM-6.json')), false);
    // No Maestro to be found at all.
    const path = process.env.PATH;
    process.env.PATH = '/nonexistent';
    try {
      assert.equal(await holdDriver('SIM-7', { up: () => true }), 1);
    } finally {
      process.env.PATH = path;
    }
    assert.equal(heldNow('SIM-7'), null);
    assert.equal(existsSync(join(dir, 'held', 'SIM-7.starting')), false);
  });
});

test('a look and a flow on a simulator whose driver is held use that driver, and start none', async () => {
  const { createServer } = await import('node:http');
  const { lookAt, runFlow } = await import('../src/ios.ts');
  const { mkdirSync } = await import('node:fs');
  let asked = 0;
  const driver = createServer((req, res) => {
    asked += req.url === '/viewHierarchy' ? 1 : 0;
    res.setHeader('content-type', 'application/json');
    res.end(req.url === '/viewHierarchy' ? readFileSync(join(fixtures, 'app-on01.driver.json'), 'utf8') : '{}');
  });
  const port = await new Promise<number>((done) => driver.listen(0, '127.0.0.1', () => done((driver.address() as { port: number }).port)));
  const dir = mkdtempSync(join(tmpdir(), 'eyes-held-use-'));
  try {
    const held = { udid: 'SIM-9', pid: process.pid, port, door: port, size: { w: 402, h: 874 }, agrees: true, at: '' };
    const calls: string[][] = [];
    const run = (async (file: string, args: string[]) => {
      calls.push([file, ...args]);
      return { exitCode: file === 'xcrun' && args[0] === 'swift' ? 1 : 0, stdout: file === 'maestro' ? 'Tap on "x"... COMPLETED\n' : '', stderr: '', timedOut: false };
    }) as never;
    const look = await lookAt('SIM-9', { run, held });
    assert.equal(asked, 1, 'the tree came from the held driver');
    assert.ok(look.screen.texts.includes('카카오로 시작하기'));
    assert.equal(calls.some((call) => call[0] === 'maestro'), false, 'no Maestro was started for the look');

    mkdirSync(join(dir, 'flows'));
    writeFileSync(join(dir, 'flows', 'tap.yaml'), 'appId: a.b\n---\n- tapOn: "x"\n');
    const result = await runFlow('SIM-9', join(dir, 'flows', 'tap.yaml'), { out: join(dir, 'out'), run, held, env: { WHO: 'me' } });
    const flow = calls.find((call) => call[0] === 'maestro')!;
    assert.deepEqual(flow.slice(0, 7), ['maestro', '--driver-host-port', String(port), '--device', 'SIM-9', 'test', '--no-reinstall-driver']);
    assert.deepEqual(flow.slice(7, 9), ['-e', 'WHO=me']);
    assert.equal(result.passed, true);

    // A driver that does not answer: the look asks Maestro itself, on the held port, as it did before there was a holder.
    await new Promise((done) => driver.close(done));
    calls.length = 0;
    const tree = readFileSync(join(fixtures, 'app-on01.maestro.json'), 'utf8');
    const again = await lookAt('SIM-9', { held, run: (async (file: string, args: string[]) => {
      calls.push([file, ...args]);
      return { exitCode: file === 'xcrun' && args[0] === 'swift' ? 1 : 0, stdout: file === 'maestro' ? tree : '', stderr: '', timedOut: false };
    }) as never });
    assert.deepEqual(calls.find((call) => call[0] === 'maestro')!.slice(0, 6), ['maestro', '--driver-host-port', String(port), '--device', 'SIM-9', 'hierarchy']);
    assert.deepEqual(again.screen, look.screen);
  } finally {
    driver.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('whoever asks for a holder waits for it to come up, however long its process takes to start', async () => {
  // 2026-11-21, the first real check with a held driver: the holder's process had not written its mark 300ms after
  // it was started, the flow that asked took that for "no holder is coming", started a driver of its own on another
  // port, and the two fought over the simulator's runner: "iOS driver not ready in time", 132 seconds.
  const { ensureHeld } = await import('../src/ios-hold.ts');
  const dir = mkdtempSync(join(tmpdir(), 'eyes-hold-wait-'));
  const before = process.env.SZ_HELD_DIR;
  process.env.SZ_HELD_DIR = join(dir, 'held');
  try {
    // A holder that takes a second to say anything, then holds for a moment.
    const slow = join(dir, 'slow-holder.mjs');
    writeFileSync(slow, `import { writeFileSync, rmSync } from 'node:fs';
const [, , , , udid] = process.argv;
const dir = process.env.SZ_HELD_DIR;
await new Promise((done) => setTimeout(done, 1000));
writeFileSync(dir + '/' + udid + '.json', JSON.stringify({ udid, pid: process.pid, port: 1, door: 1, size: { w: 402, h: 874 }, agrees: true, at: '' }));
rmSync(dir + '/' + udid + '.starting', { force: true });
await new Promise((done) => setTimeout(done, 1500));
rmSync(dir + '/' + udid + '.json', { force: true });
`);
    const [first, second] = await Promise.all([ensureHeld('SIM-W', { cli: slow, waitMs: 8_000 }), ensureHeld('SIM-W', { cli: slow, waitMs: 8_000 })]);
    assert.ok(first && second, 'both waited for the one holder');
    assert.equal(first.pid, second.pid, 'and one holder was started, not two');

    // A holder whose process never comes up: the wait ends when no holder has taken the mark over, long before
    // the whole wait is spent, and the mark is cleared so that the next look does not wait for it again.
    const never = join(dir, 'never.mjs');
    writeFileSync(never, 'process.exit(1);\n');
    await new Promise((done) => setTimeout(done, 1700));
    const started = Date.now();
    assert.equal(await ensureHeld('SIM-N', { cli: never, waitMs: 30_000, startMs: 600 }), null);
    assert.ok(Date.now() - started < 5_000, 'it did not wait the whole thirty seconds');
    assert.equal(existsSync(join(dir, 'held', 'SIM-N.starting')), false);
    // A mark that names a holder which has died: whoever finds it starts a holder itself.
    writeFileSync(join(dir, 'held', 'SIM-N.starting'), String(2 ** 22 - 5));
    const later = await ensureHeld('SIM-N', { cli: slow, waitMs: 8_000 });
    assert.ok(later, 'a new holder was started over the stale mark');
  } finally {
    if (before === undefined) delete process.env.SZ_HELD_DIR;
    else process.env.SZ_HELD_DIR = before;
    await new Promise((done) => setTimeout(done, 1700));
    rmSync(dir, { recursive: true, force: true });
  }
});

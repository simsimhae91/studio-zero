// The two utilities for the Mac the daemon lives on: holding it awake (one caffeinate process, three states),
// and what the daemon has seen of each subscription (never the account's balance, which it cannot read).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { RpcCallError, RpcClient } from '@studio-zero/protocol';
import { QuotaTracker, RECENT_WINDOW_MS, parseResetHint } from '../src/app/QuotaTracker.ts';
import { Store } from '../src/db/Store.ts';
import { EventLog } from '../src/events/EventLog.ts';
import { CAFFEINATE_FLAGS, CaffeinateManager, type PowerProcess } from '../src/util/CaffeinateManager.ts';
import { sleep } from '../src/util/core.ts';
import { quietLog, sampleProject, testDaemon } from './helpers.ts';

/** A stand-in for `caffeinate`: records what was started and lets a test end a process from outside. */
function fakeCaffeinate(): { spawn: (file: string, args: readonly string[]) => PowerProcess; started: { file: string; args: string[]; alive: boolean; die: () => void }[] } {
  const started: { file: string; args: string[]; alive: boolean; die: () => void }[] = [];
  return {
    started,
    spawn: (file, args) => {
      let onExit: () => void = () => undefined;
      const entry = { file, args: [...args], alive: true, die: () => ((entry.alive = false), onExit()) };
      started.push(entry);
      return { kill: () => void (entry.alive = false), onExit: (listener) => void (onExit = listener) };
    },
  };
}

test('caffeinate: three states, one process at most, tied to the daemon\'s own life', () => {
  const fake = fakeCaffeinate();
  const changes: string[] = [];
  const power = new CaffeinateManager({ log: quietLog, spawn: fake.spawn, platform: 'darwin', pid: 4242, onChange: (mode) => void changes.push(mode) });
  assert.deepEqual(power.state, { mode: 'off', supported: true });
  assert.deepEqual([CAFFEINATE_FLAGS.system, CAFFEINATE_FLAGS.display], [['-i', '-s'], ['-d', '-i', '-s']]);
  assert.ok(CAFFEINATE_FLAGS.system.every((flag) => CAFFEINATE_FLAGS.display.includes(flag)), 'keeping the display on never holds less than keeping the system awake');

  assert.deepEqual(power.set('system'), { mode: 'system', supported: true });
  assert.deepEqual([fake.started[0]!.file, fake.started[0]!.args], ['/usr/bin/caffeinate', ['-i', '-s', '-w', '4242']], 'no idle or system sleep; the display may turn off; it ends if the daemon does');
  power.set('system');
  assert.equal(fake.started.length, 1, 'asking for the mode already held starts nothing');

  power.set('display');
  assert.deepEqual([fake.started[0]!.alive, fake.started[1]!.args, fake.started[1]!.alive], [false, ['-d', '-i', '-s', '-w', '4242'], true], 'the old assertion is released before the new one is taken');
  power.set('off');
  assert.deepEqual([fake.started.length, fake.started[1]!.alive, power.state.mode], [2, false, 'off']);
  assert.deepEqual(changes, ['system', 'display', 'off']);

  // Ended from outside (killed in a terminal): the Mac can sleep again, and the state says so.
  power.set('display');
  fake.started[2]!.die();
  assert.deepEqual([power.state.mode, changes.at(-1)], ['off', 'off']);
  // A process this class replaced does not flip the state when it finally exits.
  power.set('system');
  power.set('display');
  fake.started[3]!.die();
  assert.equal(power.state.mode, 'display');
  power.stop();
  assert.ok(fake.started.every((p) => !p.alive), 'stopping the daemon lets the Mac sleep');

  const elsewhere = new CaffeinateManager({ log: quietLog, spawn: fake.spawn, platform: 'linux' });
  assert.deepEqual(elsewhere.state, { mode: 'off', supported: false });
  assert.throws(() => elsewhere.set('system'), /needs macOS caffeinate/);
  assert.deepEqual(elsewhere.set('off'), { mode: 'off', supported: false });
});

test('caffeinate for real: the process macOS runs has the flags of the mode, and is gone when the mode is off', async (t) => {
  if (process.platform !== 'darwin') return t.skip('caffeinate exists on macOS only');
  const mine = (): string[] => execFileSync('/bin/ps', ['-axo', 'args='], { encoding: 'utf8' }).split('\n').filter((line) => line.includes('caffeinate') && line.endsWith(`-w ${process.pid}`));
  try {
    mine();
  } catch {
    return t.skip('the process list cannot be read here');
  }
  // What macOS itself says this daemon's caffeinate is holding, by assertion type. Null where pmset cannot be asked.
  const held = (): string[] | null => {
    try {
      const pid = execFileSync('/usr/bin/pgrep', ['-f', `caffeinate .*-w ${process.pid}$`], { encoding: 'utf8' }).trim().split('\n')[0];
      const listed = execFileSync('/usr/bin/pmset', ['-g', 'assertions'], { encoding: 'utf8' });
      return [...new Set([...listed.matchAll(new RegExp(`pid ${pid}\\(caffeinate\\): \\[\\w+\\] [\\d:]+ (\\w+) named`, 'g'))].map((m) => m[1]!))].sort();
    } catch {
      return null;
    }
  };
  const power = new CaffeinateManager({ log: quietLog });
  try {
    power.set('system');
    await sleep(150);
    assert.deepEqual(mine().map((line) => line.replace(/^\S*caffeinate/, 'caffeinate')), [`caffeinate -i -s -w ${process.pid}`]);
    const asSystem = held();
    power.set('display');
    await sleep(150);
    assert.deepEqual(mine().map((line) => line.replace(/^\S*caffeinate/, 'caffeinate')), [`caffeinate -d -i -s -w ${process.pid}`]);
    const asDisplay = held();
    if (asSystem && asDisplay && asSystem.length > 0) {
      assert.ok(asDisplay.includes('PreventUserIdleDisplaySleep') && asDisplay.includes('PreventUserIdleSystemSleep'), `display mode holds the display and the idle-sleep assertion: ${asDisplay.join(', ')}`);
      assert.deepEqual(asSystem.filter((type) => !asDisplay.includes(type)), [], 'everything system mode holds, display mode holds too');
    }
    power.set('off');
    await sleep(150);
    assert.deepEqual(mine(), []);
  } finally {
    power.stop();
  }
});

test('power over the wire: the owner switches it, clients are told, the mode survives a restart, an agent cannot', async () => {
  const fake = fakeCaffeinate();
  const d = await testDaemon({}, { powerSpawn: fake.spawn, platform: 'darwin' });
  await d.daemon.start();
  const rpc = new RpcClient({ url: d.url(), token: d.daemon.clientToken.expose(), client: 'test' });
  try {
    await rpc.connect();
    assert.deepEqual(await rpc.call('power.get', {}), { mode: 'off', supported: true });
    assert.deepEqual(await rpc.call('power.set', { mode: 'system' }), { mode: 'system', supported: true });
    assert.deepEqual(fake.started.at(-1)!.args.slice(0, 2), ['-i', '-s']);
    assert.deepEqual(d.daemon.events.history({}, 0, 100).flatMap((e) => (e.body.type === 'power.changed' ? [e.body.mode] : [])), ['system']);
    assert.equal(d.daemon.store.kvGet('power.mode'), 'system');

    await assert.rejects(d.daemon.studio.setPower({ type: 'agent', taskId: 'tsk_x' }, 'off'), /agents do not control whether this Mac sleeps/);
    assert.equal(d.daemon.power.state.mode, 'system');

    // What a daemon does at boot with a saved mode.
    d.daemon.power.stop();
    assert.equal(d.daemon.power.state.mode, 'off');
    await d.daemon.studio.restorePower();
    assert.deepEqual([d.daemon.power.state.mode, fake.started.at(-1)!.alive], ['system', true]);
    await assert.rejects(rpc.call('power.set', { mode: 'bright' as never }), (e: unknown) => e instanceof RpcCallError && e.code === 'invalid_params');
  } finally {
    rpc.close();
    await d.cleanup();
  }
  assert.ok(fake.started.every((p) => !p.alive), 'nothing is left holding the Mac awake after the daemon stops');
});

test('reset hints: a vendor\'s refusal is read for when the limit lifts, and for nothing else', () => {
  const now = new Date(2026, 10, 12, 14, 0, 0).getTime();
  const at = (h: number, m: number, day = 12): number => new Date(2026, 10, day, h, m, 0).getTime();
  assert.equal(parseResetHint("You've hit your usage limit. Try again in 3h 12m.", now), now + (3 * 60 + 12) * 60_000);
  assert.equal(parseResetHint('Rate limit reached; retry after 45 minutes', now), now + 45 * 60_000);
  assert.equal(parseResetHint('quota exhausted, resets in 2 days and 1 hour', now), now + 49 * 3_600_000);
  assert.equal(parseResetHint('Claude usage limit reached. Your limit resets at 5pm.', now), at(17, 0));
  assert.equal(parseResetHint('limit reached, resets 9:30am', now), at(9, 30, 13), 'a time already past today is tomorrow\'s');
  assert.equal(parseResetHint('usage limit reached, resets at 23:15', now), at(23, 15));
  assert.equal(parseResetHint('You have hit your usage limit.', now), null);
  assert.equal(parseResetHint('error 429: too many requests', now), null, 'a status code is not a time of day');
});

test('quota: what the studio spent, limit hits with their reset time, and a limit forgotten once the subscription answers', () => {
  let now = new Date(2026, 10, 12, 14, 0, 0).getTime();
  const store = new Store(':memory:');
  const project = sampleProject();
  store.insertProject(project);
  const events = new EventLog(store, () => now);
  const quota = new QuotaTracker({ store, events, clock: () => now });
  const changed = (): string[] => events.history({}, 0, 100).flatMap((e) => (e.body.type === 'quota.changed' ? [`${e.body.subscription}:${e.body.state}:${e.body.resetsAt === null ? '-' : (e.body.resetsAt - now) / 60_000}`] : []));
  const connections = [{ id: 'codex', available: true, reason: 'codex-cli 0.153.4' }, { id: 'claude-code', available: true, reason: '2.1.322' }, { id: 'cursor', available: false, reason: 'cursor-agent is not installed' }];
  const of = (id: string) => quota.snapshot(connections).subscriptions.find((s) => s.id === id)!;

  store.addUsage({ projectId: project.id, taskId: null, source: 'bridge', model: 'codex:default', inputTokens: 900, outputTokens: 100, usdMicros: 0 }, now - RECENT_WINDOW_MS - 60_000);
  store.addUsage({ projectId: project.id, taskId: null, source: 'bridge', model: 'codex:default', inputTokens: 400, outputTokens: 50, usdMicros: 0 }, now - 60_000);
  store.addUsage({ projectId: project.id, taskId: null, source: 'native', model: 'claude-opus-5-5', inputTokens: 5000, outputTokens: 5000, usdMicros: 10 }, now - 60_000);
  assert.deepEqual([of('codex').recent, of('codex').week], [{ tokens: 450, calls: 1 }, { tokens: 1450, calls: 2 }], 'only what went through that CLI, in each window');
  assert.deepEqual([of('codex').state, of('codex').connected, of('cursor').connected, of('cursor').detail, of('antigravity').detail], ['unknown', true, false, 'cursor-agent is not installed', 'not registered']);
  assert.deepEqual(of('claude-code').recent, { tokens: 0, calls: 0 }, 'API-key usage is not the subscription\'s');

  quota.failed('codex', new Error('codex exited 1: ENOENT'));
  assert.equal(of('codex').state, 'unknown', 'a failure that is not a usage limit says nothing about quota');
  quota.failed('codex', new Error("codex exited 1: You've hit your usage limit. Try again in 2h 30m."));
  assert.deepEqual([of('codex').state, of('codex').resetsAt, of('codex').limitedSince], ['limited', now + 150 * 60_000, now]);
  quota.failed('codex', new Error('usage limit reached'));
  assert.deepEqual(changed(), ['codex:limited:150'], 'the same limit, seen again without a new time, is not news');

  now += 151 * 60_000;
  assert.deepEqual([of('codex').state, of('codex').resetsAt], ['unknown', null], 'past the reset time nobody knows until the next call');
  quota.answered('codex');
  assert.deepEqual([of('codex').state, of('codex').limitedSince, of('codex').lastAnswerAt], ['ok', null, now]);
  assert.deepEqual(changed().map((c) => c.split(':').slice(0, 2).join(':')), ['codex:limited', 'codex:ok']);

  // What was seen outlives the process: the tracker reads it back from the database.
  quota.failed('claude-code', new Error('Claude 구독의 사용 한도에 걸렸습니다'));
  const afterRestart = new QuotaTracker({ store, events, clock: () => now });
  assert.equal(afterRestart.snapshot(connections).subscriptions.find((s) => s.id === 'claude-code')!.state, 'limited');
  store.close();
});

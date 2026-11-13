// The owner's settings from the app: read by anyone holding the token, changed only from the daemon's own Mac,
// written to the configuration file without disturbing the rest of it, and in effect after a restart that is
// refused while anything is in flight. The daemon, its server and its file are real.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PROTOCOL_VERSION, RpcCallError, RpcClient, type OwnerSettings } from '@studio-zero/protocol';
import { openedHere } from '../src/server/DaemonServer.ts';
import { testDaemon, type TestDaemon } from './helpers.ts';

const local = (t: TestDaemon): RpcClient => new RpcClient({ url: t.url(), token: t.daemon.clientToken.expose(), client: 'test' });
const denied = (e: unknown): boolean => e instanceof RpcCallError && e.code === 'policy_denied';
const conflict = (pattern: RegExp) => (e: unknown): boolean => e instanceof RpcCallError && e.code === 'conflict' && pattern.test(e.message);

/** One call over a socket that arrived the way a forwarded one does: through loopback, with what the forwarder adds. */
function forwardedCall(t: TestDaemon, method: string, params: unknown): Promise<{ result?: unknown; error?: { code: string; message: string } }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(t.url(), { headers: { 'x-forwarded-for': '100.64.0.7', 'tailscale-user-login': 'owner@example.com' } } as never);
    const timer = setTimeout(() => (ws.close(), reject(new Error('no answer'))), 5000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION, token: t.daemon.clientToken.expose(), client: 'phone' })));
    ws.addEventListener('message', (ev) => {
      const frame = JSON.parse(String(ev.data)) as { t: string; result?: unknown; error?: { code: string; message: string } };
      if (frame.t === 'ready') return ws.send(JSON.stringify({ t: 'req', id: '1', method, params }));
      if (frame.t !== 'res' && frame.t !== 'err') return;
      clearTimeout(timer);
      ws.close();
      resolve(frame.t === 'res' ? { result: frame.result } : { error: frame.error! });
    });
    ws.addEventListener('error', () => (clearTimeout(timer), reject(new Error('socket error'))));
  });
}

test('which connections were opened on this Mac: a loopback address, a loopback name, and nothing a forwarder adds', () => {
  const req = (ip: string, headers: Record<string, string>) => ({ ip, headers });
  assert.equal(openedHere(req('127.0.0.1', { host: 'localhost:49200' })), true);
  assert.equal(openedHere(req('::1', { host: '[::1]:49200' })), true);
  assert.equal(openedHere(req('::ffff:127.0.0.1', { host: '127.0.0.1:49200' })), true);
  // Tailscale Serve and a Cloudflare Tunnel both arrive from loopback: the name asked for and the headers added tell them apart.
  assert.equal(openedHere(req('127.0.0.1', { host: 'studio.tail1234.ts.net' })), false, 'asked for by its tailnet name');
  assert.equal(openedHere(req('127.0.0.1', { host: 'localhost:49200', 'x-forwarded-for': '100.64.0.7' })), false, 'a forged local name still carries what the forwarder added');
  assert.equal(openedHere(req('127.0.0.1', { host: 'localhost', 'cf-connecting-ip': '203.0.113.9' })), false);
  assert.equal(openedHere(req('127.0.0.1', { host: 'localhost', forwarded: 'for=203.0.113.9' })), false);
  assert.equal(openedHere(req('192.168.0.12', { host: 'localhost:49200' })), false, 'not from loopback at all');
});

test('settings are read by any client and written only from this Mac, into the file and nowhere else', async () => {
  const t = await testDaemon();
  // A file the owner had written by hand, with keys this screen knows nothing about.
  const file = join(t.config.home, 'config.json');
  writeFileSync(file, JSON.stringify({ listen: { allowedHosts: ['studio.tail1234.ts.net'] }, telegram: { apiBase: 'https://tg.example' }, audit: { threshold: 90 } }));
  await t.daemon.start();
  const rpc = local(t);
  try {
    const before = await rpc.call('config.get', {});
    assert.deepEqual([before.writable, before.restartRequired, before.file], [true, false, file]);
    assert.deepEqual(before.settings.ntfy, { enabled: false, server: 'https://ntfy.sh', topic: '', commandTopic: '' });
    assert.deepEqual(before.settings.budgets, { taskTokens: 2_000_000, projectDailyTokens: 20_000_000 });

    const next: OwnerSettings = { ...before.settings, ntfy: { enabled: true, server: 'https://ntfy.sh', topic: 'sz-abc123', commandTopic: 'sz-cmd-def456' }, budgets: { taskTokens: 3_000_000, projectDailyTokens: 20_000_000 }, approvals: { ttlSec: 7200 } };

    // Another machine, through the forwarder: it sees the settings and cannot change them or restart anything.
    const seen = await forwardedCall(t, 'config.get', {});
    assert.equal((seen.result as { writable: boolean }).writable, false);
    const refused = await forwardedCall(t, 'config.set', { settings: next });
    assert.equal(refused.error?.code, 'policy_denied');
    assert.match(refused.error!.message, /설정 변경은\(는\) 데몬이 도는 이 Mac에서 연 앱에서만 할 수 있습니다/);
    assert.equal((await forwardedCall(t, 'system.restart', {})).error?.code, 'policy_denied');
    assert.equal((await rpc.call('config.get', {})).restartRequired, false, 'nothing was written');

    // From this Mac it is written, and the daemon says a restart is owed: it is still running with what it read at boot.
    const saved = await rpc.call('config.set', { settings: next });
    assert.deepEqual([saved.settings.ntfy.topic, saved.settings.budgets.taskTokens, saved.restartRequired], ['sz-abc123', 3_000_000, true]);
    assert.equal(t.config.ntfy.enabled, false, 'the running daemon is unchanged');
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, unknown>>;
    assert.deepEqual([onDisk.listen, onDisk.audit, onDisk.telegram!.apiBase], [{ allowedHosts: ['studio.tail1234.ts.net'] }, { threshold: 90 }, 'https://tg.example'], 'what the owner wrote by hand is kept');
    assert.deepEqual([onDisk.ntfy!.enabled, onDisk.approvals!.ttlSec, statSync(file).mode & 0o777], [true, 7200, 0o600]);
    assert.ok(!existsSync(`${file}.${process.pid}.tmp`));
    const changed = t.daemon.events.history({}, 0, 100).flatMap((e) => (e.body.type === 'config.changed' ? [e.body.sections] : []));
    assert.deepEqual(changed, [['ntfy', 'budgets', 'approvals']], 'on the record, by section');

    // A channel that is switched on has to be able to work.
    const off = saved.settings;
    await assert.rejects(rpc.call('config.set', { settings: { ...off, ntfy: { ...off.ntfy, commandTopic: 'sz-abc123' } } }), conflict(/알림 토픽과 명령 토픽은 서로 달라야 합니다/));
    await assert.rejects(rpc.call('config.set', { settings: { ...off, ntfy: { ...off.ntfy, topic: '' } } }), conflict(/ntfy를 켜려면 알림 토픽과 명령 토픽이 모두 있어야 합니다/));
    await assert.rejects(rpc.call('config.set', { settings: { ...off, telegram: { enabled: true, allowedUserIds: [] } } }), conflict(/Telegram을 켜려면 명령을 받을 사용자 ID가 하나 이상/));
    await assert.rejects(rpc.call('config.set', { settings: { ...off, budgets: { taskTokens: 5_000_000, projectDailyTokens: 1_000_000 } } }), conflict(/하루 예산이 작업 하나의 예산보다 작습니다/));
    await assert.rejects(rpc.call('config.set', { settings: { ...off, approvals: { ttlSec: 5 } } }), (e: unknown) => e instanceof RpcCallError && e.code === 'invalid_params');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).ntfy.commandTopic, 'sz-cmd-def456', 'a refused change leaves the file as it was');
    assert.ok(denied(new RpcCallError('policy_denied', 'x')));
  } finally {
    rpc.close();
    await t.cleanup();
  }
});

test('the daemon restarts itself only when something will start it again and nothing is in flight', async () => {
  let restarted = 0;
  const t = await testDaemon({}, { restart: () => void (restarted += 1) });
  await t.daemon.start();
  const rpc = local(t);
  try {
    const project = await rpc.call('projects.create', { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
    t.daemon.store.insertTask({ id: 'tsk_waiting', projectId: project.id, kind: 'build', prompt: '대기 중', origin: 'desktop', budgetTokens: 1000, branch: null, baseBranch: null, enginePref: null, modelPref: null, effortPref: null, sessionId: null, track: 'fast', reviewerPref: null, references: [], createdAt: Date.now() });
    await assert.rejects(rpc.call('system.restart', {}), conflict(/지금 다시 시작하면 끊기는 일이 있습니다: 대기 중인 작업 1건/));
    assert.equal(restarted, 0);
    t.daemon.store.updateTask('tsk_waiting', { state: 'cancelled' });

    assert.deepEqual(await rpc.call('system.restart', {}), { accepted: true });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(restarted, 1, 'after the answer had gone out');
  } finally {
    rpc.close();
    await t.cleanup();
  }

  // A daemon started by hand in a terminal has nothing to start it again: it says so and stays up.
  const bare = await testDaemon({}, { restart: null });
  await bare.daemon.start();
  const plain = local(bare);
  try {
    assert.equal((await plain.call('config.get', {})).supervised, false);
    await assert.rejects(plain.call('system.restart', {}), conflict(/다시 켜 줄 관리자\(LaunchAgent\) 없이 돌고 있어서/));
  } finally {
    plain.close();
    await bare.cleanup();
  }
});

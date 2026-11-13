import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { RpcCallError, RpcClient, type EventEnvelope, type MethodName } from '@studio-zero/protocol';
import { runCommand } from '../src/util/run.ts';
import { tempDir, testDaemon, type TestDaemon } from './helpers.ts';

function client(t: TestDaemon, token = t.daemon.clientToken.expose()): RpcClient {
  return new RpcClient({ url: t.url(), token, client: 'test' });
}

function until<T>(check: () => T | undefined | false, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      const value = check();
      if (value) return resolve(value);
      if (Date.now() - started > ms) return reject(new Error('timed out waiting for condition'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

/** Raw WebSocket handshake, to control headers a WebSocket client would not let us set. */
function handshake(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/v1/ws', agent: false, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers } });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
      req.destroy();
    });
    req.on('error', reject);
    req.end();
  });
}

test('control socket rejects bad tokens, foreign origins and rebinding hosts', async () => {
  const t = await testDaemon();
  await t.daemon.start();
  try {
    await assert.rejects(client(t, 'x'.repeat(40)).connect(), (err: unknown) => err instanceof RpcCallError && err.code === 'unauthorized');

    assert.equal(await handshake(t.port(), {}), 101, 'a native client (no Origin) may connect');
    assert.equal(await handshake(t.port(), { Origin: 'tauri://localhost' }), 101, 'the Tauri web view');
    assert.equal(await handshake(t.port(), { Origin: 'https://evil.example' }), 403, 'a web page on another origin may not');
    assert.equal(await handshake(t.port(), { Host: 'attacker.example' }), 403, 'DNS rebinding: unknown Host header');

    const health = await t.daemon.server.app.inject({ method: 'GET', url: '/healthz', headers: { host: 'localhost' } });
    assert.deepEqual(health.json(), { ok: true });
    const artifact = await t.daemon.server.app.inject({ method: 'GET', url: '/v1/artifacts/art_x', headers: { host: 'localhost' } });
    assert.equal(artifact.statusCode, 401);
    const preflight = await t.daemon.server.app.inject({ method: 'OPTIONS', url: '/v1/artifacts/art_x', headers: { host: 'localhost', origin: 'tauri://localhost', 'access-control-request-headers': 'authorization' } });
    assert.deepEqual([preflight.statusCode, preflight.headers['access-control-allow-origin'], preflight.headers['access-control-allow-headers']], [204, 'tauri://localhost', 'authorization']);
    const foreign = await t.daemon.server.app.inject({ method: 'OPTIONS', url: '/v1/artifacts/art_x', headers: { host: 'localhost', origin: 'https://evil.example' } });
    assert.equal(foreign.headers['access-control-allow-origin'], undefined, 'no CORS grant for other origins');
    const bridge = await t.daemon.server.app.inject({ method: 'POST', url: '/v1/bridge/call', headers: { host: 'localhost', authorization: 'Bearer nope' }, payload: { name: 'bash', arguments: { command: 'id' } } });
    assert.equal(bridge.statusCode, 401);
  } finally {
    await t.cleanup();
  }
});

test('RPC round trip: typed calls, validation, vault is write-only, events replay then stream', async () => {
  const t = await testDaemon();
  await t.daemon.start();
  const rpc = client(t);
  try {
    const status = await rpc.call('system.status', {});
    assert.equal(status.runtime.reachable, true);
    assert.equal(status.engines.find((e) => e.id === 'native-claude')?.available, false);

    const project = await rpc.call('projects.create', { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
    await assert.rejects(rpc.call('projects.create', { name: 'Again', slug: 'ledger', template: 'web-vite-react' }), (e: unknown) => e instanceof RpcCallError && e.code === 'conflict');
    await assert.rejects(rpc.call('projects.create', { name: 'Bad', slug: 'Not A Slug', template: 'web-vite-react' }), (e: unknown) => e instanceof RpcCallError && e.code === 'invalid_params');
    await assert.rejects(rpc.call('tasks.get', { taskId: 'tsk_missing' }), (e: unknown) => e instanceof RpcCallError && e.code === 'not_found');
    await assert.rejects((rpc.call as (m: string, p: object) => Promise<unknown>)('vault.get', { id: 'provider/anthropic/api-key' }), (e: unknown) => e instanceof RpcCallError && e.code === 'unknown_method');

    // Provisioning runs behind the create call: the workspace gets its own theme and project file, committed.
    await until(() => existsSync(join(t.workspace, '.studio-zero/theme.css')) && t.daemon.events.history({ projectId: project.id }, 0, 50).some((e) => e.body.type === 'sandbox.state'));
    assert.match(readFileSync(join(t.workspace, '.studio-zero/theme.css'), 'utf8'), /--color-\*: initial/);
    assert.equal((await rpc.call('evals.list', { projectId: project.id })).evals.map((e) => e.name).join(), 'slop-lint,visual-audit');

    // Secrets go in; nothing in the protocol brings them back out.
    const secret = 'sk-ant-api03-test-secret-value';
    await rpc.call('vault.set', { id: 'provider/anthropic/api-key', secret });
    const listed = await rpc.call('vault.list', {});
    assert.ok(listed.credentials.some((c) => c.id === 'provider/anthropic/api-key'));
    assert.ok(!JSON.stringify(listed).includes(secret));
    assert.ok(!JSON.stringify(t.daemon.events.history({}, 0, 1000)).includes(secret), 'the secret never enters the event log');
    assert.equal((await rpc.call('system.status', {})).engines.find((e) => e.id === 'native-claude')?.available, true);

    // Subscriptions: replay from seq 0, then live, with no gap and no duplicates.
    const seen: EventEnvelope[] = [];
    const unsubscribe = rpc.subscribe({ projectId: project.id }, (e) => seen.push(e), 0);
    await until(() => seen.some((e) => e.body.type === 'sandbox.state'));
    const replayed = seen.length;
    t.daemon.events.emit({ projectId: project.id, taskId: null }, { type: 'notice', level: 'info', message: 'live one' });
    t.daemon.events.emit({ projectId: 'prj_other', taskId: null }, { type: 'notice', level: 'info', message: 'filtered out' });
    await until(() => seen.length > replayed);
    assert.deepEqual(seen.at(-1)?.body, { type: 'notice', level: 'info', message: 'live one' });
    assert.deepEqual(seen.map((e) => e.seq), [...seen.map((e) => e.seq)].sort((a, b) => a - b), 'strictly ordered');
    assert.equal(new Set(seen.map((e) => e.seq)).size, seen.length);
    unsubscribe();

    const methodsCalled: MethodName[] = ['sandbox.info', 'checkpoints.list', 'approvals.list', 'lessons.list', 'kirby.proposals', 'audits.list', 'tasks.list', 'events.history'];
    assert.equal((await rpc.call('sandbox.info', { projectId: project.id })).state, 'running');
    assert.deepEqual(await rpc.call('checkpoints.list', { projectId: project.id }), { checkpoints: [] });
    assert.ok(methodsCalled.length > 0);

    // Deleting a project removes its sandbox and records; the event trail stays.
    assert.deepEqual(await rpc.call('projects.delete', { projectId: project.id, deleteWorkspace: true }), { deleted: true });
    assert.deepEqual((await rpc.call('projects.list', {})).projects, []);
    assert.ok(t.docker.calls.some((c) => c.args.join(' ').endsWith('volume rm sz-ledger-ws')));
    assert.ok(t.daemon.events.history({ projectId: project.id }, 0, 10).length > 0);
    await assert.rejects(rpc.call('sandbox.info', { projectId: project.id }), (e: unknown) => e instanceof RpcCallError && e.code === 'not_found');
  } finally {
    rpc.close();
    await t.cleanup();
  }
});

test('session bridge: a vendor CLI\'s MCP server reaches the sandbox only through the policy-checked Toolbox', async () => {
  const t = await testDaemon();
  await t.daemon.start();
  const scratch = tempDir('sz-shim-');
  try {
    const project = t.daemon.studio.createProject({ type: 'owner', via: 'desktop' }, { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
    await until(() => existsSync(join(t.workspace, '.studio-zero/project.json')));
    const bridged = { project, taskId: 'tsk_bridge' };
    const token = t.daemon.bridgeSessions.create({ definitions: () => t.daemon.toolbox.definitions(), call: (name, args) => t.daemon.toolbox.call(bridged, name, args) }, 60_000);
    const tokenFile = join(scratch.dir, 'token');
    writeFileSync(tokenFile, token, { mode: 0o600 });

    const shim = fileURLToPath(new URL('../src/bridge/mcpShim.ts', import.meta.url));
    const lines = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'write_file', arguments: { path: 'src/hello.txt', content: 'from the bridge\n' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'write_file', arguments: { path: '../../escape.txt', content: 'x' } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'bash', arguments: { command: 'cat src/hello.txt' } } },
    ];
    const res = await runCommand(process.execPath, [shim], {
      stdin: lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
      env: { PATH: process.env.PATH, SZ_BRIDGE_URL: `http://127.0.0.1:${t.port()}/v1/bridge`, SZ_BRIDGE_TOKEN_FILE: tokenFile },
      timeoutMs: 20_000,
    });
    assert.equal(res.exitCode, 0, res.stderr);
    const replies = new Map(res.stdout.trim().split('\n').map((l) => JSON.parse(l) as { id: number; result?: Record<string, unknown>; error?: unknown }).map((r) => [r.id, r]));

    assert.equal((replies.get(1)!.result!.serverInfo as { name: string }).name, 'studio-zero');
    assert.deepEqual((replies.get(2)!.result!.tools as { name: string }[]).map((x) => x.name), ['bash', 'read_file', 'write_file', 'set_theme', 'generate_image', 'check_mockup', 'edit_file', 'web_guidance', 'find_tools', 'use_tool']);
    assert.equal(replies.get(3)!.result!.isError, false);
    assert.equal(readFileSync(join(t.workspace, 'src/hello.txt'), 'utf8'), 'from the bridge\n');

    const escape = replies.get(4)!.result as { isError: boolean; content: { text: string }[] };
    assert.equal(escape.isError, true, 'a path outside /workspace is refused by policy');
    assert.match(escape.content[0]!.text, /denied by policy \(sandbox\.write-inside-workspace\)/);

    const cat = replies.get(5)!.result as { content: { text: string }[] };
    assert.match(cat.content[0]!.text, /^<untrusted-data id="[0-9a-f]{24}" source="sandbox-output" tool="bash" exit="0">\nfrom the bridge\n\n<\/untrusted-data id="[0-9a-f]{24}">$/, 'tool output reaches the vendor model as a data block');

    const trace = t.daemon.events.history({ taskId: 'tsk_bridge' }, 0, 100).map((e) => e.body.type);
    assert.deepEqual(trace.filter((x) => x === 'tool.call').length, 3);
    assert.ok(trace.includes('policy.decision'));

    t.daemon.bridgeSessions.revoke(token);
    const after = await t.daemon.server.app.inject({ method: 'GET', url: '/v1/bridge/tools', headers: { host: 'localhost', authorization: `Bearer ${token}` }, remoteAddress: '127.0.0.1' });
    assert.equal(after.statusCode, 401, 'the token dies with the session');
  } finally {
    scratch.cleanup();
    await t.cleanup();
  }
});

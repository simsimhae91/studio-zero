import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { test } from 'node:test';
import { RpcCallError, RpcClient } from '@studio-zero/protocol';
import { testConfig } from '../src/config.ts';
import { Store } from '../src/db/Store.ts';
import { PolicyEngine } from '../src/policy/PolicyEngine.ts';
import { EventLog } from '../src/events/EventLog.ts';
import { OrbStackManager, SandboxError } from '../src/sandbox/OrbStackManager.ts';
import { PtyManager, dockerExecPty, type PtyOpen, type PtyRequest, type TerminalSink } from '../src/sandbox/PtyManager.ts';
import { stopTerminalScript, terminalShellScript } from '../src/sandbox/scripts.ts';
import { silentLogger, sleep } from '../src/util/core.ts';
import { dockerArgs, localDocker, sampleProject, tempDir, testDaemon } from './helpers.ts';

function until<T>(check: () => T | undefined | false | null, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      const value = check();
      if (value) return resolve(value);
      if (Date.now() - started > ms) return reject(new Error('timed out waiting for condition'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

/** A stand-in shell on a pseudo-terminal: what is typed into it comes back upper-cased, the way a shell echoes and answers. */
class FakeShell extends Duplex {
  override _read(): void {}
  override _write(chunk: Buffer, _encoding: BufferEncoding, done: () => void): void {
    this.push(chunk.toString('utf8').toUpperCase());
    done();
  }
  /** Output the shell produces on its own. */
  say(data: string | Buffer): void {
    this.push(data);
  }
  /** The shell exits: its last output is delivered, then the stream closes. */
  finish(last: string): void {
    this.once('end', () => this.destroy());
    this.push(last);
    this.push(null);
  }
}

function fakePty(): { open: PtyOpen; requests: PtyRequest[]; resizes: [number, number][]; shells: FakeShell[]; exit: { code: number | null } } {
  const requests: PtyRequest[] = [];
  const resizes: [number, number][] = [];
  const shells: FakeShell[] = [];
  const exit = { code: 0 as number | null };
  const open: PtyOpen = async (_endpoint, req) => {
    requests.push(req);
    const shell = new FakeShell();
    shells.push(shell);
    // A real shell prints its prompt the moment it starts, before anyone has been told the terminal's id.
    shell.say('node@ledger:/workspace$ ');
    return { stream: shell, resize: async (cols, rows) => void resizes.push([cols, rows]), exitCode: async () => exit.code };
  };
  return { open, requests, resizes, shells, exit };
}

function collector(): TerminalSink & { out: Map<string, string>; exits: { id: string; code: number | null; reason: string }[]; slow: boolean } {
  const sink = {
    out: new Map<string, string>(),
    exits: [] as { id: string; code: number | null; reason: string }[],
    slow: false,
    output: (id: string, data: string) => void sink.out.set(id, (sink.out.get(id) ?? '') + data),
    exit: (id: string, code: number | null, reason: string) => void sink.exits.push({ id, code, reason }),
    congested: () => sink.slow,
  };
  return sink;
}

async function manager() {
  const home = tempDir();
  const ws = tempDir('sz-ws-');
  const docker = localDocker(ws.dir);
  const store = new Store(':memory:');
  const project = sampleProject();
  store.insertProject(project);
  const sandboxes = new OrbStackManager({ config: testConfig(home.dir), store, clock: () => 1000, run: docker.run });
  await sandboxes.ensure(project);
  const pty = fakePty();
  const terminals = new PtyManager({ sandboxes, log: silentLogger, open: pty.open });
  return { terminals, pty, project, docker, ws: ws.dir, cleanup: () => (home.cleanup(), ws.cleanup()) };
}

test('a terminal is a shell on a pseudo-terminal in the sandbox: output streams out, keystrokes go in, the owner alone holds it', async () => {
  const { terminals, pty, project, docker, cleanup } = await manager();
  try {
    const sink = collector();
    const id = await terminals.spawn(project, { cols: 120, rows: 30 }, 'con_a', sink);
    assert.match(id, /^trm_/);
    const req = pty.requests[0]!;
    assert.deepEqual([req.container, req.cols, req.rows], ['sz-ledger', 120, 30]);
    assert.deepEqual(req.command.slice(0, 2), ['sh', '-c']);
    assert.match(req.command[2]!, /echo \$\$ > \/tmp\/sz\/term-[a-z0-9]{12}\.pid[\s\S]*exec bash -l/, 'the shell records its pid so it can be ended from inside the container');

    await until(() => sink.out.get(id)?.includes('$ '));
    terminals.write('con_a', id, 'ls -la\r');
    await until(() => sink.out.get(id)?.endsWith('LS -LA\r'));

    // Someone else's connection cannot type into it, resize it or kill it.
    terminals.write('con_b', id, 'rm -rf .\r');
    await sleep(20);
    assert.ok(!sink.out.get(id)!.includes('RM -RF'));
    await assert.rejects(terminals.resize('con_b', id, 10, 10), /not found/);
    assert.equal(await terminals.kill('con_b', id), false);

    await terminals.resize('con_a', id, 200, 50);
    assert.deepEqual(pty.resizes.at(-1), [200, 50]);

    assert.equal(await terminals.kill('con_a', id), true);
    assert.deepEqual(sink.exits, [{ id, code: null, reason: 'killed' }]);
    assert.equal(terminals.count(), 0);
    const stop = docker.calls.map((c) => dockerArgs(c.args)).find((a) => a[0] === 'exec' && a.at(-1)!.includes('kill -HUP'));
    assert.ok(stop, 'killing a terminal ends its shell inside the sandbox; closing the stream alone would leave it running');
    assert.match(stop.at(-1)!, /pidfile=\/tmp\/sz\/term-[a-z0-9]{12}\.pid/);
    terminals.write('con_a', id, 'after the end\r'); // dropped, not thrown
    assert.equal(await terminals.kill('con_a', id), false);
  } finally {
    cleanup();
  }
});

test('terminal output: multi-byte characters split across chunks arrive whole, and a slow client pauses the shell instead of filling memory', async () => {
  const { terminals, pty, project, cleanup } = await manager();
  try {
    const sink = collector();
    const id = await terminals.spawn(project, { cols: 80, rows: 24 }, 'con_a', sink);
    const shell = pty.shells[0]!;
    const bytes = Buffer.from('한글 ✓ done');
    shell.say(bytes.subarray(0, 2)); // half of the first syllable
    await sleep(10);
    shell.say(bytes.subarray(2));
    await until(() => sink.out.get(id)?.endsWith('한글 ✓ done'));
    assert.ok(!sink.out.get(id)!.includes('�'), 'no replacement characters');

    sink.slow = true;
    shell.say('A');
    await until(() => shell.isPaused());
    shell.say('B');
    await sleep(120);
    assert.ok(sink.out.get(id)!.endsWith('A'), 'nothing more is read from the shell while the client is behind');
    sink.slow = false;
    await until(() => sink.out.get(id)?.endsWith('AB'));
    assert.equal(shell.isPaused(), false);
  } finally {
    await terminals.stop();
    cleanup();
  }
});

test('a shell that exits ends its terminal with the exit code; a closed connection kills what it owned; there is a cap per client', async () => {
  const { terminals, pty, project, cleanup } = await manager();
  try {
    const sink = collector();
    const first = await terminals.spawn(project, { cols: 80, rows: 24 }, 'con_a', sink);
    pty.exit.code = 130;
    pty.shells[0]!.finish('logout\r\n');
    await until(() => sink.exits.length === 1);
    assert.deepEqual(sink.exits[0], { id: first, code: 130, reason: 'exited' });
    assert.ok(sink.out.get(first)!.endsWith('logout\r\n'), 'the last output arrives before the exit');

    const mine = [await terminals.spawn(project, { cols: 80, rows: 24 }, 'con_a', sink), await terminals.spawn(project, { cols: 80, rows: 24 }, 'con_a', sink)];
    const theirs = await terminals.spawn(project, { cols: 80, rows: 24 }, 'con_b', sink);
    await terminals.closeOwner('con_a');
    assert.deepEqual(sink.exits.slice(1).map((e) => [e.id, e.reason]), mine.map((id) => [id, 'client disconnected']));
    assert.equal(terminals.count(), 1);
    await terminals.closeProject(project.id);
    assert.deepEqual(sink.exits.at(-1), { id: theirs, code: null, reason: 'sandbox is going away' });

    for (let i = 0; i < 8; i++) await terminals.spawn(project, { cols: 80, rows: 24 }, 'con_c', sink);
    await assert.rejects(terminals.spawn(project, { cols: 80, rows: 24 }, 'con_c', sink), /already has 8 terminals/);
  } finally {
    await terminals.stop();
    cleanup();
  }
});

test('the terminal scripts: pid file, login shell, and a hangup that reaches the shell', async () => {
  assert.match(terminalShellScript('term-abc'), /^mkdir -p \/tmp\/sz\necho \$\$ > \/tmp\/sz\/term-abc\.pid\n/);
  assert.match(stopTerminalScript('term-abc'), /kill -HUP "\$pid"[\s\S]*kill -KILL -- "-\$pid"[\s\S]*rm -f "\$pidfile"/);
  assert.throws(() => terminalShellScript('x; rm -rf /'), /invalid process name/);
  assert.throws(() => stopTerminalScript('../../etc'), /invalid process name/);
});

/**
 * The three engine API calls behind `docker exec -it`, answered the way the engine answers them. Served over
 * loopback TCP (the engine API is the same HTTP on either transport) so the test also runs where a process may
 * not create unix sockets; the unix-socket path is exercised against a real engine by the opt-in engine test.
 */
async function fakeEngine(): Promise<{ server: Server; endpoint: string; calls: { method: string; url: string; body: unknown }[]; execs: Map<string, { exitCode: number }> }> {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const execs = new Map<string, { exitCode: number }>();
  const body = (req: IncomingMessage): Promise<unknown> =>
    new Promise((resolve) => {
      let text = '';
      req.on('data', (c: Buffer) => (text += c.toString()));
      req.on('end', () => resolve(text === '' ? null : JSON.parse(text)));
    });
  const server = createServer(async (req, res) => {
    const payload = await body(req);
    calls.push({ method: req.method ?? '', url: req.url ?? '', body: payload });
    const json = (status: number, value: unknown): void => void res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    if (req.method === 'POST' && req.url === '/containers/sz-ledger/exec') {
      execs.set('exec1', { exitCode: 0 });
      return json(201, { Id: 'exec1' });
    }
    if (req.method === 'POST' && req.url === '/containers/sz-stopped/exec') return json(409, { message: 'container sz-stopped is not running' });
    if (req.method === 'POST' && req.url?.startsWith('/exec/exec1/resize')) return json(200, null);
    if (req.method === 'GET' && req.url === '/exec/exec1/json') return json(200, { ExitCode: execs.get('exec1')!.exitCode, Running: false });
    json(404, { message: 'no such thing' });
  });
  // The start call asks to leave HTTP: the engine answers 101 and the socket becomes the terminal.
  server.on('upgrade', (req, socket, first: Buffer) => {
    let text = '';
    // The request body may have arrived with the headers (then it is in `first`) or may still be on its way.
    const head = (chunk: Buffer): void => {
      text += chunk.toString();
      if (!text.includes('}')) return;
      socket.off('data', head);
      calls.push({ method: req.method ?? '', url: req.url ?? '', body: JSON.parse(text) });
      socket.write('HTTP/1.1 101 UPGRADED\r\nContent-Type: application/vnd.docker.raw-stream\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');
      socket.write('$ ');
      socket.on('data', (c: Buffer) => {
        const typed = c.toString();
        if (typed === 'exit\r') {
          execs.get('exec1')!.exitCode = 7;
          return socket.end('logout\r\n');
        }
        socket.write(`echo:${typed}`);
      });
    };
    socket.on('data', head);
    if (first.length > 0) head(first);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, endpoint: `tcp://127.0.0.1:${(server.address() as { port: number }).port}`, calls, execs };
}

test('dockerExecPty speaks the engine API: create an exec with a TTY, upgrade to a raw stream, resize, read the exit code', async () => {
  const engine = await fakeEngine();
  try {
    const pty = await dockerExecPty(engine.endpoint, { container: 'sz-ledger', cols: 100, rows: 40, command: ['sh', '-c', 'exec bash -l'] });
    let seen = '';
    let closed = false;
    pty.stream.on('data', (c: Buffer) => (seen += c.toString()));
    pty.stream.on('close', () => (closed = true));
    await until(() => seen.includes('$ '));

    const create = engine.calls[0]!;
    assert.deepEqual([create.method, create.url], ['POST', '/containers/sz-ledger/exec']);
    assert.deepEqual(create.body, { AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true, User: '1000:1000', WorkingDir: '/workspace', Env: ['TERM=xterm-256color', 'COLORTERM=truecolor', 'LANG=C.UTF-8'], Cmd: ['sh', '-c', 'exec bash -l'] });
    assert.deepEqual(engine.calls[1], { method: 'POST', url: '/exec/exec1/start', body: { Detach: false, Tty: true } });
    assert.equal(engine.calls[2]!.url, '/exec/exec1/resize?h=40&w=100', 'the size is applied as soon as the stream is open');

    pty.stream.write('pwd\r');
    await until(() => seen.endsWith('echo:pwd\r'));
    await pty.resize(132, 43);
    assert.equal(engine.calls.at(-1)!.url, '/exec/exec1/resize?h=43&w=132');

    pty.stream.write('exit\r');
    await until(() => closed);
    assert.ok(seen.endsWith('logout\r\n'));
    assert.equal(await pty.exitCode(), 7);

    await assert.rejects(dockerExecPty(engine.endpoint, { container: 'sz-stopped', cols: 80, rows: 24, command: ['sh'] }), (err: unknown) => err instanceof SandboxError && /sz-stopped is not running/.test(err.message));
    await assert.rejects(dockerExecPty('ssh://somewhere', { container: 'x', cols: 80, rows: 24, command: ['sh'] }), /unsupported container engine endpoint/);
  } finally {
    engine.server.closeAllConnections();
    await new Promise((resolve) => engine.server.close(resolve));
  }
});

test('policy: a terminal is opened by the owner at the desk, never by an agent and never from a chat app', () => {
  const store = new Store(':memory:');
  const project = sampleProject();
  store.insertProject(project);
  const policy = new PolicyEngine({ store, events: new EventLog(store, () => 1), config: testConfig('/tmp/unused'), clock: () => 1 });
  const action = { kind: 'sandbox.terminal', projectId: project.id } as const;
  assert.equal(policy.evaluate({ type: 'owner', via: 'desktop' }, action).effect, 'allow');
  assert.equal(policy.evaluate({ type: 'owner', via: 'telegram' }, action).effect, 'deny');
  assert.equal(policy.evaluate({ type: 'agent', taskId: 'tsk_1' }, action).effect, 'deny');
  assert.equal(policy.evaluate({ type: 'system' }, action).effect, 'deny');
  assert.equal(policy.evaluate({ type: 'owner', via: 'desktop' }, { kind: 'sandbox.terminal', projectId: 'prj_missing' }).rule, 'project.must-exist');
});

test('terminals over the control socket: spawn, type, resize, kill; a dropped connection takes its terminals with it', async () => {
  const pty = fakePty();
  const t = await testDaemon({}, { ptyOpen: pty.open });
  await t.daemon.start();
  const rpc = new RpcClient({ url: t.url(), token: t.daemon.clientToken.expose(), client: 'test' });
  const other = new RpcClient({ url: t.url(), token: t.daemon.clientToken.expose(), client: 'other' });
  try {
    const project = await rpc.call('projects.create', { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
    await until(() => existsSync(join(t.workspace, '.studio-zero/project.json')));

    let out = '';
    const exits: [number | null, string][] = [];
    const term = await rpc.openTerminal({ projectId: project.id, cols: 90, rows: 28 }, { onOutput: (d) => (out += d), onExit: (code, reason) => void exits.push([code, reason]) });
    assert.match(term.id, /^trm_/);
    assert.deepEqual([pty.requests[0]!.container, pty.requests[0]!.cols, pty.requests[0]!.rows], ['sz-ledger', 90, 28]);
    await until(() => out.includes('node@ledger:/workspace$ '));
    assert.ok(out.startsWith('node@ledger'), 'the prompt printed before the spawn call returned was not lost');

    term.write('pnpm dev\r');
    await until(() => out.endsWith('PNPM DEV\r'));
    term.write('x'.repeat(100_000)); // a paste larger than one frame is split, in order
    await until(() => out.endsWith('X'.repeat(100_000)), 10_000);

    await term.resize(140, 44);
    assert.deepEqual(pty.resizes.at(-1), [140, 44]);
    await assert.rejects(rpc.call('terminal.resize', { terminalId: term.id, cols: 1, rows: 0 }), (e: unknown) => e instanceof RpcCallError && e.code === 'invalid_params');

    // Another connection, even with the same token, does not own this terminal.
    await assert.rejects(other.call('terminal.resize', { terminalId: term.id, cols: 80, rows: 24 }), (e: unknown) => e instanceof RpcCallError && e.code === 'not_found');
    assert.deepEqual(await other.call('terminal.kill', { terminalId: term.id }), { killed: false });

    await term.kill();
    await until(() => exits.length === 1);
    assert.deepEqual(exits[0], [null, 'killed']);
    await term.kill(); // already gone: a no-op on the client

    // The second client opens one and then drops off the network.
    let theirExit: string | null = null;
    await other.openTerminal({ projectId: project.id, cols: 80, rows: 24 }, { onOutput: () => undefined, onExit: (_code, reason) => (theirExit = reason) });
    assert.equal(t.daemon.pty.count(), 1);
    other.close();
    await until(() => t.daemon.pty.count() === 0);
    assert.equal(theirExit, 'disconnected', 'the client is told its terminal is gone the moment its connection is');

    await assert.rejects(rpc.openTerminal({ projectId: 'prj_missing', cols: 80, rows: 24 }, { onOutput: () => undefined, onExit: () => undefined }), (e: unknown) => e instanceof RpcCallError && e.code === 'not_found');
  } finally {
    rpc.close();
    other.close();
    await t.cleanup();
  }
});

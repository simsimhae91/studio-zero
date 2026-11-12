import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { RpcClient } from '@studio-zero/protocol';
import { createDaemon } from '../src/app/compose.ts';
import { testConfig } from '../src/config.ts';
import { CompilerGate } from '../src/harness/CompilerGate.ts';
import { sleep } from '../src/util/core.ts';
import { fakeSecurity, freePort, quietLog, tempDir } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;

/**
 * The workbench features against a real container engine: a terminal on a real pseudo-terminal reached over the
 * engine's own socket, the file explorer on a real volume with real git, and the compiler gate with a real
 * package script.
 *
 * Opt-in: `SZ_TEST_ENGINE=1 node --test packages/daemon/test/workbench.integration.test.ts`. Needs OrbStack
 * (or another engine behind the `orbstack` Docker context) running.
 */
test('workbench on a real container engine', { skip: process.env.SZ_TEST_ENGINE !== '1' && 'set SZ_TEST_ENGINE=1 to run (needs OrbStack running)' }, async (t) => {
  const home = tempDir('sz-engine-');
  const config = testConfig(home.dir, { listen: { port: await freePort() }, gateway: { port: await freePort() }, engines: { claudeCode: { enabled: false }, codex: { enabled: false }, cursor: { enabled: false }, antigravity: { enabled: false } }, runtime: { memoryMb: 1024 } });
  const daemon = await createDaemon(config, quietLog, { securityRun: fakeSecurity().run });
  await daemon.start();
  const { studio, sandboxes, events } = daemon;
  const project = studio.createProject(OWNER, { name: 'Workbench test', slug: `it-${randomBytes(4).toString('hex')}`, template: 'web-vite-react' });
  const rpc = new RpcClient({ url: `ws://127.0.0.1:${config.listen.port}/v1/ws`, token: daemon.clientToken.expose(), client: 'test' });
  const sh = async (script: string): Promise<string> => {
    const res = await sandboxes.exec(project, script, { timeoutSec: 60 });
    return `${res.stdout}${res.stderr}`.trim();
  };
  const waitFor = async <T>(read: () => T | undefined | false | null, what: string | (() => string), seconds: number): Promise<T> => {
    for (let i = 0; i < seconds * 10; i++) {
      const value = read();
      if (value) return value;
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${typeof what === 'string' ? what : what()}`);
  };

  try {
    await waitFor(() => events.history({ projectId: project.id }, 0, 50).some((e) => e.body.type === 'sandbox.state' || e.body.type === 'notice'), 'provisioning', 1200);
    assert.equal((await sandboxes.info(project)).state, 'running', JSON.stringify(events.history({ projectId: project.id }, 0, 50).map((e) => e.body)));

    await t.test('the project list reads sandbox state from the engine in one call', async () => {
      const overview = await rpc.call('projects.list', {});
      assert.deepEqual(overview.live, [{ projectId: project.id, sandbox: 'running', busy: false }]);
    });

    await t.test('an interactive terminal: a real TTY in the sandbox, both directions, resize, interrupt, kill', async () => {
      let out = '';
      const exits: [number | null, string][] = [];
      const term = await rpc.openTerminal({ projectId: project.id, cols: 100, rows: 30 }, { onOutput: (d) => (out += d), onExit: (code, reason) => void exits.push([code, reason]) });
      const expect = async (pattern: RegExp, what: string): Promise<void> => void (await waitFor(() => pattern.test(out), () => `${what}; got: ${JSON.stringify(out.slice(-400))}`, 20));
      // A command's first line of output follows the echoed command line, and bash's "paste mode off" sequence.
      const line = (text: string): RegExp => new RegExp(`[\\r\\n]${text}\\r\\n`);

      await expect(/\$ $/, 'a shell prompt');
      term.write('tty; id -u; pwd; echo "sum=$((6 * 7))"; echo "term=$TERM"\r');
      await expect(/\/dev\/pts\/\d+/, 'a pseudo-terminal device');
      await expect(/\r\n1000\r\n\/workspace\r\nsum=42\r\nterm=xterm-256color\r\n/, 'the sandbox user, the workspace and the terminal type');

      term.write('stty size\r');
      await expect(line('30 100'), 'the size given at spawn');
      await term.resize(132, 43);
      out = '';
      term.write('stty size\r');
      await expect(line('43 132'), 'the new size after a resize');

      // Ctrl+C reaches the foreground job through the terminal's line discipline, as it would at a keyboard.
      out = '';
      term.write('sleep 300; echo "status=$?"\r');
      await sleep(500);
      term.write('\x03');
      await expect(/\^C/, 'the interrupt echoed');
      term.write('echo "after=$?"\r');
      await expect(/after=130/, 'the interrupted command reported as killed by SIGINT');

      // Keys, colour and cursor movement pass through untouched: this is what makes it a terminal and not a log.
      out = '';
      term.write("printf '\\033[31mred\\033[0m\\n'\r");
      await expect(/\x1b\[31mred\x1b\[0m/, 'ANSI sequences from the shell');

      const pidFile = await sh('ls /tmp/sz/ | grep "^term-"');
      const pid = await sh(`cat /tmp/sz/${pidFile}`);
      assert.match(await sh(`cat /proc/${pid}/comm`), /^(bash|sh)$/, 'the recorded pid is the shell');
      term.write('sleep 600 &\r');
      await sleep(300);
      assert.equal(await sh('ps -eo args | grep -c "^sleep 600" || true'), '1', 'the background job is running before the kill');

      await term.kill();
      await waitFor(() => exits.length === 1, 'the exit notice', 10);
      assert.deepEqual(exits[0], [null, 'killed']);
      assert.equal(await sh(`test -d /proc/${pid} && echo alive || echo gone`), 'gone', 'the shell is gone, not just disconnected');
      // (The container's own main process is a `sleep infinity`, so the job is looked for by its full command line.)
      assert.equal(await sh('ps -eo args | grep -c "^sleep 600" || true'), '0', 'and so is the job it left in the background');
      assert.equal(await sh('ls /tmp/sz/ | grep -c "^term-" || true'), '0');
    });

    await t.test('a terminal dies with the connection that opened it', async () => {
      const other = new RpcClient({ url: `ws://127.0.0.1:${config.listen.port}/v1/ws`, token: daemon.clientToken.expose(), client: 'other' });
      let out = '';
      try {
        await other.openTerminal({ projectId: project.id, cols: 80, rows: 24 }, { onOutput: (d) => (out += d), onExit: () => undefined });
        await waitFor(() => /\$ $/.test(out), 'a prompt', 20);
        assert.equal(await sh('ls /tmp/sz/ | grep -c "^term-"'), '1');
      } finally {
        other.close();
      }
      await waitFor(() => daemon.pty.count() === 0, 'the terminal to be reaped', 10);
      await sleep(1500);
      assert.equal(await sh('ls /tmp/sz/ | grep -c "^term-" || true'), '0', 'no shell is left running for a client that is gone');
    });

    await t.test('files: list, read and write on the real volume, following the real .gitignore', async () => {
      await sh('mkdir -p src node_modules/pkg build-cache && printf "build-cache/\\n*.log\\n" > .gitignore && echo x > node_modules/pkg/index.js && echo y > build-cache/a && echo z > debug.log');
      assert.deepEqual(await rpc.call('files.write', { projectId: project.id, path: 'src/App.tsx', content: 'export const App = () => "안녕";\n' }), { written: true });
      const top = (await rpc.call('files.list', { projectId: project.id })).entries.map((e) => `${e.type[0]} ${e.path}`);
      assert.deepEqual(top, ['d .studio-zero', 'd src', 'f .gitignore']);
      const file = await rpc.call('files.read', { projectId: project.id, path: 'src/App.tsx' });
      assert.deepEqual([file.content, file.binary, file.truncated], ['export const App = () => "안녕";\n', false, false]);
      assert.equal(await sh('stat -c %U src/App.tsx'), 'node', 'written as the sandbox user, not as root');
    });

    await t.test('the compiler gate runs the project\'s own type check inside the sandbox', async () => {
      const gate = new CompilerGate({ sandboxes });
      await sh(`cat > package.json <<'JSON'\n{ "scripts": { "typecheck": "node -e \\"console.log('src/App.tsx(3,7): error TS2322: nope'); process.exit(2)\\"" } }\nJSON`);
      const failed = (await gate.run(project))!;
      assert.deepEqual([failed.command, failed.passed, failed.exitCode, failed.output], ['npm run --silent typecheck', false, 2, 'src/App.tsx(3,7): error TS2322: nope']);
      await sh(`cat > package.json <<'JSON'\n{ "scripts": { "typecheck": "node -e \\"process.exit(0)\\"" } }\nJSON`);
      assert.equal((await gate.run(project))!.passed, true);
    });
  } finally {
    rpc.close();
    await sandboxes.destroy(project, { deleteWorkspace: true }).catch(() => undefined);
    await daemon.stop().catch(() => undefined);
    home.cleanup();
  }
});

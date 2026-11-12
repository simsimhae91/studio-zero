import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { acpPrompt, type AcpRequest } from '../src/bridge/acp.ts';
import { JAIL_BIN, jailAvailable, jailProfile, jailed } from '../src/bridge/jail.ts';
import { codingSystemPrompt } from '../src/harness/prompts.ts';
import { runCommand, type RunOptions } from '../src/util/run.ts';
import { sampleProject, testDaemon } from './helpers.ts';

const scratchDir = (): string => realpathSync(mkdtempSync(join(tmpdir(), 'sz-bridge-')));

test('host jail profile: the owner\'s files hidden, writes and executables fenced in, named files hidden last', () => {
  const profile = jailProfile('/private/tmp/scratch', { own: ['/Users/me/.vendor'], exec: ['/opt/vendor/bin'], hide: ['/Users/me/.vendor/mcp.json'] });
  const lines = profile.split('\n');
  assert.equal(lines[2], '(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/var/folders") (subpath "/private/tmp"))');
  assert.match(lines[4]!, /^\(allow file-read\* \(subpath "\/private\/tmp\/scratch"\).*\(subpath "\/Users\/me\/\.vendor"\) \(subpath "\/opt\/vendor\/bin"\)/);
  assert.match(lines[6]!, /^\(allow file-write\* \(subpath "\/private\/tmp\/scratch"\) \(subpath "\/Users\/me\/\.vendor"\) \(literal "\/dev\/null"\)/);
  assert.equal(lines[7], '(deny process-exec*)');
  assert.match(lines[8]!, /^\(allow process-exec\* \(literal "[^"]+node"\) \(literal "\/usr\/bin\/security"\) \(subpath "\/opt\/vendor\/bin"\)\)$/);
  assert.equal(lines.at(-1), '(deny file-read* (literal "/Users/me/.vendor/mcp.json"))', 'in a sandbox profile the last matching rule wins');
  assert.ok(!/\/bin\/(ba|z)?sh/.test(profile), 'no shell is on the list of things that may start');
  assert.deepEqual(jailed(profile, '/opt/vendor/bin/agent', ['--print']), { file: JAIL_BIN, args: ['-p', profile, '/opt/vendor/bin/agent', '--print'] });
});

test('host jail, for real: a jailed process cannot read the home folder, write outside its scratch folder, or start a shell', async (t) => {
  const usable = jailAvailable() && (await runCommand(JAIL_BIN, ['-p', '(version 1)(allow default)', '/usr/bin/true'], { timeoutMs: 5000 }).then((r) => r.exitCode === 0, () => false));
  if (!usable) return t.skip('sandbox-exec cannot be used here (not macOS, or already inside a sandbox)');
  const scratch = scratchDir();
  const script = `
    const fs = require('node:fs'); const cp = require('node:child_process'); const out = {};
    const attempt = (name, fn) => { try { fn(); out[name] = 'ok'; } catch (err) { out[name] = err.code ?? 'failed'; } };
    attempt('listHome', () => fs.readdirSync(${JSON.stringify(homedir())}));
    attempt('writeHome', () => fs.writeFileSync(${JSON.stringify(join(homedir(), '.sz-jail-test'))}, 'x'));
    attempt('writeScratch', () => fs.writeFileSync('inside.txt', 'x'));
    attempt('shell', () => { const r = cp.spawnSync('/bin/sh', ['-c', 'echo hi']); if (r.error) throw r.error; });
    attempt('security', () => { const r = cp.spawnSync('/usr/bin/security', ['help']); if (r.error) throw r.error; });
    console.log(JSON.stringify(out));`;
  const command = jailed(jailProfile(scratch, { own: [], exec: [] }), process.execPath, ['-e', script]);
  const res = await runCommand(command.file, command.args, { cwd: scratch, env: { PATH: '/usr/bin:/bin', HOME: homedir(), TMPDIR: scratch }, timeoutMs: 20_000 });
  assert.equal(res.exitCode, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), { listHome: 'EPERM', writeHome: 'EPERM', writeScratch: 'ok', shell: 'EPERM', security: 'ok' });
});

test('ACP client: session-scoped MCP servers, permission granted, no file system offered, reply assembled from chunks', async () => {
  const agent = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url));
  const answer = await acpPrompt({ file: process.execPath, args: [agent], env: { PATH: process.env.PATH }, cwd: tmpdir(), mcpServers: [{ name: 'studio', command: '/usr/bin/node', args: ['shim.mjs'], env: { SZ_BRIDGE_URL: 'http://127.0.0.1:1/v1/bridge', SZ_BRIDGE_TOKEN_FILE: '/tmp/t' } }], prompt: 'do the task', timeoutMs: 20_000 });
  assert.equal(answer.stopReason, 'end_turn');
  assert.equal(answer.text, 'servers=studio:/usr/bin/node:SZ_BRIDGE_URL+SZ_BRIDGE_TOKEN_FILE permission=yes fs=refused prompt=do the task');
  await assert.rejects(acpPrompt({ file: process.execPath, args: ['-e', 'process.exit(3)'], env: {}, cwd: tmpdir(), mcpServers: [], prompt: 'x', timeoutMs: 20_000 }), /the agent exited \(3\) before answering/);
  await assert.rejects(acpPrompt({ file: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: {}, cwd: tmpdir(), mcpServers: [], prompt: 'x', timeoutMs: 300 }), /did not finish within/);
});

test('Cursor and Antigravity engines: started inside the jail, given only the studio MCP server, chosen only when the owner asks', async (t) => {
  if (!jailAvailable()) return t.skip('these engines need the macOS sandbox');
  // Stand-ins for the installed CLIs, so the adapters can resolve "their" install without the real ones.
  const install = scratchDir();
  for (const name of ['cursor-agent', 'agy']) {
    writeFileSync(join(install, name), '#!/bin/sh\n');
    chmodSync(join(install, name), 0o755);
  }
  const runs: { file: string; args: readonly string[]; env: NodeJS.ProcessEnv | undefined }[] = [];
  const acps: AcpRequest[] = [];
  const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', truncated: false, timedOut: false, durationMs: 1 });
  const d = await testDaemon(
    { engines: { claudeCode: { enabled: false }, codex: { enabled: false }, cursor: { bin: join(install, 'cursor-agent') }, antigravity: { bin: join(install, 'agy') } } },
    { acp: async (req) => (acps.push(req), { text: 'agy did it', stopReason: 'end_turn' }) },
    (docker) => async (file, args, opts: RunOptions = {}) => {
      if (file === JAIL_BIN) {
        runs.push({ file, args, env: opts.env });
        return ok(args.includes('enable') ? 'enabled' : JSON.stringify({ type: 'result', is_error: false, result: 'cursor did it', usage: { inputTokens: 900, outputTokens: 20, cacheReadTokens: 80 } }));
      }
      if (file.startsWith(install)) return ok('1.0.0-test\n');
      return docker(file, args, opts);
    },
  );
  await d.daemon.start();
  try {
    const { router, store } = d.daemon;
    const project = sampleProject();
    store.insertProject(project);
    await assert.rejects(router.route('build'), /no engine available/, 'neither is in the routing table: an engine with its own tools is never picked automatically');
    await assert.rejects(router.route('build', { engine: 'codex' }), /the engine chosen for this task is not available: codex/, 'a chosen engine is not quietly swapped for another');

    for (const [id, said] of [['cursor', 'cursor did it'], ['antigravity', 'agy did it']] as const) {
      const task = store.insertTask({ id: `tsk_${id}`, projectId: project.id, kind: 'build', prompt: 'x', origin: 'desktop', budgetTokens: 1_000_000, branch: null, enginePref: id, createdAt: 1 });
      const route = await router.route('build', { engine: id });
      assert.equal(route.engine.id, id);
      const session = await route.engine.open({ project, task, route: route.candidate, system: codingSystemPrompt(project.template), signal: new AbortController().signal, onWaiting: () => undefined });
      try {
        assert.deepEqual(await session.send('Build it.'), { finalText: said, stopped: 'completed' });
      } finally {
        await session.close();
      }
    }

    // Cursor: approve the workspace MCP server, then one print-mode run. Both inside the same profile.
    assert.equal(runs.length, 2);
    const [enable, main] = runs as [(typeof runs)[0], (typeof runs)[0]];
    const profile = main.args[1]!;
    assert.equal(enable.args[1], profile);
    assert.deepEqual(enable.args.slice(2), [join(install, 'node'), join(install, 'index.js'), 'mcp', 'enable', 'studio']);
    assert.deepEqual(main.args.slice(2, 4), [join(install, 'node'), join(install, 'index.js')], 'the launcher script is bypassed: no shell may start in the jail');
    assert.match(profile, new RegExp(`\\(deny file-read\\* \\(literal "${join(homedir(), '.cursor', 'mcp.json').replaceAll('/', '\\/').replaceAll('.', '\\.')}"\\)\\)$`), 'the owner\'s own MCP servers and their tokens stay out of reach');
    assert.match(String(main.args.at(-1)), /Your own shell and file tools do not work in this session[\s\S]*Build it\.$/);
    assert.match(main.env!.TMPDIR!, /sz-bridge-/);
    assert.equal(store.getTask('tsk_cursor')!.spentTokens, 928, '900 fresh + 20 out, and the 80 read from cache at a tenth');

    // Antigravity: over ACP, with the studio server belonging to that session alone.
    assert.equal(acps.length, 1);
    assert.equal(acps[0]!.file, JAIL_BIN);
    assert.deepEqual(acps[0]!.args.slice(2), [join(install, 'agy'), 'acp']);
    assert.deepEqual(acps[0]!.mcpServers.map((s) => [s.name, Object.keys(s.env)]), [['studio', ['SZ_BRIDGE_URL', 'SZ_BRIDGE_TOKEN_FILE']]]);
    assert.match(String(acps[0]!.args[1]), /mcp_config\.json"\) \(literal "[^"]*mcp_config\.json\.bak"\)\)$/);
  } finally {
    await d.cleanup();
  }
});

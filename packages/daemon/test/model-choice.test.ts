import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RpcCallError, RpcClient } from '@studio-zero/protocol';
import { acpPrompt, type AcpRequest } from '../src/bridge/acp.ts';
import { JAIL_BIN, jailAvailable } from '../src/bridge/jail.ts';
import { codingSystemPrompt } from '../src/harness/prompts.ts';
import type { CommandRunner, RunOptions } from '../src/util/run.ts';
import { sampleProject, testDaemon } from './helpers.ts';

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', truncated: false, timedOut: false, durationMs: 1 });

// What each CLI printed when asked, on the versions the adapters were checked against.
const CODEX_MODELS = JSON.stringify({
  models: [
    { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list', model_messages: { instructions: 'long' } },
    { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide' },
    { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6-Sol', visibility: 'list' },
    { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide' },
  ],
});
const CURSOR_MODELS = [
  'ERROR: failed to copy trust settings of system certificate-25291',
  'Available models',
  '',
  'auto - Auto (current, default)',
  'gpt-5.3-codex - Codex 5.3',
  'composer-2.5 - Composer 2.5 (current)',
  'grok-4.7-low-fast - Grok 4.7  Low Fast​​',
  'claude-fable-5-thinking-high - Claude Fable 5 1M Thinking (NO ZDR)',
  'gpt-5.3-codex - Codex 5.3 again',
  '--force - not a model',
  'two words - not an id',
].join('\n');
const AGY_MODELS = 'Fetching available models...\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\nclaude-opus-5-5-high\tClaude Opus 5.5 (High)\n';

/** Stand-ins for the vendor CLIs: a file to find on disk, and a runner that answers for it. */
function fakeClis(): { install: string; runs: { file: string; args: readonly string[] }[]; wrap: (docker: CommandRunner) => CommandRunner; answers: { cursorModels: string } } {
  const install = realpathSync(mkdtempSync(join(tmpdir(), 'sz-clis-')));
  for (const name of ['codex', 'cursor-agent', 'agy']) {
    writeFileSync(join(install, name), '#!/bin/sh\n');
    chmodSync(join(install, name), 0o755);
  }
  const runs: { file: string; args: readonly string[] }[] = [];
  const answers = { cursorModels: CURSOR_MODELS };
  const wrap = (docker: CommandRunner): CommandRunner => async (file, args, opts: RunOptions = {}) => {
    if (file === JAIL_BIN) {
      runs.push({ file, args });
      return ok(args.includes('enable') ? 'enabled' : JSON.stringify({ type: 'result', is_error: false, result: 'cursor did it', usage: { inputTokens: 10, outputTokens: 2 } }));
    }
    if (!file.startsWith(install)) return docker(file, args, opts);
    runs.push({ file, args });
    if (args[0] === '--version') return ok('1.0.0-test\n');
    if (file.endsWith('/codex') && args.join(' ') === 'debug models') return ok(CODEX_MODELS);
    if (file.endsWith('/codex') && args[0] === 'exec') {
      writeFileSync(args[args.indexOf('--output-last-message') + 1]!, 'codex did it');
      return ok(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } }));
    }
    if (file.endsWith('/cursor-agent') && args.join(' ') === 'models') return answers.cursorModels === '' ? { ...ok(''), exitCode: 1 } : ok(answers.cursorModels);
    if (file.endsWith('/agy') && args.join(' ') === 'models') return ok(AGY_MODELS);
    return { ...ok(''), exitCode: 2, stderr: `unexpected: ${args.join(' ')}` };
  };
  return { install, runs, wrap, answers };
}

const clis = (install: string) => ({ claudeCode: { enabled: false }, codex: { bin: join(install, 'codex') }, cursor: { bin: join(install, 'cursor-agent') }, antigravity: { bin: join(install, 'agy') } });

test('model lists: each vendor CLI is asked for its own, and only what can be handed back to it is offered', async () => {
  const fake = fakeClis();
  const d = await testDaemon({ engines: clis(fake.install) }, {}, fake.wrap);
  await d.daemon.start();
  try {
    const { router } = d.daemon;
    assert.deepEqual(await router.models('codex'), [{ id: 'gpt-6-astra', label: 'GPT-6-Astra' }, { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' }], 'the catalog entries the CLI marks hidden are its own internals');
    assert.deepEqual(await router.models('claude-code'), [], 'an engine that is switched off offers nothing');
    assert.deepEqual(await router.models('native-claude'), [], 'no API key: the API loop cannot run, so it has nothing to pick from');

    await router.models('codex');
    assert.equal(fake.runs.filter((r) => r.args.join(' ') === 'debug models').length, 1, 'the list is kept for a while, not asked for on every menu');

    if (!jailAvailable()) return;
    assert.deepEqual(await router.models('antigravity'), [{ id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' }, { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High)' }]);
    assert.deepEqual(await router.models('cursor'), [
      { id: 'gpt-5.3-codex', label: 'Codex 5.3' },
      { id: 'composer-2.5', label: 'Composer 2.5' },
      { id: 'grok-4.7-low-fast', label: 'Grok 4.7 Low Fast' },
      { id: 'claude-fable-5-thinking-high', label: 'Claude Fable 5 1M Thinking (NO ZDR)' },
    ], 'no log lines, no "auto", nothing twice, nothing that would read as an option, and labels as plain text');
  } finally {
    await d.cleanup();
  }
});

test('model lists: one that could not be read is empty, and is asked for again', async () => {
  let now = 1_000_000;
  const fake = fakeClis();
  fake.answers.cursorModels = '';
  const d = await testDaemon({ engines: clis(fake.install) }, { clock: () => now }, fake.wrap);
  await d.daemon.start();
  try {
    if (!jailAvailable()) return;
    assert.deepEqual(await d.daemon.router.models('cursor'), []);
    fake.answers.cursorModels = CURSOR_MODELS;
    now += 61_000;
    assert.equal((await d.daemon.router.models('cursor')).length, 4);
  } finally {
    await d.cleanup();
  }
});

test('a chosen model goes with its engine: handed to the CLI as asked, in place of the usual one', async () => {
  const fake = fakeClis();
  const acps: AcpRequest[] = [];
  const d = await testDaemon({ engines: clis(fake.install) }, { acp: async (req) => (acps.push(req), { text: 'agy did it', stopReason: 'end_turn' }) }, fake.wrap);
  await d.daemon.start();
  try {
    const { router, store } = d.daemon;
    const project = sampleProject();
    store.insertProject(project);
    const run = async (engine: 'codex' | 'cursor' | 'antigravity', model: string | null): Promise<void> => {
      const task = store.insertTask({ id: `tsk_${engine}_${model ?? 'usual'}`, projectId: project.id, kind: 'build', prompt: 'x', origin: 'desktop', budgetTokens: 1_000_000, branch: null, enginePref: engine, modelPref: model, createdAt: 1 });
      assert.equal(task.modelPref, model);
      const route = await router.route('build', engine, task.modelPref);
      assert.deepEqual([route.candidate.engine, route.candidate.model, route.candidate.effort], [engine, model ?? 'default', 'high']);
      const session = await route.engine.open({ project, task, route: route.candidate, system: codingSystemPrompt(project.template), signal: new AbortController().signal, onWaiting: () => undefined });
      try {
        assert.equal((await session.send('Build it.')).stopped, 'completed');
      } finally {
        await session.close();
      }
    };
    const modelArg = (args: readonly string[]): string | null => (args.includes('--model') ? args[args.indexOf('--model') + 1]! : null);

    await run('codex', null);
    await run('codex', 'gpt-5.6-sol');
    assert.deepEqual(fake.runs.filter((r) => r.args[0] === 'exec').map((r) => modelArg(r.args)), [null, 'gpt-5.6-sol'], 'left to the CLI when nothing was chosen');
    assert.equal(store.taskUsage('tsk_codex_gpt-5.6-sol').calls, 1);

    // The routing table's own entry for an engine keeps its effort; only the model is the owner's.
    assert.equal((await router.route('refactor', 'codex', 'gpt-6-astra')).candidate.model, 'gpt-6-astra');
    assert.equal((await router.route('refactor', 'codex')).candidate.model, 'default');

    if (!jailAvailable()) return;
    await run('cursor', 'composer-2.5');
    assert.equal(modelArg(fake.runs.findLast((r) => r.file === JAIL_BIN)!.args), 'composer-2.5');
    await run('antigravity', null);
    await run('antigravity', 'gemini-4-argon-medium');
    assert.deepEqual(acps.map((a) => a.model), [undefined, 'gemini-4-argon-medium']);
  } finally {
    await d.cleanup();
  }
});

test('ACP client: the session is switched to the chosen model before the prompt, and a model the agent refuses fails the prompt', async () => {
  const agent = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url));
  const ask = (model: string) => acpPrompt({ file: process.execPath, args: [agent], env: { PATH: process.env.PATH }, cwd: tmpdir(), mcpServers: [], prompt: 'do the task', model, timeoutMs: 20_000 });
  assert.match((await ask('gemini-4-argon-high')).text, /prompt=do the task model=gemini-4-argon-high$/);
  await assert.rejects(ask('no-such-model'), /unknown model: no-such-model/, 'the work is not done on some other model');
});

test('tasks.submit: a model needs its engine, cannot look like an option, and is kept on the task', async () => {
  const fake = fakeClis();
  const d = await testDaemon({ engines: { ...clis(fake.install), cursor: { enabled: false }, antigravity: { enabled: false } } }, {}, fake.wrap);
  await d.daemon.start();
  const rpc = new RpcClient({ url: d.url(), token: d.daemon.clientToken.expose(), client: 'test' });
  try {
    const project = await rpc.call('projects.create', { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
    assert.deepEqual((await rpc.call('engines.models', { engine: 'codex' })).models.map((m) => m.id), ['gpt-6-astra', 'gpt-5.6-sol']);
    assert.deepEqual(await rpc.call('engines.models', { engine: 'cursor' }), { models: [] });

    await assert.rejects(rpc.call('tasks.submit', { projectId: project.id, kind: 'build', prompt: 'x', model: 'gpt-5.6-sol' }), (e: unknown) => e instanceof RpcCallError && e.code === 'conflict' && /together with the engine/.test(e.message));
    for (const model of ['--dangerously-bypass-approvals-and-sandbox', '-c', 'a b', 'x;y', '', 'm'.repeat(101)]) {
      await assert.rejects(rpc.call('tasks.submit', { projectId: project.id, kind: 'build', prompt: 'x', engine: 'codex', model }), (e: unknown) => e instanceof RpcCallError && e.code === 'invalid_params', model);
    }
    // An engine that is switched off: the task is taken as asked and then fails, instead of running on another.
    const task = await rpc.call('tasks.submit', { projectId: project.id, kind: 'build', prompt: 'x', engine: 'cursor', model: 'claude-opus-5-5[context=1m]' });
    assert.deepEqual([task.enginePref, task.modelPref], ['cursor', 'claude-opus-5-5[context=1m]']);
    assert.equal((await rpc.call('tasks.submit', { projectId: project.id, kind: 'build', prompt: 'x', engine: 'cursor' })).modelPref, null);
  } finally {
    rpc.close();
    await d.cleanup();
  }
});

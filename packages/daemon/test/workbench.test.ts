import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { RpcCallError, RpcClient, type EventEnvelope } from '@studio-zero/protocol';
import { NAMER_SYSTEM_PROMPT, heuristicIdentity } from '../src/app/ProjectNamer.ts';
import { ADVISOR_SYSTEM_PROMPT } from '../src/app/Studio.ts';
import { sleep } from '../src/util/core.ts';
import type { CommandRunner, RunOptions } from '../src/util/run.ts';
import { testDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
const IDEA = '당근, sns나 단톡방에 사진 올릴 때 아파트 동 호수나 차 번호판이 보이면 불안한데, 사진을 고르면 그런 부분을 알아서 모자이크해 주는 앱을 만들고 싶어';

/** A model that only names things; any engine turn simply ends, so tasks started here finish at once or fail fast. */
function namingModel(answer: unknown | Error, delayMs = 0): { sdk: Anthropic; asked: Anthropic.Beta.MessageCreateParams[] } {
  const usage = { input_tokens: 200, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const base = { id: 'msg', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_details: null, stop_sequence: null, usage };
  const asked: Anthropic.Beta.MessageCreateParams[] = [];
  const sdk = {
    beta: {
      messages: {
        stream: () => ({ finalMessage: async () => ({ ...base, content: [{ type: 'text', text: 'ok', citations: null }], stop_reason: 'end_turn' }) }),
        parse: async (params: Anthropic.Beta.MessageCreateParams) => {
          if (String(params.system) !== NAMER_SYSTEM_PROMPT) return { ...base, content: [], stop_reason: 'end_turn', parsed_output: { outcome: 'clean', rootCauses: [], lessons: [], harmfulLessonIds: [], evalSuggestions: [] } };
          asked.push(params);
          if (delayMs > 0) await sleep(delayMs);
          if (answer instanceof Error) throw answer;
          return { ...base, content: [], stop_reason: 'end_turn', parsed_output: answer };
        },
      },
    },
  } as unknown as Anthropic;
  return { sdk, asked };
}

test('ignite: a long idea becomes a short name, a clean slug and the right stack, and the first task starts without a question', async () => {
  const model = namingModel({ name: '"안심 찰칵"', slug: 'Garim App!', mobile: true });
  const t = await testDaemon({}, { anthropic: model.sdk, smoke: { run: async () => ({ passed: true, routes: ['/'], issues: [], detail: 'ok', durationMs: 1 }) } });
  await t.daemon.start();
  const rpc = new RpcClient({ url: t.url(), token: t.daemon.clientToken.expose(), client: 'test' });
  try {
    const { project, task } = await rpc.call('projects.ignite', { idea: IDEA, track: 'fast' });
    assert.deepEqual([project.name, project.slug, project.template], ['안심 찰칵', 'garim-app', 'mobile-expo'], 'quotes stripped, slug normalised, mobile idea gets the Expo template');
    assert.deepEqual([task.kind, task.track, task.prompt, task.projectId], ['build', 'fast', IDEA, project.id], 'the whole idea is the first task; nothing was asked');
    assert.equal(String((model.asked[0]!.messages[0]!.content as Anthropic.Beta.BetaTextBlockParam[])[0]!.text), IDEA);
    assert.deepEqual([model.asked[0]!.model, model.asked[0]!.output_config?.effort], ['claude-haiku-5-5', 'low'], 'naming is a small, fast call');

    // The same idea again: the slug is taken, so the next one is numbered. A template the owner chose is kept.
    const second = await rpc.call('projects.ignite', { idea: IDEA, track: 'deep', template: 'web-next' });
    assert.deepEqual([second.project.slug, second.project.template, second.task.kind, second.task.track], ['garim-app-2', 'web-next', 'ideate', 'full'], 'the deep track writes the product definition first');

    // Renaming changes the title and nothing the sandbox is named after.
    const seen: EventEnvelope[] = [];
    const unsubscribe = rpc.subscribe({ projectId: project.id }, (e) => seen.push(e), 'now');
    const renamed = await rpc.call('projects.rename', { projectId: project.id, name: '  가림   앱 ' });
    assert.deepEqual([renamed.name, renamed.slug], ['가림 앱', 'garim-app']);
    for (let i = 0; i < 200 && !seen.some((e) => e.body.type === 'project.changed'); i++) await sleep(10);
    assert.deepEqual(seen.find((e) => e.body.type === 'project.changed')?.body, { type: 'project.changed', name: '가림 앱' });
    unsubscribe();
    await assert.rejects(rpc.call('projects.rename', { projectId: project.id, name: '' }), (e: unknown) => e instanceof RpcCallError && e.code === 'invalid_params');
    await assert.rejects(rpc.call('projects.rename', { projectId: 'prj_missing', name: 'x' }), (e: unknown) => e instanceof RpcCallError && e.code === 'not_found');

    // The project list says at a glance which sandboxes are up and which are being worked in.
    for (let i = 0; i < 300 && !existsSync(join(t.workspace, '.studio-zero/project.json')); i++) await sleep(10);
    const overview = await rpc.call('projects.list', {});
    assert.deepEqual(overview.projects.map((p) => p.name), ['가림 앱', '안심 찰칵']);
    assert.deepEqual(overview.live.map((l) => l.projectId), overview.projects.map((p) => p.id));
    assert.ok(overview.live.every((l) => l.sandbox === 'running' || l.sandbox === 'absent'));
  } finally {
    rpc.close();
    await t.cleanup();
  }
});

test('naming never holds a project up: with no model, a failing model or a slow one, the first words of the idea are the name', async () => {
  const none = await testDaemon();
  await none.daemon.start();
  try {
    const { project, task } = await none.daemon.studio.igniteProject(OWNER, { idea: IDEA, track: 'fast' }, 'desktop');
    assert.equal(project.name, '당근', 'the first clause of the idea');
    assert.match(project.slug, /^project-[a-z0-9]{6}$/);
    assert.equal(project.template, 'mobile-expo');
    // With no engine at all the task cannot run; it fails saying so instead of the project never appearing.
    for (let i = 0; i < 300 && none.daemon.studio.getTask(task.id).state !== 'failed'; i++) await sleep(10);
    assert.match(none.daemon.studio.getTask(task.id).error ?? '', /no engine available/);
  } finally {
    await none.cleanup();
  }

  const failing = await testDaemon({}, { anthropic: namingModel(new Error('provider is down')).sdk });
  await failing.daemon.start();
  try {
    const { project } = await failing.daemon.studio.igniteProject(OWNER, { idea: 'Invoice tracker for freelancers, with reminders', track: 'fast' }, 'desktop');
    assert.deepEqual([project.name, project.slug, project.template], ['Invoice tracker for', 'invoice-tracker-for', 'web-vite-react']);
  } finally {
    await failing.cleanup();
  }

  assert.deepEqual(heuristicIdentity('팀 회의록을 요약해 주는 웹 대시보드. 슬랙 연동도.').template, 'web-vite-react', '"웹" wins over a stray "앱"');
  assert.equal(heuristicIdentity('아이폰에서 쓰는 가계부').template, 'mobile-expo');
  assert.equal(heuristicIdentity('아이폰에서 쓰는 가계부', 'web-next').template, 'web-next');
  assert.equal(heuristicIdentity('\n\n').name, 'New project');
  const long = heuristicIdentity('A very long first sentence without any punctuation that just keeps going and going');
  assert.ok(long.name.length <= 24 && !long.name.endsWith(' '), long.name);
});

test('sessions: named task streams inside a project; tasks are filed under one and survive its deletion', async () => {
  const t = await testDaemon();
  await t.daemon.start();
  const rpc = new RpcClient({ url: t.url(), token: t.daemon.clientToken.expose(), client: 'test' });
  try {
    const project = await rpc.call('projects.create', { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
    const other = await rpc.call('projects.create', { name: 'Atlas', slug: 'atlas', template: 'mobile-expo' });
    assert.deepEqual(await rpc.call('sessions.list', { projectId: project.id }), { sessions: [] });

    const auth = await rpc.call('sessions.create', { projectId: project.id, name: ' feature/auth ' });
    const layout = await rpc.call('sessions.create', { projectId: project.id, name: 'fix/layout' });
    assert.match(auth.id, /^ses_/);
    assert.deepEqual((await rpc.call('sessions.list', { projectId: project.id })).sessions.map((s) => s.name), ['feature/auth', 'fix/layout']);
    assert.deepEqual((await rpc.call('sessions.list', { projectId: other.id })).sessions, [], 'sessions belong to one project');
    assert.equal((await rpc.call('sessions.rename', { sessionId: layout.id, name: 'fix/sidebar' })).name, 'fix/sidebar');

    const inAuth = await rpc.call('tasks.submit', { projectId: project.id, kind: 'build', prompt: 'Add sign-in', sessionId: auth.id });
    const inDefault = await rpc.call('tasks.submit', { projectId: project.id, kind: 'inline_edit', prompt: 'Fix a typo' });
    assert.deepEqual([inAuth.sessionId, inDefault.sessionId, inAuth.track], [auth.id, null, 'full']);
    await assert.rejects(rpc.call('tasks.submit', { projectId: other.id, kind: 'build', prompt: 'x', sessionId: auth.id }), (e: unknown) => e instanceof RpcCallError && e.code === 'conflict', 'a session cannot take a task of another project');
    await assert.rejects(rpc.call('tasks.submit', { projectId: project.id, kind: 'build', prompt: 'x', sessionId: 'ses_missing' }), (e: unknown) => e instanceof RpcCallError && e.code === 'not_found');

    assert.deepEqual(await rpc.call('sessions.delete', { sessionId: auth.id }), { deleted: true });
    assert.equal((await rpc.call('tasks.get', { taskId: inAuth.id })).sessionId, null, 'the task stays, in the default stream');
    await assert.rejects(rpc.call('sessions.delete', { sessionId: auth.id }), (e: unknown) => e instanceof RpcCallError && e.code === 'not_found');
    await assert.rejects(rpc.call('sessions.create', { projectId: project.id, name: '' }), (e: unknown) => e instanceof RpcCallError && e.code === 'invalid_params');
  } finally {
    rpc.close();
    await t.cleanup();
  }
});

test('advisor: one question to Codex, with nothing in reach; asked only when the owner asks', async () => {
  const runs: { args: readonly string[]; stdin: string; tools: unknown }[] = [];
  let port = 0;
  const wrap = (docker: CommandRunner): CommandRunner => async (file, args, opts: RunOptions = {}) => {
    if (file !== 'codex') return docker(file, args, opts);
    if (args[0] === '--version') return { exitCode: 0, stdout: 'codex-cli 0.0.0-test\n', stderr: '', truncated: false, timedOut: false, durationMs: 1 };
    // What could this process call? Ask the bridge with the token it was given, the way the MCP shim would.
    const tokenFile = /SZ_BRIDGE_TOKEN_FILE="([^"]+)"/.exec(String(args.find((a) => a.startsWith('mcp_servers.studio.env='))))![1]!;
    const tools = await (await fetch(`http://127.0.0.1:${port}/v1/bridge/tools`, { headers: { authorization: `Bearer ${await readFile(tokenFile, 'utf8')}` } })).json();
    runs.push({ args, stdin: String(opts.stdin ?? ''), tools });
    await writeFile(args[args.indexOf('--output-last-message') + 1]!, 'Zustand면 충분합니다. 서버 상태가 생기면 그때 TanStack Query를 더하세요.\n');
    return { exitCode: 0, stdout: `${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 420, output_tokens: 60 } })}\n`, stderr: '', truncated: false, timedOut: false, durationMs: 5 };
  };
  const t = await testDaemon({ engines: { claudeCode: { enabled: false }, antigravity: { enabled: false } } }, {}, wrap);
  await t.daemon.start();
  port = t.port();
  const rpc = new RpcClient({ url: t.url(), token: t.daemon.clientToken.expose(), client: 'test' });
  try {
    const project = await rpc.call('projects.create', { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
    const question = '이 앱 상태 관리는 Zustand로 충분할까, 아니면 처음부터 TanStack Query를 써야 할까?';
    const reply = await rpc.call('advisor.ask', { projectId: project.id, advisor: 'codex', question });
    assert.equal(reply.advisor, 'codex');
    assert.match(reply.answer, /^Zustand면 충분합니다/);

    assert.equal(runs.length, 1, 'a single pass: one process, no follow-up round');
    const [run] = runs as [(typeof runs)[0]];
    assert.deepEqual(run.tools, { tools: [] }, 'the tool server it was pointed at offers nothing');
    assert.ok(run.args.includes('read-only') && run.args.includes('--ephemeral') && run.args.includes('--ignore-user-config'), 'the same lockdown as a task round');
    assert.equal(run.stdin, `${ADVISOR_SYSTEM_PROMPT}\n\nYou have no tools in this session: answer from what you know and from the question itself.\n\n${question}`, 'the question is the only thing that varies');

    const events = t.daemon.events.history({ projectId: project.id }, 0, 100).map((e) => e.body);
    const answered = events.find((b) => b.type === 'advisor.answered');
    assert.deepEqual(answered && { ...answered, durationMs: 0 }, { type: 'advisor.answered', advisor: 'codex', question, ok: true, answer: reply.answer, durationMs: 0 });
    assert.equal(t.daemon.store.projectTokensSince(project.id, 0), 480, 'metered against the project');

    // Gemini goes through Antigravity's CLI, which is switched off here: the owner is told, nothing is substituted.
    await assert.rejects(rpc.call('advisor.ask', { projectId: project.id, advisor: 'gemini', question }), (e: unknown) => e instanceof RpcCallError && e.code === 'unavailable' && /Gemini/.test(e.message));
    assert.equal(runs.length, 1);
    await assert.rejects(rpc.call('advisor.ask', { projectId: 'prj_missing', advisor: 'codex', question }), (e: unknown) => e instanceof RpcCallError && e.code === 'not_found');

    // An agent cannot go and ask another model on its own; neither can the harness.
    assert.equal(t.daemon.policy.evaluate({ type: 'agent', taskId: 'tsk_x' }, { kind: 'advisor.ask', projectId: project.id, advisor: 'codex' }).effect, 'deny');
    assert.equal(t.daemon.policy.evaluate({ type: 'system' }, { kind: 'advisor.ask', projectId: project.id, advisor: 'codex' }).effect, 'deny');
    assert.equal(t.daemon.policy.evaluate({ type: 'owner', via: 'telegram' }, { kind: 'advisor.ask', projectId: project.id, advisor: 'codex' }).effect, 'allow');
  } finally {
    rpc.close();
    await t.cleanup();
  }
});

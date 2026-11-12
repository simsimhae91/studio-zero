import assert from 'node:assert/strict';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { pngBlock, textBlock, writeTurn } from '../src/llm/ClaudeClient.ts';
import { SessionBrainError, parse } from '../src/llm/SessionBrain.ts';
import type { RunOptions } from '../src/util/run.ts';
import { testDaemon } from './helpers.ts';

const line = (event: unknown): string => JSON.stringify(event);
const result = (extra: object): string => line({ type: 'result', subtype: 'success', is_error: false, result: '', usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 500, output_tokens: 75 }, ...extra });
// Shapes copied from real runs of Claude Code 2.1.322.
const SEARCH_RUN = [
  line({ type: 'system', subtype: 'init', tools: ['WebSearch'], mcp_servers: [] }),
  line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'WebSearch', input: { query: 'tauri' } }] } }),
  line({ type: 'rate_limit_event' }),
  line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'Web search results…' }] }, tool_use_result: { query: 'tauri', results: [{ tool_use_id: 'srv_1', content: [{ title: 'Tauri', url: 'https://tauri.app/' }, { title: 'Tauri 2.0', url: 'https://v2.tauri.app/blog/' }] }, 'A summary the search wrote.'], durationSeconds: 2 } }),
  'not json at all',
  result({ result: 'Tauri is at tauri.app.' }),
].join('\n');

test('subscription brain: the event stream gives the answer, the usage and what each search returned', () => {
  const run = parse(SEARCH_RUN, 0, '');
  assert.equal(run.text, 'Tauri is at tauri.app.');
  assert.deepEqual(run.usage, { inputTokens: 1502, outputTokens: 75 });
  assert.deepEqual(run.searches, [[{ url: 'https://tauri.app/', title: 'Tauri' }, { url: 'https://v2.tauri.app/blog/', title: 'Tauri 2.0' }]]);
  assert.deepEqual(parse(result({ result: '{"n":2}', structured_output: { n: 2 } }), 0, '').structured, { n: 2 });

  // Failures say what the owner can do about them.
  assert.throws(() => parse(result({ is_error: true, result: 'Invalid API key · Please run /login' }), 1, ''), (err: unknown) => err instanceof SessionBrainError && /Claude Code에 로그인되어 있지 않습니다/.test(err.message));
  assert.throws(() => parse(result({ is_error: true, result: 'Claude usage limit reached. Resets at 3pm.' }), 1, ''), /사용 한도/);
  assert.throws(() => parse('', 1, 'Error: --json-schema is not a valid JSON Schema'), /결과 없이 끝났습니다 \(종료 코드 1\)\. Error: --json-schema/);
});

test('with no API key the daemon\'s own calls go to the subscription CLI as a tool-less brain; with a key they do not', async () => {
  const calls: { args: readonly string[]; stdin: string; cwd: string | undefined; env: NodeJS.ProcessEnv | undefined }[] = [];
  let answer = result({ result: '{"summary":"s","steps":["a"]}', structured_output: { summary: 's', steps: ['a'] } });
  process.env.ANTHROPIC_API_KEY = 'sk-ant-ambient-key-that-must-not-travel';
  const d = await testDaemon({ engines: { claudeCode: { enabled: true } } }, {}, (docker) => async (file, args, opts: RunOptions = {}) => {
    if (file !== 'claude') return docker(file, args, opts);
    if (args[0] === '--version') return { exitCode: 0, stdout: '2.1.322 (Claude Code)\n', stderr: '', truncated: false, timedOut: false, durationMs: 1 };
    calls.push({ args, stdin: String(opts.stdin ?? ''), cwd: opts.cwd, env: opts.env });
    return { exitCode: 0, stdout: answer, stderr: '', truncated: false, timedOut: false, durationMs: 1 };
  });
  await d.daemon.start();
  const { claude, studio, store } = d.daemon;
  const scope = { projectId: 'prj_studio', taskId: null };
  try {
    assert.equal(claude.hasApiKey(), false);
    assert.equal((await studio.status()).brain, 'session');
    assert.equal((await studio.status()).engines.find((e) => e.id === 'native-claude')!.available, false, 'the API loop still needs a key');

    const Plan = z.object({ summary: z.string(), steps: z.array(z.string()) });
    const plan = await claude.structured({ scope, model: 'claude-fable-5-2', effort: 'medium', system: 'Plan.', content: [textBlock('SECRET-PROMPT-TEXT')], schema: Plan });
    assert.deepEqual(plan, { summary: 's', steps: ['a'] });
    const call = calls[0]!;
    const flag = (name: string): string | undefined => call.args[call.args.indexOf(name) + 1];
    assert.equal(flag('--tools'), '', 'every built-in tool is off');
    assert.ok(call.args.includes('--strict-mcp-config') && !call.args.includes('--mcp-config'), 'and no MCP server is offered when the request has no tools');
    assert.equal(flag('--setting-sources'), 'project');
    assert.equal(flag('--model'), 'claude-fable-5-2');
    assert.deepEqual(JSON.parse(flag('--json-schema')!), { type: 'object', properties: { summary: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'steps'], additionalProperties: false });
    assert.equal(call.stdin, 'SECRET-PROMPT-TEXT');
    assert.ok(!call.args.join(' ').includes('SECRET-PROMPT-TEXT'), 'the prompt is on stdin, not in the argument list');
    assert.match(call.cwd!, /sz-brain-/);
    assert.deepEqual(Object.keys(call.env!).filter((k) => /KEY|TOKEN|ANTHROPIC/.test(k)), [], 'no provider credential from the daemon\'s environment reaches the CLI');
    assert.equal(store.projectTokensSince('prj_studio', 0), 1577, 'subscription tokens count against the budget');

    // Images go in as a stream-json message; a schema mismatch is still caught here.
    answer = result({ result: '', structured_output: { summary: 1 } });
    await assert.rejects(claude.structured({ scope, model: 'claude-opus-5-5', effort: 'low', system: 'Look.', content: [textBlock('what is this'), pngBlock(new Uint8Array([1, 2, 3]))], schema: Plan }));
    assert.equal(calls[1]!.args[calls[1]!.args.indexOf('--input-format') + 1], 'stream-json');
    assert.deepEqual((JSON.parse(calls[1]!.stdin) as { message: { content: { type: string }[] } }).message.content.map((c) => c.type), ['text', 'image']);

    // A multi-turn draft is restated as one prompt.
    answer = result({ result: '# 초안 2' });
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: '브리프' }, { role: 'assistant', content: '# 초안 1' }, { role: 'user', content: 'line 3: fix it' }];
    const draft = await writeTurn(claude, { scope, model: 'claude-fable-5-2', effort: 'high', system: 'Write.', messages });
    assert.equal(draft.text, '# 초안 2');
    assert.match(calls[2]!.stdin, /\[to you\]\n브리프\n\n\[from you\]\n# 초안 1\n\nThe latest message, which you are answering now:\n\nline 3: fix it$/);

    // An API key, once stored, takes over.
    await studio.vaultSet({ type: 'owner', via: 'desktop' }, 'provider/anthropic/api-key', new (await import('../src/util/core.ts')).Secret('sk-ant-api03-good'));
    assert.equal((await studio.status()).brain, 'api');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    await d.cleanup();
  }
});

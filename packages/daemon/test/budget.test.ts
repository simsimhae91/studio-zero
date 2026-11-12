import assert from 'node:assert/strict';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { sleep } from '../src/util/core.ts';
import { testDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;

/** Each model call costs 1,500 tokens. Two tool turns, then a closing message. */
function fakeModel(): Anthropic {
  const usage = { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const base = { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_details: null, stop_sequence: null, usage };
  let turn = 0;
  const content = (): unknown[] => {
    turn += 1;
    if (turn <= 2) return [{ type: 'tool_use', id: `tu_${turn}`, name: 'write_file', input: { path: `notes/${turn}.md`, content: `step ${turn}\n` } }];
    return [{ type: 'text', text: 'Wrote both notes.', citations: null }];
  };
  const structured = (system: string): unknown => {
    if (system.startsWith('You are planning')) return { summary: 'Write two notes.', steps: ['Write the notes'], auditRoutes: [], openQuestions: [] };
    if (system.startsWith('You are writing the post-mortem')) return { outcome: 'clean', rootCauses: [], lessons: [], harmfulLessonIds: [], evalSuggestions: [] };
    throw new Error(`unexpected structured call: ${system.slice(0, 40)}`);
  };
  return {
    beta: {
      messages: {
        stream: () => {
          const blocks = content();
          return { finalMessage: async () => ({ ...base, content: blocks, stop_reason: blocks.some((b) => (b as { type: string }).type === 'tool_use') ? 'tool_use' : 'end_turn' }) };
        },
        parse: async (params: Anthropic.Beta.MessageCreateParams) => ({ ...base, content: [], stop_reason: 'end_turn', parsed_output: structured(String(params.system)) }),
      },
    },
  } as unknown as Anthropic;
}

async function run(decision: 'approve' | 'deny') {
  const d = await testDaemon({}, { anthropic: fakeModel() });
  await d.daemon.start();
  const { studio, events, store } = d.daemon;
  const project = studio.createProject(OWNER, { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
  await studio.setEvalEnabled(OWNER, studio.listEvals(project.id).find((e) => e.name === 'visual-audit')!.id, false);
  // 4,000 tokens: enough for the plan and one engine turn (3,000), not for the second.
  const task = await studio.submitTask(OWNER, { projectId: project.id, kind: 'build', prompt: 'Write two notes', budgetTokens: 4000 }, 'desktop');

  let pending;
  for (let i = 0; i < 400 && !(pending = studio.listApprovals('pending')[0]); i++) await sleep(10);
  assert.ok(pending, `no approval was requested: ${events.history({ taskId: task.id }, 0, 100).map((e) => JSON.stringify(e.body)).join('\n')}`);
  const waiting = studio.getTask(task.id);
  studio.resolveApproval(pending.id, decision, 'telegram');
  for (let i = 0; i < 600 && !['succeeded', 'failed'].includes(studio.getTask(task.id).state); i++) await sleep(10);
  const trace = events.history({ taskId: task.id }, 0, 300).map((e) => e.body);
  const finished = studio.getTask(task.id);
  const decisions = store.listApprovals(undefined);
  await d.cleanup();
  return { pending, waiting, finished, trace, decisions };
}

test('a task that runs out of budget asks the owner, and continues when the extension is approved', async () => {
  const { pending, waiting, finished, trace, decisions } = await run('approve');
  assert.equal(pending.actionKind, 'task.extend-budget');
  assert.equal(pending.summary, `작업 ${finished.id}이(가) 토큰 예산을 다 썼습니다. 4,000 토큰을 더 줄까요?`);
  assert.equal(waiting.state, 'awaiting_approval', 'the task shows as waiting on the owner');
  assert.ok(waiting.spentTokens >= waiting.budgetTokens);

  assert.equal(finished.state, 'succeeded', finished.error ?? '');
  assert.equal(finished.budgetTokens, 8000, 'the budget grew by exactly the approved amount');
  assert.equal(decisions[0]!.state, 'consumed');
  assert.equal(decisions[0]!.resolvedVia, 'telegram');
  const kinds = trace.map((b) => (b.type === 'task.state' ? `state:${b.state}` : b.type === 'policy.decision' ? `policy:${b.effect}:${b.rule}` : b.type === 'approval.resolved' ? `approval:${b.state}` : b.type));
  const order = ['state:running', 'policy:deny:budget.task', 'policy:require_approval:task.extend-budget', 'approval.requested', 'state:awaiting_approval', 'approval:approved', 'state:succeeded'];
  assert.deepEqual(kinds.filter((k) => order.includes(k)), [...order.slice(0, 6), 'state:running', 'state:succeeded']);
  assert.equal(trace.filter((b) => b.type === 'tool.call').length, 2, 'the engine finished the work it had started');
});

test('a denied extension fails the task and leaves the work on its branch', async () => {
  const { finished, decisions } = await run('deny');
  assert.equal(finished.state, 'failed');
  assert.match(finished.error ?? '', /token budget exhausted \(\d+ tokens used\) and an extension was not approved/);
  assert.equal(finished.budgetTokens, 4000);
  assert.equal(decisions[0]!.state, 'denied');
});

// A task whose design review is refused by every reviewer for a usage limit does not end unjudged and does not
// fail: it is suspended with its work committed, steps out of the queue's way, and resumes at verification when
// a reviewer answers again. The engine is scripted and the checks are scripted; the harness, the queue, the
// store and the sandbox emulation are real.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import type { AuditReport, Eval, ReviewerId, Task } from '@studio-zero/protocol';
import { ConflictError } from '../src/app/errors.ts';
import type { CompilerGate } from '../src/harness/CompilerGate.ts';
import type { EvalOutcome, EvalRunner } from '../src/harness/EvalRunner.ts';
import { Harness } from '../src/harness/Harness.ts';
import type { ReflectionAgent } from '../src/harness/ReflectionAgent.ts';
import { ReviewResumer } from '../src/harness/ReviewResumer.ts';
import type { SmokeRunner } from '../src/qa/SmokeTester.ts';
import { quietLog, sampleProject, testDaemon, type TestDaemon } from './helpers.ts';

type Block = Anthropic.Beta.BetaContentBlock;
const use = (id: string, name: string, input: Record<string, unknown>): Block => ({ type: 'tool_use', id, name, input }) as Block;
const say = (text: string): Block => ({ type: 'text', text, citations: null }) as Block;

/** A scripted engine: each call to the model takes the next turn, and running out of turns fails the test. */
function scripted(turns: Block[][]): { sdk: Anthropic; sent: Anthropic.Beta.MessageCreateParams[] } {
  const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const base = { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_details: null, stop_sequence: null, usage };
  const sent: Anthropic.Beta.MessageCreateParams[] = [];
  const sdk = {
    beta: {
      messages: {
        stream: (params: Anthropic.Beta.MessageCreateParams) => {
          sent.push(structuredClone(params));
          const content = turns.shift();
          if (!content) throw new Error('the engine was called again: the script ran out of turns');
          return { finalMessage: async () => ({ ...base, content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }) };
        },
      },
    },
  } as unknown as Anthropic;
  return { sdk, sent };
}

const project = sampleProject();
const visual: Eval = { id: 'evl_visual', projectId: project.id, name: 'visual-audit', spec: { kind: 'visual', routes: ['/'], minScore: 85 }, enabled: true, originTaskId: null, createdAt: 1 };
const LIMITS = 'Codex subscription: You\'ve hit your usage limit; Claude subscription: Claude 구독의 사용 한도에 걸렸습니다.';
/** Measured clean, and every reviewer out of quota. */
const WAITING: EvalOutcome = { eval: visual, passed: false, unverified: true, waitable: true, detail: 'Design review did not run', audit: { vision: { reason: LIMITS, limited: true } } as AuditReport };
const PASSED: EvalOutcome = { eval: visual, passed: true, detail: 'score 96/100, grade S', audit: null };
const REJECTED: EvalOutcome = { eval: visual, passed: false, detail: '- [blocker] vision/stock-clipart (design review)\n  Generic clip-art detected.', audit: null };

interface Rig {
  d: TestDaemon;
  harness: Harness;
  model: ReturnType<typeof scripted>;
  reflected: () => number;
  /** Claims the next queued task the way the queue would, and runs it to wherever it stops. */
  runNext: () => Promise<Task>;
  bodies: (taskId: string) => { type: string; [key: string]: unknown }[];
}

/** A daemon whose queue is left stopped, with a harness of its own whose verification rounds are `rounds`, in order. */
async function rig(turns: Block[][], rounds: EvalOutcome[][]): Promise<Rig> {
  const model = scripted(turns);
  const d = await testDaemon({}, { anthropic: model.sdk });
  const { store, events, policy, sandboxes, provisioner, router, claude, lessons } = d.daemon;
  store.insertProject(project);
  let reflections = 0;
  const evals = {
    usesBrowser: () => false,
    runAll: async () => {
      const next = rounds.shift();
      if (!next) throw new Error('verification ran again: no more rounds were scripted');
      return next;
    },
  } as unknown as EvalRunner;
  const harness = new Harness({
    config: d.config, store, events, policy, sandboxes, provisioner, router, claude, evals, lessons,
    compiler: { run: async () => null } as unknown as CompilerGate,
    smoke: { run: async () => { throw new Error('the smoke gate is off in this rig'); } } as SmokeRunner,
    reflection: { reflect: async () => void (reflections += 1) } as unknown as ReflectionAgent,
    clock: Date.now,
    log: quietLog,
  });
  return {
    d, harness, model,
    reflected: () => reflections,
    runNext: async () => {
      const claimed = store.claimNextTask(Date.now());
      assert.ok(claimed, 'a task is queued and its project is free');
      await harness.run(claimed, new AbortController().signal);
      return store.getTask(claimed.id)!;
    },
    bodies: (taskId) => events.history({ taskId }, 0, 500).map((e) => e.body),
  };
}

const submit = (r: Rig, id: string, prompt = '홈 화면을 모바일 키트로 다시 짜줘'): Task => r.d.daemon.store.insertTask({ id, projectId: project.id, kind: 'inline_edit', prompt, origin: 'desktop', budgetTokens: 1_000_000, branch: null, track: 'full', createdAt: Date.now() });
const reviewerBack = (r: Rig, answer: () => ReviewerId | null): ReviewResumer => new ReviewResumer({ store: r.d.daemon.store, vision: { probe: async () => answer() }, queue: r.d.daemon.queue, log: quietLog });

test('every reviewer at its limit: the task is suspended with its work committed, frees its project, and resumes at verification when one answers', async () => {
  const r = await rig(
    [[use('tu_1', 'write_file', { path: 'src/Home.tsx', content: 'export const Home = () => null;\n' })], [say('홈 화면을 키트로 다시 짰습니다.')]],
    [[WAITING], [PASSED]],
  );
  try {
    const { store, sandboxes, queue } = r.d.daemon;
    submit(r, 'tsk_wait');

    // ---- first run: the engine works, everything measurable passes, nobody can review
    const suspended = await r.runNext();
    assert.deepEqual([suspended.state, suspended.phase, suspended.finishedAt, suspended.branch], ['suspended', null, null, 'sz/tsk_wait']);
    assert.equal(r.model.sent.length, 2);
    assert.equal(r.reflected(), 0, 'there is no outcome to reflect on yet');
    assert.match((await sandboxes.exec(project, 'git log --format=%s -1')).stdout, /^fix: 홈 화면을 모바일 키트로 다시 짜줘/, 'the work is committed, not parked as a wip');
    assert.equal((await sandboxes.exec(project, 'git status --porcelain')).stdout, '');
    const said = r.bodies('tsk_wait');
    assert.match(String(said.find((b) => b.type === 'notice')!.message), /^The design review is waiting on a usage limit \(Codex subscription: You've hit your usage limit; Claude subscription[\s\S]*committed on sz\/tsk_wait[\s\S]*resumes at verification by itself when a reviewer answers\.$/);
    assert.deepEqual(said.at(-1), { type: 'task.state', state: 'suspended', error: null });

    // ---- while it waits: it holds no slot, and the project is free for other work
    assert.deepEqual(store.countTasks(), { queued: 0, running: 0 });
    const other = submit(r, 'tsk_other', '다른 일');
    assert.equal(store.claimNextTask(Date.now())!.id, other.id, 'a suspended task does not block its project');
    store.updateTask(other.id, { state: 'succeeded', finishedAt: Date.now() });
    await sandboxes.checkout(project, 'main');
    assert.equal(existsSync(join(r.d.workspace, 'src/Home.tsx')), false, 'the workspace has moved on to another branch meanwhile');

    // ---- the daemon keeps asking whether a reviewer is back
    let back: ReviewerId | null = null;
    const resumer = reviewerBack(r, () => back);
    assert.deepEqual(await resumer.tick(), []);
    assert.equal(store.getTask('tsk_wait')!.state, 'suspended');
    back = 'claude-code';
    assert.deepEqual(await resumer.tick(), ['tsk_wait']);
    assert.equal(store.getTask('tsk_wait')!.state, 'queued');
    assert.deepEqual(await resumer.tick(), [], 'a task is resumed once');

    // ---- second run: no planning, no engine, straight to the verdict on the same branch
    const done = await r.runNext();
    assert.equal(done.state, 'succeeded');
    assert.equal(r.model.sent.length, 2, 'the engine was not asked to do the work again');
    assert.equal(done.summary, '홈 화면을 키트로 다시 짰습니다.', 'what the engine said the first time is the summary');
    assert.equal((await sandboxes.exec(project, 'git rev-parse --abbrev-ref HEAD')).stdout.trim(), 'sz/tsk_wait');
    assert.ok(existsSync(join(r.d.workspace, 'src/Home.tsx')));
    assert.equal(r.reflected(), 1);
    const after = r.bodies('tsk_wait').slice(said.length);
    assert.deepEqual(after.filter((b) => b.type === 'task.phase').map((b) => b.phase), ['verify', 'reflect'], 'verification is the only phase a resumed task goes through');
    assert.equal(after.some((b) => b.type === 'route.decided' || b.type === 'checkpoint.created'), false);

    // A finished task is not resumable, by the daemon or by hand.
    assert.equal(queue.resume('tsk_wait'), false);
    assert.throws(() => r.d.daemon.studio.resumeTask('tsk_wait'), ConflictError);
  } finally {
    await r.d.cleanup();
  }
});

test('a resumed task that the reviewer then rejects goes back to its engine, which is opened only now', async () => {
  const r = await rig(
    [
      [use('tu_1', 'write_file', { path: 'src/Home.tsx', content: 'export const Home = () => "parcel.png";\n' })],
      [say('첫 화면을 만들었습니다.')],
      [use('tu_2', 'write_file', { path: 'src/Home.tsx', content: 'export const Home = () => "InteractiveDropzone";\n' })],
      [say('상자 그림을 뷰파인더로 바꿨습니다.')],
    ],
    [[WAITING], [REJECTED], [PASSED]],
  );
  try {
    submit(r, 'tsk_fix');
    assert.equal((await r.runNext()).state, 'suspended');
    assert.equal(r.d.daemon.studio.resumeTask('tsk_fix').state, 'queued', 'the owner can also resume it by hand');

    const done = await r.runNext();
    assert.equal(done.state, 'succeeded');
    assert.equal(done.summary, '상자 그림을 뷰파인더로 바꿨습니다.');
    assert.equal(r.model.sent.length, 4);
    const repair = r.model.sent[2]!.messages;
    assert.equal(repair.length, 1, 'a fresh engine session: the first one ended when the task was suspended');
    assert.match(String(repair[0]!.content), /did not pass[\s\S]*vision\/stock-clipart[\s\S]*Generic clip-art detected/);
    assert.match((await r.d.daemon.sandboxes.exec(project, 'git log --format=%s -2')).stdout, /^fix: 홈 화면을[^\n]*\nfix: 홈 화면을/, 'the repair is a second commit on the same branch');
  } finally {
    await r.d.cleanup();
  }
});

test('a suspended task can be cancelled, and is then left alone', async () => {
  const r = await rig([[say('만들었습니다.')]], [[WAITING]]);
  try {
    const { store, queue } = r.d.daemon;
    submit(r, 'tsk_drop');
    assert.equal((await r.runNext()).state, 'suspended');
    assert.equal(queue.cancel('tsk_drop'), true);
    assert.deepEqual([store.getTask('tsk_drop')!.state, store.getTask('tsk_drop')!.error], ['cancelled', 'cancelled by the owner']);
    assert.deepEqual(await reviewerBack(r, () => 'codex').tick(), []);
    assert.equal(store.getTask('tsk_drop')!.state, 'cancelled');
  } finally {
    await r.d.cleanup();
  }
});

test('unreviewed for a reason that waiting does not fix: the task ends, and its summary says what was not verified', async () => {
  const noReviewer: EvalOutcome = { eval: visual, passed: false, unverified: true, detail: 'Design review did not run', audit: { vision: { reason: 'the design review is switched off (audit.vision in config.json)', limited: false } } as AuditReport };
  const r = await rig([[say('만들었습니다.')]], [[noReviewer]]);
  try {
    submit(r, 'tsk_off');
    const done = await r.runNext();
    assert.equal(done.state, 'succeeded');
    assert.equal(done.summary, '만들었습니다.\n\nNot verified: visual-audit: the design review did not run (the design review is switched off (audit.vision in config.json)), so the design is not vouched for');
    assert.equal(r.d.daemon.store.listSuspendedTasks().length, 0);
  } finally {
    await r.d.cleanup();
  }
});

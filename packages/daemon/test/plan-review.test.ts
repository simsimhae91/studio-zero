// The owner's look at a plan before any code, for a task submitted with `reviewPlan`: the task stops after the
// plan's cross-review, the plan is stored as a hashed version, and only the owner's verdict on that exact version
// moves it on. The engine, the planner and the reviewer are scripted; the harness, the gate, the store, the
// policy engine, git and the sandbox emulation are real.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import type { Eval, EventEnvelope, Task } from '@studio-zero/protocol';
import { ConflictError } from '../src/app/errors.ts';
import type { BuildMeter } from '../src/harness/BuildMeter.ts';
import type { CompilerGate } from '../src/harness/CompilerGate.ts';
import type { EvalOutcome, EvalRunner } from '../src/harness/EvalRunner.ts';
import { Harness, ShutdownSignal } from '../src/harness/Harness.ts';
import { hashPlan, renderPlanMarkdown } from '../src/harness/PlanGate.ts';
import { PLAN_REVISION_BRIEF, PLANNER_SYSTEM_PROMPT } from '../src/harness/prompts.ts';
import type { ReflectionAgent } from '../src/harness/ReflectionAgent.ts';
import { PLAN_REDTEAM_PROMPT, SandwichReviewer, type Acceptance, type PlanCritique } from '../src/harness/SandwichReviewer.ts';
import type { ReviewDesk } from '../src/llm/ReviewDesk.ts';
import { PolicyDeniedError } from '../src/policy/PolicyEngine.ts';
import type { RefKit } from '../src/qa/RefKit.ts';
import type { SmokeRunner } from '../src/qa/SmokeTester.ts';
import { RelayCore, type OutMessage } from '../src/relay/RelayCore.ts';
import { quietLog, sampleProject, testDaemon, type TestDaemon } from './helpers.ts';

type Block = Anthropic.Beta.BetaContentBlock;
const say = (text: string): Block => ({ type: 'text', text, citations: null }) as Block;
const OWNER = { type: 'owner', via: 'desktop' } as const;

interface Planned {
  system: unknown;
  messages: Anthropic.Beta.MessageCreateParams['messages'];
}

function scripted(turns: Block[][], plans: unknown[]): { sdk: Anthropic; sent: Anthropic.Beta.MessageCreateParams[]; planned: Planned[] } {
  const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const base = { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_details: null, stop_sequence: null, usage };
  const sent: Anthropic.Beta.MessageCreateParams[] = [];
  const planned: Planned[] = [];
  const sdk = {
    beta: {
      messages: {
        stream: (params: Anthropic.Beta.MessageCreateParams) => {
          sent.push(structuredClone(params));
          const content = turns.shift();
          if (!content) throw new Error('the engine was called again: the script ran out of turns');
          return { finalMessage: async () => ({ ...base, content, stop_reason: 'end_turn' }) };
        },
        parse: async (params: Anthropic.Beta.MessageCreateParams) => {
          planned.push({ system: structuredClone(params.system), messages: structuredClone(params.messages) });
          const plan = plans.shift();
          if (plan === undefined) throw new Error('the planner was called again');
          return { ...base, content: [], stop_reason: 'end_turn', parsed_output: plan };
        },
      },
    },
  } as unknown as Anthropic;
  return { sdk, sent, planned };
}

const project = sampleProject('harbor');
const tests: Eval = { id: 'evl_tests', projectId: project.id, name: 'unit-tests', spec: { kind: 'command', command: 'npm test', timeoutSec: 60 }, enabled: true, originTaskId: null, createdAt: 1 };
const PASSED: EvalOutcome[] = [{ eval: tests, passed: true, detail: 'exit 0', audit: null }];
const CRITIQUE: PlanCritique = { verdict: '표가 화면의 주인이라 오늘 들어오는 배가 묻힙니다.', defaults: [], gaps: ['입항 시각이 바뀐 예약이 계획에 없습니다.'], blandness: [] };
const ACCEPTED: Acceptance = { verdict: 'pass', summary: '요청대로입니다.', unmet: [], copy: [], patch: null };
const PLAN_1 = { summary: '정박지 예약을 표 한 장으로 보여 준다.', steps: ['정박지 × 날짜 표 구성', '빈 상태 문구 작성'], auditRoutes: ['/'], openQuestions: [], anchor: null, screens: null };
const PLAN_2 = { summary: '오늘 들어오는 배를 맨 위에, 그 아래에 예약 표를 둔다.', steps: ['오늘 입항 목록 구성', '정박지 × 날짜 표 구성', '빈 상태 문구 작성'], auditRoutes: ['/'], openQuestions: [], anchor: null, screens: null };

interface Rig {
  d: TestDaemon;
  model: ReturnType<typeof scripted>;
  harness: Harness;
  submit: (reviewPlan?: boolean) => Promise<Task>;
  /** Claims the next queued task and starts it; resolves when its run returns. */
  start: (signal?: AbortSignal) => Promise<{ task: Task; done: Promise<void> }>;
  bodies: (taskId: string) => EventEnvelope['body'][];
}

/** A harness of its own over a real daemon (whose plan gate it shares), with its checks and reviewers scripted. */
async function rig(p: { turns: Block[][]; plans: unknown[]; rounds: EvalOutcome[][]; planReview?: { timeoutHours?: number; maxRevisions?: number } }): Promise<Rig> {
  const model = scripted(p.turns, p.plans);
  const d = await testDaemon({ planReview: p.planReview ?? {} }, { anthropic: model.sdk });
  const { store, events, policy, sandboxes, provisioner, router, claude, lessons, ledger, planGate } = d.daemon;
  store.insertProject(project);
  const desk = {
    hasApiKey: () => false,
    ask: async (_path: string, req: { system: string }) => (req.system === PLAN_REDTEAM_PROMPT ? CRITIQUE : ACCEPTED),
  } as unknown as ReviewDesk;
  const harness = new Harness({
    config: d.config, store, events, policy, sandboxes, provisioner, router, claude, lessons, ledger, planGate,
    evals: { usesBrowser: () => false, runAll: async () => p.rounds.shift() ?? assert.fail('verification ran again: no more rounds were scripted') } as unknown as EvalRunner,
    compiler: { run: async () => null } as unknown as CompilerGate,
    smoke: { run: async () => ({ passed: true, routes: ['/'], issues: [], detail: 'loaded', durationMs: 5 }) } as unknown as SmokeRunner,
    reflection: { reflect: async () => undefined } as unknown as ReflectionAgent,
    refkit: { capture: async () => [] } as unknown as RefKit,
    reviewer: new SandwichReviewer({ desk, router: { pairReviewer: async () => ({ reviewer: 'codex', considered: [] }) }, events, log: quietLog }),
    build: { run: async () => null } as unknown as BuildMeter,
    clock: Date.now,
    log: quietLog,
  });
  return {
    d, model, harness,
    submit: (reviewPlan) => d.daemon.studio.submitTask(OWNER, { projectId: project.id, kind: 'build', prompt: '정박지 예약 현황판을 만들어줘', ...(reviewPlan === undefined ? {} : { reviewPlan }) }, 'desktop'),
    start: async (signal = new AbortController().signal) => {
      const claimed = store.claimNextTask(Date.now());
      assert.ok(claimed, 'a task is queued and its project is free');
      return { task: claimed, done: harness.run(claimed, signal) };
    },
    bodies: (taskId) => events.history({ taskId }, 0, 1000).map((e) => e.body),
  };
}

async function until(what: string, check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) assert.fail(`timed out waiting until ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const waitingAt = (r: Rig, taskId: string, version: number): Promise<void> =>
  until(`version ${version} waits`, () => r.d.daemon.store.getTask(taskId)?.state === 'awaiting_plan_review' && r.d.daemon.planGate.latest(taskId)?.version === version && r.d.daemon.planGate.latest(taskId)?.verdict === null);
const lastUser = (params: Anthropic.Beta.MessageCreateParams): string => String(params.messages.at(-1)!.content);

test('without reviewPlan nothing waits: the task goes from its plan straight to the engine', async () => {
  const r = await rig({ plans: [PLAN_1], turns: [[say('현황판을 만들었습니다.')]], rounds: [PASSED] });
  try {
    const submitted = await r.submit();
    assert.equal(submitted.reviewPlan, false, 'the daemon default is off');
    const { task, done } = await r.start();
    await done;
    assert.equal(r.d.daemon.store.getTask(task.id)!.state, 'succeeded');
    const bodies = r.bodies(task.id);
    assert.equal(bodies.some((b) => b.type === 'plan.review_requested' || b.type === 'plan.review_resolved'), false);
    assert.equal(bodies.some((b) => b.type === 'task.state' && b.state === 'awaiting_plan_review'), false);
    assert.deepEqual(r.d.daemon.studio.listPlanVersions(task.id), { versions: [], revisionsLeft: 3 });
  } finally {
    await r.d.cleanup();
  }
});

test('approved: the engine starts only on the owner\'s word, on the version they approved; a wrong hash or an agent is refused', async () => {
  const r = await rig({ plans: [PLAN_1], turns: [[say('현황판을 만들었습니다.')]], rounds: [PASSED] });
  try {
    const { studio, store } = r.d.daemon;
    assert.equal((await r.submit(true)).reviewPlan, true);
    const { task, done } = await r.start();
    await waitingAt(r, task.id, 1);
    assert.equal(r.model.sent.length, 0, 'no engine turn before the plan is approved');
    assert.equal(store.countTasks().running, 1, 'the waiting task holds its slot');

    const [v1] = studio.listPlanVersions(task.id).versions;
    assert.ok(v1);
    assert.equal(v1.planMarkdown, renderPlanMarkdown(PLAN_1));
    assert.equal(v1.sha256, hashPlan(v1.planMarkdown));
    assert.match(v1.reviewerNotes ?? '', /^표가 화면의 주인이라[\s\S]*Gaps:\n- 입항 시각이/, 'the cross-reviewer\'s notes are kept with the version');
    const requested = r.bodies(task.id).filter((b) => b.type === 'plan.review_requested');
    assert.deepEqual(requested, [{ type: 'plan.review_requested', version: 1, planHash: v1.sha256 }]);

    await assert.rejects(studio.resolvePlanReview(OWNER, { taskId: task.id, version: 1, planHash: '0'.repeat(64), verdict: 'approve' }), ConflictError, 'a hash that is not the waiting plan\'s');
    await assert.rejects(studio.resolvePlanReview(OWNER, { taskId: task.id, version: 2, planHash: v1.sha256, verdict: 'approve' }), ConflictError, 'a version that does not exist');
    await assert.rejects(studio.resolvePlanReview({ type: 'agent', taskId: task.id }, { taskId: task.id, version: 1, planHash: v1.sha256, verdict: 'approve' }), PolicyDeniedError);
    await assert.rejects(studio.resolvePlanReview({ type: 'system' }, { taskId: task.id, version: 1, planHash: v1.sha256, verdict: 'approve' }), PolicyDeniedError);
    await assert.rejects(studio.resolvePlanReview(OWNER, { taskId: task.id, version: 1, planHash: v1.sha256, verdict: 'changes', feedback: [] }), ConflictError, 'changes without a note');
    assert.equal(store.getTask(task.id)!.state, 'awaiting_plan_review', 'refusals leave the task waiting');
    assert.equal(r.model.sent.length, 0);

    const resolved = await studio.resolvePlanReview(OWNER, { taskId: task.id, version: 1, planHash: v1.sha256, verdict: 'approve' });
    assert.equal(resolved.verdict, 'approve');
    await done;
    assert.equal(store.getTask(task.id)!.state, 'succeeded');
    assert.match(lastUser(r.model.sent[0]!), /Plan drafted for this request[^\n]*\n정박지 예약을 표 한 장으로 보여 준다\.\n1\. 정박지 × 날짜 표 구성\n2\. 빈 상태 문구 작성/);
    await assert.rejects(studio.resolvePlanReview(OWNER, { taskId: task.id, version: 1, planHash: v1.sha256, verdict: 'approve' }), ConflictError, 'a finished task takes no verdict');
  } finally {
    await r.d.cleanup();
  }
});

test('changes: the plan is drafted again with the owner\'s notes in the user turn, cross-reviewed again and shown as version 2; the cap holds', async () => {
  const r = await rig({ plans: [PLAN_1, PLAN_2], turns: [[say('목록과 표를 만들었습니다.')]], rounds: [PASSED], planReview: { maxRevisions: 1 } });
  try {
    const { studio } = r.d.daemon;
    await r.submit(true);
    const { task, done } = await r.start();
    await waitingAt(r, task.id, 1);
    const v1 = studio.listPlanVersions(task.id).versions[0]!;
    await studio.resolvePlanReview(OWNER, { taskId: task.id, version: 1, planHash: v1.sha256, verdict: 'changes', feedback: [{ quote: '정박지 × 날짜 표 구성', comment: '오늘 들어오는 배 목록이 표보다 먼저입니다.' }] });
    await waitingAt(r, task.id, 2);

    assert.equal(r.model.planned.length, 2);
    const [first, second] = r.model.planned;
    assert.deepEqual(second!.system, first!.system, 'the system prompt is the same constant');
    assert.ok(JSON.stringify(first!.system).includes(PLANNER_SYSTEM_PROMPT.slice(0, 80)));
    assert.equal(JSON.stringify(second!.system).includes('오늘 들어오는 배'), false, 'the owner\'s note is not in the system prompt');
    const turn = JSON.stringify(second!.messages);
    assert.ok(turn.includes(JSON.stringify(PLAN_REVISION_BRIEF).slice(1, -1)));
    assert.match(turn, /The plan you drafted before:[\s\S]*정박지 예약을 표 한 장으로 보여 준다/);
    assert.match(turn, /About this passage of the plan:[\s\S]*정박지 × 날짜 표 구성[\s\S]*오늘 들어오는 배 목록이 표보다 먼저입니다\./);

    const versions = studio.listPlanVersions(task.id);
    assert.deepEqual(versions.versions.map((v) => [v.version, v.verdict]), [[1, 'changes'], [2, null]]);
    assert.deepEqual(versions.versions[0]!.feedback, [{ quote: '정박지 × 날짜 표 구성', comment: '오늘 들어오는 배 목록이 표보다 먼저입니다.' }]);
    assert.equal(versions.versions[1]!.planMarkdown, renderPlanMarkdown(PLAN_2));
    assert.ok(versions.versions[1]!.reviewerNotes, 'version 2 was cross-reviewed again');
    assert.equal(versions.revisionsLeft, 0);
    assert.equal(r.model.sent.length, 0, 'still no engine turn');

    const v2 = versions.versions[1]!;
    await assert.rejects(studio.resolvePlanReview(OWNER, { taskId: task.id, version: 1, planHash: v1.sha256, verdict: 'approve' }), ConflictError, 'the version sent back cannot be approved now');
    await assert.rejects(studio.resolvePlanReview(OWNER, { taskId: task.id, version: 2, planHash: v2.sha256, verdict: 'changes', feedback: [{ comment: '하나 더' }] }), /1번까지/);
    await studio.resolvePlanReview(OWNER, { taskId: task.id, version: 2, planHash: v2.sha256, verdict: 'approve' });
    await done;
    assert.equal(r.d.daemon.store.getTask(task.id)!.state, 'succeeded');
    assert.match(lastUser(r.model.sent[0]!), /\n1\. 오늘 입항 목록 구성\n2\. 정박지 × 날짜 표 구성/, 'the engine builds to the approved version');
  } finally {
    await r.d.cleanup();
  }
});

test('no answer by the deadline: the task stops before any code, its versions kept', async () => {
  const r = await rig({ plans: [PLAN_1], turns: [], rounds: [], planReview: { timeoutHours: 0.0002 } });
  try {
    await r.submit(true);
    const { task, done } = await r.start();
    await done;
    const stopped = r.d.daemon.store.getTask(task.id)!;
    assert.equal(stopped.state, 'cancelled');
    assert.match(stopped.error ?? '', /^계획 1번째 안을 0\.0002시간 기다렸지만 답이 없어 작업을 멈췄습니다\./);
    assert.equal(r.model.sent.length, 0, 'the engine never ran');
    assert.equal(r.d.daemon.studio.listPlanVersions(task.id).versions.length, 1);
    assert.ok(r.bodies(task.id).some((b) => b.type === 'plan.review_resolved' && b.outcome === 'timeout'));
    assert.equal(r.d.daemon.studio.listLedger(project.id, 5).length, 0, 'a plan nobody answered leaves no receipt');
  } finally {
    await r.d.cleanup();
  }
});

test('a restart while the plan waits goes back to the same version: no second plan, no new version, and the retry is not spent', async () => {
  const r = await rig({ plans: [PLAN_1], turns: [[say('현황판을 만들었습니다.')]], rounds: [PASSED] });
  try {
    const { store, studio } = r.d.daemon;
    const { id } = await r.submit(true);
    for (let boot = 0; boot < 3; boot++) {
      const daemon = new AbortController();
      const run = await r.start(daemon.signal);
      await waitingAt(r, id, 1);
      daemon.abort(new ShutdownSignal());
      await run.done;
      assert.equal(store.getTask(id)!.state, 'awaiting_plan_review', 'a shutdown is not a verdict');
      // The next boot queues it again without counting it as a crash, however often it happens.
      assert.deepEqual(store.recoverInterruptedTasks(Date.now(), 2), { requeued: [id], failed: [] });
      assert.equal(store.getTask(id)!.state, 'queued');
    }
    assert.equal(r.model.planned.length, 1, 'planned once');
    const [v1, ...more] = studio.listPlanVersions(id).versions;
    assert.equal(more.length, 0, 'no new version');
    assert.equal(r.bodies(id).filter((b) => b.type === 'plan.review_requested').length, 1, 'the owner is asked once');

    // An answer given while the task is on its way back is kept, and found when it arrives.
    await studio.resolvePlanReview(OWNER, { taskId: id, version: 1, planHash: v1!.sha256, verdict: 'approve' });
    const last = await r.start();
    await last.done;
    assert.equal(store.getTask(id)!.state, 'succeeded');
    assert.equal(r.model.planned.length, 1);
    assert.match(lastUser(r.model.sent[0]!), /\n1\. 정박지 × 날짜 표 구성/, 'built from the stored plan');
    assert.match(lastUser(r.model.sent[0]!), /red-teamed the plan[\s\S]*입항 시각이 바뀐 예약이 계획에 없습니다/, 'with the critique stored beside it');
  } finally {
    await r.d.cleanup();
  }
});

test('on a messenger: the plan with its buttons, a change request as the next message, a stale tap refused, then approval', async () => {
  const r = await rig({ plans: [PLAN_1, PLAN_2], turns: [[say('목록과 표를 만들었습니다.')]], rounds: [PASSED] });
  const sent: OutMessage[] = [];
  const relay = new RelayCore({ channel: 'telegram', studio: r.d.daemon.studio, store: r.d.daemon.store, events: r.d.daemon.events, send: (_chat, message) => void sent.push(message), owners: () => ['chat_1'] });
  relay.start();
  try {
    const text = (m: OutMessage): string => m.lines.map((line) => line.map((part) => (typeof part === 'string' ? part : part.text)).join('')).join('\n');
    const plans = (): OutMessage[] => sent.filter((m) => m.buttons?.flat().some((b) => b.action.startsWith('k:')));
    const { id } = await r.submit(true);
    const { done } = await r.start();
    await waitingAt(r, id, 1);
    await until('the plan reaches the chat', () => plans().length === 1);
    const first = plans()[0]!;
    assert.match(text(first), /계획 1번째 안[\s\S]*정박지 예약을 표 한 장으로 보여 준다\.\n단계 2개/);
    const [approve1, change1] = first.buttons![0]!;
    assert.deepEqual([approve1!.label, change1!.label], ['승인', '수정 요청']);
    assert.ok(approve1!.action.length <= 64 && change1!.action.length <= 64, 'a button fits Telegram\'s 64 bytes');

    assert.deepEqual(await relay.action('chat_1', change1!.action), { reply: '고칠 내용을 메시지 하나로 보내 주세요.', spent: false });
    await relay.text('chat_1', '오늘 들어오는 배 목록이 먼저입니다.');
    await waitingAt(r, id, 2);
    assert.equal(r.d.daemon.store.listTasks(project.id, 10).length, 1, 'the reply became a note on the plan, not a new task');
    assert.deepEqual(r.d.daemon.studio.listPlanVersions(id).versions[0]!.feedback, [{ comment: '오늘 들어오는 배 목록이 먼저입니다.' }]);

    await until('version 2 reaches the chat', () => plans().length === 2);
    assert.match(text(plans()[1]!), /계획 2번째 안[\s\S]*단계 3개\n\+ 오늘 입항 목록 구성/, 'what changed in the steps');
    const stale = await relay.action('chat_1', approve1!.action);
    assert.equal(stale.spent, false);
    assert.match(stale.reply, /^실패: 계획이 바뀌었습니다/);

    assert.deepEqual(await relay.action('chat_1', plans()[1]!.buttons![0]![0]!.action), { reply: '계획을 승인했습니다. 구현을 시작합니다.', spent: true });
    await done;
    assert.equal(r.d.daemon.store.getTask(id)!.state, 'succeeded');
  } finally {
    relay.stop();
    await r.d.cleanup();
  }
});

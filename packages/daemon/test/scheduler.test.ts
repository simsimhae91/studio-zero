// Work the studio starts or resumes by itself: a task parked on a subscription's usage limit until the reset time
// the vendor named, and the owner's schedules. The engine is scripted; the harness, the queue, the store, the
// policy engine and the sandbox emulation are real, and time is a clock the test moves.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Schedule, Task } from '@studio-zero/protocol';
import { ConflictError, NotFoundError } from '../src/app/errors.ts';
import { classifyQuotaFailure } from '../src/app/QuotaTracker.ts';
import { Scheduler, nextSlot } from '../src/app/Scheduler.ts';
import type { Studio } from '../src/app/Studio.ts';
import type { ConfigSchema } from '../src/config.ts';
import type { BuildMeter } from '../src/harness/BuildMeter.ts';
import type { CompilerGate } from '../src/harness/CompilerGate.ts';
import type { EvalRunner } from '../src/harness/EvalRunner.ts';
import { EngineError, type Engine, type EngineResult } from '../src/harness/engines/Engine.ts';
import { Harness } from '../src/harness/Harness.ts';
import type { ReflectionAgent } from '../src/harness/ReflectionAgent.ts';
import type { ModelRouter } from '../src/llm/ModelRouter.ts';
import type { Actor } from '../src/policy/actions.ts';
import { PolicyDeniedError } from '../src/policy/PolicyEngine.ts';
import { SessionBrainError } from '../src/llm/SessionBrain.ts';
import type { SmokeRunner } from '../src/qa/SmokeTester.ts';
import { TaskQueue } from '../src/queue/TaskQueue.ts';
import { RelayCore, renderPlain, type OutMessage } from '../src/relay/RelayCore.ts';
import { quietLog, sampleProject, testDaemon, type TestDaemon } from './helpers.ts';
import type { z } from 'zod';

const OWNER: Actor = { type: 'owner', via: 'desktop' };
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const project = sampleProject();

/** What Codex says when the subscription is spent, with the wait it names. */
const codexLimit = (wait: string): EngineError => new EngineError(`codex exited 1: ERROR: You've hit your usage limit. Upgrade to Pro or try again in ${wait}.`);

interface Rig {
  d: TestDaemon;
  queue: TaskQueue;
  clock: { now: number };
  /** Each turn the engine is sent takes the next of these: an answer, an error it throws, or what it does first. */
  turns: (EngineResult | Error | (() => Promise<EngineResult>))[];
  sent: () => number;
  /** What the engine was sent, turn by turn. */
  messages: () => string[];
  bodies: (taskId: string) => { type: string; [key: string]: unknown }[];
  /** Waits until the task is out of `queued` and `running`. */
  settled: (taskId: string) => Promise<Task>;
}

async function rig(config: z.input<typeof ConfigSchema> = {}): Promise<Rig> {
  const d = await testDaemon(config);
  const { store, events, policy, sandboxes, provisioner, claude, lessons, refkit, reviewer, ledger } = d.daemon;
  store.insertProject(project);
  const clock = { now: Date.parse('2026-11-14T09:00:00') };
  const turns: Rig['turns'] = [];
  const messages: string[] = [];
  let sent = 0;
  const engine = {
    id: 'codex',
    efforts: ['high'],
    open: async () => ({
      send: async (content: string) => {
        sent += 1;
        messages.push(content);
        const next = turns.shift();
        if (!next) throw new Error('the engine was sent another turn: the script ran out');
        if (next instanceof Error) throw next;
        return typeof next === 'function' ? next() : next;
      },
      close: async () => undefined,
    }),
  } as unknown as Engine;
  const router = { route: async () => ({ engine, candidate: { engine: 'codex', model: 'default', effort: 'high' }, considered: [] }) } as unknown as ModelRouter;
  const harness = new Harness({
    config: d.config, store, events, policy, sandboxes, provisioner, router, claude, lessons, refkit, reviewer, ledger,
    evals: { usesBrowser: () => false, runAll: async () => [] } as unknown as EvalRunner,
    compiler: { run: async () => null } as unknown as CompilerGate,
    smoke: { run: async () => { throw new Error('the smoke gate is off in this rig'); } } as SmokeRunner,
    reflection: { reflect: async () => undefined } as unknown as ReflectionAgent,
    build: { run: async () => null } as unknown as BuildMeter,
    clock: () => clock.now,
    log: quietLog,
  });
  const queue = new TaskQueue({ store, events, execute: (task, signal) => harness.run(task, signal), clock: () => clock.now, log: quietLog });
  const settled = async (taskId: string): Promise<Task> => {
    for (let i = 0; i < 1000; i++) {
      const task = store.getTask(taskId)!;
      if (task.state !== 'queued' && task.state !== 'running') return task;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`task ${taskId} did not settle`);
  };
  return { d, queue, clock, turns, sent: () => sent, messages: () => messages, bodies: (taskId) => events.history({ taskId }, 0, 500).map((e) => e.body), settled };
}

const submit = (r: Rig, id: string): Task => r.d.daemon.store.insertTask({ id, projectId: project.id, kind: 'inline_edit', prompt: '목록 정렬을 날짜순으로 바꿔줘', origin: 'desktop', budgetTokens: 1_000_000, branch: null, createdAt: r.clock.now });
const done: EngineResult = { finalText: '정렬을 바꿨습니다.', stopped: 'completed' };

describe('quota park', () => {
  test('the classifier answers only for a usage limit that names its reset time', () => {
    const now = Date.parse('2026-11-14T09:00:00');
    assert.deepEqual(classifyQuotaFailure({ engine: 'codex', error: codexLimit('2h 30m') }, now), { subscription: 'codex', resetAt: now + 2.5 * HOUR });
    // Claude Code names a clock time; a refusal through the session brain is the Claude subscription's whatever the engine.
    assert.deepEqual(classifyQuotaFailure({ engine: 'native-claude', error: new SessionBrainError("Claude 구독의 사용 한도에 걸렸습니다. You've hit your limit · resets 3pm") }, now), { subscription: 'claude-code', resetAt: Date.parse('2026-11-14T15:00:00') });
    assert.equal(classifyQuotaFailure({ engine: 'codex', error: new EngineError("codex exited 1: You've hit your usage limit.") }, now), null, 'a limit with no reset time');
    assert.equal(classifyQuotaFailure({ engine: 'codex', error: new EngineError('codex exited 1: rate limit exceeded, try again in 20 seconds') }, now), null, 'a rate limit is a busy server, not a spent subscription');
    assert.equal(classifyQuotaFailure({ engine: 'codex', error: new EngineError('429 Too Many Requests: overloaded, retry after 5m') }, now), null);
    assert.equal(classifyQuotaFailure({ engine: 'native-claude', error: new Error('usage limit reached, try again in 1h') }, now), null, 'the API is not a subscription');
    assert.equal(classifyQuotaFailure({ engine: 'codex', error: new EngineError('codex exited 1: usage limit reached, resets at 25:00') }, now), null, 'a time that is no time');
    assert.equal(classifyQuotaFailure({ engine: 'codex', error: new EngineError('codex exited 2: cannot parse the configuration') }, now), null);
  });

  test('a usage limit with a reset time parks the task, frees its project, and runs it once more after the reset', async () => {
    const r = await rig();
    try {
      const { store } = r.d.daemon;
      r.turns.push(codexLimit('2h 30m'), done);
      submit(r, 'tsk_wait');
      r.queue.start();

      const parked = await r.settled('tsk_wait');
      assert.deepEqual([parked.state, parked.parkCount, parked.parkedUntil, parked.finishedAt, parked.error], ['parked', 1, r.clock.now + 2.5 * HOUR, null, null]);
      const said = r.bodies('tsk_wait');
      assert.deepEqual(said.find((b) => b.type === 'task.parked'), { type: 'task.parked', subscription: 'codex', resumeAt: r.clock.now + 2.5 * HOUR, parkCount: 1 });
      assert.deepEqual(said.at(-1), { type: 'task.state', state: 'parked', error: null });
      assert.equal(store.listLedgerEntries(project.id, 10).length, 0, 'no verdict, so no receipt');
      assert.deepEqual(store.countTasks(), { queued: 0, running: 0 }, 'it holds no slot');
      assert.equal(store.busyProjectIds().has(project.id), false);

      // Not before its time.
      r.clock.now += 2 * HOUR;
      assert.deepEqual(r.queue.wakeDue(), []);
      assert.equal(store.getTask('tsk_wait')!.state, 'parked');

      r.clock.now += 31 * MIN;
      assert.deepEqual(r.queue.wakeDue(), ['tsk_wait']);
      assert.deepEqual(r.queue.wakeDue(), [], 'woken once');
      const finished = await r.settled('tsk_wait');
      assert.equal(finished.state, 'succeeded');
      assert.equal(finished.summary, '정렬을 바꿨습니다.');
      assert.deepEqual([finished.parkCount, finished.parkedUntil], [1, null]);
      assert.equal(r.sent(), 2);
      assert.equal(store.listLedgerEntries(project.id, 10).length, 1, 'the run that finished leaves its receipt like any other');
    } finally {
      await r.queue.stop();
      await r.d.cleanup();
    }
  });

  test('a woken task goes on from the work it committed when it stopped, and is told that it is there', async () => {
    const r = await rig();
    try {
      const { sandboxes, store } = r.d.daemon;
      await r.d.daemon.provisioner.ensure(project);
      // The first run writes half the work, then the subscription refuses it.
      r.turns.push(async () => {
        await sandboxes.writeFile(project, 'src/sort.ts', 'export const byDate = true;\n');
        throw codexLimit('1h');
      });
      // The second run finds that file where the first left it.
      r.turns.push(async () => {
        assert.equal((await sandboxes.readFile(project, 'src/sort.ts')).content, 'export const byDate = true;\n', 'the work from before the limit is in the workspace');
        await sandboxes.writeFile(project, 'src/list.ts', 'export const sorted = true;\n');
        return done;
      });
      submit(r, 'tsk_goon');
      r.queue.start();
      assert.equal((await r.settled('tsk_goon')).state, 'parked');
      assert.equal((await sandboxes.exec(project, 'git rev-parse --abbrev-ref HEAD && git log --format=%s -n 1 sz/tsk_goon')).stdout, 'main\nwip: tsk_goon (waiting for a usage limit to reset)\n', 'parked: the project is back on its own branch, the work committed on the task\'s');

      r.clock.now += HOUR + MIN;
      r.queue.wakeDue();
      const finished = await r.settled('tsk_goon');
      assert.equal(finished.state, 'succeeded', finished.error ?? '');
      const [first, second] = r.messages();
      assert.ok(!first!.includes('stopped part-way'), 'a first run is told nothing of the kind');
      assert.match(second!, /The owner's request:\n목록 정렬을 날짜순으로 바꿔줘\n\nThis task was stopped part-way: the subscription it runs on reached its usage limit\.[^\n]*Read what is there first, then carry on from it\./);
      assert.deepEqual((await sandboxes.exec(project, 'git ls-tree -r --name-only sz/tsk_goon -- src')).stdout.trim().split('\n'), ['src/list.ts', 'src/sort.ts'], 'both halves are on the branch');
      assert.equal(store.getTask('tsk_goon')!.parkCount, 1);
    } finally {
      await r.queue.stop();
      await r.d.cleanup();
    }
  });

  test('a woken task waits behind what its project is running', async () => {
    const r = await rig();
    try {
      const { store } = r.d.daemon;
      r.turns.push(codexLimit('1h'));
      submit(r, 'tsk_wait');
      r.queue.start();
      assert.equal((await r.settled('tsk_wait')).state, 'parked');
      // Something else holds the project when the limit resets.
      store.insertTask({ id: 'tsk_busy', projectId: project.id, kind: 'inline_edit', prompt: '다른 일', origin: 'desktop', budgetTokens: 1_000_000, branch: null, createdAt: r.clock.now });
      assert.equal(store.claimNextTask(r.clock.now)!.id, 'tsk_busy');
      r.clock.now += HOUR + MIN;
      assert.deepEqual(r.queue.wakeDue(), ['tsk_wait']);
      assert.equal(store.claimNextTask(r.clock.now), null, 'one task per project');
      assert.equal(store.getTask('tsk_wait')!.state, 'queued');
    } finally {
      await r.queue.stop();
      await r.d.cleanup();
    }
  });

  test('at the cap the next limit fails the task, and the failure says it stopped waiting', async () => {
    const r = await rig({ quotaPark: { maxParks: 1 } });
    try {
      r.turns.push(codexLimit('1h'), codexLimit('1h'));
      submit(r, 'tsk_cap');
      r.queue.start();
      assert.equal((await r.settled('tsk_cap')).state, 'parked');
      r.clock.now += HOUR + MIN;
      r.queue.wakeDue();
      const failed = await r.settled('tsk_cap');
      assert.deepEqual([failed.state, failed.parkCount], ['failed', 1]);
      assert.match(failed.error!, /hit your usage limit/);
      assert.deepEqual(r.bodies('tsk_cap').findLast((b) => b.type === 'task.state'), { type: 'task.state', state: 'failed', error: failed.error, parkCapHit: true });
    } finally {
      await r.queue.stop();
      await r.d.cleanup();
    }
  });

  test('a reset beyond the longest wait, or none named, fails the task as before', async () => {
    const r = await rig();
    try {
      const plain = new EngineError("codex exited 1: You've hit your usage limit.");
      r.turns.push(codexLimit('3 days'), plain);
      submit(r, 'tsk_far');
      r.queue.start();
      const far = await r.settled('tsk_far');
      assert.deepEqual([far.state, far.parkCount, far.error], ['failed', 0, codexLimit('3 days').message]);
      assert.deepEqual(r.bodies('tsk_far').findLast((b) => b.type === 'task.state'), { type: 'task.state', state: 'failed', error: far.error });
      submit(r, 'tsk_none');
      r.queue.pump();
      const none = await r.settled('tsk_none');
      assert.deepEqual([none.state, none.parkCount, none.error], ['failed', 0, plain.message]);
      assert.equal(r.bodies('tsk_none').some((b) => b.type === 'task.parked'), false);
    } finally {
      await r.queue.stop();
      await r.d.cleanup();
    }
  });

  test('a parked task stays parked across a restart, and its wake does not spend the restart retry', async () => {
    const r = await rig();
    try {
      const { store, events } = r.d.daemon;
      r.turns.push(codexLimit('2h'));
      submit(r, 'tsk_boot');
      r.queue.start();
      assert.equal((await r.settled('tsk_boot')).state, 'parked');
      await r.queue.stop();

      // The daemon comes back before the reset: recovery leaves the task where it is.
      const ran: string[] = [];
      const rebooted = (): TaskQueue => new TaskQueue({ store, events, execute: async (task) => void ran.push(task.id), clock: () => r.clock.now, log: quietLog });
      const early = rebooted();
      early.start();
      assert.equal(store.getTask('tsk_boot')!.state, 'parked');
      await early.stop();

      // And after it: woken at boot, run once.
      r.clock.now += 3 * HOUR;
      const late = rebooted();
      late.start();
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(ran, ['tsk_boot']);
      await late.stop();

      // That run was cut short by a crash (still `running`): it is queued again, not failed, because the wake was not its retry.
      assert.equal(store.getTask('tsk_boot')!.state, 'running');
      assert.deepEqual(store.recoverInterruptedTasks(r.clock.now, 2), { requeued: ['tsk_boot'], failed: [] });
    } finally {
      await r.d.cleanup();
    }
  });

  test('a parked task can be cancelled, and is then left alone', async () => {
    const r = await rig();
    try {
      r.turns.push(codexLimit('1h'));
      submit(r, 'tsk_drop');
      r.queue.start();
      assert.equal((await r.settled('tsk_drop')).state, 'parked');
      assert.equal(r.queue.cancel('tsk_drop'), true);
      r.clock.now += 2 * HOUR;
      assert.deepEqual(r.queue.wakeDue(), []);
      assert.equal(r.d.daemon.store.getTask('tsk_drop')!.state, 'cancelled');
    } finally {
      await r.queue.stop();
      await r.d.cleanup();
    }
  });

  test('the owner is told which subscription stopped the task and when it starts again, and when it stopped waiting', async () => {
    const r = await rig({ quotaPark: { maxParks: 1 } });
    try {
      const { store, events, studio } = r.d.daemon;
      const out: OutMessage[] = [];
      const relay = new RelayCore({ channel: 'ntfy', studio, store, events, send: (_chat, message) => void out.push(message), owners: () => ['me'] });
      relay.start();
      r.turns.push(codexLimit('2h'), codexLimit('2h'));
      submit(r, 'tsk_told');
      r.queue.start();
      await r.settled('tsk_told');
      const resumeAt = new Date(r.clock.now + 2 * HOUR);
      assert.equal(renderPlain(out[0]!.lines), `Ledger · tsk_told\nCodex 구독이 사용 한도에 걸려 작업을 멈췄습니다.\n한도가 풀리는 ${resumeAt.getMonth() + 1}월 ${resumeAt.getDate()}일 11:00에 하던 데서 이어 갑니다 (1번째 대기).`);
      r.clock.now += 2 * HOUR;
      r.queue.wakeDue();
      await r.settled('tsk_told');
      assert.match(renderPlain(out.at(-1)!.lines), /작업 실패: codex exited 1[^\n]*\n사용 한도를 1번 기다린 뒤라 더 기다리지 않고 멈췄습니다\./);
      relay.stop();
    } finally {
      await r.queue.stop();
      await r.d.cleanup();
    }
  });
});

interface ScheduleRig {
  d: TestDaemon;
  clock: { now: number };
  scheduler: (studio?: Pick<Studio, 'submitTask'>) => Scheduler;
  bodies: () => { type: string; [key: string]: unknown }[];
}

/** A daemon whose queue is left stopped, so a submitted task stays queued where the test can see it. */
async function scheduleRig(): Promise<ScheduleRig> {
  const clock = { now: Date.parse('2026-11-14T07:00:00') };
  const d = await testDaemon({}, { clock: () => clock.now });
  d.daemon.store.insertProject(project);
  return {
    d,
    clock,
    scheduler: (studio = d.daemon.studio) => new Scheduler({ store: d.daemon.store, events: d.daemon.events, studio, clock: () => clock.now, log: quietLog }),
    bodies: () => d.daemon.events.history({ projectId: project.id }, 0, 1000).map((e) => e.body),
  };
}

const daily = (r: ScheduleRig): Promise<Schedule> => r.d.daemon.studio.createSchedule(OWNER, { projectId: project.id, kind: 'build', prompt: '경쟁 서비스 가격표를 다시 확인해 줘', everyMinutes: 24 * 60 });

describe('schedules', () => {
  test('the next slot keeps the cadence and folds any number of missed ones into one', () => {
    const from = Date.parse('2026-11-15T07:00:00');
    assert.equal(nextSlot(from, 60, from - 1), from, 'not yet due');
    assert.equal(nextSlot(from, 60, from), from + HOUR, 'strictly after now');
    assert.equal(nextSlot(from, 60, from + 5 * HOUR + 20 * MIN), from + 6 * HOUR);
    assert.equal(nextSlot(from, 24 * 60, from + 3 * 24 * HOUR + 1), from + 4 * 24 * HOUR);
  });

  test('a schedule is due one interval from when it was made, or at its time; what does not hold is refused', async () => {
    const r = await scheduleRig();
    try {
      const { studio } = r.d.daemon;
      const every = await daily(r);
      assert.deepEqual([every.mode, every.intervalMinutes, every.nextDueAt, every.enabled, every.lastTaskId], ['every', 1440, r.clock.now + 24 * HOUR, true, null]);
      const at = Date.parse('2026-11-15T09:30:00');
      const once = await studio.createSchedule(OWNER, { projectId: project.id, kind: 'inline_edit', prompt: '배너 문구를 바꿔줘', at });
      assert.deepEqual([once.mode, once.runAt, once.nextDueAt], ['at', at, at]);

      const refused = (p: Partial<Parameters<Studio['createSchedule']>[1]>, message: RegExp) =>
        assert.rejects(studio.createSchedule(OWNER, { projectId: project.id, kind: 'build', prompt: '확인해 줘', ...p }), (err: Error) => err instanceof ConflictError && message.test(err.message));
      await refused({ everyMinutes: 30 }, /60분 이상/);
      await refused({ at: r.clock.now - MIN }, /이미 지났습니다/);
      await refused({}, /언제 돌릴지 정해 주세요/);
      await refused({ everyMinutes: 60, prompt: 'a'.repeat(20_001) }, /20,000자까지/);
      await refused({ everyMinutes: 60, prompt: '   ' }, /비어 있습니다/);
      await assert.rejects(studio.createSchedule(OWNER, { projectId: 'prj_nope', kind: 'build', prompt: '확인', everyMinutes: 60 }), NotFoundError);
      assert.equal(studio.listSchedules(project.id).length, 2);
    } finally {
      await r.d.cleanup();
    }
  });

  test('every day at seven: an interval with a first time runs at that time, and keeps to it', async () => {
    const r = await scheduleRig();
    try {
      const { store, studio } = r.d.daemon;
      // Made at half past two in the afternoon, for seven every morning.
      r.clock.now = Date.parse('2026-11-14T14:30:00');
      const seven = Date.parse('2026-11-15T07:00:00');
      const mornings = await studio.createSchedule(OWNER, { projectId: project.id, kind: 'build', prompt: '아침 브리핑을 새로 만들어 줘', at: seven, everyMinutes: 24 * 60 });
      assert.deepEqual([mornings.mode, mornings.runAt, mornings.intervalMinutes, mornings.nextDueAt], ['every', seven, 1440, seven]);
      const scheduler = r.scheduler();
      r.clock.now = seven - MIN;
      assert.deepEqual(await scheduler.tick(), [], 'not a day from when it was made');
      r.clock.now = seven + 3 * MIN;
      assert.equal((await scheduler.tick()).length, 1, 'at its first time');
      assert.equal(store.getSchedule(mornings.id)!.nextDueAt, seven + 24 * HOUR, 'and next at seven again, not a day from when it happened to be looked at');
      await assert.rejects(studio.createSchedule(OWNER, { projectId: project.id, kind: 'build', prompt: '확인', at: r.clock.now - MIN, everyMinutes: 60 }), /이미 지났습니다/);
    } finally {
      await r.d.cleanup();
    }
  });

  test('only the owner configures a schedule: an agent, or the daemon itself, is refused', async () => {
    const r = await scheduleRig();
    try {
      const { studio, policy } = r.d.daemon;
      const action = { kind: 'schedule.configure', projectId: project.id, op: 'create', scheduleId: null, taskKind: 'build', every: 60 } as const;
      assert.equal(policy.evaluate(OWNER, action).effect, 'allow');
      assert.equal(policy.evaluate({ type: 'owner', via: 'telegram' }, action).effect, 'allow');
      for (const actor of [{ type: 'agent', taskId: 'tsk_x' }, { type: 'system' }] as const) {
        const decision = policy.evaluate(actor, action);
        assert.deepEqual([decision.effect, decision.rule], ['deny', 'schedule.configure-owner-only']);
      }
      const agent = { type: 'agent', taskId: 'tsk_x' } as const;
      await assert.rejects(studio.createSchedule(agent, { projectId: project.id, kind: 'build', prompt: '매일 돌려', everyMinutes: 60 }), PolicyDeniedError);
      const owned = await daily(r);
      await assert.rejects(studio.setScheduleEnabled(agent, owned.id, false), PolicyDeniedError);
      await assert.rejects(studio.deleteSchedule(agent, owned.id), PolicyDeniedError);
      assert.equal(studio.listSchedules(undefined)[0]!.enabled, true);
    } finally {
      await r.d.cleanup();
    }
  });

  test('when its time comes the prompt is submitted as an ordinary task, once, and the schedule moves on a day', async () => {
    const r = await scheduleRig();
    try {
      const { store, studio, policy } = r.d.daemon;
      const decided: { actor: string; kind: string; rule: string; effect: string }[] = [];
      const evaluate = policy.evaluate.bind(policy);
      policy.evaluate = (actor, action, taskId) => {
        const decision = evaluate(actor, action, taskId);
        decided.push({ actor: actor.type === 'owner' ? `owner:${actor.via}` : actor.type, kind: action.kind, rule: decision.rule, effect: decision.effect });
        return decision;
      };
      const schedule = await daily(r);
      const scheduler = r.scheduler();
      assert.deepEqual(await scheduler.tick(), [], 'not due yet');

      r.clock.now += 24 * HOUR;
      const [taskId] = await scheduler.tick();
      const task = store.getTask(taskId!)!;
      assert.deepEqual([task.projectId, task.kind, task.prompt, task.state, task.origin], [project.id, 'build', schedule.prompt, 'queued', 'system']);
      assert.ok(studio.listTasks(project.id, 10).some((t) => t.id === taskId), 'listed with the project\'s tasks');
      const after = store.getSchedule(schedule.id)!;
      assert.deepEqual([after.lastFiredAt, after.lastTaskId, after.nextDueAt], [r.clock.now, taskId, r.clock.now + 24 * HOUR]);
      const said = r.bodies();
      assert.deepEqual(said.find((b) => b.type === 'schedule.fired'), { type: 'schedule.fired', scheduleId: schedule.id, taskId, firedAt: r.clock.now });
      assert.deepEqual(decided, [
        { actor: 'owner:desktop', kind: 'schedule.configure', rule: 'schedule.configure-owner-only', effect: 'allow' },
        { actor: 'owner:desktop', kind: 'task.submit', rule: 'task.submit', effect: 'allow' },
      ], 'the run went through the same rule as a task typed at the desk');
      assert.deepEqual(await scheduler.tick(), [], 'once per slot');
    } finally {
      await r.d.cleanup();
    }
  });

  test('a crash between moving the schedule on and submitting loses that run; it never runs twice', async () => {
    const r = await scheduleRig();
    try {
      const { store } = r.d.daemon;
      const schedule = await daily(r);
      r.clock.now += 24 * HOUR;
      // The first process dies inside the submission, after the schedule was written.
      const dying = r.scheduler({ submitTask: () => new Promise<never>(() => undefined) });
      void dying.tick();
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.deepEqual([store.getSchedule(schedule.id)!.lastFiredAt, store.getSchedule(schedule.id)!.nextDueAt], [r.clock.now, r.clock.now + 24 * HOUR]);

      // The next process looks at the same moment, and at every moment up to the next slot: nothing runs.
      const next = r.scheduler();
      assert.deepEqual(await next.tick(), []);
      r.clock.now += 24 * HOUR - MIN;
      assert.deepEqual(await next.tick(), []);
      assert.equal(store.listTasks(project.id, 10).length, 0);
      r.clock.now += MIN;
      assert.equal((await next.tick()).length, 1, 'the slot after it runs as usual');
    } finally {
      await r.d.cleanup();
    }
  });

  test('a run is skipped while the task from the last one is queued, running or parked', async () => {
    const r = await scheduleRig();
    try {
      const { store } = r.d.daemon;
      const schedule = await daily(r);
      const scheduler = r.scheduler();
      r.clock.now += 24 * HOUR;
      const [first] = await scheduler.tick();
      for (const state of ['queued', 'running', 'parked'] as const) {
        store.updateTask(first!, { state });
        r.clock.now += 24 * HOUR;
        assert.deepEqual(await scheduler.tick(), [], `skipped while ${state}`);
        assert.equal(store.getSchedule(schedule.id)!.nextDueAt, r.clock.now + 24 * HOUR, 'and moved on');
      }
      const skipped = r.bodies().filter((b) => b.type === 'schedule.skipped');
      assert.deepEqual(skipped.map((b) => b.reason), ['previous_active', 'previous_active', 'previous_active']);
      assert.match(String(skipped[2]!.detail), new RegExp(`task ${first} from the last run is still parked`));

      store.updateTask(first!, { state: 'succeeded', finishedAt: r.clock.now });
      r.clock.now += 24 * HOUR;
      assert.equal((await scheduler.tick()).length, 1);
      assert.equal(store.listTasks(project.id, 10).length, 2);
    } finally {
      await r.d.cleanup();
    }
  });

  test('after days of downtime a schedule runs once, then keeps its cadence', async () => {
    const r = await scheduleRig();
    try {
      const { store } = r.d.daemon;
      const schedule = await daily(r);
      const due = schedule.nextDueAt!;
      r.clock.now = due + 3 * 24 * HOUR + 2 * HOUR;
      const scheduler = r.scheduler();
      scheduler.start();
      await scheduler.stop();
      assert.equal(store.listTasks(project.id, 10).length, 1, 'one catch-up run, at start');
      assert.equal(store.getSchedule(schedule.id)!.nextDueAt, due + 4 * 24 * HOUR, 'on the original time of day');
      assert.deepEqual(await scheduler.tick(), []);
    } finally {
      await r.d.cleanup();
    }
  });

  test('a one-off schedule runs once and is then spent; a refused run is not tried again', async () => {
    const r = await scheduleRig();
    try {
      const { store, studio } = r.d.daemon;
      const once = await studio.createSchedule(OWNER, { projectId: project.id, kind: 'inline_edit', prompt: '배너 문구를 바꿔줘', at: r.clock.now + HOUR });
      r.clock.now += HOUR;
      assert.equal((await r.scheduler().tick()).length, 1);
      const spent = store.getSchedule(once.id)!;
      assert.deepEqual([spent.enabled, spent.nextDueAt, spent.lastFiredAt], [false, null, r.clock.now]);
      await assert.rejects(studio.setScheduleEnabled(OWNER, once.id, true), /시각이 지났습니다/);

      const refusedRun = await daily(r);
      r.clock.now += 24 * HOUR;
      let asked = 0;
      const refusing = r.scheduler({ submitTask: async () => { asked += 1; throw new PolicyDeniedError('task.submit', 'agents cannot start tasks'); } });
      assert.deepEqual(await refusing.tick(), []);
      assert.deepEqual(await refusing.tick(), []);
      assert.equal(asked, 1);
      assert.deepEqual(r.bodies().filter((b) => b.type === 'schedule.skipped').map((b) => [b.scheduleId, b.reason]), [[refusedRun.id, 'submit_rejected']]);
      assert.equal(store.getSchedule(refusedRun.id)!.nextDueAt, r.clock.now + 24 * HOUR);
    } finally {
      await r.d.cleanup();
    }
  });

  test('paused, a schedule does not run; resumed, it picks up at its next time from now, and deleted it is gone', async () => {
    const r = await scheduleRig();
    try {
      const { store, studio } = r.d.daemon;
      const schedule = await studio.createSchedule(OWNER, { projectId: project.id, kind: 'build', prompt: '테스트를 돌려 줘', everyMinutes: 120 });
      assert.equal((await studio.setScheduleEnabled(OWNER, schedule.id, false)).enabled, false);
      r.clock.now += 9 * HOUR + 30 * MIN;
      assert.deepEqual(await r.scheduler().tick(), []);
      const resumed = await studio.setScheduleEnabled(OWNER, schedule.id, true);
      assert.equal(resumed.nextDueAt, schedule.createdAt + 10 * HOUR, 'the next slot on its cadence, not one missed while paused');
      assert.deepEqual(await r.scheduler().tick(), []);
      await studio.deleteSchedule(OWNER, schedule.id);
      assert.equal(store.getSchedule(schedule.id), null);
      await assert.rejects(studio.deleteSchedule(OWNER, schedule.id), NotFoundError);
      // A project's schedules go with it.
      await daily(r);
      store.deleteProject(project.id);
      assert.deepEqual(studio.listSchedules(undefined), []);
    } finally {
      await r.d.cleanup();
    }
  });
});

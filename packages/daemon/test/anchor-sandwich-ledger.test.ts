// What a builder is handed before it builds, and what its work is held against afterwards:
// the anchor table gate (no valid table, no code), the two cross-checks by another vendor's model (once on the
// plan, once on the result, with at most one corrective patch), and the ledger entry every verdict leaves.
// The engine, the planner and the reviewer are scripted; the harness, the store, git and the sandbox emulation are real.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import type { AuditReport, Eval, EventEnvelope, LedgerEntry, Task } from '@studio-zero/protocol';
import type { BuildMeter } from '../src/harness/BuildMeter.ts';
import type { CompilerGate, CompilerOutcome } from '../src/harness/CompilerGate.ts';
import type { EvalOutcome, EvalRunner } from '../src/harness/EvalRunner.ts';
import { Harness } from '../src/harness/Harness.ts';
import { countCompilerErrors, ledgerDelta } from '../src/harness/Ledger.ts';
import { ANCHOR_BRIEF } from '../src/harness/prompts.ts';
import type { ReflectionAgent } from '../src/harness/ReflectionAgent.ts';
import { ACCEPTANCE_PROMPT, PLAN_REDTEAM_PROMPT, SandwichReviewer, type Acceptance, type PlanCritique } from '../src/harness/SandwichReviewer.ts';
import { ModelRouter, REVIEW_PAIRS } from '../src/llm/ModelRouter.ts';
import type { ReviewDesk } from '../src/llm/ReviewDesk.ts';
import type { RefKit } from '../src/qa/RefKit.ts';
import type { SmokeRunner } from '../src/qa/SmokeTester.ts';
import { ANCHOR_FILE, checkAnchorTable, readAnchorTable } from '../src/scratch/AnchorTable.ts';
import { testConfig } from '../src/config.ts';
import type { Engine } from '../src/harness/engines/Engine.ts';
import { quietLog, sampleProject, testDaemon, type TestDaemon } from './helpers.ts';

type Block = Anthropic.Beta.BetaContentBlock;
const use = (id: string, name: string, input: Record<string, unknown>): Block => ({ type: 'tool_use', id, name, input }) as Block;
const say = (text: string): Block => ({ type: 'text', text, citations: null }) as Block;

const ANCHOR = {
  idea: '빈 병을 채우는 쪽이 2,000원 이득이라는 것이 숫자로 먼저 보인다.',
  directions: ['영수증 한 장을 화면 가운데 두고 금액이 손끝에서 바뀌는 계산대', '한 달 달력 위에 리필한 날이 물방울로 쌓이는 기록장'],
  firstScreen: { primaryElement: '리필 한 번의 가격 차이를 보여 주는 계산 캔버스', interactiveAction: '용량 눈금을 끌어 금액이 바뀌는 것을 본다', livingVisual: '가게 12곳의 실제 리필 단가로 움직이는 계산 캔버스' },
  anchors: [
    { category: 'typography' as const, referenceObserved: '헤드라인 132px, 본문 20px, 줄간 0.95', derivedPrinciple: '숫자 하나가 화면의 주인이 된다', ourValueAndSource: '절약 금액을 본문의 다섯 배로: 가장 큰 단가 차이가 네 자리라서' },
    { category: 'motion' as const, referenceObserved: '첫 화면 등장 810ms 한 번', derivedPrinciple: '등장은 한 번, 그 뒤는 조작에만 답한다', ourValueAndSource: '병이 차오르는 시간을 실제 리필 시간 비율로' },
    { category: 'surfaces' as const, referenceObserved: '카드 모서리 28px', derivedPrinciple: '곡률이 물성을 말한다', ourValueAndSource: '유리병 어깨의 곡선을 계산대 모서리에' },
  ],
  retainedPrinciples: ['숫자가 먼저', '조작이 설명을 대신한다', '등장은 한 번'],
  discardedDefaults: ['왼쪽 목록-오른쪽 카드', '중앙 히어로 구호'],
  strictlyExcluded: ['레퍼런스의 일러스트 캐릭터'],
};

test('the anchor table check: what each miss says, and that a reference\'s values may not be carried across', () => {
  assert.deepEqual(checkAnchorTable(ANCHOR), []);
  const read = readAnchorTable(JSON.stringify(ANCHOR));
  assert.ok(read.ok && read.table.directions.length === 2);

  const bad = checkAnchorTable({
    ...ANCHOR,
    idea: '',
    directions: ['목록과 상세 패널', '목록과 상세 패널 구성'],
    firstScreen: { ...ANCHOR.firstScreen, livingVisual: '친근한 일러스트' },
    anchors: [{ category: 'typography' as const, referenceObserved: '헤드라인 132px, 등장 810ms', derivedPrinciple: '크게', ourValueAndSource: '132px 헤드라인과 810ms 등장' }],
    retainedPrinciples: ['하나'],
    discardedDefaults: [],
  });
  const has = (re: RegExp): boolean => bad.some((problem) => re.test(problem));
  assert.ok(has(/^idea is empty/), bad.join('\n'));
  assert.ok(has(/two directions say nearly the same thing/));
  assert.ok(has(/livingVisual names an illustration/));
  assert.ok(has(/anchors has 1 row\(s\); at least three/));
  assert.ok(has(/anchors\[0\] \(typography\) carries the reference's own values across \(132px, 810ms\)/));
  assert.ok(has(/retainedPrinciples has 1; give three to five/));
  assert.ok(has(/discardedDefaults is empty/));

  assert.deepEqual(readAnchorTable('{ not json'), { ok: false, problems: [`${ANCHOR_FILE} is not valid JSON.`] });
  assert.equal(readAnchorTable({ idea: 'x' }).ok, false, 'a table with missing fields is refused, not completed');
  assert.ok(!checkAnchorTable({ ...ANCHOR, firstScreen: { ...ANCHOR.firstScreen, livingVisual: '없음' } }).every((p) => !/livingVisual is empty/.test(p)));
});

test('complementary pairing: never the lead\'s own vendor, first available wins, an owner\'s choice is honoured or reported', async () => {
  for (const [lead, complements] of Object.entries(REVIEW_PAIRS)) assert.ok(!(complements as string[]).includes(lead), `${lead} is not its own reviewer`);
  assert.equal(REVIEW_PAIRS['claude-code'][0], 'codex');
  assert.equal(REVIEW_PAIRS.codex[0], 'claude-code');
  assert.deepEqual([REVIEW_PAIRS.cursor[0], REVIEW_PAIRS.antigravity[0]], ['claude-code', 'claude-code']);

  const engine = (id: Engine['id'], available: boolean): Engine => ({ id, availability: async () => ({ available, reason: available ? 'ready' : 'not installed' }), models: async () => [], open: async () => assert.fail('not opened') });
  const router = new ModelRouter(testConfig('/tmp'), [engine('native-claude', false), engine('claude-code', true), engine('codex', false), engine('antigravity', true), engine('cursor', true)]);
  assert.equal((await router.pairReviewer('native-claude')).reviewer, 'antigravity', 'Codex is not there, so the next complement of Claude');
  assert.equal((await router.pairReviewer('codex')).reviewer, 'claude-code');
  assert.equal((await router.pairReviewer('cursor')).reviewer, 'claude-code');
  const refused = await router.pairReviewer('claude-code', 'codex');
  assert.deepEqual([refused.reviewer, refused.considered], [null, [{ reviewer: 'codex', available: false, reason: 'not installed' }]], 'the owner asked for Codex; nothing else is put in its place');
});

// -------------------------------------------------------------------- the harness

function scripted(turns: Block[][], plans: unknown[]): { sdk: Anthropic; sent: Anthropic.Beta.MessageCreateParams[]; planned: Anthropic.Beta.MessageCreateParams[] } {
  const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const base = { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_details: null, stop_sequence: null, usage };
  const sent: Anthropic.Beta.MessageCreateParams[] = [];
  const planned: Anthropic.Beta.MessageCreateParams[] = [];
  const sdk = {
    beta: {
      messages: {
        stream: (params: Anthropic.Beta.MessageCreateParams) => {
          sent.push(structuredClone(params));
          const content = turns.shift();
          if (!content) throw new Error('the engine was called again: the script ran out of turns');
          return { finalMessage: async () => ({ ...base, content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }) };
        },
        parse: async (params: Anthropic.Beta.MessageCreateParams) => {
          // The output format carries a function; the messages are what a test reads.
          planned.push({ messages: structuredClone(params.messages) } as Anthropic.Beta.MessageCreateParams);
          const plan = plans.shift();
          if (plan === undefined) throw new Error('the planner was called again');
          return { ...base, content: [], stop_reason: 'end_turn', parsed_output: plan };
        },
      },
    },
  } as unknown as Anthropic;
  return { sdk, sent, planned };
}

const project = sampleProject('refill');
const visual: Eval = { id: 'evl_visual', projectId: project.id, name: 'visual-audit', spec: { kind: 'visual', routes: ['/'], minScore: 85 }, enabled: true, originTaskId: null, createdAt: 1 };
const tests: Eval = { id: 'evl_tests', projectId: project.id, name: 'unit-tests', spec: { kind: 'command', command: 'npm test', timeoutSec: 60 }, enabled: true, originTaskId: null, createdAt: 1 };

function audit(grade: 'S' | 'B', habits: number): AuditReport {
  return {
    id: `aud_${grade}`, projectId: project.id, taskId: null, createdAt: 1, score: grade === 'S' ? 96 : 86, threshold: 85, passed: true, visionReviewed: true,
    vision: { status: 'reviewed', via: 'codex', model: 'codex:default', limited: false, reviewed: 1, expected: 1, reason: null },
    rubric: { hierarchy: 9 }, slopScore: grade === 'S' ? 8 : 28, archetype: 'web-app', critique: '숫자가 화면의 주인입니다.', grade, redesignPatches: [], findings: [], screenshots: [],
    copy: { texts: [{ route: '/', role: 'title', text: '채우는 쪽이 2,000원 이득이에요' }, { route: '/', role: 'cta', text: '내 병 용량 고르기' }], slopScore: habits * 20, habits },
    measures: { contrast: { passed: 38, total: 40 }, touchTargets: { passed: 9, total: 9 } },
    livingVisual: true,
  };
}
const compiled = (passed: boolean, output = ''): CompilerOutcome => ({ command: 'npm run --silent typecheck', passed, exitCode: passed ? 0 : 2, timedOut: false, output, durationMs: 40 });
const THREE_ERRORS = "src/App.tsx(4,7): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/App.tsx(9,3): error TS2304: Cannot find name 'refil'.\nsrc/data.ts(2,1): error TS1005: ';' expected.";

interface Rig {
  d: TestDaemon;
  model: ReturnType<typeof scripted>;
  asked: { path: string; system: string; parts: readonly (string | Uint8Array)[] }[];
  run: (prompt: string) => Promise<Task>;
  bodies: (taskId: string) => EventEnvelope['body'][];
}

/** A harness of its own over a real daemon: checks and reviewer scripted, design gates on. */
async function rig(p: { turns: Block[][]; plans: unknown[]; compiler: (CompilerOutcome | null)[]; rounds: EvalOutcome[][]; critique?: PlanCritique; acceptance?: Acceptance; verifyRounds?: number }): Promise<Rig> {
  const model = scripted(p.turns, p.plans);
  const d = await testDaemon({ budgets: { verifyRounds: p.verifyRounds ?? 3 } }, { anthropic: model.sdk });
  const { store, events, policy, sandboxes, provisioner, router, claude, lessons, ledger } = d.daemon;
  store.insertProject(project);
  const asked: Rig['asked'] = [];
  const desk = {
    hasApiKey: () => false,
    ask: async (path: string, req: { system: string; parts: readonly (string | Uint8Array)[] }) => {
      asked.push({ path, system: req.system, parts: req.parts });
      const answer = req.system === PLAN_REDTEAM_PROMPT ? p.critique : p.acceptance;
      if (!answer) throw new Error('usage limit reached');
      return answer;
    },
  } as unknown as ReviewDesk;
  const harness = new Harness({
    config: d.config, store, events, policy, sandboxes, provisioner, router, claude, lessons, ledger,
    evals: { usesBrowser: () => true, runAll: async () => p.rounds.shift() ?? assert.fail('verification ran again: no more rounds were scripted') } as unknown as EvalRunner,
    compiler: { run: async () => (p.compiler.length > 0 ? p.compiler.shift()! : null) } as unknown as CompilerGate,
    smoke: { run: async () => ({ passed: true, routes: ['/'], issues: [], detail: '1 route loaded without errors', durationMs: 5 }) } as SmokeRunner,
    reflection: { reflect: async () => undefined } as unknown as ReflectionAgent,
    refkit: { capture: async () => [] } as unknown as RefKit,
    reviewer: new SandwichReviewer({ desk, router: { pairReviewer: async () => ({ reviewer: 'codex', considered: [] }) }, events, log: quietLog }),
    build: { run: async () => ({ command: 'npm run --silent build', passed: true, exitCode: 0, durationMs: 1200, bundleBytes: 300 * 1024, output: '' }) } as unknown as BuildMeter,
    clock: Date.now,
    log: quietLog,
  });
  return {
    d, model, asked,
    run: async (prompt) => {
      await d.daemon.studio.submitTask({ type: 'owner', via: 'desktop' }, { projectId: project.id, kind: 'build', prompt }, 'desktop');
      const claimed = store.claimNextTask(Date.now());
      assert.ok(claimed);
      await harness.run(claimed, new AbortController().signal);
      return store.getTask(claimed.id)!;
    },
    bodies: (taskId) => events.history({ taskId }, 0, 1000).map((e) => e.body),
  };
}

const of = <T extends EventEnvelope['body']['type']>(bodies: EventEnvelope['body'][], type: T): Extract<EventEnvelope['body'], { type: T }>[] => bodies.flatMap((b) => (b.type === type ? [b as Extract<EventEnvelope['body'], { type: T }>] : []));
const lastUser = (params: Anthropic.Beta.MessageCreateParams): string => String(params.messages.at(-1)!.content);
const PLAN = { summary: '리필 계산대를 만든다.', steps: ['계산 캔버스', '단가 픽스처'], auditRoutes: ['/'], openQuestions: [] };

test('no anchor table, no code: an engine that will not write a valid table is stopped before the build starts', async () => {
  const r = await rig({
    // The planner drafts a table that fails the check; the engine is asked three times and never fixes it.
    plans: [{ ...PLAN, anchor: { ...ANCHOR, directions: ['하나뿐'] } }],
    turns: [[say('바로 만들겠습니다.')], [say('표는 필요 없어 보입니다.')], [say('코드부터 쓰겠습니다.')]],
    compiler: [], rounds: [],
  });
  try {
    const task = await r.run('리필 스테이션 계산기를 만들어줘');
    assert.equal(task.state, 'failed');
    assert.match(task.error ?? '', /^blocked before any code: \.studio-zero\/anchor-table\.json is missing or incomplete after 2 corrections \(directions must be exactly two; there is 1\./);
    const bodies = r.bodies(task.id);
    assert.deepEqual(of(bodies, 'task.phase').map((p) => p.phase), ['plan', 'reflect'], 'the task never reached execute');
    assert.deepEqual(of(bodies, 'gate.result').map((g) => `${g.gate}:${g.passed}`), ['anchor:false']);
    assert.equal(of(bodies, 'anchor.committed').length, 0);
    assert.equal(r.asked.length, 0, 'nothing to red-team: there was no table');

    assert.equal(r.model.sent.length, 3, 'one request for the table and two corrections');
    const first = lastUser(r.model.sent[0]!);
    assert.ok(first.startsWith(ANCHOR_BRIEF), 'the pre-code round asks for the table and nothing else');
    assert.match(first, /does not hold yet\. Correct exactly these:\n- directions must be exactly two; there is 1\./);
    assert.match(JSON.stringify(r.model.planned[0]!.messages[0]!.content), /This task needs an anchor table: fill in \\"anchor\\"\./);
    // A failed task is on the ledger too.
    const [entry] = r.d.daemon.studio.listLedger(project.id, 5);
    assert.deepEqual([entry!.outcome, entry!.code.verifyRounds, entry!.design.grade], ['failed', 0, null]);
  } finally {
    await r.d.cleanup();
  }
});

test('the sandwich: table committed before code, one red team, one acceptance with one patch, and a receipt with its delta', async () => {
  const critique: PlanCritique = { verdict: '방향은 맞지만 첫 화면이 계산기 폼으로 굳어 있습니다.', defaults: ['입력 폼 위 결과 카드: 눈금을 끄는 병 자체를 입력으로 쓰세요.'], gaps: ['단가가 0원인 가게와 재고 없음 상태가 없습니다.'], blandness: [] };
  const acceptance: Acceptance = { verdict: 'patch', summary: '계산대는 약속대로 동작하지만 버튼 문구가 범용입니다.', unmet: [], copy: [{ quote: '시작하기', problem: '어느 제품에나 붙는 문구', rewrite: '내 병 용량 고르기' }], patch: '첫 화면 버튼 문구를 "내 병 용량 고르기"로 바꾸세요.' };
  const r = await rig({
    plans: [{ ...PLAN, anchor: ANCHOR }, { ...PLAN, anchor: null }],
    turns: [
      // task 1: build, repair the compile errors, apply the patch
      [use('tu_1', 'write_file', { path: 'src/App.tsx', content: 'export const price: number = "BROKEN";\n' })], [say('계산대를 만들었습니다.')],
      [use('tu_2', 'write_file', { path: 'src/App.tsx', content: 'export const price = 2000;\n' })], [say('타입 오류를 고쳤습니다.')],
      [use('tu_3', 'write_file', { path: 'src/cta.ts', content: 'export const cta = "내 병 용량 고르기";\n' })], [say('버튼 문구를 바꿨습니다.')],
      // task 2
      [use('tu_4', 'write_file', { path: 'src/stores.ts', content: 'export const stores = 12;\n' })], [say('가게 목록을 붙였습니다.')],
    ],
    compiler: [compiled(false, THREE_ERRORS), compiled(true), compiled(true), compiled(true)],
    rounds: [
      [{ eval: tests, passed: true, detail: 'exit 0', audit: null }, { eval: visual, passed: true, detail: 'score 86/100, grade B', audit: audit('B', 1) }],
      [{ eval: tests, passed: true, detail: 'exit 0', audit: null }, { eval: visual, passed: true, detail: 'score 96/100, grade S', audit: audit('S', 0) }],
      [{ eval: tests, passed: true, detail: 'exit 0', audit: null }, { eval: visual, passed: true, detail: 'score 96/100, grade S', audit: audit('S', 0) }],
    ],
    critique, acceptance,
  });
  try {
    const task = await r.run('리필 스테이션 계산기를 만들어줘');
    const bodies = r.bodies(task.id);
    assert.equal(task.state, 'succeeded', `${task.error}\n${bodies.map((b) => JSON.stringify(b)).join('\n').slice(0, 4000)}`);

    // --- the table is in the repository before any code is
    const log = (await r.d.daemon.sandboxes.exec(project, `git log --format=%s ${task.branch}`)).stdout.trim().split('\n');
    const [work, table] = [log.findIndex((subject) => subject.startsWith('feat:')), log.indexOf('docs: anchor table')];
    assert.ok(work >= 0 && table > work, `the anchor table commit is older than the work: ${log.join(' | ')}`);
    assert.deepEqual(JSON.parse(readFileSync(join(r.d.workspace, ANCHOR_FILE), 'utf8')).directions, ANCHOR.directions);
    assert.deepEqual(of(bodies, 'anchor.committed').map((a) => [a.author, a.idea, a.livingVisual]), [['planner', ANCHOR.idea, ANCHOR.firstScreen.livingVisual]]);

    // --- the order of the task: plan, (table, red team), build, verify, repair, verify, acceptance patch, verify
    assert.deepEqual(of(bodies, 'task.phase').map((p) => `${p.phase}:${p.round}`), ['plan:0', 'execute:1', 'verify:1', 'execute:2', 'verify:2', 'execute:3', 'verify:3', 'reflect:0']);
    assert.deepEqual(of(bodies, 'review.completed').map((v) => [v.stage, v.reviewer, v.verdict]), [['plan', 'codex', 'noted'], ['acceptance', 'codex', 'patch']], 'two cross-checks, never a third');
    assert.deepEqual(r.asked.map((a) => a.system), [PLAN_REDTEAM_PROMPT, ACCEPTANCE_PROMPT]);

    // --- the red team saw the request, the plan and the table, the last two as data
    const [top, bottom] = r.asked as [Rig['asked'][number], Rig['asked'][number]];
    assert.equal(top.parts[0], "The owner's request:\n리필 스테이션 계산기를 만들어줘");
    assert.match(String(top.parts[1]), /^Plan:\n<untrusted-data id="[0-9a-f]{24}" source="engine-output">\n리필 계산대를 만든다\./);
    assert.match(String(top.parts[2]), /^Anchor table:\n<untrusted-data[^>]*>\nIdea: 빈 병을 채우는 쪽이 2,000원 이득/);

    // --- the builder was handed the table and the critique, each fenced, with the harness's own instruction outside
    const opening = lastUser(r.model.sent[0]!);
    assert.match(opening, /The anchor table for this work is committed at \.studio-zero\/anchor-table\.json\. Build to it[^\n]*\n<untrusted-data id="([0-9a-f]{24})" source="engine-output">\nIdea: 빈 병을/);
    assert.match(opening, /a model from another vendor red-teamed the plan and the anchor table\.[^\n]*\n<untrusted-data id="[0-9a-f]{24}" source="engine-output">\n방향은 맞지만[\s\S]*Stock defaults:\n- 입력 폼 위 결과 카드[\s\S]*Gaps:\n- 단가가 0원인 가게/);
    assert.ok(!opening.includes('Blandness:'), 'an empty kind of point is not sent');

    // --- acceptance read the measured evidence and the screen's words as plain text, after the checks passed
    const evidence = bottom.parts.find((part) => typeof part === 'string' && part.startsWith('What the studio measured:')) as string;
    assert.match(evidence, /Verification rounds: 2\.\nCompiler: 0 error\(s\) on the last run, 3 on the first\.\nRegression checks: 1 passed\.\nVisual audit: score 86\/100 \(needs 85\), grade B, slop 28\/100/);
    assert.match(evidence, /Copy lint: 1 habit\(s\)/);
    const words = bottom.parts.find((part) => typeof part === 'string' && part.startsWith('The words on the screens')) as string;
    assert.match(words, /source="browser-page">\n\[\/\]\n# 채우는 쪽이 2,000원 이득이에요\n> 내 병 용량 고르기\n<\/untrusted-data/);

    // --- its one patch went to the engine as data and was verified like any other change
    const patched = lastUser(r.model.sent[4]!);
    assert.match(patched, /issued one corrective patch\. Carry it out[\s\S]*<untrusted-data id="[0-9a-f]{24}" source="engine-output">\n첫 화면 버튼 문구를 "내 병 용량 고르기"로 바꾸세요\.\n\nCopy to replace:\n- "시작하기" → "내 병 용량 고르기"/);
    assert.equal(readFileSync(join(r.d.workspace, 'src/cta.ts'), 'utf8'), 'export const cta = "내 병 용량 고르기";\n');

    // --- the receipt
    const [first] = r.d.daemon.studio.listLedger(project.id, 5) as [LedgerEntry];
    assert.deepEqual(first.code, { compilerErrors: 0, firstCompilerErrors: 3, verifyRounds: 3, checksPassed: 1, checksFailed: [], buildMs: 1200, bundleBytes: 307200 });
    assert.deepEqual(first.design, { grade: 'S', score: 96, slopScore: 8, livingVisual: true, contrastAaa: 0.95, touchTargets: 1, textSlop: 0 });
    assert.deepEqual(first.review, { plan: 'codex', acceptance: 'codex', verdict: 'patch' });
    assert.deepEqual([first.outcome, first.cost.modelCalls, first.cost.inputTokens, first.delta, first.proof], ['succeeded', 7, 7000, [], ''], 'six engine turns and the plan; the first entry has nothing to compare with');
    assert.equal(of(bodies, 'ledger.recorded').length, 1);
    assert.deepEqual(of(bodies, 'gate.result').filter((g) => g.gate === 'build').map((g) => [g.name, g.passed]), [['npm run --silent build', true]]);

    // --- once the work is merged, the next task reuses the table (no planner draft, no engine round) and its receipt carries the delta
    await r.d.daemon.studio.merge({ type: 'owner', via: 'desktop' }, project.id, task.branch!);
    const acceptedAsIs = r.asked.length;
    (acceptance as { verdict: string }).verdict = 'pass';
    acceptance.patch = null;
    const second = await r.run('가게 목록을 붙여줘');
    const later = r.bodies(second.id);
    assert.equal(second.state, 'succeeded', second.error ?? '');
    assert.deepEqual(of(later, 'anchor.committed').map((a) => a.author), ['workspace']);
    assert.match(JSON.stringify(r.model.planned[1]!.messages[0]!.content), /No anchor table is needed from you for this task/);
    assert.deepEqual(of(later, 'review.completed').map((v) => v.verdict), ['noted', 'pass']);
    assert.equal(r.asked.length, acceptedAsIs + 2);
    const [latest] = r.d.daemon.studio.listLedger(project.id, 5) as [LedgerEntry];
    assert.equal(latest.taskId, second.id);
    assert.deepEqual(latest.delta, [{ metric: '검증 회차', before: '3회', after: '1회', better: true }]);
    assert.equal(latest.proof, '검증 회차 3회→1회');

    // --- and both are in the file kept outside the workspace
    const lines = readFileSync(r.d.daemon.ledger.fileFor(project), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as LedgerEntry);
    assert.deepEqual(lines.map((l) => l.taskId), [task.id, second.id]);
    assert.ok(!r.d.daemon.ledger.fileFor(project).startsWith(r.d.workspace), 'an engine cannot rewrite its own receipt');
  } finally {
    await r.d.cleanup();
  }
});

test('a cross-check that cannot be had is said and skipped: the task still stands on the harness\'s own gates', async () => {
  const r = await rig({
    plans: [{ ...PLAN, anchor: ANCHOR }],
    turns: [[use('tu_1', 'write_file', { path: 'src/App.tsx', content: 'export {};\n' })], [say('만들었습니다.')]],
    compiler: [compiled(true)],
    rounds: [[{ eval: visual, passed: true, detail: 'score 96/100, grade S', audit: audit('S', 0) }]],
  });
  try {
    const task = await r.run('리필 스테이션 계산기를 만들어줘');
    assert.equal(task.state, 'succeeded', task.error ?? '');
    const reviews = of(r.bodies(task.id), 'review.completed');
    assert.deepEqual(reviews.map((v) => [v.stage, v.reviewer, v.verdict, v.reason]), [['plan', null, null, 'codex: usage limit reached'], ['acceptance', null, null, 'codex: usage limit reached']]);
    assert.ok(!lastUser(r.model.sent[0]!).includes('red-teamed'), 'no critique was invented for the builder');
    assert.deepEqual(r.d.daemon.studio.listLedger(project.id, 1)[0]!.review, { plan: null, acceptance: null, verdict: null });
  } finally {
    await r.d.cleanup();
  }
});

test('ledger arithmetic: compiler errors are counted from the tool\'s output, and a delta says which way is better', () => {
  assert.equal(countCompilerErrors(THREE_ERRORS, false), 3);
  assert.equal(countCompilerErrors('', true), 0);
  assert.equal(countCompilerErrors('npm ERR! Test failed.\n  1 failing', false), 1, 'a failure with no countable errors is still one');
  assert.equal(countCompilerErrors('error: expected `;`\nerror: unknown type `Foo`\nwarning: unused', false), 2);

  const entry = (over: { code?: Partial<LedgerEntry['code']>; design?: Partial<LedgerEntry['design']> }): Omit<LedgerEntry, 'delta' | 'proof'> => ({
    id: 'led', projectId: 'p', taskId: 't', createdAt: 1, taskKind: 'build', track: 'full', outcome: 'succeeded', engine: 'native-claude',
    code: { compilerErrors: 0, firstCompilerErrors: 0, verifyRounds: 1, checksPassed: 2, checksFailed: [], buildMs: 4000, bundleBytes: 400 * 1024, ...over.code },
    design: { grade: 'S', score: 96, slopScore: 8, livingVisual: true, contrastAaa: 1, touchTargets: 1, textSlop: 0, ...over.design },
    cost: { modelCalls: 5, inputTokens: 1, outputTokens: 1, usdMicros: 0, wallMs: 1 },
    review: { plan: null, acceptance: null, verdict: null },
  });
  const delta = ledgerDelta(entry({ code: { compilerErrors: 3, bundleBytes: 520 * 1024 }, design: { grade: 'B', score: 86, slopScore: 28, textSlop: 4, livingVisual: false, contrastAaa: 0.9 } }), entry({}));
  assert.equal(delta.map((d) => `${d.metric} ${d.before}→${d.after}`).join(', '), '타입 에러 3→0, 디자인 등급 B→S, 디자인 점수 86→96, 슬롭 지수 28→8, 텍스트 슬롭 4건→0건 클린, 첫 화면 볼거리 없음→있음, AAA 대비 통과율 90%→100%, 번들 520KB→400KB');
  assert.ok(delta.every((d) => d.better === true));
  assert.deepEqual(ledgerDelta(entry({}), entry({ design: { grade: 'C' } })), [{ metric: '디자인 등급', before: 'S', after: 'C', better: false }]);
  assert.deepEqual(ledgerDelta(entry({}), entry({})), [], 'nothing changed, nothing claimed');
  assert.deepEqual(ledgerDelta(entry({ design: { grade: null, score: null, slopScore: null } }), entry({})), [], 'a metric one side never measured is not compared');
});

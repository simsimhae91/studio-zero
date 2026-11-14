// A product built to the end of its map: the map planned from the owner's words, each milestone an ordinary task
// held to its features being walked and its walked screens measured, merged, and followed by the next. The model
// and the engine are scripted; the studio, the harness, the queue, the store, the policy engine and git are real.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { CORE_PROJECT_ID, type EventEnvelope, type Finding, type Roadmap, type ScreenSpec, type Task } from '@studio-zero/protocol';
import { ConflictError } from '../src/app/errors.ts';
import { RoadmapRunner } from '../src/app/RoadmapRunner.ts';
import type { Studio } from '../src/app/Studio.ts';
import { migrate } from '../src/db/schema.ts';
import { DRAFT_BRIEF, MILESTONE_BRIEF, PRODUCT_MAP_PROMPT } from '../src/harness/prompts.ts';
import { PolicyDeniedError } from '../src/policy/PolicyEngine.ts';
import { milestoneRequest } from '../src/product/brief.ts';
import { uncovered } from '../src/product/coverage.ts';
import { renderProductMap } from '../src/product/ProductMap.ts';
import type { ScenarioOutcome, ScenarioRunnerLike } from '../src/qa/ScenarioRunner.ts';
import type { SmokeOutcome, SmokeRunner } from '../src/qa/SmokeTester.ts';
import { sleep } from '../src/util/core.ts';
import { readScreenSpec } from '../src/scratch/ScreenSpec.ts';
import { SCREEN_SPEC } from './fixtures-mockup.ts';
import { SOUND } from './fixtures-product.ts';
import { quietLog, testDaemon, type TestDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
type Block = Anthropic.Beta.BetaContentBlock;
const use = (id: string, name: string, input: Record<string, unknown>): Block => ({ type: 'tool_use', id, name, input }) as Block;
const say = (text: string): Block => ({ type: 'text', text, citations: null }) as Block;

/** A scripted model: the engine's turns in order, and the product map for the one structured call a roadmap makes. */
function scripted(turns: Block[][], map: unknown = SOUND): { sdk: Anthropic; sent: Anthropic.Beta.MessageCreateParams[]; structuredCalls: string[] } {
  const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const base = { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_details: null, stop_sequence: null, usage };
  const sent: Anthropic.Beta.MessageCreateParams[] = [];
  const structuredCalls: string[] = [];
  const sdk = {
    beta: {
      messages: {
        stream: (params: Anthropic.Beta.MessageCreateParams) => {
          sent.push(structuredClone(params));
          const content = turns.shift();
          if (!content) throw new Error('the script ran out of turns');
          return { finalMessage: async () => ({ ...base, content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }) };
        },
        parse: async (params: Anthropic.Beta.MessageCreateParams) => {
          const system = String(params.system);
          structuredCalls.push(system.slice(0, 60));
          if (!system.includes(PRODUCT_MAP_PROMPT.slice(0, 60))) throw new Error(`unexpected structured call: ${system.slice(0, 60)}`);
          return { ...base, content: [], stop_reason: 'end_turn', parsed_output: map };
        },
      },
    },
  } as unknown as Anthropic;
  return { sdk, sent, structuredCalls };
}

/** A stand-in type checker: it fails for as long as the source says BROKEN. */
const FAKE_TSC = `#!/usr/bin/env node
const src = require('node:fs').readFileSync('src/App.tsx', 'utf8');
if (src.includes('BROKEN')) {
  console.log("src/App.tsx(24,12): error TS2322: Type 'string' is not assignable to type 'number'.");
  process.exit(2);
}
`;
const INSTALL_TSC = `mkdir -p node_modules/.bin && cat > node_modules/.bin/tsc <<'TSC'\n${FAKE_TSC}TSC\nchmod +x node_modules/.bin/tsc`;

/** The screen plan of a product whose built features are these: the fixture's product, with a scenario a feature. */
const planWith = (features: readonly string[]): ScreenSpec =>
  ({
    ...SCREEN_SPEC,
    screens: SCREEN_SPEC.screens.map((screen) => ({ ...screen, elements: [], states: [] })),
    events: [],
    scenarios: features.map((id) => ({
      id,
      role: 'housemate',
      feature: id,
      steps: [
        { id: 'sign-up', screen: 'A-01', does: '이메일과 비밀번호로 가입한다', saves: 'auth 사용자와 members 행', outcome: '오늘 장부가 보인다' },
        { id: 'log', screen: 'H-01', does: '설거지 20분을 적는다', saves: 'logs 행', outcome: '오늘 칸에 기록이 남는다' },
      ],
    })),
  }) as ScreenSpec;
const writePlan = (id: string, features: readonly string[]): Block => use(id, 'write_file', { path: 'docs/screens.json', content: JSON.stringify(planWith(features)) });
const M1 = ['onboarding', 'meal-log'];
const M2 = [...M1, 'matching', 'ranking', 'meal-photo'];
const M3 = [...M2, 'health-sync', 'result'];

const smoke: SmokeRunner = { run: async (): Promise<SmokeOutcome> => ({ passed: true, routes: ['/'], issues: [], detail: '1 route loaded without errors', durationMs: 5 }) };
const MAJOR: Finding = { rule: 'contrast/text', category: 'contrast', severity: 'major', source: 'dom', viewport: 'iphone-15-pro', route: 'H-01', message: '본문 글자의 대비가 2.1:1입니다.', selector: 'p.muted', bbox: null, fix: '글자색을 --sz-fg-muted로 바꿉니다.', file: null, line: null };

function bodies<T extends EventEnvelope['body']['type']>(trace: EventEnvelope[], type: T): Extract<EventEnvelope['body'], { type: T }>[] {
  return trace.flatMap((e) => (e.body.type === type ? [e.body as Extract<EventEnvelope['body'], { type: T }>] : []));
}

async function until<T>(read: () => T | null | undefined | false, what: string): Promise<T> {
  for (let i = 0; i < 2000; i++) {
    const value = read();
    if (value) return value;
    await sleep(15);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const roadmapIn = (d: TestDaemon, projectId: string, ...states: Roadmap['state'][]): Promise<Roadmap> =>
  until(() => {
    const roadmap = d.daemon.studio.getRoadmap(projectId);
    return roadmap && states.includes(roadmap.state) ? roadmap : null;
  }, `the roadmap to be ${states.join(' or ')} (it is ${JSON.stringify(d.daemon.studio.getRoadmap(projectId)?.state)}: ${d.daemon.studio.getRoadmap(projectId)?.error ?? ''})`);

test('only the owner plans, runs or stops a roadmap, and the studio\'s own repository has none', async () => {
  const d = await testDaemon();
  try {
    const { studio, policy } = d.daemon;
    const project = studio.createProject(OWNER, { name: 'Battle', slug: 'battle', template: 'mobile-expo' });
    for (const op of ['plan', 'run', 'stop'] as const) {
      const action = { kind: 'roadmap.configure', projectId: project.id, op } as const;
      assert.equal(policy.evaluate(OWNER, action).effect, 'allow');
      assert.equal(policy.evaluate({ type: 'owner', via: 'telegram' }, action).effect, 'allow');
      for (const actor of [{ type: 'agent', taskId: 'tsk_x' }, { type: 'system' }] as const) {
        const decision = policy.evaluate(actor, action);
        assert.deepEqual([decision.effect, decision.rule], ['deny', 'roadmap.configure-owner-only']);
      }
    }
    await assert.rejects(studio.runRoadmap({ type: 'agent', taskId: 'tsk_x' }, project.id), PolicyDeniedError);
    await assert.rejects(studio.planRoadmap(OWNER, CORE_PROJECT_ID, '스튜디오를 더 좋게'), ConflictError);
    assert.equal(studio.getRoadmap(project.id), null);
  } finally {
    await d.cleanup();
  }
});

test('a roadmap is kept whole in its row, and a database from before it gains the table and the column', async () => {
  const d = await testDaemon();
  try {
    const { store, studio } = d.daemon;
    const project = studio.createProject(OWNER, { name: 'Battle', slug: 'battle', template: 'mobile-expo' });
    const roadmap: Roadmap = { projectId: project.id, request: '다이어트 배틀', state: 'planned', map: SOUND, milestones: SOUND.milestones.map(() => ({ state: 'planned', taskIds: [], error: null, debt: [], shots: [] })), autoMerge: false, error: null, createdAt: 10, updatedAt: 20 };
    assert.deepEqual(store.putRoadmap(roadmap), roadmap);
    assert.deepEqual(store.listRoadmaps('planned'), [roadmap]);
    assert.deepEqual(store.listRoadmaps('running'), []);
    store.noteMilestone(project.id, 1, { debt: ['Screen H-01: contrast'], shots: [{ screen: 'H-01', artifactId: 'art_1' }] }, 30);
    const noted = store.getRoadmap(project.id)!;
    assert.deepEqual([noted.updatedAt, noted.milestones[1]!.debt, noted.milestones[1]!.shots, noted.milestones[0]!.debt], [30, ['Screen H-01: contrast'], [{ screen: 'H-01', artifactId: 'art_1' }], []]);
    store.noteMilestone(project.id, 9, { debt: ['x'] }, 40);
    assert.equal(store.getRoadmap(project.id)!.updatedAt, 30, 'a milestone the map does not have is not written');
    const task = store.insertTask({ id: 'tsk_m', projectId: project.id, kind: 'build', prompt: '마일스톤 2/3', origin: 'system', budgetTokens: 1, branch: null, milestone: 1, createdAt: 1 });
    assert.equal(task.milestone, 1);
    assert.equal(store.insertTask({ id: 'tsk_n', projectId: project.id, kind: 'build', prompt: 'x', origin: 'desktop', budgetTokens: 1, branch: null, createdAt: 1 }).milestone, null);
  } finally {
    await d.cleanup();
  }

  const db = new DatabaseSync(':memory:');
  migrate(db, 17);
  db.exec("INSERT INTO projects (id, slug, name, template, created_at) VALUES ('prj_old', 'old', 'Old', 'web-vite-react', 1)");
  db.exec("INSERT INTO tasks (id, project_id, kind, prompt, origin, state, budget_tokens, created_at) VALUES ('tsk_old', 'prj_old', 'build', 'x', 'desktop', 'succeeded', 1, 1)");
  migrate(db);
  assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version >= 18, true);
  assert.deepEqual({ ...(db.prepare('SELECT milestone FROM tasks WHERE id = ?').get('tsk_old') as object) }, { milestone: null });
  assert.equal((db.prepare('SELECT count(*) AS n FROM roadmaps').get() as { n: number }).n, 0);
  assert.equal((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
  db.close();
});

test('every feature of the milestones built so far is walked by a scenario, or is named', () => {
  assert.deepEqual(uncovered(SOUND, planWith(M1), 0), []);
  assert.deepEqual(uncovered(SOUND, planWith(M3), 2), []);
  // Later milestones owe nothing yet.
  assert.deepEqual(uncovered(SOUND, planWith(['onboarding']), 0), ['Feature "meal-log" (meal-log 기능), of milestone 1: no scenario in docs/screens.json walks it. Give it one marked "feature": "meal-log": a new person signs up and uses it to its outcome, with at least one step after signing up.']);
  // One that an earlier milestone walked and this one dropped is said to have been there.
  const dropped = uncovered(SOUND, planWith(['onboarding', 'matching', 'ranking', 'meal-photo']), 1);
  assert.equal(dropped.length, 1);
  assert.match(dropped[0]!, /^Feature "meal-log" \(meal-log 기능\), of milestone 1: .* It was walked before this milestone and its scenario is gone: put it back\.$/);
  // Signing up and nothing else walks nothing.
  const thin = planWith(M1);
  thin.scenarios[1]!.steps = thin.scenarios[1]!.steps.slice(0, 1);
  assert.match(uncovered(SOUND, thin, 0)[0]!, /^Feature "meal-log"/);
  // A mistyped id would leave the real feature unwalked: both are said.
  const typo = planWith(M1);
  typo.scenarios[1]!.feature = 'meal-logs';
  assert.deepEqual(uncovered(SOUND, typo, 0).map((line) => line.split(':')[0]), ['Feature "meal-log" (meal-log 기능), of milestone 1', 'Scenario "meal-log" is marked "feature"']);
});

test('a plan in the wrong shape is told everything in one reading: each kind of slip once, and what the rest of it owes', () => {
  // As the first real milestone wrote it: elements and states as sentences, events without what they measure,
  // and signing in as a step of a scenario. Sent back a kind at a time, that was three turns and every correction.
  const plan = planWith(M1) as unknown as { screens: { elements: unknown[]; states: unknown[] }[]; events: unknown[]; scenarios: { steps: { id: string; screen: string; does: string; saves: string | null; outcome: string }[] }[] };
  for (const screen of plan.screens) Object.assign(screen, { elements: ['가입 버튼', '이메일 칸'], states: ['이미 쓰는 이메일'] });
  plan.events = [{ name: 'signed_up', when: '가입을 마쳤을 때' }, { name: 'logged', when: '기록했을 때' }];
  plan.scenarios[1]!.steps.push({ id: 'sign-in', screen: 'A-01', does: '다시 로그인한다', saves: null, outcome: '기록이 그대로 보인다' });
  const read = readScreenSpec(JSON.stringify(plan), { works: true, draft: true, wide: true });
  assert.ok(!read.ok);
  assert.deepEqual(read.problems, [
    `screens.0.elements.0: Invalid input: expected object, received string (and ${plan.screens.length * 2 - 1} more places like it) Each element is { "name", "rule", "goesTo" }; a screen with none listed has "elements": [].`,
    `screens.0.states.0: Invalid input: expected object, received string (and ${plan.screens.length - 1} more places like it) Each state is { "name", "shows" }; a screen with none listed has "states": [].`,
    'events.0.measures: Invalid input: expected string, received undefined (and 1 more place like it) Each event is { "name", "when", "measures" }; a plan that records none has "events": [].',
    'scenario meal-log, step 3 (sign-in): "sign-in" is not a step of a scenario. A scenario starts with a new person; signing in again is checked by the studio after it, on the screen entry.signIn names.',
  ]);
  // Nothing mended is ever the plan: put right by hand, the same text reads.
  assert.ok(readScreenSpec(JSON.stringify(planWith(M1)), { works: true, draft: true, wide: true }).ok);
  assert.deepEqual(readScreenSpec('{ not json').ok, false);
});

test('rounds that only put the screen plan right are not charged to a milestone\'s corrections', async () => {
  const scenarios: ScenarioRunnerLike = { run: async (_project, spec): Promise<ScenarioOutcome> => ({ passed: true, scenarios: spec.scenarios.length, walked: spec.scenarios.length, problems: [], logins: [], detail: 'walked', durationMs: 1, looks: [] }) };
  const misshapen = { ...planWith(M1), events: [{ name: 'signed_up', when: '가입을 마쳤을 때' }] };
  const model = scripted([
    // The plan in a wrong shape; then with a feature nobody walks; then a build that does not compile; then right.
    [use('tu_0', 'write_file', { path: 'docs/screens.json', content: JSON.stringify(misshapen) }), use('tu_1', 'write_file', { path: 'tsconfig.json', content: '{}\n' }), use('tu_2', 'bash', { command: INSTALL_TSC }), use('tu_3', 'write_file', { path: 'src/App.tsx', content: 'export const milestone = 0;\n' })],
    [say('1 완료')],
    [writePlan('tu_4', ['onboarding'])],
    [say('명세를 고쳤다')],
    [writePlan('tu_5', M1), use('tu_5b', 'write_file', { path: 'src/App.tsx', content: 'BROKEN\n' })],
    [say('시나리오를 넣었다')],
    [use('tu_6', 'write_file', { path: 'src/App.tsx', content: 'export const milestone = 1;\n' })],
    [say('컴파일을 고쳤다')],
  ]);
  // One correction is all this task has: it passes only if the two plan rounds cost none.
  const d = await testDaemon({ budgets: { verifyRounds: 1 } }, { anthropic: model.sdk, smoke, scenarios });
  await d.daemon.start();
  const { studio, events } = d.daemon;
  d.daemon.evals.measureDraft = async () => null;
  try {
    const project = studio.createProject(OWNER, { name: 'Battle', slug: 'battle', template: 'mobile-expo' });
    await studio.planRoadmap(OWNER, project.id, '다이어트 배틀');
    await roadmapIn(d, project.id, 'planned');
    await studio.runRoadmap(OWNER, project.id);
    const first = await until(() => {
      const id = studio.getRoadmap(project.id)?.milestones[0]?.taskIds[0];
      const task = id ? studio.getTask(id) : null;
      return task && ['succeeded', 'failed'].includes(task.state) ? task : null;
    }, 'the first milestone to end');
    await studio.stopRoadmap(OWNER, project.id).catch(() => undefined);
    assert.equal(first.state, 'succeeded', first.error ?? '');
    const gates = bodies(events.history({ taskId: first.id }, 0, 1000), 'gate.result').map((g) => `${g.gate}:${g.passed}`);
    assert.deepEqual(gates.filter((g) => !g.startsWith('smoke') && !g.startsWith('scenarios') && !g.startsWith('looks')), ['compiler:true', 'screens:false', 'compiler:true', 'coverage:false', 'compiler:false', 'compiler:true', 'coverage:true']);
    const sentBack = model.sent.map((params) => String(params.messages.at(-1)!.content)).filter((text) => text.startsWith('The harness verified your work'));
    assert.equal(sentBack.length, 3);
  } finally {
    await d.cleanup();
  }
});

test('a milestone\'s request names it on its first line and carries the map\'s account of it as data', () => {
  const first = milestoneRequest(SOUND, 0);
  assert.equal(first.split('\n')[0], '마일스톤 1/3: 들어와서 기록하기');
  assert.match(first, /Build this milestone of the product map in docs\/product\.json\.[\s\S]*<untrusted-data id="[0-9a-f]{24}" source="engine-output" milestone="m1">\nProduct: 비슷한 체급의 상대와[\s\S]*Milestone 1 of 3, "들어와서 기록하기": 가입하고 오늘 먹은 것을 적는다\.[\s\S]*Feature "onboarding": onboarding 기능 \(core; real in the preview\)[\s\S]*Done when:\n- 새 사람이 가입하고 아침을 적으면 오늘 점수가 오른다\.[\s\S]*Nothing is built yet: this milestone also lays the frame/);
  assert.match(first, /Later milestones, not to be built now: "상대와 겨루기" \(matching 기능 \("matching"\), ranking 기능 \("ranking"\), meal-photo 기능 \("meal-photo"\)\); "끝과 몸"/);
  assert.doesNotMatch(first, /An earlier attempt/);
  const second = milestoneRequest(SOUND, 1);
  assert.match(second, /Feature "meal-photo": meal-photo 기능 \(expected; simulated in the preview\)[\s\S]*Needs: data: meals; device: camera; a model inside the product\n  In the preview: 음식표에서 고른 예시 추정이 대신한다\./);
  assert.match(second, /Built already, and walked again with this milestone: onboarding 기능 \("onboarding"\), meal-log 기능 \("meal-log"\)\./);
  const last = milestoneRequest(SOUND, 2, { branch: 'sz/tsk_before', error: 'verification still failing after 3 corrections: scenarios' });
  assert.match(last, /This is the last milestone: when it is done the whole map is built\./);
  assert.match(last, /An earlier attempt at this milestone stopped with: <untrusted-data id="[0-9a-f]{24}" source="sandbox-output">\nverification still failing after 3 corrections: scenarios\n<\/untrusted-data id="[0-9a-f]{24}">\nIts work is on this branch \(it was started from sz\/tsk_before\)\. Read what is there and finish it; do not start the milestone over\./);
});

test('a product is planned whole and built to the end of its map: a milestone a task, each feature walked, each walked screen measured, each merged', async () => {
  const walks: { features: string[]; look: boolean }[] = [];
  const scenarios: ScenarioRunnerLike = {
    run: async (_project, spec, opts): Promise<ScenarioOutcome> => {
      const features = spec.scenarios.map((scenario) => scenario.feature ?? '');
      walks.push({ features, look: opts?.look === true });
      // The last milestone's screen has a defect that the one repair it is sent back for does not clear.
      const looks = features.length === M3.length ? [{ screen: 'H-01', scenario: 'result', findings: [MAJOR], png: Buffer.from('a picture') }] : [{ screen: 'H-01', scenario: 'onboarding', findings: [{ ...MAJOR, severity: 'minor' as const }], png: null }];
      return { passed: true, scenarios: features.length, walked: features.length, problems: [], logins: [], detail: `${features.length} scenarios walked to the end as new people`, durationMs: 3, looks };
    },
  };
  const model = scripted([
    // Milestone 1: the frame, the plan with its two features, and a type checker that passes.
    [writePlan('tu_0', M1), use('tu_1', 'write_file', { path: 'tsconfig.json', content: '{ "compilerOptions": { "strict": true } }\n' }), use('tu_2', 'bash', { command: INSTALL_TSC }), use('tu_3', 'write_file', { path: 'src/App.tsx', content: 'export const milestone = 1;\n' })],
    [say('가입과 끼니 기록이 됩니다.')],
    // Milestone 2: built, and the plan forgets the ranking's scenario; then it is put in.
    [writePlan('tu_4', M2.filter((id) => id !== 'ranking')), use('tu_5', 'write_file', { path: 'src/App.tsx', content: 'export const milestone = 2;\n' })],
    [say('매칭과 순위가 됩니다.')],
    [writePlan('tu_6', M2)],
    [say('순위를 걷는 시나리오를 넣었습니다.')],
    // Milestone 3: built; what was measured on its screen is sent back once, and is still there after.
    [writePlan('tu_7', M3), use('tu_8', 'write_file', { path: 'src/App.tsx', content: 'export const milestone = 3;\n' })],
    [say('결과 화면과 활동 기록이 됩니다.')],
    [say('대비를 고쳤습니다 (고쳐지지 않았다).')],
  ]);
  const d = await testDaemon({}, { anthropic: model.sdk, smoke, scenarios });
  await d.daemon.start();
  const { studio, events, store } = d.daemon;
  d.daemon.evals.measureDraft = async () => null;
  try {
    const project = studio.createProject(OWNER, { name: 'Battle', slug: 'battle', template: 'mobile-expo' });
    await assert.rejects(studio.runRoadmap(OWNER, project.id), /a roadmap for project/, 'nothing to run before a map is planned');

    // --- the map
    const planning = await studio.planRoadmap(OWNER, project.id, '  2주 다이어트 배틀 앱\n- 매칭\n- 랭킹  ');
    assert.deepEqual([planning.state, planning.request, planning.map, planning.milestones], ['planning', '2주 다이어트 배틀 앱\n- 매칭\n- 랭킹', null, []]);
    await assert.rejects(studio.planRoadmap(OWNER, project.id, '다시'), ConflictError, 'one map is written at a time');
    const planned = await roadmapIn(d, project.id, 'planned', 'failed');
    assert.equal(planned.state, 'planned', planned.error ?? '');
    assert.deepEqual(planned.map, SOUND);
    assert.deepEqual(planned.milestones.map((m) => m.state), ['planned', 'planned', 'planned']);
    assert.equal(model.structuredCalls.length, 1);
    assert.equal(store.listTasks(project.id, 10).length, 0, 'a map builds nothing until the owner runs it');

    // --- built to its end
    const running = await studio.runRoadmap(OWNER, project.id);
    assert.deepEqual([running.state, running.autoMerge, running.milestones.map((m) => m.state)], ['running', true, ['building', 'planned', 'planned']]);
    await assert.rejects(studio.planRoadmap(OWNER, project.id, '다른 제품'), ConflictError, 'a map being built is not replaced');
    const done = await roadmapIn(d, project.id, 'done', 'stopped');
    assert.equal(done.state, 'done', `${done.error}\n${events.history({ projectId: project.id }, 0, 3000).map((e) => JSON.stringify(e.body)).join('\n').slice(-6000)}`);
    assert.deepEqual(done.milestones.map((m) => [m.state, m.taskIds.length, m.error]), [['built', 1, null], ['built', 1, null], ['built', 1, null]]);
    await assert.rejects(studio.runRoadmap(OWNER, project.id), ConflictError, 'a map that is built is not run again');

    const tasks: Task[] = done.milestones.map((m) => studio.getTask(m.taskIds[0]!));
    assert.deepEqual(tasks.map((task) => [task.state, task.kind, task.track, task.milestone, task.origin, task.prompt.split('\n')[0]]), [
      ['succeeded', 'build', 'fast', 0, 'system', '마일스톤 1/3: 들어와서 기록하기'],
      ['succeeded', 'build', 'fast', 1, 'system', '마일스톤 2/3: 상대와 겨루기'],
      ['succeeded', 'build', 'fast', 2, 'system', '마일스톤 3/3: 끝과 몸'],
    ]);

    // --- what a milestone's engine is told: the milestone's brief in the draft's place, and the map in the workspace
    const opening = String(model.sent[0]!.messages[0]!.content);
    assert.ok(opening.startsWith(MILESTONE_BRIEF), 'the milestone brief leads the first turn');
    assert.ok(!opening.includes(DRAFT_BRIEF.slice(0, 80)), 'and the draft brief is not in it');
    assert.match(opening, /The owner's request:\n마일스톤 1\/3: 들어와서 기록하기\n\nBuild this milestone of the product map in docs\/product\.json\./);
    assert.match(opening, /What every screen of this milestone is made of\./);
    assert.equal(readFileSync(join(d.workspace, 'docs/product.json'), 'utf8'), `${JSON.stringify(SOUND, null, 2)}\n`);
    assert.equal(readFileSync(join(d.workspace, 'docs/product.md'), 'utf8'), renderProductMap(SOUND));
    // Each milestone was merged before the next began: the checkout is on the last one's work.
    assert.equal(readFileSync(join(d.workspace, 'src/App.tsx'), 'utf8'), 'export const milestone = 3;\n');
    assert.deepEqual(JSON.parse(readFileSync(join(d.workspace, 'docs/screens.json'), 'utf8')).scenarios.map((s: { feature: string }) => s.feature), M3);

    // --- the gates of each milestone
    const gates = (task: Task): string[] => bodies(events.history({ taskId: task.id }, 0, 1000), 'gate.result').filter((g) => ['coverage', 'scenarios', 'looks'].includes(g.gate)).map((g) => `${g.gate}:${g.passed}`);
    assert.deepEqual(gates(tasks[0]!), ['coverage:true', 'scenarios:true', 'looks:true']);
    assert.deepEqual(gates(tasks[1]!), ['coverage:false', 'coverage:true', 'scenarios:true', 'looks:true'], 'a feature nothing walks is caught before the browser starts');
    assert.deepEqual(gates(tasks[2]!), ['coverage:true', 'scenarios:true', 'looks:false', 'coverage:true', 'scenarios:true', 'looks:false']);
    // The walk is of everything built so far, each time, and is asked to measure where it stands.
    assert.deepEqual(walks.map((w) => [w.features.length, w.look]), [[2, true], [5, true], [7, true], [7, true]]);

    // The feature nobody walked goes back by name.
    const coverage = model.sent.map((params) => String(params.messages.at(-1)!.content)).find((text) => text.includes('Check "coverage" failed'))!;
    assert.match(coverage, /<untrusted-data id="[0-9a-f]{24}" source="sandbox-output" check="coverage">\nEvery feature of the milestones built so far is walked by a scenario of the screen plan\. These are not:\n- Feature "ranking" \(ranking 기능\), of milestone 2: no scenario in docs\/screens\.json walks it\./);
    // What was measured goes back once, as measurements.
    const sentBack = model.sent.map((params) => String(params.messages.at(-1)!.content)).filter((text) => text.includes('Check "looks" failed'));
    assert.equal(sentBack.length, 1, 'once, and not again');
    assert.match(sentBack[0]!, /source="browser-page" check="looks">\nEvery scenario reached its end\.[\s\S]*- Screen H-01 \(scenario "result"\), major, contrast\/text: 본문 글자의 대비가 2\.1:1입니다\. At p\.muted\. 글자색을 --sz-fg-muted로 바꿉니다\./);
    // What one round did not clear is the milestone's debt, with the picture of the screen; the milestone is built.
    assert.deepEqual(done.milestones.map((m) => m.debt.length), [0, 0, 1]);
    assert.equal(done.milestones[2]!.debt[0], 'H-01 화면 (시나리오 result) · 큰 결함 · contrast/text: 본문 글자의 대비가 2.1:1입니다.');
    assert.deepEqual(done.milestones[2]!.shots.map((shot) => shot.screen), ['H-01']);
    const shot = store.getArtifact(done.milestones[2]!.shots[0]!.artifactId)!;
    assert.equal(shot.mime, 'image/png');
    assert.equal(readFileSync(shot.file, 'utf8'), 'a picture');
    assert.ok(bodies(events.history({ taskId: tasks[2]!.id }, 0, 1000), 'notice').some((n) => n.level === 'warn' && /마일스톤 3: 걸은 화면에서 잰 결함 1건이 한 번 고친 뒤에도 남았습니다/.test(n.message)));
    assert.equal(model.sent.length, 9, 'every scripted turn was used and no other');

    // --- what the owner was told as it went
    const said = bodies(events.history({ projectId: project.id }, 0, 5000), 'roadmap.changed').map((b) => `${b.state}${b.milestone === null ? '' : ` ${b.milestone + 1} ${b.milestoneState}`}`);
    assert.deepEqual(said, ['planning', 'planned', 'running', 'running 1 building', 'running 1 built', 'running 2 building', 'running 2 built', 'running 3 building', 'running 3 built', 'done']);
  } finally {
    await d.cleanup();
  }
});

test('a milestone whose checks still fail is tried once more by itself, then stops the roadmap with its reason; running it again goes on from its branch', async () => {
  const scenarios: ScenarioRunnerLike = { run: async (_project, spec): Promise<ScenarioOutcome> => ({ passed: true, scenarios: spec.scenarios.length, walked: spec.scenarios.length, problems: [], logins: [], detail: 'walked', durationMs: 1, looks: [] }) };
  const model = scripted([
    [writePlan('tu_0', M1), use('tu_1', 'write_file', { path: 'tsconfig.json', content: '{}\n' }), use('tu_2', 'bash', { command: INSTALL_TSC }), use('tu_3', 'write_file', { path: 'src/App.tsx', content: 'export const milestone = 1;\n' })],
    [say('1 완료')],
    // Milestone 2 does not compile, and the one correction it is allowed does not fix it.
    [writePlan('tu_4', M2), use('tu_5', 'write_file', { path: 'src/App.tsx', content: 'BROKEN\n' })],
    [say('2 완료 (아니다)')],
    [say('고쳤다 (아니다)')],
    // The runner tries it once more by itself, from that branch. It fails the same way.
    [say('읽어 봤다 (고치지 않았다)')],
    [say('고쳤다 (아니다)')],
    // The owner runs it again: the same milestone, from what the last attempt left.
    [use('tu_6', 'write_file', { path: 'src/App.tsx', content: 'export const milestone = 2;\n' })],
    [say('2 완료')],
    [writePlan('tu_7', M3)],
    [say('3 완료')],
  ]);
  const d = await testDaemon({ budgets: { verifyRounds: 1 } }, { anthropic: model.sdk, smoke, scenarios });
  await d.daemon.start();
  const { studio } = d.daemon;
  d.daemon.evals.measureDraft = async () => null;
  try {
    const project = studio.createProject(OWNER, { name: 'Battle', slug: 'battle', template: 'mobile-expo' });
    await studio.planRoadmap(OWNER, project.id, '다이어트 배틀');
    await roadmapIn(d, project.id, 'planned');
    await studio.runRoadmap(OWNER, project.id);
    const stopped = await roadmapIn(d, project.id, 'stopped', 'done');
    assert.equal(stopped.state, 'stopped');
    assert.deepEqual(stopped.milestones.map((m) => [m.state, m.taskIds.length]), [['built', 1], ['failed', 2], ['planned', 0]]);
    assert.equal(stopped.error, '마일스톤 2 "상대와 겨루기"이 실패했습니다: verification still failing after 1 corrections: compiler');
    assert.equal(stopped.milestones[1]!.error, 'verification still failing after 1 corrections: compiler');
    const [failed, retried] = stopped.milestones[1]!.taskIds.map((id) => studio.getTask(id)) as [Task, Task];
    assert.deepEqual([failed.state, retried.state], ['failed', 'failed']);
    assert.ok(failed.branch, 'the failed attempt keeps its branch');
    // The second attempt was the runner's own: from the first one's branch, told why that one stopped and what the check said.
    assert.equal(retried.baseBranch, failed.branch);
    assert.match(retried.prompt, /^마일스톤 2\/3: 상대와 겨루기\n/);
    assert.match(retried.prompt, /An earlier attempt at this milestone stopped with: <untrusted-data id="[0-9a-f]{24}" source="sandbox-output">\nverification still failing after 1 corrections: compiler\nThe last check that failed \(compiler\) said:\nsrc\/App\.tsx\(24,12\): error TS2322: Type 'string' is not assignable to type 'number'\.\n<\/untrusted-data id="[0-9a-f]{24}">\nIts work is on this branch/);
    // Nothing of the failed milestone reached the product.
    assert.equal(readFileSync(join(d.workspace, 'src/App.tsx'), 'utf8'), 'export const milestone = 1;\n');
    await assert.rejects(studio.stopRoadmap(OWNER, project.id), ConflictError, 'there is nothing running to stop');

    await studio.runRoadmap(OWNER, project.id);
    const done = await roadmapIn(d, project.id, 'done', 'stopped');
    assert.equal(done.state, 'done', done.error ?? '');
    assert.deepEqual(done.milestones.map((m) => [m.state, m.taskIds.length]), [['built', 1], ['built', 3], ['built', 1]]);
    const again = studio.getTask(done.milestones[1]!.taskIds[2]!);
    assert.deepEqual([again.state, again.milestone, again.baseBranch], ['succeeded', 1, retried.branch]);
    assert.equal(readFileSync(join(d.workspace, 'src/App.tsx'), 'utf8'), 'export const milestone = 2;\n');
    assert.equal(model.sent.length, 11);
  } finally {
    await d.cleanup();
  }
});

/** The runner over a real store, with the studio it submits through and merges by recorded. */
async function runnerRig(): Promise<{ d: TestDaemon; projectId: string; submitted: { milestone: number; baseBranch: string | null; id: string }[]; merged: string[]; fail: { merge: string | null }; make: () => RoadmapRunner; finish: (taskId: string, state: 'succeeded' | 'failed' | 'cancelled', error?: string) => void }> {
  const d = await testDaemon();
  const { store, events, studio: real } = d.daemon;
  const project = real.createProject(OWNER, { name: 'Battle', slug: 'battle', template: 'mobile-expo' });
  const submitted: { milestone: number; baseBranch: string | null; id: string }[] = [];
  const merged: string[] = [];
  const fail: { merge: string | null } = { merge: null };
  const studio = {
    submitTask: async (_actor: unknown, p: { projectId: string; kind: 'build'; prompt: string; milestone?: number; baseBranch?: string }): Promise<Task> => {
      const id = `tsk_m${submitted.length}`;
      submitted.push({ milestone: p.milestone ?? -1, baseBranch: p.baseBranch ?? null, id });
      return store.insertTask({ id, projectId: p.projectId, kind: p.kind, prompt: p.prompt, origin: 'system', budgetTokens: 1, branch: `sz/${id}`, baseBranch: p.baseBranch ?? null, milestone: p.milestone ?? null, createdAt: 1 });
    },
    merge: async (_actor: unknown, _projectId: string, branch: string): Promise<void> => {
      if (fail.merge) throw new Error(fail.merge);
      merged.push(branch);
    },
  } as unknown as Pick<Studio, 'submitTask' | 'merge'>;
  const make = (): RoadmapRunner =>
    new RoadmapRunner({ store, events, claude: { structured: async () => SOUND } as never, studio, external: { list: () => [] }, sandboxes: { exec: async () => ({ exitCode: 1, stdout: '', stderr: '', truncated: false, timedOut: false, durationMs: 1 }) } as never, clock: () => 100, log: quietLog });
  const finish = (taskId: string, state: 'succeeded' | 'failed' | 'cancelled', error?: string): void => {
    store.updateTask(taskId, { state, ...(error ? { error } : {}) });
  };
  return { d, projectId: project.id, submitted, merged, fail, make, finish };
}

test('a restart in the middle goes on from the task that was building, and submits no milestone twice', async () => {
  const r = await runnerRig();
  try {
    const { store } = r.d.daemon;
    const project = store.getProject(r.projectId)!;
    const first = r.make();
    first.plan(project, '다이어트 배틀');
    await first.idle();
    assert.equal(first.get(r.projectId)!.state, 'planned');
    await first.run(r.projectId);
    assert.deepEqual(r.submitted, [{ milestone: 0, baseBranch: null, id: 'tsk_m0' }]);

    // The daemon comes back while the task is still in the queue: it is waited for, not submitted again.
    const second = r.make();
    second.start();
    await second.idle();
    assert.equal(r.submitted.length, 1);
    assert.deepEqual(second.get(r.projectId)!.milestones.map((m) => m.state), ['building', 'planned', 'planned']);

    // The task ended while the daemon was down, and nobody was told: the next boot takes its result.
    r.finish('tsk_m0', 'succeeded');
    const third = r.make();
    third.start();
    await third.idle();
    assert.deepEqual(r.merged, ['sz/tsk_m0']);
    assert.deepEqual(r.submitted.map((s) => [s.milestone, s.baseBranch]), [[0, null], [1, null]]);
    assert.deepEqual(third.get(r.projectId)!.milestones.map((m) => [m.state, m.taskIds]), [['built', ['tsk_m0']], ['building', ['tsk_m1']], ['planned', []]]);

    // A task that settles twice (parked on a usage limit, then done) is taken once.
    r.finish('tsk_m1', 'succeeded');
    third.taskSettled('tsk_m1');
    third.taskSettled('tsk_m1');
    await third.idle();
    assert.deepEqual(r.merged, ['sz/tsk_m0', 'sz/tsk_m1']);
    assert.equal(r.submitted.length, 3);

    // A map that was being written when the daemon stopped is said to have failed.
    store.putRoadmap({ ...store.getRoadmap(r.projectId)!, state: 'planning' });
    const fourth = r.make();
    fourth.start();
    await fourth.idle();
    assert.deepEqual([fourth.get(r.projectId)!.state, fourth.get(r.projectId)!.error], ['failed', '지도를 쓰는 중에 데몬이 다시 시작됐습니다. 다시 만들어 주세요.']);
  } finally {
    await r.d.cleanup();
  }
});

test('without merging each milestone starts from the one before; a merge that is refused, a cancel and a stop each leave the roadmap where it can go on', async () => {
  const r = await runnerRig();
  try {
    const { store } = r.d.daemon;
    const project = store.getProject(r.projectId)!;
    const runner = r.make();
    runner.plan(project, '다이어트 배틀');
    await runner.idle();

    // --no-merge: nothing is merged, and the next milestone is built on the last one's branch.
    assert.equal((await runner.run(r.projectId, { autoMerge: false })).autoMerge, false);
    r.finish('tsk_m0', 'succeeded');
    runner.taskSettled('tsk_m0');
    await runner.idle();
    assert.deepEqual(r.merged, []);
    assert.deepEqual(r.submitted.map((s) => [s.milestone, s.baseBranch]), [[0, null], [1, 'sz/tsk_m0']]);

    // Stopped by the owner: the milestone being built finishes and is recorded, and no other starts.
    const stopped = await runner.stop(r.projectId);
    assert.deepEqual([stopped.state, stopped.error], ['stopped', '소유자가 멈췄습니다.']);
    r.finish('tsk_m1', 'succeeded');
    runner.taskSettled('tsk_m1');
    await runner.idle();
    assert.deepEqual(runner.get(r.projectId)!.milestones.map((m) => m.state), ['built', 'built', 'planned']);
    assert.equal(r.submitted.length, 2);
    assert.equal(runner.get(r.projectId)!.state, 'stopped');

    // Run again, merging: the passed milestone's merge is refused, so it is not called built and its branch is kept.
    await runner.run(r.projectId, { autoMerge: true });
    assert.deepEqual(r.submitted.at(-1), { milestone: 2, baseBranch: null, id: 'tsk_m2' });
    r.fail.merge = 'main has moved on: the branch no longer applies';
    r.finish('tsk_m2', 'succeeded');
    runner.taskSettled('tsk_m2');
    await runner.idle();
    const refused = runner.get(r.projectId)!;
    assert.deepEqual([refused.state, refused.milestones[2]!.state, refused.milestones[2]!.error], ['stopped', 'failed', '검사는 통과했고 합치지 못했습니다: main has moved on: the branch no longer applies']);
    assert.equal(refused.error, '마일스톤 3 "끝과 몸"을 합치지 못했습니다: main has moved on: the branch no longer applies');

    // Run once more: it goes on from that branch. Cancelled this time: stopped again, saying so.
    r.fail.merge = null;
    await runner.run(r.projectId);
    assert.deepEqual(r.submitted.at(-1), { milestone: 2, baseBranch: 'sz/tsk_m2', id: 'tsk_m3' });
    r.finish('tsk_m3', 'cancelled');
    runner.taskSettled('tsk_m3');
    await runner.idle();
    assert.deepEqual([runner.get(r.projectId)!.state, runner.get(r.projectId)!.error], ['stopped', '마일스톤 3 "끝과 몸"이 취소됐습니다']);

    await runner.run(r.projectId);
    r.finish('tsk_m4', 'succeeded');
    runner.taskSettled('tsk_m4');
    await runner.idle();
    assert.deepEqual([runner.get(r.projectId)!.state, r.merged], ['done', ['sz/tsk_m4']]);
    // A map with a milestone built is not planned over.
    assert.throws(() => runner.plan(project, '다른 제품'), ConflictError);
    // A task that is nobody's milestone is nothing to the runner.
    store.insertTask({ id: 'tsk_other', projectId: r.projectId, kind: 'build', prompt: 'x', origin: 'desktop', budgetTokens: 1, branch: null, createdAt: 1 });
    runner.taskSettled('tsk_other');
    runner.taskSettled('tsk_gone');
    await runner.idle();
    assert.equal(existsSync(join(r.d.workspace, 'docs/product.json')), false, 'the runner itself writes nothing into a workspace');
  } finally {
    await r.d.cleanup();
  }
});

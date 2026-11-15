// The fine gear, end to end: a daemon with slots, a scripted engine, real git under the fake docker. A small edit
// runs in a slot beside the project's heavy task, is checked in proportion to what it changed, and lands on
// main by itself; a full check walks main with no engine.
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import type { EventEnvelope, Finding, Project, ScreenSpec as Plan } from '@studio-zero/protocol';
import { EDIT_BRIEF } from '../src/harness/prompts.ts';
import type { ScenarioOutcome, ScenarioRunnerLike, ScreenLook } from '../src/qa/ScenarioRunner.ts';
import type { SmokeOutcome, SmokeRunner } from '../src/qa/SmokeTester.ts';
import { slotOf, type Place } from '../src/sandbox/OrbStackManager.ts';
import { readScreenSpec } from '../src/scratch/ScreenSpec.ts';
import { sleep } from '../src/util/core.ts';
import { SCREEN_SPEC } from './fixtures-mockup.ts';
import { testDaemon, type TestDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
type Block = Anthropic.Beta.BetaContentBlock;
const use = (name: string, input: Record<string, unknown>): Block => ({ type: 'tool_use', id: `tu_${Math.random().toString(36).slice(2, 10)}`, name, input }) as Block;
const say = (text: string): Block => ({ type: 'text', text, citations: null }) as Block;

/**
 * An engine that answers by what it is asked: `answer` is given the task's first message and how many turns of
 * that conversation it has already taken. Two tasks at once each get their own script, whichever speaks first.
 */
function engine(answer: (request: string, turn: number, last: string) => Block[]): { sdk: Anthropic; sent: Anthropic.Beta.MessageCreateParams[] } {
  const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const base = { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_details: null, stop_sequence: null, usage };
  const sent: Anthropic.Beta.MessageCreateParams[] = [];
  const text = (content: unknown): string => (typeof content === 'string' ? content : JSON.stringify(content));
  const sdk = {
    beta: {
      messages: {
        stream: (params: Anthropic.Beta.MessageCreateParams) => {
          sent.push(structuredClone(params));
          const content = answer(text(params.messages[0]!.content), params.messages.filter((m) => m.role === 'assistant').length, text(params.messages.at(-1)!.content));
          return { finalMessage: async () => ({ ...base, content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }) };
        },
        parse: async (params: Anthropic.Beta.MessageCreateParams) => assert.fail(`no structured call is made on the fast track: ${String(params.system).slice(0, 60)}`),
      },
    },
  } as unknown as Anthropic;
  return { sdk, sent };
}

async function finished(studio: { getTask: (id: string) => { state: string } }, taskId: string): Promise<void> {
  for (let i = 0; i < 1500 && !['succeeded', 'failed', 'cancelled'].includes(studio.getTask(taskId).state); i++) await sleep(20);
}
async function until(what: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 1500 && !what(); i++) await sleep(20);
  assert.ok(what(), `never happened: ${label}`);
}
function bodies<T extends EventEnvelope['body']['type']>(trace: EventEnvelope[], type: T): Extract<EventEnvelope['body'], { type: T }>[] {
  return trace.flatMap((e) => (e.body.type === type ? [e.body as Extract<EventEnvelope['body'], { type: T }>] : []));
}

/** The chores product, with four scenarios: two log on the home screen, one fixes a chore on its own screen, one only signs up. */
const PLAN = (() => {
  const step = (id: string, screen: string, does: string, saves: string | null, outcome: string) => ({ id, screen, does, saves, outcome });
  const signUp = step('sign-up', 'A-01', '이메일과 비밀번호로 가입한다', 'auth 사용자와 members 행', '오늘 장부가 보인다');
  const plan = {
    ...SCREEN_SPEC,
    screens: SCREEN_SPEC.screens.map((screen) => ({ ...screen, elements: [], states: [] })),
    events: [],
    scenarios: [
      { id: 'first', role: 'housemate', steps: [signUp, step('log', 'H-01', '설거지 20분을 적는다', 'chores 행', '오늘 칸에 설거지가 보인다')] },
      { id: 'second', role: 'housemate', after: 'first', steps: [signUp, step('see', 'H-01', '다른 사람이 적은 것을 본다', null, '설거지가 보인다')] },
      { id: 'fix', role: 'housemate', steps: [signUp, step('edit-chore', 'S-01', '설거지 시간을 25분으로 고친다', 'chores 행', '25분이 보인다')] },
      { id: 'arrive', role: 'housemate', steps: [signUp] },
    ],
  };
  const read = readScreenSpec(plan, { works: true, draft: true });
  assert.ok(read.ok, `the fixture plan holds: ${read.ok ? '' : read.problems.join(' | ')}`);
  return read.spec;
})();
const FILES: Record<string, string> = {
  'docs/screens.json': JSON.stringify(PLAN),
  'src/components/Button.tsx': 'export const Button = (label: string) => label;\n',
  'src/screens/Auth.tsx': "export const screen = 'A-01';\n",
  'src/screens/Home.tsx': "import { Button } from '../components/Button';\nexport const screen = 'H-01';\nexport const log = Button('적기');\n",
  'src/screens/Chore.tsx': "export const screen = 'S-01';\nexport const save = '저장';\n",
};

interface Walk {
  slot: number;
  scenarios: string[];
  look: unknown;
  brief: boolean;
}
const major = (rule: string, message: string): Finding => ({ rule, category: 'typography', severity: 'major', source: 'dom', viewport: 'iphone-15-pro', route: '/', message, selector: null, bbox: null, fix: 'T7: fix it.' }) as unknown as Finding;
const look = (screen: string, scenario: string, findings: Finding[] = []): ScreenLook => ({ screen, scenario, findings, png: null });

/** A daemon with two slots a project, the chores product on its main, and a walk that says what the test tells it to. */
async function rig(answer: (request: string, turn: number, last: string) => Block[], walk: (call: Walk, n: number) => Promise<Partial<ScenarioOutcome>> | Partial<ScenarioOutcome> = () => ({})) {
  const walks: Walk[] = [];
  const scenarios: ScenarioRunnerLike = {
    run: async (project, spec, opts): Promise<ScenarioOutcome> => {
      const call: Walk = { slot: slotOf(project as Place), scenarios: spec.scenarios.map((s) => s.id), look: opts?.look ?? false, brief: opts?.brief === true };
      walks.push(call);
      const said = await walk(call, walks.length);
      const problems = said.problems ?? [];
      return { passed: problems.length === 0, scenarios: spec.scenarios.length, walked: problems.length === 0 ? spec.scenarios.length : 0, problems, logins: [], detail: `${spec.scenarios.length} walked`, durationMs: 7, looks: [], trails: {}, ...said };
    },
  };
  const smoke: SmokeRunner = { run: async (): Promise<SmokeOutcome> => ({ passed: true, routes: ['/'], issues: [], detail: '1 route loaded without errors', durationMs: 5 }) };
  const model = engine(answer);
  const d: TestDaemon = await testDaemon({ slots: { perProject: 2 }, queue: { concurrency: 3 } }, { anthropic: model.sdk, smoke, scenarios });
  await d.daemon.start();
  d.daemon.evals.measureDraft = async () => null;
  const { studio, sandboxes, provisioner, events, store, slots } = d.daemon;
  const project: Project = studio.createProject(OWNER, { name: 'Chores', slug: 'chores-app', template: 'mobile-expo' });
  await provisioner.ensure(project);
  for (const [path, content] of Object.entries(FILES)) await sandboxes.writeFile(project, path, content);
  await sandboxes.commitAll(project, 'feat: the chores product');
  const git = async (place: Place, script: string): Promise<string> => {
    const res = await sandboxes.exec(place, script);
    assert.equal(res.exitCode, 0, `${script}: ${res.stderr}`);
    return res.stdout.trim();
  };
  const submit = (kind: 'inline_edit' | 'build' | 'check', prompt: string) => studio.submitTask(OWNER, { projectId: project.id, kind, prompt, track: 'fast' }, 'desktop');
  const trace = (taskId: string): EventEnvelope[] => events.history({ taskId }, 0, 2000);
  const gates = (taskId: string): string[] => bodies(trace(taskId), 'gate.result').map((g) => `${g.gate}:${g.passed}`);
  const why = (taskId: string): string => `${studio.getTask(taskId).error}\n${trace(taskId).map((e) => JSON.stringify(e.body)).join('\n').slice(0, 5000)}`;
  const cleanup = async (): Promise<void> => {
    const dirs = [...d.docker.slots.values()];
    await d.cleanup();
    for (const dir of dirs) for (const path of [dir, `${dir}-scratch`]) rmSync(path, { recursive: true, force: true });
  };
  return { d, studio, sandboxes, store, slots, project, model, walks, git, submit, trace, gates, why, cleanup };
}

/** What each request in these tests has its engine do, by a word in the request. */
const CHORE = "export const screen = 'S-01';\nexport const save = '저장하기';\n";
const HOME = "import { Button } from '../components/Button';\nexport const screen = 'H-01';\nexport const log = Button('오늘 한 일 적기');\n";
const edits = (request: string, turn: number): Block[] => {
  if (turn > 0) return [say('고쳤습니다.')];
  if (request.includes('저장 버튼')) return [use('write_file', { path: 'src/screens/Chore.tsx', content: CHORE })];
  if (request.includes('적기 버튼')) return [use('write_file', { path: 'src/screens/Home.tsx', content: HOME })];
  if (request.includes('새 화면')) return [use('write_file', { path: 'src/screens/Stats.tsx', content: 'export const stats = 1;\n' })];
  return assert.fail(`no script for: ${request.slice(-80)}`);
};

test('a small edit runs in a slot while a build holds the project, is walked for the screen it changed, and lands on main', async () => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  // The build's walk (every scenario, in the project's own workspace) is held open: the build is "at work".
  const r = await rig(edits, async (call) => (call.slot === 0 ? (await held, {}) : { looks: [look('S-01', 'fix')], trails: { fix: [{ screen: 'S-01', step: 'edit-chore' }] } }));
  const { studio, project, git, sandboxes } = r;
  try {
    const build = await r.submit('build', '통계를 보는 새 화면을 만든다');
    await until(() => r.walks.some((w) => w.slot === 0), 'the build reached its walk');
    const before = await git(project, 'git rev-parse main');
    assert.equal(await git(project, 'git symbolic-ref --short HEAD'), `sz/${build.id}`, 'the project\'s workspace is on the build\'s branch');

    const edit = await r.submit('inline_edit', '집안일 고치기 화면의 저장 버튼 글자를 "저장하기"로');
    await finished(studio, edit.id);
    const done = studio.getTask(edit.id);
    assert.equal(done.state, 'succeeded', r.why(edit.id));
    assert.deepEqual([done.slot, done.track, done.branch], [1, 'fast', `sz/${edit.id}`]);
    assert.equal(studio.getTask(build.id).state, 'running', 'and the build is still at work');

    // Checked in proportion: one screen, and the one scenario of four with a step of its own there.
    assert.deepEqual(r.gates(edit.id), ['scope:true', 'scenarios:true', 'looks:true']);
    const scope = bodies(r.trace(edit.id), 'gate.result').find((g) => g.gate === 'scope')!;
    assert.equal(scope.name, '화면 1개 · 시나리오 1/4개');
    assert.equal(scope.detail, '1 of 4 scenarios walked (fix) and one screen measured (S-01): src/screens/Chore.tsx reaches screen S-01.');
    assert.deepEqual(r.walks.filter((w) => w.slot === 1), [{ slot: 1, scenarios: ['fix'], look: { only: ['S-01'] }, brief: true }]);

    // On main, as one commit, while the project's own checkout is left where the build has it.
    const landed = bodies(r.trace(edit.id), 'task.landed');
    assert.equal(landed.length, 1);
    assert.deepEqual([landed[0]!.into, landed[0]!.commit], ['main', done.landedCommit]);
    assert.equal(await git(project, 'git rev-parse main'), done.landedCommit);
    assert.equal(await git(project, 'git rev-parse main~1'), before);
    assert.equal(await git(project, 'git show main:src/screens/Chore.tsx'), CHORE.trim());
    assert.equal(await git(project, 'git symbolic-ref --short HEAD'), `sz/${build.id}`);
    assert.equal((await sandboxes.readFile(project, 'src/screens/Chore.tsx')).content, FILES['src/screens/Chore.tsx'], 'the build still sees the screen it started from');
    assert.equal((await sandboxes.readFile(project, 'src/screens/Stats.tsx')).content, 'export const stats = 1;\n');
    // The screen it was measured on is in the ledger as it left it, and the slot is free again.
    assert.deepEqual(r.store.getWalks(project.id)?.ledger['S-01']?.rules, []);
    assert.deepEqual(r.slots.holders(project.id), new Map());
    assert.equal(bodies(r.trace(edit.id), 'checkpoint.created').length, 0, 'a slot is not a place to go back to');

    // What its engine was told: that this is one change to a built product, not how to start one.
    const first = JSON.stringify(r.model.sent.find((p) => JSON.stringify(p.messages[0]).includes('저장 버튼'))!.messages[0]);
    assert.ok(first.includes(JSON.stringify(EDIT_BRIEF).slice(1, 80)) && !first.includes('This is a Draft 0 task'));

    // The build ends and is merged over the main the edit moved: both are there.
    release();
    await finished(studio, build.id);
    assert.equal(studio.getTask(build.id).state, 'succeeded', r.why(build.id));
    assert.equal(studio.getTask(build.id).slot, null);
    await studio.merge(OWNER, project.id, `sz/${build.id}`);
    assert.equal(await git(project, 'git show main:src/screens/Chore.tsx'), CHORE.trim());
    assert.equal(await git(project, 'git show main:src/screens/Stats.tsx'), 'export const stats = 1;');
  } finally {
    release();
    await r.cleanup();
  }
});

test('an edit that changes the backend is refused, told why, and does not land; what it made is in the project\'s repository to go on from', async () => {
  const r = await rig((request, turn, last) => {
    if (turn === 0) return [use('apply_schema', {}), use('write_file', { path: 'supabase/migrations/0002_minutes.sql', content: 'alter table chores add column minutes int;\n' }), use('write_file', { path: 'src/screens/Chore.tsx', content: CHORE })];
    return [say(last.includes('Check "scope" failed') ? '스키마 없이는 할 수 없습니다.' : '했습니다.')];
  });
  const { studio, project, git } = r;
  try {
    const before = await git(project, 'git rev-parse main');
    const edit = await r.submit('inline_edit', '집안일에 걸린 시간을 저장한다');
    await finished(studio, edit.id);
    const done = studio.getTask(edit.id);
    assert.deepEqual([done.state, done.landedCommit], ['failed', null]);
    assert.match(done.error ?? '', /^verification still failing after 3 corrections: scope$/);
    assert.ok(r.gates(edit.id).every((gate) => gate === 'scope:false') && r.gates(edit.id).length === 4, r.gates(edit.id).join(' '));
    assert.equal(r.walks.length, 0, 'nothing is walked for a change that cannot land');
    // The tool that changes the schema said no, from a slot, without touching the backend.
    const refused = bodies(r.trace(edit.id), 'tool.result').find((t) => JSON.stringify(t).includes('Not here. This is a small edit'));
    assert.ok(refused, 'apply_schema is refused in a slot');
    // What the engine was sent back with says what and why, as data.
    const repair = JSON.stringify(r.model.sent.at(-1)!.messages.at(-1));
    assert.match(repair, /This change cannot land as a small edit: it changes the backend \(supabase\/migrations\/0002_minutes\.sql\)/);
    // Main is where it was; the work is on its branch in the project's repository.
    assert.equal(await git(project, 'git rev-parse main'), before);
    assert.equal(await git(project, `git show sz/${edit.id}:supabase/migrations/0002_minutes.sql`), 'alter table chores add column minutes int;');
    assert.equal(bodies(r.trace(edit.id), 'task.landed').length, 0);
    assert.deepEqual(r.slots.holders(project.id), new Map());
  } finally {
    await r.cleanup();
  }
});

test('two edits at once, in two slots: the first lands, and the second is put on the main it moved, checked again there, and lands', async () => {
  let firstLanded = false;
  let secondWalks = 0;
  // The second edit's first walk waits for the first edit to be on main.
  const r = await rig(edits, async (call) => {
    if (call.scenarios.includes('first')) {
      secondWalks++;
      for (let i = 0; i < 1500 && !firstLanded; i++) await sleep(20);
    }
    return {};
  });
  const { studio, project, git } = r;
  try {
    const home = await r.submit('inline_edit', '오늘 장부의 적기 버튼 글자를 "오늘 한 일 적기"로');
    const chore = await r.submit('inline_edit', '집안일 고치기 화면의 저장 버튼 글자를 "저장하기"로');
    await finished(studio, chore.id);
    assert.equal(studio.getTask(chore.id).state, 'succeeded', r.why(chore.id));
    assert.deepEqual([studio.getTask(home.id).slot, studio.getTask(chore.id).slot].sort(), [1, 2], 'each in a slot of its own');
    firstLanded = true;
    await finished(studio, home.id);
    assert.equal(studio.getTask(home.id).state, 'succeeded', r.why(home.id));

    // The home screen is two scenarios' own, and the second goes on from the first; checked before and after main moved.
    assert.deepEqual(r.gates(home.id), ['scope:true', 'scenarios:true', 'looks:true', 'scope:true', 'scenarios:true', 'looks:true']);
    assert.equal(secondWalks, 2);
    assert.deepEqual(r.walks.filter((w) => w.scenarios.includes('first')).map((w) => [w.scenarios, w.look]), [[['first', 'second'], { only: ['H-01'] }], [['first', 'second'], { only: ['H-01'] }]]);
    // What it changed is still one file: what main gained meanwhile is not counted as its own.
    assert.deepEqual(bodies(r.trace(home.id), 'gate.result').filter((g) => g.gate === 'scope').map((g) => g.name), ['화면 1개 · 시나리오 2/4개', '화면 1개 · 시나리오 2/4개']);
    assert.equal(await git(project, 'git rev-parse main'), studio.getTask(home.id).landedCommit);
    assert.equal(await git(project, 'git rev-parse main~1'), studio.getTask(chore.id).landedCommit, 'one after the other');
    assert.deepEqual([await git(project, 'git show main:src/screens/Home.tsx'), await git(project, 'git show main:src/screens/Chore.tsx')], [HOME.trim(), CHORE.trim()]);
    // With nothing else at work, the project's own checkout is on main and its files are the landed ones.
    assert.equal(await git(project, 'git status --porcelain'), '');
    assert.equal(await git(project, 'cat src/screens/Home.tsx'), HOME.trim());
  } finally {
    firstLanded = true;
    await r.cleanup();
  }
});

test('a full check walks main with no engine, and writes down where the walk went and what each screen was found breaking', async () => {
  const trails = { first: [{ screen: 'A-01', step: 'sign-up' }, { screen: 'H-01', step: 'log' }], fix: [{ screen: 'A-01', step: 'sign-up' }, { screen: 'S-01', step: 'edit-chore' }] };
  const r = await rig(() => assert.fail('a full check asks no engine anything'), () => ({ looks: [look('H-01', 'first', [major('type/broken-label', '"적기" is broken onto 2 lines inside its control.')]), look('S-01', 'fix')], trails, problems: [] }));
  const { studio, project } = r;
  try {
    const check = await r.submit('check', '');
    await finished(studio, check.id);
    const done = studio.getTask(check.id);
    assert.equal(done.state, 'succeeded', r.why(check.id));
    assert.deepEqual([done.slot, done.spentTokens, done.engine, r.model.sent.length], [1, 0, null, 0]);
    // Every scenario, every screen measured, and the checks a small edit's walk leaves out.
    assert.deepEqual(r.walks, [{ slot: 1, scenarios: ['first', 'second', 'fix', 'arrive'], look: true, brief: false }]);
    assert.deepEqual(r.gates(check.id), ['scenarios:true', 'looks:false']);
    assert.equal(done.summary, '시나리오 4개 가운데 4개를 끝까지 걸었습니다(0초). 화면 2장을 쟀습니다.\n\n화면에서 잰 사소하지 않은 결함 1건:\n- H-01 화면 (시나리오 first) · 큰 결함 · type/broken-label: "적기" is broken onto 2 lines inside its control.');
    const walks = r.store.getWalks(project.id)!;
    assert.deepEqual(walks.trails, trails);
    assert.deepEqual([walks.ledger['H-01']?.rules, walks.ledger['S-01']?.rules], [['type/broken-label'], []]);
    assert.match(walks.commit ?? '', /^[0-9a-f]{40}$/);
    assert.equal(bodies(r.trace(check.id), 'task.landed').length, 0);
  } finally {
    await r.cleanup();
  }
});

test('an edit answers for the screen it changes: what it brings sends it back, and what the screen already had is put to it once, with the measurement', async () => {
  const had = major('type/broken-label', '"적기" is broken onto 2 lines inside its control.');
  const brought = major('responsive/clipped-text', '"오늘 한 일 적기" is cut off inside its box.');
  let editWalks = 0;
  const r = await rig(
    (request, turn, last) => {
      if (turn === 0) return [use('write_file', { path: 'src/screens/Home.tsx', content: HOME })];
      if (last.includes('your edit brought them')) return [use('write_file', { path: 'src/screens/Home.tsx', content: `${HOME}// room for the label\n` })];
      if (last.includes('This is put to you once')) return [say('적기 버튼의 줄바꿈은 요청과 무관하고 이 수정으로는 고칠 수 없어 남겨 둡니다.')];
      return [say('고쳤습니다.')];
    },
    (call) => {
      if (!call.brief) return { looks: [look('H-01', 'first', [had]), look('S-01', 'fix')], trails: { first: [{ screen: 'H-01', step: 'log' }] } };
      editWalks++;
      return { looks: [look('H-01', 'first', editWalks === 1 ? [had, brought] : [had])] };
    },
  );
  const { studio, project, git } = r;
  try {
    const check = await r.submit('check', '');
    await finished(studio, check.id);
    const edit = await r.submit('inline_edit', '오늘 장부의 적기 버튼 글자를 "오늘 한 일 적기"로');
    await finished(studio, edit.id);
    assert.equal(studio.getTask(edit.id).state, 'succeeded', r.why(edit.id));
    // Three rounds of looking: what it brought, then what was there before it (once), then through.
    assert.deepEqual(r.gates(edit.id).filter((gate) => gate.startsWith('looks')), ['looks:false', 'looks:false', 'looks:true']);
    const [first, second, third] = bodies(r.trace(edit.id), 'gate.result').filter((g) => g.gate === 'looks');
    assert.match(first!.detail, /^Screen H-01 \(scenario "first"\), major, responsive\/clipped-text: "오늘 한 일 적기" is cut off inside its box\. T7: fix it\.$/);
    assert.match(second!.detail, /^Screen H-01 \(scenario "first"\), major, type\/broken-label: "적기" is broken onto 2 lines inside its control\. T7: fix it\.$/);
    assert.equal(third!.detail, '1 screen the edit changed, measured as the walk stood on it: nothing above minor that is this edit\'s, besides 1 the screen already had on main, put to the edit once and still there');
    const sent = r.model.sent.map((p) => JSON.stringify(p.messages.at(-1)));
    const forBrought = sent.find((m) => m.includes('your edit brought them'))!;
    assert.ok(forBrought.includes('responsive/clipped-text') && !forBrought.includes('type/broken-label'), 'first for what it brought, and only that');
    const forOld = sent.find((m) => m.includes('This is put to you once'))!;
    assert.ok(forOld.includes('type/broken-label') && forOld.includes('before your edit') && !forOld.includes('responsive/clipped-text'));
    assert.equal(sent.filter((m) => m.includes('This is put to you once')).length, 1, 'once');
    // It lands, and what its screen is still found breaking is said to the owner and kept in the ledger.
    assert.equal(await git(project, 'git rev-parse main'), studio.getTask(edit.id).landedCommit);
    const warned = bodies(r.trace(edit.id), 'notice').find((n) => n.level === 'warn');
    assert.equal(warned?.message, 'main에 들어갔지만, 고친 화면에서 잰 결함 1건이 그대로 남아 있습니다:\n- H-01 화면 (시나리오 first) · 큰 결함 · type/broken-label: "적기" is broken onto 2 lines inside its control.');
    assert.match(studio.getTask(edit.id).summary ?? '', /Not verified: still measured on the screens this changed: H-01 화면 \(시나리오 first\) · 큰 결함 · type\/broken-label/);
    assert.deepEqual(r.store.getWalks(project.id)!.ledger['H-01']?.rules, ['type/broken-label']);
  } finally {
    await r.cleanup();
  }
});

test('an edit whose walk fails is sent back, and one that is cancelled leaves its work on a branch in the project\'s repository', async () => {
  let walks = 0;
  const hold: { release: (() => void) | null } = { release: null };
  const r = await rig(edits, async (call) => {
    walks++;
    if (call.scenarios.includes('first')) {
      // The second edit: its walk never ends until it is cancelled.
      await new Promise<void>((resolve) => (hold.release = resolve));
      return {};
    }
    return walks === 1 ? { problems: ['Scenario "fix" (같이 사는 사람), step 2 "edit-chore": nothing carrying data-done="edit-chore" came on screen.'] } : {};
  });
  const { studio, project, git } = r;
  try {
    const edit = await r.submit('inline_edit', '집안일 고치기 화면의 저장 버튼 글자를 "저장하기"로');
    await finished(studio, edit.id);
    assert.equal(studio.getTask(edit.id).state, 'succeeded', r.why(edit.id));
    assert.deepEqual(r.gates(edit.id), ['scope:true', 'scenarios:false', 'scope:true', 'scenarios:true', 'looks:true']);

    // While an edit is at work in a slot, the project's own workspace is free for what only needs it; the project itself is not free to go.
    const main = await git(project, 'git rev-parse main');
    const held = await r.submit('inline_edit', '오늘 장부의 적기 버튼 글자를 "오늘 한 일 적기"로');
    await until(() => hold.release !== null, 'the second edit reached its walk');
    await git(project, 'git branch side main');
    await studio.merge(OWNER, project.id, 'side');
    await assert.rejects(studio.deleteProject(OWNER, project.id, true), /cannot delete the project while task/);
    studio.cancelTask(held.id);
    hold.release!();
    await finished(studio, held.id);
    assert.deepEqual([studio.getTask(held.id).state, studio.getTask(held.id).landedCommit], ['cancelled', null]);
    assert.equal(await git(project, 'git rev-parse main'), main, 'nothing of it is on main');
    assert.equal(await git(project, `git show sz/${held.id}:src/screens/Home.tsx`), HOME.trim(), 'and what it had made can be gone on from');
    assert.deepEqual(r.slots.holders(project.id), new Map());
  } finally {
    hold.release?.();
    await r.cleanup();
  }
});

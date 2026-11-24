// The saved workflow `sz:build` is a script the Workflow tool runs. Here its own logic (what it does with what
// the agents return) is run with agents that answer from a table, so no model is called.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TAKES } from '../src/room.ts';
import { Claim, Contract } from '../src/contract.ts';

type Call = { prompt: string; label: string; effort?: string; model?: string };
type WorkerOptions = Omit<Call, 'prompt'>;
type MilestoneCall = (where: string | null, contract: string, prompt: string, options: WorkerOptions) => void;
type Answer = (call: Call, nth: number) => unknown;

const SOURCE = readFileSync(fileURLToPath(new URL('../../../plugin/workflows/build.js', import.meta.url)), 'utf8').replace('export const meta', 'const meta');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...names: string[]) => (...values: unknown[]) => Promise<any>;

/** Runs the script with agents answered by the first table entry whose key starts the agent's label. */
async function run(args: unknown, answers: Record<string, Answer>, observeMilestone?: MilestoneCall): Promise<{ result: any; calls: Call[]; allCalls: Call[]; logs: string[] }> {
  const calls: Call[] = [];
  const logs: string[] = [];
  const seen = new Map<string, number>();
  const agent = async (prompt: string, opts: { label: string; effort?: string; model?: string }): Promise<unknown> => {
    calls.push({ prompt, label: opts.label, ...(opts.effort ? { effort: opts.effort } : {}), ...(opts.model ? { model: opts.model } : {}) });
    const key = Object.keys(answers).find((k) => opts.label.startsWith(k));
    // Most fixtures have no published criterion. The facts stage still runs once before their plan.
    if (!key && opts.label === 'facts') return { needed: false, why: 'no published criterion' };
    // Nobody set a claim aside unless the test says so: the ruling on claims still false finds the product wrong.
    if (!key && opts.label.startsWith('rule:')) return { disputed: [] };
    if (!key) throw new Error(`no answer for ${opts.label}`);
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    return answers[key]!({ prompt, label: opts.label }, nth);
  };
  // Every run says whether the owner was asked beforehand; the tests that are not about that run as "away".
  const given = args && typeof args === 'object' && !('asked' in args) ? { asked: 'away', ...args } : args;
  const milestoneAgent = observeMilestone && ((where: string | null, contract: string, prompt: string, options: WorkerOptions) => {
    observeMilestone(where, contract, prompt, options);
    return agent(prompt, options);
  });
  const result = await new AsyncFunction('agent', 'phase', 'log', 'args', 'milestoneAgent', SOURCE)(agent, () => {}, (line: string) => logs.push(line), given, milestoneAgent);
  // Existing assertions compare the order and settings of the build stages; keep the complete trace for the pre-plan check.
  return { result, calls: calls.filter((c) => c.label !== 'facts'), allCalls: calls, logs };
}

const claim = (id: string) => ({ id, says: `${id} is true`, kind: 'test', ref: `test/${id}.test.mjs` });
const plan = (...ids: string[]) => () => ({ mode: 'extend', summary: 's', milestones: ids.map((id) => ({ id, title: `title ${id}`, builds: 'b', claims: [claim('one'), claim('two')] })) });
const built = ({ label }: Call) => ({ contractId: label.split(':')[1], summary: 'built', launch: 'PORT=$(sz-eyes port) node server.mjs' });
const closed = () => ({ report: 'r.html', closed: true, line: 'l' });

test('one fact check precedes the plan unless switched off, and unread rules are never planned as facts', async () => {
  const steps = { plan: plan('m1'), build: built, verify: () => ({ proven: ['one', 'two'], refuted: [], unchecked: [] }), close: closed };
  const args = { request: '요금 계산', asked: 'owner', answers: '공시 요금을 써요' };
  const ordinary = await run(args, steps);
  assert.deepEqual(ordinary.allCalls.map((c) => c.label), ['facts', 'plan', 'build:m1', 'verify:m1', 'close:m1']);
  const facts = ordinary.allCalls[0]!.prompt;
  assert.ok(facts.includes(args.request) && facts.includes(args.answers));
  assert.match(facts, /## 무엇을 정하는가[\s\S]+## 기준[\s\S]+## 예외[\s\S]+## 숫자[\s\S]+## 우리 제품에 걸리는 것[\s\S]+## 아직 못 읽은 것/);
  assert.match(ordinary.allCalls[1]!.prompt, /If `\.sz\/facts\.md` is there[\s\S]*?notReal/);
  const found = await run({ ...args, facts: 'on' }, { ...steps, facts: () => ({ needed: true, why: 'tariff', page: '.sz/facts.md' }) });
  assert.ok(found.logs.some((line) => line.includes('the fact page .sz/facts.md')));
  const silent = await run(args, { ...steps, facts: () => null });
  assert.ok(silent.logs.includes('the fact check did not answer: the plan is made without it'));
  assert.equal(silent.result.stopped, null);
  const off = await run({ ...args, facts: 'off' }, steps);
  assert.equal(off.allCalls[0]!.label, 'plan');
  assert.ok(!off.allCalls.some((c) => c.label === 'facts'));
});

test('the workflow does not start until it is told whether the owner was asked', async () => {
  const table = { plan: plan('m1', 'm2'), build: built, verify: () => ({ proven: ['one', 'two'], refuted: [], unchecked: [] }), close: closed };

  const silent = await run({ request: '택배 비교', asked: undefined }, table);
  assert.match(silent.result.error, /not started: say whether the owner was asked/);
  assert.match(silent.result.error, /AskUserQuestion/);
  assert.equal(silent.allCalls.length, 0, 'no agent runs before that is said');

  const own = await run({ request: '택배 비교', asked: 'owner' }, table);
  assert.match(own.result.error, /needs answers/, 'the session\'s own answers cannot pass as the owner\'s by being left out');

  const chose = await run({ request: '택배 비교', asked: 'owner', answers: '계정: 필요 (거래 내역 저장)' }, table);
  const planned = chose.calls.find((c) => c.label === 'plan')!.prompt;
  assert.match(planned, /What the owner answered when asked beforehand, in their words:\n계정: 필요/);
  assert.ok(chose.logs.some((l) => /planned from what the owner answered; 2 milestone\(s\) to go, expect about 40 to 60 minutes/.test(l)), chose.logs.join('\n'));

  const away = await run({ request: '택배 비교', asked: 'away', answers: '계정 없음으로 정함' }, table);
  const alone = away.calls.find((c) => c.label === 'plan')!.prompt;
  assert.match(alone, /The owner was not asked anything beforehand/);
  assert.match(alone, /its own words, not the owner's\):\n계정 없음으로 정함/, 'what the session decided is passed on as the session\'s, never as the owner\'s');
  assert.ok(away.logs.some((l) => /the owner was not asked beforehand/.test(l)));
});

test('a milestone an earlier run built is started before anyone looks at it, and a run does not go on past one that was not looked at', async () => {
  const resumedPlan = () => ({
    mode: 'continue',
    summary: 's',
    milestones: [
      { id: 'm1', title: 'M1 계정', builds: 'b', claims: [claim('one'), claim('two')], state: 'built', contractId: 'm1-accounts', launch: 'npx expo run:ios (never run yet)' },
      { id: 'm2', title: 'M2 대결', builds: 'b', claims: [claim('one'), claim('two')] },
    ],
  });
  const proven = () => ({ proven: ['one', 'two'], refuted: [], unchecked: [] });

  // It starts: the verifier is given the command that was seen to work, not the one that was only written down.
  const ran = await run({ request: '이어서' }, { plan: resumedPlan, start: () => ({ launch: 'sz-eyes ios install $udid ios/build/app.app', summary: 'auth 라우트의 무한 루프를 고쳤다' }), build: built, verify: proven, close: closed });
  const labels = ran.calls.map((c) => c.label);
  assert.deepEqual(labels.slice(0, 4), ['plan', 'start:m1', 'verify:m1', 'close:m1']);
  assert.ok(!labels.includes('build:m1'), 'what was built is not built again');
  assert.match(ran.calls.find((c) => c.label === 'start:m1')!.prompt, /If it does not start, the cause is yours to find and to fix in the product/);
  assert.match(ran.calls.find((c) => c.label === 'verify:m1')!.prompt, /launched like this: sz-eyes ios install \$udid ios\/build\/app\.app/);
  assert.ok(labels.includes('build:m2'));

  // It cannot be started for a reason outside it: nobody waits, nobody verifies, nothing is built on top.
  const stuck = await run({ request: '이어서' }, { plan: resumedPlan, start: () => ({ launch: '', blocked: 'pod install이 2KB/s로 받다 멈춤' }), build: built, verify: proven, close: closed });
  assert.deepEqual(stuck.calls.map((c) => c.label), ['plan', 'start:m1']);
  assert.match(stuck.result.stopped, /was built by an earlier run and could not be started: pod install이 2KB\/s로 받다 멈춤.*tell the owner what it is and ask/);

  // The contract tool refuses to close a milestone most of which was not looked at: the run stops there.
  const unseen = await run(
    { request: '이어서' },
    { plan: resumedPlan, start: () => ({ launch: 'x' }), build: built, verify: () => ({ proven: ['one'], refuted: [], unchecked: [{ id: 'two', why: '앱 빌드가 없음' }] }), close: () => ({ report: 'r.html', closed: false, why: 'contract m1-accounts was not looked at: 6 of its 7 claims are unchecked' }) },
  );
  assert.ok(!unseen.calls.some((c) => c.label === 'build:m2'), 'the next milestone is not built on one that was not looked at');
  assert.match(unseen.result.stopped, /did not close: contract m1-accounts was not looked at/);
  assert.match(unseen.calls.find((c) => c.label === 'close:m1')!.prompt, /do not pass `--accepted` \(that is the owner's to say\)/);
});

test('a claim whose own words are wrong is set aside for the owner, and the run goes on', async () => {
  const table = (extra: Record<string, Answer>) => ({
    plan: plan('m1', 'm2'),
    build: built,
    close: closed,
    ...extra,
  });
  // The fixer says one claim cannot be made true; someone who built nothing reads the source and sets it aside.
  const ran = await run(
    { request: 'x' },
    table({
      verify: ({ label }: Call, nth: number) => (label === 'verify:m1' ? { proven: [], refuted: [{ id: 'one', fact: '착한택배가 X로 나옴' }, { id: 'two', fact: '합계가 0' }], unchecked: [] } : label === 'verify:m1:again' ? { proven: ['two'], refuted: [], unchecked: [] } : { proven: ['one', 'two'], refuted: [], unchecked: [], nth }),
      fix: () => ({ fixed: ['two'], notFixed: ['one: 공식 안내는 80cm라 약속대로는 만들 수 없음'] }),
      rule: () => ({ disputed: [{ id: 'one', ruling: '약속은 100cm, 세븐일레븐 안내는 80cm' }], productWrong: [] }),
    }),
  );
  assert.deepEqual(ran.calls.map((c) => c.label).slice(0, 8), ['plan', 'build:m1', 'verify:m1', 'fix:m1:1', 'rule:m1', 'verify:m1:again', 'close:m1', 'build:m2']);
  const ruling = ran.calls.find((c) => c.label === 'rule:m1')!.prompt;
  assert.match(ruling, /one: 착한택배가 X로 나옴[\s\S]*one: 공식 안내는 80cm라 약속대로는 만들 수 없음/);
  assert.match(ruling, /when in doubt it is this one[\s\S]*sz-eyes contract dispute m1 <claim id> --ruling/);
  // Only what the fixer says cannot be made true is ruled on: the claim it mended is looked at again in any case.
  // (2026-11-18: handed all three refuted claims, the arbiter ran the flows of the two just mended, 8 of its 16 minutes.)
  assert.doesNotMatch(ruling, /two: 합계가 0/, 'a claim that was mended is not handed to whoever rules');
  assert.match(ruling, /The other claims shown false at that look were mended and are looked at again after you/);
  assert.match(ran.calls.find((c) => c.label === 'fix:m1:1')!.prompt, /each line of "notFixed" starts with the id of its claim and a colon/);
  // 2026-11-22: a rule test frozen with its contract expected an answer the cited source refuses. Two fixers kept it
  // passing, each look found the product wrong by the source in another case, and the milestone stayed open after
  // 304 minutes with nobody having ruled on the test. Whoever fixes says so instead, and whoever rules settles it.
  assert.match(ran.calls.find((c) => c.label === 'fix:m1:1')!.prompt, /Where the claim's own figure, or a frozen test or flow it is shown by, asks for an answer that the claim's source refuses[\s\S]*no fix makes both true: do not bend the product to the figure or the check against its source, and do not leave it wrong by the source to keep a check passing[\s\S]*put it under "notFixed": the file and the case, what is expected there, and the source's sentence with its address/);
  assert.match(ruling, /Or the claim's own figure, or a frozen test or flow it is shown by, asks for an answer its source refuses and the product gives that answer: then no product is right by both, and which reading holds is the owner's to say\. Record it the same way, with the file and the case beside the source's sentence/);
  // A line that names no claim leaves every claim shown false to be ruled on, as before.
  const unnamed = await run(
    { request: 'x' },
    table({
      verify: ({ label }: Call) => (label === 'verify:m1' ? { proven: [], refuted: [{ id: 'one', fact: '착한택배가 X로 나옴' }, { id: 'two', fact: '합계가 0' }], unchecked: [] } : label === 'verify:m1:again' ? { proven: ['two'], refuted: [], unchecked: [] } : { proven: ['one', 'two'], refuted: [], unchecked: [] }),
      fix: () => ({ fixed: ['two'], notFixed: ['one: 공식 안내는 80cm', '약속대로는 만들 수 없는 것이 하나 더 있음'] }),
      rule: () => ({ disputed: [{ id: 'one', ruling: '약속은 100cm, 세븐일레븐 안내는 80cm' }], productWrong: [] }),
    }),
  );
  const whole = unnamed.calls.find((c) => c.label === 'rule:m1')!.prompt;
  assert.match(whole, /- one: 착한택배가 X로 나옴\n- two: 합계가 0/);
  assert.doesNotMatch(whole, /The other claims shown false at that look were mended/);
  assert.match(ran.calls.find((c) => c.label === 'fix:m1:1')!.prompt, /take those pictures again from the product as you leave it/);
  assert.doesNotMatch(ran.calls.find((c) => c.label === 'verify:m1:again')!.prompt, /shown false before: one/, 'what was set aside is not looked at again');
  assert.match(ran.calls.find((c) => c.label === 'verify:m1:again')!.prompt, /These claims of the contract were shown false before: two\./);
  assert.equal(ran.result.stopped, null);
  assert.deepEqual(ran.result.forOwner, ['m1/one: 약속은 100cm, 세븐일레븐 안내는 80cm']);
  assert.deepEqual(ran.result.milestones[0].proven, ['two']);
  assert.ok(ran.logs.some((l) => /claim "one" is set aside for the owner/.test(l)));

  // Two fixes and still false, the fixer said nothing: it is ruled on once at the end, and when the product is wrong the run stops as before.
  const wrong = await run(
    { request: 'x', model: 'sonnet' },
    table({ verify: () => ({ proven: ['one'], refuted: [{ id: 'two', fact: '합계가 0' }], unchecked: [] }), fix: () => ({ fixed: [] }), close: () => ({ report: 'r.html', closed: false, line: 'l' }) }),
  );
  assert.deepEqual(wrong.calls.map((c) => c.label), ['plan', 'build:m1', 'verify:m1', 'fix:m1:1', 'verify:m1:again', 'fix:m1:2', 'verify:m1:again', 'rule:m1:last', 'close:m1']);
  // Whoever mends a milestone runs on the model that built it; those who verify and rule are not given one.
  assert.deepEqual(wrong.calls.map((c) => c.model), [undefined, 'sonnet', undefined, 'sonnet', undefined, 'sonnet', undefined, undefined, undefined]);
  assert.match(wrong.result.stopped, /still has 1 claim\(s\) shown false/);
  assert.deepEqual(wrong.result.forOwner, []);

  // The only false claim is set aside by the last ruling: the milestone closes and the next is built.
  const freed = await run(
    { request: 'x' },
    table({ verify: ({ label }: Call) => (label.startsWith('verify:m1') ? { proven: ['one'], refuted: [{ id: 'two', fact: '액체가 확인 필요로 나옴' }], unchecked: [] } : { proven: ['one', 'two'], refuted: [], unchecked: [] }), fix: () => ({ fixed: [] }), rule: () => ({ disputed: [{ id: 'two', ruling: '출처가 없는 기준' }] }) }),
  );
  assert.ok(freed.calls.some((c) => c.label === 'build:m2'));
  assert.equal(freed.result.stopped, null);
});

test('a builder is told to start what it built, and a phone app is shown in a browser until the pass that puts it on the phone', async () => {
  const { calls } = await run({ request: '다이어트 배틀 앱' }, { plan: plan('m1'), build: built, verify: () => ({ proven: ['one', 'two'], refuted: [], unchecked: [] }), close: closed });
  assert.match(calls.find((c) => c.label === 'build:m1')!.prompt, /Start the product yourself with one command and see it running before you return/);
  assert.match(calls.find((c) => c.label === 'build:m1')!.prompt, /A milestone that has never run is not built/);
  const planned = calls.find((c) => c.label === 'plan')!.prompt;
  assert.match(planned, /it is built so that the same app runs in a browser, and until the last pass it is shown there, at phone size/);
  assert.match(planned, /Only when the toolkit cannot run in a browser does the first pass begin with the empty app running on a simulator/);
});

test('a new product is planned twice: its first pass alone, and what comes after it once that stands', async () => {
  const cut = { id: 'm1', title: '첫 판', builds: '온 제품을 가장 얇게', claims: [claim('one'), claim('two')] };
  const deep = (id: string) => ({ id, title: `깊이 ${id}`, builds: 'b', claims: [claim('one'), claim('two')] });
  const proven = () => ({ proven: ['one', 'two'], refuted: [], unchecked: [] });
  const twice = (second: unknown) => (_call: Call, nth: number) =>
    nth === 0 ? { mode: 'new', summary: 's', milestones: [cut], later: [{ title: '대결 깊이', what: '빈 상태와 실패' }, { title: '폰에서', what: '네이티브 빌드' }] } : second;

  const ran = await run({ request: '다이어트 배틀 앱' }, { plan: twice({ mode: 'continue', summary: 's', milestones: [{ ...cut, state: 'closed' }, deep('m2'), deep('m3')] }), build: built, verify: proven, close: closed });
  assert.deepEqual(ran.calls.map((c) => c.label), ['plan', 'build:m1', 'verify:m1', 'close:m1', 'plan:after', 'build:m2', 'verify:m2', 'close:m2', 'build:m3', 'verify:m3', 'close:m3']);
  const first = ran.calls.find((c) => c.label === 'plan')!.prompt;
  assert.match(first, /\*\*The first pass\*\* is the one milestone you return: the whole product, at the quality it will be used at, built in one stretch/);
  assert.match(first, /a flow \(name the file it will be kept in: whoever verifies writes it\), a test of what is pure rule \(written before the code\)/);
  assert.match(first, /Nothing pretends/);
  assert.doesNotMatch(first, /This run has just built and closed the product's first pass/);
  const firstBuild = ran.calls.find((c) => c.label === 'build:m1')!.prompt;
  assert.match(firstBuild, /This milestone is the product's first pass: all of it, in one stretch, by you/);
  assert.match(firstBuild, /commit with a message that begins \\?"look:\\?"/);
  assert.match(firstBuild, /Do not write the flows: whoever verifies writes each of them on the product as it stands/);
  // The builder says when it stands, so that the owner can be shown it while it is verified, and the run says so too.
  assert.match(firstBuild, /Then say that it stands: `sz-eyes contract built m1 --launch "<that command, and where it is seen>"`/);
  assert.ok(ran.logs.some((l) => /^BUILT: "첫 판" stands and is being verified\. It can be looked at now: PORT=\$\(sz-eyes port\) node server\.mjs/.test(l)), ran.logs.join('\n'));
  assert.doesNotMatch(firstBuild, /Write the oracle first/);
  const laterBuild = ran.calls.find((c) => c.label === 'build:m2')!.prompt;
  assert.doesNotMatch(laterBuild, /This milestone is the product's first pass/);
  // Work on a product that stands is checked the same way: its builder writes the tests of pure rule first and
  // leaves the flows to whoever verifies. (2026-11-18: a phone milestone's builder wrote its flows before the
  // code, drove a simulator against them for 92 minutes, and ten of them were then ruled wrong one by one.)
  assert.doesNotMatch(laterBuild, /Write the oracle first/);
  assert.match(laterBuild, /Write first only the tests of what is pure rule[\s\S]*Do not write the flows: whoever verifies writes each of them on the product as it stands/);
  assert.match(laterBuild, /where the product's screens were drawn before it was built \(`\.sz\/design\/direction\.md` is there\), the look is the one drawn/, 'a later milestone keeps to the drawing');
  assert.match(ran.calls.find((c) => c.label === 'verify:m1')!.prompt, /The flows of this contract have not been written[\s\S]*sz-eyes contract add-check m1 --frozen/);
  assert.match(ran.calls.find((c) => c.label === 'verify:m2')!.prompt, /The flows of this contract have not been written[\s\S]*sz-eyes contract add-check m2 --frozen/);
  assert.match(ran.calls.find((c) => c.label === 'plan:after')!.prompt, /This run has just built and closed the product's first pass[\s\S]*go through the pictures of every area and what its verifiers noticed[\s\S]*what the owner has said since the first pass comes before the spec/);
  assert.ok(ran.logs.some((l) => /After it, planned when it stands: 대결 깊이 \/ 폰에서/.test(l)), ran.logs.join('\n'));
  assert.ok(ran.logs.some((l) => /^FIRST PASS READY\. The whole product can be looked at now: PORT=\$\(sz-eyes port\) node server\.mjs\. Every screen: r\.html/.test(l)), ran.logs.join('\n'));
  assert.ok(ran.logs.some((l) => /planned after the first pass: 2 milestone\(s\): 깊이 m2 \/ 깊이 m3/.test(l)));
  assert.equal(ran.result.stopped, null);
  assert.deepEqual(ran.result.milestones.map((m: { id: string }) => m.id), ['m1', 'm2', 'm3']);
  assert.deepEqual(ran.result.notBuilt, []);

  // A run asked to end with its first pass does not plan what comes after: the run that builds it plans it.
  const capped = await run({ request: 'x', maxMilestones: 1 }, { plan: twice({ mode: 'continue', summary: 's', milestones: [{ ...cut, state: 'closed' }, deep('m2')] }), build: built, verify: proven, close: closed });
  assert.deepEqual(capped.calls.map((c) => c.label), ['plan', 'build:m1', 'verify:m1', 'close:m1']);
  assert.equal(capped.result.stopped, null);
  assert.deepEqual(capped.result.notBuilt, ['대결 깊이', '폰에서']);

  // A planner that returns the later work as milestones at once: only the first pass is built from that plan.
  const eager = await run({ request: 'x' }, { plan: (_c: Call, nth: number) => (nth === 0 ? { mode: 'new', summary: 's', milestones: [cut, deep('m2'), deep('m3')] } : { mode: 'continue', summary: 's', milestones: [deep('m9')] }), build: built, verify: proven, close: closed });
  assert.deepEqual(eager.calls.map((c) => c.label), ['plan', 'build:m1', 'verify:m1', 'close:m1', 'plan:after', 'build:m9', 'verify:m9', 'close:m9']);

  // Nothing comes back from the second plan: the first pass stands, the run says what is still listed.
  const alone = await run({ request: 'x' }, { plan: twice({ mode: 'continue', summary: 's', milestones: [{ ...cut, state: 'closed' }] }), build: built, verify: proven, close: closed });
  assert.match(alone.result.stopped, /the first pass is closed, and what comes after it was not planned[\s\S]*Still listed: 대결 깊이 \/ 폰에서/);
  assert.deepEqual(alone.result.milestones.map((m: { id: string }) => m.id), ['m1']);

  // The first pass does not close: nothing after it is planned, and what was listed is reported as not built.
  const broke = await run({ request: 'x' }, { plan: twice(null), build: built, fix: () => ({ fixed: [] }), verify: () => ({ proven: ['one'], refuted: [{ id: 'two', fact: '합계가 0' }], unchecked: [] }), close: () => ({ report: 'r.html', closed: false, line: 'l' }) });
  assert.ok(!broke.calls.some((c) => c.label === 'plan:after'));
  assert.deepEqual(broke.result.notBuilt, ['대결 깊이', '폰에서']);

  // A run that takes up a product whose first pass never closed: the first pass again, then the plan after it.
  const resumed = await run(
    { request: '이어서' },
    { plan: (_c: Call, nth: number) => (nth === 0 ? { mode: 'continue', summary: 's', milestones: [{ ...cut, first: true }], later: [{ title: '대결 깊이', what: 'w' }] } : { mode: 'continue', summary: 's', milestones: [{ ...cut, state: 'closed' }, deep('m2')] }), build: built, verify: proven, close: closed },
  );
  assert.deepEqual(resumed.calls.map((c) => c.label), ['plan', 'build:m1', 'verify:m1', 'close:m1', 'plan:after', 'build:m2', 'verify:m2', 'close:m2']);
  assert.match(resumed.calls.find((c) => c.label === 'build:m1')!.prompt, /This milestone is the product's first pass/);
  assert.ok(resumed.logs.some((l) => /^continuing\. First pass: 첫 판\. After it, planned when it stands: 대결 깊이/.test(l)), resumed.logs.join('\n'));

  // A milestone with much to show is looked at by several verifiers at once, each with claims and a copy of the
  // product of its own. How many, and which claims each has, goes by what the claims cost to show: a flow or a
  // look is three tests' worth. (2026-11-17: twenty claims cut in three by their order gave one verifier seven
  // flows and 74 minutes, the others 45 and 61; the fix waited for the slowest.)
  const many = Array.from({ length: 10 }, (_, k) => ({ ...claim(`c${k + 1}`), kind: 'flow', ref: `flows/c${k + 1}.flow` }));
  const big = await run(
    { request: 'x' },
    {
      plan: () => ({ mode: 'new', summary: 's', milestones: [{ id: 'm1', title: '첫 판', builds: 'b', claims: many }] }),
      build: built,
      verify: ({ label, prompt }: Call) => {
        if (label === 'verify:m1:1of3') return { proven: ['c1', 'c2', 'c3', 'c9'], refuted: [], unchecked: [], stood: 0, noticed: ['첫째가 본 것'] };
        if (label === 'verify:m1:2of3') return { proven: ['c5', 'c6'], refuted: [{ id: 'c7', fact: '합계가 0' }], unchecked: [{ id: 'c8', why: '키가 없음' }] };
        if (label === 'verify:m1:3of3') return { proven: ['c9'], refuted: [], unchecked: [] };
        return { proven: ['c7'], refuted: [], unchecked: [], prompt };
      },
      fix: () => ({ fixed: ['c7'] }),
      close: closed,
    },
  );
  // After the fix the look is shared too, by fewer: the flows are written, and each verifier shows its own claims
  // again. (2026-11-18: one verifier took 33 minutes over 17 claims at the second look, the fix behind it.)
  assert.deepEqual(big.calls.filter((c) => c.label.startsWith('verify')).map((c) => c.label), ['verify:m1:1of3', 'verify:m1:2of3', 'verify:m1:3of3', 'verify:m1:again:1of2', 'verify:m1:again:2of2']);
  const [againFirst, againSecond] = ['verify:m1:again:1of2', 'verify:m1:again:2of2'].map((label) => big.calls.find((c) => c.label === label)!.prompt);
  assert.match(againSecond!, /This is a second look, after a fix\. These claims of the contract were shown false before: c7\. Check each from the start/);
  // Where new cases are tried is said to both; a verifier whose share holds nothing shown false is not pointed at claims "named above".
  assert.match(againSecond!, /only where the fix reached: on the claims named above as shown false before, and on any other claim of yours whose screens or rules the fix changed/);
  assert.match(againFirst!, /only where the fix reached: on any claim of yours whose screens or rules the fix changed/);
  assert.doesNotMatch(againFirst!, /named above as shown false before/);
  assert.match(againSecond!, /You are one of 2 verifiers[\s\S]*Yours are these claims: c6, c7, c8, c9, c10\. Give a verdict to these and to no other\. Do not show again what stood before this work/);
  assert.match(againSecond!, /show again your other claims, each by its own flow, test or command; flows that would get in each other's way/);
  assert.doesNotMatch(againSecond!, /whole check command|noticed outside the claims/, 'the whole check and what was noticed before are the first verifier\'s');
  assert.match(againSecond!, /Under "noticed" return only what you notice that is new/);
  assert.doesNotMatch(againFirst!, /were shown false before/, 'a verifier with no mended claim of its own only shows its claims again');
  assert.match(againFirst!, /Yours are these claims: c1, c2, c3, c4, c5\./);
  assert.match(againFirst!, /show again your other claims, each by its own flow, test or command, and what stood before this work \(`sz-eyes standing`\) with the project's quick checks/);
  assert.match(againFirst!, /this was noticed outside the claims: \[첫째가 본 것\]/);
  // What was noticed where the fix did not reach is returned as it is, not walked to again.
  assert.match(againFirst!, /One that lies where the fix did not reach is still so: return it as it is, without walking to it again\. Walk again only to those on a screen or in a rule the fix changed, and drop one the fix has ended\. Under "noticed" return those that are still so and whatever you notice that is new/);
  assert.match(againFirst!, /Start a copy of the product of your own/);
  const second = big.calls.find((c) => c.label === 'verify:m1:2of3')!.prompt;
  assert.match(second, /You are one of 3 verifiers[\s\S]*Yours are these claims: c4, c5, c6, c7\. Give a verdict to these and to no other\. Do not show again what stood before this work/);
  assert.match(second, /Start a copy of the product of your own, on a port of your own and with a place of its own for what it stores/);
  assert.match(second, /if it runs on a simulator, a simulator of your own/);
  assert.match(second, /`sz-eyes copy <a folder outside the project>` makes one from what is committed/);
  // Ten tests are one verifier's work; thirteen flows, two looks over every screen and four small checks are five's.
  const shares = async (claims: unknown[]): Promise<string[][]> => {
    const looked = await run({ request: 'x' }, { plan: () => ({ mode: 'new', summary: 's', milestones: [{ id: 'm1', title: '첫 판', builds: 'b', claims }] }), build: built, verify: () => ({ proven: [], refuted: [], unchecked: [] }), close: closed });
    return looked.calls.filter((c) => c.label.startsWith('verify')).map((c) => (/Yours are these claims: ([^.]*)\./.exec(c.prompt)?.[1] ?? 'all').split(', '));
  };
  assert.deepEqual(await shares(Array.from({ length: 10 }, (_, k) => claim(`t${k + 1}`))), [['all']]);
  const flow = (id: string, says = `${id} is true`) => ({ id, says, kind: 'flow', ref: `e2e/${id}.sh` });
  const diet = [claim('rules'), claim('tips'), flow('signin'), { id: 'kakao', says: 'the owner signs in', kind: 'owner', ref: 'the app' }, ...['weigh', 'edge', 'random', 'invite', 'ai', 'battle', 'result', 'rank', 'collect', 'log', 'kept'].map((id) => flow(id)), { id: 'strangers', says: 's', kind: 'command', ref: 'c' }, { id: 'ops', says: 'o', kind: 'command', ref: 'c' }, { id: 'as-drawn', says: 'every screen is built as drawn', kind: 'look', ref: 'pairs' }, flow('limits', 'every screen holds at its limits'), { id: 'feel', says: 'the owner says it is the app', kind: 'owner', ref: 'the app' }];
  assert.deepEqual(await shares(diet), [['rules', 'tips', 'signin', 'kakao', 'weigh', 'edge'], ['random', 'invite', 'ai'], ['battle', 'result', 'rank', 'collect'], ['log', 'kept', 'strangers', 'ops'], ['as-drawn', 'limits', 'feel']]);
  assert.match(big.calls.find((c) => c.label === 'verify:m1:1of3')!.prompt, /You are also the one who shows again what stood before this work/);
  const entry = big.result.milestones[0];
  assert.deepEqual([...entry.proven].sort(), ['c1', 'c2', 'c3', 'c5', 'c6', 'c7', 'c9'], 'a verdict counts only from the verifier that was given the claim (c9 from the first is not taken), and c7 is proven after its fix');
  assert.deepEqual(entry.unchecked.map((u: { id: string }) => u.id).sort(), ['c10', 'c4', 'c8'], 'a claim its verifier said nothing about has not been looked at');

  // A product with nothing after its first pass is built from one plan.
  const small = await run({ request: 'x' }, { plan: () => ({ mode: 'new', summary: 's', milestones: [cut] }), build: built, verify: proven, close: closed });
  assert.deepEqual(small.calls.map((c) => c.label), ['plan', 'build:m1', 'verify:m1', 'close:m1']);
});

test('a claim about every screen is shown once at the product\'s limits, mended wherever the same thing is shown, and a second look runs the whole check once', async () => {
  const cut = { id: 'm1', title: '첫 판', builds: '온 제품', claims: [claim('one'), claim('two')] };
  const first = { proven: ['one'], refuted: [{ id: 'two', fact: '12자 닉네임이 대결 화면과 피드에서 잘린다' }], unchecked: [] };
  const ran = await run({ request: '다이어트 배틀 앱' }, {
    plan: (_call, nth) => (nth === 0 ? { mode: 'new', summary: 's', milestones: [cut], later: [] } : { mode: 'continue', summary: 's', milestones: [{ ...cut, state: 'closed' }] }),
    build: built, fix: () => ({ fixed: ['two'] }), verify: (_call, nth) => (nth === 0 ? first : { proven: ['two'], refuted: [], unchecked: [] }), close: closed,
  });
  const planned = ran.calls.find((c) => c.label === 'plan')!.prompt;
  assert.match(planned, /A claim about every screen \(nothing cut off, nothing that scrolls sideways, nothing to press smaller than 44px\) is a claim at the product's limits/);
  assert.match(planned, /the spec states each limit[\s\S]*shown by a flow that fills every field with its longest value and measures every screen in every state/);
  assert.match(ran.calls.find((c) => c.label === 'build:m1')!.prompt, /Before you return, fill every field with the longest value the spec allows and look at every screen at phone size[\s\S]*mend it wherever the same thing is shown/);
  const look = ran.calls.find((c) => c.label === 'verify:m1')!.prompt;
  assert.match(look, /A claim about every screen at the product's limits is one flow too: it fills every field a person can type into[\s\S]*prints every finding above minor with its screen, and fails when there is one/);
  assert.match(look, /Report every finding it prints, not the first/);
  const mend = ran.calls.find((c) => c.label === 'fix:m1:1')!.prompt;
  assert.match(mend, /mend the cause wherever the same thing is shown, not only in the place named, and run that claim's flow over the whole product until it reports nothing before you return/);
  // Whoever mends runs the checks of what it mended and the quick ones; the rest is run once, by whoever looks
  // again. (2026-11-17: a fixer ran sixteen flows one after another and waited 48 of its 74 minutes on them; the
  // verifier then ran them all again.)
  assert.match(mend, /Run the check of each claim you were handed until it passes[\s\S]*the project's quick checks \(its type check and its tests of pure rule\)\. Do not run the other flows/);
  assert.doesNotMatch(mend, /Check that what was already true still is/);
  const again = ran.calls.find((c) => c.label === 'verify:m1:again')!.prompt;
  assert.match(again, /by the project's whole check command run once where it has one, and a flow, test or command by itself only where that run failed or says nothing of a claim/);
  assert.match(again, /each on a copy of the product of its own \(`sz-eyes copy`\), at the same time and not one after another/);
  assert.doesNotMatch(again, /run once more every flow, test and command/, 'the second look is no longer told to run each check by itself');
  assert.match(again, /judged by its flow, at the limits the spec states: an input the product does not accept shows nothing about it/);
  assert.doesNotMatch(again, /The flows of this contract have not been written/, 'flows are written at the first look only');
  assert.deepEqual(ran.result.milestones[0].proven, ['one', 'two']);
});

// ---- a new product's screens, designed and shown to the owner before anything is built
const planned = { screens: ['HM-01', 'MT-01', 'RS-01'], decided: [] };
const holding = () => ({ screens: 3, hold: 3, findings: [], summary: '3 screens, 3 hold, 0 findings above minor in all; every screen holds (4 s)' });
const needed = () => ({ mode: 'new', summary: 's', design: 'needed', milestones: [] });
const drawing = (extra: Record<string, Answer> = {}): Record<string, Answer> => ({
  screens: () => planned,
  refs: () => ({ primary: '토스 (홈의 큰 숫자 하나)', kinds: ['홈', '대결'] }),
  design: () => ({ drawn: 3, idea: 'i' }),
  sweep: holding,
  ...extra,
});
const firstPass = { id: 'm1', title: '첫 판', builds: '온 제품', claims: [claim('one'), claim('two')] };
const allProven = () => ({ proven: ['one', 'two'], refuted: [], unchecked: [] });

test("the drawing and the plan are cut from the dive brief, and what it left open is the builder's", async () => {
  const ran = await run({ request: '황천편의점', design: 'go' }, drawing({
    plan: (_call, nth) => nth === 0 ? needed() : { mode: 'new', design: 'approved', milestones: [firstPass] },
    build: built, verify: allProven, close: closed,
  }));
  const prompt = (label: string) => ran.calls.find((call) => call.label === label)!.prompt;
  for (const label of ['plan', 'screens', 'refs', 'design', 'sweep:design', 'build:m1']) {
    assert.match(prompt(label), /newest relevant dive folder[^\n]+idea\.md[^\n]+brief\.md[^\n]+same folder/);
  }
  for (const label of ['screens', 'refs', 'sweep:design']) {
    assert.match(prompt(label), /비워 둘 것 stays open in the frame/);
    assert.doesNotMatch(prompt(label), /record the choice and a one-line reason/);
  }
  assert.match(prompt('design'), /record the choice and a one-line reason under 비워 둔 것과 정한 것/);
  assert.match(prompt('plan'), /채울 것[^\n]+비워 둘 것[^\n]+빌더가 정한다[^\n]+no claim fixes the mechanism/);
  const later = await run({ request: '이어서' }, { plan: plan('m2'), build: built, verify: allProven, close: closed });
  for (const builder of [prompt('build:m1'), later.calls.find((c) => c.label === 'build:m2')!.prompt])
    assert.match(builder, /비워 둘 것[^\n]+input, timing and implementation[^\n]+`\.sz\/map\.md`[^\n]+"blocked"/);
  const skill = (file: string) => readFileSync(new URL('../../../plugin/skills/' + file, import.meta.url), 'utf8');
  assert.match(skill('design/references/handoff.md'), /11\. \*\*비워 둔 것\.\*\*/);
  assert.match(skill('dive/SKILL.md'), /sz-eyes dive brief/);
});

test('a new product with screens is planned, drawn and measured first, and the run stops there: nothing is built before the owner has seen it', async () => {
  // The three start together: each answers only after a turn of the clock, and says which had been started by then.
  const begun: string[] = [];
  const startedWith: Record<string, string[]> = {};
  const late = (label: string, value: unknown) => {
    begun.push(label);
    return new Promise((resolve) => setTimeout(() => { startedWith[label] = [...begun]; resolve(value); }, 0));
  };
  const ran = await run(
    { request: '다이어트 배틀 앱', asked: 'owner', answers: '계정: 필요 (기록 저장)' },
    drawing({ plan: needed, screens: () => late('screens', planned), refs: () => late('refs', { primary: '토스', kinds: ['홈'] }), design: () => late('design', { drawn: 3 }) }),
  );
  assert.deepEqual(labels(ran.calls), ['plan', 'screens', 'refs', 'design', 'sweep:design']);
  for (const label of ['screens', 'refs', 'design']) assert.deepEqual(startedWith[label], ['screens', 'refs', 'design'], `${label} was started beside the other two, not after them`);
  assert.deepEqual(ran.calls.map((c) => [c.label, c.effort]), [['plan', undefined], ['screens', undefined], ['refs', 'high'], ['design', 'high'], ['sweep:design', 'low']]);
  // The builders' word does not move the drawing: the board and the drawing have a name of their own, and the
  // screens are planned on the plan's model.
  const drawnBy = async (model: unknown): Promise<(string | undefined)[][]> =>
    (await run({ request: 'x', model }, drawing({ plan: needed }))).calls.map((c) => [c.label, c.model]);
  assert.deepEqual(await drawnBy('sonnet'), [['plan', undefined], ['screens', undefined], ['refs', undefined], ['design', undefined], ['sweep:design', undefined]]);
  assert.deepEqual(await drawnBy({ plan: 'opus', design: 'sonnet' }), [['plan', 'opus'], ['screens', 'opus'], ['refs', 'sonnet'], ['design', 'sonnet'], ['sweep:design', undefined]]);
  const prompt = (label: string): string => ran.calls.find((c) => c.label === label)!.prompt;

  assert.match(prompt('plan'), /^Before anything else, find out where this product's design stands[\s\S]*`ls \.sz \.sz\/design` and `sz-eyes contract show design`/);
  assert.match(prompt('plan'), /"needed": `\.sz\/design\/prototype\.html` is not there[\s\S]*Return at once: mode "new"[\s\S]*no milestones\. Write no spec/);
  const screens = prompt('screens');
  assert.match(screens, /read its `references\/handoff\.md` whole/);
  assert.match(screens, /A designer starts drawing the moment `\.sz\/plan\/frame\.md` exists/);
  assert.match(screens, /What the owner answered when asked beforehand, in their words:\n계정: 필요 \(기록 저장\)/, 'the screens are planned from what the owner answered, as the spec is');
  assert.match(prompt('refs'), /do its step 1[\s\S]*and only that[\s\S]*Do not wait for the plan of the screens/);
  assert.match(prompt('refs'), /Write `\.sz\/design\/refs\.md` last/);
  const designer = prompt('design');
  assert.match(designer, /until \[ -e \.sz\/plan\/frame\.md \] && \[ -e \.sz\/design\/refs\.md \]; do sleep 10; done/);
  assert.match(designer, /by yourself: start no other agent/);
  // The designer waits about ten minutes for the plan's frame and the board (9.4 of its 43 on 2026-11-17), and read the
  // handbook and looked through the picture stock only afterwards: that needs neither. The screens stay one hand's:
  // drawing them was 9 of those 43 minutes, so several hands would save four or five and cost what makes them read as one product.
  assert.match(designer, /Use the wait for what needs neither: read `sz:taste` and its handbook[^.]*and see what the owner's stock of pictures holds/);
  assert.match(designer, /you decide nothing before both are there/);
  const sweep = prompt('sweep:design');
  assert.match(sweep, /You did not draw it and you take nobody's word for it/);
  // A fresh browser measures the theme written in direction.md. Screen list, size and canonical destination stay fixed.
  assert.match(sweep, /file:\/\/\$PWD\/\.sz\/design\/prototype\.html\?t=<name>[^\n]+sz-eyes web sweep "\$drawing_url" --from \.sz\/design\/sweep\.txt --size phone --out \.sz\/design\/shots/);
  assert.match(sweep, /sz-eyes contract new design --lane M --request "[^"]+" --claim "screens\|[^"]+\|command:[^"]+" --claim "feel\|[^"]+\|owner:\.sz\/design\/prototype\.html"/);
  assert.match(sweep, /`sz-eyes contract freeze design`, with no files/);
  assert.match(sweep, /sz-eyes contract claim design screens --status proven\|refuted --note "<the sweep's summary line>"/);

  assert.equal(ran.calls.some((c) => c.label.startsWith('build:')), false, 'nothing is built in this run');
  assert.match(ran.result.stopped, /^the prototype waits for the owner: nothing is built until they have seen it/);
  assert.match(ran.result.stopped, /sz-eyes contract judged design feel --verdict yes\|no --said "<their words>"[\s\S]*Then run this workflow again/);
  assert.ok(ran.logs.some((l) => /^DESIGN READY: open \.sz\/design\/prototype\.html\. 3 screen\(s\) of the plan drawn, all 3 hold/.test(l)), ran.logs.join('\n'));
  assert.deepEqual(ran.result.milestones, []);
});

test('a selected theme is measured before approval and is the reference for building and verifying', async () => {
  const waiting = await run({ request: 'r' }, drawing({ plan: needed }));
  assert.match(waiting.result.stopped, /Before recording yes[^\n]+prototype\.html\?t=<name>[^\n]+fresh temporary shots folder/);
  assert.match(waiting.result.stopped, /If the sweep fails[^\n]+keep the canonical pictures and direction unchanged[^\n]+stop before recording yes/);
  assert.match(waiting.result.stopped, /Only after the whole set holds[^\n]+주인이 고른 테마[^\n]+sz-eyes contract judged design feel/);
  const approved = await run({ request: 'r', design: 'go' }, {
    plan: () => ({ mode: 'new', design: 'approved', milestones: [firstPass] }),
    build: built, verify: allProven, close: closed,
  });
  assert.match(approved.calls.find((call) => call.label === 'plan')!.prompt, /designer’s measured theme if there is no owner choice/);
  for (const label of ['build:m1', 'verify:m1']) {
    const prompt = approved.calls.find((call) => call.label === label)!.prompt;
    assert.match(prompt, /direction\.md[^\n]+prototype\.html\?t=<name>[^\n]+아직 없음/);
    assert.match(prompt, /canonical (pictures|set) for that address/);
  }
});

test('a design stage run again takes up what an earlier run left: a whole plan and a board stand, and a drawing begun is gone on with', async () => {
  const ran = await run({ request: 'r', asked: 'away' }, drawing({ plan: needed, screens: () => planned, refs: () => ({ primary: '토스', kinds: ['홈'] }), design: () => ({ drawn: 3 }) }));
  const prompt = (label: string): string => ran.calls.find((c) => c.label === label)!.prompt;
  assert.match(prompt('screens'), /If `\.sz\/plan\/screens\/DONE` is there, the plan is whole: write nothing/);
  assert.match(prompt('screens'), /every screen already written stand as they are[^.]*: write only the screens that are missing/);
  assert.match(prompt('refs'), /if `\.sz\/design\/refs\.md` is there, an earlier run made the board and it stands: search nothing/);
  assert.match(prompt('design'), /if `\.sz\/design\/prototype\.html` is there when you start[^]*keep its direction, its tokens, its parts and every screen it has, and draw only what is missing/);
});

test('screens the measurement finds wanting are mended by the part, twice at most, and the run stops naming those that still do not hold', async () => {
  const wanting = { screens: 3, hold: 1, findings: [{ screen: 'HM-01', found: '12자 닉네임이 잘린다' }, { screen: 'RS-01', found: '시안에 없는 화면: 개요가 보인다' }], summary: '3 screens, 1 holds' };
  const mended = await run({ request: 'x' }, drawing({ plan: needed, sweep: (_c, nth) => (nth === 0 ? wanting : holding()), fix: () => ({ changed: '행 부품의 이름 칸' }) }));
  assert.deepEqual(labels(mended.calls), ['plan', 'screens', 'refs', 'design', 'sweep:design', 'fix:design:1', 'sweep:design']);
  const fix = mended.calls.find((c) => c.label === 'fix:design:1')!;
  assert.match(fix.prompt, /- HM-01: 12자 닉네임이 잘린다\n- RS-01: 시안에 없는 화면: 개요가 보인다/);
  assert.match(fix.prompt, /Mend the part, not the screen/);
  assert.match(fix.prompt, /run the same sweep yourself[\s\S]*until it reports nothing/);
  assert.equal(fix.effort, 'high');
  assert.equal(fix.model, undefined);
  const mendedBy = await run({ request: 'x', model: { design: 'sonnet' } }, drawing({ plan: needed, sweep: (_c, nth) => (nth === 0 ? wanting : holding()), fix: () => ({ changed: '행 부품의 이름 칸' }) }));
  assert.equal(mendedBy.calls.find((c) => c.label === 'fix:design:1')!.model, 'sonnet');
  assert.match(mended.result.stopped, /^the prototype waits for the owner/);
  assert.ok(mended.logs.some((l) => /^DESIGN READY/.test(l)));

  const still = await run({ request: 'x' }, drawing({ plan: needed, sweep: () => wanting, fix: () => ({ changed: '' }) }));
  assert.deepEqual(labels(still.calls), ['plan', 'screens', 'refs', 'design', 'sweep:design', 'fix:design:1', 'sweep:design', 'fix:design:2', 'sweep:design']);
  assert.match(still.result.stopped, /still does not hold after two rounds of mending: 2 of the plan's 3 screen\(s\) do not hold: HM-01 \(12자 닉네임이 잘린다\); RS-01 \(시안에 없는 화면/);
  assert.ok(!still.logs.some((l) => /^DESIGN READY/.test(l)), 'a prototype that does not hold is not called ready');
  assert.equal(still.calls.some((c) => c.label.startsWith('build:')), false);
});

test('a prototype the owner has not judged yet: nothing runs, and the run says it waits for them', async () => {
  const ran = await run({ request: 'x' }, { plan: () => ({ mode: 'new', summary: 's', design: 'waiting', milestones: [] }) });
  assert.deepEqual(labels(ran.calls), ['plan']);
  assert.match(ran.result.stopped, /^the prototype waits for the owner[\s\S]*sz-eyes contract judged design feel --verdict yes\|no --said "<their words>"/);
});

test('a prototype the owner said yes to is what the first pass is planned from, built to, and held to at its first look', async () => {
  const ran = await run({ request: '다이어트 배틀 앱' }, { plan: () => ({ mode: 'new', summary: 's', design: 'approved', milestones: [firstPass] }), build: built, verify: allProven, close: closed });
  assert.deepEqual(labels(ran.calls), ['plan', 'build:m1', 'verify:m1', 'close:m1']);
  const prompt = (label: string): string => ran.calls.find((c) => c.label === label)!.prompt;
  const planned = prompt('plan');
  assert.match(planned, /the screens are planned \(`\.sz\/plan\/frame\.md` and one file a screen under `\.sz\/plan\/screens\/`\) and drawn \(`\.sz\/design\/prototype\.html`; `\.sz\/design\/direction\.md` ends with what the builder needs: tokens, parts, each screen's parts and address\)/);
  assert.match(planned, /The spec is cut from them and does not decide again what they decided/);
  assert.match(planned, /every screen of the plan built as drawn, one claim shown by a look \(each built screen beside its picture under `\.sz\/design\/shots\/`: the same content in the same order, made of the same parts, in the same tokens\)/);
  // 2026-11-22: worded without its exception, the claim was shown false in three first passes of one product, could
  // not be made true by a fixer, and was set aside for the owner by a ruling; what no claim required stayed unlike.
  assert.match(planned, /in the same tokens\), worded with its one exception, "except where another claim of this contract requires otherwise": said of every screen and nothing more, it cannot be true beside a claim that asks for what the drawing does not have \(the words of a form the law gives, a figure its source gives\); and the claim about every screen at its limits/);
  const builder = prompt('build:m1');
  assert.match(builder, /The look first, and it is settled[\s\S]*do not settle it again/);
  assert.match(builder, /`\.sz\/design\/direction\.md` ends with what you need \(빌더에게: the tokens, the parts, each screen's parts and its address in the prototype\)/, 'the first builder is handed the design\'s direction');
  assert.match(builder, /Carry the prototype's tokens and parts: for a web product its markup and CSS as they are; for a phone app the tokens, the parts and each screen's order, written again in the toolkit/);
  assert.match(builder, /`sz:taste` is for what the design leaves open/);
  assert.doesNotMatch(builder, /The look first \(load `sz:taste`/);
  const look = prompt('verify:m1');
  assert.match(look, /take a picture of each built screen the way `sz-eyes web sweep` does[\s\S]*set it beside its drawing/);
  // What another claim requires stands, and is listed for the owner, who said yes to the drawing.
  assert.match(look, /For every difference in content, order, parts or tokens, read the contract's other claims\. Where one of them requires what the built screen has[\s\S]*the difference stands: write each, with its screen and the claim that requires it, into a file under the contract's evidence folder and name that file as this claim's evidence/);
  // What no claim requires is the claim shown false, every one of them named: that list is what gets mended.
  assert.match(look, /A difference that no claim requires is this claim shown false: name every one with its screen, not the first, because whoever mends them is handed the whole list/);
  assert.doesNotMatch(look, /A difference in content, order, parts or tokens is that claim shown false, with the screen named/);
  // The look after a fix judges the drawing the same way: the claim is mended and looked at again now, not set aside
  // with the flows that held four screens away from it (2026-11-23), and whoever looks again needs the two kinds.
  let n = 0;
  const mended = await run({ request: 'x' }, { plan: () => ({ mode: 'new', summary: 's', design: 'approved', milestones: [firstPass] }), build: built, verify: () => (n++ === 0 ? { proven: [], refuted: [{ id: 'one', fact: '네 화면이 그림과 다름' }], unchecked: [] } : allProven()), fix: () => ({ fixed: ['one'] }), close: closed });
  assert.match(mended.calls.find((c) => c.label === 'verify:m1:again')!.prompt, /For the claim that every screen is built as drawn, where it is yours[\s\S]*A difference that no claim requires is this claim shown false: name every one with its screen/);

  // A plan with no word on the design is built as before: no drawing to carry, and none to be held to.
  const plain = await run({ request: 'x' }, { plan: () => ({ mode: 'new', summary: 's', milestones: [firstPass] }), build: built, verify: allProven, close: closed });
  assert.match(plain.calls.find((c) => c.label === 'build:m1')!.prompt, /The look first \(load `sz:taste`: colour, type and spacing settled once/);
  assert.doesNotMatch(plain.calls.find((c) => c.label === 'build:m1')!.prompt, /it is settled/);
  assert.doesNotMatch(plain.calls.find((c) => c.label === 'verify:m1')!.prompt, /beside its drawing/);
});

test('a first pass built to a drawing is set beside it once by its builder, and what another claim requires stays and is said', async () => {
  const drawn = { plan: () => ({ mode: 'new', summary: 's', design: 'approved', milestones: [firstPass] }), verify: allProven, close: closed };
  const ran = await run({ request: '퇴사 점검' }, { ...drawn, build: built });
  const builder = ran.calls.find((c) => c.label === 'build:m1')!.prompt;
  // The pictures compared are taken at the end, of every state the drawing has: the early ones show the one path only.
  assert.match(builder, /Then, once, set what you built beside its drawing[\s\S]*every state the drawing has \(`\.sz\/design\/sweep\.txt` lists them, a picture of each is under `\.sz\/design\/shots\/`; a sheet of the drawing's own parts is not a screen of the product\) on the product as it now stands, at phone size[\s\S]*under `built\/`/);
  assert.match(builder, /Write down every difference in content, order, parts or tokens, with its screen/);
  assert.match(builder, /mended at the part, so that it is right on every screen made of it/);
  // The drawing is not followed against another claim: the screen stays as the claim needs it, and the owner is told.
  assert.match(builder, /A difference that another claim requires[\s\S]*is not mended toward the drawing: it stays, and you return it under "unlike"/);
  assert.match(builder, /Do not set them beside the drawing a second time: whoever verifies does[\s\S]*not to prove the claim/);
  assert.ok(builder.indexOf('Then, once, set what you built beside its drawing') > builder.indexOf('fill every field with the longest value'), 'after the look at the product\'s limits');
  assert.ok(builder.indexOf('Then, once, set what you built beside its drawing') < builder.indexOf('Do not stop to report in between'), 'and before the builder is told when it is done');
  assert.equal(ran.result.milestones[0].unlike, undefined, 'nothing is said of it when the builder returned none');

  // What the builder left unlike its drawing reaches the log and the run's result, for the owner.
  const left = [{ screen: 'DC-02', differs: 'the form has 12 fields; the drawing has 9', claim: 'form' }, { screen: '', differs: 'x', claim: 'y' }];
  const said = await run({ request: '퇴사 점검' }, { ...drawn, build: (c: Call) => ({ ...built(c), unlike: left }) });
  assert.ok(said.logs.some((l) => /1 screen\(s\) left unlike the drawing because another claim requires it: \[DC-02 \(form\): the form has 12 fields; the drawing has 9\]/.test(l)), said.logs.join('\n'));
  assert.deepEqual(said.result.milestones[0].unlike, [left[0]]);

  // Nothing was drawn: nothing to set beside. And a later milestone is not a first pass.
  const plain = await run({ request: 'x' }, { plan: () => ({ mode: 'new', summary: 's', milestones: [firstPass] }), build: built, verify: allProven, close: closed });
  assert.doesNotMatch(plain.calls.find((c) => c.label === 'build:m1')!.prompt, /beside its drawing/);
  const later = await run({ request: 'x' }, { plan: () => ({ mode: 'extend', summary: 's', design: 'approved', milestones: [{ ...firstPass, id: 'm2' }] }), build: built, verify: allProven, close: closed });
  assert.doesNotMatch(later.calls.find((c) => c.label === 'build:m2')!.prompt, /set what you built beside its drawing/);
});

test('a prototype the owner said no to is drawn again from their words alone, measured, and put before them again', async () => {
  const said = '너무 어두워요. 홈에서 내 점수가 제일 크게 보였으면 해요';
  const ran = await run({ request: 'x' }, { plan: () => ({ mode: 'new', summary: 's', design: 'again', said, milestones: [] }), design: () => ({ changed: ['색'] }), sweep: holding });
  assert.deepEqual(labels(ran.calls), ['plan', 'design:again', 'sweep:design']);
  const again = ran.calls.find((c) => c.label === 'design:again')!;
  assert.ok(again.prompt.includes(`What the owner said, in their words:\n${said}`), again.prompt);
  assert.match(again.prompt, /Change what they said and nothing they did not/);
  assert.match(again.prompt, /The plan of the screens \(`\.sz\/plan\/`\) and the reference board \(`\.sz\/design\/refs\.md`\) stand/);
  const sweep = ran.calls.find((c) => c.label === 'sweep:design')!.prompt;
  assert.match(sweep, /sz-eyes contract claim design screens --status proven\|refuted/);
  assert.match(sweep, /sz-eyes contract claim design feel --status unchecked --note/);
  assert.doesNotMatch(sweep, /sz-eyes contract new design/, 'the contract is there: it is recorded on, not made again');
  assert.match(ran.result.stopped, /^the prototype waits for the owner/);
});

test('only an owner who said to go on without seeing it lets a run go from the measured prototype into the first pass', async () => {
  const thenApproved = (_c: Call, nth: number) => (nth === 0 ? needed() : { mode: 'new', summary: 's', design: 'approved', milestones: [firstPass] });
  const ran = await run({ request: 'x', design: 'go' }, drawing({ plan: thenApproved, build: built, verify: allProven, close: closed }));
  assert.deepEqual(labels(ran.calls), ['plan', 'screens', 'refs', 'design', 'sweep:design', 'plan', 'build:m1', 'verify:m1', 'close:m1']);
  assert.match(ran.calls[0]!.prompt, /This run was started with design "go"[\s\S]*Where you would return "waiting", return "approved"/);
  assert.match(ran.calls.find((c) => c.label === 'build:m1')!.prompt, /The look first, and it is settled/);
  assert.ok(ran.logs.some((l) => /^DESIGN READY/.test(l)));
  assert.equal(ran.result.stopped, null);

  // Without it the run stops at the prototype, the owner away or not.
  const away = await run({ request: 'x', asked: 'away' }, drawing({ plan: thenApproved, build: built, verify: allProven, close: closed }));
  assert.deepEqual(labels(away.calls), ['plan', 'screens', 'refs', 'design', 'sweep:design']);
  assert.doesNotMatch(away.calls[0]!.prompt, /design "go"/);
  assert.match(away.result.stopped, /^the prototype waits for the owner/);
});

test('the workflow tells every agent how to launch and end things on a machine it shares', async () => {
  const { calls, result } = await run({ request: '운영 준비' }, { plan: plan('m5'), build: built, verify: () => ({ proven: ['one', 'two'], refuted: [], unchecked: [], stood: 25, noticed: [] }), close: closed });
  assert.equal(result.stopped, null);
  for (const label of ['plan', 'build:m5']) {
    const prompt = calls.find((c) => c.label === label)!.prompt;
    assert.match(prompt, /PORT=\$\(sz-eyes port\)/, label);
    assert.match(prompt, /never by its port and never by its name/, label);
  }
  const close = calls.find((c) => c.label === 'close:m5')!.prompt;
  assert.match(close, /sz-eyes backlog done/);
  assert.match(close, /2 proven, 0 refuted, 0 unchecked; of what stood before this milestone, 25 hold, 0 broken, 0 replaced/);
});

test('after a fix, the second look decides which earlier notices are still so, and a claim it skipped stays false', async () => {
  const first = { proven: ['one'], refuted: [{ id: 'two', fact: '되살리기가 떠 있는 서버 밑의 DB를 갈아 끼운다' }], unchecked: [], stood: 31, noticed: ['서버 둘이 표시 하나를 나눠 쓴다', '대비 5.37:1'] };
  const mended = await run({ request: 'x' }, { plan: plan('m6'), build: built, fix: () => ({ fixed: ['two'] }), verify: (_call, nth) => (nth === 0 ? first : { proven: ['two'], refuted: [], unchecked: [], stood: 31, noticed: ['대비 5.37:1', '세기가 느리다'] }), close: closed });
  const second = mended.calls.find((c) => c.label === 'verify:m6:again')!.prompt;
  assert.match(second, /\[서버 둘이 표시 하나를 나눠 쓴다\] \[대비 5\.37:1\]/, 'the second look is handed what the first noticed');
  assert.deepEqual(mended.result.milestones[0].noticed, ['대비 5.37:1', '세기가 느리다'], 'what the fix ended is not reported as still there');
  assert.deepEqual(mended.result.milestones[0].proven, ['one', 'two']);
  assert.equal(mended.result.stopped, null);

  // The second look says nothing of the claim that was false: it is still false, and nothing is built on it.
  const skipped = await run({ request: 'x' }, { plan: plan('m6', 'm7'), build: built, fix: () => ({ fixed: [] }), verify: (_call, nth) => (nth === 0 ? first : { proven: [], refuted: [], unchecked: [] }), close: () => ({ report: 'r.html', closed: false, line: 'l' }) });
  assert.deepEqual(skipped.result.milestones[0].refuted.map((r: { id: string }) => r.id), ['two']);
  assert.deepEqual(skipped.result.milestones[0].noticed, first.noticed, 'a look that returned no notices leaves the earlier ones');
  assert.match(skipped.result.stopped, /still has 1 claim\(s\) shown false/);
  assert.deepEqual(skipped.result.notBuilt, ['title m7']);
  assert.equal(skipped.calls.some((c) => c.label === 'build:m7'), false);
});

test('a case a verifier tried in which the product is wrong refutes the claim it is about, and the fixer and the next look are handed the case', async () => {
  // 2026-11-22: a first pass closed, 18 proven and none false, while its verifiers had recorded as noticed that the
  // product answered "looks eligible" at 40 days of the 60 its law asks, counted days after the person had left, and
  // gave the same answer with a required date empty. Each claim was recorded proven by its own flow, which walks one
  // case; three looks carried the notices along and nobody mended them.
  const fact = '8월분을 5일 늦게 받고 9월분만 못 받았는데 40일 / 60일에서 "요건에 맞아 보여요"가 나온다';
  const first = { proven: ['one'], refuted: [{ id: 'two', fact }], unchecked: [] };
  const ran = await run({ request: 'x' }, { plan: plan('m1'), build: built, fix: () => ({ fixed: ['two'] }), verify: (_call, nth) => (nth === 0 ? first : { proven: ['two'], refuted: [], unchecked: [] }), close: closed });
  const look = ran.calls.find((c) => c.label === 'verify:m1')!.prompt;
  assert.match(look, /when you try another case and the product is wrong about the same thing[^.]*, that claim is `refuted` with your case as the fact, though its own check passes; it is not something noticed, which nobody mends before this work closes/);
  assert.match(SOURCE, /noticed: \{ type: 'array'[^\n]*a case in which the product is wrong about what a claim is about is that claim under "refuted", never here/);
  // The claim's frozen check passed all along: whoever mends it and whoever looks again need the case itself.
  const mend = ran.calls.find((c) => c.label === 'fix:m1:1')!.prompt;
  assert.match(mend, /Where what was found is a case the claim's own check does not walk[^.]*, the check shows nothing of your fix: bring the product to that case and see it right/);
  assert.match(mend, /add the case as a test of its own, in a file no contract froze/);
  assert.match(mend, /Where a claim says something of all of a kind[^.]*: look for the others the way it found that one/);
  const again = ran.calls.find((c) => c.label === 'verify:m1:again')!.prompt;
  assert.ok(again.includes(`These claims of the contract were shown false before: two. Check each from the start, on the product as it is now, and record it with \`sz-eyes contract claim\`. What was found then: [two: ${fact}]. Where that is a case the claim's own check does not walk, the check passing shows nothing of the fix: bring the product to that case again.`), 'the next look is handed the case');
  const rules = readFileSync(fileURLToPath(new URL('../../../plugin/agents/verifier.md', import.meta.url)), 'utf8');
  assert.match(rules, /\*\*A claim you broke is refuted, though its check passes\.\*\*[^\n]*the claim is `refuted`, with your case and its figure as the fact/);
  assert.match(rules, /what shows the product wrong about the thing a claim is about is not recorded here but as that claim's verdict/);
});

test('a milestone whose contract would not close is where the run stops, whatever the agents said', async () => {
  const { result, calls } = await run({ request: 'x' }, { plan: plan('m1', 'm2'), build: built, verify: () => ({ proven: ['one', 'two'], refuted: [], unchecked: [] }), close: () => ({ report: 'r.html', closed: false, why: 'a frozen file changed', line: 'l' }) });
  assert.match(result.stopped, /did not close: a frozen file changed/);
  assert.equal(calls.some((c) => c.label === 'build:m2'), false);
});

// ---- milestones side by side
const graph = (...ms: { id: string; after?: string[]; alone?: boolean }[]) => () => ({ mode: 'continue', summary: 's', milestones: ms.map((m) => ({ id: m.id, title: `title ${m.id}`, builds: 'b', claims: [claim('one'), claim('two')], ...(m.after ? { after: m.after } : {}), ...(m.alone ? { alone: true } : {}) })) });
const proven = () => ({ proven: ['one', 'two'], refuted: [], unchecked: [], stood: 4, noticed: [] });
const staged = ({ label }: Call) => ({ folders: label.split(':')[1]!.split('+').map((id) => ({ id, where: `/p/.sz/trees/${id}` })) });
const joinedAll = ({ label }: Call) => ({ merged: label.split(':')[1]!.split('+'), conflicted: [] });
const held = (stood: number) => () => ({ proven: [], refuted: [], unchecked: [], broken: [], held: [], stood });
const labels = (calls: Call[]): string[] => calls.map((c) => c.label);

test('the plan review is opt-in, runs once in order and stops building on a fatal finding', async () => {
  const steps = { plan: plan('m1'), build: built, verify: proven, close: closed };
  const args = { request: '요금 계산', redteam: 'plan', redteamModel: 'sonnet' };
  const off = await run({ request: args.request }, steps);
  assert.deepEqual(off.result.redteam, []);
  const clear = await run(args, { ...steps, redteam: () => ({ checks: [], fatal: [] }) });
  assert.deepEqual(clear.allCalls.map((c) => c.label), ['facts', 'plan', 'redteam:plan', 'build:m1', 'verify:m1', 'close:m1']);
  assert.equal(clear.allCalls[2]!.model, 'sonnet');
  assert.deepEqual(clear.result.redteam, [{ at: 'plan', checks: [], fatal: [], held: [] }]);
  assert.equal(clear.result.stopped, null);
  const fatal = await run({ ...args, facts: 'off' }, { ...steps, redteam: () => ({ checks: [], fatal: ['공시 요율을 읽을 수 없음'] }) });
  assert.deepEqual(fatal.allCalls.map((c) => c.label), ['plan', 'redteam:plan']);
  assert.match(fatal.result.stopped, /공시 요율을 읽을 수 없음/);
  assert.deepEqual(fatal.result.notBuilt, ['title m1']);
  const silent = await run(args, { ...steps, redteam: () => null });
  // A review without a reply provides no fatal finding. Report the missing result before continuing.
  assert.equal(silent.result.stopped, null);
  assert.ok(silent.logs.some((line) => line.includes('the review did not answer')));
  assert.deepEqual(silent.result.redteam, []);
});

test('a requested closing review leaves the verified contract open on a fatal finding', async () => {
  for (const reply of [null, { checks: [], fatal: ['요금표와 맞지 않음'] }]) {
    const ran = await run({ request: '검토', redteam: 'close' }, {
      plan: plan('m1'), build: built, verify: proven, redteam: () => reply, close: closed,
    });
    if (!reply) {
      assert.deepEqual(labels(ran.calls), ['plan', 'build:m1', 'verify:m1', 'redteam:m1', 'close:m1']);
      assert.equal(ran.result.stopped, null);
      assert.ok(ran.logs.some((line) => line.includes('the review did not answer')));
      continue;
    }
    assert.deepEqual(labels(ran.calls), ['plan', 'build:m1', 'verify:m1', 'redteam:m1']);
    assert.match(ran.result.stopped, /요금표와 맞지 않음/);
    const [m] = ran.result.milestones;
    assert.deepEqual(m.proven, ['one', 'two']);
    assert.equal(m.report, null);
    assert.equal(m.contractId, 'm1');
  }
});

test('a closing review reads the product and files its finding in the worktree of its own milestone', async () => {
  const roots: [string | null, string, string][] = [];
  const ran = await run({ request: '검토', redteam: 'both' }, {
    plan: graph({ id: 'm1' }, { id: 'm2', after: ['m1'] }, { id: 'm3', after: ['m1'] }),
    stage: staged, build: built, verify: proven, close: closed, join: joinedAll, gate: held(4),
    redteam: () => ({ checks: [], fatal: [], held: ['빈 상태에서 다시 열기'] }),
  }, (where, contract, _prompt, options) => {
    if (options.label.startsWith('redteam:')) roots.push([where, contract, options.label]);
  });
  assert.equal(ran.result.stopped, null);
  assert.deepEqual(roots, [[null, 'm1', 'redteam:m1'], ['/p/.sz/trees/m2', 'm2', 'redteam:m2'], ['/p/.sz/trees/m3', 'm3', 'redteam:m3']]);
  const prompt = ran.calls.find((c) => c.label === 'redteam:m2')!.prompt;
  assert.match(prompt, /its folder is \`\/p\/\.sz\/trees\/m2\`/);
  assert.ok(prompt.includes('cd /p/.sz/trees/m2 &&') && prompt.includes('.sz/evidence/m2/'));
  assert.equal(ran.result.redteam.length, 4);
  assert.ok(ran.result.redteam.every((r: { held: string[] }) => r.held.includes('빈 상태에서 다시 열기')));
});

test('milestones the plan puts side by side are built in folders of their own, brought together, and everything that stands is shown again before anything is built on them', async () => {
  const { result, calls, logs } = await run(
    { request: '택배 비교', side: 3 },
    {
      plan: graph({ id: 'm1' }, { id: 'm2', after: ['m1'] }, { id: 'm3', after: ['m1'] }, { id: 'm4', after: ['m2', 'm3'] }),
      stage: staged,
      build: built,
      verify: proven,
      close: ({ label }) => ({ report: 'r.html', closed: true, line: 'l', ...(label === 'close:m2' ? { corrections: ['지도: 띄우는 명령이 npm start에서 npm run serve로'] } : {}) }),
      join: joinedAll,
      gate: held(12),
    },
  );
  assert.equal(result.stopped, null);
  const order = labels(calls);
  // The first has nothing beside it; the two after it start together; the last waits for both and for the look at them joined.
  assert.deepEqual(order.slice(0, 5), ['plan', 'build:m1', 'verify:m1', 'close:m1', 'stage:m2+m3']);
  assert.ok(order.indexOf('build:m3') < order.indexOf('verify:m2'), 'both are being built before either is verified');
  assert.ok(order.indexOf('join:m2+m3') > Math.max(order.indexOf('close:m2'), order.indexOf('close:m3')));
  assert.deepEqual(order.slice(order.indexOf('join:m2+m3')), ['join:m2+m3', 'gate:m2+m3', 'build:m4', 'verify:m4', 'close:m4']);
  const prompt = (label: string): string => calls.find((c) => c.label === label)!.prompt;
  for (const label of ['build:m2', 'verify:m3', 'close:m2']) assert.match(prompt(label), /Yours is `\/p\/\.sz\/trees\/m[23]`: a git worktree[\s\S]*cd \/p\/\.sz\/trees\/m[23] &&[\s\S]*Do not edit `\.sz\/map\.md` or `\.sz\/spec\.md`/, label);
  for (const label of ['build:m1', 'verify:m1', 'build:m4']) assert.doesNotMatch(prompt(label), /\.sz\/trees/, `${label} is built in the project's own folder`);
  assert.match(prompt('stage:m2+m3'), /\.git\/info\/exclude[\s\S]*merge=union[\s\S]*git worktree add \.sz\/trees\/<id> -b sz\/<id>[\s\S]*Never copy what the product stored/);
  assert.match(prompt('join:m2+m3'), /git merge --no-ff sz\/<id>[\s\S]*sz-eyes standing mend[\s\S]*git merge --abort[\s\S]*\[지도: 띄우는 명령이 npm start에서 npm run serve로\]/);
  assert.match(prompt('gate:m2+m3'), /Nobody has seen them together\. There is no new claim to prove\.[\s\S]*Show again every claim that stands[\s\S]*--during m3/);
  assert.deepEqual(result.milestones.map((m: { id: string }) => m.id), ['m1', 'm2', 'm3', 'm4']);
  assert.deepEqual(result.joins, [{ ids: ['m2', 'm3'], merged: ['m2', 'm3'], notMerged: [], stood: 12, broken: [], noticed: [] }]);
  assert.ok(logs.some((line) => /side by side: title m2 \/ title m3/.test(line)) && logs.some((line) => /brought together: m2, m3; 12 promise\(s\) hold/.test(line)));
});

test('a line stays a line: with no order given, with one milestone ready at a time, when one is marked alone, and when the owner asks for a line', async () => {
  const answers = { stage: staged, build: built, verify: proven, close: closed, join: joinedAll, gate: held(6) };
  const line = await run({ request: 'x' }, { ...answers, plan: graph({ id: 'm1' }, { id: 'm2' }, { id: 'm3' }) });
  assert.deepEqual(labels(line.calls).filter((l) => /^(stage|join|gate)/.test(l)), []);
  assert.deepEqual(labels(line.calls).filter((l) => l.startsWith('build')), ['build:m1', 'build:m2', 'build:m3']);
  // Nothing is built beside the first milestone of a product, whatever the plan says.
  const eager = await run({ request: 'x', side: 3 }, { ...answers, plan: graph({ id: 'm1', after: [] }, { id: 'm2', after: [] }, { id: 'm3', after: [] }) });
  assert.deepEqual(labels(eager.calls).slice(0, 5), ['plan', 'build:m1', 'verify:m1', 'close:m1', 'stage:m2+m3']);
  // One that changes what everything stands on goes first and alone; the others then go together.
  const alone = await run({ request: 'x', side: 3 }, { ...answers, plan: graph({ id: 'm1' }, { id: 'm2', after: ['m1'] }, { id: 'm3', after: ['m1'], alone: true }, { id: 'm4', after: ['m1'] }) });
  const order = labels(alone.calls).filter((l) => /^(stage|build)/.test(l));
  assert.deepEqual(order.slice(0, 2), ['build:m1', 'stage:m2+m4']);
  assert.ok(order.indexOf('build:m3') > order.indexOf('build:m4'), 'the one that must be alone waits for the group and is then built in the project\'s folder');
  assert.doesNotMatch(alone.calls.find((c) => c.label === 'build:m3')!.prompt, /\.sz\/trees/);
  assert.equal(alone.result.stopped, null);
  // What the plan puts side by side is built side by side unless the owner asks for a line.
  const together = await run({ request: 'x' }, { ...answers, plan: graph({ id: 'm1' }, { id: 'm2', after: ['m1'] }, { id: 'm3', after: ['m1'] }) });
  assert.deepEqual(labels(together.calls).filter((l) => /^stage/.test(l)), ['stage:m2+m3']);
  const forced = await run({ request: 'x', side: 1 }, { ...answers, plan: graph({ id: 'm1' }, { id: 'm2', after: ['m1'] }, { id: 'm3', after: ['m1'] }) });
  assert.deepEqual(labels(forced.calls).filter((l) => /^(stage|join|gate)/.test(l)), []);
  // Folders of their own could not be made: they are built one after another, and nothing is lost.
  const nofolders = await run({ request: 'x', side: 3 }, { ...answers, plan: graph({ id: 'm1' }, { id: 'm2', after: ['m1'] }, { id: 'm3', after: ['m1'] }), stage: () => ({ folders: [], problem: 'a branch sz/m2 is left from an earlier run' }) });
  assert.equal(nofolders.result.stopped, null);
  assert.deepEqual(labels(nofolders.calls).filter((l) => /^(join|gate)/.test(l)), []);
  assert.ok(nofolders.logs.some((l) => /built in a line after all: a branch sz\/m2 is left/.test(l)));
  assert.deepEqual(nofolders.result.milestones.map((m: { id: string }) => m.id), ['m1', 'm2', 'm3']);
});

test('what does not merge is brought up to date by a builder and then shown again with the rest; what breaks when joined is fixed or stops the run', async () => {
  const base = { plan: graph({ id: 'm1' }, { id: 'm2', after: ['m1'] }, { id: 'm3', after: ['m1'] }, { id: 'm4', after: ['m2', 'm3'] }), stage: staged, build: built, verify: proven, close: closed };
  // A conflict in the product's own files: nobody settles it in passing.
  const conflict = await run({ request: 'x', side: 3 }, { ...base, join: ({ label }) => (label === 'join:m2+m3' ? { merged: ['m2'], conflicted: [{ id: 'm3', files: ['src/routes.js'] }] } : { merged: ['m3'], conflicted: [] }), resolve: () => ({ settled: '두 경로를 모두 남김' }), gate: held(12) });
  const order = labels(conflict.calls);
  assert.deepEqual(order.slice(order.indexOf('join:m2+m3'), order.indexOf('build:m4')), ['join:m2+m3', 'resolve:m3', 'join:m3:again', 'gate:m2+m3']);
  assert.match(conflict.calls.find((c) => c.label === 'resolve:m3')!.prompt, /no longer merges into it: src\/routes\.js[\s\S]*cd \/p\/\.sz\/trees\/m3 &&[\s\S]*Do not change a flow or a test that a contract froze/);
  assert.equal(conflict.result.stopped, null);
  assert.deepEqual(conflict.result.joins[0].merged, ['m2', 'm3']);
  // It still does not merge: the run stops and says where the work is. Nothing is built on half a product.
  const stuck = await run({ request: 'x', side: 3 }, { ...base, join: ({ label }) => (label === 'join:m2+m3' ? { merged: ['m2'], conflicted: [{ id: 'm3', files: ['src/routes.js'] }] } : { merged: [], conflicted: [{ id: 'm3', files: ['src/routes.js'] }] }), resolve: () => ({ settled: '', cannot: '둘이 같은 주소를 다르게 쓴다' }), gate: held(8) });
  assert.match(stuck.result.stopped, /"title m3" were built and closed on their own branch and could not be brought into the project's folder[\s\S]*\/p\/\.sz\/trees\/m3/);
  assert.deepEqual(stuck.result.notBuilt, ['title m4']);
  assert.ok(labels(stuck.calls).includes('gate:m2+m3'), 'what did come in is still shown again');

  // Proven apart, broken together: fixed, looked at again, and only then built on.
  const broke = { proven: [], refuted: [], unchecked: [], broken: [{ key: 'm2/one', fact: '메뉴에 m3의 항목이 m2의 항목을 덮는다' }], held: [], stood: 11 };
  const mended = await run({ request: 'x', side: 3 }, { ...base, join: joinedAll, mend: () => ({ fixed: ['m2/one'] }), gate: (_c, nth) => (nth === 0 ? broke : held(12)()) });
  const after = labels(mended.calls);
  assert.deepEqual(after.slice(after.indexOf('gate:m2+m3'), after.indexOf('build:m4')), ['gate:m2+m3', 'mend:m2+m3:1', 'gate:m2+m3:again']);
  assert.match(mended.calls.find((c) => c.label === 'mend:m2+m3:1')!.prompt, /Each was proven alone\. Together, these promises do not hold[\s\S]*m2\/one: 메뉴에 m3의 항목이/);
  assert.match(mended.calls.find((c) => c.label === 'gate:m2+m3:again')!.prompt, /second look, after a fix\. These promises did not hold when the milestones were brought together: m2\/one/);
  assert.equal(mended.result.stopped, null);
  const still = await run({ request: 'x', side: 3 }, { ...base, join: joinedAll, mend: () => ({ fixed: [] }), gate: () => broke });
  assert.match(still.result.stopped, /each proven alone and, brought together, 1 promise\(s\) do not hold after two fixes: m2\/one/);
  assert.deepEqual(still.result.notBuilt, ['title m4']);
  assert.deepEqual(labels(still.calls).filter((l) => l.startsWith('mend')), ['mend:m2+m3:1', 'mend:m2+m3:2']);

  // One of the group does not come through: the other is still brought in and shown again, then the run stops.
  const refuted = { proven: ['one'], refuted: [{ id: 'two', fact: '링크를 열면 빈 화면' }], unchecked: [] };
  const half = await run({ request: 'x', side: 3 }, { ...base, verify: ({ label }) => (label.startsWith('verify:m3') ? refuted : proven()), fix: () => ({ fixed: [] }), join: joinedAll, gate: held(8) });
  assert.match(half.result.stopped, /"title m3" still has 1 claim\(s\) shown false/);
  assert.ok(labels(half.calls).includes('join:m2') && labels(half.calls).includes('gate:m2'), 'the one that came through is not left on a branch');
  assert.deepEqual(half.result.notBuilt, ['title m4']);
  assert.deepEqual(half.result.milestones.map((m: { id: string; refuted: unknown[] }) => [m.id, m.refuted.length]), [['m1', 0], ['m2', 0], ['m3', 1]]);
  // The sandbox stopped the look at the joined product: said as that.
  const sand = await run({ request: 'x', side: 3 }, { ...base, join: joinedAll, gate: () => ({ proven: [], refuted: [], unchecked: [], sandbox: 'Run outside of the sandbox' }) });
  assert.match(sand.result.stopped, /brought together and could not be looked at: the session's command sandbox/);
});

test('the stages that run at low effort are told to do every step before they return, and the others are not', async () => {
  const ran = await run({ request: 'x' }, { plan: plan('m1'), build: built, verify: () => ({ proven: ['one', 'two'], refuted: [], unchecked: [] }), close: closed });
  const closer = ran.calls.find((c) => c.label === 'close:m1')!;
  assert.equal(closer.effort, 'low');
  assert.match(closer.prompt, /Change no product code\. Do every step you were given before you return: nobody is watching to say "go on"/);
  // An ordinary obstacle is worked through; what was decided as a stop is not.
  assert.match(closer.prompt, /An ordinary obstacle \(a command that times out, a file that is locked, an answer that comes back empty\) is looked into and worked through/);
  assert.match(closer.prompt, /What was decided as a stop is not worked past \(a command the plugin refuses, a call outside the sandbox that is refused, a merge that conflicts, a contract that will not close\): say what you found in what you return/);
  assert.match(closer.prompt, /This lifts none of the limits above on what you may change or run\.$/);
  // Whoever plans, builds and verifies runs at high or as the session, and is not told so: a builder that returns
  // early costs a fix round, and its own steps say when to stop waiting.
  for (const label of ['plan', 'build:m1', 'verify:m1']) assert.doesNotMatch(ran.calls.find((c) => c.label === label)!.prompt, /Do every step you were given before you return/, label);
  // Every agent the script runs at low effort ends on it, and no other: the prototype's sweep, the close, bringing
  // milestones together, and making their folders.
  const low = [...SOURCE.matchAll(/\$\{FINISH\}`,\n\s*\{ label: [`']([a-z]+)[:`'][^\n]*effort\('(?:close|join)'\)/g)].map((m) => m[1]!);
  assert.deepEqual(low.sort(), ['close', 'join', 'stage', 'sweep']);
  assert.equal([...SOURCE.matchAll(/\$\{FINISH\}/g)].length, 4);
  assert.equal([...SOURCE.matchAll(/effort\('(?:close|join)'\)/g)].length, 4);
});

test('a look after a fix tries new cases only where the fix reached, and a frozen check that only presses old words is corrected, not set aside', async () => {
  // 2026-11-23: a first pass's third look left one claim false. Its fourth found three: a claim the third had
  // proven, broken by a new case; another new case; a fault the third fix put in. 297 minutes, left open. And a
  // frozen flow that pressed "30일 넘게" after the product was mended to the law's "30일 이상" sent its claim to the
  // owner, because whoever ruled after a fix could change no flow.
  let looks = 0;
  const ran = await run(
    { request: 'x' },
    {
      plan: plan('m1'),
      build: built,
      verify: () => (looks++ === 0 ? { proven: ['two'], refuted: [{ id: 'one', fact: '흐름이 151걸음에서 멈춤' }], unchecked: [] } : { proven: ['one', 'two'], refuted: [], unchecked: [] }),
      fix: () => ({ fixed: [], notFixed: ['one: flows/one.sh:96 presses "30일 넘게"; the screen says "30일 이상" as the law does', 'two: flows/two.sh:12 reads the old label "받았어요"; the drawing has "늦게 받았어요"'] }),
      rule: () => ({ disputed: [], productWrong: [], corrected: [{ id: 'one', file: 'flows/one.sh', changed: 'line 96 presses "30일 이상"' }, { id: 'two', file: 'flows/two.sh', changed: 'line 12 reads "늦게 받았어요"' }, { id: 'nobody', file: 'x', changed: 'y' }] }),
      close: closed,
    },
  );
  assert.deepEqual(ran.calls.map((c) => c.label), ['plan', 'build:m1', 'verify:m1', 'fix:m1:1', 'rule:m1', 'verify:m1:again', 'close:m1']);
  const first = ran.calls.find((c) => c.label === 'verify:m1')!.prompt;
  const again = ran.calls.find((c) => c.label === 'verify:m1:again')!.prompt;
  // The first look tries every claim; a look after a fix says where new cases are tried and where they are not.
  assert.match(first, /A claim's figures are one case of what it is about: when you try another case/);
  assert.doesNotMatch(first, /New cases are tried at this look only where the fix reached/);
  assert.match(again, /These claims of the contract were shown false before: one\./);
  assert.match(again, /What was found then: \[one: 흐름이 151걸음에서 멈춤\]/);
  assert.match(again, /New cases are tried at this look only where the fix reached: on the claims named above as shown false before, and on any other claim of yours whose screens or rules the fix changed \(`git log --stat` shows on top what the fix just made changed\)/);
  assert.match(again, /A claim that an earlier look proved and that the fix did not reach is shown again by its own check and is not tried with new cases: it had that at the first look/);
  assert.match(again, /What its own check, or the screen in front of you as you run it, shows wrong is still that claim shown false/);

  // Whoever fixes mends to the source or the drawing, says which frozen checks now press the old form, and leaves no server.
  const fixer = ran.calls.find((c) => c.label === 'fix:m1:1')!.prompt;
  assert.match(fixer, /keep what it reads as it was unless the claim you were handed says otherwise\. Where it does \(its source, or the drawing the product is held to, asks for the new form\), mend the product and do not bend it back to keep that check passing: put one line under "notFixed" for each frozen check that now presses or reads the old form, beginning with the id of the claim that check shows, with the file, the line, the old words and the new\. Whoever rules next corrects how such a check presses or reads; it is not yours to edit/);
  assert.match(fixer, /Do not leave a server running\.$/);

  // Whoever rules may correct how such a check presses or reads, and nothing it expects; product code and claims stay closed to it.
  const ruling = ran.calls.find((c) => c.label === 'rule:m1')!.prompt;
  assert.match(ruling, /when in doubt it is this one[\s\S]*sz-eyes contract dispute m1 <claim id> --ruling/);
  assert.match(ruling, /\*\*A frozen flow or test stops for a reason that is not its claim's\.\*\* The product was mended to follow a claim's source or the drawing it is held to, and the check still presses, reads or waits for the old words, an old label or an old selector, or asserts text its claim never mentions\. Such a check asks the product for no answer/);
  assert.match(ruling, /correct how it presses or reads, by the smallest change and as your own rules say \(never a figure or an outcome it expects, a condition, a step its claim requires, or a failure into a pass\), record it \(`sz-eyes contract amend m1 --file <the file> --why "<what the mend changed in the product, by which source or drawing, and what you changed in the check>"`\), run it once, and commit that file and no other/);
  assert.match(ruling, /A claim whose check you corrected is not set aside: return it under "corrected"/);
  assert.match(ruling, /Change no product code and no claim, and no flow or test except as the third case says\./);
  // A line about a check of a claim that was not shown false does not hand every false claim to whoever rules.
  assert.match(ruling, /- one: 흐름이 151걸음에서 멈춤/);
  assert.match(ruling, /two: flows\/two\.sh:12 reads the old label/);
  // A corrected claim is not the owner's: it is looked at again, and the run says what was corrected.
  assert.deepEqual(ran.result.forOwner, []);
  assert.ok(ran.logs.some((l) => /the check flows\/one\.sh of claim "one" was corrected in how it presses or reads, not in what it expects: line 96 presses "30일 이상"/.test(l)), ran.logs.join('\n'));
  assert.ok(ran.logs.some((l) => /the check flows\/two\.sh of claim "two" was corrected/.test(l)));
  assert.ok(!ran.logs.some((l) => /claim "nobody"/.test(l)), 'a claim the contract does not have is not reported');
  assert.deepEqual(ran.result.milestones[0].proven.sort(), ['one', 'two']);
  assert.equal(ran.result.stopped, null);

  // Only stale checks, nothing that cannot be made true: whoever rules is handed no claim to decide, only the checks.
  let looks2 = 0;
  const stale = await run(
    { request: 'x' },
    {
      plan: plan('m1'),
      build: built,
      verify: () => (looks2++ === 0 ? { proven: ['two'], refuted: [{ id: 'one', fact: '합계가 0' }], unchecked: [] } : { proven: ['one', 'two'], refuted: [], unchecked: [] }),
      fix: () => ({ fixed: ['one'], notFixed: ['two: flows/two.sh:12 reads the old label'] }),
      rule: () => ({ disputed: [], productWrong: [], corrected: [{ id: 'two', file: 'flows/two.sh', changed: 'line 12' }] }),
      close: closed,
    },
  );
  const only = stale.calls.find((c) => c.label === 'rule:m1')!.prompt;
  assert.doesNotMatch(only, /- one: 합계가 0/, 'the claim that was mended is not handed to whoever rules');
  assert.match(only, /None of the claims shown false is yours to decide this time: what follows is about frozen checks that now press or read an old form/);
  assert.match(only, /two: flows\/two\.sh:12 reads the old label/);

});

test('every agent is told from its first line when the session is sandboxed, an earlier milestone\'s verdicts are not made up, and how hard each stage thinks can be said', async () => {
  const answers = { build: built, verify: proven, close: closed };
  const earlier = (sandboxed: boolean) => () => ({ mode: 'continue', summary: 's', sandboxed, milestones: [{ id: 'm1', title: 'title m1', builds: 'b', claims: [claim('one'), claim('owner')], state: 'closed', contractId: 'm1' }, { id: 'm2', title: 'title m2', builds: 'b', claims: [claim('one'), claim('two')] }] });
  const inside = await run({ request: 'x' }, { ...answers, plan: earlier(true) });
  assert.match(inside.calls.find((c) => c.label === 'plan')!.prompt, /run `sz-eyes sandbox` once, as an ordinary command[\s\S]*return under "sandboxed"/);
  for (const label of ['build:m2', 'verify:m2']) assert.match(inside.calls.find((c) => c.label === label)!.prompt, /This session runs its commands inside a sandbox[\s\S]*outside it from the first try/, label);
  // 2026-11-22: eight times in one run an agent's `kill` or `ps` of a server an earlier command had started was refused inside the sandbox and run again outside.
  assert.match(inside.calls.find((c) => c.label === 'verify:m2')!.prompt, /So is ending or listing a process that an earlier command started \(`kill`, `ps`\): inside, the sandbox refuses it/);
  const outside = await run({ request: 'x' }, { ...answers, plan: earlier(false) });
  assert.doesNotMatch(outside.calls.find((c) => c.label === 'build:m2')!.prompt, /This session runs its commands inside a sandbox/);
  assert.match(outside.calls.find((c) => c.label === 'build:m2')!.prompt, /If `sz-eyes` says the session's command sandbox stopped it/);
  // Where nobody could say whether the session is sandboxed, the line names the same commands as where it is known.
  assert.match(outside.calls.find((c) => c.label === 'build:m2')!.prompt, /a simulator or Docker outside the sandbox from the first try[\s\S]*and likewise ending or listing a process that an earlier command started \(`kill`, `ps`\)/);
  // The first milestone was closed by an earlier run; one of its claims is the owner's to judge and still open.
  // What this run knows of it is that it is closed, and where its verdicts are: it does not call its claims proven.
  assert.deepEqual(inside.result.milestones[0], { id: 'm1', title: 'title m1', contractId: 'm1', earlier: true, verdicts: 'closed in an earlier run: sz-eyes contract show m1', proven: [], refuted: [], unchecked: [], noticed: [], report: null });
  assert.match(inside.calls.find((c) => c.label === 'build:m2')!.prompt, /- title m1: closed in an earlier run/);

  // The plan and the verification think as hard as the session; building at "high"; closing at "low".
  assert.deepEqual(inside.calls.map((c) => [c.label, c.effort]), [['plan', undefined], ['build:m2', 'high'], ['verify:m2', undefined], ['close:m2', 'low']]);
  // One word is for the builders; each stage can be named; "session" gives a stage back to the session's setting.
  const word = await run({ request: 'x', effort: 'xhigh' }, { ...answers, plan: earlier(false) });
  assert.deepEqual(word.calls.map((c) => [c.label, c.effort]), [['plan', undefined], ['build:m2', 'xhigh'], ['verify:m2', undefined], ['close:m2', 'low']]);
  const each = await run({ request: 'x', effort: { build: 'session', verify: 'high', close: 'nonsense' } }, { ...answers, plan: earlier(false) });
  assert.deepEqual(each.calls.map((c) => [c.label, c.effort]), [['plan', undefined], ['build:m2', undefined], ['verify:m2', 'high'], ['close:m2', 'low']]);
  // Staging and joining are mechanical too; the look at the joined product is a verification.
  const sideways = await run({ request: 'x', side: 2 }, { ...answers, plan: graph({ id: 'm1' }, { id: 'm2', after: ['m1'] }, { id: 'm3', after: ['m1'] }), stage: staged, join: joinedAll, gate: held(6) });
  assert.deepEqual(sideways.calls.filter((c) => /^(stage|join|gate)/.test(c.label)).map((c) => [c.label, c.effort]), [['stage:m2+m3', 'low'], ['join:m2+m3', 'low'], ['gate:m2+m3', undefined]]);

  // Unsaid, no agent is given a model: each runs on the session's, the verifier on the one its definition names.
  assert.deepEqual(inside.calls.map((c) => c.model), [undefined, undefined, undefined, undefined]);
  // One word puts the builders on another model and nothing else. The plan can be named. Verification is not
  // moved from here, and a word that is no model of ours is not passed on.
  const sonnet = await run({ request: 'x', model: 'sonnet' }, { ...answers, plan: earlier(false) });
  assert.deepEqual(sonnet.calls.map((c) => [c.label, c.model]), [['plan', undefined], ['build:m2', 'sonnet'], ['verify:m2', undefined], ['close:m2', undefined]]);
  const named = await run({ request: 'x', model: { plan: 'opus', build: 'sonnet', verify: 'sonnet', close: 'sonnet' } }, { ...answers, plan: earlier(false) });
  assert.deepEqual(named.calls.map((c) => [c.label, c.model]), [['plan', 'opus'], ['build:m2', 'sonnet'], ['verify:m2', undefined], ['close:m2', undefined]]);
  const unknown = await run({ request: 'x', model: 'fable' }, { ...answers, plan: earlier(false) });
  assert.deepEqual(unknown.calls.map((c) => c.model), [undefined, undefined, undefined, undefined]);
});

// ---- what may be left not real, and who says so
// The product that showed it: a photographed dental estimate set item by item against the neighbourhood's published
// prices. Its plan had the prices as examples, "not connected yet", and the photograph was said to be unread: its one
// thing would have run on made-up figures, every claim proven. The prices were an open API for a free key; reading the
// photograph needed a model key of the owner's. Nobody had asked them for either.
type Entry = { what: string; reason: string; tried: string; needs: string; vault?: string; arm?: string; onPath: boolean; named: boolean; said?: string };
const ESTIMATE = '치과 견적서를 찍으면 항목마다 우리 동네 평균 가격과 비교해 줘. 보험이 안 되는 항목은 경고해 주고';
const reading: Entry = { what: '견적서 사진 읽기', reason: 'owner', tried: 'sz-eyes secret has model/anthropic/api-key: MISSING', needs: '사진을 읽는 모델의 키, 사장님 것', vault: 'model/anthropic/api-key', onPath: true, named: false };
const prices: Entry = { what: '동네 평균 가격', reason: 'owner', tried: '심평원 비급여 진료비 공개: 공공데이터포털 오픈 API, 무료 키. sz-eyes secret has data/hira/service-key: MISSING', needs: '공공데이터포털에서 사장님이 활용 신청해 받는 무료 키', vault: 'data/hira/service-key', onPath: true, named: true };
const warnings: Entry = { what: '보험이 안 되는 항목 경고', reason: 'owner', tried: '심평원 급여 기준 고시', needs: '급여 기준을 읽어 규칙으로', onPath: false, named: true };
const reviews: Entry = { what: '병원 후기', reason: 'people', tried: '후기를 쓸 사람이 아직 없다', needs: '쓰는 사람들', onPath: false, named: false };
const passWith = (...notReal: Entry[]) => () => ({ mode: 'new', summary: 's', milestones: [{ ...firstPass, notReal }] });
const goes = (...notReal: Entry[]): Record<string, Answer> => ({ plan: passWith(...notReal), build: built, verify: allProven, close: closed });

test('a plan that leaves the one thing\'s path not real builds nothing, and says what is needed from the owner and how it is given', async () => {
  const ran = await run({ request: ESTIMATE, asked: 'owner', answers: '계정: 없이 (이 기기에만)' }, goes(reading, reviews));
  assert.deepEqual(labels(ran.calls), ['plan'], 'no builder starts');
  const planned = ran.calls[0]!.prompt;
  assert.match(planned, /On the path of the one thing the product is for \(what a person gives it, what is done with it, what they get back\), everything is real, or nothing is built/);
  assert.match(planned, /"Not connected yet" and "nobody has read it yet" are not reasons: finding the source and reading it is the work/);
  assert.match(planned, /`sz-eyes secret has <vault id>`/);
  assert.match(planned, /The claim of the one thing is worded on real input and real data/);
  assert.match(planned, /Nothing pretends/);
  assert.match(ran.result.stopped, /^nothing was built/);
  assert.match(ran.result.stopped, /견적서 사진 읽기: it is on the path of the one thing[\s\S]*사진을 읽는 모델의 키, 사장님 것[\s\S]*run `sz-eyes secret has model\/anthropic\/api-key` and put the line it prints to the owner as it stands/);
  assert.match(ran.result.stopped, /start this workflow again with asked: "owner" and their words, word for word, in answers/);
  assert.doesNotMatch(ran.result.stopped, /병원 후기/, 'what may stand off the path is not asked for');
  assert.deepEqual(ran.result.needed.map((n: { what: string; give: string }) => [n.what, n.give]), [['견적서 사진 읽기', 'sz-eyes secret has model/anthropic/api-key']]);
  assert.ok(ran.logs.includes(ran.result.stopped), 'the log says it as the return does');
  assert.deepEqual(ran.result.milestones, []);
  assert.deepEqual(ran.result.notBuilt, ['첫 판']);
});

test('a key that is an arm\'s is asked for with the arm\'s own guide, and a name that is not an arm\'s is never put in a command', async () => {
  const ran = await run({ request: ESTIMATE, asked: 'away' }, goes({ ...reading, arm: 'read' }, { ...prices, arm: 'public-data; rm -rf ~' }));
  assert.deepEqual(labels(ran.calls), ['plan'], 'no builder starts');
  assert.match(ran.calls[0]!.prompt, /the arms \(`sz-eyes arm list`\), and `sz-eyes arm need <name>` says whether an arm's keys are in the vault, with the owner's steps when they are not/);
  assert.match(ran.result.stopped, /견적서 사진 읽기[^\]]*run `sz-eyes arm need read` and put what it prints to the owner as it stands/);
  assert.doesNotMatch(ran.result.stopped, /rm -rf/);
  assert.deepEqual(ran.result.needed.map((n: { steps: string }) => n.steps), ['sz-eyes arm need read', '']);
});

test('what the owner\'s request names, or puts off as later, is not left out or made an example without their words, found in what they said', async () => {
  const named = await run({ request: ESTIMATE, asked: 'owner', answers: '계정: 없이' }, goes(warnings));
  assert.deepEqual(labels(named.calls), ['plan']);
  assert.match(named.result.stopped, /보험이 안 되는 항목 경고: the owner's request names it/);
  // Words the plan gives as the owner's that are not in what they said are not their word.
  const made = await run({ request: ESTIMATE, asked: 'owner', answers: '계정: 없이' }, goes({ ...warnings, said: '경고는 나중에 해도 돼요' }));
  assert.deepEqual(labels(made.calls), ['plan']);
  assert.match(made.result.stopped, /the words given as theirs, "경고는 나중에 해도 돼요", are not in their request or their answers/);
  // With the owner away, what the session wrote is not their word.
  const away = await run({ request: ESTIMATE, asked: 'away', answers: '경고는 나중에 해도 돼요' }, goes({ ...warnings, said: '경고는 나중에 해도 돼요' }));
  assert.deepEqual(labels(away.calls), ['plan']);
  // "Later" is the owner's to say.
  const later = await run({ request: ESTIMATE, asked: 'owner', answers: '계정: 없이' }, goes({ ...reviews, reason: 'later' }));
  assert.deepEqual(labels(later.calls), ['plan']);
  assert.match(later.result.stopped, /병원 후기: it is put off as later/);
  // Listed without saying where it was looked for: nothing is built on a list nobody looked behind.
  const unlooked = await run({ request: ESTIMATE }, goes({ ...reviews, tried: ' ' }));
  assert.deepEqual(labels(unlooked.calls), ['plan']);
  assert.match(unlooked.result.stopped, /병원 후기: it is listed without looking/);
});

test('with the owner\'s words the same entries go on, the builder is handed the list and adds nothing to it, and the one thing is shown from a real input', async () => {
  const answers = '계정: 없이 (이 기기에만)\n가격 데이터: 키 받기 전에는 일단 예시로 지어\n경고: 나중에';
  const ran = await run({ request: ESTIMATE, asked: 'owner', answers }, goes({ ...prices, said: '“키 받기 전에는  일단 예시로 지어”' }, { ...warnings, reason: 'later', said: '경고: 나중에' }, reviews));
  assert.deepEqual(labels(ran.calls), ['plan', 'build:m1', 'verify:m1', 'close:m1']);
  assert.equal(ran.result.stopped, null);
  assert.deepEqual(ran.result.needed, []);
  const builder = ran.calls.find((c) => c.label === 'build:m1')!.prompt;
  assert.match(builder, /What is not real yet in this milestone, as the plan lists it[^\n]*\n- 동네 평균 가격 \| owner \| [^\n]*\| the owner allowed it for now: "키 받기 전에는 일단 예시로 지어"\n- 보험이 안 되는 항목 경고 \| later \| [^\n]*\n- 병원 후기 \| people \| 쓰는 사람들\n/);
  assert.match(builder, /Whoever builds adds nothing to this list[\s\S]*do not put an example and a line on the screen in its place: stop, commit what you built, and return it under "notReal"/);
  const look = ran.calls.find((c) => c.label === 'verify:m1')!.prompt;
  assert.match(look, /The claim of the one thing the product is for \(the spec names it\) is shown from a real input to a real result[\s\S]*Shown on an example, a fixture or figures the product made up, it is refuted, whatever the screen says about itself/);
  assert.match(look, /except what the owner allowed to be an example for now: 동네 평균 가격/);
  assert.ok(ran.logs.some((l) => /^not real yet in "첫 판": 동네 평균 가격 \(owner; the owner: "키 받기 전에는 일단 예시로 지어"\); 보험이 안 되는 항목 경고 \(later; the owner: "경고: 나중에"\); 병원 후기 \(people\)$/.test(l)), ran.logs.join('\n'));
});

test('an entry off the path with one of the four reasons goes on; a builder that finds something cannot be made real stops the run, and so does a plan after the first pass', async () => {
  const off = await run({ request: ESTIMATE }, goes(reviews));
  assert.deepEqual(labels(off.calls), ['plan', 'build:m1', 'verify:m1', 'close:m1']);
  assert.equal(off.result.stopped, null);
  // A plan with nothing listed: the builder is told so, and still that it adds nothing; the fixer puts in no example either.
  const plain = await run({ request: 'x' }, { plan: plan('m1'), build: built, fix: () => ({ fixed: ['two'] }), verify: (_c: Call, nth: number) => (nth === 0 ? { proven: ['one'], refuted: [{ id: 'two', fact: '예시 가격으로 나온다' }], unchecked: [] } : allProven()), close: closed });
  assert.match(plain.calls.find((c) => c.label === 'build:m1')!.prompt, /Nothing in this milestone is listed as not real: all of it is real\. Whoever builds adds nothing to this list/);
  assert.match(plain.calls.find((c) => c.label === 'verify:m1')!.prompt, /shown from a real input to a real result/);
  assert.match(plain.calls.find((c) => c.label === 'verify:m1:again')!.prompt, /shown from a real input to a real result/);
  assert.match(plain.calls.find((c) => c.label === 'fix:m1:1')!.prompt, /Nothing is put in as an example to make a claim true/);

  // The builder found it cannot be made real: it stops and brings it back, and nobody verifies an example.
  const found = await run({ request: ESTIMATE }, { plan: plan('m1', 'm2'), build: (c: Call) => ({ ...built(c), notReal: [{ what: '동네 평균 가격', tried: '오픈 API가 키 없이 401', needs: '사장님이 받는 무료 키', vault: 'data/hira/service-key' }] }), verify: allProven, close: closed });
  assert.deepEqual(labels(found.calls), ['plan', 'build:m1']);
  assert.match(found.result.stopped, /^milestone "title m1" stopped on what cannot be made real with what is at hand[\s\S]*동네 평균 가격: 사장님이 받는 무료 키[\s\S]*run `sz-eyes secret has data\/hira\/service-key` and put the line it prints to the owner as it stands/);
  assert.deepEqual(found.result.needed.map((n: { what: string }) => n.what), ['동네 평균 가격']);
  assert.deepEqual(found.result.notBuilt, ['title m1', 'title m2']);

  // A vault id that is not one is never put in a command the owner pastes.
  const odd = await run({ request: ESTIMATE }, goes({ ...reading, vault: 'key; rm -rf ~' }));
  assert.doesNotMatch(odd.result.stopped, /secret (set|has) key; rm/);
  assert.match(odd.result.stopped, /"key; rm -rf ~" is not a vault id/);

  // What comes after the first pass is held to the same list before its builders start.
  const cut = { ...firstPass, notReal: [reviews] };
  const after = await run({ request: ESTIMATE }, { plan: (_c: Call, nth: number) => (nth === 0 ? { mode: 'new', summary: 's', milestones: [cut], later: [{ title: '가격 깊이', what: 'w' }] } : { mode: 'continue', summary: 's', milestones: [{ ...cut, state: 'closed' }, { id: 'm2', title: '가격 깊이', builds: 'b', claims: [claim('one')], notReal: [prices] }] }), build: built, verify: allProven, close: closed });
  assert.deepEqual(labels(after.calls), ['plan', 'build:m1', 'verify:m1', 'close:m1', 'plan:after']);
  assert.match(after.result.stopped, /^the first pass stands; nothing after it was built[\s\S]*동네 평균 가격: it is on the path of the one thing/);
  assert.deepEqual(after.result.milestones.map((m: { id: string }) => m.id), ['m1']);
});

test('the stop at the drawing says what the build needs from the owner and how each is given, and the screens are planned by the same rule', async () => {
  const ran = await run({ request: ESTIMATE, asked: 'owner', answers: '계정: 없이' }, drawing({ plan: needed, screens: () => ({ ...planned, notReal: [reading, reviews] }) }));
  assert.deepEqual(labels(ran.calls), ['plan', 'screens', 'refs', 'design', 'sweep:design']);
  const ready = ran.logs.find((l) => /^DESIGN READY/.test(l))!;
  assert.match(ready, /all 3 hold at phone size and at their limits\. Before the build, from the owner: 견적서 사진 읽기: 사진을 읽는 모델의 키, 사장님 것 \(`sz-eyes secret has model\/anthropic\/api-key`\)\. Not real yet in the first pass, each said on its screen: 병원 후기 \(people\)\.$/);
  assert.match(ran.result.stopped, /^the prototype waits for the owner[\s\S]*Before the build, from the owner: 견적서 사진 읽기[\s\S]*a key they put in the vault themselves, in their own terminal \(run the command in brackets and put what it prints to them as it stands: their steps and the line that stores the key\), or their words that it may be an example for now, which go word for word into answers \(asked: "owner"\) when this workflow is started again/);
  assert.deepEqual(ran.result.needed.map((n: { what: string }) => n.what), ['견적서 사진 읽기']);
  // No stop carries a storing line of its own: `sz-eyes` is not on the PATH of the owner's shell, and only the tool
  // can print the line whole. Where the key is an arm's, the bracket names the arm's guide.
  assert.doesNotMatch(`${ready} ${ran.result.stopped}`, /pbpaste/);
  const armed = await run({ request: ESTIMATE, asked: 'owner', answers: '계정: 없이' }, drawing({ plan: needed, screens: () => ({ ...planned, notReal: [{ ...reading, arm: 'read' }] }) }));
  assert.match(armed.logs.find((l) => /^DESIGN READY/.test(l))!, /사진을 읽는 모델의 키, 사장님 것 \(`sz-eyes arm need read`\)\.$/);
  // The sweep's line counts every drawing (states and limits too) and calls each a screen: the stop says both
  // numbers, so 3 screens beside "7 screens" is not read as a disagreement (the first real run: 24 and 44).
  const many = await run({ request: ESTIMATE, asked: 'owner', answers: '계정: 없이' }, drawing({ plan: needed, sweep: () => ({ ...holding(), drawings: 7, summary: '7 screens, 7 hold, 0 findings above minor in all; every screen holds (4 s)' }) }));
  assert.match(many.logs.find((l) => /^DESIGN READY/.test(l))!, /^DESIGN READY: open \.sz\/design\/prototype\.html\. 3 screen\(s\) of the plan drawn \(7 drawings with their states and limits\), all 3 hold at phone size and at their limits/);
  assert.match(many.calls.find((c) => c.label === 'sweep:design')!.prompt, /how many drawings the sweep measured/);
  const screens = ran.calls.find((c) => c.label === 'screens')!.prompt;
  assert.match(screens, /everything is real, or nothing is built[\s\S]*"Not connected yet" and "nobody has read it yet" are not reasons/);
  assert.match(screens, /Return that list under "notReal"/);
  // Nothing asked of the owner: the stop reads as before.
  const plainStop = await run({ request: 'x' }, drawing({ plan: needed }));
  assert.match(plainStop.logs.find((l) => /^DESIGN READY/.test(l))!, /hold at phone size and at their limits$/);
  assert.doesNotMatch(plainStop.result.stopped, /Before the build, from the owner/);
});

test('an agent the workflow starts by type and tells to load skills has the Skill tool, and a verifier counts only a check that passes in front of it', () => {
  // Every prompt carries "Load the skills you need with the Skill tool", and the verifier's own file says to read
  // `sz:verify`. With `tools: Read, Grep, Glob, Bash` it could not: in two whole runs (2026-11-17, 2026-11-18) each
  // verifier searched the disk for the file (`find / ... SKILL.md`, two minutes each), and two of five read the
  // copy in another checkout of the repository, not the one of the plugin that was running.
  const file = (name: string): string => readFileSync(fileURLToPath(new URL(`../../../plugin/agents/${name}.md`, import.meta.url)), 'utf8');
  const types = [...new Set([...SOURCE.matchAll(/agentType: 'sz:([a-z-]+)'/g)].map((m) => m[1]!))];
  assert.deepEqual(types.sort(), ['arbiter', 'facts', 'redteam', 'verifier']);
  assert.match(SOURCE, /Load the skills you need with the Skill tool/);
  for (const type of types) {
    const tools = /^tools:\s*(.+)$/m.exec(file(type))?.[1]?.split(',').map((t) => t.trim()) ?? [];
    // The two readers get their entire assignments in the prompt. Only adjudication and verification load skills.
    if (type === 'facts' || type === 'redteam') assert.deepEqual(tools, ['Read', 'Bash', 'WebSearch', 'WebFetch']);
    else assert.ok(tools.includes('Skill'), `${type}: told to load skills, and has no Skill tool (${tools.join(', ')})`);
    assert.ok(!tools.includes('Write'), `${type}: writes with commands under the evidence folder, and is given no tool that edits the product by hand`);
  }
  // 2026-11-18: a flow that did not walk to its end in any of ten runs at the second look, and its claim left proven
  // on the run of the first look.
  assert.match(file('verifier'), /\*\*A check proves a claim only when it passes in front of you\.\*\*[^\n]*never left `proven` on an earlier run/);
});

test('the frozen checks a builder disputes go to one arbiter in one sitting, and a fault other checks share is corrected in them too', async () => {
  // 2026-11-18, the phone milestone: eleven disputes, eleven arbiters one after another for 75 minutes, each
  // starting the product again, three in a row stopped by the same Safari tip. One of them corrected a helper's
  // call in one flow (`r=$(api ...)` loses the status the helper keeps); another flow called it the same way,
  // passed by chance on the status of an earlier call, and was left as it was.
  const proven = () => ({ proven: ['one', 'two'], refuted: [], unchecked: [] });
  const disputing = (disputes: { file: string; problem: string }[]) => ({
    plan: plan('m1'),
    build: (call: Call) => ({ ...built(call), disputes }),
    arbiter: () => ({ rulings: disputes.map((d) => ({ file: d.file, which: 'check', now: 'passes' })) }),
    verify: proven,
    close: closed,
  });

  const three = await run({ request: 'x' }, disputing([
    { file: 'e2e/ios/01-signin.sh', problem: '따옴표가 잘못되어 셸이 다르게 읽음' },
    { file: 'e2e/ios/02-weigh.sh', problem: '대기 시간이 10초라 스택이 깨기 전에 끝남' },
    { file: 'e2e/ios/03-steps.sh', problem: 'r=$(api ...) 뒤에 $CODE가 비어 있음' },
  ]));
  const rulings = three.calls.filter((c) => c.label.startsWith('arbiter:'));
  assert.equal(rulings.length, 1, `one arbiter for the three: ${three.calls.map((c) => c.label).join(', ')}`);
  const prompt = rulings[0]!.prompt;
  for (const part of ['`e2e/ios/01-signin.sh`: 따옴표가 잘못되어 셸이 다르게 읽음', '`e2e/ios/02-weigh.sh`: 대기 시간이 10초라', '`e2e/ios/03-steps.sh`: r=$(api ...) 뒤에 $CODE가 비어 있음']) assert.ok(prompt.includes(part), `the arbiter is handed: ${part}`);
  assert.match(prompt, /Settle 3 disputes about frozen checks/);
  assert.match(prompt, /Start what they need once[^.]*and settle them one after another on it/);
  assert.match(prompt, /return what you decided for each/);
  // Said in the request itself, not only in the arbiter's own file: on a real session (2026-11-18) the arbiter
  // found the fault in a third check and corrected it, and the command that records the correction was refused
  // as something nobody had asked for, because the request named two files.
  assert.match(prompt, /other frozen checks share[^.]*those are yours to correct too, though nobody disputed them[^.]*`sz-eyes contract amend`/);
  assert.ok(three.calls.findIndex((c) => c.label.startsWith('arbiter:')) < three.calls.findIndex((c) => c.label.startsWith('verify:')), 'settled before anyone verifies');

  const single = await run({ request: 'x' }, disputing([{ file: 'test/rule.test.mjs', problem: '기대값을 잘못 옮겨 적음' }]));
  const only = single.calls.filter((c) => c.label.startsWith('arbiter:'));
  assert.equal(only.length, 1);
  assert.match(only[0]!.prompt, /Settle a dispute about a frozen check/);
  assert.ok(only[0]!.prompt.includes('`test/rule.test.mjs`: 기대값을 잘못 옮겨 적음'));
  assert.doesNotMatch(only[0]!.prompt, /one after another/);

  const none = await run({ request: 'x' }, disputing([]));
  assert.ok(!none.calls.some((c) => c.label.startsWith('arbiter:')), 'nobody is started when nothing is disputed');

  // The arbiter's own instructions: several files in one sitting, and the same fault wherever it is.
  const arbiter = readFileSync(fileURLToPath(new URL('../../../plugin/agents/arbiter.md', import.meta.url)), 'utf8');
  assert.match(arbiter, /one or more frozen files/);
  assert.match(arbiter, /\*\*The same fault in other checks\.\*\*[^\n]*passes by chance[^\n]*`sz-eyes contract amend`/);
  // (2026-11-21: a run that went on from a built milestone was handed, as disputes, four checks an arbiter had
  // corrected two days before, and an arbiter spent ten minutes finding each of them right.)
  assert.match(SOURCE, /under "disputes" any frozen check the earlier run reported as wrong about how it checks and nobody has corrected since: one the contract lists as corrected[^.]*is settled, and is not listed again/);
  // (2026-11-19: three corrected flows stayed uncommitted to the end of the run, while every verifier's copy is
  // made from what is committed.)
  assert.match(arbiter, /Then commit the check you corrected, that file and no other[^\n]*a copy made from what is committed/);
});

test('a milestone an earlier run looked at whole and left with claims shown false is taken up at the fix', async () => {
  // (2026-11-19: a first pass stopped with two of twenty claims shown false. Going on meant five verifiers looking
  // at all twenty again, three quarters of an hour, before anyone mended the two.)
  const left = (looked: unknown) => ({
    plan: () => ({ mode: 'continue', summary: 's', milestones: [{ id: 'm1', title: '첫 판', builds: 'b', claims: [claim('one'), claim('two'), claim('three'), { id: 'feel', says: 'the owner says so', kind: 'owner', ref: 'the app' }], state: 'built', contractId: 'm1', launch: 'node server.mjs' }] }),
    start: () => ({ launch: 'PORT=$(sz-eyes port) node server.mjs', ...(looked ? { looked } : {}) }),
    build: built,
    fix: () => ({ fixed: ['two'] }),
    verify: ({ label }: Call) => (label === 'verify:m1:again' ? { proven: ['one', 'two', 'three'], refuted: [], unchecked: [{ id: 'feel', why: '주인이 볼 것' }], noticed: ['새로 본 것'] } : { proven: ['one', 'two', 'three'], refuted: [], unchecked: [{ id: 'feel', why: '주인이 볼 것' }] }),
    close: closed,
  });
  const looked = { proven: ['one', 'three'], refuted: [{ id: 'two', fact: '2주 탭이 0.0kg으로 나옴' }], unchecked: [{ id: 'feel', why: '주인이 볼 것' }] };
  const ran = await run({ request: '이어서' }, left(looked));
  assert.deepEqual(ran.calls.map((c) => c.label), ['plan', 'start:m1', 'fix:m1:1', 'verify:m1:again', 'close:m1'], 'nobody looks at all of it again before the fix');
  assert.match(ran.calls.find((c) => c.label === 'start:m1')!.prompt, /Say what the contract records of an earlier look[\s\S]*\[아직\] nobody has looked[\s\S]*If any claim is still \[아직\], leave "looked" out\. You only read them/);
  assert.match(ran.calls.find((c) => c.label === 'fix:m1:1')!.prompt, /found these claims false:\n- two: 2주 탭이 0\.0kg으로 나옴/);
  // (2026-11-21: taken up after a fix that nobody had looked at, a fixer ran the checks of three claims that were
  // mended already, 21 of its 27 minutes, and the look after it ran them again.)
  assert.match(ran.calls.find((c) => c.label === 'fix:m1:1')!.prompt, /An earlier run found these and stopped; it, or someone since, may have mended some of them already[^\n]*For each that a commit has mended, say which commit and what it changed, and do not run its check/);
  // The run that stopped may have handed the claim to a fixer twice already: this run does not know, and the log does.
  assert.match(ran.calls.find((c) => c.label === 'fix:m1:1')!.prompt, /One that was mended before and shown false again by another case of the same kind \(the log shows each earlier mend\) is not mended by one more patch for the case named: mend the kind/);
  const again = ran.calls.find((c) => c.label === 'verify:m1:again')!.prompt;
  assert.match(again, /These claims of the contract were shown false before: two\. Check each from the start/);
  assert.match(again, /show again this contract's other claims and what stood before/, 'every claim is shown again after the fix, as after any fix');
  assert.match(again, /Under "noticed" return only what you notice that is new/, 'what the earlier look noticed is in the contract, and is not called nothing');
  assert.ok(ran.logs.some((l) => /첫 판: an earlier run looked at all of it and left 1 claim\(s\) shown false \(two\): those are mended first/.test(l)), ran.logs.join('\n'));
  assert.equal(ran.result.stopped, null);
  assert.deepEqual([...ran.result.milestones[0].proven].sort(), ['one', 'three', 'two']);
  assert.deepEqual(ran.result.milestones[0].noticed, ['새로 본 것']);

  // A look that was cut (a claim nobody has looked at), or that left nothing to mend, is not taken up: all of it is looked at.
  const cut = await run({ request: '이어서' }, left({ proven: ['one'], refuted: [{ id: 'two', fact: 'x' }], unchecked: [] }));
  assert.deepEqual(cut.calls.map((c) => c.label), ['plan', 'start:m1', 'verify:m1', 'close:m1']);
  const whole = await run({ request: '이어서' }, left({ proven: ['one', 'two', 'three'], refuted: [], unchecked: [{ id: 'feel', why: '주인이 볼 것' }] }));
  assert.deepEqual(whole.calls.map((c) => c.label), ['plan', 'start:m1', 'verify:m1', 'close:m1']);
  const silent = await run({ request: '이어서' }, left(null));
  assert.deepEqual(silent.calls.map((c) => c.label), ['plan', 'start:m1', 'verify:m1', 'close:m1']);

  // A claim set aside for the owner then is still theirs, and a promise of earlier work found broken is mended too.
  const more = await run({ request: '이어서' }, { ...left({ proven: ['one'], refuted: [], unchecked: [{ id: 'feel', why: '주인이 볼 것' }], aside: ['two', 'three'], broken: [{ key: 'm0/keeps', fact: '닫았다 열면 기록이 없음' }] }), verify: () => ({ proven: ['one'], refuted: [], unchecked: [], held: ['m0/keeps'] }) });
  assert.deepEqual(more.calls.map((c) => c.label), ['plan', 'start:m1', 'fix:m1:1', 'verify:m1:again', 'close:m1']);
  assert.match(more.calls.find((c) => c.label === 'fix:m1:1')!.prompt, /true before this work and are not now[\s\S]*- m0\/keeps: 닫았다 열면 기록이 없음/);
  assert.deepEqual(more.result.forOwner.map((line: string) => line.split(':')[0]), ['m1/two', 'm1/three']);
});

test('a claim is handed to a fixer twice at most, and what a later look shows false for the first time still gets its fix', async () => {
  // (2026-11-19: stopped "after two fixes" with two claims shown false, one found only at the third look and one
  // mended once. Each fix had made true what it was handed; each look had found something the one before had not.)
  const three = { plan: () => ({ mode: 'extend', summary: 's', milestones: [{ id: 'm1', title: 'title m1', builds: 'b', claims: [claim('one'), claim('two'), claim('three')] }] }), build: built, fix: () => ({ fixed: [] }), close: closed };
  const looks = (...each: { id: string; fact: string }[][]) => (_: Call, nth: number) => {
    const refuted = each[Math.min(nth, each.length - 1)]!;
    return { proven: ['one', 'two', 'three'].filter((id) => !refuted.some((r) => r.id === id)), refuted, unchecked: [] };
  };
  const f = (id: string) => ({ id, fact: `${id} is not so` });

  // Look 1 finds one; look 2 finds two; look 3 finds two still false and three for the first time: a third fix, and it closes.
  const late = await run({ request: 'x' }, { ...three, verify: looks([f('one')], [f('two')], [f('two'), f('three')], []) });
  assert.deepEqual(late.calls.map((c) => c.label), ['plan', 'build:m1', 'verify:m1', 'fix:m1:1', 'verify:m1:again', 'fix:m1:2', 'verify:m1:again', 'fix:m1:3', 'verify:m1:again', 'close:m1']);
  assert.match(late.calls.find((c) => c.label === 'fix:m1:3')!.prompt, /- two: two is not so\n- three: three is not so/);
  assert.equal(late.result.stopped, null);
  // A claim handed over a second time comes with what was found the first time, and its fixer is told to mend the
  // kind or say it cannot be made true. (2026-11-22: three looks showed one claim false by three sets of cases of
  // one kind; two fixers each patched the cases they were shown, and the milestone stayed open.)
  const moved = await run({ request: 'x' }, { ...three, verify: looks([{ id: 'one', fact: '"박서연"이 기록에 남는다' }], [{ id: 'one', fact: '"김구"가 기록에 남는다' }, f('two')], []) });
  const second = moved.calls.find((c) => c.label === 'fix:m1:2')!.prompt;
  assert.ok(second.includes('- one: "김구"가 기록에 남는다\n- two: two is not so'), 'what was found now');
  assert.ok(second.includes('This one was mended once already and shown false again. What was found the time before:\n- one: "박서연"이 기록에 남는다\nA claim is handed to a fixer twice: this is the last time.'), 'what was found before, for the claim handed over again and not for the new one');
  assert.match(second, /Mend the kind: change what makes such cases possible, so that none of the kind is left[^.]*, and say under "fixed" why no further case of the kind can come\. If that cannot be done, the claim cannot be made true as it is worded: put it under "notFixed" and say why\./);
  assert.doesNotMatch(moved.calls.find((c) => c.label === 'fix:m1:1')!.prompt, /mended once already/);

  // The same claim false after two fixes: the run stops there, as it always did, though another claim is new.
  const stuck = await run({ request: 'x' }, { ...three, verify: looks([f('one')], [f('one')], [f('one'), f('three')]), close: () => ({ report: 'r.html', closed: false, line: 'l' }) });
  assert.deepEqual(stuck.calls.map((c) => c.label), ['plan', 'build:m1', 'verify:m1', 'fix:m1:1', 'verify:m1:again', 'fix:m1:2', 'verify:m1:again', 'rule:m1:last', 'close:m1']);
  assert.match(stuck.result.stopped, /still has 2 claim\(s\) shown false and 0 promise\(s\) of earlier work broken after two fixes \(a claim is handed to a fixer twice at most, and a milestone is mended four times at most\): one \(one is not so\); three \(three is not so\)/);

  // Something new at every look: four fixes, and then it stops.
  const rolling = (_: Call, nth: number) => { const id = ['one', 'two', 'three'][nth % 3]!; return { proven: ['one', 'two', 'three'].filter((other) => other !== id), refuted: [f(id)], unchecked: [] }; };
  const endless = await run({ request: 'x' }, { ...three, verify: rolling, close: () => ({ report: 'r.html', closed: false, line: 'l' }) });
  assert.deepEqual(endless.calls.filter((c) => c.label.startsWith('fix:')).map((c) => c.label), ['fix:m1:1', 'fix:m1:2', 'fix:m1:3', 'fix:m1:4']);
  assert.match(endless.result.stopped, /still has 1 claim\(s\) shown false and 0 promise\(s\) of earlier work broken after four fixes \(a claim is handed/);
});

test('a session waits for the product on the signal its builder gives, and a look at every screen is weighed as one whatever its wording', async () => {
  // (2026-11-19: the workflow's own description still named the wait from before there was a signal. The session
  // waited on it for two hours, until the wait was ended, while the product had stood since minute 72.)
  const when = /whenToUse: '([^\n]*)',\n/.exec(SOURCE)![1]!;
  assert.match(when, /until sz-eyes contract built > \/dev\/null 2>&1; do sleep 20; done/);
  assert.doesNotMatch(when, /standing --summary/, 'what stands is listed only once a contract is closed');
  const work = readFileSync(fileURLToPath(new URL('../../../plugin/skills/work/SKILL.md', import.meta.url)), 'utf8');
  assert.match(work, /until sz-eyes contract built > \/dev\/null 2>&1; do sleep 20; done/, 'the skill and the workflow name the same wait');
  // (2026-11-19: the session copied the workflow's script, changed it and resumed the run on the copy to get past a
  // stop. The stop was wrong and the run was saved; the first resume started a ruling on a closed contract.)
  assert.match(work, /Where it stops, tell the owner what it returned as it is, and stop there: do not edit the workflow's script, run a changed copy of it, or resume the run on one/);
  const first = await run({ request: 'x', asked: 'owner', answers: 'a' }, { plan: () => ({ mode: 'new', summary: 's', milestones: [{ id: 'm1', title: '첫 판', builds: 'b', first: true, claims: [claim('one')] }] }), build: built, verify: () => ({ proven: ['one'], refuted: [], unchecked: [] }), close: closed });
  assert.ok(first.logs.some((l) => /the whole product can be looked at when its first pass stands \(this run logs BUILT then\)/.test(l)), first.logs.join('\n'));

  // (The same night a look at "24화면 각 상태" was weighed as one flow and shared a verifier with the every-screen
  // flow and the motion flow: 47 minutes, the others 21 to 33.)
  const flow = (id: string, says = `${id} is true`) => ({ id, says, kind: 'flow', ref: `flows/${id}.sh` });
  const shares = async (says: string): Promise<string[][]> => {
    const claims = [flow('a'), flow('b'), flow('c'), { id: 'drawn', says, kind: 'look', ref: 'screens/' }, flow('e'), flow('f')];
    const looked = await run({ request: 'x' }, { plan: () => ({ mode: 'extend', summary: 's', milestones: [{ id: 'm1', title: 't', builds: 'b', claims }] }), build: built, verify: () => ({ proven: [], refuted: [], unchecked: [] }), close: closed });
    return looked.calls.filter((c) => c.label.startsWith('verify')).map((c) => (/Yours are these claims: ([^.]*)\./.exec(c.prompt)?.[1] ?? 'all').split(', '));
  };
  assert.deepEqual(await shares('a picture of the home screen is in the folder'), [['a', 'b', 'c'], ['drawn', 'e', 'f']]);
  for (const says of ['24화면 각 상태의 휴대폰 크기 그림이 증거 폴더에 있다', '각 화면이 그림과 같다', 'each of the 24 screens is as drawn']) assert.deepEqual(await shares(says), [['a', 'b'], ['c', 'drawn'], ['e', 'f']], says);
});

test('a plan writes only what the contract can record, and a builder\'s remark is not a stop', async () => {
  // (2026-11-19: a plan wrote claims of up to 829 characters for a phone milestone. The contract takes 400, so
  // the builder recorded them in parts under ids of its own (ios-path, ios-path-2, ios-path-3), said so under
  // "blocked", and the run stopped as "could not be built" with an hour's build standing and nothing verified.)
  const most = Number(/const CLAIM_MOST = (\d+)\n/.exec(SOURCE)![1]);
  const line = Number(/const LINE_MOST = (\d+)\n/.exec(SOURCE)![1]);
  assert.equal(Claim.shape.says.safeParse('가'.repeat(most)).success, true, 'the longest claim a plan may write is one the contract records');
  assert.equal(Claim.shape.says.safeParse('가'.repeat(most + 1)).success, false, 'and the plan may write the longest the contract records');
  for (const field of ['risks', 'notDoing'] as const) {
    assert.equal(Contract.shape[field].safeParse(['가'.repeat(line)]).success, true, field);
    assert.equal(Contract.shape[field].safeParse(['가'.repeat(line + 1)]).success, false, field);
    assert.ok(SOURCE.includes(`${field}: { type: 'array', items: { type: 'string', maxLength: LINE_MOST } }`), `the plan's ${field} are held to the contract's length`);
  }
  assert.match(SOURCE, /says: \{ type: 'string', maxLength: CLAIM_MOST, description: `[^`]*What needs more words is more than one claim: cut it into claims with an id and a check each` \}/);
  assert.match(SOURCE, /blocked: \{ type: 'string', description: '[^']*Anything written here stops the run before anyone verifies: where the milestone stands, leave it empty[^']*in the summary' \}/);
});

test('what is shown on a simulator goes to as many verifiers as the machine holds simulators, and a fixer searches the checks of earlier work for what it changes', async () => {
  // (2026-11-19: three flows on a simulator were weighed as three in a browser and went to one verifier, who took
  // 144 minutes, while the other, with two browser flows and a command, took 40. 2026-11-21: shared out one a
  // verifier, three verifiers had four simulators up beside nine stacks on 24 GB; the swap filled, and the look
  // after a fix took 91 minutes where one verifier had taken 37.)
  const claims = [
    { id: 'ios-path', says: 'eyes의 iOS 시뮬레이터에 깐 Release 빌드를 열면 ON-01이 뜬다', kind: 'flow', ref: 'flows/ios/path.sh' },
    { id: 'ios-steps', says: '걸음 연결하기를 누르면 건강 접근 시트가 걸음 하나만 묻는다', kind: 'flow', ref: 'flows/ios/steps.sh (Maestro flows/ios/steps.yaml)' },
    { id: 'ios-fit', says: '시뮬레이터에서 24화면 각 한 상태를 열어 찍은 그림이 있다', kind: 'flow', ref: 'flows/ios/fit.sh (Maestro)' },
    { id: 'mends-play', says: '첫 판 검증이 본 놀이의 틈이 막혀 있다', kind: 'flow', ref: 'flows/mends-play.sh' },
    { id: 'mends-read', says: '첫 판 검증이 본 말과 손잡이가 바르다', kind: 'flow', ref: 'flows/mends-read.sh' },
    { id: 'keeps', says: 'iOS 앱 번들에는 서비스 키도 이 Mac의 주소도 없다', kind: 'command', ref: 'npm test' },
    { id: 'feel-phone', says: '주인이 시뮬레이터 그림을 보고 판단한다', kind: 'owner', ref: '.sz/evidence/phone/ios/' },
  ];
  const yours = (c: Call): string[] => (/Yours are these claims: ([^.]*)\./.exec(c.prompt)?.[1] ?? 'all').split(', ');
  const all = claims.filter((c) => c.kind !== 'owner').map((c) => c.id);
  const WEB = ['mends-play', 'mends-read', 'keeps', 'feel-phone'];
  const looked = (simulators: number | undefined, list = claims) =>
    run({ request: 'x' }, {
      plan: () => ({ mode: 'extend', summary: 's', ...(simulators ? { simulators } : {}), milestones: [{ id: 'phone', title: '휴대폰에서', builds: 'b', claims: list }] }),
      build: built,
      // Each verifier answers for its own share; at the first look one claim of the browser part is shown false.
      verify: (c) => {
        const mine = yours(c)[0] === 'all' ? list.map((x) => x.id) : yours(c);
        const first = !c.label.includes(':again');
        return { proven: mine.filter((id) => id !== 'feel-phone' && !(first && id === 'mends-read')), refuted: first && mine.includes('mends-read') ? [{ id: 'mends-read', fact: 'BT-03 writes an ASCII minus' }] : [], unchecked: mine.includes('feel-phone') ? [{ id: 'feel-phone', why: 'the owner judges it' }] : [] };
      },
      fix: () => ({ fixed: ['mends-read: mended'] }),
      close: closed,
    });
  const first = (calls: Call[]): Call[] => calls.filter((c) => /^verify:phone:\dof\d$/.test(c.label));

  // A machine that holds two: the browser part first (its verifier also shows again what stood before), then the
  // simulator's flows between two verifiers, cut by what they cost to write.
  const { calls } = await looked(2);
  assert.deepEqual(first(calls).map(yours), [WEB, ['ios-path', 'ios-steps'], ['ios-fit']]);
  const [web, pathAndSteps, fit] = first(calls).map((c) => c.prompt);
  assert.match(web!, /None of your claims is shown on a simulator: take none \(this machine holds 2 at once, and they are the other verifiers'\)/);
  assert.match(web!, /You are also the one who shows again what stood before this work/);
  assert.match(pathAndSteps!, /for your claims that are shown on a simulator, one simulator of your own \(`sz-eyes ios spare --name sz-phone-2`; rest it when you are done[^)]*\)\. One and no more: this machine holds 2 at once/);
  assert.match(fit!, /`sz-eyes ios spare --name sz-phone-3`/);
  // Three: one each. One (or a plan that does not say): all of the simulator's with one verifier.
  assert.deepEqual(first((await looked(3)).calls).map(yours), [WEB, ['ios-path'], ['ios-steps'], ['ios-fit']]);
  assert.deepEqual(first((await looked(1)).calls).map(yours), [WEB, ['ios-path', 'ios-steps', 'ios-fit']]);
  assert.deepEqual(first((await looked(undefined)).calls).map(yours), [WEB, ['ios-path', 'ios-steps', 'ios-fit']]);
  // Whoever plans reads the number from the eyes, at the start and after the first pass.
  assert.match(SOURCE, /simulators: \{ type: 'integer', description: '[^']*the number on the first line of what `sz-eyes ios room` printed/);
  assert.equal(SOURCE.split('return the number on its first line under "simulators"').length - 1, 2);
  // After a fix the flows are written, and running three on one simulator is one verifier's work.
  assert.deepEqual(calls.filter((c) => c.label.startsWith('verify:phone:again')).map((c) => c.label), ['verify:phone:again']);
  assert.ok(all.length === 6);

  // Claims shown by one check are one verifier's, and the check is weighed once: the path's three claims name one
  // flow, as do the two of the steps and the two of the fit. (The builder of that night had recorded them so.)
  const parted = [
    ...['ios-path', 'ios-path-2', 'ios-path-3'].map((id) => ({ ...claims[0]!, id })),
    ...['ios-steps', 'ios-steps-2'].map((id) => ({ ...claims[1]!, id })),
    ...['ios-fit', 'ios-fit-2'].map((id) => ({ ...claims[2]!, id })),
    ...claims.slice(3),
  ];
  assert.deepEqual(first((await looked(2, parted)).calls).map(yours), [WEB, ['ios-path', 'ios-path-2', 'ios-path-3', 'ios-steps', 'ios-steps-2'], ['ios-fit', 'ios-fit-2']]);

  // (No field of that app had an id. The flow pressed each by its words, Maestro pressed the label beside it, and
  // what was typed went nowhere in five fields of six.)
  const builder = calls.find((c) => c.label === 'build:phone')!.prompt;
  assert.match(builder, /This milestone is shown on a simulator, by flows that whoever verifies writes: give every field a person types into a `testID`/);
  assert.match(builder, /`sz-eyes ios look <the simulator's id>` on a screen lists its fields and says which have no id/);
  const inBrowser = await run({ request: 'x' }, { plan: plan('m1'), build: built, verify: () => ({ proven: ['one', 'two'], refuted: [], unchecked: [] }), close: closed });
  assert.doesNotMatch(inBrowser.calls.find((c) => c.label === 'build:m1')!.prompt, /testID/, 'a milestone shown in a browser is not told about a simulator');

  // (The same night a fix signed a percent that two frozen flows of the first pass read unsigned. Nobody ran them
  // until the next look: 37 minutes to learn it, a second fix, and a third look.)
  const fix = calls.find((c) => c.label === 'fix:phone:1')!.prompt;
  assert.match(fix, /before you commit, search the flows and tests of this contract and of earlier work for the words, figures and names your fix changes on a screen or in an answer \(the old form, as it stood\)/);
  assert.match(fix, /Run each one that does, by itself, and keep what it reads as it was unless the claim you were handed says otherwise/);
  assert.match(fix, /Do not run the other flows, of this contract or of earlier work/, 'the other flows are still left to whoever looks again');
  assert.doesNotMatch(fix, /An earlier run found these and stopped/, 'a fixer of this run\'s own look is not told of an earlier run');
});


test('a harness whose eyes do not run starts nothing: the plan says so in its first minute and the run stops there', async () => {
  // 2026-11-21: a copy of the plugin was made without its dependencies. The plan saw sz-eyes fail and ran another
  // copy's instead; the designer did the same; the measurer would not, three times; a fixer built a shim. Forty
  // minutes, a drawing nobody had measured, and no contract.
  const down = await run({ request: '퇴사점검' }, { plan: () => ({ mode: 'new', design: 'needed', summary: 's', milestones: [], eyesDown: "sz-eyes: this copy of the harness has no dependencies installed (/x/packages/eyes has no node_modules): run 'pnpm install' in /x" }) });
  assert.deepEqual(down.calls.map((c) => c.label), ['plan'], 'nobody plans screens, draws or measures');
  assert.match(down.result.stopped, /nothing was started: sz-eyes does not run[\s\S]*no dependencies installed[\s\S]*pnpm install/);
  assert.deepEqual([down.result.milestones, down.result.design], [[], null]);
  const asked = down.calls[0]!.prompt;
  assert.match(asked, /If `sz-eyes` itself does not run[\s\S]*"eyesDown"[\s\S]*Do not run another copy of it/);
  // A plan that says nothing of it goes on as before.
  const up = await run({ request: '택배 비교' }, { plan: plan('m1'), build: built, verify: () => ({ proven: ['one', 'two'], refuted: [], unchecked: [] }), close: closed });
  assert.equal(up.result.stopped, null);
});

test('nothing is built on a disk a milestone would not fit on; on a tight one the builder is told to ask first; a closed milestone is pruned before it is committed', async () => {
  // 2026-11-21: a build left 145 MB of 460 GB free an hour in, and the machine's containers stopped, the owner's own
  // among them. 2026-11-22: three runs on a web product took the disk from 14 GB free to 7.9, most of it pictures
  // that every look had taken again and no verdict pointed at.
  const one = { id: 'm1', title: 'title m1', builds: 'b', claims: [claim('one'), claim('two')] };
  const asked = (room: number | undefined, ...milestones: unknown[]) => () => ({ mode: 'extend', summary: 's', ...(room === undefined ? {} : { room }), milestones });
  const goes = { build: built, verify: allProven, close: closed };

  const short = await run({ request: 'x' }, { ...goes, plan: asked(2, one) });
  assert.match(short.result.stopped, /^nothing of milestone "title m1" was started: the disk the project is on has 2 GB free, and a milestone like this one has taken about 3 GB[^.]*\. A disk that fills stops everything else on this machine too\. Free room and ask to continue: `sz-eyes evidence prune <a closed contract>`/);
  assert.deepEqual(labels(short.calls), ['plan'], 'nothing is started');

  const tight = await run({ request: 'x' }, { ...goes, plan: asked(5, one) });
  assert.equal(tight.result.stopped, null);
  assert.match(tight.calls.find((c) => c.label === 'build:m1')!.prompt, /The disk this project is on had 5 GB free when this run last asked, and a milestone like this one has taken about 3\. Before a step that writes gigabytes[^.]*, run `sz-eyes room`; if the step would not fit, do not start it: say so under "blocked", with both figures\./);
  assert.ok(tight.logs.some((line) => /title m1: the disk has 5 GB free and a milestone like this one has taken about 3: it is started/.test(line)));

  // With room to spare, and when nobody said how much there is, nothing is said of it.
  for (const plan of [asked(20, one), asked(undefined, one)]) {
    const ran = await run({ request: 'x' }, { ...goes, plan });
    assert.equal(ran.result.stopped, null);
    assert.doesNotMatch(ran.calls.find((c) => c.label === 'build:m1')!.prompt, /The disk this project is on had/);
  }

  // An app built for a phone takes far more: what fits a web milestone four times over does not fit it.
  const phone = { id: 'm1', title: 'title m1', builds: 'b', claims: [{ id: 'one', says: 'the weigh-in is saved on the simulator', kind: 'flow', ref: 'flows/ios/weigh.yaml (maestro)' }, claim('two')] };
  const tooBig = await run({ request: 'x' }, { ...goes, plan: asked(12, phone) });
  assert.match(tooBig.result.stopped, /the disk the project is on has 12 GB free, and a milestone that builds an app for a phone has taken about 16 GB/);
  assert.deepEqual(labels(tooBig.calls), ['plan']);
  // The figures are the ones `sz-eyes room` prints.
  assert.match(SOURCE, new RegExp(`const TAKES = \\(m, resumed\\) => \\(resumed \\? 1 : onDevice\\(m\\) \\? ${TAKES.phone} : ${TAKES.other}\\)`));

  // The disk is asked again when a milestone closes: the next one is judged by what is left then.
  const two = await run({ request: 'x' }, { ...goes, plan: asked(20, one, { ...one, id: 'm2', title: 'title m2' }), close: () => ({ report: 'r.html', closed: true, line: 'l', room: 2 }) });
  assert.deepEqual(labels(two.calls), ['plan', 'build:m1', 'verify:m1', 'close:m1']);
  assert.match(two.result.stopped, /^nothing of milestone "title m2" was started: the disk the project is on has 2 GB free/);

  assert.match(short.calls[0]!.prompt, /Run `sz-eyes room` as well and return the number on its first line under "room": the gigabytes free on the disk this project is on, by which the run judges whether a milestone fits before it builds one/);
  const closing = tight.calls.find((c) => c.label === 'close:m1')!.prompt;
  for (const operation of ['["evidence", "m1"]', '["contract", "close", "m1"]', '["evidence", "prune", "m1"]'])
    assert.ok(closing.includes(operation), operation);
  assert.match(closing, /When it said closed, run `sz-eyes evidence prune m1` before anything is committed: every look took its pictures again, and this removes from the milestone's evidence folder those that no verdict, notice or record names \(the page and what they name stay\)\./);
  assert.match(closing, /7\. Run `sz-eyes room` and return the number on its first line under "room"\./);
  // A milestone left with a claim shown false keeps all of its evidence: nobody is told to prune it.
  const wrong = await run({ request: 'x' }, { ...goes, plan: asked(20, one), fix: () => ({ fixed: [] }), verify: () => ({ proven: ['one'], refuted: [{ id: 'two', fact: 'two is not so' }], unchecked: [] }), close: () => ({ report: 'r.html', closed: false, line: 'l' }) });
  const left = wrong.calls.find((c) => c.label === 'close:m1')!.prompt;
  assert.doesNotMatch(left, /sz-eyes evidence prune/);
  assert.match(left, /Its evidence stays as it is: it is what the fix is worked from\./);
});

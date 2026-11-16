// The saved workflow `sz:build` is a script the Workflow tool runs. Here its own logic (what it does with what
// the agents return) is run with agents that answer from a table, so no model is called.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

type Call = { prompt: string; label: string; effort?: string };
type Answer = (call: Call, nth: number) => unknown;

const SOURCE = readFileSync(fileURLToPath(new URL('../../../plugin/workflows/build.js', import.meta.url)), 'utf8').replace('export const meta', 'const meta');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...names: string[]) => (...values: unknown[]) => Promise<any>;

/** Runs the script with agents answered by the first table entry whose key starts the agent's label. */
async function run(args: unknown, answers: Record<string, Answer>): Promise<{ result: any; calls: Call[]; logs: string[] }> {
  const calls: Call[] = [];
  const logs: string[] = [];
  const seen = new Map<string, number>();
  const agent = async (prompt: string, opts: { label: string; effort?: string }): Promise<unknown> => {
    calls.push({ prompt, label: opts.label, ...(opts.effort ? { effort: opts.effort } : {}) });
    const key = Object.keys(answers).find((k) => opts.label.startsWith(k));
    if (!key) throw new Error(`no answer for ${opts.label}`);
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    return answers[key]!({ prompt, label: opts.label }, nth);
  };
  // Every run says whether the owner was asked beforehand; the tests that are not about that run as "away".
  const given = args && typeof args === 'object' && !('asked' in args) ? { asked: 'away', ...args } : args;
  const result = await new AsyncFunction('agent', 'phase', 'log', 'args', SOURCE)(agent, () => {}, (line: string) => logs.push(line), given);
  return { result, calls, logs };
}

const claim = (id: string) => ({ id, says: `${id} is true`, kind: 'test', ref: `test/${id}.test.mjs` });
const plan = (...ids: string[]) => () => ({ mode: 'extend', summary: 's', milestones: ids.map((id) => ({ id, title: `title ${id}`, builds: 'b', claims: [claim('one'), claim('two')] })) });
const built = ({ label }: Call) => ({ contractId: label.split(':')[1], summary: 'built', launch: 'PORT=$(sz-eyes port) node server.mjs' });
const closed = () => ({ report: 'r.html', closed: true, line: 'l' });

test('the workflow does not start until it is told whether the owner was asked', async () => {
  const table = { plan: plan('m1', 'm2'), build: built, verify: () => ({ proven: ['one', 'two'], refuted: [], unchecked: [] }), close: closed };

  const silent = await run({ request: '택배 비교', asked: undefined }, table);
  assert.match(silent.result.error, /not started: say whether the owner was asked/);
  assert.match(silent.result.error, /AskUserQuestion/);
  assert.equal(silent.calls.length, 0, 'no agent runs before that is said');

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

test('a milestone whose contract would not close is where the run stops, whatever the agents said', async () => {
  const { result, calls } = await run({ request: 'x' }, { plan: plan('m1', 'm2'), build: built, verify: () => ({ proven: ['one', 'two'], refuted: [], unchecked: [] }), close: () => ({ report: 'r.html', closed: false, why: 'a frozen file changed', line: 'l' }) });
  assert.match(result.stopped, /did not close: a frozen file changed/);
  assert.equal(calls.some((c) => c.label === 'build:m2'), false);
});

// ---- milestones side by side
const graph = (...ms: { id: string; after?: string[]; alone?: boolean }[]) => () => ({ mode: 'new', summary: 's', milestones: ms.map((m) => ({ id: m.id, title: `title ${m.id}`, builds: 'b', claims: [claim('one'), claim('two')], ...(m.after ? { after: m.after } : {}), ...(m.alone ? { alone: true } : {}) })) });
const proven = () => ({ proven: ['one', 'two'], refuted: [], unchecked: [], stood: 4, noticed: [] });
const staged = ({ label }: Call) => ({ folders: label.split(':')[1]!.split('+').map((id) => ({ id, where: `/p/.sz/trees/${id}` })) });
const joinedAll = ({ label }: Call) => ({ merged: label.split(':')[1]!.split('+'), conflicted: [] });
const held = (stood: number) => () => ({ proven: [], refuted: [], unchecked: [], broken: [], held: [], stood });
const labels = (calls: Call[]): string[] => calls.map((c) => c.label);

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

test('a line stays a line: with no order given, with one milestone ready at a time, when one is marked alone, and when the owner asks for it', async () => {
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
  // Side by side has not been run for real yet: unless asked for, the plan's groups are built in a line.
  const forced = await run({ request: 'x' }, { ...answers, plan: graph({ id: 'm1' }, { id: 'm2', after: ['m1'] }, { id: 'm3', after: ['m1'] }) });
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

test('every agent is told from its first line when the session is sandboxed, an earlier milestone\'s verdicts are not made up, and how hard each stage thinks can be said', async () => {
  const answers = { build: built, verify: proven, close: closed };
  const earlier = (sandboxed: boolean) => () => ({ mode: 'continue', summary: 's', sandboxed, milestones: [{ id: 'm1', title: 'title m1', builds: 'b', claims: [claim('one'), claim('owner')], state: 'closed', contractId: 'm1' }, { id: 'm2', title: 'title m2', builds: 'b', claims: [claim('one'), claim('two')] }] });
  const inside = await run({ request: 'x' }, { ...answers, plan: earlier(true) });
  assert.match(inside.calls.find((c) => c.label === 'plan')!.prompt, /run `sz-eyes sandbox` once, as an ordinary command[\s\S]*return under "sandboxed"/);
  for (const label of ['build:m2', 'verify:m2']) assert.match(inside.calls.find((c) => c.label === label)!.prompt, /This session runs its commands inside a sandbox[\s\S]*outside it from the first try/, label);
  const outside = await run({ request: 'x' }, { ...answers, plan: earlier(false) });
  assert.doesNotMatch(outside.calls.find((c) => c.label === 'build:m2')!.prompt, /This session runs its commands inside a sandbox/);
  assert.match(outside.calls.find((c) => c.label === 'build:m2')!.prompt, /If `sz-eyes` says the session's command sandbox stopped it/);
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
});

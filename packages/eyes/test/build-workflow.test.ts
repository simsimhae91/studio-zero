// The saved workflow `sz:build` is a script the Workflow tool runs. Here its own logic (what it does with what
// the agents return) is run with agents that answer from a table, so no model is called.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

type Call = { prompt: string; label: string };
type Answer = (call: Call, nth: number) => unknown;

const SOURCE = readFileSync(fileURLToPath(new URL('../../../plugin/workflows/build.js', import.meta.url)), 'utf8').replace('export const meta', 'const meta');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...names: string[]) => (...values: unknown[]) => Promise<any>;

/** Runs the script with agents answered by the first table entry whose key starts the agent's label. */
async function run(args: unknown, answers: Record<string, Answer>): Promise<{ result: any; calls: Call[]; logs: string[] }> {
  const calls: Call[] = [];
  const logs: string[] = [];
  const seen = new Map<string, number>();
  const agent = async (prompt: string, opts: { label: string }): Promise<unknown> => {
    calls.push({ prompt, label: opts.label });
    const key = Object.keys(answers).find((k) => opts.label.startsWith(k));
    if (!key) throw new Error(`no answer for ${opts.label}`);
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);
    return answers[key]!({ prompt, label: opts.label }, nth);
  };
  const result = await new AsyncFunction('agent', 'phase', 'log', 'args', SOURCE)(agent, () => {}, (line: string) => logs.push(line), args);
  return { result, calls, logs };
}

const claim = (id: string) => ({ id, says: `${id} is true`, kind: 'test', ref: `test/${id}.test.mjs` });
const plan = (...ids: string[]) => () => ({ mode: 'extend', summary: 's', milestones: ids.map((id) => ({ id, title: `title ${id}`, builds: 'b', claims: [claim('one'), claim('two')] })) });
const built = ({ label }: Call) => ({ contractId: label.split(':')[1], summary: 'built', launch: 'PORT=$(sz-eyes port) node server.mjs' });
const closed = () => ({ report: 'r.html', closed: true, line: 'l' });

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

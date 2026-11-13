// A design task's directions, drawn. What is checked: the pages an agent wrote are turned into pictures with
// scripts and the network off, a design task that passes its document check announces them, a browser that
// will not start costs the pictures and not the task, and a missing second direction is a failed check.
// Chrome is real; the sandbox, the engine and the planner are scripted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { chromium, devices, type Browser } from 'playwright-core';
import type { EventEnvelope, Project } from '@studio-zero/protocol';
import type { BuildMeter } from '../src/harness/BuildMeter.ts';
import type { CompilerGate } from '../src/harness/CompilerGate.ts';
import type { EvalRunner } from '../src/harness/EvalRunner.ts';
import { Harness } from '../src/harness/Harness.ts';
import { IDEATION_BRIEF, IDEATION_REQUIRED_FILES, IDEATION_REVISION_BRIEF, MOCKUP_RULES } from '../src/harness/prompts.ts';
import type { ReflectionAgent } from '../src/harness/ReflectionAgent.ts';
import type { SandwichReviewer } from '../src/harness/SandwichReviewer.ts';
import { MIN_MOCKUPS, MOCKUP_DIR, MockupRenderer, type MockupMeasurement, type MockupOption } from '../src/qa/MockupRenderer.ts';
import type { QaBrowser, QaSession } from '../src/qa/QaBrowser.ts';
import type { RefKit } from '../src/qa/RefKit.ts';
import type { SmokeRunner } from '../src/qa/SmokeTester.ts';
import type { OrbStackManager } from '../src/sandbox/OrbStackManager.ts';
import { SCREEN_SPEC_FILE } from '../src/scratch/ScreenSpec.ts';
import { SCREEN_SPEC } from './fixtures-mockup.ts';
import { quietLog, sampleProject, testDaemon } from './helpers.ts';

type Block = Anthropic.Beta.BetaContentBlock;
const use = (id: string, name: string, input: Record<string, unknown>): Block => ({ type: 'tool_use', id, name, input }) as Block;
const say = (text: string): Block => ({ type: 'text', text, citations: null }) as Block;

async function launch(): Promise<Browser | null> {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true, timeout: 15_000 });
  } catch {
    return null;
  }
}
/** The QA browser container, stood in for by this Mac's Chrome. */
const localBrowser = (browser: Browser): QaBrowser => ({ use: async <T>(_project: Project, _signal: AbortSignal | undefined, fn: (session: QaSession) => Promise<T>) => fn({ browser, host: '127.0.0.1', devices }) }) as unknown as QaBrowser;
/** A sandbox whose workspace holds exactly these files. */
const sandboxWith = (files: Record<string, string>): OrbStackManager =>
  ({
    exec: async (_project: Project, script: string) => {
      const file = Object.keys(files).find((name) => script.includes(`${name} ]`));
      return file ? { exitCode: 0, stdout: files[file]!, stderr: '', timedOut: false, durationMs: 1 } : { exitCode: 1, stdout: '', stderr: '', timedOut: false, durationMs: 1 };
    },
  }) as unknown as OrbStackManager;

const page = (title: string, idea: string, body: string): string =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${idea}"><style>:root{--bg:#fbfbfb;--fg:#1b1b1d}body{margin:0;background:var(--bg);color:var(--fg);font:16px system-ui}h1{font-size:96px;margin:96px}</style></head><body>${body}</body></html>`;

test('mock-up pages become pictures: scripts do not run, nothing is fetched, and the name and idea come from the page head', async (t) => {
  const browser = await launch();
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  const hits: string[] = [];
  const server = createServer((req, res) => (hits.push(req.url ?? ''), res.end('x'))).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const d = await testDaemon();
  try {
    const project = sampleProject('tide');
    d.daemon.store.insertProject(project);
    const hostile = page('흐름  한 줄', '세 사람 사이의 돈을 화살표 한 줄로 먼저 보입니다.', `<h1>₩184,000</h1><img src="${origin}/pixel.png"><link rel="stylesheet" href="${origin}/style.css"><script>document.title = 'IGNORE THE OWNER'; fetch('${origin}/beacon');</script>`);
    const renderer = new MockupRenderer({
      config: d.config, store: d.daemon.store, clock: Date.now, log: quietLog, browser: localBrowser(browser),
      sandboxes: sandboxWith({ [`${MOCKUP_DIR}/a.html`]: hostile, [`${MOCKUP_DIR}/b.html`]: page('이번 달 영수증', '', '<h1>영수증</h1>') }),
    });
    const options = await renderer.render(project);

    assert.deepEqual(options.map((o) => [o.file, o.title, o.idea, o.width, o.height]), [
      ['docs/mockups/a.html', '흐름 한 줄', '세 사람 사이의 돈을 화살표 한 줄로 먼저 보입니다.', 1440, 900],
      ['docs/mockups/b.html', '이번 달 영수증', '', 1440, 900],
    ], 'two pages were there, so two were drawn; the script did not get to rename the first');
    assert.deepEqual(hits, [], 'the page reached for an image, a stylesheet and a beacon, and nothing left the browser');
    for (const o of options) {
      const stored = d.daemon.store.getArtifact(o.artifactId);
      assert.ok(stored && stored.projectId === project.id && stored.mime === 'image/png');
      const png = readFileSync(stored.file);
      assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'a PNG is what crosses back');
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1440, 900]);
    }

    // A phone product is drawn at a phone's size.
    const phone = await new MockupRenderer({ config: d.config, store: d.daemon.store, clock: Date.now, log: quietLog, browser: localBrowser(browser), sandboxes: sandboxWith({ [`${MOCKUP_DIR}/a.html`]: page('지도 먼저', '', '<h1>지도</h1>') }) }).render({ ...project, template: 'mobile-expo' });
    assert.deepEqual(phone.map((o) => [o.width, o.height]), [[393, 852]]);

    // Nothing written, or a browser that will not start: no pictures, and no exception.
    assert.deepEqual(await new MockupRenderer({ config: d.config, store: d.daemon.store, clock: Date.now, log: quietLog, browser: localBrowser(browser), sandboxes: sandboxWith({}) }).render(project), []);
    const down = { use: async () => { throw new Error('QA browser did not become ready: connect ECONNREFUSED'); } } as unknown as QaBrowser;
    assert.deepEqual(await new MockupRenderer({ config: d.config, store: d.daemon.store, clock: Date.now, log: quietLog, browser: down, sandboxes: sandboxWith({ [`${MOCKUP_DIR}/a.html`]: hostile }) }).render(project), []);
  } finally {
    await d.cleanup();
    await browser.close();
    server.close();
  }
});

const DOC = (name: string): string => `# ${name}\n\n${'정산 도구의 설계를 적는다. '.repeat(40)}`;

/** A design task over a real daemon: the engine writes the scripted files, then the documents are checked for real. */
async function designTask(files: Record<string, string>, mockups: Pick<MockupRenderer, 'measure'>, already: Record<string, string> = {}): Promise<{ state: string; error: string | null; summary: string | null; bodies: EventEnvelope['body'][]; brief: string; sent: string[]; cleanup: () => Promise<void> }> {
  const turns: Block[][] = [Object.entries(files).map(([path, content], i) => use(`w${i}`, 'write_file', { path, content })), [say('설계 문서와 시안을 만들었습니다.')]];
  const sent: string[] = [];
  const base = { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
  const sdk = {
    beta: {
      messages: {
        stream: (params: Anthropic.Beta.MessageCreateParams) => {
          sent.push(JSON.stringify(params.messages));
          // Out of script: the engine has nothing more to add, which is how a repair round that changes nothing looks.
          const content = turns.shift() ?? [say('더 고칠 것이 없습니다.')];
          return { finalMessage: async () => ({ ...base, content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }) };
        },
        parse: async () => ({ ...base, content: [], stop_reason: 'end_turn', parsed_output: { summary: '정산 도구를 설계한다.', steps: ['문서', '시안'], auditRoutes: [], openQuestions: [] } }),
      },
    },
  } as unknown as Anthropic;
  const d = await testDaemon({ budgets: { verifyRounds: 1 } }, { anthropic: sdk });
  const { store, events, policy, sandboxes, provisioner, router, claude, lessons, ledger } = d.daemon;
  const project = sampleProject('tide');
  store.insertProject(project);
  const never = (what: string) => async () => assert.fail(`${what} ran on a design task`);
  const harness = new Harness({
    config: d.config, store, events, policy, sandboxes, provisioner, router, claude, lessons, ledger, mockups,
    evals: { usesBrowser: () => false, runAll: never('the evals') } as unknown as EvalRunner,
    compiler: { run: never('the compiler gate') } as unknown as CompilerGate,
    smoke: { run: never('the smoke test') } as unknown as SmokeRunner,
    reflection: { reflect: async () => undefined } as unknown as ReflectionAgent,
    refkit: { capture: async () => [] } as unknown as RefKit,
    reviewer: { redTeam: never('the plan review'), accept: never('the acceptance review') } as unknown as SandwichReviewer,
    build: { run: never('the build meter') } as unknown as BuildMeter,
    clock: Date.now,
    log: quietLog,
  });
  // A design that is already there when the task starts: committed on the branch the task begins from.
  if (Object.keys(already).length > 0) {
    await d.daemon.provisioner.ensure(project);
    for (const [path, content] of Object.entries(already)) await sandboxes.writeFile(project, path, content);
    await sandboxes.commitAll(project, 'docs: an earlier design');
  }
  await d.daemon.studio.submitTask({ type: 'owner', via: 'desktop' }, { projectId: project.id, kind: 'ideate', prompt: '프리랜서 셋이 같이 쓰는 정산 도구' }, 'desktop');
  const claimed = store.claimNextTask(Date.now());
  assert.ok(claimed);
  await harness.run(claimed, new AbortController().signal);
  const task = store.getTask(claimed.id)!;
  return { state: task.state, error: task.error, summary: task.summary, bodies: events.history({ taskId: task.id }, 0, 1000).map((e) => e.body), brief: sent[0] ?? '', sent, cleanup: d.cleanup };
}

const DOCS = { ...Object.fromEntries(IDEATION_REQUIRED_FILES.filter((f) => !f.startsWith(MOCKUP_DIR)).map((f) => [f, DOC(f)])), [SCREEN_SPEC_FILE]: JSON.stringify(SCREEN_SPEC, null, 2) };
const DRAWN: MockupOption[] = [
  { file: `${MOCKUP_DIR}/a.html`, title: '흐름 한 줄', idea: '화살표 한 줄이 먼저입니다.', artifactId: 'art_a', width: 1440, height: 900 },
  { file: `${MOCKUP_DIR}/b.html`, title: '이번 달 영수증', idea: '영수증 한 장이 먼저입니다.', artifactId: 'art_b', width: 1440, height: 900 },
];
/** The mock-ups measured, with nothing found. */
const CLEAN: MockupMeasurement = { options: DRAWN, audit: null, flowProblems: [] };

test('a design task is asked for at least two drawn directions, and ends by putting them in front of the owner', async () => {
  assert.equal(MIN_MOCKUPS, 2);
  assert.deepEqual(IDEATION_REQUIRED_FILES.filter((f) => f.startsWith(MOCKUP_DIR)), [`${MOCKUP_DIR}/a.html`, `${MOCKUP_DIR}/b.html`], 'two are required; the third is the agent\'s call');
  assert.match(IDEATION_BRIEF, /the product doing the one thing it exists to do/);
  assert.match(IDEATION_BRIEF, /pages that read as tabs of one app have failed/);
  assert.match(IDEATION_BRIEF, /three different products for the same job/);
  assert.match(IDEATION_BRIEF, /no scripts, no external requests/);
  // What a mock-up is now asked to be: something that works, with something to look at, in the product's own words, and measured.
  assert.match(IDEATION_BRIEF, /The page opens in the state before the person acts, never frozen in the moment after/);
  assert.match(IDEATION_BRIEF, /data-step="T:k"[\s\S]*data-done="T"/);
  assert.match(IDEATION_BRIEF, /every control has an :active state/);
  assert.match(IDEATION_BRIEF, /Never leave a box with a sentence saying what picture will go there, and never write a note to the reader on the page/);
  assert.match(IDEATION_BRIEF, /generate_image, saved under docs\/mockups\/assets\//);
  assert.match(IDEATION_BRIEF, /no sentence that explains the screen/);
  assert.match(IDEATION_BRIEF, /They are measured, as a built screen is, and what is found comes back to you to fix/);
  assert.match(IDEATION_BRIEF, /4\. Screen spec, in docs\/screens\.json\.[\s\S]*with nothing about how it looks/);
  assert.ok(IDEATION_REQUIRED_FILES.includes(SCREEN_SPEC_FILE), 'the screen spec is owed like the other documents');

  const tasksSeen: unknown[] = [];
  const run = await designTask({ ...DOCS, [`${MOCKUP_DIR}/a.html`]: page('흐름 한 줄', '', '<h1>₩184,000</h1>'.repeat(20)), [`${MOCKUP_DIR}/b.html`]: page('이번 달 영수증', '', '<h1>영수증</h1>'.repeat(20)) }, { measure: async (_project, p) => (tasksSeen.push(p.tasks), CLEAN) });
  try {
    assert.equal(run.state, 'succeeded', run.error ?? '');
    assert.ok(run.brief.includes('docs/mockups/a.html'), 'the engine was told where the mock-ups go');
    const rendered = run.bodies.flatMap((b) => (b.type === 'mockups.rendered' ? [b] : []));
    assert.deepEqual(rendered.map((b) => b.options), [DRAWN]);
    assert.deepEqual(tasksSeen, [SCREEN_SPEC.tasks.map(({ id, goal, outcome }) => ({ id, goal, outcome }))], 'the pages were measured once, by the core flow of the screen spec');
    assert.deepEqual(run.bodies.flatMap((b) => (b.type === 'gate.result' ? [[b.gate, b.name, b.passed]] : [])), [['screens', SCREEN_SPEC_FILE, true]]);
    const order = run.bodies.map((b) => b.type);
    assert.ok(order.indexOf('mockups.rendered') < order.lastIndexOf('task.state'), 'the pictures are announced before the task is called done');
  } finally {
    await run.cleanup();
  }
});

test('one direction is not a choice: a design task without its second mock-up fails its check', async () => {
  const run = await designTask({ ...DOCS, [`${MOCKUP_DIR}/a.html`]: page('흐름 한 줄', '', '<h1>₩184,000</h1>'.repeat(20)) }, { measure: async () => assert.fail('nothing is drawn for a task that did not pass') });
  try {
    assert.equal(run.state, 'failed');
    assert.match(run.error ?? '', /ideation-documents/);
    assert.ok(run.bodies.every((b) => b.type !== 'mockups.rendered'));
  } finally {
    await run.cleanup();
  }
});

test('pictures that cannot be drawn are said, and the documents still stand', async () => {
  const run = await designTask({ ...DOCS, [`${MOCKUP_DIR}/a.html`]: page('흐름 한 줄', '', '<h1>₩184,000</h1>'.repeat(20)), [`${MOCKUP_DIR}/b.html`]: page('이번 달 영수증', '', '<h1>영수증</h1>'.repeat(20)) }, { measure: async () => ({ options: [], audit: null, flowProblems: [] }) });
  try {
    assert.equal(run.state, 'succeeded', run.error ?? '');
    assert.ok(run.bodies.some((b) => b.type === 'notice' && b.level === 'warn' && /mock-ups could not be drawn/.test(b.message)));
    assert.ok(run.bodies.every((b) => b.type !== 'mockups.rendered'));
  } finally {
    await run.cleanup();
  }
});

test('a design task that starts on a finished design is a revision: the owner\'s notes, not the whole brief again', async () => {
  const pages = { [`${MOCKUP_DIR}/a.html`]: page('흐름 한 줄', '', '<h1>₩184,000</h1>'.repeat(20)), [`${MOCKUP_DIR}/b.html`]: page('이번 달 영수증', '', '<h1>영수증</h1>'.repeat(20)) };
  const fresh = await designTask({ ...DOCS, ...pages }, { measure: async () => CLEAN });
  const again = await designTask({ [`${MOCKUP_DIR}/b.html`]: page('이번 달 영수증', '', '<h1>합계 먼저</h1>'.repeat(20)) }, { measure: async () => CLEAN }, { ...DOCS, ...pages });
  try {
    assert.ok(fresh.brief.includes(JSON.stringify(IDEATION_BRIEF).slice(1, 80)) && !fresh.brief.includes('This is a revision of a design'), 'an empty workspace gets the whole brief');
    assert.equal(again.state, 'succeeded', again.error ?? '');
    assert.ok(again.brief.includes(JSON.stringify(IDEATION_REVISION_BRIEF).slice(1, 80)), 'a workspace with the design in it gets the revision brief');
    assert.ok(fresh.brief.includes('Work in five passes') && !again.brief.includes('Work in five passes'), 'and is not told to write the design again');
    assert.match(IDEATION_REVISION_BRIEF, /a page you touch keeps its data-step and data-done marks true/);
    assert.match(IDEATION_REVISION_BRIEF, /nothing else/);
    assert.match(IDEATION_REVISION_BRIEF, /Never start building the product/);
    assert.match(IDEATION_REVISION_BRIEF, /draw all of them from the start, as if for the first time, taking any direction the owner gives as the brief/);
    assert.ok(IDEATION_REVISION_BRIEF.includes(MOCKUP_RULES) && IDEATION_BRIEF.includes(MOCKUP_RULES), 'a redraw is held to the rules of a first drawing');
    assert.deepEqual(again.bodies.flatMap((b) => (b.type === 'mockups.rendered' ? [b.options.length] : [])), [2], 'the revised pages are drawn again for the next decision');
  } finally {
    await fresh.cleanup();
    await again.cleanup();
  }
});

test('a screen spec that does not hold is owed, like a missing document: the engine is told what is wrong, and the task fails if it stays wrong', async () => {
  const broken = { ...SCREEN_SPEC, tasks: [{ id: 'Log It', goal: '', outcome: '오늘 칸에 기록이 남는다', screen: 'X-99' }], events: [] };
  const pages = { [`${MOCKUP_DIR}/a.html`]: page('흐름 한 줄', '', '<h1>₩184,000</h1>'.repeat(20)), [`${MOCKUP_DIR}/b.html`]: page('이번 달 영수증', '', '<h1>영수증</h1>'.repeat(20)) };
  const run = await designTask({ ...DOCS, ...pages, [SCREEN_SPEC_FILE]: JSON.stringify(broken) }, { measure: async () => assert.fail('mock-ups are not measured against a spec that does not hold') });
  try {
    assert.equal(run.state, 'failed');
    assert.match(run.error ?? '', /verification still failing after 1 corrections: screen-spec/);
    assert.deepEqual(run.bodies.flatMap((b) => (b.type === 'gate.result' ? [[b.gate, b.passed]] : [])), [['screens', false], ['screens', false]]);
    const repair = run.sent.at(-1)!;
    assert.match(repair, /docs\/screens\.json does not hold as the screen spec yet/);
    assert.match(repair, /task Log It: the id must be a short lowercase word/);
    assert.match(repair, /task Log It: screen names X-99, which is not a screen in this spec/);
    assert.match(repair, /events is empty/);
    assert.ok(run.bodies.every((b) => b.type !== 'mockups.rendered'));
  } finally {
    await run.cleanup();
  }
});

test('what the measurement finds on the mock-ups is reworked twice, then shown to the owner with the findings', async () => {
  const pages = { [`${MOCKUP_DIR}/a.html`]: page('흐름 한 줄', '', '<h1>₩184,000</h1>'.repeat(20)), [`${MOCKUP_DIR}/b.html`]: page('이번 달 영수증', '', '<h1>영수증</h1>'.repeat(20)) };
  const stuck: MockupMeasurement = { options: DRAWN, audit: null, flowProblems: [{ file: `${MOCKUP_DIR}/b.html`, problems: ['task "log" (설거지 20분을 적는다): the page opens with [data-done="log"] already showing.'] }] };

  // Never comes clean: three measurements, two reworks, and then the owner is the judge.
  let measured = 0;
  const never = await designTask({ ...DOCS, ...pages }, { measure: async () => ((measured += 1), stuck) });
  // Comes clean on the second look: one rework, and nothing left to say.
  let looks = 0;
  const fixed = await designTask({ ...DOCS, ...pages }, { measure: async () => ((looks += 1) === 1 ? stuck : CLEAN) });
  try {
    assert.equal(never.state, 'succeeded', never.error ?? '');
    assert.equal(measured, 3);
    assert.deepEqual(never.bodies.flatMap((b) => (b.type === 'task.phase' ? [`${b.phase}:${b.round}`] : [])), ['plan:0', 'execute:1', 'verify:1', 'execute:2', 'verify:2', 'execute:3', 'verify:3']);
    assert.match(never.summary ?? '', /Not verified: the mock-ups were reworked 2 times and the measurement still finds problems \(mockup-flow\); they are shown with what was found/);
    assert.deepEqual(never.bodies.flatMap((b) => (b.type === 'mockups.rendered' ? [b.options.length] : [])), [2], 'they are still put in front of the owner');
    const rework = never.sent.at(-1)!;
    assert.match(rework, /carried out the core flow of docs\/screens\.json on it/);
    assert.match(rework, /source=\\"browser-page\\"[\s\S]*docs\/mockups\/b\.html\\n- task \\"log\\"/, 'what the walk found travels as data');

    assert.equal(fixed.state, 'succeeded', fixed.error ?? '');
    assert.equal(looks, 2);
    assert.ok(!(fixed.summary ?? '').includes('Not verified'));
  } finally {
    await never.cleanup();
    await fixed.cleanup();
  }
});

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
import { DRAW_ALL_BRIEF, IDEATION_BRIEF, IDEATION_REQUIRED_FILES, IDEATION_REVISION_BRIEF, MOCKUP_RULES, directionBrief } from '../src/harness/prompts.ts';
import type { ReflectionAgent } from '../src/harness/ReflectionAgent.ts';
import type { SandwichReviewer } from '../src/harness/SandwichReviewer.ts';
import { MIN_MOCKUPS, MOCKUP_DIR, MockupRenderer, type MockupMeasurement, type MockupOption } from '../src/qa/MockupRenderer.ts';
import type { QaBrowser, QaSession } from '../src/qa/QaBrowser.ts';
import type { RefKit } from '../src/qa/RefKit.ts';
import type { SmokeRunner } from '../src/qa/SmokeTester.ts';
import type { OrbStackManager } from '../src/sandbox/OrbStackManager.ts';
import { DIRECTIONS_FILE, checkDirections, directionThemeFile, readDirections, type Directions } from '../src/scratch/Directions.ts';
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
async function designTask(files: Record<string, string>, mockups: Pick<MockupRenderer, 'measure'>, already: Record<string, string> = {}, broken: readonly string[] = [], apart = files[DIRECTIONS_FILE] !== undefined): Promise<{ state: string; error: string | null; summary: string | null; bodies: EventEnvelope['body'][]; brief: string; sent: string[]; sentBy: Record<string, string[]>; read: (path: string) => Promise<string>; cleanup: () => Promise<void> }> {
  const writes = (entries: [string, string][], tag: string): Block[] => entries.map(([path, content], i) => use(`${tag}${i}`, 'write_file', { path, content }));
  const entries = Object.entries(files);
  const isPage = (path: string): boolean => /^docs\/mockups\/[abc]\.html$/.test(path);
  const deep = (path: string): boolean => ['docs/architecture.md', 'docs/erd.md', 'docs/openapi.yaml'].includes(path);
  // With a directions table among the files the task goes the way it now does (`apart`): the lead writes the
  // four, then the deep dive, and each page is written by the conversation that was handed its direction.
  // Otherwise the lead writes everything in its first turn.
  const scripts: Record<string, Block[][]> = {
    lead: (apart ? [writes(entries.filter(([path]) => !isPage(path) && !deep(path)), 'w'), [say('문서와 방향표를 썼습니다.')], writes(entries.filter(([path]) => deep(path)), 'd'), [say('설계 문서와 시안을 만들었습니다.')]] : [writes(entries, 'w'), [say('설계 문서와 시안을 만들었습니다.')]]).filter((turn) => turn.length > 0),
  };
  if (apart) for (const [path, content] of entries.filter(([path]) => isPage(path))) scripts[path.at(-6)!] = [writes([[path, content]], path.at(-6)!), [say('이 방향을 그렸습니다.')]];
  const sent: string[] = [];
  const sentBy: Record<string, string[]> = {};
  const base = { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
  const sdk = {
    beta: {
      messages: {
        stream: (params: Anthropic.Beta.MessageCreateParams) => {
          sent.push(JSON.stringify(params.messages));
          // Which conversation this is: a direction's begins with the page it was handed.
          const who = /Yours is docs\/mockups\/([abc])\.html/.exec(JSON.stringify(params.messages[0]))?.[1] ?? 'lead';
          (sentBy[who] ??= []).push(JSON.stringify(params.messages));
          if (broken.includes(who)) throw new Error(`the engine of direction ${who} gave out`);
          // Out of script: the engine has nothing more to add, which is how a repair round that changes nothing looks.
          const content = (scripts[who] ??= []).shift() ?? [say('더 고칠 것이 없습니다.')];
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
  return { state: task.state, error: task.error, summary: task.summary, bodies: events.history({ taskId: task.id }, 0, 1000).map((e) => e.body), brief: sent[0] ?? '', sent, sentBy, read: async (path) => (await sandboxes.readFile(project, path)).content, cleanup: d.cleanup };
}

/** Two directions that differ in what they are built on, how they are operated, what leads, and how they look. */
const DIRECTIONS: Directions = {
  scene: '프리랜서 지우가 10월 정산을 마감하는 중이다. 도윤에게 ₩184,000을 보내야 하고 서연에게서 ₩96,500을 받아야 하며, 공용 경비는 ₩42,300이다. 택시 영수증 한 장(₩12,000)은 누구 몫인지 아직 정해지지 않았다.',
  directions: [
    { id: 'a', concept: '돈이 누구에게서 누구에게로 가는지를 화살표 한 줄로 보여 주는 흐름도', operation: '받을 사람의 이름표를 눌러 보낼 금액을 확인한 뒤 아래의 확인 단추를 한 번 눌러 닫는다', composition: '화면 위쪽 절반을 세 사람을 잇는 화살표가 차지하고 금액은 화살표 위에 큰 숫자로 놓인다', theme: { hue: 200, chroma: 0.13, lightness: 0.6, neutral_chroma: 0.01, corners: 'soft', display: 'sans', source: '송금 화면의 차분한 청록과 계좌 이체 확인증' } },
    { id: 'b', concept: '이번 달 영수증을 길게 펼친 종이 장부 한 장', operation: '영수증의 항목 줄을 옆으로 밀어 몫을 나누고 맨 아래 합계 줄에 도장을 찍어 마감한다', composition: '가운데에 세로로 긴 영수증이 놓이고 합계가 맨 아래에서 가장 크게 읽힌다', theme: { hue: 32, chroma: 0.17, lightness: 0.6, neutral_chroma: 0.02, corners: 'sharp', display: 'serif', source: '감열지 영수증의 누런 종이와 붉은 인주 도장' } },
  ],
};
const DOCS = { ...Object.fromEntries(IDEATION_REQUIRED_FILES.filter((f) => !f.startsWith(MOCKUP_DIR)).map((f) => [f, DOC(f)])), [SCREEN_SPEC_FILE]: JSON.stringify(SCREEN_SPEC, null, 2), [DIRECTIONS_FILE]: JSON.stringify(DIRECTIONS, null, 2) };
const DRAWN: MockupOption[] = [
  { file: `${MOCKUP_DIR}/a.html`, title: '흐름 한 줄', idea: '화살표 한 줄이 먼저입니다.', artifactId: 'art_a', width: 1440, height: 900 },
  { file: `${MOCKUP_DIR}/b.html`, title: '이번 달 영수증', idea: '영수증 한 장이 먼저입니다.', artifactId: 'art_b', width: 1440, height: 900 },
];
/** The mock-ups measured, with nothing found. */
const CLEAN: MockupMeasurement = { options: DRAWN, audit: null, flowProblems: [] };

test('a design task is asked for at least two drawn directions, and ends by putting them in front of the owner', async () => {
  assert.equal(MIN_MOCKUPS, 2);
  assert.deepEqual(IDEATION_REQUIRED_FILES.filter((f) => f.startsWith(MOCKUP_DIR)), [`${MOCKUP_DIR}/a.html`, `${MOCKUP_DIR}/b.html`], 'two are required; the third is the agent\'s call');
  // The lead writes what the product is and what its directions are; it draws none of them.
  assert.match(IDEATION_BRIEF, /3\. Screen spec, in docs\/screens\.json\.[\s\S]*with nothing about how it looks/);
  assert.match(IDEATION_BRIEF, /4\. Directions, in docs\/mockups\/directions\.json\.[\s\S]*none of them sees another's page/);
  assert.match(IDEATION_BRIEF, /the product doing the one thing it exists to do/);
  assert.match(IDEATION_BRIEF, /should read as different products for the same job, not as tabs or skins of one/);
  assert.match(IDEATION_BRIEF, /do not write any mock-up page or call set_theme/);
  assert.ok(!IDEATION_BRIEF.includes('data-step'), 'the rules of a page go to whoever draws one');
  assert.ok(IDEATION_REQUIRED_FILES.includes(SCREEN_SPEC_FILE), 'the screen spec is owed like the other documents');
  // What a mock-up is asked to be, said to the engine that draws one direction and to one that draws them all:
  // something that works, with something to look at, in the product's own words, and measured.
  const one = directionBrief({ file: `${MOCKUP_DIR}/b.html`, themeFile: directionThemeFile('b'), seed: 'SEED', scene: 'SCENE', row: 'ROW', others: 'OTHERS' });
  for (const brief of [one, MOCKUP_RULES]) {
    assert.match(brief, /no scripts, no external requests/);
    assert.match(brief, /The page opens in the state before the person acts, never frozen in the moment after/);
    assert.match(brief, /data-step="T:k"[\s\S]*data-done="T"/);
    assert.match(brief, /every control has an :active state/);
    assert.match(brief, /Never leave a box with a sentence saying what picture will go there, and never write a note to the reader on the page/);
    assert.match(brief, /generate_image, saved under docs\/mockups\/assets\//);
    assert.match(brief, /no sentence that explains the screen/);
    assert.match(brief, /They are measured, as a built screen is, and what is found is put in front of the owner beside each page\. Nothing comes back to you afterwards/);
    assert.match(brief, /call check_mockup on it[\s\S]*do not install a browser, and do not write scripts to look at the pages/);
  }
  assert.match(MOCKUP_RULES, /pages that read as tabs of one app have failed[\s\S]*three different products for the same job[\s\S]*For each direction call set_theme/);
  assert.match(one, /Yours is docs\/mockups\/b\.html: write that one file[\s\S]*SCENE[\s\S]*ROW[\s\S]*OTHERS[\s\S]*\.studio-zero\/themes\/b\.css[\s\S]*SEED/);
  assert.ok(one.includes('Do not call set_theme') && !one.includes('For each direction call set_theme') && !one.includes('Draw at least'), 'one direction is handed its theme and its one page');

  const tasksSeen: unknown[] = [];
  const run = await designTask({ ...DOCS, [`${MOCKUP_DIR}/a.html`]: page('흐름 한 줄', '', '<h1>₩184,000</h1>'.repeat(20)), [`${MOCKUP_DIR}/b.html`]: page('이번 달 영수증', '', '<h1>영수증</h1>'.repeat(20)) }, { measure: async (_project, p) => (tasksSeen.push(p.tasks), CLEAN) });
  try {
    assert.equal(run.state, 'succeeded', run.error ?? '');
    assert.ok(run.brief.includes(DIRECTIONS_FILE) && !run.brief.includes('data-step'), 'the lead was asked for the table, not for pages');
    // Each direction was drawn by a conversation of its own, from its own row and the scene they share.
    assert.deepEqual(Object.keys(run.sentBy).sort(), ['a', 'b', 'lead']);
    for (const [mine, other] of [['a', 'b'], ['b', 'a']] as const) {
      const [row, not] = [DIRECTIONS.directions.find((d) => d.id === mine)!, DIRECTIONS.directions.find((d) => d.id === other)!];
      const brief = run.sentBy[mine]![0]!;
      assert.ok(brief.includes(`Yours is ${MOCKUP_DIR}/${mine}.html`) && brief.includes('택시 영수증 한 장') && brief.includes(row.operation) && brief.includes(row.composition), `direction ${mine} is handed its row and the scene`);
      assert.ok(brief.includes(`${other}: ${not.concept}`) && !brief.includes(not.operation), 'and of the other only what it is, so as not to drift into it');
      assert.ok(brief.includes(directionThemeFile(mine)) && brief.includes(`\\"hue\\":${row.theme.hue}`), 'with the theme the studio generated from its row');
      assert.match(await run.read(directionThemeFile(mine)), /--color-brand:/);
    }
    assert.notEqual(await run.read(directionThemeFile('a')), await run.read(directionThemeFile('b')));
    assert.equal(JSON.parse(await run.read('.studio-zero/theme.json')).hue, 200, 'the project is left on the recommended direction\'s theme');
    assert.ok(run.sentBy.lead!.some((messages) => messages.includes('write the fifth pass')), 'the lead wrote the deep dive meanwhile');
    const calls = run.bodies.flatMap((b) => (b.type === 'tool.call' ? [[b.input.split(' ')[0], b.lane ?? 'lead']] : []));
    assert.ok(calls.some(([file, lane]) => file === `${MOCKUP_DIR}/a.html` && lane === 'a') && calls.some(([file, lane]) => file === `${MOCKUP_DIR}/b.html` && lane === 'b') && calls.some(([file, lane]) => file === 'docs/erd.md' && lane === 'lead'), `each call says whose it was: ${JSON.stringify(calls)}`);
    assert.ok(run.bodies.some((b) => b.type === 'notice' && b.level === 'info' && /2 directions are being drawn side by side \(a, b\)/.test(b.message)));
    const rendered = run.bodies.flatMap((b) => (b.type === 'mockups.rendered' ? [b] : []));
    assert.deepEqual(rendered.map((b) => b.options), [DRAWN]);
    assert.deepEqual(tasksSeen, [SCREEN_SPEC.tasks.map(({ id, goal, outcome }) => ({ id, goal, outcome }))], 'the pages were measured once, by the core flow of the screen spec');
    assert.deepEqual(run.bodies.flatMap((b) => (b.type === 'gate.result' ? [[b.gate, b.name, b.passed]] : [])), [['directions', DIRECTIONS_FILE, true], ['screens', SCREEN_SPEC_FILE, true]]);
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
    assert.ok(IDEATION_REVISION_BRIEF.includes(MOCKUP_RULES) && DRAW_ALL_BRIEF.includes(MOCKUP_RULES), 'a redraw is held to the rules of a first drawing');
    assert.deepEqual(Object.keys(again.sentBy), ['lead'], 'a revision is one conversation: the pages are there, and the notes say which to touch');
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
    assert.deepEqual(run.bodies.flatMap((b) => (b.type === 'gate.result' ? [[b.gate, b.passed]] : [])), [['directions', true], ['screens', false], ['screens', false]]);
    // It is said once before anyone draws, since the pages are drawn against it, and is owed at verification all the same.
    assert.ok(run.sentBy.lead!.some((messages) => /Before the directions are drawn, correct exactly these[\s\S]*docs\/screens\.json does not hold as the screen spec yet[\s\S]*events is empty/.test(messages.slice(messages.lastIndexOf('Before the directions are drawn')))));
    const repair = run.sentBy.lead!.at(-1)!;
    assert.match(repair, /docs\/screens\.json does not hold as the screen spec yet/);
    assert.match(repair, /task Log It: the id must be a short lowercase word/);
    assert.match(repair, /task Log It: screen names X-99, which is not a screen in this spec/);
    assert.match(repair, /events is empty/);
    assert.ok(run.bodies.every((b) => b.type !== 'mockups.rendered'));
  } finally {
    await run.cleanup();
  }
});

test('what the measurement finds on the mock-ups is shown to the owner with the findings, and nobody is sent back to rework them', async () => {
  const pages = { [`${MOCKUP_DIR}/a.html`]: page('흐름 한 줄', '', '<h1>₩184,000</h1>'.repeat(20)), [`${MOCKUP_DIR}/b.html`]: page('이번 달 영수증', '', '<h1>영수증</h1>'.repeat(20)) };
  const stuck: MockupMeasurement = { options: DRAWN, audit: null, flowProblems: [{ file: `${MOCKUP_DIR}/b.html`, problems: ['task "log" (설거지 20분을 적는다): the page opens with [data-done="log"] already showing.'] }] };
  let measured = 0;
  const run = await designTask({ ...DOCS, ...pages }, { measure: async () => ((measured += 1), stuck) });
  try {
    assert.equal(run.state, 'succeeded', run.error ?? '');
    assert.equal(measured, 1, 'measured once');
    assert.deepEqual(run.bodies.flatMap((b) => (b.type === 'task.phase' ? [`${b.phase}:${b.round}`] : [])), ['plan:0', 'execute:1', 'verify:1'], 'one round of work, one of verification');
    assert.match(run.summary ?? '', /Not verified: the measurement finds problems on the mock-ups \(mockup-flow\); they are shown with what was found/);
    assert.deepEqual(run.bodies.flatMap((b) => (b.type === 'mockups.rendered' ? [b.options.length] : [])), [2], 'they are put in front of the owner as they are');
    // What was found is on the record for the owner to open, and in no message to an engine.
    const flow = run.bodies.find((b) => b.type === 'gate.result' && b.gate === 'flow');
    assert.ok(flow?.type === 'gate.result' && !flow.passed && /docs\/mockups\/b\.html\n- task "log"/.test(flow.detail));
    assert.ok(run.sent.every((messages) => !messages.includes('already showing')), 'no engine is told');
    assert.deepEqual([run.sentBy.a!.length, run.sentBy.b!.length], [2, 2], 'each direction\'s engine wrote its page and was done');
  } finally {
    await run.cleanup();
  }
});

test('the directions table check: what makes directions one comparison and what makes them different, and what each miss says', () => {
  assert.deepEqual(checkDirections(DIRECTIONS), []);
  assert.deepEqual(readDirections(JSON.stringify(DIRECTIONS)), { ok: true, table: DIRECTIONS });
  const [a, b] = DIRECTIONS.directions as [Directions['directions'][number], Directions['directions'][number]];
  const has = (table: Directions, re: RegExp): boolean => checkDirections(table).some((problem) => re.test(problem));
  assert.ok(has({ ...DIRECTIONS, scene: '정산 화면' }, /^scene is empty or a label/));
  assert.ok(has({ ...DIRECTIONS, directions: [a] }, /directions has 1 row\(s\): give two, or three/));
  assert.ok(has({ ...DIRECTIONS, directions: [a, { ...b, id: 'c' }] }, /directions\[1\] has id "c": the rows are "a", "b" and then "c"/));
  assert.ok(has({ ...DIRECTIONS, directions: [a, { ...b, operation: '누른다' }] }, /direction b: operation is empty or a label/));
  // The same direction in other words, and two that differ in everything but how they look.
  assert.ok(has({ ...DIRECTIONS, directions: [a, { ...a, id: 'b', theme: b.theme }] }, /directions a and b say nearly the same thing/));
  assert.ok(has({ ...DIRECTIONS, directions: [a, { ...b, theme: { ...a.theme, hue: 215, source: b.theme.source } }] }, /directions a and b share a look \(hues 200 and 215, soft corners, sans titles\)/));
  assert.ok(!has({ ...DIRECTIONS, directions: [a, { ...b, theme: { ...a.theme, hue: 215, corners: 'sharp', source: b.theme.source } }] }, /share a look/), 'a near hue with another shape is a look of its own');
  assert.ok(!has({ ...DIRECTIONS, directions: [a, { ...b, theme: { ...a.theme, hue: 350, source: b.theme.source } }] }, /share a look/), 'hue is measured the short way round');
  assert.deepEqual(readDirections('{'), { ok: false, problems: ['docs/mockups/directions.json is not valid JSON.'] });
  assert.equal(readDirections({ scene: 'x' }).ok, false);
});

test('a table that does not hold is sent back once, and then one engine draws the directions in turn, as it used to', async () => {
  const pages = { [`${MOCKUP_DIR}/a.html`]: page('흐름 한 줄', '', '<h1>₩184,000</h1>'.repeat(20)), [`${MOCKUP_DIR}/b.html`]: page('이번 달 영수증', '', '<h1>영수증</h1>'.repeat(20)) };
  const same = { ...DIRECTIONS, directions: [DIRECTIONS.directions[0]!, { ...DIRECTIONS.directions[0]!, id: 'b' as const }] };
  const run = await designTask({ ...DOCS, ...pages, [DIRECTIONS_FILE]: JSON.stringify(same) }, { measure: async () => CLEAN }, {}, [], false);
  try {
    assert.equal(run.state, 'succeeded', run.error ?? '');
    assert.deepEqual(run.bodies.flatMap((b) => (b.type === 'gate.result' && b.gate === 'directions' ? [b.passed] : [])), [false, false]);
    assert.ok(run.sentBy.lead!.some((messages) => /docs\/mockups\/directions\.json does not hold as the directions table yet[\s\S]*directions a and b say nearly the same thing/.test(messages)));
    assert.ok(run.sentBy.lead!.at(-1)!.includes('still does not hold, so the directions will not be drawn side by side'), 'the lead is then asked for the deep dive and the pages itself');
    assert.ok(run.bodies.some((b) => b.type === 'notice' && b.level === 'warn' && /one engine draws them in turn/.test(b.message)));
    assert.deepEqual(Object.keys(run.sentBy), ['lead'], 'no direction was handed to an engine of its own');
  } finally {
    await run.cleanup();
  }
});

test('a direction whose engine gives out is said, and the others stand', async () => {
  const pages = Object.fromEntries(['a', 'b', 'c'].map((id) => [`${MOCKUP_DIR}/${id}.html`, page(`방향 ${id}`, '', '<h1>₩184,000</h1>'.repeat(20))]));
  const three: Directions = { ...DIRECTIONS, directions: [...DIRECTIONS.directions, { id: 'c', concept: '세 사람이 둘러앉은 식탁을 위에서 내려다본 자리 배치도', operation: '자리에 놓인 접시를 끌어 옆 사람 앞으로 옮기면 그만큼의 몫이 넘어간다', composition: '둥근 식탁이 화면 가운데를 채우고 각자의 금액이 자리 앞 접시에 적힌다', theme: { hue: 140, chroma: 0.12, lightness: 0.5, neutral_chroma: 0.01, corners: 'round', display: 'grotesk', source: '식당 테이블의 초록 식탁보와 둥근 접시' } }] };
  const run = await designTask({ ...DOCS, ...pages, [DIRECTIONS_FILE]: JSON.stringify(three) }, { measure: async () => CLEAN }, {}, ['c']);
  try {
    assert.equal(run.state, 'succeeded', run.error ?? '');
    assert.ok(run.bodies.some((b) => b.type === 'notice' && b.level === 'warn' && /Direction c was not finished by its engine \(.*the engine of direction c gave out.*\)\. The other directions stand\./.test(b.message)));
    assert.match(await run.read(`${MOCKUP_DIR}/a.html`), /방향 a/);
    assert.match(await run.read(`${MOCKUP_DIR}/b.html`), /방향 b/);
    await assert.rejects(run.read(`${MOCKUP_DIR}/c.html`));
    assert.deepEqual(run.bodies.flatMap((b) => (b.type === 'mockups.rendered' ? [b.options.length] : [])), [2]);
  } finally {
    await run.cleanup();
  }
});

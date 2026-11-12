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
import { IDEATION_BRIEF, IDEATION_REQUIRED_FILES, IDEATION_REVISION_BRIEF } from '../src/harness/prompts.ts';
import type { ReflectionAgent } from '../src/harness/ReflectionAgent.ts';
import type { SandwichReviewer } from '../src/harness/SandwichReviewer.ts';
import { MIN_MOCKUPS, MOCKUP_DIR, MockupRenderer, type MockupOption } from '../src/qa/MockupRenderer.ts';
import type { QaBrowser, QaSession } from '../src/qa/QaBrowser.ts';
import type { RefKit } from '../src/qa/RefKit.ts';
import type { SmokeRunner } from '../src/qa/SmokeTester.ts';
import type { OrbStackManager } from '../src/sandbox/OrbStackManager.ts';
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
async function designTask(files: Record<string, string>, mockups: Pick<MockupRenderer, 'render'>, already: Record<string, string> = {}): Promise<{ state: string; error: string | null; bodies: EventEnvelope['body'][]; brief: string; cleanup: () => Promise<void> }> {
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
  return { state: task.state, error: task.error, bodies: events.history({ taskId: task.id }, 0, 1000).map((e) => e.body), brief: sent[0] ?? '', cleanup: d.cleanup };
}

const DOCS = Object.fromEntries(IDEATION_REQUIRED_FILES.filter((f) => !f.startsWith(MOCKUP_DIR)).map((f) => [f, DOC(f)]));
const DRAWN: MockupOption[] = [
  { file: `${MOCKUP_DIR}/a.html`, title: '흐름 한 줄', idea: '화살표 한 줄이 먼저입니다.', artifactId: 'art_a', width: 1440, height: 900 },
  { file: `${MOCKUP_DIR}/b.html`, title: '이번 달 영수증', idea: '영수증 한 장이 먼저입니다.', artifactId: 'art_b', width: 1440, height: 900 },
];

test('a design task is asked for at least two drawn directions, and ends by putting them in front of the owner', async () => {
  assert.equal(MIN_MOCKUPS, 2);
  assert.deepEqual(IDEATION_REQUIRED_FILES.filter((f) => f.startsWith(MOCKUP_DIR)), [`${MOCKUP_DIR}/a.html`, `${MOCKUP_DIR}/b.html`], 'two are required; the third is the agent\'s call');
  assert.match(IDEATION_BRIEF, /differ in structure/);
  assert.match(IDEATION_BRIEF, /no scripts, no external requests/);

  const run = await designTask({ ...DOCS, [`${MOCKUP_DIR}/a.html`]: page('흐름 한 줄', '', '<h1>₩184,000</h1>'.repeat(20)), [`${MOCKUP_DIR}/b.html`]: page('이번 달 영수증', '', '<h1>영수증</h1>'.repeat(20)) }, { render: async () => DRAWN });
  try {
    assert.equal(run.state, 'succeeded', run.error ?? '');
    assert.ok(run.brief.includes('docs/mockups/a.html'), 'the engine was told where the mock-ups go');
    const rendered = run.bodies.flatMap((b) => (b.type === 'mockups.rendered' ? [b] : []));
    assert.deepEqual(rendered.map((b) => b.options), [DRAWN]);
    const order = run.bodies.map((b) => b.type);
    assert.ok(order.indexOf('mockups.rendered') < order.lastIndexOf('task.state'), 'the pictures are announced before the task is called done');
  } finally {
    await run.cleanup();
  }
});

test('one direction is not a choice: a design task without its second mock-up fails its check', async () => {
  const run = await designTask({ ...DOCS, [`${MOCKUP_DIR}/a.html`]: page('흐름 한 줄', '', '<h1>₩184,000</h1>'.repeat(20)) }, { render: async () => assert.fail('nothing is drawn for a task that did not pass') });
  try {
    assert.equal(run.state, 'failed');
    assert.match(run.error ?? '', /ideation-documents/);
    assert.ok(run.bodies.every((b) => b.type !== 'mockups.rendered'));
  } finally {
    await run.cleanup();
  }
});

test('pictures that cannot be drawn are said, and the documents still stand', async () => {
  const run = await designTask({ ...DOCS, [`${MOCKUP_DIR}/a.html`]: page('흐름 한 줄', '', '<h1>₩184,000</h1>'.repeat(20)), [`${MOCKUP_DIR}/b.html`]: page('이번 달 영수증', '', '<h1>영수증</h1>'.repeat(20)) }, { render: async () => [] });
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
  const fresh = await designTask({ ...DOCS, ...pages }, { render: async () => DRAWN });
  const again = await designTask({ [`${MOCKUP_DIR}/b.html`]: page('이번 달 영수증', '', '<h1>합계 먼저</h1>'.repeat(20)) }, { render: async () => DRAWN }, { ...DOCS, ...pages });
  try {
    assert.ok(fresh.brief.includes(JSON.stringify(IDEATION_BRIEF).slice(1, 80)) && !fresh.brief.includes('This is a revision of a design'), 'an empty workspace gets the whole brief');
    assert.equal(again.state, 'succeeded', again.error ?? '');
    assert.ok(again.brief.includes(JSON.stringify(IDEATION_REVISION_BRIEF).slice(1, 80)), 'a workspace with the design in it gets the revision brief');
    assert.ok(!again.brief.includes('Work in four passes'), 'and is not told to write the design again');
    assert.match(IDEATION_REVISION_BRIEF, /nothing else/);
    assert.match(IDEATION_REVISION_BRIEF, /do not start building the product/);
    assert.deepEqual(again.bodies.flatMap((b) => (b.type === 'mockups.rendered' ? [b.options.length] : [])), [2], 'the revised pages are drawn again for the next decision');
  } finally {
    await fresh.cleanup();
    await again.cleanup();
  }
});

// Runs the daemon's own model calls through the Claude Code login on this machine: real CLI, real subscription.
// Opt-in because it spends a little of the owner's quota:
//
//   SZ_TEST_SESSION=1 node --test packages/daemon/test/session.integration.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from 'playwright-core';
import { contract, createTheme, renderThemeCss, seedFromName } from '@studio-zero/design';
import { Plan } from '../src/harness/Harness.ts';
import { MOCKUP_RULES, PLANNER_SYSTEM_PROMPT, codingSystemPrompt } from '../src/harness/prompts.ts';
import { loopTool, runToolLoop } from '../src/llm/toolLoop.ts';
import { gradeAudit, runDomChecks } from '../src/qa/checks.ts';
import { PageDigest, collectDigest } from '../src/qa/collector.ts';
import { walkFlow, walkProblems } from '../src/qa/FlowWalker.ts';
import { withFaces } from '../src/qa/mockupFaces.ts';
import { readAnchorTable } from '../src/scratch/AnchorTable.ts';
import { coreStates, readScreenSpec } from '../src/scratch/ScreenSpec.ts';
import { runCommand } from '../src/util/run.ts';
import { SCREEN_SPEC } from './fixtures-mockup.ts';
import { freePort, sampleProject, testDaemon } from './helpers.ts';

const enabled = process.env.SZ_TEST_SESSION === '1';
const OWNER = { type: 'owner', via: 'desktop' } as const;

test('with no API key the daemon thinks through the Claude subscription', { skip: enabled ? false : 'set SZ_TEST_SESSION=1 (uses the Claude Code login on this machine)', timeout: 15 * 60 * 1000 }, async (t) => {
  const port = await freePort();
  // The container engine stays emulated; only the vendor CLI is real.
  const d = await testDaemon({ listen: { port }, engines: { claudeCode: { enabled: true } } }, {}, (docker) => (file, args, opts) => (file === 'claude' ? runCommand(file, args, opts) : docker(file, args, opts)));
  await d.daemon.start();
  const { claude, studio, store, scratch } = d.daemon;
  const scope = { projectId: 'prj_studio', taskId: null };
  try {
    assert.equal((await studio.status()).brain, 'session');
    assert.equal(claude.hasApiKey(), false);

    await t.test('structured output with the planner model', async () => {
      const Plan = z.object({ summary: z.string(), steps: z.array(z.string()).min(1).max(4) });
      const plan = await claude.structured({ scope, model: 'claude-fable-5-2', effort: 'low', system: 'You plan small software changes. Be brief.', content: [{ type: 'text', text: 'Plan adding a dark mode toggle to a settings page, in at most three steps.' }], schema: Plan });
      assert.ok(plan.summary.length > 0);
      t.diagnostic(`plan: ${plan.steps.length} steps`);
    });

    await t.test('daemon tools over the MCP shim, and web search whose hits come back as retrieved pages', async () => {
      let reported: string[] | null = null;
      const loop = await runToolLoop(claude, {
        scope,
        model: 'claude-opus-5-5',
        effort: 'low',
        system: 'Search the web once, then hand over what you found with the report tool. Do not answer in prose.',
        messages: [{ role: 'user', content: 'Find the official website of the Tauri application framework.' }],
        tools: [loopTool({ name: 'report', description: 'Hand over the URLs you found.', schema: z.object({ urls: z.array(z.string()).min(1) }), run: async (input) => ((reported = input.urls), { content: 'received', stop: true }) })],
        serverTools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 1 }],
        maxTurns: 4,
      });
      assert.ok(reported, 'the model called the daemon tool through the shim');
      assert.equal(loop.stopped, 'tool_stop');
      const hits = loop.blocks.flatMap((b) => (b.type === 'web_search_tool_result' && Array.isArray(b.content) ? b.content.map((h) => h.url) : []));
      assert.ok(hits.length > 0, 'search results were read from the event stream');
      t.diagnostic(`reported ${(reported as string[]).length} urls; ${hits.length} search hits`);
    });

    await t.test('a scratchpad turn: the real prompt, the real tools', async () => {
      const pad = await studio.createScratchpad(OWNER, { opening: '동네 빵집 예약 앱\n아침마다 줄이 길어서, 전날 밤에 빵을 예약하고 아침에 찾아가게 하고 싶어요.', mode: 'think' }, 'desktop');
      await scratch.idle();
      const view = studio.scratchView(pad.id);
      const agent = view.entries.filter((e) => e.author === 'agent');
      assert.ok(agent.length > 0, 'the agent put something on the page');
      t.diagnostic(`blocks: ${agent.flatMap((e) => e.blocks.map((b) => b.type)).join(', ')}; decisions: ${view.decisionLog.length > 0}; missing: ${view.readiness.missing.length}`);
    });

    await t.test('the coding engine: a bridged CLI changes the workspace only through the daemon', async () => {
      const project = sampleProject();
      store.insertProject(project);
      await d.daemon.provisioner.ensure(project);
      const task = store.insertTask({ id: 'tsk_bridge', projectId: project.id, kind: 'build', prompt: 'x', origin: 'desktop', budgetTokens: 2_000_000, branch: null, createdAt: Date.now() });
      const route = await d.daemon.router.route('build');
      assert.equal(route.engine.id, 'claude-code', 'with no API key, building goes to the subscription CLI');
      const session = await route.engine.open({ project, task, route: { ...route.candidate, effort: 'low' }, system: codingSystemPrompt(project.template), signal: new AbortController().signal, onWaiting: () => undefined });
      try {
        const result = await session.send('Create a file named hello.txt in the workspace root whose entire content is the two characters: hi. Then stop; do nothing else.');
        assert.equal(result.stopped, 'completed');
        assert.ok(existsSync(join(d.workspace, 'hello.txt')), 'the file exists in the sandbox workspace');
        assert.equal(readFileSync(join(d.workspace, 'hello.txt'), 'utf8').trim(), 'hi');
        t.diagnostic(`engine said: ${result.finalText.slice(0, 120)}`);
      } finally {
        await session.close();
      }
    });

    assert.ok(store.projectTokensSince('prj_studio', 0) > 0, 'subscription use is metered against the budget');
  } finally {
    await d.cleanup();
  }
});

/**
 * A phone app's first screen built the way a code generator builds one: headline, pitch, a static picture of a
 * parcel, three selling points and one wide button. On the project's own theme, so nothing measurable is wrong.
 */
const PARCEL = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 345 220"><rect width="345" height="220" fill="#e8eef0"/><path d="M92 86l80-34 82 34v78l-82 36-80-36z" fill="#c9a26b"/><path d="M92 86l80 34 82-34M172 120v80" stroke="#8b6b3d" stroke-width="5" fill="none"/><rect x="150" y="60" width="44" height="26" fill="#f4ead8"/></svg>');
const SLOPPY_PHONE_SCREEN = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${renderThemeCss(createTheme(seedFromName('garim')))}</style><style>
  body { margin: 0; font-family: "Pretendard Variable", sans-serif; background: var(--sz-bg); color: var(--sz-fg); }
  main { padding: 24px; display: grid; gap: 24px; text-align: center; }
  h1 { font-size: 30px; line-height: 1.3; margin: 0; }
  p { font-size: 18px; line-height: 1.6; margin: 0; color: var(--sz-fg-muted); }
  img { width: 100%; border-radius: 12px; display: block; }
  ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
  li { font-size: 16px; line-height: 1.6; color: var(--sz-fg-muted); }
  button { min-height: 56px; width: 100%; border: 0; border-radius: 8px; background: var(--sz-accent); color: var(--sz-on-accent); font-size: 18px; font-weight: 600; }
</style></head><body><main>
  <h1>올리기 전에, 가릴 것부터</h1>
  <p>당근이나 단톡방에 올릴 사진에서 집을 알려 주는 글자를 찾아 가리고 위치정보를 지워요.</p>
  <img alt="택배 상자" src="data:image/svg+xml,${PARCEL}">
  <ul><li>글자를 찾아 모자이크</li><li>위치정보 삭제</li><li>휴대폰 안에서만 처리</li></ul>
  <button type="button">사진 선택</button>
</main></body></html>`;

const REVIEWERS = { codex: 'codex', 'claude-code': 'claude', antigravity: 'agy', cursor: 'cursor-agent' } as const;

// One real review per subscription, each asked alone so that it is that reviewer answering and not a fallback.
for (const reviewer of ['codex', 'claude-code', 'antigravity', 'cursor'] as const) {
  test(`the audit's design review through the ${reviewer} subscription: a real screenshot, the real brief, and a landing page in a phone frame is rejected`, { skip: enabled ? false : 'set SZ_TEST_SESSION=1 (uses the vendor CLI logins on this machine)', timeout: 12 * 60 * 1000 }, async (t) => {
    if (process.env.SZ_TEST_REVIEWER && process.env.SZ_TEST_REVIEWER !== reviewer) return t.skip(`SZ_TEST_REVIEWER asks for ${process.env.SZ_TEST_REVIEWER} only`);
    const browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 15_000 }).catch(() => null);
    if (!browser) return t.skip('headless Chrome cannot be launched here');
    const real = (file: string): boolean => [REVIEWERS[reviewer], '/usr/bin/sandbox-exec'].includes(file) || file.endsWith(`/${REVIEWERS[reviewer]}`);
    const port = await freePort();
    const d = await testDaemon({ listen: { port }, engines: { claudeCode: { enabled: true } }, audit: { reviewers: [reviewer] } }, {}, (docker) => (file, args, opts) => (real(file) ? runCommand(file, args, opts) : docker(file, args, opts)));
    try {
      const context = await browser.newContext({ ...devices['iPhone 15 Pro'], colorScheme: 'light' });
      const page = await context.newPage();
      await page.setContent(SLOPPY_PHONE_SCREEN, { waitUntil: 'load' });
      const digest = PageDigest.parse(await page.evaluate(collectDigest, 600));
      const png = await page.screenshot({ type: 'png' });
      const measured = runDomChecks(digest, { viewport: 'iphone-15-pro', viewportWidth: 393, route: '/', touch: true, scope: 'full' }, contract);
      assert.equal(measured.filter((f) => f.severity === 'blocker').length, 0, 'measurement has no objection to this screen');
      assert.ok(digest.elements.some((e) => e.tag === 'img'), 'the collector saw the picture');

      await d.daemon.claude.refresh();
      const bridge = d.daemon.vision;
      const available = await bridge.availability();
      if (!available.paths.includes(reviewer)) return t.skip(`${reviewer} is not available here: ${available.reason ?? 'not installed or disabled'}`);
      assert.deepEqual(available.paths, [reviewer]);

      const started = Date.now();
      const { review, via, model } = await bridge.review({ scope: { projectId: 'prj_studio', taskId: null }, viewport: 'iphone-15-pro', route: '/', template: 'mobile-expo', folds: [png], digest, measured });
      assert.equal(via, reviewer);

      const verdict = gradeAudit([...measured, ...review.findings], { rubric: review.rubric, slopScore: review.slopScore }, 85);
      t.diagnostic(`${model}, ${Math.round((Date.now() - started) / 1000)}s; archetype ${review.archetype}; slop ${review.slopScore}; grade ${verdict.grade}; score ${verdict.score}`);
      t.diagnostic(`findings: ${review.findings.map((f) => `${f.severity} ${f.rule}${f.selector ? ` @ ${f.selector}` : ''}`).join('; ')}`);
      t.diagnostic(`patches: ${review.patches.map((p) => `${p.action}${p.target ? ` @ ${p.target}` : ''}`).join('; ')}`);
      t.diagnostic(`critique: ${review.critique}`);
      assert.equal(verdict.passed, false, 'the reviewer does not pass a marketing page in a phone frame');
      assert.ok(review.findings.some((f) => f.severity === 'blocker'), 'and says what blocks it');
      assert.ok(review.patches.length > 0, 'with a redesign plan');
      assert.ok(d.daemon.store.projectTokensSince('prj_studio', 0) > 0, 'the review is metered');

      // The question a suspended task asks to learn that this reviewer is back.
      assert.equal(await bridge.probe({ projectId: 'prj_studio', taskId: null }), reviewer);
    } finally {
      await browser.close();
      await d.cleanup();
    }
  });
}

test('the other subscriptions as coding engines: Codex, Cursor and Antigravity change the workspace only through the daemon', { skip: enabled ? false : 'set SZ_TEST_SESSION=1 (uses the vendor CLI logins on this machine)', timeout: 15 * 60 * 1000 }, async (t) => {
  const vendor = (file: string): boolean => ['claude', 'codex', 'cursor-agent', 'agy', '/usr/bin/sandbox-exec'].includes(file);
  const port = await freePort();
  const d = await testDaemon({ listen: { port }, engines: { claudeCode: { enabled: false } } }, {}, (docker) => (file, args, opts) => (vendor(file) ? runCommand(file, args, opts) : docker(file, args, opts)));
  await d.daemon.start();
  const { store, router, events } = d.daemon;
  try {
    const project = sampleProject();
    store.insertProject(project);
    await d.daemon.provisioner.ensure(project);
    for (const id of ['codex', 'cursor', 'antigravity'] as const) {
      await t.test(id, async (st) => {
        const available = (await router.status()).find((e) => e.id === id)!;
        if (!available.available) return st.skip(available.reason);
        const file = `hello-${id}.txt`;
        const task = store.insertTask({ id: `tsk_${id}`, projectId: project.id, kind: 'build', prompt: 'x', origin: 'desktop', budgetTokens: 2_000_000, branch: null, enginePref: id, createdAt: Date.now() });
        const route = await router.route('build', { engine: id });
        const session = await route.engine.open({ project, task, route: { ...route.candidate, effort: 'low' }, system: codingSystemPrompt(project.template), signal: new AbortController().signal, onWaiting: () => undefined });
        try {
          const result = await session.send(`Create a file named ${file} in the workspace root whose entire content is the two characters: hi. Then stop; do nothing else.`);
          assert.equal(result.stopped, 'completed');
          assert.equal(readFileSync(join(d.workspace, file), 'utf8').trim(), 'hi', 'the file is in the sandbox workspace, written by the daemon\'s tool');
          const tools = events.history({ taskId: task.id }, 0, 100).flatMap((e) => (e.body.type === 'tool.call' ? [e.body.tool] : []));
          assert.ok(tools.includes('write_file') || tools.includes('bash'), `it acted through the studio tools (${tools.join(', ')})`);
          st.diagnostic(`${id}: ${tools.join(', ')}; ${store.getTask(task.id)!.spentTokens} tokens`);
        } finally {
          await session.close();
        }
      });
    }
  } finally {
    await d.cleanup();
  }
});

test('a chosen model, for real: each CLI lists its own, runs the one picked, and refuses one it does not have', { skip: enabled ? false : 'set SZ_TEST_SESSION=1 (uses the vendor CLI logins on this machine)', timeout: 15 * 60 * 1000 }, async (t) => {
  const vendor = (file: string): boolean => ['claude', 'codex', 'cursor-agent', 'agy', '/usr/bin/sandbox-exec'].includes(file);
  const port = await freePort();
  const d = await testDaemon({ listen: { port }, engines: { claudeCode: { enabled: true } } }, {}, (docker) => (file, args, opts) => (vendor(file) ? runCommand(file, args, opts) : docker(file, args, opts)));
  await d.daemon.start();
  const { store, router } = d.daemon;
  try {
    const project = sampleProject();
    store.insertProject(project);
    await d.daemon.provisioner.ensure(project);
    const only = process.env.SZ_TEST_MODEL_ENGINE;
    for (const id of ['claude-code', 'codex', 'cursor', 'antigravity'] as const) {
      await t.test(id, { skip: only !== undefined && only !== id }, async (st) => {
        const available = (await router.status()).find((e) => e.id === id)!;
        if (!available.available) return st.skip(available.reason);
        const { models, efforts } = await router.catalog(id);
        assert.ok(models.length > 0, 'the CLI listed its models');
        // The smallest thing on the list: this is a one-word round.
        const pick = models.find((m) => /haiku|luna|flash-low|composer/i.test(m.id)) ?? models.at(-1)!;
        st.diagnostic(`${id}: ${models.length} models, efforts [${efforts.join(', ')}]; running ${pick.id} (${pick.label})`);
        // Where the engine has effort as a setting, the round is asked for at the lowest: the level travels with the pick.
        const effort = efforts.includes('low') ? 'low' : null;
        const round = async (model: string): Promise<string> => {
          const task = store.insertTask({ id: `tsk_${id}_${model.replace(/\W/g, '_')}`, projectId: project.id, kind: 'build', prompt: 'x', origin: 'desktop', budgetTokens: 2_000_000, branch: null, enginePref: id, modelPref: model, effortPref: effort, createdAt: Date.now() });
          const route = await router.route('build', { engine: id, model: task.modelPref, effort });
          assert.equal(route.candidate.model, model);
          if (effort) assert.equal(route.candidate.effort, effort);
          const session = await route.engine.open({ project, task, route: route.candidate, system: 'You answer in one word.', signal: new AbortController().signal, onWaiting: () => undefined });
          try {
            return (await session.send('Reply with the single word: ready. Use no tools.')).finalText;
          } finally {
            await session.close();
          }
        };
        assert.match(await round(pick.id), /ready/i);
        await assert.rejects(round('sz-no-such-model'), 'a model the vendor does not have is refused, not swapped for another');
      });
    }
  } finally {
    await d.cleanup();
  }
});

// The brief a design task's mock-ups are drawn under, put to a real model: does it come back with a page that
// can be operated with scripts off, marked so the studio can walk it? One page, one call, no tools.
//
//   SZ_TEST_SESSION=1 node --test --test-name-pattern="a mock-up from the real brief" packages/daemon/test/session.integration.test.ts
//
// SZ_TEST_OUT=<dir> keeps the page and a picture of it for a person to look at.
test('a mock-up from the real brief: a real model writes a page that opens before the act, and the walk carries the core flow out on it', { skip: enabled ? false : 'set SZ_TEST_SESSION=1 (uses the Claude Code login on this machine)', timeout: 15 * 60 * 1000 }, async (t) => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 15_000 }).catch(() => null);
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  const d = await testDaemon({ listen: { port: await freePort() }, engines: { claudeCode: { enabled: true } } }, {}, (docker) => (file, args, opts) => (file === 'claude' ? runCommand(file, args, opts) : docker(file, args, opts)));
  await d.daemon.start();
  try {
    assert.equal((await d.daemon.studio.status()).brain, 'session');
    const theme = renderThemeCss(createTheme({ ...seedFromName('household-chore-tracker'), hue: 28, chroma: 0.14 }));
    const tasks = SCREEN_SPEC.tasks.map(({ id, goal, outcome }) => ({ id, goal, outcome }));
    const started = Date.now();
    const { html } = await d.daemon.claude.structured({
      scope: { projectId: 'prj_studio', taskId: null },
      model: 'claude-fable-5-2',
      effort: 'medium',
      system: codingSystemPrompt('mobile-expo'),
      schema: z.object({ html: z.string().describe('The complete HTML document of the mock-up page.') }),
      maxTokens: 24_000,
      content: [
        {
          type: 'text',
          text: `Draw one mock-up page, page a, for the product whose screen spec is below (a phone app that two people in one home use to record chores). You have no tools in this exchange: do not call set_theme or generate_image. Use the custom properties of the theme below as the page's :root, and compose a direction that needs no picture file. Return the complete HTML document in "html".\n\nThe rules every mock-up is drawn under:\n\n${MOCKUP_RULES}\n\ndocs/screens.json:\n${JSON.stringify(SCREEN_SPEC, null, 2)}\n\n.studio-zero/theme.css:\n${theme}`,
        },
      ],
    });
    t.diagnostic(`the model answered in ${Math.round((Date.now() - started) / 1000)}s with ${html.length} characters`);
    assert.ok(/<html[\s>]/i.test(html) && html.length > 2000, 'a whole page came back');
    assert.ok(!/<script[\s>]/i.test(html), 'and it has no script in it');

    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, javaScriptEnabled: false, offline: true });
    const page = await context.newPage();
    await page.setContent(withFaces(html), { waitUntil: 'load' });
    const out = process.env.SZ_TEST_OUT;
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'a.html'), html);
      await page.screenshot({ path: join(out, 'a-at-rest.png') });
    }
    const walk = await walkFlow(page, tasks, { touch: true });
    if (out) await page.screenshot({ path: join(out, 'a-after-walk.png') });
    const problems = walkProblems(walk, tasks, { touch: true });
    t.diagnostic(`walk: ${JSON.stringify(walk.tasks)}`);
    for (const problem of problems) t.diagnostic(`found: ${problem}`);
    const digest = PageDigest.safeParse(await page.evaluate(collectDigest, 600));
    if (digest.success) {
      const measured = runDomChecks(digest.data, { viewport: 'iphone-15-pro', viewportWidth: 393, route: 'docs/mockups/a.html', touch: true, scope: 'full' }, contract);
      t.diagnostic(`measured at phone size: ${measured.filter((f) => f.severity === 'blocker').length} blocker(s), ${measured.filter((f) => f.severity === 'major').length} major, ${measured.filter((f) => f.severity === 'minor').length} minor${measured.length > 0 ? `: ${[...new Set(measured.map((f) => f.rule))].join(', ')}` : ''}`);
    }
    await context.close();

    assert.notEqual(walk.tasks[0]?.stopped, 'already-done', 'the page opens in the state before the person acts');
    assert.deepEqual(walk.tasks.map((task) => [task.id, task.reached]), tasks.map((task) => [task.id, true]), `every task of the core flow was carried out on the page: ${problems.join(' | ')}`);
  } finally {
    await browser.close();
    await d.cleanup();
  }
});

// What every verified build is planned with, put to the real planner once: the plan, the anchor table and the
// screen spec in one structured answer. If the subscription's CLI could not take this schema, or the model
// could not fill it so that both checks hold, no design build would get past planning.
//
//   SZ_TEST_SESSION=1 node --test --test-name-pattern="the real planner" packages/daemon/test/session.integration.test.ts
test('the real planner fills in a plan, an anchor table and a screen spec that both hold', { skip: enabled ? false : 'set SZ_TEST_SESSION=1 (uses the Claude Code login on this machine)', timeout: 15 * 60 * 1000 }, async (t) => {
  const d = await testDaemon({ listen: { port: await freePort() }, engines: { claudeCode: { enabled: true } } }, {}, (docker) => (file, args, opts) => (file === 'claude' ? runCommand(file, args, opts) : docker(file, args, opts)));
  await d.daemon.start();
  try {
    const started = Date.now();
    const plan = await d.daemon.claude.structured({
      scope: { projectId: 'prj_studio', taskId: null },
      model: 'claude-fable-5-2',
      effort: 'medium',
      system: PLANNER_SYSTEM_PROMPT,
      schema: Plan,
      maxTokens: 8000,
      content: [
        { type: 'text', text: "Owner's request (build):\n같이 사는 두 사람이 집안일을 누가 했는지 적는 폰 앱. 설거지를 끝내고 3초 안에 적을 수 있어야 하고, 잘못 누르면 바로 되돌릴 수 있어야 한다." },
        { type: 'text', text: 'Project stack template: mobile-expo. Files in the workspace:\n(empty workspace)' },
        { type: 'text', text: 'This task needs an anchor table: fill in "anchor".' },
        { type: 'text', text: 'This task needs a screen spec: fill in "screens".' },
      ],
    });
    t.diagnostic(`the planner answered in ${Math.round((Date.now() - started) / 1000)}s: ${plan.steps.length} steps`);
    // SZ_TEST_OUT=<dir> keeps the answer, so a check that refuses it can be looked at without asking again.
    if (process.env.SZ_TEST_OUT) {
      mkdirSync(process.env.SZ_TEST_OUT, { recursive: true });
      writeFileSync(join(process.env.SZ_TEST_OUT, 'plan.json'), JSON.stringify(plan, null, 2));
    }
    const anchor = readAnchorTable(plan.anchor);
    assert.ok(anchor.ok, `the anchor table holds: ${anchor.ok ? '' : anchor.problems.join(' | ')}`);
    const spec = readScreenSpec(plan.screens);
    assert.ok(spec.ok, `the screen spec holds: ${spec.ok ? '' : spec.problems.join(' | ')}`);
    t.diagnostic(`screens: ${spec.spec.screens.map((s) => `${s.id} ${s.name}`).join(', ')}`);
    t.diagnostic(`core flow: ${spec.spec.tasks.map((task) => `${task.id} (${task.goal} → ${task.outcome})`).join(' | ')}`);
    t.diagnostic(`states owed a route: ${coreStates(spec.spec).map((s) => `${s.screen} ${s.name}`).join(', ')}`);
    assert.ok(coreStates(spec.spec).length > 0, 'the screens of the core flow say what they show when the usual case does not hold');
  } finally {
    await d.cleanup();
  }
});

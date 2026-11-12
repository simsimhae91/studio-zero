// Runs the daemon's own model calls through the Claude Code login on this machine: real CLI, real subscription.
// Opt-in because it spends a little of the owner's quota:
//
//   SZ_TEST_SESSION=1 node --test packages/daemon/test/session.integration.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codingSystemPrompt } from '../src/harness/prompts.ts';
import { loopTool, runToolLoop } from '../src/llm/toolLoop.ts';
import { runCommand } from '../src/util/run.ts';
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
        const route = await router.route('build', id);
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

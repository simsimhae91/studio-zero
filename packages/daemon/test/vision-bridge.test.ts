// The design reviewer's two ways out: the API key, and the owner's subscription through the Claude Code CLI.
// Both are stood in for here (a scripted SDK, a scripted `claude` binary); what is real is everything between
// the bridge and them: path selection, the budget gate, metering, and the request each path actually sends.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import type { ConfigSchema } from '../src/config.ts';
import { PolicyDeniedError } from '../src/policy/PolicyEngine.ts';
import type { PageDigest } from '../src/qa/collector.ts';
import { QaVisionBridge, VisionUnavailableError } from '../src/qa/QaVisionBridge.ts';
import { VISION_MODEL, VisionReply, type VisionInput } from '../src/qa/vision.ts';
import type { RunOptions, RunResult } from '../src/util/run.ts';
import { quietLog, testDaemon, type TestDaemon } from './helpers.ts';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const REPLY: VisionReply = {
  archetype: 'mobile-app',
  slopScore: 8,
  critique: 'A viewfinder under a compact bar, with the action in the dock.',
  rubric: { hierarchy: 9, whitespace: 9, typography: 9, color: 9, copy: 9, originality: 9, tactility: 9 },
  findings: [{ category: 'copy', severity: 'minor', elementId: 'e1', observation: 'The hint repeats the label.', fix: 'Drop the hint or say what happens to the photo.' }],
  redesignPatches: [],
};

const DIGEST: PageDigest = {
  title: '가림', lang: 'ko', width: 393, height: 659, scrollWidth: 393, scrollHeight: 659, loadedFonts: ['Geist'],
  elements: [{
    id: 'e1', tag: 'div', role: 'button', selector: 'main > div.dropzone', text: '가릴 사진 가져오기', textLength: 10, interactive: true, inline: false,
    x: 16, y: 84, w: 361, h: 451, color: [0.1, 0.1, 0.1, 1], background: [1, 1, 1, 1], backgroundIndeterminate: false, ownBackground: [0, 0, 0, 0], backgroundImage: 'none',
    fontSize: 18, fontWeight: 600, fontFamily: 'Geist', lineHeight: 1.6, letterSpacingEm: 0, uppercase: false, radius: 12, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: 0,
    shadow: 'none', hasBorder: true, clipped: false, charsPerLine: 0, siblingKey: 'main|DIV',
  }],
};

interface CliCall {
  args: string[];
  stdin: string;
}

/** A `claude` binary that answers `--version`, and answers a print run with a stream-json result (or fails). */
function fakeCli(answer: () => { structured: unknown } | { error: string }): { calls: CliCall[]; run: (args: readonly string[], opts?: RunOptions) => Promise<RunResult> } {
  const calls: CliCall[] = [];
  const done = (stdout: string, exitCode = 0): RunResult => ({ exitCode, stdout, stderr: '', truncated: false, timedOut: false, durationMs: 1 });
  return {
    calls,
    run: async (args, opts = {}) => {
      if (args[0] === '--version') return done('2.1.322 (Claude Code)\n');
      calls.push({ args: [...args], stdin: typeof opts.stdin === 'string' ? opts.stdin : '' });
      const said = answer();
      const result = 'error' in said ? { type: 'result', is_error: true, result: said.error } : { type: 'result', is_error: false, result: '', structured_output: said.structured, usage: { input_tokens: 4200, output_tokens: 900 } };
      return done(`${JSON.stringify({ type: 'system', subtype: 'init' })}\n${JSON.stringify(result)}\n`);
    },
  };
}

/** An SDK whose structured call answers (or throws) as scripted, and keeps what it was sent. */
function fakeSdk(answer: () => unknown): { sdk: Anthropic; requests: Anthropic.Beta.MessageCreateParams[] } {
  const requests: Anthropic.Beta.MessageCreateParams[] = [];
  const usage = { input_tokens: 3000, output_tokens: 700, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const sdk = {
    beta: {
      messages: {
        parse: async (params: Anthropic.Beta.MessageCreateParams) => {
          requests.push(params);
          return { id: 'msg', type: 'message', role: 'assistant', model: params.model, content: [], stop_reason: 'end_turn', stop_details: null, usage, parsed_output: answer() };
        },
      },
    },
  } as unknown as Anthropic;
  return { sdk, requests };
}

async function setup(opts: { sdk?: Anthropic; cli?: ReturnType<typeof fakeCli>; config?: z.input<typeof ConfigSchema> }): Promise<{ d: TestDaemon; bridge: QaVisionBridge; input: (taskId?: string | null) => VisionInput }> {
  const d = await testDaemon(
    { engines: { claudeCode: { enabled: opts.cli !== undefined } }, ...opts.config },
    opts.sdk ? { anthropic: opts.sdk } : {},
    (docker) => (file, args, runOpts) => (file === 'claude' && opts.cli ? opts.cli.run(args, runOpts) : docker(file, args, runOpts)),
  );
  // What the daemon does at boot: look for the subscription CLI, so the first answer about paths is right.
  await d.daemon.claude.refresh();
  const bridge = new QaVisionBridge({ config: d.config, claude: d.daemon.claude, log: quietLog });
  const input = (taskId: string | null = null): VisionInput => ({ scope: { projectId: 'prj_studio', taskId }, viewport: 'iphone-15-pro', route: '/', template: 'mobile-expo', folds: [PNG], digest: DIGEST, measured: [] });
  return { d, bridge, input };
}

const flag = (call: CliCall, name: string): string | undefined => (call.args.includes(name) ? call.args[call.args.indexOf(name) + 1] : undefined);

test('with no API key the review travels through the subscription CLI: tools off, the screenshot inline, the reply held to the schema', async () => {
  const cli = fakeCli(() => ({ structured: REPLY }));
  const { d, bridge, input } = await setup({ cli });
  try {
    assert.deepEqual(bridge.availability(), { status: 'ready', paths: ['session'], reason: null });
    const { review, via } = await bridge.review(input());
    assert.equal(via, 'session');
    assert.equal(review.slopScore, 8);
    assert.equal(review.findings[0]!.selector, 'main > div.dropzone', 'the element id the reviewer named became a selector');

    const [call] = cli.calls;
    assert.equal(cli.calls.length, 1);
    assert.ok(call!.args.includes('--print'));
    assert.equal(flag(call!, '--tools'), '', 'the reviewer has no tools: it cannot read a file, so it is never handed a path');
    assert.equal(flag(call!, '--model'), VISION_MODEL);
    assert.equal(flag(call!, '--input-format'), 'stream-json');
    assert.match(flag(call!, '--system-prompt')!, /^You are reviewing one screen[\s\S]*slop smell test/);
    const schema = JSON.parse(flag(call!, '--json-schema')!) as { required: string[]; properties: Record<string, unknown> };
    for (const key of ['archetype', 'slopScore', 'critique', 'rubric', 'findings', 'redesignPatches']) assert.ok(schema.required.includes(key), key);

    const turn = JSON.parse(call!.stdin) as { message: { content: { type: string; source?: { type: string; media_type: string; data: string }; text?: string }[] } };
    const image = turn.message.content.find((block) => block.type === 'image')!;
    assert.deepEqual(image.source, { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') });
    assert.match(turn.message.content[0]!.text!, /^Product: a mobile app \(Expo, React Native\)/);
    assert.ok(!call!.args.some((arg) => arg.includes(PNG.toString('base64'))), 'the screenshot travels on stdin, not in the argument list');
    assert.equal(d.daemon.store.projectTokensSince('prj_studio', 0), 5100, 'subscription use is metered');
  } finally {
    await d.cleanup();
  }
});

test('a task that has spent its own budget is still judged: the review answers to the project budget, and is charged to the task', async () => {
  const cli = fakeCli(() => ({ structured: REPLY }));
  const { d, bridge, input } = await setup({ cli });
  try {
    const { store, claude } = d.daemon;
    const task = store.insertTask({ id: 'tsk_spent', projectId: 'prj_studio', kind: 'build', prompt: 'x', origin: 'desktop', budgetTokens: 10_000, branch: null, createdAt: 1 });
    store.addUsage({ projectId: 'prj_studio', taskId: task.id, source: 'bridge', model: 'claude-code:opus', inputTokens: 40_000, outputTokens: 0, usdMicros: 0 }, 2);

    // This is what used to happen to the review: any model call made in the task's name is refused once it has overspent.
    await assert.rejects(claude.gate({ projectId: 'prj_studio', taskId: task.id }, VISION_MODEL), (err) => err instanceof PolicyDeniedError && err.rule === 'budget.task');

    const { via } = await bridge.review(input(task.id));
    assert.equal(via, 'session');
    assert.equal(store.getTask(task.id)!.spentTokens, 45_100, 'the review is in the task\'s ledger, so the owner sees the real total');
  } finally {
    await d.cleanup();
  }
});

test('with an API key the review goes through the SDK, and the CLI is not asked', async () => {
  const cli = fakeCli(() => ({ structured: REPLY }));
  const api = fakeSdk(() => REPLY);
  const { d, bridge, input } = await setup({ sdk: api.sdk, cli });
  try {
    assert.deepEqual(bridge.availability().paths, ['api', 'session'], 'a stored key is tried first');
    const { review, via } = await bridge.review(input());
    assert.equal(via, 'api');
    assert.equal(review.archetype, 'mobile-app');
    assert.equal(cli.calls.length, 0);

    const [request] = api.requests as (Anthropic.Beta.MessageCreateParams & { fallbacks?: unknown })[];
    assert.deepEqual([request!.model, request!.output_config?.effort, request!.fallbacks, request!.betas], [VISION_MODEL, 'high', 'default', ['server-side-fallback-2026-07-01']]);
    assert.ok(request!.output_config?.format, 'structured outputs carry the schema');
    const content = request!.messages[0]!.content as Anthropic.Beta.BetaContentBlockParam[];
    assert.deepEqual(content.map((block) => block.type), ['text', 'image', 'text', 'text']);
    assert.match(String(request!.system), /^You are reviewing one screen/);
  } finally {
    await d.cleanup();
  }
});

test('when the API path fails for a reason of its own, the same review is asked through the subscription', async () => {
  const cli = fakeCli(() => ({ structured: REPLY }));
  const api = fakeSdk(() => {
    throw Object.assign(new Error('529 overloaded'), { status: 529 });
  });
  const { d, bridge, input } = await setup({ sdk: api.sdk, cli });
  try {
    const { via, review } = await bridge.review(input());
    assert.equal(via, 'session');
    assert.equal(review.slopScore, 8);
    assert.equal(api.requests.length, 1);
    assert.equal(cli.calls.length, 1);
  } finally {
    await d.cleanup();
  }
});

test('when both paths fail the bridge says what each one answered, and does not pretend to a review', async () => {
  const cli = fakeCli(() => ({ error: 'Not logged in · Please run /login' }));
  const api = fakeSdk(() => {
    throw new Error('connection refused');
  });
  const { d, bridge, input } = await setup({ sdk: api.sdk, cli });
  try {
    await assert.rejects(bridge.review(input()), (err) => {
      assert.ok(err instanceof VisionUnavailableError);
      assert.deepEqual(err.attempts.map((a) => a.path), ['api', 'session']);
      assert.match(err.message, /^API key: connection refused; Claude subscription \(CLI\): Claude Code에 로그인되어 있지 않습니다/);
      assert.equal(err.final, false, 'another screen may still get through');
      return true;
    });
  } finally {
    await d.cleanup();
  }
});

test('a reply that does not fit the schema is a failed attempt, not a review', async () => {
  const cli = fakeCli(() => ({ structured: { ...REPLY, archetype: 'poster' } }));
  const { d, bridge, input } = await setup({ cli });
  try {
    assert.equal(VisionReply.safeParse({ ...REPLY, archetype: 'poster' }).success, false);
    await assert.rejects(bridge.review(input()), VisionUnavailableError);
  } finally {
    await d.cleanup();
  }
});

test('a spent project budget ends the attempt on the first path: it is the same wall on the second', async () => {
  const cli = fakeCli(() => ({ structured: REPLY }));
  const api = fakeSdk(() => REPLY);
  const { d, bridge, input } = await setup({ sdk: api.sdk, cli, config: { budgets: { projectDailyTokens: 1000 } } });
  try {
    d.daemon.store.addUsage({ projectId: 'prj_studio', taskId: null, source: 'bridge', model: 'claude-code:opus', inputTokens: 5000, outputTokens: 0, usdMicros: 0 }, Date.now());
    await assert.rejects(bridge.review(input()), (err) => {
      assert.ok(err instanceof VisionUnavailableError);
      assert.equal(err.final, true);
      assert.deepEqual(err.attempts.map((a) => a.path), ['api']);
      assert.match(err.message, /budget\.project-daily/);
      return true;
    });
    assert.equal(api.requests.length + cli.calls.length, 0, 'nothing was sent anywhere');
  } finally {
    await d.cleanup();
  }
});

test('switched off, or with nobody to ask, the bridge reports which and refuses to review', async () => {
  const off = await setup({ cli: fakeCli(() => ({ structured: REPLY })), config: { audit: { vision: false } } });
  const none = await setup({});
  try {
    assert.equal(off.bridge.availability().status, 'off');
    assert.equal(none.bridge.availability().status, 'unavailable');
    assert.match(none.bridge.availability().reason!, /no Anthropic API key in the vault and the Claude Code CLI is not available/);
    for (const { bridge, input } of [off, none]) {
      await assert.rejects(bridge.review(input()), (err) => err instanceof VisionUnavailableError && err.final && err.attempts.length === 0);
    }
  } finally {
    await off.d.cleanup();
    await none.d.cleanup();
  }
});

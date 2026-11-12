// The design reviewer's ways out: the API key, then the owner's subscriptions in order (Codex, Claude,
// Antigravity, Cursor), each through its own CLI. Every CLI is stood in for here (a scripted SDK, scripted
// binaries, a scripted ACP agent); what is real is everything between the bridge and them: the order, the
// budget gate, metering, limit detection, and the request each reviewer is actually sent.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import type { ReviewerId } from '@studio-zero/protocol';
import type { z } from 'zod';
import type { AcpRequest } from '../src/bridge/acp.ts';
import { JAIL_BIN, jailAvailable } from '../src/bridge/jail.ts';
import type { ConfigSchema } from '../src/config.ts';
import { PolicyDeniedError } from '../src/policy/PolicyEngine.ts';
import type { PageDigest } from '../src/qa/collector.ts';
import { QaVisionBridge, VisionUnavailableError, isUsageLimit, jsonFrom } from '../src/qa/QaVisionBridge.ts';
import { VISION_MODEL, VisionReply, type VisionInput } from '../src/qa/vision.ts';
import type { RunOptions, RunResult } from '../src/util/run.ts';
import { testDaemon, type TestDaemon } from './helpers.ts';

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

/** What a reviewer does when asked: answers with a reply (as JSON text for the CLIs), or fails with this message. */
type Script = () => unknown;
const LIMIT = (who: string): Script => () => {
  throw new Error(`${who}: You've hit your usage limit. Try again at 5:00 PM.`);
};

interface Sent {
  reviewer: ReviewerId;
  args: string[];
  stdin: string;
  /** Codex: the files it was pointed at, read while they still existed. */
  images?: Buffer[];
  schema?: Record<string, unknown>;
  /** ACP reviewers: the request as the protocol client received it. */
  acp?: AcpRequest;
}

interface World {
  d: TestDaemon;
  bridge: QaVisionBridge;
  sent: Sent[];
  api: Anthropic.Beta.MessageCreateParams[];
  input: (taskId?: string | null) => VisionInput;
}

/**
 * A daemon whose reviewers are the ones scripted here and no others. A reviewer left out is switched off.
 * The CLIs are stand-ins on disk, so the jailed ones can resolve "their" install without the real thing.
 */
async function world(scripts: Partial<Record<ReviewerId, Script>>, config: z.input<typeof ConfigSchema> = {}): Promise<World> {
  const install = realpathSync(mkdtempSync(join(tmpdir(), 'sz-reviewers-')));
  for (const name of ['codex', 'claude', 'cursor-agent', 'agy']) {
    writeFileSync(join(install, name), '#!/bin/sh\n');
    chmodSync(join(install, name), 0o755);
  }
  const sent: Sent[] = [];
  const api: Anthropic.Beta.MessageCreateParams[] = [];
  const done = (stdout: string, exitCode = 0, stderr = ''): RunResult => ({ exitCode, stdout, stderr, truncated: false, timedOut: false, durationMs: 1 });
  const flag = (args: readonly string[], name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const said = (script: Script): { reply: unknown } | { error: string } => {
    try {
      return { reply: script() };
    } catch (err) {
      return { error: (err as Error).message };
    }
  };

  const sdk = {
    beta: {
      messages: {
        parse: async (params: Anthropic.Beta.MessageCreateParams) => {
          api.push(params);
          const usage = { input_tokens: 3000, output_tokens: 700, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
          return { id: 'msg', type: 'message', role: 'assistant', model: params.model, content: [], stop_reason: 'end_turn', stop_details: null, usage, parsed_output: scripts.api!() };
        },
      },
    },
  } as unknown as Anthropic;

  const d = await testDaemon(
    {
      engines: {
        claudeCode: { enabled: 'claude-code' in scripts, bin: join(install, 'claude') },
        codex: { enabled: 'codex' in scripts, bin: join(install, 'codex') },
        cursor: { enabled: 'cursor' in scripts, bin: join(install, 'cursor-agent') },
        antigravity: { enabled: 'antigravity' in scripts, bin: join(install, 'agy') },
      },
      ...config,
    },
    {
      ...('api' in scripts ? { anthropic: sdk } : {}),
      // Antigravity and Cursor take a question with pictures over the Agent Client Protocol.
      acp: async (req) => {
        const reviewer: ReviewerId = req.args.some((a) => a.endsWith('/agy')) ? 'antigravity' : 'cursor';
        sent.push({ reviewer, args: [...req.args], stdin: req.prompt, acp: req });
        const answer = said(scripts[reviewer]!);
        if ('error' in answer) throw new Error(answer.error);
        // An agent with no schema enforcement tends to wrap its JSON in a fence. The bridge has to cope.
        return { text: typeof answer.reply === 'string' ? answer.reply : `\`\`\`json\n${JSON.stringify(answer.reply)}\n\`\`\``, stopReason: 'end_turn' };
      },
    },
    (docker) => async (file, args, opts: RunOptions = {}) => {
      if (!file.startsWith(install)) return docker(file, args, opts);
      if (args[0] === '--version') return done('1.0.0-test\n');
      const stdin = typeof opts.stdin === 'string' ? opts.stdin : '';
      if (file.endsWith('/codex')) {
        const images = args.flatMap((a, i) => (a === '--image' ? [readFileSync(args[i + 1]!)] : []));
        const schemaFile = flag(args, '--output-schema');
        sent.push({ reviewer: 'codex', args: [...args], stdin, images, ...(schemaFile ? { schema: JSON.parse(readFileSync(schemaFile, 'utf8')) as Record<string, unknown> } : {}) });
        const answer = said(scripts.codex!);
        if ('error' in answer) return done('', 1, answer.error);
        writeFileSync(flag(args, '--output-last-message')!, typeof answer.reply === 'string' ? answer.reply : JSON.stringify(answer.reply));
        return done(`${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 17_000, output_tokens: 600 } })}\n`);
      }
      // Claude Code, headless: a stream-json result.
      sent.push({ reviewer: 'claude-code', args: [...args], stdin });
      const answer = said(scripts['claude-code']!);
      const result = 'error' in answer ? { type: 'result', is_error: true, result: answer.error } : { type: 'result', is_error: false, result: '', structured_output: answer.reply, usage: { input_tokens: 4200, output_tokens: 900 } };
      return done(`${JSON.stringify(result)}\n`);
    },
  );
  // What the daemon does at boot: look for the subscription CLI, so the first answer about reviewers is right.
  await d.daemon.claude.refresh();
  const input = (taskId: string | null = null): VisionInput => ({ scope: { projectId: 'prj_studio', taskId }, viewport: 'iphone-15-pro', route: '/', template: 'mobile-expo', folds: [PNG, PNG], digest: DIGEST, measured: [] });
  return { d, bridge: d.daemon.vision, sent, api, input };
}

const ALL: Partial<Record<ReviewerId, Script>> = { codex: () => REPLY, 'claude-code': () => REPLY, antigravity: () => REPLY, cursor: () => REPLY };
const flagOf = (s: Sent, name: string): string | undefined => (s.args.includes(name) ? s.args[s.args.indexOf(name) + 1] : undefined);
const needsJail = (t: { skip: (why: string) => void }): boolean => (jailAvailable() ? false : (t.skip('Antigravity and Cursor need the macOS sandbox'), true));

test('reviewers are asked in the owner\'s order, and the first that answers is the only one asked: Codex, with the screenshots attached and the schema enforced', async (t) => {
  if (needsJail(t)) return;
  const w = await world(ALL);
  try {
    assert.deepEqual(await w.bridge.availability(), { status: 'ready', paths: ['codex', 'claude-code', 'antigravity', 'cursor'], reason: null });
    const { review, via, model } = await w.bridge.review(w.input());
    assert.deepEqual([via, model, review.slopScore], ['codex', 'codex:default', 8]);
    assert.equal(review.findings[0]!.selector, 'main > div.dropzone', 'the element id the reviewer named became a selector');
    assert.deepEqual(w.sent.map((s) => s.reviewer), ['codex'], 'nobody after the first is asked');

    const [call] = w.sent as [Sent];
    assert.equal(call.args[0], 'exec');
    assert.equal(flagOf(call, '--sandbox'), 'read-only');
    assert.ok(call.args.includes('view_image') && call.args[call.args.indexOf('view_image') - 1] === '--disable', 'the model gets no image tool: the pictures are attached by the CLI');
    assert.deepEqual(call.images, [PNG, PNG], 'each screenful is a file in the scratch folder, handed over with --image');
    assert.ok(!existsSync(flagOf(call, '--image')!), 'and gone with that folder afterwards');
    assert.equal('$schema' in call.schema!, false);
    for (const key of ['archetype', 'slopScore', 'critique', 'rubric', 'findings', 'redesignPatches']) assert.ok((call.schema!.required as string[]).includes(key), key);
    assert.equal(call.schema!.additionalProperties, false, 'a strict schema, as the CLI\'s structured output requires');
    assert.match(call.stdin, /^You are reviewing one screen[\s\S]*slop smell test[\s\S]*You have no tools in this session[\s\S]*Product: a mobile app \(Expo, React Native\)[\s\S]*Answer with one JSON object and nothing else/);
    assert.ok(!call.args.some((a) => a.includes('You are reviewing')), 'the brief travels on stdin, not in the argument list');
    assert.equal(w.d.daemon.store.projectTokensSince('prj_studio', 0), 17_600, 'subscription use is metered');
  } finally {
    await w.d.cleanup();
  }
});

test('a reviewer at its usage limit is passed over for the next: Codex, then Claude, then Antigravity, then Cursor', async (t) => {
  if (needsJail(t)) return;
  const through = async (answering: ReviewerId): Promise<World> => {
    const order: ReviewerId[] = ['codex', 'claude-code', 'antigravity', 'cursor'];
    return world(Object.fromEntries(order.map((id) => [id, order.indexOf(id) < order.indexOf(answering) ? LIMIT(id) : () => REPLY])));
  };

  const claude = await through('claude-code');
  const agy = await through('antigravity');
  const cursor = await through('cursor');
  try {
    const viaClaude = await claude.bridge.review(claude.input());
    assert.deepEqual([viaClaude.via, viaClaude.model], ['claude-code', VISION_MODEL]);
    assert.deepEqual(claude.sent.map((s) => s.reviewer), ['codex', 'claude-code']);
    const cli = claude.sent[1]!;
    assert.equal(flagOf(cli, '--tools'), '', 'Claude reviews with no tools at all');
    assert.equal(flagOf(cli, '--model'), VISION_MODEL);
    assert.equal(flagOf(cli, '--input-format'), 'stream-json');
    assert.ok(flagOf(cli, '--json-schema'));
    const turn = JSON.parse(cli.stdin) as { message: { content: { type: string; source?: { type: string; media_type: string; data: string } }[] } };
    assert.deepEqual(turn.message.content.filter((b) => b.type === 'image').map((b) => b.source), [PNG, PNG].map((png) => ({ type: 'base64', media_type: 'image/png', data: png.toString('base64') })), 'its screenshots are inline on stdin');

    const viaAgy = await agy.bridge.review(agy.input());
    assert.deepEqual([viaAgy.via, viaAgy.model, viaAgy.review.slopScore], ['antigravity', 'antigravity:default', 8], 'JSON inside a code fence is still read, then held to the schema');
    assert.deepEqual(agy.sent.map((s) => s.reviewer), ['codex', 'claude-code', 'antigravity']);
    const acp = agy.sent[2]!.acp!;
    assert.equal(acp.file, JAIL_BIN, 'a CLI that keeps its own tools reviews from inside the jail');
    assert.deepEqual(acp.args.slice(-2).map((a) => a.split('/').at(-1)), ['agy', 'acp']);
    assert.deepEqual(acp.images, [PNG, PNG].map((png) => ({ mimeType: 'image/png', data: png.toString('base64') })), 'its screenshots are image blocks of the protocol prompt');
    assert.match(acp.prompt, /It must be valid against this JSON Schema:\n\{/);

    const viaCursor = await cursor.bridge.review(cursor.input());
    assert.equal(viaCursor.via, 'cursor');
    assert.deepEqual(cursor.sent.map((s) => s.reviewer), ['codex', 'claude-code', 'antigravity', 'cursor']);
    const last = cursor.sent[3]!.acp!;
    assert.deepEqual(last.args.slice(-3).map((a) => a.split('/').at(-1)), ['node', 'index.js', 'acp'], 'Cursor takes pictures over ACP too, started without its launcher script');
    assert.deepEqual(last.mcpServers, [], 'and is given no tool server for a review');
    assert.equal(last.images!.length, 2);
  } finally {
    for (const w of [claude, agy, cursor]) await w.d.cleanup();
  }
});

test('when every subscription is at its limit the bridge says so, in order, and marks the failure as one that time repairs', async (t) => {
  if (needsJail(t)) return;
  const w = await world({ codex: LIMIT('codex'), 'claude-code': LIMIT('claude'), antigravity: () => { throw new Error('RESOURCE_EXHAUSTED: quota exceeded'); }, cursor: LIMIT('cursor') });
  try {
    await assert.rejects(w.bridge.review(w.input()), (err) => {
      assert.ok(err instanceof VisionUnavailableError);
      assert.deepEqual(err.attempts.map((a) => [a.path, a.limited]), [['codex', true], ['claude-code', true], ['antigravity', true], ['cursor', true]]);
      assert.equal(err.limited, true);
      assert.equal(err.final, false);
      assert.match(err.message, /^Codex subscription: .*usage limit.*; Claude subscription: Claude 구독의 사용 한도에 걸렸습니다.*; Antigravity subscription: RESOURCE_EXHAUSTED.*; Cursor subscription: /);
      return true;
    });
    assert.equal(await w.bridge.probe({ projectId: 'prj_studio', taskId: null }), null, 'and asking whether anyone is back gets the same answer');
  } finally {
    await w.d.cleanup();
  }
});

test('a failure that is not a limit is not mistaken for one: waiting would not bring that review back', async () => {
  const w = await world({ codex: () => { throw new Error('Not logged in. Run codex login.'); }, 'claude-code': () => ({ ...REPLY, archetype: 'poster' }) });
  try {
    assert.equal(VisionReply.safeParse({ ...REPLY, archetype: 'poster' }).success, false);
    await assert.rejects(w.bridge.review(w.input()), (err) => {
      assert.ok(err instanceof VisionUnavailableError);
      assert.deepEqual(err.attempts.map((a) => [a.path, a.limited]), [['codex', false], ['claude-code', false]], 'a login problem and a reply that does not fit the schema');
      assert.equal(err.limited, false);
      return true;
    });
  } finally {
    await w.d.cleanup();
  }
});

test('a task that has spent its own budget is still judged: the review answers to the project budget, and is charged to the task', async () => {
  const w = await world({ codex: () => REPLY });
  try {
    const { store, claude } = w.d.daemon;
    const task = store.insertTask({ id: 'tsk_spent', projectId: 'prj_studio', kind: 'build', prompt: 'x', origin: 'desktop', budgetTokens: 10_000, branch: null, createdAt: 1 });
    store.addUsage({ projectId: 'prj_studio', taskId: task.id, source: 'bridge', model: 'claude-code:opus', inputTokens: 40_000, outputTokens: 0, usdMicros: 0 }, 2);

    // This is what used to happen to the review: any model call made in the task's name is refused once it has overspent.
    await assert.rejects(claude.gate({ projectId: 'prj_studio', taskId: task.id }, VISION_MODEL), (err) => err instanceof PolicyDeniedError && err.rule === 'budget.task');

    const { via } = await w.bridge.review(w.input(task.id));
    assert.equal(via, 'codex');
    assert.equal(store.getTask(task.id)!.spentTokens, 57_600, 'the review is in the task\'s ledger, so the owner sees the real total');
  } finally {
    await w.d.cleanup();
  }
});

test('a stored API key is asked before any subscription, and a failure of its own falls through to them', async () => {
  let apiUp = true;
  const w = await world({ api: () => (apiUp ? REPLY : (() => { throw Object.assign(new Error('529 overloaded'), { status: 529 }); })()), codex: () => REPLY });
  try {
    assert.deepEqual((await w.bridge.availability()).paths, ['api', 'codex']);
    const first = await w.bridge.review(w.input());
    assert.deepEqual([first.via, first.model, w.sent.length], ['api', VISION_MODEL, 0]);
    const [request] = w.api as (Anthropic.Beta.MessageCreateParams & { fallbacks?: unknown })[];
    assert.deepEqual([request!.model, request!.output_config?.effort, request!.fallbacks, request!.betas], [VISION_MODEL, 'high', 'default', ['server-side-fallback-2026-07-01']]);
    assert.deepEqual((request!.messages[0]!.content as Anthropic.Beta.BetaContentBlockParam[]).map((b) => b.type), ['text', 'image', 'image', 'text', 'text']);

    apiUp = false;
    const second = await w.bridge.review(w.input());
    assert.equal(second.via, 'codex');
  } finally {
    await w.d.cleanup();
  }
});

test('a spent project budget ends the attempt at the first reviewer: it is the same wall for the others, and it is one that time moves', async () => {
  const w = await world({ codex: () => REPLY, 'claude-code': () => REPLY }, { budgets: { projectDailyTokens: 1000 } });
  try {
    w.d.daemon.store.addUsage({ projectId: 'prj_studio', taskId: null, source: 'bridge', model: 'claude-code:opus', inputTokens: 5000, outputTokens: 0, usdMicros: 0 }, Date.now());
    await assert.rejects(w.bridge.review(w.input()), (err) => {
      assert.ok(err instanceof VisionUnavailableError);
      assert.deepEqual([err.final, err.limited, err.attempts.map((a) => a.path)], [true, true, ['codex']]);
      assert.match(err.message, /budget\.project-daily/);
      return true;
    });
    assert.equal(w.sent.length, 0, 'nothing was sent anywhere');
    assert.equal(await w.bridge.probe({ projectId: 'prj_studio', taskId: null }), null);
  } finally {
    await w.d.cleanup();
  }
});

test('the order is the owner\'s to set; switched off, or with nobody to ask, the bridge reports which and refuses to review', async () => {
  const reordered = await world({ codex: () => REPLY, 'claude-code': () => REPLY }, { audit: { reviewers: ['claude-code', 'codex'] } });
  const off = await world({ codex: () => REPLY }, { audit: { vision: false } });
  const none = await world({});
  try {
    assert.deepEqual((await reordered.bridge.availability()).paths, ['claude-code', 'codex']);
    assert.equal((await reordered.bridge.review(reordered.input())).via, 'claude-code');

    assert.equal((await off.bridge.availability()).status, 'off');
    const nobody = await none.bridge.availability();
    assert.equal(nobody.status, 'unavailable');
    assert.match(nobody.reason!, /no Anthropic API key in the vault and none of the subscription CLIs \(codex, claude-code, antigravity, cursor\) is available/);
    for (const w of [off, none]) {
      await assert.rejects(w.bridge.review(w.input()), (err) => err instanceof VisionUnavailableError && err.final && !err.limited && err.attempts.length === 0);
    }
  } finally {
    for (const w of [reordered, off, none]) await w.d.cleanup();
  }
});

test('asking whether a reviewer is back: a one-word question, no pictures, answered by the first one that can', async () => {
  const w = await world({ codex: LIMIT('codex'), 'claude-code': () => ({ ok: true }) });
  try {
    assert.equal(await w.bridge.probe({ projectId: 'prj_studio', taskId: null }), 'claude-code');
    assert.deepEqual(w.sent.map((s) => s.reviewer), ['codex', 'claude-code']);
    assert.ok(!w.sent[0]!.args.includes('--image') && !w.sent[0]!.args.includes('--output-schema'));
    assert.match(w.sent[0]!.stdin, /Reply with the single word: ok$/);
    assert.ok(!w.sent[1]!.args.includes('--input-format'), 'no pictures: the question goes as plain text');
  } finally {
    await w.d.cleanup();
  }
});

test('reading a reviewer\'s words: limits are recognised across vendors, and JSON is found with or without a fence', () => {
  for (const said of ['You\'ve hit your usage limit. Try again at 5 PM.', 'Claude 구독의 사용 한도에 걸렸습니다.', 'RESOURCE_EXHAUSTED: Quota exceeded for model', '429 Too Many Requests', 'rate limit reached for requests', 'Rate-limited, retry later']) {
    assert.equal(isUsageLimit(new Error(said)), true, said);
  }
  for (const said of ['Not logged in. Run codex login.', 'the agent exited (1) before answering', 'structured response was cut off at max_tokens', 'connection refused']) {
    assert.equal(isUsageLimit(new Error(said)), false, said);
  }
  assert.equal(isUsageLimit(new PolicyDeniedError('budget.project-daily', 'project daily budget exhausted')), true);
  assert.equal(isUsageLimit(new PolicyDeniedError('vault.local-owner-only', 'no')), false);

  assert.deepEqual(jsonFrom('{"a":1}'), { a: 1 });
  assert.deepEqual(jsonFrom('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(jsonFrom('Here is the review:\n{"a":{"b":[1,2]}}\nLet me know.'), { a: { b: [1, 2] } });
  assert.throws(() => jsonFrom('I could not see the image.'), /did not answer with a JSON object/);
});

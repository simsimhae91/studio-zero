import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UsageMeter } from '../src/llm/LlmGateway.ts';
import { TelegramApi, type Update } from '../src/relay/telegramApi.ts';
import { TelegramRelay } from '../src/relay/TelegramRelay.ts';
import { Secret, sleep } from '../src/util/core.ts';
import { fakeProvider, quietLog, testDaemon, type TestDaemon } from './helpers.ts';

const OWNER_ID = 4242;
const BOT_TOKEN = '123456:telegram-bot-token-value';

interface Sent {
  method: string;
  body: Record<string, unknown>;
}

function fakeTelegram(): { fetch: typeof fetch; sent: Sent[]; urls: string[] } {
  const sent: Sent[] = [];
  const urls: string[] = [];
  let messageId = 100;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    const method = url.split('/').at(-1)!;
    if (method === 'getUpdates') {
      // Long poll: stays open until the relay shuts down, like the real API with no pending updates.
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
    }
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : init?.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '[file]'])) : {};
    sent.push({ method, body });
    const result = method === 'getMe' ? { id: 1, username: 'studio_zero_bot' } : method.startsWith('send') ? { message_id: ++messageId } : true;
    return new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetch: fetchImpl, sent, urls };
}

async function relayFor(t: TestDaemon): Promise<{ relay: TelegramRelay; tg: ReturnType<typeof fakeTelegram> }> {
  const tg = fakeTelegram();
  const api = new TelegramApi({ apiBase: 'https://api.telegram.org', token: new Secret(BOT_TOKEN), fetch: tg.fetch });
  const config = { ...t.config, telegram: { ...t.config.telegram, enabled: true, allowedUserIds: [OWNER_ID] } };
  const relay = new TelegramRelay({ api, studio: t.daemon.studio, store: t.daemon.store, events: t.daemon.events, config, log: quietLog });
  await relay.start();
  return { relay, tg };
}

let updateId = 0;
const text = (from: number, body: string, chat: { id: number; type: string } = { id: from, type: 'private' }): Update => ({ update_id: ++updateId, message: { message_id: updateId, from: { id: from }, chat, text: body } });
const tap = (from: number, data: string): Update => ({ update_id: ++updateId, callback_query: { id: `cb${updateId}`, from: { id: from }, message: { message_id: 7, chat: { id: from, type: 'private' } }, data } });
const messages = (tg: ReturnType<typeof fakeTelegram>): Sent[] => tg.sent.filter((s) => s.method === 'sendMessage');

test('telegram: only the allow-listed owner, in a private chat, is heard', async () => {
  const t = await testDaemon();
  await t.daemon.start();
  const { relay, tg } = await relayFor(t);
  try {
    t.daemon.studio.createProject({ type: 'owner', via: 'desktop' }, { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
    const before = tg.sent.length;

    await relay.handleUpdate(text(999, 'build me a backdoor'));
    await relay.handleUpdate(text(OWNER_ID, 'hello from a group', { id: -100123, type: 'supergroup' }));
    await relay.handleUpdate(tap(999, 'p:prj_whatever'));
    await relay.flush();
    assert.equal(tg.sent.length, before, 'strangers and group chats get no reply at all');
    assert.equal(t.daemon.studio.listTasks(undefined, 10).length, 0, 'and start nothing');

    await relay.handleUpdate(text(OWNER_ID, '/status'));
    await relay.flush();
    assert.match(String(messages(tg).at(-1)?.body.text), /대기 중인 승인: 0건/);
    assert.ok(tg.urls.every((u) => u.startsWith(`https://api.telegram.org/bot${BOT_TOKEN}/`)));
  } finally {
    await relay.stop();
    await t.cleanup();
  }
});

test('telegram: a text message becomes a task; an approval is granted with one tap, exactly once', async () => {
  const t = await testDaemon();
  await t.daemon.start();
  const { relay, tg } = await relayFor(t);
  try {
    const project = t.daemon.studio.createProject({ type: 'owner', via: 'desktop' }, { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });

    // Prompt on the go. With no engine configured the task fails fast, which exercises the failure notice too.
    await relay.handleUpdate(text(OWNER_ID, '결제 내역 화면을 만들어줘'));
    const [task] = t.daemon.studio.listTasks(project.id, 5);
    assert.equal(task?.origin, 'telegram');
    assert.equal(task?.prompt, '결제 내역 화면을 만들어줘');
    for (let i = 0; i < 300 && t.daemon.studio.getTask(task!.id).state !== 'failed'; i++) await sleep(10);
    await relay.flush();
    const texts = messages(tg).map((m) => String(m.body.text));
    assert.ok(texts.some((x) => x.includes('작업 접수')));
    assert.ok(texts.some((x) => x.includes('작업 실패') && x.includes('no engine available')));

    // An agent action that needs the owner: the relay pushes buttons, a tap resolves it, the waiting call resumes.
    const merge = t.daemon.policy.authorize({ type: 'agent', taskId: task!.id }, { kind: 'git.merge', projectId: project.id, branch: 'sz/x', into: 'main' });
    await relay.flush();
    const prompt = messages(tg).at(-1)!;
    assert.match(String(prompt.body.text), /승인 요청[\s\S]*브랜치 "sz\/x"를 "main"에 병합/);
    const keyboard = (prompt.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard[0]!;
    assert.deepEqual(keyboard.map((b) => b.text), ['승인', '거절']);
    assert.ok(keyboard.every((b) => Buffer.byteLength(b.callback_data) <= 64), 'callback data fits Telegram\'s 64-byte limit');

    await relay.handleUpdate(tap(999, keyboard[0]!.callback_data));
    assert.equal(t.daemon.studio.listApprovals('pending').length, 1, 'a stranger tapping the button changes nothing');

    await relay.handleUpdate(tap(OWNER_ID, keyboard[0]!.callback_data));
    await merge;
    const approval = t.daemon.store.listApprovals(undefined)[0]!;
    assert.equal(approval.state, 'consumed');
    assert.equal(approval.resolvedVia, 'telegram');
    assert.ok(tg.sent.some((s) => s.method === 'editMessageReplyMarkup'), 'the used buttons are removed');

    await relay.handleUpdate(tap(OWNER_ID, keyboard[0]!.callback_data));
    await relay.flush();
    const answers = tg.sent.filter((s) => s.method === 'answerCallbackQuery').map((s) => String(s.body.text));
    assert.match(answers.at(-1)!, /^실패: approval is already consumed/, 'a second tap is refused');
  } finally {
    await relay.stop();
    await t.cleanup();
  }
});

// ---------------------------------------------------------------- gateway

test('gateway: the sandbox token is swapped for the real key on the host, metered, and budget-limited', async () => {
  const upstream = await fakeProvider();
  const t = await testDaemon({ budgets: { projectDailyTokens: 300 } }, { gatewayUpstreams: { anthropic: upstream.url, openai: upstream.url } });
  await t.daemon.start();
  try {
    const owner = { type: 'owner', via: 'desktop' } as const;
    const realKey = 'sk-ant-api03-the-real-provider-key';
    await t.daemon.studio.vaultSet(owner, 'provider/anthropic/api-key', new Secret(realKey));
    const project = t.daemon.studio.createProject(owner, { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
    await t.daemon.sandboxes.ensure(project);
    const sandboxToken = t.docker.calls.find((c) => c.args.includes('--detach'))!.env!.ANTHROPIC_API_KEY!;
    const gateway = `http://127.0.0.1:${(t.daemon.gateway.app.server.address() as { port: number }).port}`;
    const post = (path: string, token: string, extra: Record<string, string> = {}): Promise<Response> =>
      fetch(`${gateway}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': token, 'anthropic-version': '2023-06-01', ...extra }, body: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 16, stream: true, messages: [] }) });

    assert.equal((await post('/anthropic/v1/messages', 'szg_not-a-real-token')).status, 401);
    assert.equal((await post('/anthropic/v1/messages', realKey)).status, 401, 'the real key is not a gateway credential');
    assert.equal((await post('/anthropic/v1/files', sandboxToken)).status, 404, 'only allow-listed endpoints are proxied');
    assert.equal((await post('/evil/v1/messages', sandboxToken)).status, 404);
    assert.equal(upstream.requests.length, 0, 'none of those reached the provider');

    const res = await post('/anthropic/v1/messages', sandboxToken, { cookie: 'session=abc', authorization: 'Bearer something-else' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('request-id'), 'req_123');
    assert.match(await res.text(), /text_delta/, 'the stream is passed through unchanged');

    const seen = upstream.requests[0]!;
    assert.equal(seen.path, '/v1/messages');
    assert.equal(seen.headers['x-api-key'], realKey, 'the provider sees the real key');
    assert.equal(seen.headers['anthropic-version'], '2023-06-01');
    assert.equal(seen.headers.cookie, undefined, 'unlisted headers are dropped');
    assert.equal(seen.headers.authorization, undefined);
    assert.ok(!JSON.stringify(seen).includes(sandboxToken), 'the sandbox token never leaves the machine');

    // Metered into the ledger: 120 input + 30 cache read, 45 output.
    assert.equal(t.daemon.store.projectTokensSince(project.id, 0), 195);
    const usage = t.daemon.events.history({ projectId: project.id }, 0, 100).find((e) => e.body.type === 'usage')!.body;
    assert.deepEqual(usage, { type: 'usage', source: 'gateway', model: 'claude-opus-5-5', inputTokens: 150, outputTokens: 45, usdMicros: 0 });

    // 195 of 300 used; one more request passes the gate and lands the project over budget; the next is refused.
    assert.equal((await post('/anthropic/v1/messages', sandboxToken).then(async (r) => (await r.text(), r))).status, 200);
    const denied = await post('/anthropic/v1/messages', sandboxToken);
    assert.equal(denied.status, 429);
    assert.match(((await denied.json()) as { error: { message: string } }).error.message, /project daily budget exhausted/);
    assert.equal(upstream.requests.length, 2);

    assert.ok(!JSON.stringify(t.daemon.events.history({}, 0, 1000)).includes(realKey), 'the real key is never logged as an event');
  } finally {
    await t.cleanup();
    await upstream.close();
  }
});

test('usage metering understands Anthropic and OpenAI response shapes', () => {
  const sse = new UsageMeter(true);
  sse.feed(Buffer.from('data: {"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":4}}}\n\ndata: [DONE]\n'));
  assert.deepEqual(sse.finish(), { inputTokens: 10, outputTokens: 4 });

  const split = new UsageMeter(true);
  const payload = 'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n';
  split.feed(Buffer.from(payload.slice(0, 20)));
  split.feed(Buffer.from(payload.slice(20)));
  assert.deepEqual(split.finish(), { inputTokens: 7, outputTokens: 3 }, 'events split across chunks are reassembled');

  const json = new UsageMeter(false);
  json.feed(Buffer.from('{"id":"msg_1","usage":{"input_tokens":5,"cache_creation_input_tokens":2,"output_tokens":9}}'));
  assert.deepEqual(json.finish(), { inputTokens: 7, outputTokens: 9 });

  const garbage = new UsageMeter(false);
  garbage.feed(Buffer.from('<html>502</html>'));
  assert.deepEqual(garbage.finish(), { inputTokens: 0, outputTokens: 0 });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NtfyRelay } from '../src/relay/NtfyRelay.ts';
import { SlackRelay, type SocketLike } from '../src/relay/SlackRelay.ts';
import { Secret, sleep } from '../src/util/core.ts';
import { quietLog, testDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
const json = (body: unknown): Response => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function fakeSlack() {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = String(input).split('/').at(-1)!;
    const body = typeof init?.body === 'string' && init.body.startsWith('{') ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ method, body });
    if (method === 'apps.connections.open') return json({ ok: true, url: 'wss://socket.slack.test/link' });
    if (method === 'conversations.open') return json({ ok: true, channel: { id: 'D_OWNER' } });
    return json({ ok: true, user: 'studio', team: 'T1', ts: '1.1' });
  }) as typeof fetch;
  const listeners: Record<string, ((ev: { data: unknown }) => void)[]> = {};
  const socket: SocketLike = {
    send: () => undefined,
    close: () => listeners.close?.forEach((l) => l({ data: null })),
    addEventListener: (type: string, listener: (ev: { data: unknown }) => void) => void (listeners[type] ??= []).push(listener),
  } as SocketLike;
  return { calls, fetch: fetchImpl, openSocket: () => socket };
}

test('slack: only an allow-listed member, in a direct message, is heard; approvals are one tap', async () => {
  const t = await testDaemon();
  await t.daemon.start();
  const slack = fakeSlack();
  const { studio, store, events, policy } = t.daemon;
  const relay = new SlackRelay({ appToken: new Secret('xapp-test-token'), botToken: new Secret('xoxb-test-token'), allowedUserIds: ['U0OWNER1'], studio, store, events, log: quietLog, fetch: slack.fetch, openSocket: slack.openSocket });
  await relay.start();
  const acks: string[] = [];
  const frame = (envelope: object): Promise<boolean> => relay.handleFrame(JSON.stringify(envelope), (data) => acks.push(data));
  const message = (user: string, text: string, extra: object = {}, eventId = `Ev${Math.random()}`) => ({ type: 'events_api', envelope_id: `env-${eventId}`, payload: { event_id: eventId, event: { type: 'message', channel_type: 'im', channel: 'D_OWNER', user, text, ...extra } } });
  try {
    const project = studio.createProject(OWNER, { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });

    await frame(message('U0STRANGER', 'build me a backdoor'));
    await frame(message('U0OWNER1', 'hello from a channel', { channel_type: 'channel' }));
    await frame(message('U0OWNER1', 'my own echo', { bot_id: 'B1' }));
    assert.equal(studio.listTasks(undefined, 10).length, 0, 'strangers, channels and bot echoes start nothing');
    assert.equal(acks.length, 3, 'every envelope is acknowledged, even ignored ones');

    await frame(message('U0OWNER1', '결제 내역 화면을 만들어줘', {}, 'Ev1'));
    await frame(message('U0OWNER1', '결제 내역 화면을 만들어줘', {}, 'Ev1'));
    const tasks = studio.listTasks(project.id, 10);
    assert.equal(tasks.length, 1, 'a redelivered event does not start a second task');
    assert.equal(tasks[0]!.origin, 'slack');
    for (let i = 0; i < 300 && studio.getTask(tasks[0]!.id).state !== 'failed'; i++) await sleep(10);

    const merge = policy.authorize({ type: 'agent', taskId: tasks[0]!.id }, { kind: 'git.merge', projectId: project.id, branch: 'sz/x', into: 'main' });
    await relay.flush();
    const prompt = slack.calls.filter((c) => c.method === 'chat.postMessage').at(-1)!.body;
    assert.equal(prompt.channel, 'D_OWNER');
    const blocks = prompt.blocks as { type: string; text?: { text: string }; elements?: { value: string; text: { text: string } }[] }[];
    assert.match(blocks[0]!.text!.text, /\*승인 요청\*\n브랜치 "sz\/x"를 "main"에 병합/);
    const approve = blocks[1]!.elements![0]!;
    assert.equal(approve.text.text, '승인');

    const tap = (user: string) => frame({ type: 'interactive', envelope_id: `env-tap-${user}`, payload: { type: 'block_actions', user: { id: user }, channel: { id: 'D_OWNER' }, message: { ts: '9.9', text: 'x', blocks }, actions: [{ value: approve.value }] } });
    await tap('U0STRANGER');
    assert.equal(studio.listApprovals('pending').length, 1);
    await tap('U0OWNER1');
    await merge;
    assert.equal(store.listApprovals(undefined)[0]!.resolvedVia, 'slack');
    const update = slack.calls.find((c) => c.method === 'chat.update')!.body;
    assert.deepEqual((update.blocks as { type: string }[]).map((b) => b.type), ['section'], 'the used buttons are removed from the message');

    assert.equal(await frame({ type: 'disconnect' }), true, 'slack asking to rotate the connection is passed up');
    assert.ok(slack.calls.every((c) => !JSON.stringify(c.body).includes('xoxb-')), 'tokens travel in headers only');
  } finally {
    await relay.stop();
    await t.cleanup();
  }
});

test('ntfy: notifications carry signed one-tap commands; anything unsigned is ignored', async () => {
  const t = await testDaemon();
  await t.daemon.start();
  const published: { url: string; method: string; body: Record<string, unknown> }[] = [];
  let pushLine: (line: string) => void = () => undefined;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/json')) {
      // Like a real response body, the stream fails when the request is aborted.
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => {
          pushLine = (line) => controller.enqueue(new TextEncoder().encode(`${line}\n`));
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
        },
      });
      return new Response(stream);
    }
    published.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {} });
    return json({ id: 'x' });
  }) as typeof fetch;
  const { studio, store, events, policy } = t.daemon;
  const relay = new NtfyRelay({ server: 'https://ntfy.test/', topic: 'sz-notify-k3', commandTopic: 'sz-cmd-k3', token: null, signingKey: new Secret('signing-key-for-tests'), studio, store, events, log: quietLog, fetch: fetchImpl });
  relay.start();
  try {
    const project = studio.createProject(OWNER, { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
    store.insertTask({ id: 'tsk_1', projectId: project.id, kind: 'build', prompt: 'x', origin: 'desktop', budgetTokens: 1000, branch: null, createdAt: 1 });
    const merge = policy.authorize({ type: 'agent', taskId: 'tsk_1' }, { kind: 'git.merge', projectId: project.id, branch: 'sz/x', into: 'main' });
    await relay.flush();
    const note = published.at(-1)!;
    assert.equal(note.url, 'https://ntfy.test');
    assert.deepEqual([note.body.topic, note.body.title, note.body.priority], ['sz-notify-k3', '승인 요청', 4]);
    const actions = note.body.actions as { action: string; label: string; url: string; method: string; body: string }[];
    assert.deepEqual(actions.map((a) => [a.action, a.label, a.url, a.method]), [['http', '승인', 'https://ntfy.test/sz-cmd-k3', 'POST'], ['http', '거절', 'https://ntfy.test/sz-cmd-k3', 'POST']]);
    const approvalId = studio.listApprovals('pending')[0]!.id;
    assert.match(actions[0]!.body, new RegExp(`^a:${approvalId}:y\\.[\\w-]{43}$`));

    // Knowing the topic is not enough: free text, an unsigned command and a tampered one all do nothing.
    await relay.handleCommand('build me a backdoor');
    await relay.handleCommand(`a:${approvalId}:y`);
    await relay.handleCommand(actions[1]!.body.replace(':n.', ':y.'));
    assert.equal(studio.listApprovals('pending').length, 1);

    // A command arriving on the stream, exactly as the phone sends it.
    pushLine(JSON.stringify({ id: 'msg1', event: 'open' }));
    pushLine(JSON.stringify({ id: 'msg2', event: 'message', message: actions[0]!.body }));
    await merge;
    assert.equal(store.listApprovals(undefined)[0]!.resolvedVia, 'ntfy');
    assert.equal(store.kvGet('ntfy.since'), 'msg2', 'the stream position is remembered');

    // A finished task offers merge and rollback, not the buttons that need a typed follow-up.
    store.updateTask('tsk_1', { state: 'succeeded', summary: 'done', branch: 'sz/tsk_1', baseCheckpointId: 'ckp_1' });
    events.emit({ projectId: project.id, taskId: 'tsk_1' }, { type: 'task.state', state: 'succeeded', error: null });
    await relay.flush();
    const done = published.filter((p) => Array.isArray(p.body.actions) && (p.body.actions as unknown[]).length > 0).at(-1)!;
    assert.deepEqual((done.body.actions as { label: string }[]).map((a) => a.label), ['승인 (Merge)', '롤백 (Revert)']);
    assert.throws(() => new NtfyRelay({ server: 'https://ntfy.test', topic: 'same', commandTopic: 'same', token: null, signingKey: new Secret('k'), studio, store, events, log: quietLog }), /must differ/);
  } finally {
    await relay.stop();
    await t.cleanup();
  }
});

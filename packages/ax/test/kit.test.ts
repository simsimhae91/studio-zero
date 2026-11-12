import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentStreamError, EVENT_STREAM_HEADERS, createTelemetry, encodeEvent, readEvents, streamAgent, type AgentEvent, type AxBlock, type TelemetryEvent } from '../src/index.ts';

const choice: AxBlock = { type: 'choice', id: 'plan', question: '어떤 요금제로 할까요?', options: [{ id: 'basic', label: '기본', detail: null }, { id: 'pro', label: '프로', detail: '팀 5명까지' }], recommended: 'pro', confidence: 'medium', allowOther: false };
const sent: AgentEvent[] = [
  { type: 'activity', label: '주문 내역을 확인하는 중' },
  { type: 'text', delta: '지난달 주문은 ' },
  { type: 'text', delta: '42건입니다.\n\n표로 정리했습니다.' },
  { type: 'block', block: choice },
  { type: 'done' },
];

/** A body delivered in chunks of `size` bytes, so messages, UTF-8 sequences and CRLF pairs are all cut somewhere. */
function chunked(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, (at += size)));
    },
  });
}
const collect = async <T>(source: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
};

test('event stream: what the server encodes is what the client reads, however the bytes are cut', async () => {
  const wire = sent.map(encodeEvent).join('');
  assert.match(wire, /^event: activity\ndata: \{"type":"activity"/);
  for (const size of [1, 2, 3, 7, 64, 100_000]) assert.deepEqual(await collect(readEvents(chunked(wire, size))), sent, `chunks of ${size} bytes`);
  // Proxies rewrite line endings and add keep-alive comments; a last message may lack its blank line.
  const messy = `: keep-alive\r\n\r\n${wire.replaceAll('\n', '\r\n')}retry: 1000\r\n\r\nevent: text\r\ndata: {"type":"text","delta":"끝"}`;
  for (const size of [1, 5, 4096]) assert.deepEqual(await collect(readEvents(chunked(messy, size))), [...sent, { type: 'text', delta: '끝' }]);
  assert.throws(() => encodeEvent({ type: 'block', block: { type: 'html', html: '<b>x</b>' } } as never), 'the server cannot send a block outside the vocabulary either');
});

test('event stream: anything outside the contract is reported and never handed to a renderer', async () => {
  const wire = [
    'data: {"type":"block","block":{"type":"html","html":"<img src=x onerror=alert(1)>"}}',
    'data: {"type":"block","block":{"type":"sources","title":"출처","items":[{"title":"x","url":"javascript:alert(1)","quote":""}]}}',
    'data: not json',
    'data: {"type":"text","delta":"안전한 글"}',
  ].join('\n\n');
  const events = await collect(readEvents(chunked(wire, 9)));
  assert.deepEqual(events.map((e) => e.type), ['invalid', 'invalid', 'invalid', 'text']);

  const answer = (status: number, type: string) => async () => new Response('data: {"type":"done"}\n\n', { status, headers: { 'content-type': type } });
  await assert.rejects(collect(streamAgent('/agent', { fetch: answer(500, 'text/event-stream') })), (err: unknown) => err instanceof AgentStreamError && err.code === 'http_500');
  await assert.rejects(collect(streamAgent('/agent', { fetch: answer(200, 'text/html') })), (err: unknown) => err instanceof AgentStreamError && err.code === 'not_a_stream');
  await assert.rejects(collect(streamAgent('/agent', { fetch: async () => Promise.reject(new TypeError('fetch failed')) })), (err: unknown) => err instanceof AgentStreamError && err.code === 'network');
  let request: RequestInit | undefined;
  const ok = await collect(streamAgent('/agent', { body: { question: '안녕' }, fetch: async (_url, init) => ((request = init), new Response(encodeEvent({ type: 'done' }), { headers: EVENT_STREAM_HEADERS })) }));
  assert.deepEqual(ok, [{ type: 'done' }]);
  assert.equal(request!.method, 'POST');
  assert.equal(request!.body, '{"question":"안녕"}');
});

test('telemetry: batched, content-free, and unable to hurt the feature it measures', async () => {
  const posts: { url: string; body: { app: string; session: string; events: (TelemetryEvent & { at: number })[] } }[] = [];
  let fail = 0;
  const telemetry = createTelemetry({
    endpoint: '/ax-telemetry',
    app: 'ledger',
    maxBatch: 3,
    flushMs: 60_000,
    fetch: async (url, init) => {
      posts.push({ url: String(url), body: JSON.parse(String(init!.body)) });
      return new Response(null, { status: fail-- > 0 ? 503 : 204 });
    },
  });
  telemetry.track({ name: 'stream.started' });
  telemetry.track({ name: 'stream.first_output', ms: 310 });
  assert.equal(posts.length, 0, 'below the batch size nothing is sent yet');
  telemetry.track({ name: 'block.answered', block: 'choice', confidence: 'medium', followedRecommendation: false, ms: 5200 });
  await telemetry.flush();
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.url, '/ax-telemetry');
  assert.equal(posts[0]!.body.app, 'ledger');
  assert.match(posts[0]!.body.session, /^[0-9a-f-]{36}$/);
  assert.deepEqual(posts[0]!.body.events.map(({ at, ...event }) => (assert.ok(at > 0), event)), [
    { name: 'stream.started' },
    { name: 'stream.first_output', ms: 310 },
    { name: 'block.answered', block: 'choice', confidence: 'medium', followedRecommendation: false, ms: 5200 },
  ]);

  // A failed batch rides along with the next one once; if that fails too it is dropped.
  fail = 2;
  telemetry.track({ name: 'steer.sent' });
  await telemetry.flush();
  telemetry.track({ name: 'stream.started' });
  await telemetry.flush();
  assert.deepEqual(posts.slice(1).map((p) => p.body.events.map((e) => e.name)), [['steer.sent'], ['steer.sent', 'stream.started']]);
  await telemetry.flush();
  assert.equal(posts.length, 3, 'nothing left to send: the twice-failed batch is gone');
});

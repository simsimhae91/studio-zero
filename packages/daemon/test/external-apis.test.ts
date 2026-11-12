// Outside APIs with keys, for the code a project is made of: the key is connected at the desk and kept in the
// Keychain, the sandbox holds stand-ins, and the gateway swaps them for the real values on the way to the one
// origin the owner named. The provider here is a real HTTP server that answers with what it was sent.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { RpcCallError, RpcClient } from '@studio-zero/protocol';
import { ConflictError } from '../src/app/errors.ts';
import { EXTERNAL_ENV_FILE, envName, externalCredentialId } from '../src/app/ExternalApis.ts';
import { codingSystemPrompt } from '../src/harness/prompts.ts';
import { echoForms } from '../src/llm/LlmGateway.ts';
import { parseApiOrigin } from '../src/policy/PolicyEngine.ts';
import { Secret } from '../src/util/core.ts';
import { testDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
const APP_KEY = 'PSreal-app-key-0123456789';
// A value with characters that have to be escaped differently in JSON, in a query string and in a header.
const APP_SECRET = 'sEcr3t/with+odd="chars"&more\\end';

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A provider that tells the caller exactly what it received, which is the worst case for a key. */
async function echoProvider(): Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const request: Seen = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
      seen.push(request);
      if (request.url.startsWith('/moved')) return void res.writeHead(302, { location: `https://elsewhere.example.org/landing?key=${req.headers.appkey as string}` }).end();
      if (request.url.startsWith('/binary')) return void res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.from([0, 1, 2, 3]));
      res.writeHead(request.url.startsWith('/denied') ? 401 : 200, { 'content-type': 'application/json' }).end(JSON.stringify({ youSent: request, error: `invalid appkey ${String(req.headers.appkey)}` }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, seen, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

test('where an outside API may live: an https origin on a public host, and nothing after it', () => {
  assert.deepEqual(parseApiOrigin(' https://openapi.koreainvestment.com:9443 '), { ok: true, origin: 'https://openapi.koreainvestment.com:9443', host: 'openapi.koreainvestment.com:9443' });
  assert.deepEqual(parseApiOrigin('https://api.cafe24.com/'), { ok: true, origin: 'https://api.cafe24.com', host: 'api.cafe24.com' });
  for (const [origin, reason] of [
    ['http://api.cafe24.com', /only https/],
    ['https://api.cafe24.com/api/v2', /origin only/],
    ['https://api.cafe24.com?x=1', /origin only/],
    ['https://key:value@api.cafe24.com', /embedded credentials/],
    ['https://localhost:8443', /not a public host name/],
    ['https://10.0.0.5', /not a public host name/],
    ['https://host.docker.internal:49200', /not a public host name/],
    ['https://sz-ledger', /not a public host name/],
    ['broker', /not a valid URL/],
  ] as const) {
    const parsed = parseApiOrigin(origin);
    assert.ok(!parsed.ok && reason.test(parsed.reason), `${origin}: ${JSON.stringify(parsed)}`);
  }
  assert.equal(envName('toss-payments', 'SECRET_KEY'), 'TOSS_PAYMENTS_SECRET_KEY');
  assert.match(codingSystemPrompt('web-next'), /Outside APIs\.[\s\S]*the key is not in this sandbox and you never ask for one[\s\S]*\.studio-zero\/external\.env[\s\S]*never from the browser[\s\S]*tell the owner in your final message exactly what to connect/);
});

test('a key connected at the desk reaches its provider through the gateway, and never the sandbox', async () => {
  const provider = await echoProvider();
  const d = await testDaemon({}, { gatewayUpstreams: { external: () => provider.url } });
  await d.daemon.start();
  const { studio, store, events } = d.daemon;
  const gateway = `http://127.0.0.1:${(d.daemon.gateway.app.server.address() as { port: number }).port}`;
  try {
    const project = studio.createProject(OWNER, { name: '나무 주식 도우미', slug: 'namu-stock', template: 'web-next' });
    const other = studio.createProject(OWNER, { name: 'Other', slug: 'other-app', template: 'web-vite-react' });
    await studio.settle();
    assert.ok(!existsSync(join(d.workspace, EXTERNAL_ENV_FILE)), 'nothing is connected yet');

    // --- connecting: the desk only, a public https origin only
    const variables = [{ name: 'APP_KEY', secret: new Secret(APP_KEY) }, { name: 'APP_SECRET', secret: new Secret(APP_SECRET) }];
    await assert.rejects(studio.setExternalApi({ type: 'owner', via: 'telegram' }, { projectId: project.id, name: 'kis', origin: 'https://openapi.koreainvestment.com:9443', variables }), /can only be connected from an authenticated desktop client/);
    await assert.rejects(studio.setExternalApi({ type: 'agent', taskId: 'tsk_x' }, { projectId: project.id, name: 'kis', origin: 'https://openapi.koreainvestment.com:9443', variables }), /denied by policy/);
    await assert.rejects(studio.setExternalApi(OWNER, { projectId: project.id, name: 'kis', origin: 'https://192.168.0.9', variables }), ConflictError);
    await assert.rejects(studio.setExternalApi(OWNER, { projectId: project.id, name: 'kis', origin: 'https://openapi.koreainvestment.com:9443', variables: [{ name: 'APP_KEY', secret: new Secret('pasted with space') }] }), /공백이나 줄바꿈/);
    assert.equal(d.security.items.size, 1, 'a refused connection stored nothing (only the client token is there)');

    const api = await studio.setExternalApi(OWNER, { projectId: project.id, name: 'kis', origin: 'https://openapi.koreainvestment.com:9443', variables });
    assert.deepEqual([api.name, api.origin, api.variables], ['kis', 'https://openapi.koreainvestment.com:9443', ['APP_KEY', 'APP_SECRET']], 'what comes back names the variables, never their values');
    await studio.setExternalApi(OWNER, { projectId: other.id, name: 'kis', origin: 'https://api.other-broker.com', variables: [{ name: 'APP_KEY', secret: new Secret('another-projects-key') }] });
    await studio.setExternalApi(OWNER, { projectId: project.id, name: 'maps', origin: 'https://maps.provider.net', variables: [{ name: 'KEY', secret: new Secret('maps-key-777') }] });
    await studio.settle();

    // --- where the real values are, and where they are not
    assert.equal(Buffer.from(d.security.items.get(`studio-zero|${externalCredentialId(project, 'kis', 'APP_KEY')}`)!.replace(/^sz1:/, ''), 'base64').toString(), APP_KEY);
    assert.ok(studio.vaultList().some((c) => c.id === 'ext/namu-stock/kis/app-secret'), 'listed among the stored credentials by name');
    const standIns = readFileSync(join(d.workspace, EXTERNAL_ENV_FILE), 'utf8');
    assert.match(standIns, /These are not keys\.[\s\S]*\n# kis: calls go to https:\/\/openapi\.koreainvestment\.com:9443\nKIS_BASE_URL=http:\/\/host\.docker\.internal:\d+\/ext\/kis\nKIS_APP_KEY=szs_[\w-]{32}\nKIS_APP_SECRET=szs_[\w-]{32}\n\n# maps: [^\n]+\nMAPS_BASE_URL=[^\n]+\/ext\/maps\nMAPS_KEY=szs_[\w-]{32}\n$/);
    const standIn = (name: string): string => new RegExp(`^${name}=(szs_[\\w-]{32})$`, 'm').exec(standIns)![1]!;
    const [keyIn, secretIn, mapsIn] = [standIn('KIS_APP_KEY'), standIn('KIS_APP_SECRET'), standIn('MAPS_KEY')];
    const everywhere = [standIns, JSON.stringify(store.listExternalApis(project.id)), JSON.stringify(events.history({}, 0, 1000)), (await d.daemon.sandboxes.exec(project, 'git log -p --all | head -c 200000')).stdout].join('\n');
    for (const real of [APP_KEY, APP_SECRET, 'maps-key-777']) assert.ok(!everywhere.includes(real), 'no real value in the workspace, its history, the database or the event stream');
    assert.match((await d.daemon.sandboxes.exec(project, 'git log --format=%s -1')).stdout, /outside API stand-ins/, 'the stand-ins are committed with the workspace');

    // --- a call: stand-ins in the query, two headers and a JSON body; the provider gets the real values, escaped for each place
    const answer = await fetch(`${gateway}/ext/kis/oauth2/tokenP?appkey=${keyIn}&tr=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', appkey: keyIn, appsecret: secretIn, authorization: `Bearer ${keyIn}`, 'x-forwarded-for': '10.9.8.7' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: keyIn, appsecret: secretIn, note: 'standins stay strings' }),
    });
    assert.equal(answer.status, 200);
    const got = provider.seen.at(-1)!;
    assert.deepEqual([got.method, got.url], ['POST', `/oauth2/tokenP?appkey=${encodeURIComponent(APP_KEY)}&tr=1`]);
    assert.deepEqual([got.headers.appkey, got.headers.appsecret, got.headers.authorization], [APP_KEY, APP_SECRET, `Bearer ${APP_KEY}`]);
    assert.deepEqual(JSON.parse(got.body), { grant_type: 'client_credentials', appkey: APP_KEY, appsecret: APP_SECRET, note: 'standins stay strings' }, 'a value with quotes and backslashes is still valid JSON on the other side');
    assert.equal(got.headers['x-forwarded-for'], undefined, 'hop headers are not passed on');
    // ...and the answer, which echoes all of it back, reaches the sandbox with every form of the keys blacked out.
    const echoed = await answer.text();
    assert.ok(!echoed.includes(APP_KEY) && !echoed.includes('sEcr3t') && !echoed.includes(encodeURIComponent(APP_SECRET)), echoed.slice(0, 600));
    assert.match(echoed, /"appkey":"\[redacted\]"[\s\S]*"error":"invalid appkey \[redacted\]"/);
    assert.match(echoed, /\\"appsecret\\":\\"\[redacted\]\\"/, 'also where the provider quoted the raw body inside its own JSON: the value escaped twice');
    assert.deepEqual(echoForms('a/b"c d').slice().sort(), ['a/b"c d', 'a/b\\"c d', 'a/b\\\\\\"c d', 'a\\/b\\"c d', 'a\\\\/b\\\\\\"c d', 'a%2Fb%22c%20d', 'a%2Fb%22c+d', 'a/b&quot;c d'].sort());

    // A form body is escaped as a form; a provider's own error status passes through; bytes pass through untouched.
    const form = await fetch(`${gateway}/ext/kis/denied`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `client_secret=${secretIn}&grant=x` });
    assert.equal(form.status, 401);
    assert.equal(provider.seen.at(-1)!.body, `client_secret=${encodeURIComponent(APP_SECRET)}&grant=x`);
    const bytes = await fetch(`${gateway}/ext/kis/binary`, { headers: { appkey: keyIn } });
    assert.deepEqual([...new Uint8Array(await bytes.arrayBuffer())], [0, 1, 2, 3]);

    // A redirect is handed back, not followed: the key is not walked to another host. Its echo in Location is blacked out too.
    const before = provider.seen.length;
    const moved = await fetch(`${gateway}/ext/kis/moved`, { headers: { appkey: keyIn }, redirect: 'manual' });
    assert.deepEqual([moved.status, moved.headers.get('location'), provider.seen.length - before], [302, 'https://elsewhere.example.org/landing?key=[redacted]', 1]);

    // --- who may call: only a request that carries this API's own stand-ins
    const refused = async (path: string, headers: Record<string, string>): Promise<[number, string]> => {
      const res = await fetch(`${gateway}${path}`, { headers });
      return [res.status, ((await res.json()) as { error: { message: string } }).error.message];
    };
    const sent = provider.seen.length;
    assert.deepEqual(await refused('/ext/kis/quote', {}), [401, 'the request carries no stand-in for a key of this API']);
    assert.deepEqual(await refused('/ext/kis/quote', { appkey: `szs_${'x'.repeat(32)}` }), [401, 'a stand-in in the request does not belong to this API']);
    assert.deepEqual(await refused('/ext/kis/quote', { appkey: mapsIn }), [401, 'a stand-in in the request does not belong to this API'], 'another API\'s stand-in does not open this one');
    assert.deepEqual(await refused('/ext/kis/quote', { appkey: keyIn, other: standInOf(store.listExternalApis(other.id)) }), [401, 'a stand-in in the request does not belong to this API'], 'nor does another project\'s, even beside a good one');
    assert.deepEqual((await refused('/ext/nothing/quote', { appkey: keyIn }))[0], 401);
    assert.equal(provider.seen.length, sent, 'none of those reached the provider');

    // --- the same over the wire: values go in and are never read back
    const rpc = new RpcClient({ url: d.url(), token: d.daemon.clientToken.expose(), client: 'test' });
    try {
      await rpc.connect();
      const listed = await rpc.call('external.list', { projectId: project.id });
      assert.deepEqual(listed.apis.map((a) => [a.name, a.variables]), [['kis', ['APP_KEY', 'APP_SECRET']], ['maps', ['KEY']]]);
      assert.ok(!JSON.stringify(listed).includes(APP_KEY) && !JSON.stringify(listed).includes('szs_'), 'neither keys nor stand-ins are sent to a client');
      await assert.rejects(rpc.call('external.set', { projectId: project.id, name: 'Bad Name', origin: 'https://x.example.org', variables: [{ name: 'KEY', secret: 'v' }] }), (e: unknown) => e instanceof RpcCallError && e.code === 'invalid_params');
      await assert.rejects(rpc.call('external.set', { projectId: project.id, name: 'tosspay', origin: 'https://api.tosspayments.com', variables: [{ name: 'BASE_URL', secret: 'v' }] }), (e: unknown) => e instanceof RpcCallError && e.code === 'conflict');
      assert.deepEqual(await rpc.call('external.remove', { projectId: project.id, name: 'maps' }), { removed: true });
    } finally {
      rpc.close();
    }

    // --- disconnecting: the key leaves the Keychain, its stand-in stops working, the workspace list is brought up to date
    await studio.settle();
    assert.ok(![...d.security.items.keys()].some((k) => k.includes('/maps/')));
    assert.deepEqual((await refused('/ext/maps/geocode', { key: mapsIn }))[0], 401);
    assert.ok(!readFileSync(join(d.workspace, EXTERNAL_ENV_FILE), 'utf8').includes('MAPS_KEY'));
    // Replacing an API's keys gives it new stand-ins; the old ones are dead.
    await studio.setExternalApi(OWNER, { projectId: project.id, name: 'kis', origin: 'https://openapi.koreainvestment.com:9443', variables: [{ name: 'APP_KEY', secret: new Secret('rotated-key') }] });
    assert.deepEqual((await refused('/ext/kis/quote', { appkey: keyIn }))[0], 401);
    assert.ok(![...d.security.items.keys()].some((k) => k.endsWith('/kis/app-secret')), 'a variable that was dropped is deleted from the Keychain');

    // Deleting a project takes its keys with it.
    await studio.removeExternalApi(OWNER, project.id, 'kis');
    await studio.settle();
    assert.ok(!existsSync(join(d.workspace, EXTERNAL_ENV_FILE)), 'with nothing connected the list is removed');
    await studio.deleteProject(OWNER, other.id, true);
    assert.deepEqual([...d.security.items.keys()].filter((k) => k.includes('|ext/')), []);
  } finally {
    await d.cleanup();
    await provider.close();
  }
});

function standInOf(apis: { variables: { placeholder: string }[] }[]): string {
  return apis[0]!.variables[0]!.placeholder;
}

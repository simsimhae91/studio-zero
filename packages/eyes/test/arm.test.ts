// The arms: services a product's server calls with a key of the owner's, each in a file of the catalogue that
// builders and the tool read. `need` guides the owner to put in a key that is missing; `check` proves a key works
// with the smallest real call. The catalogue is a folder of the test's own, the vault is a map of made-up keys
// (the owner's Keychain is never read), and every service is a node:http server on this machine.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ARMS_DIR, ArmError, armCommand, readCatalogue } from '../src/arms.ts';
import { LOGIN_VAULT_IDS } from '../src/login.ts';
import type { SecretStore } from '../src/secrets.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(HERE, '../src/cli.ts');
const RUNNER = join(HERE, 'fixtures/arm-with-vault.ts');

// Made-up keys, long and odd enough that finding one in what was printed can only mean it was printed. The
// portal's has the characters that have to be encoded in an address.
const DATA_KEY = 'Qk7vR2+mZp9/Xw4LtN8sYb3Uc6Hd1Jf5Ae0Gi2Ko4Mq==';
const ANTHROPIC_KEY = 'sk-ant-made-up-Vb83nQz1Lx5Wc7Rt0Py4';
const OPENAI_KEY = 'sk-proj-made-up-Hd62kTs9Mv3Ng8Bq1Zr7';

/** One arm's file, as the catalogue holds it. */
const armFile = (a: { name: string; does?: string; check?: string; keys: { id?: string; env: string; without?: string; title?: string }[]; steps?: string }): string =>
  [
    '---',
    `name: ${a.name}`,
    `does: ${a.does ?? `does the ${a.name} job for a product`}`,
    `check: ${a.check ?? 'one call of a few tokens'}`,
    'keys:',
    ...a.keys.flatMap((k) => [...(k.id ? [`  - id: ${k.id}`, `    env: ${k.env}`] : [`  - env: ${k.env}`]), '    what: a key of the owner\'s', `    without: ${k.without ?? 'stops'}`, '    costs: billed per call']),
    '---',
    '',
    `# ${a.name}`,
    '',
    'For whoever builds a product.',
    '',
    '## 주인이 할 일',
    '',
    a.steps ?? a.keys.map((k) => `### ${k.title ?? 'key'} (\`${k.id}\`)\n\n1. 사이트에 들어가 키를 만듭니다.\n2. 키를 복사합니다.\n3. 저장합니다: \`! pbpaste | sz-eyes secret set ${k.id}\`\n`).join('\n'),
  ].join('\n');

const PUBLIC_DATA = armFile({ name: 'public-data', check: 'one call to the price service, one row; free', keys: [{ id: 'data/data-go-kr/service-key', env: 'DATA_GO_KR_SERVICE_KEY', title: '공공데이터포털 인증키' }] });
const READ = armFile({ name: 'read', keys: [{ id: 'model/anthropic/api-key', env: 'ANTHROPIC_API_KEY', without: 'another', title: 'Anthropic' }, { id: 'model/openai/api-key', env: 'OPENAI_API_KEY', without: 'another', title: 'OpenAI' }] });
const LOGIN = armFile({ name: 'login-kakao', check: 'none: shown by signing in on a product', keys: [{ id: 'login/kakao/client-id', env: 'KAKAO_CLIENT_ID' }, { id: 'login/kakao/client-secret', env: 'KAKAO_CLIENT_SECRET' }] });

/** A catalogue of the test's own. */
const catalogue = (files: Record<string, string>): { dir: string; done: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'arms-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
};

/**
 * `sz-eyes arm ...` in a process of its own, as cli.ts runs it, with this vault in place of the Keychain: its exit
 * code and everything it wrote to stdout and to stderr. Not waited on synchronously, so that a test's server
 * answers it meanwhile.
 */
const arm = (args: string[], deps: { dir: string; vault: Record<string, string>; env?: Record<string, string> }): Promise<{ code: number; out: string; err: string }> =>
  new Promise((done) => {
    const child = spawn(process.execPath, [RUNNER, ...args], { env: { ...process.env, SZ_ARMS_DIR: deps.dir, SZ_TEST_VAULT: JSON.stringify(deps.vault), ...deps.env } });
    let [out, err] = ['', ''];
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.once('close', (code) => done({ code: code ?? -1, out, err }));
  });

test('armCommand keeps to the vault it is given and refuses an unknown command with the usage', async () => {
  const c = catalogue({ 'public-data.md': PUBLIC_DATA });
  try {
    const seen: string[] = [];
    const store: SecretStore = { get: async (id) => (seen.push(id), null), set: async () => undefined };
    const listed = await armCommand('list', [], { store, env: { SZ_ARMS_DIR: c.dir } });
    assert.equal(listed.code, 0);
    assert.deepEqual(seen, ['data/data-go-kr/service-key']);
    await assert.rejects(armCommand('frob', [], { store, env: { SZ_ARMS_DIR: c.dir } }), (err: Error) => err instanceof ArmError && /sz-eyes arm list/.test(err.message));
  } finally {
    c.done();
  }
});

const serve = async (handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<{ server: Server; url: string; asked: { path: string; auth: string; body: string }[] }> => {
  const asked: { path: string; auth: string; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      asked.push({ path: req.url ?? '', auth: String(req.headers['x-api-key'] ?? req.headers.authorization ?? ''), body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`, asked };
};

/** Nothing of a key reaches what is printed: not the key, not its encoded form, not its end. */
const keptOut = (said: { out: string; err: string }, ...keys: string[]): void => {
  for (const key of keys)
    for (const form of [key, encodeURIComponent(key), key.slice(-6)]) {
      assert.equal(said.out.includes(form), false, `stdout holds ${form === key ? 'the key' : `a form of the key (${form.length} chars)`}`);
      assert.equal(said.err.includes(form), false, `stderr holds ${form === key ? 'the key' : `a form of the key (${form.length} chars)`}`);
    }
};

test('list: each arm in a line, with which of its keys the vault holds', async () => {
  const c = catalogue({ 'public-data.md': PUBLIC_DATA, 'read.md': READ, 'login-kakao.md': LOGIN });
  try {
    const said = await arm(['list'], { dir: c.dir, vault: { 'model/openai/api-key': OPENAI_KEY, 'login/kakao/client-id': 'kakao-id-1234' } });
    assert.equal(said.code, 0);
    const lines = said.out.split('\n').filter((line) => /^\s+(login-kakao|public-data|read)\b/.test(line));
    assert.equal(lines.length, 3, said.out);
    const of = (name: string): string => lines.find((line) => line.trim().startsWith(name))!;
    assert.match(of('public-data'), /data\/data-go-kr\/service-key missing/);
    assert.match(of('public-data'), /needs a key/);
    assert.match(of('read'), /model\/anthropic\/api-key missing, model\/openai\/api-key held/);
    assert.match(of('read'), /ready/, 'one of its two keys is enough');
    assert.match(of('login-kakao'), /login\/kakao\/client-id held, login\/kakao\/client-secret missing/);
    const json = JSON.parse((await arm(['list', '--json'], { dir: c.dir, vault: {} })).out) as { arms: { name: string; ready: boolean; keys: { id: string; held: boolean }[] }[] };
    assert.deepEqual(json.arms.map((a) => [a.name, a.ready, a.keys.map((k) => k.held)]), [['login-kakao', false, [false, false]], ['public-data', false, [false]], ['read', false, [false, false]]]);
    keptOut(said, OPENAI_KEY);
  } finally {
    c.done();
  }
});

test('need: a missing key gets the owner\'s steps from the arm\'s file, the exact line that stores it and what to run next, and exits 1', async () => {
  const c = catalogue({ 'public-data.md': PUBLIC_DATA, 'read.md': READ, 'login-kakao.md': LOGIN });
  try {
    const said = await arm(['need', 'public-data', 'read'], { dir: c.dir, vault: {} });
    assert.equal(said.code, 1, 'a workflow stops on it');
    assert.match(said.out, /1\. 사이트에 들어가 키를 만듭니다\./, 'the steps as the file has them');
    assert.match(said.out, /! pbpaste \| \S*\/plugin\/bin\/sz-eyes secret set data\/data-go-kr\/service-key/);
    assert.match(said.out, /sz-eyes arm check public-data/);
    assert.match(said.out, /! pbpaste \| \S*\/plugin\/bin\/sz-eyes secret set model\/anthropic\/api-key/);
    assert.match(said.out, /! pbpaste \| \S*\/plugin\/bin\/sz-eyes secret set model\/openai\/api-key/);
    assert.match(said.out, /one is enough/, 'either provider\'s key will do');
    assert.match(said.out, /sz-eyes arm check read/);

    // Only what is missing: the half of a pair that is there is not asked for again.
    const half = await arm(['need', 'login-kakao'], { dir: c.dir, vault: { 'login/kakao/client-id': 'kakao-id-1234' } });
    assert.equal(half.code, 1);
    assert.match(half.out, /! pbpaste \| \S*\/plugin\/bin\/sz-eyes secret set login\/kakao\/client-secret/);
    assert.doesNotMatch(half.out.split('Store')[1] ?? '', /secret set login\/kakao\/client-id\b/, 'the key that is there is not among the lines to run');
    assert.match(half.out, /shown by signing in on a product/, 'an arm with no call to check it says how it is shown instead');

    const json = JSON.parse((await arm(['need', 'public-data', '--json'], { dir: c.dir, vault: {} })).out) as { ready: boolean; arms: { name: string; missing: string[] }[] };
    assert.deepEqual([json.ready, json.arms.map((a) => [a.name, a.missing])], [false, [['public-data', ['data/data-go-kr/service-key']]]]);
  } finally {
    c.done();
  }
});

test('need: with every key there, one line and exit 0; one key of a pair of providers is enough', async () => {
  const c = catalogue({ 'public-data.md': PUBLIC_DATA, 'read.md': READ });
  try {
    const said = await arm(['need', 'public-data', 'read'], { dir: c.dir, vault: { 'data/data-go-kr/service-key': DATA_KEY, 'model/openai/api-key': OPENAI_KEY } });
    assert.equal(said.code, 0);
    assert.equal(said.out.trim().split('\n').length, 1, said.out);
    assert.match(said.out, /every key is in the vault for public-data and read/);
    keptOut(said, DATA_KEY, OPENAI_KEY);
  } finally {
    c.done();
  }
});

test('need and check of an arm that is not in the catalogue name the arms there are', async () => {
  const c = catalogue({ 'public-data.md': PUBLIC_DATA, 'read.md': READ });
  try {
    for (const command of ['need', 'check']) {
      const said = await arm([command, 'payments'], { dir: c.dir, vault: {} });
      assert.equal(said.code, 1);
      assert.match(said.err, /no arm named "payments"/);
      assert.match(said.err, /public-data, read/);
    }
    // The same through the command line itself, which reads the vault for nothing here.
    const ran = spawnSync(process.execPath, [CLI, 'arm', 'need', 'payments'], { encoding: 'utf8', env: { ...process.env, SZ_ARMS_DIR: c.dir } });
    assert.equal(ran.status, 1, ran.stderr);
    assert.match(ran.stderr, /no arm named "payments".*public-data, read/s);
  } finally {
    c.done();
  }
});

test('a catalogue file with a key that has no vault id is refused, with the file\'s name', async () => {
  const c = catalogue({ 'public-data.md': PUBLIC_DATA, 'broken.md': armFile({ name: 'broken', keys: [{ env: 'BROKEN_KEY' }], steps: '### key\n\n1. 복사합니다.\n' }) });
  try {
    assert.throws(() => readCatalogue(c.dir), (err: Error) => err instanceof ArmError && /broken\.md/.test(err.message) && /vault id/.test(err.message));
    const said = await arm(['list'], { dir: c.dir, vault: {} });
    assert.equal(said.code, 1);
    assert.match(said.err, /broken\.md: .*vault id/);
  } finally {
    c.done();
  }
  // And the other ways a file can be wrong: each named with its file.
  const wrong: [string, string, RegExp][] = [
    ['named.md', armFile({ name: 'other', keys: [{ id: 'a/b/c', env: 'A_B' }] }), /named\.md: .*name/],
    ['nosteps.md', armFile({ name: 'nosteps', keys: [{ id: 'a/b/c', env: 'A_B' }], steps: 'nothing here' }), /nosteps\.md: a\/b\/c has no steps for the owner/],
    ['noline.md', armFile({ name: 'noline', keys: [{ id: 'a/b/c', env: 'A_B' }], steps: '### key (`a/b/c`)\n\n1. 복사합니다.\n' }), /noline\.md: .*pbpaste \| sz-eyes secret set a\/b\/c/],
    ['lone.md', armFile({ name: 'lone', keys: [{ id: 'a/b/c', env: 'A_B', without: 'another' }] }), /lone\.md: .*another/],
    ['env.md', armFile({ name: 'env', keys: [{ id: 'a/b/c', env: 'lower-case' }] }), /env\.md: .*lower-case/],
  ];
  for (const [file, text, says] of wrong) {
    const d = catalogue({ [file]: text });
    try {
      assert.throws(() => readCatalogue(d.dir), (err: Error) => err instanceof ArmError && says.test(err.message), file);
    } finally {
      d.done();
    }
  }
});

test('check public-data: a portal that takes the key says it works; one that refuses gives its own reason; the key is printed nowhere', async () => {
  const portal = await serve((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    res.setHeader('content-type', 'text/xml;charset=UTF-8');
    // The key is sent decoded once from what the vault holds, and encoded once in the address.
    if (url.pathname === '/B551182/nonPaymentDamtInfoService/getNonPaymentItemCodeList2' && url.searchParams.get('ServiceKey') === DATA_KEY && url.searchParams.get('numOfRows') === '1') {
      res.end('<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items><item><npayCd>ABZ010001</npayCd></item></items><numOfRows>1</numOfRows><pageNo>1</pageNo><totalCount>812</totalCount></body></response>');
      return;
    }
    // A refusal that echoes what it was sent, as a careless gateway might.
    const sent = url.searchParams.get('ServiceKey') ?? '';
    res.end(`<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR for ${sent} (${encodeURIComponent(sent)})</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`);
  });
  const c = catalogue({ 'public-data.md': PUBLIC_DATA });
  try {
    const env = { SZ_ARM_PUBLIC_DATA_URL: portal.url };
    for (const held of [DATA_KEY, encodeURIComponent(DATA_KEY)]) {
      const works = await arm(['check', 'public-data'], { dir: c.dir, vault: { 'data/data-go-kr/service-key': held }, env });
      assert.equal(works.code, 0, works.out + works.err);
      assert.match(works.out, /works/);
      assert.match(works.out, /getNonPaymentItemCodeList2/);
      assert.match(works.out, /812/);
      assert.match(works.out, /free/i);
      keptOut(works, DATA_KEY);
    }
    const refused = await arm(['check', 'public-data'], { dir: c.dir, vault: { 'data/data-go-kr/service-key': 'Wr0ngKey+Zz9/Yy8Xx7Ww6Vv5Uu4==' }, env });
    assert.equal(refused.code, 1);
    assert.match(refused.out, /does not work/);
    assert.match(refused.out, /SERVICE_KEY_IS_NOT_REGISTERED_ERROR \(30\)/);
    assert.match(refused.out, /15001700/, 'where to apply for the API');
    keptOut(refused, 'Wr0ngKey+Zz9/Yy8Xx7Ww6Vv5Uu4==');
    const missing = await arm(['check', 'public-data'], { dir: c.dir, vault: {}, env });
    assert.equal(missing.code, 1);
    assert.match(missing.out, /not in the vault: data\/data-go-kr\/service-key.*sz-eyes arm need public-data/s);
  } finally {
    portal.server.close();
    c.done();
  }
});

test('check read: the first provider whose key is there is the one called; it works or says the provider\'s reason, and the key is printed nowhere', async () => {
  const provider = await serve((req, res, body) => {
    res.setHeader('content-type', 'application/json');
    const asked = JSON.parse(body || '{}') as { max_tokens?: number; max_output_tokens?: number };
    if (req.url === '/v1/messages') {
      if (req.headers['x-api-key'] === ANTHROPIC_KEY && req.headers['anthropic-version'] && (asked.max_tokens ?? 999) <= 32) {
        res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 2 } }));
        return;
      }
      res.statusCode = 401;
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${String(req.headers['x-api-key'])}` }, request_id: 'req_1' }));
      return;
    }
    if (req.url === '/v1/responses') {
      if (req.headers.authorization === `Bearer ${OPENAI_KEY}` && (asked.max_output_tokens ?? 999) <= 32) {
        res.end(JSON.stringify({ id: 'resp_1', object: 'response', model: 'gpt-6.1-terra', status: 'completed', output: [], usage: { input_tokens: 11, output_tokens: 5, total_tokens: 16 } }));
        return;
      }
      const sent = String(req.headers.authorization).replace('Bearer ', '');
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${sent.slice(0, 8)}********${sent.slice(-4)}. You can find your API key at the dashboard.`, type: 'invalid_request_error', param: null, code: 'invalid_api_key' } }));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  const c = catalogue({ 'read.md': READ });
  try {
    const env = { SZ_ARM_READ_URL: provider.url };
    const both = await arm(['check', 'read'], { dir: c.dir, vault: { 'model/anthropic/api-key': ANTHROPIC_KEY, 'model/openai/api-key': OPENAI_KEY }, env });
    assert.equal(both.code, 0, both.out + both.err);
    assert.match(both.out, /works/);
    assert.match(both.out, /model\/anthropic\/api-key/);
    assert.match(both.out, /\$0\.0000/, 'about what it cost');
    assert.deepEqual(provider.asked.map((a) => a.path), ['/v1/messages'], 'only the first provider is called');

    const openai = await arm(['check', 'read'], { dir: c.dir, vault: { 'model/openai/api-key': OPENAI_KEY }, env });
    assert.equal(openai.code, 0, openai.out + openai.err);
    assert.match(openai.out, /model\/openai\/api-key/);
    assert.equal(provider.asked.at(-1)!.path, '/v1/responses');

    const wrongAnthropic = await arm(['check', 'read'], { dir: c.dir, vault: { 'model/anthropic/api-key': 'sk-ant-wrong-Qa1Ws2Ed3Rf4Tg5Yh6' }, env });
    assert.equal(wrongAnthropic.code, 1);
    assert.match(wrongAnthropic.out, /does not work/);
    assert.match(wrongAnthropic.out, /401 authentication_error: invalid x-api-key/);
    keptOut(wrongAnthropic, 'sk-ant-wrong-Qa1Ws2Ed3Rf4Tg5Yh6');

    const wrongOpenai = await arm(['check', 'read'], { dir: c.dir, vault: { 'model/openai/api-key': 'sk-proj-wrong-Uj7Ik8Ol9Pz0Xc1Vb2' }, env });
    assert.equal(wrongOpenai.code, 1);
    assert.match(wrongOpenai.out, /Incorrect API key provided/);
    assert.match(wrongOpenai.out, /invalid_api_key/);
    keptOut(wrongOpenai, 'sk-proj-wrong-Uj7Ik8Ol9Pz0Xc1Vb2');

    for (const said of [both, openai]) keptOut(said, ANTHROPIC_KEY, OPENAI_KEY);
    for (const call of provider.asked) assert.equal(call.body.includes('sk-'), false, 'a key goes in a header, never in the body');
  } finally {
    provider.server.close();
    c.done();
  }
});

test('check of an arm the tool has no call for says how it is shown instead, and exits 1', async () => {
  const c = catalogue({ 'login-kakao.md': LOGIN });
  try {
    const said = await arm(['check', 'login-kakao'], { dir: c.dir, vault: { 'login/kakao/client-id': 'kakao-id-1234', 'login/kakao/client-secret': 'kakao-secret-Zq81xVw0pLm3' } });
    assert.equal(said.code, 1);
    assert.match(said.out, /shown by signing in on a product/);
    keptOut(said, 'kakao-secret-Zq81xVw0pLm3');
  } finally {
    c.done();
  }
});

test('the four arms of the catalogue are read by the same code, with the vault ids sign-in already uses', () => {
  const arms = readCatalogue(ARMS_DIR);
  assert.deepEqual(arms.map((a) => a.name), ['login-google', 'login-kakao', 'public-data', 'read']);
  const ids = (name: string): string[] => arms.find((a) => a.name === name)!.keys.map((k) => k.id);
  assert.deepEqual(ids('login-kakao'), [LOGIN_VAULT_IDS.kakao.clientId, LOGIN_VAULT_IDS.kakao.secret]);
  assert.deepEqual(ids('login-google'), [LOGIN_VAULT_IDS.google.clientId, LOGIN_VAULT_IDS.google.secret]);
  assert.deepEqual(ids('read'), ['model/anthropic/api-key', 'model/openai/api-key']);
  assert.deepEqual(ids('public-data'), ['data/data-go-kr/service-key']);
  for (const a of arms) for (const k of a.keys) assert.ok(a.steps.some((s) => s.ids.includes(k.id) && s.text.includes(`! pbpaste | sz-eyes secret set ${k.id}`)), `${a.name}: ${k.id}`);
});

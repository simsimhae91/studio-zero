// Signing in with a provider, pressed as far as the provider's door: a real browser, a small product, and a
// backend that answers the one request the press makes.
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { chromium, devices } from 'playwright-core';
import { walkLogins } from '../src/qa/LoginWalk.ts';

const listen = async (server: Server): Promise<string> => {
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

/**
 * A product whose provider buttons are one press from its first screen, as a welcome screen has them. `how`
 * is what a build can get wrong while looking the same.
 */
const product = (api: string, how: 'right' | 'dead' | 'elsewhere' | 'unnamed' | 'other' | 'none'): string => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>장부</title>
<style>button{font:inherit;min-height:48px;padding:0 16px} #entry{display:none} #entry.open{display:block}</style></head><body>
<h1>모임 장부</h1>
<button id="lead" data-step="sign-in:1">로그인</button>
<div id="entry">
  <input type="email" data-step="sign-in:2"><input type="password" data-step="sign-in:3">
  ${how === 'none' ? '' : `<button id="kakao" data-login="${how === 'other' ? 'naver' : 'kakao'}">카카오로</button><button id="google" data-login="google">Google로</button>`}
</div>
<script>
document.getElementById('lead').addEventListener('click', () => document.getElementById('entry').classList.add('open'));
const leave = (provider) => {
  const back = ${how === 'elsewhere' ? "'http://localhost:3000'" : how === 'unnamed' ? 'null' : 'location.origin'};
  location.assign('${api}/auth/v1/authorize?provider=' + provider + (back ? '&redirect_to=' + encodeURIComponent(back) : ''));
};
${how === 'dead' ? '' : "for (const id of ['kakao', 'google']) document.getElementById(id)?.addEventListener('click', () => leave(id));"}
</script></body></html>`;

test('a provider button is pressed as far as the provider: what the product asks of its backend is read, and the browser goes no further', async (t) => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 15_000 }).catch(() => null);
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  // The backend's one answer: off to the provider, for a provider it has switched on.
  const asked: string[] = [];
  const backend = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://backend');
    asked.push(`${url.pathname}?${url.searchParams.get('provider')}`);
    const provider = url.searchParams.get('provider');
    if (provider === 'kakao') return res.writeHead(302, { location: 'https://kauth.kakao.com/oauth/authorize?client_id=test&state=1' }).end();
    if (provider === 'google') return res.writeHead(302, { location: 'http://127.0.0.1:9/elsewhere' }).end();
    res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 400, msg: 'Unsupported provider: provider is not enabled' }));
  });
  const api = await listen(backend);
  let how: Parameters<typeof product>[1] = 'right';
  const app = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(product(api, how)));
  const base = await listen(app);
  const walk = (as: typeof how, on: string[], phone = false) => {
    how = as;
    return walkLogins({ browser, base, phone: phone ? devices['iPhone 15 Pro']! : null, apiOrigin: api, on });
  };
  try {
    // ---- a product that has it right, at a desk and under a thumb
    const right = await walk('right', ['kakao']);
    assert.deepEqual(right.offered, ['kakao', 'google'], 'the buttons were found one press of the sign-in mark away');
    assert.equal(right.problems.length, 1, right.problems.join('\n'));
    assert.match(right.problems[0]!, /^The sign-in screen has a button marked data-login="google", and the studio has not set that provider up on this Mac \(set up: kakao\)\. Show a button for each provider in the kit's "logins" and for no other\.$/);
    assert.deepEqual(asked, ['/auth/v1/authorize?kakao'], 'only the provider that is set up was pressed');
    assert.deepEqual((await walk('right', ['kakao'], true)).problems.length, 1, 'the same under a thumb');

    // ---- the backend sends the person somewhere that is not the provider
    const both = await walk('right', ['kakao', 'google']);
    assert.equal(both.problems.length, 1, both.problems.join('\n'));
    assert.match(both.problems[0]!, /^Signing in with google: the backend answered 302 and did not send the person to accounts\.google\.com \(it sent them to http:\/\/127\.0\.0\.1:9\/elsewhere\)\.$/);

    // ---- a button that does nothing
    const dead = await walk('dead', ['kakao', 'google']);
    assert.equal(dead.problems.length, 2);
    assert.match(dead.problems[0]!, /^Signing in with kakao: the button marked data-login="kakao" was pressed and the backend was not asked to start a sign-in \(no request to \/auth\/v1\/authorize\)\. The press calls supabase\.auth\.signInWithOAuth\(\{ provider: 'kakao', options: \{ redirectTo: window\.location\.origin \} \}\)\.$/);

    // ---- a person sent back to an address that is not where the product is
    const elsewhere = await walk('elsewhere', ['kakao']);
    assert.match(elsewhere.problems[0]!, new RegExp(`^Signing in with kakao: the person is to come back to "http://localhost:3000", and the product is being served at ${base}\\. A person who signs in there lands somewhere else\\.`));
    const unnamed = await walk('unnamed', ['kakao']);
    assert.match(unnamed.problems[0]!, /the person is to come back to no address \(redirectTo was not given\)/);

    // ---- a provider nobody set up, by any name
    const other = await walk('other', ['kakao', 'google']);
    assert.deepEqual(other.offered, ['naver', 'google']);
    assert.match(other.problems[0]!, /^The sign-in screen has a button marked data-login="naver", and the studio has not set that provider up on this Mac \(set up: kakao, google\)\./);
    const refused = await walk('right', []);
    assert.equal(refused.problems.length, 2, 'with nothing set up, every button is one too many');
    assert.match(refused.problems[0]!, /\(set up: none\)/);

    // ---- a product with email only is left alone
    assert.deepEqual(await walk('none', ['kakao', 'google']), { offered: [], problems: [] });
  } finally {
    await browser.close();
    backend.close();
    app.close();
  }
});

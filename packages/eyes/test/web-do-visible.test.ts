// `sz-eyes web do` on a page that holds more than it shows. A clickable prototype keeps all its screens in one
// file and shows one at a time; a designer agent could not press through its own with `tap:`, because the words
// were found first in a screen that was not shown, and fell back to hand-written `expect:` steps. A person presses
// and reads only what is shown, and so does every step that finds something by its words, its label or its field.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { after, before, test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright-core';
import { SandboxError, closeBrowser, openBrowser, walkWeb, type Walk } from '../src/web.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '../src/cli.ts');

// Three screens shown one at a time by the hash, each with a "다음" that leads to the next (the last back to the
// first). The first two have a field of the same name; only the last has a "메모" field and the words
// "마지막 화면". A closed dialog, first on the page, holds "다음" too.
const PROTOTYPE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>시안</title>
<style>
body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#111;background:#fff}
section{display:none;padding:24px}
section.on{display:block}
label{display:block;margin:12px 0}
button{min-height:44px;padding:8px 16px;font:inherit}
</style></head><body>
<dialog id="ask"><p>다음 화면으로 넘어갈까요?</p><button onclick="window.pressed='dialog'">다음</button></dialog>
<section data-screen="1"><h1>첫 화면</h1><label>이름 <input name="name"></label><button onclick="go(2)">다음</button></section>
<section data-screen="2"><h1>둘째 화면</h1><label>이름 <input name="name"></label><button onclick="go(3)">다음</button></section>
<section data-screen="3"><h1>마지막 화면</h1><label>메모 <input name="memo"></label><button onclick="go(1)">다음</button></section>
<script>
function go(n){location.hash='s'+n}
function show(){const want=location.hash.slice(2)||'1';for(const s of document.querySelectorAll('section'))s.classList.toggle('on',s.dataset.screen===want)}
addEventListener('hashchange',show);show();
</script></body></html>`;

// A page that shows everything it holds.
const PLAIN = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>주문</title></head><body>
<h1>주문</h1><p id="state">아직</p>
<label>이름 <input id="name"></label>
<button onclick="document.querySelector('#state').textContent='다음 단계';document.querySelector('#bye').remove()">다음</button>
<p id="bye">곧 사라질 말</p>
</body></html>`;

// Each way a page keeps something from being shown, around the same three things: words, a button and a field.
// The same button and field follow, shown.
const INSIDE = `<p>숨은 말</p><button onclick="window.pressed='hidden'">누르기</button><label>메모 <input id="h"></label>`;
const KINDS: Record<string, string> = {
  'display: none': `<div style="display:none">${INSIDE}</div>`,
  'visibility: hidden': `<div style="visibility:hidden">${INSIDE}</div>`,
  'a closed dialog': `<dialog>${INSIDE}</dialog>`,
  'a closed details': `<details><summary>더 보기</summary>${INSIDE}</details>`,
  'the hidden attribute': `<div hidden>${INSIDE}</div>`,
  'zero size': `<style>.zero,.zero *{display:block;width:0;height:0;min-width:0;min-height:0;padding:0;margin:0;border:0;overflow:hidden}</style><div class="zero">${INSIDE}</div>`,
};
const kindPage = (name: string): string =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${name}</title></head><body>${KINDS[name]}<main><button onclick="window.pressed='shown'">누르기</button><label>메모 <input id="s"></label></main></body></html>`;

// Drawn, and kept from a screen reader only: a number counted up beside the same number said once, and words
// behind a mark that is not for the eye.
const READ_ALOUD = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>읽어 주는 말</title></head><body>
<p><span aria-hidden="true">32% 비싸요</span></p><div aria-hidden="true"><p>뒤에 깔린 화면</p></div>
</body></html>`;

let base = '';
const server = createServer((req, res) => {
  const send = (r: ServerResponse, body: string): void => void r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://here').pathname);
  if (path === '/prototype') send(res, PROTOTYPE);
  else if (path === '/plain') send(res, PLAIN);
  else if (path === '/read-aloud') send(res, READ_ALOUD);
  else if (path.startsWith('/kind/') && path.slice(6) in KINDS) send(res, kindPage(path.slice(6)));
  else res.writeHead(404).end();
});

let browser: Browser | null = null;
/** Why no browser could be started for these tests, when none could: they are skipped, and say so. */
let noBrowser: string | null = null;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  browser = await openBrowser().catch((err: unknown) => {
    if (err instanceof SandboxError) noBrowser = "the session's command sandbox stopped the browser: run the suite outside it";
    else if (/Chromium distribution 'chrome' is not found|Executable doesn't exist/.test(String(err))) noBrowser = 'no Chrome on this machine';
    else throw err;
    return null;
  });
});
after(async () => {
  if (browser) await closeBrowser(browser);
  server.close();
});

/** A walk in the browser these tests share; a step that cannot be done is given a second and a half. */
const walk = (path: string, steps: string[], patience = 10_000): Promise<Walk> => walkWeb(`${base}${path}`, steps, { browser: browser!, stepTimeoutMs: patience });
const whys = (w: Walk): string => w.steps.map((s) => `${s.step}: ${s.why ?? 'ok'}`).join('\n');
const skipped = (t: TestContext): boolean => (noBrowser ? (t.skip(noBrowser), true) : false);

const ONLY_HIDDEN = /found only where nothing is shown/;
const SCREEN = 'document.querySelector("section.on").dataset.screen';

/** `sz-eyes web do` in a process of its own, not waited on: the test's own server has to keep answering it. */
const webDo = (url: string, steps: string[]): Promise<{ code: number | null; out: string; err: string }> =>
  new Promise((done, fail) => {
    const child = spawn(process.execPath, [CLI, 'web', 'do', url, ...steps.flatMap((step) => ['--step', step]), '--json']);
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (out += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (err += chunk));
    child.on('error', fail);
    child.on('close', (code) => done({ code, out, err }));
  });

test('tap:다음 three times walks a prototype through its three screens in order, though every screen and a closed dialog hold the same words', async (t) => {
  const run = await webDo(`${base}/prototype`, [`read:start=${SCREEN}`, 'tap:다음', `read:after1=${SCREEN}`, 'tap:다음', `read:after2=${SCREEN}`, 'tap:다음', `read:after3=${SCREEN}`, 'expect:window.pressed === undefined']);
  if (run.code === 3) return t.skip("the session's command sandbox stopped the browser: run the suite outside it");
  if (/Chromium distribution 'chrome' is not found|Executable doesn't exist/.test(run.err)) return t.skip('no Chrome on this machine');
  const walked = JSON.parse(run.out) as Walk;
  assert.equal(run.code, 0, whys(walked));
  assert.deepEqual(walked.reads, { start: '1', after1: '2', after2: '3', after3: '1' });
});

test('words that sit only in a screen not shown are not on screen: see stops and says where they were found, gone passes, and tap, wait and type stop the same way', async (t) => {
  if (skipped(t)) return;
  const stopping = ['tap:마지막 화면', 'wait:마지막 화면', 'type:메모=적은 말'];
  const [see, gone, waited, shown, reached, ...stopped] = await Promise.all([
    walk('/prototype', ['see:마지막 화면']),
    walk('/prototype', ['gone:마지막 화면'], 1_500),
    // Words shown on this screen are waited for, though a closed dialog and other screens hold them earlier on
    // the page; and they are not gone while they are shown.
    walk('/prototype', ['wait:다음', 'tap:다음', 'wait:다음', 'see:둘째 화면'], 1_500),
    walk('/prototype#s2', ['gone:다음'], 1_500),
    // Once the screen that shows them is reached, what was only in a hidden screen is there.
    walk('/prototype', ['tap:다음', 'tap:다음', 'see:마지막 화면', 'type:메모=적은 말', 'read:memo=document.querySelector("input[name=memo]").value']),
    ...stopping.map((step) => walk('/prototype', [step], 1_500)),
  ]);
  assert.equal(see!.passed, false);
  assert.match(see!.steps[0]!.why ?? '', /"마지막 화면" is not on screen/);
  assert.match(see!.steps[0]!.why ?? '', ONLY_HIDDEN);
  assert.equal(gone!.passed, true, whys(gone!));
  stopping.forEach((step, i) => {
    assert.equal(stopped[i]!.passed, false, step);
    assert.match(stopped[i]!.steps[0]!.why ?? '', ONLY_HIDDEN, step);
  });
  assert.match(stopped[2]!.steps[0]!.why ?? '', /^the field "메모" is not on screen/);
  assert.equal(waited!.passed, true, whys(waited!));
  assert.equal(shown!.passed, false, 'the words are shown on the second screen');
  assert.doesNotMatch(shown!.steps[0]!.why ?? '', ONLY_HIDDEN);
  assert.equal(reached!.passed, true, whys(reached!));
  assert.equal(reached!.reads.memo, '적은 말');
});

test('type fills the field of the screen that is shown, not the one of the same name in a screen that is not', async (t) => {
  if (skipped(t)) return;
  const values = 'read:names=[...document.querySelectorAll("input[name=name]")].map((input) => input.value)';
  const opened = await walk('/prototype#s2', ['type:이름=수아', values]);
  assert.equal(opened.passed, true, whys(opened));
  assert.deepEqual(opened.reads.names, ['', '수아']);
  const tapped = await walk('/prototype', ['type:이름=지훈', 'tap:다음', 'type:이름=수아', values]);
  assert.equal(tapped.passed, true, whys(tapped));
  assert.deepEqual(tapped.reads.names, ['지훈', '수아']);
});

test('every way a page keeps something from being shown counts: what lies there is not pressed, typed into or seen', async (t) => {
  if (skipped(t)) return;
  await Promise.all(
    Object.keys(KINDS).map(async (kind) => {
      const path = `/kind/${encodeURIComponent(kind)}`;
      const [used, seen] = await Promise.all([
        walk(path, ['tap:누르기', 'expect:window.pressed === "shown"', 'type:메모=안녕', 'expect:document.querySelector("#s").value === "안녕" && document.querySelector("#h").value === ""', 'gone:숨은 말'], 1_500),
        walk(path, ['see:숨은 말']),
      ]);
      assert.equal(used.passed, true, `${kind}:\n${whys(used)}`);
      assert.equal(seen.passed, false, `${kind}: words nobody can see are not on screen`);
      assert.match(seen.steps[0]!.why ?? '', /"숨은 말" is not on screen/, kind);
      assert.match(seen.steps[0]!.why ?? '', ONLY_HIDDEN, kind);
    }),
  );
});

test('what is drawn and marked aria-hidden is on screen: the mark is for a screen reader, the eye reads it', async (t) => {
  if (skipped(t)) return;
  const [seen, gone] = await Promise.all([walk('/read-aloud', ['see:32% 비싸요', 'wait:뒤에 깔린 화면']), walk('/read-aloud', ['gone:32% 비싸요'], 1_500)]);
  assert.equal(seen.passed, true, whys(seen));
  assert.equal(gone.passed, false, 'words a person can read have not gone');
});

test('on an ordinary page with nothing hidden, the steps do what they did', async (t) => {
  if (skipped(t)) return;
  const stopping = ['tap:없는 말', 'wait:없는 말', 'type:없는 칸=x', 'gone:주문'];
  const [done, see, ...stopped] = await Promise.all([
    walk('/plain', ['see:주문', 'wait:아직', 'type:이름=수아', 'expect:document.querySelector("#name").value === "수아"', 'tap:다음', 'see:다음 단계', 'gone:곧 사라질 말', 'gone:없는 말']),
    walk('/plain', ['see:없는 말']),
    ...stopping.map((step) => walk('/plain', [step], 1_500)),
  ]);
  assert.equal(done!.passed, true, whys(done!));
  assert.equal(see!.passed, false);
  assert.equal(see!.steps[0]!.why, '"없는 말" is not on screen');
  stopping.forEach((step, i) => {
    assert.equal(stopped[i]!.passed, false, step);
    assert.match(stopped[i]!.steps[0]!.why ?? '', /Timeout 1500ms exceeded/, step);
    assert.doesNotMatch(stopped[i]!.steps[0]!.why ?? '', ONLY_HIDDEN, step);
  });
});

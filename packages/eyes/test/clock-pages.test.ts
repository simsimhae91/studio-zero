// A walk with its time held (`--clock`) that opens another page. Until 2026-11-18 the page reached by `go:` had its
// time held from its first instant (Playwright replays a held clock into every new document), so whatever its
// start-up waits on with a timer never came. A React app shows a screen whose code arrived late by a timer of up
// to 300 ms ("Throttled" in its source): on a first pass of that day a flow of four scenes, each a `go:` and a
// `wait:`, walked to its end in 0 of 10 runs, at random and more often on a busy machine, with a blank page.
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';
import { closeBrowser, openBrowser, renderWalk, walkWeb } from '../src/web.ts';

const START = Date.UTC(2026, 0, 1);

// A screen that arrives the way a React screen does when its code is fetched late: a request, then a timer of
// 300 ms, then the screen, whose face slides in over half a second, a frame at a time.
const SCENE = `<!doctype html><html lang="ko"><title>성사</title><div id="root"></div><script>
fetch('/chunk').then(() => setTimeout(() => {
  const face = document.createElement('p'); face.id = 'face'; face.textContent = '상대를 찾았어요!';
  face.style.transform = 'translateX(-160px)'; document.querySelector('#root').append(face);
  const since = Date.now();
  const frame = () => { const p = Math.min(1, (Date.now() - since) / 500); face.style.transform = 'translateX(' + (-160 + 160 * p) + 'px)'; if (p < 1) requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}, 300));
</script></html>`;
const HOME = '<!doctype html><html lang="ko"><title>처음</title><h1>처음 화면</h1><a href="/scene">성사로 가기</a></html>';
// A screen that is already there, and a press whose answer comes from the server and is shown by a timer: a note
// that is on screen 300 ms after the answer, and leaves by itself two seconds later.
const FORM = `<!doctype html><html lang="ko"><title>기록</title><button id="send">보내기</button><p id="note" hidden>저장됐어요</p><script>
document.querySelector('#send').addEventListener('click', () => fetch('/chunk').then(() => setTimeout(() => {
  document.querySelector('#note').hidden = false;
  setTimeout(() => { document.querySelector('#note').hidden = true; }, 2000);
}, 300)));
</script></html>`;

async function product(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.url === '/chunk') return void setTimeout(() => res.writeHead(200, { 'content-type': 'text/plain' }).end('ok'), 60);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(req.url === '/scene' ? SCENE : req.url === '/form' ? FORM : HOME);
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const at = server.address();
  return { server, url: `http://127.0.0.1:${typeof at === 'object' && at ? at.port : 0}` };
}

const X = "Number(/translateX\\(([-0-9.e]+)px\\)/.exec(document.querySelector('#face').style.transform)[1])";

test('a page opened while time is held starts as any page does, and is held the moment what the walk waits for is on screen', async (t) => {
  const { server, url } = await product();
  const browser = await openBrowser().catch((err: unknown) => {
    if (/Chromium distribution 'chrome' is not found|Executable doesn't exist|ProcessSingleton/.test(String(err))) return null;
    throw err;
  });
  if (browser === null) {
    server.close();
    return t.skip('no Chrome on this machine');
  }
  try {
    // The flow as a verifier writes it: go there, wait for the screen, then move time by hand and read.
    const steps = ['go:/scene', 'wait:상대를 찾았어요!', `read:t0=${X}`, 'run:250', `read:t250=${X}`, 'run:300', `read:t550=${X}`, 'read:day=new Date().toISOString().slice(0, 10)'];
    const walk = await walkWeb(`${url}/`, steps, { clock: true, browser, stepTimeoutMs: 4_000 });
    assert.equal(walk.passed, true, renderWalk(walk, steps.length));
    assert.equal(walk.reads.t0, -160, 'held the moment the screen was there: what starts with the screen has not moved');
    assert.ok(typeof walk.reads.t250 === 'number' && walk.reads.t250 > -100 && walk.reads.t250 < -60, `half of its half second later it is half-way: ${String(walk.reads.t250)}`);
    assert.equal(walk.reads.t550, 0, 'and past its half second it has arrived');
    assert.equal(walk.reads.day, '2026-01-01', 'the date is still the held one');
    // Asked again, it says the same.
    const again = await walkWeb(`${url}/`, steps, { clock: true, browser, stepTimeoutMs: 4_000 });
    assert.deepEqual(again.reads, walk.reads);

    // Not followed by a wait: the page has started by the time the next step looks, and its time is held again.
    const plain = ['go:/scene', 'see:상대를 찾았어요!', 'read:a=Date.now()', 'shot:held', 'read:b=Date.now()'];
    const seen = await walkWeb(`${url}/`, plain, { clock: true, browser, stepTimeoutMs: 4_000 });
    assert.equal(seen.passed, true, renderWalk(seen, plain.length));
    assert.equal(seen.reads.a, seen.reads.b, 'nothing passes between two steps');

    // A second page: its time goes on from where the first was held, never back.
    const twice = ['go:/scene', 'wait:상대를 찾았어요!', 'read:first=Date.now()', 'go:/scene', 'wait:상대를 찾았어요!', `read:t0=${X}`, 'read:second=Date.now()'];
    const both = await walkWeb(`${url}/`, twice, { clock: true, browser, stepTimeoutMs: 4_000 });
    assert.equal(both.passed, true, renderWalk(both, twice.length));
    assert.equal(both.reads.t0, -160);
    const [first, second] = [both.reads.first as number, both.reads.second as number];
    assert.ok(first > START && second > first && second - START < 60_000, `${first - START} ms, then ${second - START} ms after the start`);

    // A press that loads another page is the same: the page starts, and is held when what is waited for is there.
    const pressed = ['tap:성사로 가기', 'wait:상대를 찾았어요!', `read:t0=${X}`, 'run:550', `read:t550=${X}`];
    const link = await walkWeb(`${url}/`, pressed, { clock: true, browser, stepTimeoutMs: 4_000 });
    assert.equal(link.passed, true, renderWalk(link, pressed.length));
    assert.equal(link.reads.t0, -160);
    assert.equal(link.reads.t550, 0);

    // On a page that has already started: what is waited for needs the server's answer and then a timer. With
    // time standing still the timer never came, whatever `run:` a flow put before the wait (the fourth scene of
    // the flow above: a photograph sent, then the next screen; it stopped in six runs of ten). Waiting passes
    // the page's time, and stops it where the wait ends; so does waiting for something to go.
    const sent = ['go:/form', 'wait:보내기', 'tap:보내기', 'wait:저장됐어요', 'read:came=Date.now()', 'see:저장됐어요', 'gone:저장됐어요', 'read:went=Date.now()'];
    const form = await walkWeb(`${url}/`, sent, { clock: true, browser, stepTimeoutMs: 6_000 });
    assert.equal(form.passed, true, renderWalk(form, sent.length));
    const stayed = (form.reads.went as number) - (form.reads.came as number);
    assert.ok(stayed >= 1_990 && stayed <= 2_020, `the note stayed its two seconds of the page's time, to the frame: ${stayed} ms`);
    // And without the clock held, a walk waits as it always did.
    const free = await walkWeb(`${url}/`, sent.filter((step) => !step.startsWith('read:')), { browser, stepTimeoutMs: 6_000 });
    assert.equal(free.passed, true, renderWalk(free, sent.length - 2));
  } finally {
    await closeBrowser(browser);
    server.close();
  }
});

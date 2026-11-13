// A screen tried by hand: each control held down and compared with itself at rest, the keyboard's focus walked
// through and looked for, and how far the page jumped while loading. Chrome is real; the page is a small app.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { chromium, devices } from 'playwright-core';
import { LAYOUT_SHIFT_GOOD, interactionFindings } from '../src/qa/checks.ts';
import { layoutShift, probeInteraction } from '../src/qa/InteractionProbe.ts';

const APP = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>장부</title><style>
body{margin:0;font:16px system-ui;padding:24px;display:flex;flex-direction:column;gap:16px}
button,.pad,.row{display:flex;align-items:center;justify-content:center;min-height:56px;min-width:200px;background:#246;color:#fff;border:0;border-radius:12px}
#css:active{transform:scale(.96);background:#123}
#hover:hover{background:#468}
.row:has(input:active){background:#c33}
#silent,#hover{outline:none}
#ring:focus-visible{outline:3px solid #f80;outline-offset:2px}
ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
li button{min-height:44px;background:#555}
</style></head><body>
<button id="css">도장 찍기</button>
<button id="silent">조용한 버튼</button>
<button id="hover">가리키면 밝아짐</button>
<div id="js" class="pad" role="button" tabindex="0">스크립트로 답함</div>
<label class="row" id="row"><input type="checkbox" id="cb"> 줄이 답함</label>
<button id="off" disabled>꺼진 버튼</button>
<a id="ring" href="#next" style="display:block;padding:16px;color:#036">다음 화면</a>
<p>본문 안의 <a id="inline" href="#x">글자 링크</a>는 누름 대상이 아니다.</p>
<ul>${[1, 2, 3, 4, 5].map((n) => `<li><button class="item">항목 ${n}</button></li>`).join('')}</ul>
<input id="field" placeholder="분">
<script>
window.clicks = [];
document.addEventListener('click', (e) => window.clicks.push(e.target.id || e.target.tagName));
const js = document.getElementById('js');
js.addEventListener('pointerdown', () => { js.style.background = '#c33'; });
for (const type of ['pointerup', 'pointercancel', 'pointerleave']) js.addEventListener(type, () => { js.style.background = ''; });
if (location.search === '?jump') setTimeout(() => { const d = document.createElement('div'); d.style.cssText = 'height:240px;background:#ddd'; document.body.insertBefore(d, document.body.firstChild); }, 250);
</script></body></html>`;

test('a screen tried by hand: which controls answer a press, which focus can be seen, nothing clicked', async (t) => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 15_000 }).catch(() => null);
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(APP)).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const tryAt = async (context: Parameters<typeof browser.newContext>[0], touch: boolean, path = '/') => {
      const ctx = await browser.newContext(context);
      const page = await ctx.newPage();
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(450);
      const shift = await page.evaluate(layoutShift);
      const probe = await probeInteraction(page, { touch });
      const after = await page.evaluate(() => ({ clicks: (window as unknown as { clicks: string[] }).clicks, checked: (document.getElementById('cb') as HTMLInputElement).checked }));
      await ctx.close();
      return { probe, shift, after };
    };

    // ---- under a thumb
    const phone = await tryAt({ ...devices['iPhone 15 Pro']!, viewport: { width: 393, height: 1400 } }, true);
    assert.deepEqual(phone.after, { clicks: [], checked: false }, 'every control was pressed and none was clicked');
    const silent = phone.probe.press.silent.map((c) => c.selector);
    assert.deepEqual(silent, ['#silent', '#hover', '#ring', 'ul > li:nth-of-type(1) > button.item', 'ul > li:nth-of-type(2) > button.item'], 'the button with no pressed state, the one that only answers a hovering pointer, the link with only a focus ring, and of five alike rows the two that were tried');
    assert.deepEqual([phone.probe.press.answered, phone.probe.press.probed], [3, 8], 'answered: the CSS press, the script press, the row that answers for its checkbox. Not tried: the disabled button, the link in running text, the field');
    assert.equal(phone.probe.press.silent[0]!.text, '조용한 버튼');

    // ---- at a desk: the pointer hovers, and the keyboard is a way in
    const desk = await tryAt({ viewport: { width: 1440, height: 900 } }, false);
    assert.deepEqual(desk.probe.press.silent.map((c) => c.selector), ['#silent', '#ring', 'ul > li:nth-of-type(1) > button.item', 'ul > li:nth-of-type(2) > button.item'], 'a control that answers the pointer before the press has answered');
    assert.deepEqual(desk.after.clicks, []);
    const hidden = desk.probe.focus.hidden.map((c) => c.selector);
    assert.ok(hidden.includes('#silent') && hidden.includes('#hover'), `outline: none with nothing in its place: ${hidden.join(', ')}`);
    assert.ok(!hidden.includes('#css') && !hidden.includes('#ring') && !hidden.includes('#js'), 'the browser\'s own ring and a ring of the page\'s both count');
    assert.equal(desk.probe.focus.probed, 10, 'the first ten stops stand for the screen');

    // ---- as findings
    const findings = interactionFindings(phone.probe, 0.31, { viewport: 'iphone-15-pro', route: '/', touch: true });
    assert.deepEqual(findings.map((f) => [f.rule, f.severity, f.category, f.selector]), [
      ['touch/no-press-answer', 'major', 'tactility', '#silent'],
      ['touch/no-press-answer', 'major', 'tactility', '#hover'],
      ['touch/no-press-answer', 'major', 'tactility', '#ring'],
      ['touch/no-press-answer', 'major', 'tactility', 'ul > li:nth-of-type(1) > button.item'],
      ...phone.probe.focus.hidden.slice(0, 4).map((c) => ['focus/not-visible', 'minor', 'tactility', c.selector]),
      ['motion/layout-shift', 'minor', 'responsive', null],
    ]);
    assert.match(findings[0]!.message, /^"조용한 버튼" gives nothing back while it is held: the screen around it looks the same pressed as at rest\. \(3 of 8 controls tried answered\.\)$/);
    assert.match(findings[3]!.message, /1 more control\(s\) on this screen are the same/);
    assert.deepEqual(findings[0]!.bbox && [findings[0]!.bbox.w, findings[0]!.bbox.h], [345, 56], 'located as the audit locates things: a box in page pixels');
    assert.equal(interactionFindings(desk.probe, null, { viewport: 'desktop-1440', route: '/', touch: false }).find((f) => f.rule === 'focus/not-visible')!.severity, 'major', 'where a keyboard is the way in, focus nobody can see is a major defect');
    assert.deepEqual(interactionFindings(null, LAYOUT_SHIFT_GOOD, { viewport: 'desktop-1440', route: '/', touch: false }), [], 'a screen that was not tried, and a shift within the good range, say nothing');

    // ---- a page that jumps as it loads is measured as jumping
    const steady = desk.shift;
    const jumpy = (await tryAt({ viewport: { width: 1440, height: 900 } }, false, '/?jump')).shift;
    assert.ok(steady < 0.01 && jumpy > LAYOUT_SHIFT_GOOD, `steady ${steady}, jumpy ${jumpy}`);
  } finally {
    await browser.close();
    server.close();
  }
});

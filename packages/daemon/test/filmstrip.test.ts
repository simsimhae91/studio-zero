// A reference page watched over time: frames after load and down the scroll on one sheet, and what moved, measured.
// Chrome is real; the pages are local documents.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { filmPage } from '../src/qa/filmstrip.ts';

const MOVING = `<!doctype html><html><head><style>
  body{margin:0;background:#fafafa;font:16px system-ui}
  .demo{position:absolute;left:0;top:120px;width:900px;height:500px;background:#123;animation:slide 1.2s linear infinite alternate}
  .in{animation:enter 700ms ease-out both}
  @keyframes slide{from{transform:translateX(0)}to{transform:translateX(520px)}}
  @keyframes enter{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:none}}
  main{height:2700px}
</style></head><body><main><h1 class="in">제품이 스스로 시연한다</h1><div class="demo"></div><canvas width="600" height="300" style="position:absolute;top:1000px"></canvas></main></body></html>`;
const STILL = '<!doctype html><html><body style="margin:0"><h1 style="font:96px system-ui;margin:96px">그대로 있는 페이지</h1></body></html>';

test('a page is filmed: frames over time and down the scroll on one sheet, and what moved is measured', async (t) => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 15_000 }).catch(() => null);
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const moving = await filmPage(page, () => page.setContent(MOVING));
    assert.deepEqual([...moving.sheet.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    // Five frames over time and two down the scroll: seven tiles, four to a row.
    assert.deepEqual([Buffer.from(moving.sheet).readUInt32BE(16), Buffer.from(moving.sheet).readUInt32BE(20)], [1440, 2 * 249]);
    assert.match(moving.lines[0]!, /^over time: frames at 0\.\ds, 1\.\ds, 2\.\ds, 3\.\ds, 5\.\ds after the page starts; share of the first screen that changed from each to the next: \d+%, \d+%, \d+%, \d+%$/);
    assert.ok(moving.lines.includes('it keeps moving after its entrance: a loop, a video or a running demo is part of the first screen'), moving.lines.join('\n'));
    assert.ok(moving.lines.some((l) => /^running animations at 5\.\ds: 1 \(1 looping\), 1200ms$/.test(l)), moving.lines.join('\n'));
    assert.ok(moving.lines.includes('canvas: 1, the largest 600x300'), moving.lines.join('\n'));
    assert.ok(moving.lines.includes('the page runs 3 screens deep; 2 more were photographed on the way down'), moving.lines.join('\n'));

    const still = await filmPage(page, () => page.setContent(STILL));
    assert.ok(still.lines.includes('it is still: nothing moves after load'), still.lines.join('\n'));
    assert.ok(still.lines.every((l) => !/^(running animations|video|canvas|the page runs)/.test(l)), 'nothing is reported that was not there');
    assert.equal(Buffer.from(still.sheet).readUInt32BE(20), 2 * 249, 'five frames still take two rows');
  } finally {
    await browser.close();
  }
});

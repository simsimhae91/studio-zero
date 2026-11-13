// How a first screen is put together, measured in a real browser: how much of its text is small, how many
// faces it is set in, what competes at the largest size, text that is turned or stacked, cards, controls, and a
// figure said twice. One page per rule that breaks that rule and no other, and one page that breaks none.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, devices, type Browser } from 'playwright-core';
import { contract } from '@studio-zero/design';
import type { Finding } from '@studio-zero/protocol';
import { COMPOSITION_LIMITS, compositionFindings, runDomChecks, type CheckContext } from '../src/qa/checks.ts';
import { PageDigest, collectDigest } from '../src/qa/collector.ts';
import { withFaces } from '../src/qa/mockupFaces.ts';

async function launch(): Promise<Browser | null> {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true, timeout: 15_000 });
  } catch {
    return null;
  }
}

const phone: CheckContext = { viewport: 'iphone-15-pro', viewportWidth: 393, route: '/', touch: true, scope: 'full', template: 'mobile-expo' };
const rules = (findings: readonly Finding[]): string[] => [...new Set(findings.map((f) => f.rule))].sort();
/** What was found, for the message of an assertion that expected something else. */
const said = (findings: readonly Finding[]): string => findings.map((f) => `${f.rule}: ${f.message}`).join(' | ') || 'nothing';

interface Change {
  /** Added after the screen's own stylesheet. */
  css?: string;
  /** Markup put in under the comparison block. */
  extra?: string;
  /** Markup that takes the place of the list of rows. */
  list?: string;
}

const ROWS = [
  ['다섯째 날', '기록하고 미션까지', '88점'],
  ['넷째 날', '기록만', '99점'],
  ['셋째 날', '늦은 기록', '53점'],
  ['둘째 날', '기록하고 미션까지', '97점'],
  // The same score as the fourth day: two rows of one list that hold the same value are not one figure said twice.
  ['첫째 날', '기록하고 미션까지', '99점'],
] as const;

/**
 * A phone screen that keeps the handbook: an app bar, a comparison block of two figures on one surface, a
 * list of five rows and a dock. It names one face, sets its one code in a monospace face inside `code`, and
 * says each figure once.
 */
function screen(change: Change = {}): string {
  const rows = ROWS.map(([day, what, score], i) => `<li><a href="#r${i}"><span class="what"><span class="t">${day}</span><span class="m">${what}</span></span><span class="v">${score}</span></a></li>`).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>라운드</title><style>
:root{--bg:#f8fafd;--surface:#ffffff;--fg:#15161a;--muted:#4a4d57;--border:#d9dde3;--brand:#0051b2;--on-brand:#ffffff}
*{box-sizing:border-box}
html{font-family:"Pretendard Variable",Pretendard,sans-serif;font-size:16px;line-height:1.5;color:var(--fg);background:var(--bg)}
body{margin:0}h1,h2,p,ul{margin:0;padding:0}ul{list-style:none}
.bar{padding:12px 16px;border-bottom:1px solid var(--border)}
.bar h1{font-size:18px;line-height:1.3;font-weight:700}
.bar p{font-size:14px;color:var(--muted)}
code{font-family:ui-monospace,monospace;font-size:14px}
main{padding:24px 16px 120px;display:flex;flex-direction:column;gap:24px}
.compare{display:grid;grid-template-columns:1fr 1fr;background:var(--surface);border:1px solid var(--border);border-radius:8px}
.compare div{padding:16px;display:flex;flex-direction:column;gap:4px}
.compare div+div{border-left:1px solid var(--border)}
.who{align-self:flex-start;font-size:14px;font-weight:600}
.fig{font-size:36px;line-height:1.1;font-weight:800;font-variant-numeric:tabular-nums}
.gap{font-weight:600}
.note,.diff{font-size:14px;color:var(--muted)}
h2{font-size:18px;line-height:1.3;font-weight:700}
.rows a{display:flex;align-items:center;justify-content:space-between;min-height:64px;padding:8px 0;border-bottom:1px solid var(--border);color:inherit;text-decoration:none}
.what{display:flex;flex-direction:column}.t,.v{font-weight:600}.m{font-size:14px;color:var(--muted)}
.chips{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.chips button{min-height:44px;padding:0 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--fg);font:inherit;font-size:14px;font-weight:600}
.dock{position:fixed;left:0;right:0;bottom:0;padding:12px 16px 16px;background:var(--bg);border-top:1px solid var(--border)}
.dock button{width:100%;min-height:52px;padding:0 16px;border:0;border-radius:8px;background:var(--brand);color:var(--on-brand);font:inherit;font-size:18px;font-weight:700}
${change.css ?? ''}</style></head><body>
<header class="bar"><h1>라운드 여섯</h1><p>수요일 아침 · 초대 코드 <code>SEOYEON7</code></p></header>
<main>
<section class="compare"><div><span class="who">서연</span><span class="fig">433</span></div><div><span class="who">새벽등산</span><span class="fig">496</span></div></section>
<p class="gap">63점 뒤져 있어요</p>
${change.extra ?? ''}
<p class="note">정오 전에 기록하면 스무 점을 더 받고 미션은 자정까지 열려 있어요</p>
${change.list ?? `<section><h2>지난 라운드</h2><ul class="rows">${rows}</ul></section>`}
</main>
<div class="dock"><button type="button">오늘 체중 기록</button></div>
</body></html>`;
}

/** A chart that is most of a screen: fourteen days, each with its day and its score set small inside the drawing. */
const chart = (turned = false): string =>
  `<svg viewBox="0 0 360 240" width="360" height="240" role="img" aria-label="두 주 동안의 점수">${Array.from({ length: 14 }, (_, i) => {
    const [x, tall] = [13 + i * 25, (90 + i) * 1.6];
    return `<rect x="${x - 9}" y="${200 - tall}" width="18" height="${tall}" fill="#8a8f9c"/><text x="${x}" y="${192 - tall}" font-size="11" text-anchor="middle">${90 + i}.5점</text><text x="${x}" y="220" font-size="11" text-anchor="middle"${turned ? ` transform="rotate(-60 ${x} 220)"` : ''}>${i + 1}일</text>`;
  }).join('')}</svg>`;

const CHIPS = `<div class="chips">${['몸무게', '걸음', '물', '잠', '식사', '응원'].map((name) => `<button type="button">${name}</button>`).join('')}</div>`;

/** One change to the clean screen for each rule, with the handbook rule its fix names and what its message says. */
const CASES: readonly { rule: string; severity: 'major' | 'minor'; id: string; change: Change; says: RegExp }[] = [
  // Review Focus 5: two of the three faces on one screen, SUIT titles over a Pretendard body.
  { rule: 'type/second-family', severity: 'major', id: 'T1', change: { css: '.bar h1,h2{font-family:"SUIT Variable",SUIT,sans-serif}' }, says: /set in 2 faces: Pretendard Variable, SUIT Variable/ },
  { rule: 'type/mono-outside-code', severity: 'major', id: 'T1', change: { css: '.v{font-family:ui-monospace,monospace}' }, says: /"88점" is set in a monospace face outside a code block \(4 more\)/ },
  { rule: 'type/micro-overuse', severity: 'major', id: 'T3', change: { css: '.bar p,.who,.t,.m,.v{font-size:12px}' }, says: /^5\d% of the characters on the first screen are set at 12px or under/ },
  { rule: 'type/micro-sentence', severity: 'minor', id: 'T3', change: { css: '.note{font-size:12px}' }, says: /"정오 전에 기록하면 스무 점을 더 받고 미션은 자정까지 열려 있어요"/ },
  { rule: 'type/turned-text', severity: 'major', id: 'T5', change: { css: '.who{transform:rotate(-90deg)}' }, says: /"서연" is turned 90 degrees \(1 more\)/ },
  { rule: 'type/stacked-text', severity: 'major', id: 'T5', change: { css: '.who{width:16px}' }, says: /"서연" is stacked one character to a line \(1 more\)/ },
  { rule: 'type/end-aligned-block', severity: 'minor', id: 'T6', change: { css: '.note{text-align:right}' }, says: /"정오 전에 기록하면[^"]*" is aligned to the end side/ },
  { rule: 'layout/competing-figures', severity: 'major', id: 'M3', change: { css: '.gap{font-size:36px;line-height:1.1;font-weight:800}' }, says: /3 things are set at the largest size on the first screen: "433", "496", "63점 뒤져 있어요"/ },
  { rule: 'layout/half-empty-card', severity: 'minor', id: 'M5', change: { css: '.compare{min-height:280px}' }, says: /A 361×280px card is filled to 2\d% of its height/ },
  { rule: 'layout/nested-cards', severity: 'minor', id: 'M5', change: { css: '.compare div{margin:8px;border:1px solid var(--border);border-radius:8px}' }, says: /2 cards sit inside another card/ },
  { rule: 'layout/too-many-controls', severity: 'major', id: 'M7', change: { extra: CHIPS }, says: new RegExp(`^1\\d controls can be pressed on the first screen; ${COMPOSITION_LIMITS.controls} is the limit`) },
  { rule: 'copy/figure-twice', severity: 'minor', id: 'M4', change: { extra: '<p class="diff">격차 63</p>' }, says: /The same figure is stated more than once on the first screen: 63 x2/ },
];

test('composition, read off a real page: a screen that keeps the handbook is clean, and each rule is found on the page that breaks it alone', async (t) => {
  const browser = await launch();
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  try {
    const measure = async (html: string, at: 'phone' | 'desk' = 'phone'): Promise<PageDigest> => {
      const context = await browser.newContext({ ...(at === 'phone' ? devices['iPhone 15 Pro'] : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }), colorScheme: 'light' });
      try {
        const page = await context.newPage();
        await page.setContent(withFaces(html), { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.waitForTimeout(150);
        return PageDigest.parse(await page.evaluate(collectDigest, 600));
      } finally {
        await context.close();
      }
    };

    const clean = await measure(screen());
    assert.deepEqual(rules(runDomChecks(clean, phone, contract)), [], `an app bar, a comparison block, five rows and a dock break nothing, old rule or new: ${said(runDomChecks(clean, phone, contract))}`);
    const read = clean.composition!;
    assert.ok(read, 'the digest carries what was read of the composition');
    assert.deepEqual(
      [read.microShare, read.microSentences, read.families, read.monoOutsideCode, read.figuresAtLargest, read.turnedText, read.stackedText, read.endAlignedText, read.nestedCards, read.figuresTwice, read.mediaBoxes],
      [0, [], ['Pretendard Variable'], [], ['433', '496'], [], [], [], 0, [], []],
      'the code in the app bar is monospace where monospace belongs, the two figures are one comparison, and the rows that share a score are a list',
    );
    // The comparison block is read as a card whose content stops a little short of its foot (its padding is on
    // the two halves inside it). Whether that is short enough to say is the limit's to decide, and it is not.
    assert.deepEqual(read.halfEmptyCards.map((card) => [card.selector, card.h >= COMPOSITION_LIMITS.cardMinHeightPx, card.reach < COMPOSITION_LIMITS.cardReach]), [['main > section.compare:nth-of-type(1)', false, false]]);
    assert.equal(read.controls, 6, 'five rows and the dock');
    assert.deepEqual(read.paper.map((v) => Math.round(v * 255)), [248, 250, 253], 'the colour the screen is laid on');

    for (const { rule, severity, id, change, says } of CASES) {
      const found = runDomChecks(await measure(screen(change)), phone, contract);
      assert.deepEqual(rules(found), [rule], `${rule} and nothing else: ${said(found)}`);
      const [finding] = found as [Finding];
      assert.equal(found.length, 1, `${rule} is said once however many places break it`);
      assert.equal(finding.severity, severity, rule);
      assert.match(finding.message, says, rule);
      assert.ok(finding.fix!.startsWith(`${id}: `), `the fix of ${rule} names the handbook rule it enforces: ${finding.fix}`);
      assert.equal(finding.source, 'dom');
    }

    // What a finding points at, where there is one thing to point at.
    const second = runDomChecks(await measure(screen(CASES[0]!.change)), phone, contract)[0]!;
    assert.match(second.fix!, /^T1: .*Pretendard Variable/, 'the fix names the face the screen is already in');
    assert.equal(second.selector, 'header.bar > h1', 'and the finding points at the first text in the other one');
    const stretched = runDomChecks(await measure(screen(CASES[8]!.change)), phone, contract)[0]!;
    assert.deepEqual([stretched.selector, stretched.bbox?.w, stretched.bbox?.h], ['main > section.compare:nth-of-type(1)', 361, 280]);

    // Review Focus 3: a screen that is mostly a chart. Its day and score numerals are 11px and are most of what
    // is written on it; they are a drawing's labels, not the screen's text, and stay out of the budget.
    const charted = await measure(screen({ list: chart() }));
    assert.equal(charted.composition!.microShare, 0);
    assert.deepEqual(rules(runDomChecks(charted, phone, contract)), [], 'numerals inside a chart are not small text overused, and a score on two bars is not a figure said twice');
    assert.deepEqual(rules(runDomChecks(await measure(screen({ list: chart(true) })), phone, contract)), ['type/turned-text'], 'a tick label turned on its side is still turned, drawn or not');

    // A desk has no thumb to crowd: the count of controls is a touch-screen rule.
    const crowded = await measure(screen({ extra: CHIPS }), 'desk');
    assert.ok(crowded.composition!.controls > COMPOSITION_LIMITS.controls);
    assert.ok(!rules(runDomChecks(crowded, { ...phone, viewport: 'desktop-1440', viewportWidth: 1440, touch: false, template: 'web-vite-react' }, contract)).includes('layout/too-many-controls'));

    // The dark pass re-checks colour only, and a digest stored before composition was read still parses and says nothing.
    const broken = await measure(screen({ css: '.who{width:16px}.note{text-align:right;font-size:12px}' }));
    assert.deepEqual(rules(compositionFindings(broken, phone)), ['type/end-aligned-block', 'type/micro-sentence', 'type/stacked-text']);
    assert.deepEqual(rules(runDomChecks(broken, { ...phone, scope: 'color-only' }, contract)), []);
    const { composition: _unread, ...old } = broken;
    assert.deepEqual(compositionFindings(PageDigest.parse(old), phone), []);
    assert.equal(PageDigest.parse({ ...old, composition: { microShare: 'most of it' } }).composition, undefined, 'a block that does not hold is dropped, and the rest of the digest kept');
  } finally {
    await browser.close();
  }
});

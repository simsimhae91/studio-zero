// How a first screen is put together, measured in a real browser: how much of its text is small, how many
// faces it is set in, what competes at the largest size, text that is turned or stacked, cards, controls, and a
// figure said twice. One page per rule that breaks that rule and no other, and one page that breaks none.
// Then colour, counted by the pixel off a picture of the first screenful: how much of it is colour at strength
// and how much is near-black, through the auditor as an engine's own check of its page gets it.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium, devices, type Browser } from 'playwright-core';
import { contract } from '@studio-zero/design';
import type { Finding, Project } from '@studio-zero/protocol';
import { COLOUR_LIMITS, COMPOSITION_LIMITS, compositionFindings, runDomChecks, type CheckContext } from '../src/qa/checks.ts';
import { PageDigest, collectDigest, type Composition } from '../src/qa/collector.ts';
import { withFaces } from '../src/qa/mockupFaces.ts';
import { MOCKUP_DIR, MockupRenderer, renderMockupCheck } from '../src/qa/MockupRenderer.ts';
import { colourShares } from '../src/qa/pixels.ts';
import type { QaBrowser, QaSession } from '../src/qa/QaBrowser.ts';
import type { QaVisionBridge } from '../src/qa/QaVisionBridge.ts';
import { VisualAuditor } from '../src/qa/VisualAuditor.ts';
import type { OrbStackManager } from '../src/sandbox/OrbStackManager.ts';
import { quietLog, sampleProject, testDaemon } from './helpers.ts';

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
:root{--sz-bg:#f8fafd;--sz-surface:#ffffff;--sz-fg:#15161a;--sz-fg-muted:#4a4d57;--sz-border:#d9dde3;--sz-brand:#0051b2;--sz-on-brand:#ffffff}
*{box-sizing:border-box}
html{font-family:"Pretendard Variable",Pretendard,sans-serif;font-size:16px;line-height:1.5;color:var(--sz-fg);background:var(--sz-bg)}
body{margin:0}h1,h2,p,ul{margin:0;padding:0}ul{list-style:none}
.bar{padding:12px 16px;border-bottom:1px solid var(--sz-border)}
.bar h1{font-size:18px;line-height:1.3;font-weight:700}
.bar p{font-size:14px;color:var(--sz-fg-muted)}
code{font-family:ui-monospace,monospace;font-size:14px}
main{padding:24px 16px 120px;display:flex;flex-direction:column;gap:24px}
.compare{display:grid;grid-template-columns:1fr 1fr;background:var(--sz-surface);border:1px solid var(--sz-border);border-radius:8px}
.compare div{padding:16px;display:flex;flex-direction:column;gap:4px}
.compare div+div{border-left:1px solid var(--sz-border)}
.who{align-self:flex-start;font-size:14px;font-weight:600}
.fig{font-size:36px;line-height:1.1;font-weight:800;font-variant-numeric:tabular-nums}
.gap{font-weight:600}
.note,.diff{font-size:14px;color:var(--sz-fg-muted)}
h2{font-size:18px;line-height:1.3;font-weight:700}
.rows a{display:flex;align-items:center;justify-content:space-between;min-height:64px;padding:8px 0;border-bottom:1px solid var(--sz-border);color:inherit;text-decoration:none}
.what{display:flex;flex-direction:column}.t,.v{font-weight:600}.m{font-size:14px;color:var(--sz-fg-muted)}
.chips{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.chips button{min-height:44px;padding:0 8px;border:1px solid var(--sz-border);border-radius:8px;background:var(--sz-surface);color:var(--sz-fg);font:inherit;font-size:14px;font-weight:600}
.dock{position:fixed;left:0;right:0;bottom:0;padding:12px 16px 16px;background:var(--sz-bg);border-top:1px solid var(--sz-border)}
.dock button{width:100%;min-height:52px;padding:0 16px;border:0;border-radius:8px;background:var(--sz-brand);color:var(--sz-on-brand);font:inherit;font-size:18px;font-weight:700}
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
  { rule: 'layout/half-empty-card', severity: 'minor', id: 'M5', change: { css: '.compare{min-height:280px}' }, says: /A 361×280px card is filled to 2\d% of its height/ },
  { rule: 'layout/nested-cards', severity: 'minor', id: 'M5', change: { css: '.compare div{margin:8px;border:1px solid var(--sz-border);border-radius:8px}' }, says: /2 cards sit inside another card/ },
  { rule: 'layout/too-many-controls', severity: 'minor', id: 'M7', change: { extra: CHIPS }, says: new RegExp(`^1\\d controls can be pressed on the first screen, not counting its tabs; ${COMPOSITION_LIMITS.controls} is the limit`) },
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
    const stretched = runDomChecks(await measure(screen(CASES.find((c) => c.rule === 'layout/half-empty-card')!.change)), phone, contract)[0]!;
    assert.deepEqual([stretched.selector, stretched.bbox?.w, stretched.bbox?.h], ['main > section.compare:nth-of-type(1)', 361, 280]);

    // Review Focus 3: a screen that is mostly a chart. Its day and score numerals are 11px and are most of what
    // is written on it; they are a drawing's labels, not the screen's text, and stay out of the budget.
    const charted = await measure(screen({ list: chart() }));
    assert.equal(charted.composition!.microShare, 0);
    assert.deepEqual(rules(runDomChecks(charted, phone, contract)), [], 'numerals inside a chart are not small text overused, and a score on two bars is not a figure said twice');
    assert.deepEqual(rules(runDomChecks(await measure(screen({ list: chart(true) })), phone, contract)), ['type/turned-text'], 'a tick label turned on its side is still turned, drawn or not');

    // E1 and E4: what a first screen is made of. The clean screen above keeps every rule of type and layout and
    // is still text and rules: asked as a screen a person meets the product on, it has nothing drawn.
    const first: CheckContext = { ...phone, firstScreen: true };
    /** What is said of material and colour, apart from the frame, which has its own cases below. */
    const made = (found: readonly Finding[]): Finding[] => found.filter((f) => f.rule !== 'layout/no-tab-bar');
    assert.deepEqual(clean.composition!.material, { drawnShare: 0, icons: 0, boxes: 3, ruledBoxes: 2 }, 'the comparison block and the dock are ruled; the dock\'s button is a box with no rule');
    const flat = made(runDomChecks(clean, first, contract));
    assert.deepEqual(rules(flat), ['material/nothing-drawn'], said(flat));
    assert.equal(flat[0]!.severity, 'major');
    assert.match(flat[0]!.message, /^Next to nothing is drawn on the first screen besides text: 0% of it is picture or drawing, and it has 0 icons\./);
    assert.ok(flat[0]!.fix!.startsWith('E1: '));
    // A chart is a drawing, and so are ten faces: either is enough to say the screen is made of something.
    assert.ok(charted.composition!.material!.drawnShare > 0.25);
    assert.deepEqual(rules(made(runDomChecks(charted, first, contract))), []);
    const FACE = '<svg class="face" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><circle cx="20" cy="20" r="20" fill="#dbe7fb"/><circle cx="20" cy="16" r="7" fill="#0051b2"/></svg>';
    const faces = await measure(screen({ css: '.faces{display:flex;gap:4px}', extra: `<div class="faces">${FACE.repeat(10)}</div>` }));
    assert.deepEqual([faces.composition!.material!.icons, faces.composition!.material!.drawnShare], [10, 0]);
    assert.deepEqual(rules(made(runDomChecks(faces, first, contract))), []);
    assert.deepEqual(rules(made(runDomChecks(await measure(screen({ css: '.faces{display:flex;gap:4px}', extra: `<div class="faces">${FACE.repeat(9)}</div>` })), first, contract))), ['material/nothing-drawn'], 'nine are not yet a screen with faces on it');
    // Three boxes drawn with a hairline: the comparison block, the dock, and one more.
    const BOXES = { css: '.box{padding:16px;min-height:80px;border:1px solid var(--sz-border);border-radius:8px;background:var(--sz-surface)}.faces{display:flex;gap:4px}', extra: `<div class="faces">${FACE.repeat(10)}</div><div class="box">오늘 미션</div>` };
    const boxed = made(runDomChecks(await measure(screen(BOXES)), first, contract));
    assert.deepEqual(rules(boxed), ['material/ruled-boxes'], said(boxed));
    assert.match(boxed[0]!.message, /^3 of the 4 boxes on the first screen are drawn with a hairline/);
    assert.ok(boxed[0]!.fix!.startsWith('E4: ') && boxed[0]!.severity === 'major');
    assert.deepEqual(rules(made(runDomChecks(await measure(screen({ ...BOXES, css: `${BOXES.css}.box,.compare,.dock{border:0}` })), first, contract))), [], 'the same boxes with no rule on them');
    // Asked only where a person meets the product, and at the size of a hand.
    assert.deepEqual(rules(runDomChecks(clean, phone, contract)), []);
    assert.deepEqual(rules(runDomChecks(clean, { ...first, viewport: 'desktop-1440', viewportWidth: 1440, touch: false }, contract)), []);
    assert.deepEqual(rules(runDomChecks(clean, { ...first, viewport: 'ipad-pro-11', viewportWidth: 834 }, contract)), [], 'the ruler was laid at the phone\'s size');
    // The tabs of a tab bar are the frame, not what the screen offers.
    const TABS = '<nav class="tabs">' + ['대결', '점수', '지난 대결', '내 정보'].map((name) => `<a href="#${name}">${name}</a>`).join('') + '</nav>';
    assert.equal((await measure(screen({ css: '.tabs{position:fixed;left:0;right:0;bottom:84px;display:flex;gap:16px}.tabs a{min-height:44px}', extra: TABS }))).composition!.controls, 6, 'five rows and the dock, as without the tabs');

    // M1: the frame. The clean screen has a dock and no tab bar; on a phone app's first screen that is said.
    assert.deepEqual(clean.composition!.frame, { tabs: 0, brokenFigures: [], overlappingText: [], underFloat: [], endUnderFixed: 0 }, 'one wide button along the foot is a dock');
    const bare = runDomChecks(clean, first, contract).find((f) => f.rule === 'layout/no-tab-bar')!;
    assert.match(bare.message, /^The first screen has no tab bar: nothing sits along its foot where 3 to 5 tabs belong\.$/);
    assert.ok(bare.severity === 'major' && bare.fix!.startsWith('M1: '));
    const BAR = '.dock{display:none}.tabs{position:fixed;left:0;right:0;bottom:0;display:grid;grid-template-columns:repeat(4,1fr);background:var(--sz-surface)}.tabs a{display:flex;align-items:center;justify-content:center;min-height:56px;color:inherit;text-decoration:none}';
    const tabbed = await measure(screen({ css: BAR, extra: TABS }));
    assert.equal(tabbed.composition!.frame!.tabs, 4);
    assert.ok(!rules(runDomChecks(tabbed, first, contract)).includes('layout/no-tab-bar'));
    assert.ok(!rules(runDomChecks(clean, phone, contract)).includes('layout/no-tab-bar'), 'asked of a first screen only');
    // T7: a figure that broke onto a second line, and text drawn over text.
    const split = runDomChecks(await measure(screen({ css: '.fig{display:block;width:44px;overflow-wrap:anywhere}' })), phone, contract);
    assert.deepEqual(rules(split), ['type/broken-figure'], said(split));
    assert.match(split[0]!.message, /^The figure "433" breaks onto a second line \(1 more\)\.$/);
    assert.ok(split[0]!.severity === 'major' && split[0]!.fix!.startsWith('T7: '));
    const stacked = runDomChecks(await measure(screen({ css: '.note{margin-top:-48px}' })), phone, contract);
    assert.deepEqual(rules(stacked), ['layout/overlapping-text'], said(stacked));
    assert.match(stacked[0]!.message, /^Text is drawn over other text: "63점 뒤져 있어요 \/ 정오 전에 기록하면 스무 점을 더 받고 미션"/);
    assert.ok(stacked[0]!.fix!.startsWith('T7: '));
    // A phrase that wraps onto a second line, and the words that follow it on that line: side by side, not one over
    // the other. Its box is as wide as the column and two lines tall, and it is not the box that is asked about.
    const wrapped = runDomChecks(await measure(screen({ css: '.runs{width:220px;line-height:1.6}', extra: '<p class="runs"><ins>오늘 입항 목록을 맨 위에 도착 시각 순으로 세우고</ins><del>정박지 표를 먼저 둔다</del></p>' })), phone, contract);
    assert.ok(!rules(wrapped).includes('layout/overlapping-text'), said(wrapped));
    // A line a pane has scrolled away sits, in the document, where the title above the pane is. It is not on the
    // screen there: the pane clips it. Without the pane's clipping it is drawn over the title, and that is said.
    const SCROLLED = { extra: '<section><h2 class="clip-title">지난 대결 기록</h2><div class="clip"><p>정오 전에 기록하면 스무 점을 더 받는다</p></div></section>', css: '.clip-title{margin:16px 0 0;font-size:16px;line-height:24px}.clip{height:72px}.clip p{margin:-24px 0 0;line-height:24px}' };
    assert.ok(rules(runDomChecks(await measure(screen(SCROLLED)), phone, contract)).includes('layout/overlapping-text'), 'drawn over the title when nothing clips it');
    const clipped = runDomChecks(await measure(screen({ ...SCROLLED, css: `${SCROLLED.css}.clip{overflow:hidden}` })), phone, contract);
    assert.ok(!rules(clipped).includes('layout/overlapping-text'), said(clipped));
    // The same two texts with an opaque card between them: the one beneath is not seen, and nothing is said.
    assert.deepEqual(rules(runDomChecks(await measure(screen({ css: '.note{margin-top:-48px;position:relative;background:var(--sz-surface)}' })), phone, contract)), []);
    // E4: a pill floating over a row's words at rest, and a page whose last line stays under its dock.
    // The dock made a pill and lifted over the second row: its score lies under it.
    const pill = runDomChecks(await measure(screen({ css: '.dock{left:auto;right:16px;bottom:196px;width:200px;padding:0;border:0;background:none}' })), phone, contract);
    assert.deepEqual(rules(pill), ['layout/under-float'], said(pill));
    assert.ok(pill[0]!.severity === 'minor' && pill[0]!.fix!.startsWith('E4: '));
    const buried = runDomChecks(await measure(screen({ css: 'main{padding-bottom:0}' })), phone, contract);
    assert.deepEqual(rules(buried), ['layout/end-under-bar'], said(buried));
    assert.match(buried[0]!.message, /^Scrolled to its end, the page leaves its last \d+px of text under the bar or the control that floats over it\.$/);
    assert.ok(buried[0]!.severity === 'major' && buried[0]!.fix!.startsWith('E4: '));

    // T7: a control's label on two lines. The owner's own find, on a product the gates had passed: two buttons
    // sharing a dock, and the narrower one's label broken in two ("저장한 팁 보기" beside "저장함").
    const PAIR = '.pair{display:flex;gap:12px}.pair button{min-height:52px;padding:0 20px;border:1px solid var(--sz-border);border-radius:8px;background:var(--sz-surface);color:var(--sz-fg);font:inherit;font-size:18px;font-weight:700}.pair .wide{flex:1}';
    const pair = (css: string): Change => ({ css: `${PAIR}${css}`, extra: '<div class="pair"><button type="button" class="tips">저장한 팁 보기</button><button type="button" class="wide">저장함</button></div>' });
    const squeezed = runDomChecks(await measure(screen(pair('.pair .tips{width:116px}'))), phone, contract);
    assert.deepEqual(rules(squeezed), ['type/broken-label'], said(squeezed));
    assert.match(squeezed[0]!.message, /^"저장한 팁 보기" is broken onto 2 lines inside its control\.$/);
    assert.ok(squeezed[0]!.severity === 'major' && squeezed[0]!.fix!.startsWith('T7: '));
    // Given the width of its words, the same pair says nothing.
    assert.deepEqual(rules(runDomChecks(await measure(screen(pair(''))), phone, contract)), []);
    const unbroken = async (change: Change): Promise<void> => {
      const found = runDomChecks(await measure(screen(change)), phone, contract);
      assert.ok(!rules(found).includes('type/broken-label'), said(found));
    };
    // A tile is a drawing over its caption, and a caption may take two lines: the label is not what the control is.
    await unbroken({ css: '.tile{display:flex;flex-direction:column;align-items:center;gap:8px;width:104px;padding:16px 8px;border:0;border-radius:8px;background:var(--sz-surface);color:var(--sz-fg);font:inherit;font-weight:600}.tile i{width:56px;height:56px;border-radius:8px;background:var(--sz-border)}', extra: '<button type="button" class="tile"><i></i><span>저장한 팁 모아 보기</span></button>' });
    // A row that is one sentence no line of this screen holds: it wraps because it is long, not because it was squeezed.
    await unbroken({ css: '.tip{display:block;padding:12px 0;color:inherit;text-decoration:none}', extra: '<a class="tip" href="#tip">식사 20분 전에 물 한 컵을 마시면 포만감이 빨리 와서 덜 먹게 돼요</a>' });
    // A link inside a sentence runs on with the sentence, over the end of a line like any other words.
    await unbroken({ extra: '<p>어제 기록을 놓쳤다면 지금이라도 <a href="#fix">지난 기록 고치는 방법 보기</a>를 눌러 주세요</p>' });
    // A break that was made is not a break that was suffered.
    await unbroken({ css: `${PAIR}.pair .tips{width:116px}`, extra: '<div class="pair"><button type="button" class="tips">저장한 팁<br>보기</button><button type="button" class="wide">저장함</button></div>' });

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

// ------------------------------------------------------------------ colour, by the pixel

const localBrowser = (browser: Browser): QaBrowser => ({ use: async <T>(_project: Project, _signal: AbortSignal | undefined, fn: (session: QaSession) => Promise<T>) => fn({ browser, host: '127.0.0.1', devices }) }) as unknown as QaBrowser;
/** A sandbox whose workspace holds exactly these files: a page is read with a command that first tests for it, and the screen spec as a file. */
const sandboxWith = (files: Record<string, string>): OrbStackManager =>
  ({
    exec: async (_project: Project, script: string) => {
      const file = Object.keys(files).find((name) => script.includes(`${name} ]`));
      return { exitCode: file ? 0 : 1, stdout: file ? files[file]! : '', stderr: '', timedOut: false, durationMs: 1 };
    },
    readFile: async (_project: Project, path: string) => {
      if (files[path] === undefined) throw new Error(`no such file: ${path}`);
      return { content: files[path], truncated: false };
    },
  }) as unknown as OrbStackManager;
const NOBODY = { availability: async () => ({ status: 'off', paths: [], reason: 'no reviewer in this test' }), review: async () => Promise.reject(new Error('nobody is asked')) } as unknown as QaVisionBridge;
const phoneProject = { ...sampleProject('duel'), template: 'mobile-expo' } as const;
const BOTH = ['color/dark-band', 'color/flood'];
const GREY = 'color/grey-screen';

/** A picture that is one strong colour all over, carried inside the page: to a count of pixels, what a photograph is. */
const PICTURE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#0051b2"/></svg>')}`;
const HELD = 'display:flex;flex-direction:column;justify-content:space-between;padding:16px;font-weight:600';
const PANEL = { css: `.panel{${HELD};height:200px;border-radius:8px;background:var(--sz-brand);color:var(--sz-on-brand)}`, extra: '<div class="panel"><span>새벽등산이 앞서 있어요</span><span>응원을 보내면 따라잡을 수 있어요</span></div>' };
/** The same panel grown to half the first screen: past what one hero takes. */
const FLOOD = { css: PANEL.css.replace('height:200px', 'height:330px'), extra: PANEL.extra };
const BAND = { css: `.band{${HELD};height:240px;margin:0 -16px;background:#0b0c0e;color:#f4f5f7}`, extra: '<div class="band"><span>라운드별 점수</span><span>하루에 백 점까지 받아요</span></div>' };
const DARK_TOKENS = ':root{--sz-bg:#0e0f12;--sz-surface:#17181c;--sz-fg:#f4f5f7;--sz-fg-muted:#b6bac4;--sz-border:#2a2c33}';

test('the pixel count: the shares of a picture that are colour at strength and near-black, with what is under a mask left out', async (t) => {
  const browser = await launch();
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  try {
    // 200 by 200: the top half brand blue, then a quarter black, then paper. Photographed at twice the size.
    const context = await browser.newContext({ viewport: { width: 200, height: 200 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.setContent('<body style="margin:0;background:#f8fafd"><div style="height:100px;background:#0051b2"></div><div style="height:50px;background:#000"></div></body>');
    const png = await page.screenshot({ type: 'png' });
    await context.close();
    assert.deepEqual(await colourShares(browser, png, { mask: [], scale: 2 }), { saturated: 0.5, dark: 0.25, coloured: 0.5 });
    assert.deepEqual(await colourShares(browser, png, { mask: [[0, 0, 200, 100]], scale: 2 }), { saturated: 0, dark: 0.5, coloured: 0 }, 'shares are of the pixels left when the mask is taken out');
    assert.deepEqual(await colourShares(browser, png, { mask: [[-50, -50, 900, 900]], scale: 2 }), { saturated: 0, dark: 0, coloured: 0 }, 'a picture that is all mask has nothing to count');
    await assert.rejects(colourShares(browser, Buffer.from('not a picture'), { mask: [], scale: 1 }), 'a picture that cannot be read is an error, not a clean count');
    assert.equal(browser.contexts().length, 0, 'the page the count was made on is closed');
  } finally {
    await browser.close();
  }
});

test('colour by the pixel, through the auditor: a flood of brand and a dark band are found, and a photograph, a dark product and a viewer are not', async (t) => {
  const browser = await launch();
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  const d = await testDaemon();
  try {
    const { store, events } = d.daemon;
    store.insertProject(phoneProject);
    const auditor = new VisualAuditor({ config: d.config, store, events, browser: localBrowser(browser), vision: NOBODY, clock: () => 1000, log: quietLog });
    const measured = async (change: Change, project: Project = phoneProject): Promise<Finding[]> => (await auditor.measurePages({ project, taskId: null, pages: [{ route: `${MOCKUP_DIR}/a.html`, html: withFaces(screen(change)) }] })).findings.filter((f) => f.rule.startsWith('color/') && f.rule !== GREY);
    const grey = async (change: Change, project: Project = phoneProject): Promise<Finding[]> => (await auditor.measurePages({ project, taskId: null, pages: [{ route: `${MOCKUP_DIR}/a.html`, html: withFaces(screen(change)) }] })).findings.filter((f) => f.rule === GREY);
    const atPhone = (findings: readonly Finding[]): string[] => rules(findings.filter((f) => f.viewport === 'iphone-15-pro'));

    assert.deepEqual(rules(await measured({})), [], 'the dock\'s one button is colour where colour belongs');

    // E5: the same screen has one button of colour and no hero. On the phone's first screen that is a grey screen.
    const plain = await grey({});
    assert.deepEqual(plain.map((f) => [f.viewport, f.severity]), [['iphone-15-pro', 'major']]);
    assert.match(plain[0]!.message, /^\d% of the first screen is colour: a grey screen\. A hero begins at 20%\.$/);
    assert.ok(plain[0]!.fix!.startsWith('E5: '), plain[0]!.fix!);
    assert.deepEqual(await grey(PANEL), [], 'a hero in the brand over a quarter of the screen');
    assert.deepEqual(await grey({ css: '.panel{display:block;width:100%;height:200px;border-radius:8px}', extra: `<img class="panel" alt="새벽 산길" src="${PICTURE}">` }), [], 'a photograph over a quarter of the screen carries its own colour');

    // A brand panel over a quarter of the first screen is a hero, which is where strong colour lives (C2).
    assert.deepEqual(rules(await measured(PANEL)), [], 'one hero in the brand is inside the budget');
    // The same panel over half of it.
    const flooded = await measured(FLOOD);
    assert.deepEqual(atPhone(flooded), ['color/flood']);
    const flood = flooded.find((f) => f.viewport === 'iphone-15-pro')!;
    assert.equal(flood.severity, 'major');
    assert.match(flood.message, /^(4[6-9]|5\d)% of the first screen is colour at full strength\. About a third is the budget, and 45% the limit\.$/);
    assert.ok(flood.fix!.startsWith('C2: '), flood.fix!);
    assert.equal(flood.selector, 'main > div.panel', 'the finding points at the largest surface of that colour');
    // Review Focus 4: the same panel as a photograph, and as a picture behind a box. What a picture holds is not the interface's colour.
    assert.deepEqual(rules(await measured({ css: '.panel{display:block;width:100%;height:330px;border-radius:8px}', extra: `<img class="panel" alt="새벽 산길" src="${PICTURE}">` })), []);
    assert.deepEqual(rules(await measured({ css: `${FLOOD.css}.panel{background:url("${PICTURE}") center/cover}`, extra: FLOOD.extra })), []);

    // A black band over a third of a paper screen.
    const banded = await measured(BAND);
    assert.deepEqual(atPhone(banded), ['color/dark-band']);
    const band = banded[0]!;
    assert.equal(band.severity, 'major');
    assert.match(band.message, /^3\d% of this light screen is near-black/);
    assert.ok(band.fix!.startsWith('C3: '), band.fix!);
    assert.equal(band.selector, 'main > div.band');
    assert.deepEqual(rules(banded.filter((f) => f.viewport !== 'iphone-15-pro')), [], 'it is a rule of the phone screen: on the tablet the same band is not said again');
    // Review Focus 2: a product that is dark by design, its paper dark in the light scheme too, and a screen
    // that is a viewer laid over the paper. Dark all over is a way for a screen to be; neither is a band.
    assert.deepEqual(rules(await measured({ css: `${DARK_TOKENS}${BAND.css}`, extra: BAND.extra })), []);
    assert.deepEqual(rules(await measured({ css: '.viewer{position:fixed;inset:0;display:flex;align-items:center;background:#000}.viewer img{display:block;width:100%;height:240px}', extra: `<div class="viewer"><img alt="새벽 산길" src="${PICTURE}"></div>` })), []);
    // A web page may carry one inverted section: the band is a rule of the phone app.
    const web = { ...sampleProject('quote'), id: 'prj_quote_web' };
    store.insertProject(web);
    assert.deepEqual(rules(await measured(BAND, web)), []);
    // The hero is asked of a web product too, where it is first met: at a desk.
    assert.deepEqual((await grey({}, web)).map((f) => f.viewport), ['desktop-1440']);

    // A measurement is not an audit: the picture it counted is not kept, and nothing is recorded.
    assert.deepEqual(store.listAudits(phoneProject.id, 10), []);
    const kept = (project: Project): string[] => (existsSync(join(d.config.artifactsDir, project.id)) ? (readdirSync(join(d.config.artifactsDir, project.id), { recursive: true }) as string[]).filter((name) => name.endsWith('.png')) : []);
    assert.deepEqual(kept(phoneProject), []);
    // An audit counts the picture it keeps anyway.
    const { report } = await auditor.auditPages({ project: phoneProject, taskId: null, pages: [{ route: `${MOCKUP_DIR}/a.html`, html: withFaces(screen(FLOOD)) }] });
    assert.deepEqual(atPhone(report.findings.filter((f) => f.rule.startsWith('color/'))), ['color/flood']);
    assert.ok(report.screenshots.length > 0 && kept(phoneProject).length === report.screenshots.length);
  } finally {
    await d.cleanup();
    await browser.close();
  }
});

test('a draft is looked at once: its first route at the size it is first met at, measured, with no reviewer asked, and recorded as measured only', async (t) => {
  const browser = await launch();
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  const d = await testDaemon();
  const app = createServer((req, res) => void res.writeHead(req.url === '/' ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }).end(req.url === '/' ? withFaces(screen()) : 'not here'));
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  try {
    const { store, events } = d.daemon;
    store.insertProject(phoneProject);
    const asked: string[] = [];
    const reviewer = { availability: async () => (asked.push('availability'), { status: 'ready', paths: ['codex'], reason: '' }), review: async () => (asked.push('review'), Promise.reject(new Error('nobody is asked'))) } as unknown as QaVisionBridge;
    const auditor = new VisualAuditor({ config: d.config, store, events, browser: localBrowser(browser), vision: reviewer, clock: () => 1000, log: quietLog });
    const report = await auditor.measureDraft({ project: phoneProject, taskId: null, port: (app.address() as AddressInfo).port, routes: ['/', '/settings'] });

    assert.deepEqual(asked, [], 'no reviewer is asked, or asked whether it could be');
    assert.deepEqual([report.visionReviewed, report.vision.status, report.vision.reason, report.slopScore], [false, 'off', 'a draft: measured only, no design review is asked', null]);
    assert.deepEqual([...new Set(report.findings.map((f) => f.viewport))], ['iphone-15-pro'], 'one size: the one a phone app is first met at');
    assert.deepEqual([...new Set(report.findings.map((f) => f.route))], ['/'], 'one route: the first');
    // The clean screen of these tests is text and rules with one button of colour: on a first screen that is said.
    assert.deepEqual(rules(report.findings.filter((f) => /^(color|material)\//.test(f.rule))), ['color/grey-screen', 'material/nothing-drawn']);
    assert.ok(report.screenshots.length > 0 && report.screenshots.every((shot) => shot.viewport === 'iphone-15-pro'));
    // It is in the project's audits, announced as an audit that completed unreviewed, with a plain notice and no warning.
    assert.deepEqual(store.listAudits(phoneProject.id, 10).map((a) => a.id), [report.id]);
    const said = events.history({ projectId: phoneProject.id }, 0, 100).map((e) => e.body);
    assert.deepEqual(said.flatMap((b) => (b.type === 'audit.completed' ? [[b.auditId, b.visionReviewed, b.passed]] : [])), [[report.id, false, false]]);
    assert.deepEqual(said.flatMap((b) => (b.type === 'notice' ? [[b.level, /^Draft measured at iphone-15-pro: 0 blocker, \d+ major, \d+ minor\. Measured only: no design review was asked, and nothing is held to it\.$/.test(b.message)]] : [])), [['info', true]]);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await d.cleanup();
    await browser.close();
  }
});

test('the page a real engine drew on 2026-11-13, which the check of its own page called clean: a black band, nothing drawn, boxes ruled, no tab bar, and five more', async (t) => {
  const browser = await launch();
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  const d = await testDaemon();
  try {
    const { store, events } = d.daemon;
    store.insertProject(phoneProject);
    const auditor = new VisualAuditor({ config: d.config, store, events, browser: localBrowser(browser), vision: NOBODY, clock: () => 1000, log: quietLog });
    const file = `${MOCKUP_DIR}/b.html`;
    const renderer = new MockupRenderer({ config: d.config, store, clock: Date.now, log: quietLog, browser: localBrowser(browser), sandboxes: sandboxWith({ [file]: readFileSync(new URL('./fixtures/duel-b.html', import.meta.url), 'utf8') }), auditor });
    const check = await renderer.check(phoneProject, file);
    assert.equal(check.status, 'measured');
    if (check.status !== 'measured') return;
    const found = check.findings!.filter((f) => f.viewport === 'iphone-15-pro');
    const handbook = found.filter((f) => /^[A-Z]\d+: /.test(f.fix ?? ''));
    // Its brand panel is a sixth of the screen: inside the budget of one hero since the lab's second round, and no longer said.
    assert.deepEqual(rules(handbook), ['color/dark-band', 'layout/half-empty-card', 'layout/no-tab-bar', 'material/nothing-drawn', 'material/ruled-boxes', 'type/end-aligned-block', 'type/micro-overuse', 'type/second-family', 'type/stacked-text'], said(found));
    for (const rule of ['color/dark-band', 'material/nothing-drawn', 'material/ruled-boxes']) assert.equal(found.find((f) => f.rule === rule)?.severity, 'major');
    const text = renderMockupCheck(file, check);
    assert.match(text, /- \[major\] material\/nothing-drawn \(measured\)\n  iphone-15-pro \| docs\/mockups\/b\.html[^\n]*\n  Next to nothing is drawn on the first screen besides text: 0% of it is picture or drawing, and it has \d icons?\./);
    assert.match(text, /- \[major\] color\/dark-band \(measured\)\n  iphone-15-pro \| docs\/mockups\/b\.html \| selector: [^\n]*button\.board[^\n]*\n  \d\d% of this light screen is near-black/);
    assert.ok(!text.includes('Nothing here holds the page back'), 'the answer the engine stopped on is not given any more');
    assert.deepEqual(store.listAudits(phoneProject.id, 10), []);
  } finally {
    await d.cleanup();
    await browser.close();
  }
});

test('where a share of pixels becomes a finding: over the limit, on a phone app laid on light paper', () => {
  const composition: Composition = { microShare: 0, microSentences: [], families: ['Pretendard Variable'], monoOutsideCode: [], figuresAtLargest: [], turnedText: [], stackedText: [], endAlignedText: [], controls: 1, halfEmptyCards: [], nestedCards: 0, figuresTwice: [], mediaBoxes: [], paper: [0.97, 0.98, 0.99] };
  const text = { id: 'e1', tag: 'p', role: '', selector: 'p', text: '오늘 체중 기록', textLength: 8, interactive: false, inline: false, x: 16, y: 16, w: 300, h: 24, color: [0.1, 0.1, 0.1, 1], background: [1, 1, 1, 1], backgroundIndeterminate: false, ownBackground: [0, 0, 0, 0], backgroundImage: 'none', fontSize: 16, fontWeight: 400, fontFamily: 'Pretendard Variable', lineHeight: 1.5, letterSpacingEm: 0, uppercase: false, radius: 0, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: 0, shadow: 'none', hasBorder: false, clipped: false, brokenLabel: false, charsPerLine: 0, siblingKey: 'main|P' } satisfies PageDigest['elements'][number];
  const digest = (over: Partial<Composition> = {}): PageDigest => ({ title: 't', lang: 'ko', width: 393, height: 659, scrollWidth: 393, scrollHeight: 1200, loadedFonts: ['Pretendard Variable'], elements: [text], composition: { ...composition, ...over } });
  const found = (shares: { saturated: number; dark: number }, ctx: Partial<CheckContext> = {}, over: Partial<Composition> = {}): string[] => rules(runDomChecks(digest(over), { ...phone, shares, ...ctx }, contract));

  assert.deepEqual(found({ saturated: COLOUR_LIMITS.flood, dark: COLOUR_LIMITS.darkBand }), [], 'at the limit is inside it');
  assert.deepEqual(found({ saturated: COLOUR_LIMITS.flood + 0.001, dark: COLOUR_LIMITS.darkBand + 0.001 }), BOTH);
  assert.deepEqual(rules(runDomChecks(digest(), phone, contract)), [], 'with no picture counted, nothing is said about colour');
  // A flood is a flood on any product at any size. The band is the phone app's rule, on its phone screen, on light paper.
  assert.deepEqual(found({ saturated: 0.5, dark: 0.4 }, { template: 'web-vite-react', viewport: 'desktop-1440', viewportWidth: 1440, touch: false }), ['color/flood']);
  assert.deepEqual(found({ saturated: 0, dark: 0.4 }, { viewport: 'ipad-pro-11', viewportWidth: 834 }), []);
  assert.deepEqual(found({ saturated: 0, dark: 0.4 }, { template: undefined }), [], 'a caller that does not say what the product is gets no rule that depends on it');
  assert.deepEqual(found({ saturated: 0, dark: 0.9 }, {}, { paper: [0.05, 0.06, 0.07] }), []);
  assert.deepEqual(found({ saturated: 0.5, dark: 0.4 }, { scope: 'color-only' }), [], 'the dark pass is not where a light screen is counted');
  const { composition: _unread, ...old } = digest();
  assert.deepEqual(rules(runDomChecks(old, { ...phone, shares: { saturated: 0, dark: 0.4 } }, contract)), [], 'without the paper read off the page there is no saying the screen is light');
});

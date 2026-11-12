import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, devices, type Browser } from 'playwright-core';
import { contract, createTheme, renderThemeCss, seedFromName } from '@studio-zero/design';
import type { AuditReport, Finding } from '@studio-zero/protocol';
import { runDomChecks, scoreAudit } from '../src/qa/checks.ts';
import { PageDigest, collectDigest, type DigestElement } from '../src/qa/collector.ts';
import { renderAuditFeedback } from '../src/qa/VisualAuditor.ts';

const WHITE = [1, 1, 1, 1] as const;
const INK = [0.1, 0.1, 0.1, 1] as const;
let n = 0;

function el(over: Partial<DigestElement>): DigestElement {
  return {
    id: `e${++n}`, tag: 'p', role: '', selector: `p:nth-of-type(${n})`, text: 'Readable text', textLength: 13, interactive: false, inline: false,
    x: 16, y: 16 * n, w: 300, h: 24, color: [...INK], background: [...WHITE], backgroundIndeterminate: false, ownBackground: [0, 0, 0, 0], backgroundImage: 'none',
    fontSize: 16, fontWeight: 400, fontFamily: 'Geist', lineHeight: 1.6, letterSpacingEm: 0, uppercase: false, radius: 0, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: 0,
    shadow: 'none', hasBorder: false, clipped: false, charsPerLine: 0, siblingKey: 'main|P', ...over,
  };
}

function digest(elements: DigestElement[], over: Partial<PageDigest> = {}): PageDigest {
  return { title: 't', lang: 'en', width: 393, height: 659, scrollWidth: 393, scrollHeight: 1200, loadedFonts: ['Geist'], elements, ...over };
}

const phone = { viewport: 'iphone-15-pro', viewportWidth: 393, route: '/', touch: true, scope: 'full' } as const;
const rules = (findings: Finding[]): string[] => [...new Set(findings.map((f) => f.rule))].sort();

test('a page that follows the contract produces no findings and a full score', () => {
  const page = digest([el({ tag: 'h1', fontSize: 30, fontWeight: 600, lineHeight: 1.3 }), el({}), el({ tag: 'button', interactive: true, w: 120, h: 44, padding: [12, 16, 12, 16], radius: 8 })]);
  const findings = runDomChecks(page, phone, contract);
  assert.deepEqual(findings, []);
  assert.deepEqual(scoreAudit(findings, null, 85), { score: 100, passed: true, blockers: 0, majors: 0, minors: 0 });
});

test('measured defects: contrast, touch targets, overflow, scale, rhythm and generated-looking patterns', () => {
  const page = digest(
    [
      el({ text: 'Barely visible', color: [0.61, 0.64, 0.69, 1] }), // #9ca3af on white ≈ 2.5:1
      el({ text: 'AA but not AAA', color: [0.42, 0.45, 0.5, 1] }), // ≈ 4.8:1
      el({ tag: 'h2', text: 'Large heading in grey', fontSize: 30, color: [0.46, 0.46, 0.46, 1] }), // 4.5:1 is enough for large text
      el({ text: 'Text over a photo', color: [...WHITE], backgroundIndeterminate: true }),
      el({ tag: 'button', text: 'x', interactive: true, w: 20, h: 20 }),
      el({ tag: 'a', text: 'inline link', interactive: true, inline: true, w: 60, h: 18 }),
      el({ text: 'Odd size', fontSize: 15 }),
      el({ text: 'FEATURES', uppercase: true, letterSpacingEm: 0.2, fontSize: 12, textLength: 8 }),
      el({ text: 'Ship faster 🚀' }),
      el({ tag: 'div', text: '', w: 600, h: 200, backgroundImage: 'linear-gradient(90deg, rgb(99, 102, 241), rgb(168, 85, 247))', padding: [13, 13, 13, 13], gap: 10, margin: [7, 0, 0, 0] }),
      el({ tag: 'div', text: '', w: 200, h: 120, radius: 24, shadow: '0 10px 30px rgba(0,0,0,.1)', siblingKey: 'grid|DIV' }),
      el({ tag: 'div', text: '', w: 200, h: 120, radius: 24, shadow: '0 10px 30px rgba(0,0,0,.1)', siblingKey: 'grid|DIV' }),
      el({ tag: 'div', text: '', w: 200, h: 120, radius: 24, shadow: '0 10px 30px rgba(0,0,0,.1)', siblingKey: 'grid|DIV' }),
    ],
    { scrollWidth: 900 },
  );
  const findings = runDomChecks(page, phone, contract);
  assert.deepEqual(rules(findings), [
    'contrast/text', 'responsive/horizontal-overflow', 'shape/off-scale-radius', 'slop/caps-eyebrow', 'slop/cliche-gradient', 'slop/emoji-as-icon', 'slop/identical-cards', 'spacing/off-grid', 'touch/target-size', 'type/off-scale',
  ]);

  const contrast = findings.filter((f) => f.rule === 'contrast/text');
  assert.equal(contrast.length, 2, 'the large heading and the text over an image are not flagged');
  assert.equal(contrast[0]!.severity, 'blocker', 'failing AA is a blocker');
  assert.match(contrast[0]!.message, /2\.\d\d:1; 7:1 is required/);
  assert.equal(contrast[1]!.severity, 'major', 'passing AA but not AAA is major');

  const touch = findings.filter((f) => f.rule === 'touch/target-size');
  assert.equal(touch.length, 1, 'links inside running text are exempt');
  assert.deepEqual(touch[0]!.bbox, { x: 16, y: touch[0]!.bbox!.y, w: 20, h: 20 });
  assert.match(touch[0]!.message, /20×20px; touch targets need 44×44px/);

  const result = scoreAudit(findings, null, 85);
  assert.equal(result.passed, false);
  assert.ok(result.blockers >= 3 && result.score < 60, JSON.stringify(result));

  // Desktop has no touch requirement; the dark pass re-checks colour only.
  assert.ok(!rules(runDomChecks(page, { ...phone, viewport: 'desktop-1440', touch: false }, contract)).includes('touch/target-size'));
  assert.deepEqual(rules(runDomChecks(page, { ...phone, scope: 'color-only' }, contract)), ['contrast/text']);
});

test('scoring: judgement can move the score, measurement decides whether it can pass', () => {
  const blocker: Finding = { rule: 'responsive/horizontal-overflow', category: 'responsive', severity: 'blocker', source: 'dom', viewport: 'iphone-15-pro', route: '/', message: 'm', selector: 'main > div', bbox: { x: 0, y: 10, w: 900, h: 80 }, fix: 'f', file: null, line: null };
  const perfectTaste = { hierarchy: 10, whitespace: 10, typography: 10, color: 10, copy: 10, originality: 10 };
  assert.equal(scoreAudit([blocker], perfectTaste, 85).passed, false, 'a blocker fails the audit whatever the reviewer thinks');
  assert.deepEqual(scoreAudit([], { ...perfectTaste, originality: 2, hierarchy: 4 }, 85), { score: 90.7, passed: true, blockers: 0, majors: 0, minors: 0 });
  assert.equal(scoreAudit([], Object.fromEntries(Object.keys(perfectTaste).map((k) => [k, 5])), 85).passed, false, 'a clean but mediocre screen does not pass');
  const noisy = Array.from({ length: 30 }, (_, i) => ({ ...blocker, severity: 'minor' as const, rule: 'spacing/off-grid', selector: `li:nth-of-type(${i})` }));
  assert.equal(scoreAudit(noisy, null, 85).score, 80, 'one rule on many elements cannot take more than its cap');

  // The same defect on the same element at three viewports is one defect, counted at its worst severity.
  const major = { ...blocker, severity: 'major' as const, rule: 'type/font-not-loaded', selector: null };
  const everywhere = [major, { ...major, viewport: 'ipad-pro-11' as const }, { ...major, viewport: 'desktop-1440' as const, severity: 'minor' as const }];
  assert.deepEqual(scoreAudit(everywhere, null, 85), { score: 95, passed: true, blockers: 0, majors: 1, minors: 0 });

  const report: AuditReport = {
    id: 'aud_1', projectId: 'p', taskId: null, createdAt: 0, score: 50, threshold: 85, passed: false,
    visionReviewed: false, vision: { status: 'unavailable', via: null, model: null, limited: false, reviewed: 0, expected: 1, reason: 'no model to ask' },
    rubric: null, slopScore: null, archetype: null, critique: null, grade: null, redesignPatches: [], findings: [blocker], screenshots: [],
  };
  const feedback = renderAuditFeedback(report);
  assert.match(feedback, /Design review did not run \(no model to ask\)\. The design is unverified: the score is capped at 50/);
  assert.match(feedback, /\[blocker\] responsive\/horizontal-overflow \(measured\)/);
  assert.match(feedback, /iphone-15-pro \| \/ \| selector: main > div \| box: x=0 y=10 900×80px/);
});

// ------------------------------------------------- the collector in a real browser

async function launch(): Promise<Browser | null> {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true, timeout: 15_000 });
  } catch {
    return null;
  }
}

const theme = renderThemeCss(createTheme(seedFromName('ledger')));
const CLEAN = `<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${theme}</style><style>
  body { margin: 0; font-family: Geist, sans-serif; background: var(--sz-bg); color: var(--sz-fg); }
  main { padding: 24px; display: grid; gap: 24px; }
  h1 { font-size: 30px; line-height: 1.3; margin: 0; }
  p { font-size: 16px; line-height: 1.6; margin: 0; color: var(--sz-fg-muted); }
  section { background: var(--sz-surface); border: 1px solid var(--sz-border); border-radius: 8px; padding: 16px; display: grid; gap: 8px; }
  a.action { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px; border-radius: 8px; background: var(--sz-accent); color: var(--sz-on-accent); font-size: 16px; text-decoration: none; }
</style></head><body><main><h1>미결제 청구서</h1><p>결제를 기다리는 청구서가 3건 있습니다.</p><section><p>Northwind Trading</p><a class="action" href="#">청구서 다시 보내기</a></section></main></body></html>`;

const SLOPPY = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;font-family:Arial">
  <div id="hero" style="width:900px;padding:13px;background:linear-gradient(90deg,#6366f1,#a855f7)">
    <p style="text-transform:uppercase;letter-spacing:0.2em;font-size:11px;color:#fff;margin:0">Features</p>
    <h1 style="font-size:37px;color:#fff;margin:7px 0">Supercharge your workflow 🚀</h1>
  </div>
  <p id="body" style="font-size:13px;color:#9ca3af;background:#fff;margin:0;padding:10px">Barely readable grey text on white.</p>
  <a id="tiny" href="#" style="display:inline-block;font-size:12px;padding:2px 6px;color:#2563eb;background:#fff">Go</a>
</body></html>`;

test('collector + checks against real rendering (Chrome)', async (t) => {
  const browser = await launch();
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  try {
    const measure = async (html: string, scheme: 'light' | 'dark'): Promise<PageDigest> => {
      const context = await browser.newContext({ ...devices['iPhone 15 Pro'], colorScheme: scheme });
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const parsed = PageDigest.parse(await page.evaluate(collectDigest, 600));
      await context.close();
      return parsed;
    };

    // The generated theme, rendered by a real browser's colour pipeline, meets AAA in both schemes.
    for (const scheme of ['light', 'dark'] as const) {
      const page = await measure(CLEAN, scheme);
      assert.equal(page.width, 393);
      const heading = page.elements.find((e) => e.tag === 'h1')!;
      assert.equal(heading.text, '미결제 청구서');
      assert.equal(heading.fontSize, 30);
      const action = page.elements.find((e) => e.tag === 'a')!;
      assert.ok(action.interactive && action.h >= 44, `action height ${action.h}`);
      assert.equal(scheme === 'dark', heading.background[0]! < 0.3, 'the dark palette is what gets measured in dark mode');
      // Geist is requested but no font file is served in this test, which the audit is right to point out.
      assert.deepEqual(rules(runDomChecks(page, phone, contract)), ['type/font-not-loaded'], scheme);
    }

    const sloppy = await measure(SLOPPY, 'light');
    assert.ok(sloppy.scrollWidth > 900);
    const found = rules(runDomChecks(sloppy, phone, contract));
    for (const expected of ['contrast/text', 'responsive/horizontal-overflow', 'touch/target-size', 'type/off-scale', 'type/foreign-font', 'spacing/off-grid', 'slop/cliche-gradient', 'slop/caps-eyebrow', 'slop/emoji-as-icon']) {
      assert.ok(found.includes(expected), `expected ${expected} in ${found.join(', ')}`);
    }
    const overflow = runDomChecks(sloppy, phone, contract).find((f) => f.rule === 'responsive/horizontal-overflow')!;
    assert.equal(overflow.selector, '#hero', 'the finding points at the element that causes the overflow');
    assert.ok(overflow.bbox!.w > 900);

    // Without a viewport meta tag a phone lays the page out at desktop width; that is reported as such.
    const noMeta = await measure(CLEAN.replace(/<meta name="viewport"[^>]*>/, ''), 'light');
    assert.ok(rules(runDomChecks(noMeta, phone, contract)).includes('responsive/missing-viewport-meta'), `layout width ${noMeta.width}`);
  } finally {
    await browser.close();
  }
});

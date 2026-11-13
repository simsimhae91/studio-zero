import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { referenceSeed, referenceThemePath } from '../src/build.ts';
import { KOREAN_TEXT_SLOP_PATTERNS, colorTokens, contract, contractFamilies, contrastRatio, cornerRadii, createTheme, displayFaces, isAllowedDuration, isAllowedRadius, isDisplayInProportion, isOnTypeScale, lineHeightFor, lintInterfaceText, lintSources, mobileTokens, oklchToRgb, parseHex, renderThemeCss, seedFromName, textSlopScore, typeStepNames, type InterfaceText, type Palette } from '../src/index.ts';

const TEXT_TOKENS = ['fg', 'fg-muted', 'accent', 'danger', 'success', 'warning'] as const;
const BACKGROUNDS = ['bg', 'surface', 'sunken'] as const;

function ratio(p: Palette, a: keyof Palette, b: keyof Palette): number {
  return contrastRatio(oklchToRgb(p[a]), oklchToRgb(p[b]));
}

test('contrast maths matches the WCAG reference values', () => {
  assert.equal(Math.round(contrastRatio([0, 0, 0], [1, 1, 1])), 21);
  assert.equal(contrastRatio(parseHex('#777')!, parseHex('#ffffff')!).toFixed(2), '4.48');
  assert.deepEqual(parseHex('#0f0'), [0, 1, 0]);
  assert.equal(parseHex('not-a-colour'), null);
});

test('every seed yields text tokens at WCAG AAA on every background, in both modes', () => {
  for (let hue = 0; hue < 360; hue += 15) {
    for (const chroma of [0.06, 0.13, 0.2]) {
      const theme = createTheme({ hue, chroma, neutralChroma: 0.01, corners: 'soft' });
      for (const mode of ['light', 'dark'] as const) {
        const p = theme[mode];
        for (const bg of BACKGROUNDS) {
          for (const token of TEXT_TOKENS) {
            assert.ok(ratio(p, token, bg) >= contract.contrast.text, `${mode} hue ${hue} chroma ${chroma}: ${token} on ${bg} = ${ratio(p, token, bg).toFixed(2)}`);
          }
          assert.ok(ratio(p, 'control-border', bg) >= contract.contrast.nonText, `${mode} hue ${hue}: control-border on ${bg}`);
        }
        assert.ok(ratio(p, 'on-accent', 'accent') >= contract.contrast.text, `${mode} hue ${hue} chroma ${chroma}: on-accent on accent = ${ratio(p, 'on-accent', 'accent').toFixed(2)}`);
      }
    }
  }
});

test('theme CSS replaces the Tailwind defaults and exposes exactly the contract scale', () => {
  const css = renderThemeCss(createTheme(referenceSeed));
  for (const reset of ['--color-*: initial;', '--text-*: initial;', '--radius-*: initial;', '--shadow-*: initial;']) assert.ok(css.includes(reset), reset);
  for (const token of colorTokens) assert.ok(css.includes(`--color-${token}: var(--sz-${token});`), token);
  contract.typeScalePx.forEach((size, i) => assert.ok(css.includes(`--text-${typeStepNames[i]}: ${size / 16}rem;`), `text step ${size}px`));
  assert.ok(css.includes(`min-block-size: ${contract.touchTargetPx}px`));
  assert.ok(css.includes('prefers-reduced-motion'));
});

test('the committed theme.css is the output of the generator', () => {
  assert.equal(readFileSync(referenceThemePath, 'utf8'), renderThemeCss(createTheme(referenceSeed)), 'run `pnpm design:build`');
});

test('project seeds are stable, distinct, and avoid the default-looking violet band', () => {
  assert.deepEqual(seedFromName('ledger'), seedFromName('ledger'));
  const hues = new Set(['ledger', 'atlas', 'harbor', 'kiln', 'orchard', 'relay', 'tide', 'quarry'].map((n) => seedFromName(n).hue));
  assert.ok(hues.size >= 6, 'different names should rarely collide');
  for (let i = 0; i < 500; i++) {
    const { hue } = seedFromName(`project-${i}`);
    assert.ok(hue < 250 || hue > 305, `seed hue ${hue} falls in the violet band`);
  }
});

const SLOPPY = `import { Card } from './card';
export function Hero() {
  return (
    <section className="bg-gradient-to-r from-indigo-500 to-purple-600 p-[13px]">
      <p className="uppercase tracking-widest text-gray-400">Features</p>
      <h1 style={{ color: '#ff00aa' }}>Unlock the power of your data 🚀</h1>
      <a className="rounded-3xl shadow-2xl" href="/start">Get started →</a>
    </section>
  );
}
`;

const CLEAN = `export function Invoices({ rows }: { rows: Row[] }) {
  return (
    <section className="bg-surface border border-border rounded-md p-6">
      <h1 className="text-3xl text-fg">Unpaid invoices</h1>
      <p className="text-base text-fg-muted">{rows.length} waiting for payment</p>
      <a className="bg-accent text-on-accent rounded-md px-4 py-3 w-[calc(100%-2rem)]" href="/invoices/new">New invoice</a>
    </section>
  );
}
`;

test('slop lint flags each generated-looking pattern with a file and line', () => {
  const findings = lintSources([{ path: 'src/Hero.tsx', content: SLOPPY }]);
  const rules = new Set(findings.map((f) => f.rule));
  for (const expected of [
    'slop/cliche-gradient',
    'slop/default-palette',
    'slop/arbitrary-value',
    'slop/caps-eyebrow',
    'slop/raw-color',
    'slop/emoji-as-icon',
    'slop/filler-copy',
    'slop/arrow-suffix',
    'slop/heavy-shadow',
    'slop/uniform-pill-cards',
  ]) {
    assert.ok(rules.has(expected), `expected ${expected}; got ${[...rules].join(', ')}`);
  }
  const gradient = findings.find((f) => f.rule === 'slop/cliche-gradient')!;
  assert.equal(gradient.file, 'src/Hero.tsx');
  assert.equal(gradient.line, 4);
  assert.equal(gradient.source, 'lint');
});

test('slop lint accepts token-based markup, generated themes, and recorded exceptions', () => {
  assert.deepEqual(lintSources([{ path: 'src/Invoices.tsx', content: CLEAN }]), []);
  assert.deepEqual(lintSources([{ path: 'src/styles/theme.css', content: renderThemeCss(createTheme(referenceSeed)) }]), []);
  assert.deepEqual(lintSources([{ path: 'README.md', content: 'from-indigo-500 to-purple-600 🚀' }]), [], 'non-UI files are out of scope');
  const allowed = `// sz-allow slop/raw-color\nconst chartInk = '#1f6f5c';\n`;
  assert.deepEqual(lintSources([{ path: 'src/chart.tsx', content: allowed }]), []);
});

test('a CSS gradient between saturated blue and purple stops is flagged, a neutral one is not', () => {
  const flagged = lintSources([{ path: 'src/app.css', content: '.hero { background: linear-gradient(90deg, #4f46e5, #9333ea); }' }]);
  assert.ok(flagged.some((f) => f.rule === 'slop/cliche-gradient'));
  const neutral = lintSources([{ path: 'src/app.css', content: '.scrim { background: linear-gradient(#111111, #333333); }' }]);
  assert.ok(!neutral.some((f) => f.rule === 'slop/cliche-gradient'));
});

test('the mobile tokens add to the contract and never contradict it', () => {
  const t = mobileTokens;
  assert.equal(t.touchTarget, contract.touchTargetPx);
  assert.equal(t.space.unit, contract.spacingUnitPx);
  for (const [name, px] of Object.entries({ ...t.space, minBottom: t.safeArea.minBottom, barHeight: t.bar.height, badge: t.dropzone.badge, corner: t.dropzone.corner })) {
    assert.equal(px % contract.spacingUnitPx, 0, `${name} (${px}px) is on the ${contract.spacingUnitPx}px rhythm`);
  }
  assert.ok(t.bar.height >= t.touchTarget && t.bar.action >= t.touchTarget, 'a bar holds a full thumb target');
  assert.deepEqual([t.motion.fast, t.motion.base, t.motion.slow], [...contract.motion.durationsMs]);
  assert.ok(t.press.scale < t.press.scaleLarge && t.press.scaleLarge < 1, 'a large surface gives way less than a small one');

  // Shape and surface are class names from the project's theme, so a project's palette and corners carry through.
  const theme = renderThemeCss(createTheme(referenceSeed));
  for (const radius of [t.radius.control, t.radius.container, t.radius.pill]) assert.match(theme, new RegExp(`--radius-${radius.replace('rounded-', '')}:`), radius);
  assert.equal(t.radius.sheet, 'rounded-t-lg');
  const colours = new Set<string>(colorTokens);
  const classes = Object.values(t.surface).flatMap((recipe) => recipe.split(' '));
  for (const cls of classes.filter((c) => /^(bg|border)-[a-z]/.test(c) && !/^(border|backdrop)$/.test(c) && !c.startsWith('border-dashed'))) {
    assert.ok(colours.has(cls.replace(/^(bg|border)-/, '').replace(/\/\d+$/, '')), `${cls} names a theme colour`);
  }
  assert.deepEqual(lintSources([{ path: 'mobile/tokens.tsx', content: readFileSync(new URL('../src/mobile/tokens.ts', import.meta.url), 'utf8') }]), [], 'no raw colours, no arbitrary values');
  for (const side of ['top', 'right', 'bottom', 'left'] as const) assert.equal(t.safeArea.css[side], `env(safe-area-inset-${side}, 0px)`);
});

// What the reference sites this studio is measured against actually ship. Every one of them failed the first
// contract; a contract that fails the best work in the field is measuring tidiness, not design.
const GOLDEN = {
  titlePx: [120, 132.5, 160],
  titleLineHeight: [0.9, 0.95, 1],
  bodyPx: 20,
  radiiPx: [5, 15, 22, 28, 30],
  entranceMs: [600, 720, 810],
  pageMs: [700, 900, 1100],
};

test('the contract admits what the reference sites ship: display type, tight leading, organic radii, staged motion', () => {
  for (const size of GOLDEN.titlePx) {
    assert.ok(isOnTypeScale(size), `${size}px title`);
    assert.ok(isDisplayInProportion(size, size >= 150 ? 24 : GOLDEN.bodyPx), `${size}px over body text`);
  }
  for (const lh of GOLDEN.titleLineHeight) assert.ok(lh >= contract.lineHeight.heading[0] && lh <= contract.lineHeight.heading[1], `title line-height ${lh}`);
  for (const size of contract.typeScalePx.filter((s) => s > contract.display.fromPx)) assert.ok(lineHeightFor(size) >= 0.9 && lineHeightFor(size) <= 1, `the theme sets ${size}px tight`);
  for (const radius of GOLDEN.radiiPx) assert.ok(isAllowedRadius(radius), `${radius}px radius`);
  for (const ms of [...GOLDEN.entranceMs, ...GOLDEN.pageMs, ...contract.motion.durationsMs]) assert.ok(isAllowedDuration(ms), `${ms}ms`);
  for (const family of ['Fraunces', 'Noto Serif KR', 'Instrument Serif', 'Gowun Batang', 'Bricolage Grotesque', 'Geist', 'Pretendard']) assert.ok(contractFamilies().includes(family), family);
});

test('the contract still refuses what is merely loud or arbitrary', () => {
  assert.ok(!isOnTypeScale(13), '13px is between steps and below the display range');
  assert.ok(!isOnTypeScale(200), 'past the display ceiling');
  assert.ok(!isDisplayInProportion(160, 16), 'a 160px headline over 16px body is ten times, not a hierarchy');
  assert.ok(!isDisplayInProportion(64, 24), 'a headline under three times its body is not display type');
  assert.ok(isDisplayInProportion(48, 16), 'sizes on the ordinary scale are not held to the display ratio');
  assert.ok(!isAllowedRadius(48), '48px on a large card is a blob');
  assert.ok(isAllowedRadius(48, contract, 96), 'the same radius on a 96px-tall control is a capsule');
  assert.ok(isAllowedRadius(9999));
  assert.ok(!isAllowedDuration(450), 'between feedback and an entrance');
  assert.ok(!isAllowedDuration(2000));
});

test('titles, corners and motion vary by seed and reach the generated theme', () => {
  const names = Array.from({ length: 200 }, (_, i) => seedFromName(`project-${i}`));
  assert.deepEqual([...new Set(names.map((s) => s.display))].sort(), [...displayFaces].sort(), 'every display pairing is reachable');
  assert.deepEqual([...new Set(names.map((s) => s.corners))].sort(), ['round', 'sharp', 'soft']);

  const serif = renderThemeCss(createTheme({ ...referenceSeed, corners: 'round', display: 'serif' }));
  assert.ok(serif.includes('--font-display: "Fraunces", "Noto Serif KR", "Geist", '), 'the display pairing leads the title stack');
  assert.match(serif, /titles in Fraunces \+ Noto Serif KR/);
  for (const [step, px] of Object.entries(cornerRadii.round)) assert.ok(serif.includes(`--radius-${step}: ${px}px;`), `round ${step}`);
  assert.ok(Object.values(cornerRadii).every((r) => Object.values(r).every((px) => isAllowedRadius(px))));
  const [entrance, page] = [/--duration-entrance: (\d+)ms/.exec(serif), /--duration-page: (\d+)ms/.exec(serif)].map((m) => Number(m![1]));
  assert.ok(entrance! >= contract.motion.entranceMs[0] && entrance! <= contract.motion.entranceMs[1]);
  assert.ok(page! >= contract.motion.pageMs[0] && page! <= contract.motion.pageMs[1]);
  // A seed that names no display face sets titles in the body face.
  assert.ok(renderThemeCss(createTheme(referenceSeed)).includes('--font-display: "Geist", "Pretendard Variable", '));
});

const t = (role: InterfaceText['role'], text: string): InterfaceText => ({ role, text });

test('Korean copy lint names each generated habit with the wording to replace', () => {
  const hits = lintInterfaceText(
    [
      t('title', '더 나은 협업의 미래'),
      t('body', '팀이 함께 토론하고 문서를 고칩니다.'),
      t('body', '설정은 세 단계로 이루어집니다. 화면을 따라가면 됩니다. 결과는 대시보드에서 확인하실 수 있습니다.'),
      t('cta', '시작하기'),
      t('cta', '더 알아보기'),
      t('title', '관리비 도우미에 오신 것을 환영합니다'),
      t('body', '이 화면에서 지난달 고지서를 올릴 수 있어요. 올리면 항목별로 나눠서 보여 드려요. 평균보다 많이 나온 항목은 빨갛게 표시돼요. 궁금한 항목을 누르면 이유를 알려 드려요.'),
    ],
    [0, 320, 640].map((x) => ({ group: 'main > section', x, y: 400, w: 300, h: 200 })),
  );
  assert.deepEqual([...new Set(hits.map((h) => h.pattern))].sort(), KOREAN_TEXT_SLOP_PATTERNS.map((p) => p.id).sort(), 'every habit in the table');
  const listing = hits.find((h) => h.pattern === 'feature-list-dumping')!;
  assert.equal(listing.quote, '토론하고 문서를 고칩니다');
  assert.equal(listing.index, 1);
  assert.equal(listing.fix, '기능 나열 대신 구체적인 단 하나의 장면(누가, 어떤 순간에)으로 교체하라.');
  assert.ok(hits.some((h) => h.pattern === 'passive-explanation-tone' && /이어집니다/.test(h.message)), 'a run of explaining statements is reported as a run');
  assert.deepEqual(hits.filter((h) => h.pattern === 'generic-cta').map((h) => h.quote), ['시작하기', '더 알아보기']);
  assert.equal(hits.find((h) => h.pattern === 'uniform-card-grid')!.severity, 'minor');
  assert.equal(textSlopScore(hits), 100);

  // Sentences that were English first, wherever they stand; and a notice that has become a monologue.
  const translated = (role: InterfaceText['role'], text: string): string[] => lintInterfaceText([t(role, text)]).filter((h) => h.pattern === 'translationese').map((h) => h.quote);
  assert.deepEqual(translated('title', '관리비 도우미에 오신 것을 환영합니다'), ['에 오신 것을 환영']);
  assert.deepEqual(translated('cta', '새로운 정산을 경험해보세요'), ['경험해보세요']);
  assert.deepEqual(translated('body', '당신의 고지서를 한눈에.'), ['당신의']);
  assert.deepEqual(translated('body', '사진 분석을 통해 누수를 찾을 수 있어요.'), ['을 통해 누수를 찾을 수 있']);
  assert.deepEqual(translated('label', '당신의 기록'), [], 'a short label is too little to tell');
  const notice = hits.find((h) => h.pattern === 'long-notice')!;
  assert.deepEqual([notice.severity, notice.message], ['minor', '안내문 하나가 4문장입니다: "이 화면에서 지난달 고지서를 올릴 수 있어요. 올리면 항목별로 나눠서 보여 드려요. 평균보다 많이 나온 항목…"']);
  assert.deepEqual(lintInterfaceText([t('cta', '제출')]).map((h) => h.pattern), ['generic-cta']);
});

test('Korean copy lint leaves specific copy alone', () => {
  const clean = lintInterfaceText(
    [
      t('title', '채우는 쪽이 2,000원 이득이에요'),
      t('title', '새로운 경험 3가지'),
      t('body', '이번 주에 3건이 연체됐어요.'),
      t('body', '친구하고 봅니다.'),
      t('body', '저장했습니다. 다시 시도해 주세요.'),
      t('body', '알림을 관리합니다.'),
      t('cta', '사진에서 주소 지우기'),
      t('cta', '확인'),
      t('label', '시작하기'),
      t('body', '환영 인사는 생략할게요. 고지서 사진만 올려 주세요.'),
      t('body', '우체통을 통해 받은 고지서도 돼요.'),
    ],
    // Rows of a list are equal by nature; so are two cards, and boxes on different rows.
    [0, 80, 160, 240].map((y) => ({ group: 'ul', x: 0, y, w: 600, h: 80 })),
  );
  assert.deepEqual(clean, []);
  assert.equal(textSlopScore(clean), 0);
  // The same wording on every card is one thing to fix, not one per card.
  assert.equal(lintInterfaceText([t('cta', '시작하기'), t('cta', '시작하기'), t('cta', '시작하기')]).length, 1);
});

test('the brand is a fill of any lightness that always carries its text, and the wash is one more background text holds on', () => {
  for (let hue = 0; hue < 360; hue += 20) {
    for (const chroma of [0.08, 0.16, 0.26]) {
      for (const lightness of [0.3, 0.45, 0.55, 0.62, 0.7, 0.82, 0.92]) {
        const theme = createTheme({ hue, chroma, neutralChroma: 0.02, corners: 'soft', lightness, neutralHue: (hue + 180) % 360 });
        for (const mode of ['light', 'dark'] as const) {
          const p = theme[mode];
          const at = `${mode} hue ${hue} chroma ${chroma} lightness ${lightness}`;
          assert.ok(ratio(p, 'on-brand', 'brand') >= contract.contrast.text, `${at}: on-brand on brand = ${ratio(p, 'on-brand', 'brand').toFixed(2)}`);
          for (const token of TEXT_TOKENS) assert.ok(ratio(p, token, 'brand-soft') >= contract.contrast.text, `${at}: ${token} on brand-soft = ${ratio(p, token, 'brand-soft').toFixed(2)}`);
          // A fill that cannot carry text at the asked lightness is moved, and not far.
          assert.ok(Math.abs(p.brand.l - lightness) <= 0.17, `${at}: brand moved from ${lightness} to ${p.brand.l.toFixed(2)}`);
        }
        assert.deepEqual(theme.light.brand, theme.dark.brand, 'the brand is the product\'s colour: the same in both schemes');
      }
    }
  }
  // A bright brand stays bright and takes dark text; a deep one takes light text. That is the point of it.
  const bright = createTheme({ hue: 60, chroma: 0.16, neutralChroma: 0.01, corners: 'round', lightness: 0.82 }).light;
  assert.ok(bright.brand.l >= 0.8 && bright['on-brand'].l < 0.3);
  const deep = createTheme({ hue: 260, chroma: 0.16, neutralChroma: 0.01, corners: 'sharp', lightness: 0.32 }).light;
  assert.ok(deep.brand.l <= 0.34 && deep['on-brand'].l > 0.9);
  // The neutrals may lean somewhere the brand does not.
  assert.equal(createTheme({ hue: 250, chroma: 0.16, neutralChroma: 0.02, corners: 'soft', neutralHue: 80 }).light.bg.h, 80);
  // A seed from before there was a brand keeps the look it had: the brand is its accent.
  const old = createTheme({ hue: 168, chroma: 0.12, neutralChroma: 0.008, corners: 'soft' }).light;
  assert.deepEqual([old.brand.l, old.brand.h], [old.accent.l, old.accent.h]);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { referenceSeed, referenceThemePath, renderReferenceTheme } from '../src/build.ts';
import { KOREAN_TEXT_SLOP_PATTERNS, THEME_GENERATOR, colorTokens, contract, contractFamilies, contrastRatio, cornerRadii, createTheme, faceStack, faces, hostedFamilies, isAllowedDuration, isAllowedRadius, isDisplayInProportion, isOnTypeScale, lineHeightFor, lintInterfaceText, lintSources, mobileTokens, oklchToRgb, parseHex, renderThemeCss, secondHueFor, seedFromName, textSlopScore, typeStepNames, type InterfaceText, type Palette } from '../src/index.ts';

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
  assert.equal(typeStepNames.length, contract.typeScalePx.length, 'every step of the scale has a name');
  contract.typeScalePx.forEach((size, i) => assert.ok(css.includes(`--text-${typeStepNames[i]}: ${size / 16}rem;`), `text step ${size}px`));
  // The micro step sits below xs; the names above it keep their sizes (text-base is still 16px).
  for (const step of ['--text-2xs: 0.6875rem;', '--text-xs: 0.75rem;', '--text-sm: 0.875rem;', '--text-base: 1rem;', '--text-10xl: 10rem;']) assert.ok(css.includes(step), step);
  // One face sets the whole product: the body stack is that face and then the device's own, and titles share it.
  assert.ok(css.includes('--font-sans: "Pretendard Variable", "Pretendard", -apple-system, '), 'the face, then the system fallback, and no second face between them');
  assert.ok(css.includes('--font-display: "Pretendard Variable", "Pretendard", -apple-system, '), 'titles are the same face, heavier');
  assert.equal(/--font-sans: ([^;]+);/.exec(css)![1], /--font-display: ([^;]+);/.exec(css)![1]);
  assert.equal(css.split('\n')[1], `/* generator ${THEME_GENERATOR} */`, 'the sheet says which generator wrote it, so an older one can be told apart');
  assert.equal(THEME_GENERATOR, 5);
  assert.ok(css.includes(`min-block-size: ${contract.touchTargetPx}px`));
  assert.ok(css.includes('prefers-reduced-motion'));
});

test('a phone screen is a hierarchy of eight sizes down to 11px, on paper that never turns to cream', () => {
  assert.ok(isOnTypeScale(11), '11px: a timestamp, a badge, a stat label');
  assert.ok(!isOnTypeScale(10), 'below the scale');
  assert.equal(contract.maxFontSizesPerView, 8, 'header, subheader, body, secondary, caption, micro and one or two figures');
  assert.equal(contract.minBodyPx, 16, 'running text keeps the floor Apple and Toss set body at; the small steps are for labels');
  for (let i = 0; i < 500; i++) {
    const seed = seedFromName(`project-${i}`);
    assert.ok(seed.neutralChroma <= 0.005, `placeholder ${i}: neutral chroma ${seed.neutralChroma} would tint the paper`);
    assert.ok(seed.chroma >= 0.12 && seed.lightness! >= 0.4 && seed.lightness! <= 0.75, `placeholder ${i}: brand ${seed.chroma} / ${seed.lightness} is outside the band the tool admits`);
  }
  assert.ok(referenceSeed.neutralChroma <= 0.005, 'the studio\'s own paper obeys the same rule');
  // Every choice inside the tool's band comes out legible: the vivid end and both ends of brand lightness included.
  for (let hue = 0; hue < 360; hue += 15) {
    for (const [chroma, lightness] of [[0.12, 0.4], [0.28, 0.4], [0.2, 0.55], [0.12, 0.75], [0.28, 0.75]] as const) {
      const theme = createTheme({ hue, chroma, lightness, neutralChroma: 0.005, corners: 'soft' });
      for (const mode of ['light', 'dark'] as const) {
        for (const bg of BACKGROUNDS) for (const token of TEXT_TOKENS) assert.ok(ratio(theme[mode], token, bg) >= contract.contrast.text, `${mode} hue ${hue} chroma ${chroma} lightness ${lightness}: ${token} on ${bg}`);
        assert.ok(ratio(theme[mode], 'on-brand', 'brand') >= contract.contrast.text, `${mode} hue ${hue} chroma ${chroma} lightness ${lightness}: on-brand on brand`);
      }
    }
  }
});

test('the committed theme.css is the output of the generator', () => {
  assert.equal(readFileSync(referenceThemePath, 'utf8'), renderReferenceTheme(), 'run `pnpm design:build`');
  // The reference sheet ships without a fonts folder beside it, so it names the face and points at no file.
  assert.equal(renderReferenceTheme(), renderThemeCss(createTheme(referenceSeed), contract, { fontFiles: false }));
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
  for (const family of ['Pretendard Variable', 'Pretendard', 'SUIT Variable', 'SUIT', 'SUITE Variable', 'SUITE', 'Geist Mono']) assert.ok(contractFamilies().includes(family) && hostedFamilies().includes(family), `${family} is a face a project loads`);
  assert.equal(hostedFamilies().length, 7, 'the three faces under both their names, and the code face');
  // The faces a product could once pick for its titles are no longer faces of the contract at all.
  for (const family of ['Geist', 'Fraunces', 'Instrument Serif', 'Bricolage Grotesque', 'Noto Serif KR', 'Gowun Batang']) assert.ok(!contractFamilies().includes(family), `${family} is not a theme face`);
  for (const family of ['-apple-system', 'system-ui', 'sans-serif', 'Menlo', 'monospace']) assert.ok(contractFamilies().includes(family) && !hostedFamilies().includes(family), `${family} is the device's own`);
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

test('the face, corners and motion vary by seed and reach the generated theme', () => {
  const names = Array.from({ length: 200 }, (_, i) => seedFromName(`project-${i}`));
  assert.deepEqual([...new Set(names.map((s) => s.face))].sort(), [...faces].sort(), 'every face is reachable');
  assert.deepEqual([...new Set(names.map((s) => s.corners))].sort(), ['round', 'sharp', 'soft']);

  const suite = renderThemeCss(createTheme({ ...referenceSeed, corners: 'round', face: 'suite' }));
  assert.ok(suite.includes('--font-sans: "SUITE Variable", "SUITE", -apple-system, '), 'the chosen face leads the body stack');
  assert.ok(suite.includes('--font-display: "SUITE Variable", "SUITE", -apple-system, '), 'and the title stack, which is the same one');
  assert.ok(!/Pretendard|"SUIT"|"SUIT Variable"/.test(suite), 'a product names one face and no other');
  for (const [step, px] of Object.entries(cornerRadii.round)) assert.ok(suite.includes(`--radius-${step}: ${px}px;`), `round ${step}`);
  assert.ok(Object.values(cornerRadii).every((r) => Object.values(r).every((px) => isAllowedRadius(px))));
  const [entrance, page] = [/--duration-entrance: (\d+)ms/.exec(suite), /--duration-page: (\d+)ms/.exec(suite)].map((m) => Number(m![1]));
  assert.ok(entrance! >= contract.motion.entranceMs[0] && entrance! <= contract.motion.entranceMs[1]);
  assert.ok(page! >= contract.motion.pageMs[0] && page! <= contract.motion.pageMs[1]);
  // A seed that names no face is set in Pretendard.
  assert.ok(renderThemeCss(createTheme(referenceSeed)).includes('--font-sans: "Pretendard Variable", "Pretendard", '));
  assert.deepEqual(faceStack('suit'), ['SUIT Variable', 'SUIT', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif']);
});

test('the sheet points at the one file of its face, beside itself, unless it is asked not to', () => {
  const files = { pretendard: ['Pretendard Variable', 'PretendardVariable.woff2', '45 920'], suit: ['SUIT Variable', 'SUIT-Variable.woff2', '100 900'], suite: ['SUITE Variable', 'SUITE-Variable.woff2', '300 900'] } as const;
  for (const face of faces) {
    const theme = createTheme({ ...referenceSeed, face });
    const css = renderThemeCss(theme);
    const rules = [...css.matchAll(/@font-face \{([^}]+)\}/g)].map((m) => m[1]!);
    assert.equal(rules.length, 1, `${face}: one face, one file`);
    const [family, file, weight] = files[face];
    assert.ok(rules[0]!.includes(`font-family: "${family}";`), `${face}: under the name the stack leads with`);
    assert.ok(rules[0]!.includes(`src: url("./fonts/${file}") format("woff2-variations");`), `${face}: ${rules[0]}`);
    assert.ok(rules[0]!.includes(`font-weight: ${weight};`) && rules[0]!.includes('font-display: swap;'), `${face}: the whole weight range, shown in the fallback until it arrives`);
    assert.ok(css.indexOf('@font-face') < css.indexOf(':root {'), 'the face is declared before anything uses it');
    // A page that carries its faces itself (a mock-up) takes the tokens without the pointer to a file it does not have.
    const tokens = renderThemeCss(theme, contract, { fontFiles: false });
    assert.ok(!tokens.includes('@font-face'));
    assert.equal(tokens, css.replace(/@font-face \{[^}]+\}\n\n/, ''), 'and is otherwise the same sheet');
    assert.deepEqual(lintSources([{ path: 'src/styles/theme.css', content: css }]), []);
  }
});

const SERIES = ['series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6'] as const;
const STATE_HUES = [27, 75, 152];
const hueApart = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

test('a second colour for the other side: derived clear of the state colours, a fill that carries its text, with a wash text holds on', () => {
  for (let hue = 0; hue < 360; hue += 15) {
    for (const chroma of [0.12, 0.2, 0.28]) {
      const second = secondHueFor({ hue, chroma, neutralChroma: 0.005, corners: 'soft' });
      // One of five hues that stay clean as a fill, never the red, amber or green that mean state, and far from the brand.
      assert.ok([50, 215, 255, 300, 345].includes(second), `brand hue ${hue}: ${second}`);
      for (const state of STATE_HUES) assert.ok(hueApart(second, state) >= 20, `brand hue ${hue}: the second colour at ${second} would read as the state colour at ${state}`);
      assert.ok(hueApart(second, hue) >= 90, `brand hue ${hue}: the second colour at ${second} is too near the brand to be the other side`);
      for (const lightness of [undefined, 0.4, 0.55, 0.75]) {
        const theme = createTheme({ hue, chroma, neutralChroma: 0.005, corners: 'soft', ...(lightness === undefined ? {} : { lightness }) });
        for (const mode of ['light', 'dark'] as const) {
          const p = theme[mode];
          const at = `${mode} hue ${hue} chroma ${chroma} lightness ${lightness}`;
          assert.ok(ratio(p, 'on-second', 'second') >= contract.contrast.text, `${at}: on-second on second = ${ratio(p, 'on-second', 'second').toFixed(2)}`);
          for (const token of TEXT_TOKENS) assert.ok(ratio(p, token, 'second-soft') >= contract.contrast.text, `${at}: ${token} on second-soft = ${ratio(p, token, 'second-soft').toFixed(2)}`);
          assert.equal(p.second.h, second, `${at}: the fill is at the derived hue`);
          assert.ok(p.second.c <= Math.min(chroma, 0.16) + 1e-9, `${at}: the second colour is no louder than the brand, and never past 0.16`);
          // A real build's first derivation gave a cobalt brand a dark olive for its other side: the complement, at the brand's lightness, where a yellow has no strength.
          assert.ok(p.second.c >= Math.min(chroma, 0.16) - 0.045, `${at}: the second colour is a clean colour, not a mud (chroma ${p.second.c.toFixed(3)} at lightness ${p.second.l.toFixed(2)})`);
        }
      }
    }
  }
  // Where the complement is already clear it is the complement; where it is not, it moves by the least it takes.
  assert.equal(secondHueFor({ hue: 258, chroma: 0.2, neutralChroma: 0, corners: 'soft' }), 50, 'a cobalt brand meets an orange');
  assert.equal(secondHueFor({ hue: 28, chroma: 0.2, neutralChroma: 0, corners: 'soft' }), 215, 'a coral brand meets a sky blue');
  assert.equal(secondHueFor({ hue: 168, chroma: 0.2, neutralChroma: 0, corners: 'soft' }), 345, 'a teal brand meets a magenta');
  assert.equal(secondHueFor({ hue: 55, chroma: 0.2, neutralChroma: 0, corners: 'soft' }), 215, 'an amber brand meets a sky blue');
  // An orange is only an orange when it is light, and a blue when it is deep: each is set where it is strong.
  const cobalt = createTheme({ hue: 258, chroma: 0.22, lightness: 0.5, neutralChroma: 0.004, corners: 'sharp' }).light;
  assert.ok(cobalt.second.l >= 0.7 && cobalt.second.c >= 0.14, `the other side of cobalt is a clear orange: ${cobalt.second.l.toFixed(2)} / ${cobalt.second.c.toFixed(3)}`);
  // A seed that names its second colour keeps it, whatever it is.
  const chosen = { hue: 48, chroma: 0.19, neutralChroma: 0.004, corners: 'round', secondHue: 200 } as const;
  assert.equal(secondHueFor(chosen), 200);
  assert.equal(createTheme(chosen).light.second.h, 200);
  assert.match(renderThemeCss(createTheme(chosen)), /seed: hue 48, [^\n]*round corners, set in Pretendard Variable, second colour at hue 200 \*\//);
  // A seed from before there was a second colour keeps every token it had, value for value.
  const before = renderThemeCss(createTheme(referenceSeed));
  for (const [token, value] of [['fg-muted', 'oklch(41.81% 0.0050 168.0)'], ['accent', 'oklch(40.84% 0.0828 168.0)'], ['brand-soft', 'oklch(94.00% 0.0420 168.0)'], ['danger', 'oklch(43.94% 0.1700 27.0)']] as const) assert.ok(before.includes(`--sz-${token}: ${value};`), token);
});

test('six colours for data: spread from the brand, seen on every surface, and told apart by lightness as well as hue', () => {
  for (let hue = 0; hue < 360; hue += 15) {
    for (const chroma of [0.12, 0.2, 0.28]) {
      const theme = createTheme({ hue, chroma, neutralChroma: 0.005, corners: 'soft' });
      for (const mode of ['light', 'dark'] as const) {
        const p = theme[mode];
        assert.equal(p['series-1'].h, hue, 'the series starts at the brand\'s hue');
        SERIES.forEach((token, i) => {
          // A mark of data is a meaningful graphic (WCAG 1.4.11) wherever it is drawn: on paper, on a surface, in a well, on a wash.
          for (const bg of [...BACKGROUNDS, 'brand-soft', 'second-soft'] as const) assert.ok(ratio(p, token, bg) >= contract.contrast.nonText, `${mode} hue ${hue}: ${token} on ${bg} = ${ratio(p, token, bg).toFixed(2)}`);
          // A sixth of the way round each time, except that a hue which would land between amber and lime (a mud at
          // the lightness a mark needs on paper) is the orange or the green beside it.
          const even = (hue + i * 60) % 360;
          const expected = i === 0 || even < 62 || even > 128 ? even : even < 95 ? 55 : 135;
          assert.equal(Math.round(p[token].h), expected, `${token} is ${i} sixths of the way round, or beside the mud`);
          const next = p[SERIES[(i + 1) % SERIES.length]!];
          assert.ok(Math.abs(p[token].l - next.l) >= 0.1, `${mode} hue ${hue}: ${token} and its neighbour differ by ${Math.abs(p[token].l - next.l).toFixed(3)} in lightness`);
        });
      }
    }
  }
  const css = renderThemeCss(createTheme(referenceSeed));
  for (const utility of ['second', 'on-second', 'second-soft', 'series-1', 'series-3', 'series-6']) assert.ok(css.includes(`--color-${utility}: var(--sz-${utility});`), `bg-${utility} compiles`);
  assert.equal(colorTokens.filter((token) => /^series-\d$/.test(token)).length, 6);
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

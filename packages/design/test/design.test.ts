import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { referenceSeed, referenceThemePath } from '../src/build.ts';
import { colorTokens, contract, contrastRatio, createTheme, lintSources, oklchToRgb, parseHex, renderThemeCss, seedFromName, typeStepNames, type Palette } from '../src/index.ts';

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

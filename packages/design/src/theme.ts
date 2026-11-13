import { contrastRatio, formatOklch, oklchToRgb, solveForContrast, toSrgbGamut, type Oklch } from './color.ts';
import { contract as defaultContract, displayFaces, lineHeightFor, typeStepNames, type DesignContract, type DisplayFace } from './contract.ts';

/** What makes one project's skin different from another's. Everything else is derived. */
export interface ThemeSeed {
  /** Brand hue in OKLCH degrees. */
  hue: number;
  /** Brand chroma, 0.06 (muted) – 0.2 (vivid). */
  chroma: number;
  /** How strongly neutrals lean toward the brand hue, 0 (pure grey) – 0.02. */
  neutralChroma: number;
  corners: Corners;
  /** The face titles are set in. Left out: the body face. */
  display?: DisplayFace;
  /**
   * How light the brand colour is, 0.3 (deep) – 0.92 (pale). The brand is a fill, not a text colour, so it may be
   * as bright as the subject asks: the text that sits on it is solved. Left out: as dark as the accent.
   */
  lightness?: number;
  /** The hue the neutrals lean toward. Left out: the brand's. Warm paper under a cold brand is a choice. */
  neutralHue?: number;
}

export type Corners = 'sharp' | 'soft' | 'round';

/** The radius steps of each corner style, in px: sm, md, lg, xl. `round` is the organic end: capsules and deep curves. */
export const cornerRadii: Record<Corners, { sm: number; md: number; lg: number; xl: number }> = {
  sharp: { sm: 0, md: 4, lg: 8, xl: 12 },
  soft: { sm: 4, md: 8, lg: 12, xl: 20 },
  round: { sm: 6, md: 14, lg: 22, xl: 30 },
};

export const colorTokens = [
  'bg',
  'surface',
  'sunken',
  'border',
  'control-border',
  'fg',
  'fg-muted',
  'accent',
  'on-accent',
  'brand',
  'on-brand',
  'brand-soft',
  'danger',
  'success',
  'warning',
] as const;
export type ColorToken = (typeof colorTokens)[number];
export type Palette = Record<ColorToken, Oklch>;

export interface Theme {
  seed: ThemeSeed;
  light: Palette;
  dark: Palette;
}

/** Headroom over the WCAG thresholds so rounding to 8-bit sRGB can never drop a token below the line. */
const MARGIN = 0.25;

/**
 * A colour to fill with, and the text that sits on it.
 *
 * One token cannot be both the colour of small text on paper and the colour of a button: the first has to be
 * dark, and every hue is dull when it is dark. So the product's own colour is a fill. The text on it is the
 * near-black or the near-white, whichever the fill carries at AAA; a mid-lightness fill carries neither, and is
 * moved by the least it takes (lighter or darker) until it does. What comes back always holds its text.
 */
function fillAndText(want: Oklch, ink: Oklch, paper: Oklch, target: number): { fill: Oklch; on: Oklch } {
  const inkRgb = oklchToRgb(ink);
  const paperRgb = oklchToRgb(paper);
  for (let step = 0; step <= 140; step++) {
    for (const l of step === 0 ? [want.l] : [want.l + step * 0.005, want.l - step * 0.005]) {
      if (l < 0.2 || l > 0.97) continue;
      const fill = toSrgbGamut({ ...want, l });
      const rgb = oklchToRgb(fill);
      if (contrastRatio(inkRgb, rgb) >= target) return { fill, on: ink };
      if (contrastRatio(paperRgb, rgb) >= target) return { fill, on: paper };
    }
  }
  throw new Error(`no fill near lightness ${want.l.toFixed(2)} carries text at ${target}:1`);
}

function palette(seed: ThemeSeed, mode: 'light' | 'dark', c: DesignContract): Palette {
  const neutral = (l: number): Oklch => ({ l, c: seed.neutralChroma, h: seed.neutralHue ?? seed.hue });
  const light = mode === 'light';
  const bg = neutral(light ? 0.985 : 0.165);
  const surface = neutral(light ? 0.998 : 0.205);
  const sunken = neutral(light ? 0.962 : 0.135);
  // A wash of the brand, for a region that should read as the product's own without shouting.
  const soft = toSrgbGamut({ l: light ? 0.94 : 0.26, c: Math.min(0.05, seed.chroma * 0.35), h: seed.hue });
  // Text must clear the bar on whichever background is hardest for it: the darkest one in light mode,
  // the lightest one in dark mode. The brand wash is one of them.
  const hardest = light ? (soft.l < sunken.l ? soft : sunken) : soft.l > surface.l ? soft : surface;
  const text = (hue: number, chroma: number): Oklch => solveForContrast({ against: hardest, hue, chroma, target: c.contrast.text + MARGIN, darker: light });
  const accent = text(seed.hue, seed.chroma);
  // The brand is the same colour in both schemes: it is the product's, not the page's.
  const brand = fillAndText({ l: seed.lightness ?? text(seed.hue, seed.chroma).l, c: seed.chroma, h: seed.hue }, neutral(0.13), neutral(0.995), c.contrast.text + MARGIN);
  return {
    bg,
    surface,
    sunken,
    border: neutral(light ? 0.9 : 0.29),
    'control-border': solveForContrast({ against: hardest, hue: seed.hue, chroma: seed.neutralChroma, target: c.contrast.nonText + MARGIN, darker: light }),
    fg: neutral(light ? 0.2 : 0.96),
    'fg-muted': text(seed.hue, seed.neutralChroma),
    accent,
    // Text on a solid accent fill. The accent already clears AAA against the page backgrounds, and this
    // token is further from the accent than any of them.
    'on-accent': neutral(light ? 0.995 : 0.13),
    brand: brand.fill,
    'on-brand': brand.on,
    'brand-soft': soft,
    danger: text(27, 0.17),
    success: text(152, 0.13),
    warning: text(75, 0.13),
  };
}

export function createTheme(seed: ThemeSeed, c: DesignContract = defaultContract): Theme {
  return { seed, light: palette(seed, 'light', c), dark: palette(seed, 'dark', c) };
}

/**
 * A stable, distinct seed per project name, so a new project never starts from the same palette as the last.
 * Steers around the indigo–violet band that reads as an unstyled default.
 */
export function seedFromName(name: string): ThemeSeed {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619) >>> 0;
  let hue = hash % 360;
  if (hue >= 250 && hue <= 305) hue = (hue + 80) % 360;
  const corners = (['sharp', 'soft', 'round'] as const)[(hash >>> 17) % 3]!;
  // Titles differ from project to project as palettes do: the seed picks the face, and one in four keeps the body face.
  // The top bits of this hash barely move between similar names, so the face is picked from a second mix of it.
  const mixed = Math.imul(hash ^ (hash >>> 15), 2246822507) >>> 0;
  const display = displayFaces[(mixed >>> 13) % displayFaces.length]!;
  // A name says nothing about a product, so this is a placeholder until someone chooses from the subject. It is
  // still spread over deep and bright brands, so two placeholders do not look like the same product.
  const lightness = 0.4 + ((mixed >>> 5) % 5) * 0.1;
  return { hue, chroma: 0.11 + ((hash >>> 9) % 7) * 0.01, neutralChroma: 0.004 + ((hash >>> 13) % 4) * 0.003, corners, display, lightness };
}

const px = (n: number): string => `${n / 16}rem`;

function vars(p: Palette, indent: string): string {
  return colorTokens.map((t) => `${indent}--sz-${t}: ${formatOklch(p[t])};`).join('\n');
}

/**
 * Emits the project's Tailwind v4 theme. Import it after `@import "tailwindcss"`.
 *
 * It replaces Tailwind's default colour, type, radius and shadow scales outright (`--color-*: initial` and
 * friends). The stock palette is not merely discouraged: `bg-indigo-500` and `rounded-3xl` do not compile to
 * anything, so the look they produce is unavailable by construction.
 */
export function renderThemeCss(theme: Theme, c: DesignContract = defaultContract): string {
  const radii = cornerRadii[theme.seed.corners];
  const face = theme.seed.display ?? 'sans';
  const displayStack = [...c.fonts.display[face], ...c.fonts.sans].filter((family, i, all) => all.indexOf(family) === i);
  const mid = ([from, to]: readonly [number, number]): number => Math.round((from + to) / 20) * 10;
  const type = c.typeScalePx
    .map((size, i) => {
      const name = typeStepNames[i]!;
      const tracking = size > c.display.fromPx ? '-0.03em' : size >= 30 ? '-0.02em' : size >= 20 ? '-0.01em' : '0';
      return `  --text-${name}: ${px(size)};\n  --text-${name}--line-height: ${lineHeightFor(size)};\n  --text-${name}--letter-spacing: ${tracking};`;
    })
    .join('\n');

  return `/* Generated by @studio-zero/design from the design contract. Edit the seed, not this file. */
/* seed: hue ${theme.seed.hue}, chroma ${theme.seed.chroma},${theme.seed.lightness === undefined ? '' : ` brand lightness ${theme.seed.lightness},`} neutral chroma ${theme.seed.neutralChroma}${theme.seed.neutralHue === undefined ? '' : ` toward hue ${theme.seed.neutralHue}`}, ${theme.seed.corners} corners, ${face === 'sans' ? 'titles in the body face' : `titles in ${c.fonts.display[face].join(' + ')}`} */

:root {
  color-scheme: light dark;
${vars(theme.light, '  ')}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${vars(theme.dark, '    ')}
  }
}

:root[data-theme="dark"] {
${vars(theme.dark, '  ')}
}

/* Scoped palettes: put one on any element to set that subtree in the other scheme (an ink side rail beside a
   paper page, say). Text and background tokens stay paired, so contrast holds inside the scope. */
.theme-dark {
  color-scheme: dark;
${vars(theme.dark, '  ')}
  color: var(--sz-fg);
}
.theme-light {
  color-scheme: light;
${vars(theme.light, '  ')}
  color: var(--sz-fg);
}

@theme inline {
  /* Semantic colours only. Text tokens are solved to WCAG AAA (${c.contrast.text}:1) on every background token.
     brand is a fill (the product's own colour, as bright as it needs to be) and on-brand the text it carries. */
  --color-*: initial;
${colorTokens.map((t) => `  --color-${t}: var(--sz-${t});`).join('\n')}

  --font-sans: ${c.fonts.sans.map(quoteFamily).join(', ')};
  --font-mono: ${c.fonts.mono.map(quoteFamily).join(', ')};
  /* Titles: font-display. Self-host the faces it names, as for the body face. */
  --font-display: ${displayStack.map(quoteFamily).join(', ')};

  /* ${c.typeScalePx.length} sizes. The steps above ${c.display.fromPx}px are display type: one headline on an introduction screen, ${c.display.ratioToBody[0]} to ${c.display.ratioToBody[1]} times the body size. */
  --text-*: initial;
${type}

  /* ${c.spacingUnitPx}px rhythm: p-4 is ${c.spacingUnitPx * 4}px, gap-6 is ${c.spacingUnitPx * 6}px. */
  --spacing: ${px(c.spacingUnitPx)};

  --radius-*: initial;
  --radius-sm: ${radii.sm}px;
  --radius-md: ${radii.md}px;
  --radius-lg: ${radii.lg}px;
  --radius-xl: ${radii.xl}px;
  --radius-full: 9999px;

  /* Two elevations. Depth is mostly carried by surface colour and borders, not by blur. */
  --shadow-*: initial;
  --shadow-sm: 0 1px 2px oklch(0% 0 0 / 0.06), 0 1px 1px oklch(0% 0 0 / 0.04);
  --shadow-md: 0 8px 24px -8px oklch(0% 0 0 / 0.16), 0 2px 4px oklch(0% 0 0 / 0.05);

  --ease-out: ${c.motion.easing};
${c.motion.durationsMs.map((ms, i) => `  --duration-${['fast', 'base', 'slow'][i] ?? i}: ${ms}ms;`).join('\n')}
  /* The one entrance a screen may stage (${c.motion.entranceMs[0]}-${c.motion.entranceMs[1]}ms) and a move between pages (${c.motion.pageMs[0]}-${c.motion.pageMs[1]}ms). */
  --duration-entrance: ${mid(c.motion.entranceMs)}ms;
  --duration-page: ${mid(c.motion.pageMs)}ms;
}

@layer base {
  html {
    font-family: var(--font-sans);
    font-size: 100%;
    line-height: ${lineHeightFor(16)};
    color: var(--color-fg);
    background: var(--color-bg);
    -webkit-text-size-adjust: 100%;
    text-rendering: optimizeLegibility;
  }

  /* Hangul breaks between words, not inside them; headings balance their lines. */
  :lang(ko) { word-break: keep-all; overflow-wrap: anywhere; }
  h1, h2, h3 { text-wrap: balance; }
  p, li { text-wrap: pretty; max-inline-size: ${c.maxLineLengthCh}ch; }

  :focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }

  /* What can be pressed gives way while it is held, so no control is inert by default. A component may answer
     more fully (a change of surface, a deeper press); it should not answer less. */
  :where(button, [role="button"], a[class], summary, label[for]):where(:not(:disabled, [aria-disabled="true"])):active {
    transform: translateY(1px);
    opacity: 0.78;
  }

  /* Touch devices get ${c.touchTargetPx}px targets without every component having to remember. */
  @media (pointer: coarse) {
    :where(button, [role="button"], a[class], input:not([type="checkbox"], [type="radio"]), select, summary) {
      min-block-size: ${c.touchTargetPx}px;
      min-inline-size: ${c.touchTargetPx}px;
    }
    :where(input, select, textarea) { font-size: max(1rem, 1em); }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
}
`;
}

function quoteFamily(family: string): string {
  return /^[a-z-]+$/.test(family) ? family : `"${family}"`;
}

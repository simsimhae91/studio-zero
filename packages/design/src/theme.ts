import { contrastRatio, formatOklch, oklchToRgb, relativeLuminance, solveForContrast, toSrgbGamut, type Oklch } from './color.ts';
import { contract as defaultContract, faceStack, faces, lineHeightFor, typeStepNames, type DesignContract, type Face } from './contract.ts';

/** What makes one project's skin different from another's. Everything else is derived. */
export interface ThemeSeed {
  /** Brand hue in OKLCH degrees. */
  hue: number;
  /** Brand chroma, 0.12 (clear) – 0.28 (electric). The brand is the one colour on the screen; a muted one is not seen. */
  chroma: number;
  /**
   * How strongly neutrals lean toward the brand hue, 0 (pure grey) – 0.005 (the faintest lean). Past that the
   * paper reads as a colour of its own (cream under a warm brand, which a real build shipped as #fff9f5), and the
   * screen loses the clean canvas the brand is meant to punch through.
   */
  neutralChroma: number;
  corners: Corners;
  /** The one face the product is set in, titles included. Left out: Pretendard. */
  face?: Face;
  /**
   * How light the brand colour is, 0.4 (deep) – 0.75 (bright). The brand is a fill, not a text colour, so the text
   * that sits on it is solved; darker it reads as ink, lighter as a pastel wash, and neither is a punch. Left out:
   * as dark as the accent.
   */
  lightness?: number;
  /** The hue the neutrals lean toward. Left out: the brand's. Warm paper under a cold brand is a choice. */
  neutralHue?: number;
  /**
   * The hue of the second colour: the other side, when a product has two (me and them, in and out). Left out: it
   * is derived from the brand's complement, see `secondHueFor`. Chosen only when the two sides are the product's.
   */
  secondHue?: number;
}

export type Corners = 'sharp' | 'soft' | 'round';

/**
 * The radius steps of each corner style, in px: sm, md, lg, xl. `round` is the organic end: capsules and deep
 * curves. Every style's xl is 16px or more: a card is rounded-xl (the handbook's rule E4), and the look the owner
 * chose has no card tighter than that. `sharp` was 0, 4, 8, 12 until then.
 */
export const cornerRadii: Record<Corners, { sm: number; md: number; lg: number; xl: number }> = {
  sharp: { sm: 2, md: 6, lg: 10, xl: 16 },
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
  'second',
  'on-second',
  'second-soft',
  'danger',
  'success',
  'warning',
  'series-1',
  'series-2',
  'series-3',
  'series-4',
  'series-5',
  'series-6',
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

/** The hues that mean state: danger, warning, success. */
const STATE_HUE = { danger: 27, warning: 75, success: 152 } as const;
const hueApart = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * Hues at which a fill is a clean, strong colour, each with the lightness where it is one: an orange is only an
 * orange when it is light, a blue when it is deep. None is the red, amber or green that mean state.
 */
const SECOND_ANCHORS = [
  { hue: 50, lightness: 0.74 },
  { hue: 215, lightness: 0.7 },
  { hue: 255, lightness: 0.52 },
  { hue: 300, lightness: 0.52 },
  { hue: 345, lightness: 0.52 },
] as const;

/**
 * The hue of a theme's second colour: the seed's own when it names one, else the one of five clean hues that is
 * furthest from the brand.
 *
 * A theme had one colour, so a screen with two sides (two players, in and out) drew one side in the brand and the
 * other in white, and one whole card turned blue. The first derivation took the brand's complement at the
 * brand's lightness, which gave a cobalt brand a dark olive for its other side: a yellow has no strength when it
 * is dark. So the other side is chosen from hues that are strong somewhere, and set where each is.
 */
export function secondHueFor(seed: ThemeSeed): number {
  if (seed.secondHue !== undefined) return seed.secondHue;
  return [...SECOND_ANCHORS].sort((a, b) => hueApart(b.hue, seed.hue) - hueApart(a.hue, seed.hue))[0]!.hue;
}

/** How light the second colour is asked to be: where its hue is strong when that is known, else as light as the brand. */
function secondLightness(hue: number, brandLightness: number): number {
  const anchor = SECOND_ANCHORS.find((a) => hueApart(a.hue, hue) <= 20);
  return anchor ? anchor.lightness : brandLightness;
}

/** The second colour is never louder than this, however vivid the brand: it marks a side, it does not compete. */
const SECOND_MAX_CHROMA = 0.16;

/**
 * The data series: six hues a sixth of the wheel apart, starting at the brand's, at one chroma. Lightness
 * alternates from one to the next, so neighbours are told apart by someone who cannot tell their hues apart.
 * Both steps of each scheme hold 3:1 (WCAG 1.4.11) on every background of that scheme. On paper that puts the
 * lighter step at 0.60: at 0.70, where a chart palette usually sits, the greens are 2.4:1 on the page.
 */
const SERIES = { count: 6, chroma: 0.14, lightness: { light: [0.48, 0.6], dark: [0.7, 0.82] } } as const;

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
  // The second colour is a fill like the brand, set where its hue is strong, and solved the same way for the text
  // it carries.
  const secondHue = secondHueFor(seed);
  const secondChroma = Math.min(seed.chroma, SECOND_MAX_CHROMA);
  const second = fillAndText({ l: secondLightness(secondHue, brand.fill.l), c: secondChroma, h: secondHue }, neutral(0.13), neutral(0.995), c.contrast.text + MARGIN);
  // Its wash is one more background text sits on. Text was solved against the hardest background there was, so
  // this one is kept no harder than that: no darker than it on paper, no lighter than it in the dark. Nothing
  // that was solved before there was a second colour moves.
  const luminance = (colour: Oklch): number => relativeLuminance(oklchToRgb(colour));
  let secondSoft = toSrgbGamut({ l: soft.l, c: Math.min(0.05, secondChroma * 0.35), h: secondHue });
  for (let nudge = 0; nudge < 50 && (light ? luminance(secondSoft) < luminance(hardest) : luminance(secondSoft) > luminance(hardest)); nudge++) {
    secondSoft = toSrgbGamut({ ...secondSoft, l: secondSoft.l + (light ? 0.002 : -0.002) });
  }
  // Between amber and lime a colour dark enough to be seen on paper is a mud. A series hue that lands there is moved
  // to the orange or the green beside it; the first of the series stays the brand's own hue whatever it is.
  const seriesHue = (n: number): number => {
    const hue = (seed.hue + (n * 360) / SERIES.count) % 360;
    return n === 0 || hue < 62 || hue > 128 ? hue : hue < 95 ? 55 : 135;
  };
  const series = (n: number): Oklch => toSrgbGamut({ l: SERIES.lightness[mode][n % 2]!, c: SERIES.chroma, h: seriesHue(n) });
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
    second: second.fill,
    'on-second': second.on,
    'second-soft': secondSoft,
    danger: text(STATE_HUE.danger, 0.17),
    success: text(STATE_HUE.success, 0.13),
    warning: text(STATE_HUE.warning, 0.13),
    'series-1': series(0),
    'series-2': series(1),
    'series-3': series(2),
    'series-4': series(3),
    'series-5': series(4),
    'series-6': series(5),
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
  // The face differs from project to project as palettes do: the seed picks one of the three.
  // The top bits of this hash barely move between similar names, so the face is picked from a second mix of it.
  const mixed = Math.imul(hash ^ (hash >>> 15), 2246822507) >>> 0;
  const face = faces[(mixed >>> 13) % faces.length]!;
  // A name says nothing about a product, so this is a placeholder until someone chooses from the subject. It is
  // still spread over deep and bright brands, so two placeholders do not look like the same product, and it stays
  // inside the band the set_theme tool admits: a clear brand on near-white paper.
  const lightness = 0.4 + ((mixed >>> 5) % 4) * 0.1;
  return { hue, chroma: 0.12 + ((hash >>> 9) % 7) * 0.01, neutralChroma: ((hash >>> 13) % 6) * 0.001, corners, face, lightness };
}

const px = (n: number): string => `${n / 16}rem`;

/**
 * Which generator wrote a stylesheet, said in its second line. A project keeps the sheet it was given, so when
 * what a sheet must hold changes (one face and its file, where there were title pairings to install), the number
 * goes up and the studio regenerates the older sheet from the project's stored seed instead of auditing it
 * against rules it was never written for.
 */
export const THEME_GENERATOR = 5;
const GENERATOR_LINE = /^\/\* generator (\d+) \*\/$/m;

/** The generator a stylesheet says wrote it; 0 for a sheet from before sheets said. */
export function themeGeneratorOf(css: string): number {
  return Number(GENERATOR_LINE.exec(css)?.[1] ?? 0);
}

/**
 * The one file of each face, as the sheet names it and as the studio writes it beside the sheet, with the weights
 * the variable file covers. Whoever puts the files into a project reads the names from here, so the sheet never
 * points at a file under another name.
 */
export const faceFiles: Readonly<Record<Face, { file: string; weight: string }>> = {
  pretendard: { file: 'PretendardVariable.woff2', weight: '45 920' },
  suit: { file: 'SUIT-Variable.woff2', weight: '100 900' },
  suite: { file: 'SUITE-Variable.woff2', weight: '300 900' },
};
/** Where the face's file sits, relative to the stylesheet. */
export const FACE_FILES_DIR = 'fonts';

function vars(p: Palette, indent: string): string {
  return colorTokens.map((t) => `${indent}--sz-${t}: ${formatOklch(p[t])};`).join('\n');
}

/**
 * Emits the project's Tailwind v4 theme. Import it after `@import "tailwindcss"`.
 *
 * It replaces Tailwind's default colour, type, radius and shadow scales outright (`--color-*: initial` and
 * friends). The stock palette is not merely discouraged: `bg-indigo-500` and `rounded-3xl` do not compile to
 * anything, so the look they produce is unavailable by construction.
 *
 * The sheet also brings the product's face: one `@font-face` pointing at the file the studio puts in `fonts/`
 * beside the sheet, so no engine has to find and install it (one of the three is not on npm at all). A page that
 * carries its faces inside itself, or a sheet shipped with no file beside it, asks for `fontFiles: false` and gets
 * the same tokens without the pointer.
 */
export function renderThemeCss(theme: Theme, c: DesignContract = defaultContract, opts: { fontFiles?: boolean } = {}): string {
  const radii = cornerRadii[theme.seed.corners];
  const face = theme.seed.face ?? 'pretendard';
  const stack = faceStack(face, c).map(quoteFamily).join(', ');
  const fontFace =
    opts.fontFiles === false
      ? ''
      : `@font-face {
  font-family: ${quoteFamily(c.fonts.face[face][0]!)};
  font-style: normal;
  font-weight: ${faceFiles[face].weight};
  font-display: swap;
  src: url("./${FACE_FILES_DIR}/${faceFiles[face].file}") format("woff2-variations");
}

`;
  const mid = ([from, to]: readonly [number, number]): number => Math.round((from + to) / 20) * 10;
  const type = c.typeScalePx
    .map((size, i) => {
      const name = typeStepNames[i]!;
      const tracking = size > c.display.fromPx ? '-0.03em' : size >= 30 ? '-0.02em' : size >= 20 ? '-0.01em' : '0';
      return `  --text-${name}: ${px(size)};\n  --text-${name}--line-height: ${lineHeightFor(size)};\n  --text-${name}--letter-spacing: ${tracking};`;
    })
    .join('\n');

  return `/* Generated by @studio-zero/design from the design contract. Edit the seed, not this file. */
/* generator ${THEME_GENERATOR} */
/* seed: hue ${theme.seed.hue}, chroma ${theme.seed.chroma},${theme.seed.lightness === undefined ? '' : ` brand lightness ${theme.seed.lightness},`} neutral chroma ${theme.seed.neutralChroma}${theme.seed.neutralHue === undefined ? '' : ` toward hue ${theme.seed.neutralHue}`}, ${theme.seed.corners} corners, set in ${c.fonts.face[face][0]}${theme.seed.secondHue === undefined ? '' : `, second colour at hue ${theme.seed.secondHue}`} */

${fontFace}:root {
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
     brand is a fill (the product's own colour, as bright as it needs to be) and on-brand the text it carries.
     second and on-second are the same for the other side, when a product has two. series-1 to series-${SERIES.count} are
     the colours of data, used in that order: each holds ${c.contrast.nonText}:1 on every background. */
  --color-*: initial;
${colorTokens.map((t) => `  --color-${t}: var(--sz-${t});`).join('\n')}

  /* One face for the whole product. Titles are the same face, heavier: font-display is font-sans by another name. */
  --font-sans: ${stack};
  --font-display: ${stack};
  /* For code only: inside code, pre, kbd and samp. */
  --font-mono: ${c.fonts.mono.map(quoteFamily).join(', ')};

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

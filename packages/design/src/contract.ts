/**
 * The design contract: the measurable part of "does not look generated".
 *
 * One object, three consumers:
 *   - `renderThemeCss` emits the Tailwind v4 theme from it,
 *   - `lintSources` checks source code against it,
 *   - the daemon's visual audit checks rendered pages against it.
 * A number changed here changes all three, so the generator, the linter and the auditor cannot drift apart.
 *
 * The contract fixes discipline (scale, rhythm, contrast, restraint). It deliberately does not fix a look:
 * palette and corner style come from a per-project seed, so two projects never ship the same skin.
 */
export interface DesignContract {
  /** Every margin, padding and gap is a multiple of this. */
  spacingUnitPx: number;
  /** The stepped font sizes a page may use, in CSS px. The last steps are display sizes: one headline, not running text. */
  typeScalePx: readonly number[];
  /**
   * Display type: the one headline of an introduction or landing screen. Above `fromPx` a size need not sit on a
   * step (display type is usually fluid), up to `maxPx`. What keeps it a headline and not a shout is its ratio
   * to the body size, which must fall inside `ratioToBody`.
   */
  display: { fromPx: number; maxPx: number; ratioToBody: readonly [number, number] };
  /** Smallest size allowed for running text and form controls (below 16px iOS Safari zooms on focus). */
  minBodyPx: number;
  /** A page that needs more sizes than this has no hierarchy, only variety. */
  maxFontSizesPerView: number;
  lineHeight: { body: readonly [number, number]; heading: readonly [number, number] };
  /** Running text wider than this (in characters) is hard to track from line end to line start. */
  maxLineLengthCh: number;
  /**
   * Corner radii are a range, not a fixed set: 5, 15, 22 and 30px are all a deliberate curve on the right
   * element. Anything above `maxPx` that is not a full pill (9999, or half the element) is off contract.
   * What a view still owes is consistency, which `maxDistinctRadiiPerView` holds.
   */
  radius: { maxPx: number };
  maxDistinctRadiiPerView: number;
  contrast: {
    /** WCAG 2.2 AAA (1.4.6) for text below the large-text threshold. */
    text: number;
    /** AAA for large text: ≥ 24px, or ≥ 18.66px at weight 700+. */
    largeText: number;
    /** WCAG 1.4.11 for the visual boundary of controls and meaningful graphics. */
    nonText: number;
  };
  /** WCAG 2.5.5 (AAA) target size in CSS px. */
  touchTargetPx: number;
  /**
   * Hue band (HSL degrees) in which a gradient between two saturated stops is the stock "AI landing page"
   * look: blue → indigo → violet → purple → magenta.
   */
  clicheGradientHues: { from: number; to: number };
  fonts: {
    sans: readonly string[];
    mono: readonly string[];
    /** Title faces a project's seed may pick, each a Latin face with its Hangul partner. `sans` sets titles in the body face. */
    display: Readonly<Record<DisplayFace, readonly string[]>>;
  };
  motion: {
    /** Interface feedback: fast, base, slow. */
    durationsMs: readonly number[];
    /** How long the one orchestrated entrance of a screen may take, in ms (shortest, longest). */
    entranceMs: readonly [number, number];
    /** The same for a transition between pages. */
    pageMs: readonly [number, number];
    easing: string;
  };
}

export const displayFaces = ['sans', 'serif', 'editorial', 'grotesk'] as const;
export type DisplayFace = (typeof displayFaces)[number];

export const contract: DesignContract = {
  spacingUnitPx: 4,
  typeScalePx: [12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72, 96, 120, 160],
  display: { fromPx: 60, maxPx: 160, ratioToBody: [3, 7] },
  minBodyPx: 16,
  maxFontSizesPerView: 6,
  // A headline at display size is set tight: 0.9 to 1.0. Smaller headings keep the looser end.
  lineHeight: { body: [1.45, 1.8], heading: [0.9, 1.35] },
  maxLineLengthCh: 80,
  radius: { maxPx: 32 },
  maxDistinctRadiiPerView: 3,
  contrast: { text: 7, largeText: 4.5, nonText: 3 },
  touchTargetPx: 44,
  clicheGradientHues: { from: 215, to: 325 },
  fonts: {
    // Geist for Latin, Pretendard for Hangul. System faces are fallbacks only, never the design.
    sans: ['Geist', 'Pretendard Variable', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
    mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
    display: {
      sans: [],
      serif: ['Fraunces', 'Noto Serif KR'],
      editorial: ['Instrument Serif', 'Gowun Batang'],
      grotesk: ['Bricolage Grotesque', 'Pretendard Variable'],
    },
  },
  motion: { durationsMs: [120, 200, 320], entranceMs: [600, 810], pageMs: [700, 1100], easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
};

/** Line height paired with each step of the type scale: generous for reading sizes, tight for display sizes. */
export function lineHeightFor(sizePx: number): number {
  if (sizePx <= 14) return 1.5;
  if (sizePx <= 20) return 1.6;
  if (sizePx <= 30) return 1.3;
  if (sizePx <= 60) return 1.12;
  return sizePx <= 96 ? 1 : 0.92;
}

/** Tailwind step name for each size of the scale. */
export const typeStepNames = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl', '10xl'] as const;

const near = (a: number, b: number, tolerance = 0.5): boolean => Math.abs(a - b) <= tolerance;

/** A rendered font size the contract admits: a step of the scale, or any size in the display range. */
export function isOnTypeScale(sizePx: number, c: DesignContract = contract): boolean {
  return c.typeScalePx.some((step) => near(step, sizePx)) || (sizePx > c.display.fromPx && sizePx <= c.display.maxPx + 0.5);
}

/** Whether a headline of `titlePx` over body text of `bodyPx` is display type held in proportion. Sizes up to the display threshold always are. */
export function isDisplayInProportion(titlePx: number, bodyPx: number, c: DesignContract = contract): boolean {
  if (titlePx <= c.display.fromPx) return true;
  const ratio = titlePx / bodyPx;
  return titlePx <= c.display.maxPx + 0.5 && ratio >= c.display.ratioToBody[0] - 0.05 && ratio <= c.display.ratioToBody[1] + 0.05;
}

/** `elementMinSidePx` lets a full pill through: a radius of half the element or more is a capsule, whatever its number. */
export function isAllowedRadius(radiusPx: number, c: DesignContract = contract, elementMinSidePx = Infinity): boolean {
  return radiusPx <= c.radius.maxPx + 0.5 || radiusPx >= 999 || radiusPx >= elementMinSidePx / 2 - 0.5;
}

/** A duration the contract admits: one of the feedback steps, or inside the entrance or page-transition range. */
export function isAllowedDuration(ms: number, c: DesignContract = contract): boolean {
  const within = ([from, to]: readonly [number, number]): boolean => ms >= from && ms <= to;
  return c.motion.durationsMs.includes(ms) || within(c.motion.entranceMs) || within(c.motion.pageMs);
}

/** Every family a page may set text in: the body and code stacks and each display pairing. */
export function contractFamilies(c: DesignContract = contract): string[] {
  return [...c.fonts.sans, ...c.fonts.mono, ...Object.values(c.fonts.display).flat()];
}

export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
}

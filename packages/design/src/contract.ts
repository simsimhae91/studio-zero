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
  /** The only font sizes a page may use, in CSS px. */
  typeScalePx: readonly number[];
  /** Smallest size allowed for running text and form controls (below 16px iOS Safari zooms on focus). */
  minBodyPx: number;
  /** A page that needs more sizes than this has no hierarchy, only variety. */
  maxFontSizesPerView: number;
  lineHeight: { body: readonly [number, number]; heading: readonly [number, number] };
  /** Running text wider than this (in characters) is hard to track from line end to line start. */
  maxLineLengthCh: number;
  /** Corner radii a view may use, in px. 9999 (pill) is reserved for controls and avatars. */
  radiiPx: readonly number[];
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
  fonts: { sans: readonly string[]; mono: readonly string[] };
  motion: { durationsMs: readonly number[]; easing: string };
}

export const contract: DesignContract = {
  spacingUnitPx: 4,
  typeScalePx: [12, 14, 16, 18, 20, 24, 30, 36, 48, 60],
  minBodyPx: 16,
  maxFontSizesPerView: 6,
  lineHeight: { body: [1.45, 1.8], heading: [1.05, 1.35] },
  maxLineLengthCh: 80,
  radiiPx: [0, 4, 8, 12],
  maxDistinctRadiiPerView: 3,
  contrast: { text: 7, largeText: 4.5, nonText: 3 },
  touchTargetPx: 44,
  clicheGradientHues: { from: 215, to: 325 },
  fonts: {
    // Geist for Latin, Pretendard for Hangul. System faces are fallbacks only, never the design.
    sans: ['Geist', 'Pretendard Variable', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
    mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
  },
  motion: { durationsMs: [120, 200, 320], easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
};

/** Line height paired with each step of the type scale: generous for reading sizes, tight for display sizes. */
export function lineHeightFor(sizePx: number): number {
  if (sizePx <= 14) return 1.5;
  if (sizePx <= 20) return 1.6;
  if (sizePx <= 30) return 1.3;
  return 1.12;
}

/** Tailwind step name for each size of the scale. */
export const typeStepNames = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'] as const;

export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
}

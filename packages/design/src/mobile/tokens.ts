/**
 * Mobile tokens: what a phone screen adds to the design contract. The contract fixes scale, rhythm and contrast
 * for any surface; these fix the things only a handheld has: a thumb, a notch and a home indicator, bars that
 * float over content, and motion that answers a touch.
 *
 * Colour, type and corner radii are not restated here. They stay in the project's theme, so the tokens below
 * that touch them are utility class names (`rounded-lg`, `bg-surface`), never values: a project with sharp
 * corners or another palette gets a kit that looks like that project.
 *
 * This file imports nothing on purpose. It is copied as it is into every mobile project, beside the components
 * that read it (`.studio-zero/mobile-kit/tokens.ts`), and `design.test.ts` holds it to the contract.
 */
export const mobileTokens = {
  /** Smallest thing a thumb is asked to hit, in px (WCAG 2.5.5). */
  touchTarget: 44,

  /** Spacing in px, on the contract's 4px rhythm. */
  space: {
    unit: 4,
    /** Distance from the screen edge to content. */
    gutter: 16,
    /** Between controls that belong together (the buttons of a dock, the rows of a sheet). */
    stack: 12,
    /** Between groups. */
    section: 24,
  },

  safeArea: {
    /** Floor for the bottom inset: on a device with no home indicator a dock still does not sit on the screen edge. */
    minBottom: 12,
    /** The insets as CSS, for a web target or a plain stylesheet. Native code reads them from react-native-safe-area-context. */
    css: {
      top: 'env(safe-area-inset-top, 0px)',
      right: 'env(safe-area-inset-right, 0px)',
      bottom: 'env(safe-area-inset-bottom, 0px)',
      left: 'env(safe-area-inset-left, 0px)',
    },
  },

  /** The app bar, below the status bar inset. */
  bar: { height: 52, action: 44 },

  /**
   * Shape. Radius follows hierarchy: controls, then containers, then the pill reserved for buttons and badges.
   * `curve` is iOS's continuous corner (the squircle); it is a style value, applied with `borderCurve`.
   */
  radius: {
    control: 'rounded-md',
    container: 'rounded-lg',
    sheet: 'rounded-t-lg',
    pill: 'rounded-full',
    curve: 'continuous',
  },

  /** Surfaces, back to front. Depth comes from the surface step and a hairline border before it comes from shadow. */
  surface: {
    page: 'bg-bg',
    card: 'border border-border bg-surface',
    well: 'bg-sunken',
    /** A bar that sits over scrolling content. Opaque: what iOS and Android get. */
    bar: 'bg-surface',
    /** The same bar where the platform can blur what is behind it (the web target). */
    barFrosted: 'bg-surface/80 backdrop-blur-xl backdrop-saturate-150',
    /** Behind a sheet. The palette's own darkest-in-dark, lightest-in-light step, so it never inverts. */
    veil: 'bg-sunken',
  },

  /** Blur and veil strengths, for code that draws them itself (a native BlurView, a canvas). */
  blur: { bar: 24, sheet: 32, saturate: 1.5, veilOpacity: 0.8 },

  /** How far a pressed control gives way. Large surfaces move less than small ones. */
  press: { scale: 0.97, scaleLarge: 0.985 },

  /** Springs, as stiffness / damping / mass. `press` settles in about a tenth of a second; `sheet` in about a third, with a breath of overshoot. */
  spring: {
    press: { stiffness: 520, damping: 32, mass: 0.8 },
    sheet: { stiffness: 320, damping: 32, mass: 1 },
  },

  /** Durations in ms. The first three are the contract's; `pulse` is one cycle of an idle invitation. */
  motion: { fast: 120, base: 200, slow: 320, pulse: 1600 },

  /** A sheet lets go when it has been dragged this far (px) or flicked this fast (px/ms). */
  sheet: { dismissDistance: 96, dismissVelocity: 0.9 },

  /** The viewfinder: a portrait frame, the shape of the photo a phone takes. */
  dropzone: { aspectRatio: 4 / 5, badge: 64, corner: 28 },
} as const;

export type MobileTokens = typeof mobileTokens;

/** sRGB triple, each channel 0–1. */
export type Rgb = readonly [number, number, number];

export interface Oklch {
  /** Perceptual lightness 0–1. */
  l: number;
  /** Chroma, roughly 0–0.37 inside sRGB. */
  c: number;
  /** Hue angle in degrees. */
  h: number;
}

const toGamma = (x: number): number => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const toLinear = (x: number): number => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));

/** OKLCH → sRGB without clipping. Channels outside 0–1 mean the colour is outside the sRGB gamut. */
export function oklchToRgbUnclipped({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toGamma(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    toGamma(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    toGamma(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

function inGamut(rgb: Rgb): boolean {
  return rgb.every((x) => x >= -0.0005 && x <= 1.0005);
}

/**
 * Brings a colour into sRGB by reducing chroma at constant lightness and hue. Lowering chroma keeps the
 * perceived lightness (and so the contrast ratio) stable, which channel clipping does not.
 */
export function toSrgbGamut(color: Oklch): Oklch {
  if (inGamut(oklchToRgbUnclipped(color))) return color;
  let lo = 0;
  let hi = color.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToRgbUnclipped({ ...color, c: mid }))) lo = mid;
    else hi = mid;
  }
  return { ...color, c: lo };
}

export function oklchToRgb(color: Oklch): Rgb {
  const [r, g, b] = oklchToRgbUnclipped(toSrgbGamut(color));
  const clamp = (x: number): number => Math.min(1, Math.max(0, x));
  return [clamp(r), clamp(g), clamp(b)];
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2.x contrast ratio, 1–21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Composites a foreground with alpha over an opaque background. */
export function blend(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [fg[0] * alpha + bg[0] * (1 - alpha), fg[1] * alpha + bg[1] * (1 - alpha), fg[2] * alpha + bg[2] * (1 - alpha)];
}

/** HSL hue (degrees) and saturation (0–1). Used to recognise colour families, not for perceptual maths. */
export function hueSaturation([r, g, b]: Rgb): { hue: number; saturation: number; lightness: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { hue: 0, saturation: 0, lightness };
  const saturation = d / (1 - Math.abs(2 * lightness - 1));
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  return { hue, saturation, lightness };
}

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((ch) => ch + ch).join('') : m[1]!;
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export function formatOklch(color: Oklch): string {
  const c = toSrgbGamut(color);
  return `oklch(${(c.l * 100).toFixed(2)}% ${c.c.toFixed(4)} ${c.h.toFixed(1)})`;
}

/**
 * Finds the lightness closest to the background at which a colour of the given hue and chroma reaches the
 * target contrast against it. `darker` chooses which side of the background to search.
 * This is how tokens are *solved* to meet WCAG AAA instead of being picked by eye and checked afterwards.
 */
export function solveForContrast(p: { against: Oklch; hue: number; chroma: number; target: number; darker: boolean }): Oklch {
  const bg = oklchToRgb(p.against);
  const at = (l: number): Oklch => toSrgbGamut({ l, c: p.chroma, h: p.hue });
  const ok = (l: number): boolean => contrastRatio(oklchToRgb(at(l)), bg) >= p.target;
  let near = p.against.l;
  let far = p.darker ? 0 : 1;
  if (!ok(far)) throw new Error(`contrast ${p.target}:1 is unreachable against lightness ${p.against.l.toFixed(2)}`);
  for (let i = 0; i < 28; i++) {
    const mid = (near + far) / 2;
    if (ok(mid)) far = mid;
    else near = mid;
  }
  return at(far);
}

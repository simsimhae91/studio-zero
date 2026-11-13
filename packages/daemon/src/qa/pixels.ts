import type { Browser } from 'playwright-core';
import { z } from 'zod';

/**
 * What a pixel is counted as, in HSL terms. Colour at strength is neither a tint of the paper nor an ink:
 * saturated, and of middling lightness. Near-black is what an inverted band is painted in. `coloured` is the
 * wider cut the design lab laid on the owner's references: any colour a person would call a colour, a deep
 * brand green included, which the cut for strength leaves out.
 */
export const PIXEL_CUTS = { saturation: 0.45, lightness: [0.2, 0.8], dark: 0.12, coloured: { saturation: 0.35, lightness: [0.15, 0.85] } } as const;

const Shares = z.object({ saturated: z.number().min(0).max(1), dark: z.number().min(0).max(1), coloured: z.number().min(0).max(1) });
export type ColourShares = z.infer<typeof Shares>;

/** One sRGB colour, 0 to 1 a channel, by the cuts the pixel count uses: so a finding can point at the surface the count was mostly of. */
export function pixelKind(rgb: readonly [number, number, number]): 'saturated' | 'dark' | null {
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  const lightness = (max + min) / 2;
  if (lightness < PIXEL_CUTS.dark) return 'dark';
  const saturation = max === min ? 0 : lightness > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  return saturation > PIXEL_CUTS.saturation && lightness > PIXEL_CUTS.lightness[0] && lightness < PIXEL_CUTS.lightness[1] ? 'saturated' : null;
}

/**
 * Runs in a blank page (serialised by Playwright, so it must not reference anything outside itself): how the
 * pixels of one picture divide, with the boxes of `mask` left out of the count.
 */
async function countPixels(input: { b64: string; mask: number[][]; scale: number; cuts: { saturation: number; lightness: readonly [number, number]; dark: number; coloured: { saturation: number; lightness: readonly [number, number] } } }): Promise<unknown> {
  const picture = new Image();
  picture.src = `data:image/png;base64,${input.b64}`;
  await picture.decode();
  const { width, height } = picture;
  const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(picture, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  const masked = new Uint8Array(width * height);
  for (const [x = 0, y = 0, w = 0, h = 0] of input.mask) {
    const x0 = Math.max(0, Math.floor(x * input.scale));
    const x1 = Math.min(width, Math.ceil((x + w) * input.scale));
    const y1 = Math.min(height, Math.ceil((y + h) * input.scale));
    for (let row = Math.max(0, Math.floor(y * input.scale)); row < y1; row++) if (x1 > x0) masked.fill(1, row * width + x0, row * width + x1);
  }
  let counted = 0;
  let saturated = 0;
  let dark = 0;
  let coloured = 0;
  // Every other pixel each way: a quarter of them says the same as all of them, and the count is of a whole screen.
  for (let row = 0; row < height; row += 2) {
    for (let col = 0; col < width; col += 2) {
      const at = row * width + col;
      if (masked[at]) continue;
      const max = Math.max(data[at * 4]!, data[at * 4 + 1]!, data[at * 4 + 2]!);
      const min = Math.min(data[at * 4]!, data[at * 4 + 1]!, data[at * 4 + 2]!);
      const lightness = (max + min) / 510;
      const saturation = max === min ? 0 : lightness > 0.5 ? (max - min) / (510 - max - min) : (max - min) / (max + min);
      counted += 1;
      if (lightness < input.cuts.dark) dark += 1;
      else if (saturation > input.cuts.saturation && lightness > input.cuts.lightness[0] && lightness < input.cuts.lightness[1]) saturated += 1;
      if (saturation > input.cuts.coloured.saturation && lightness > input.cuts.coloured.lightness[0] && lightness < input.cuts.coloured.lightness[1]) coloured += 1;
    }
  }
  const share = (n: number): number => (counted === 0 ? 0 : Math.round((n / counted) * 1000) / 1000);
  return { saturated: share(saturated), dark: share(dark), coloured: share(coloured) };
}

/**
 * How much of a picture of a screen is colour at strength, and how much is near-black: what the handbook's
 * budget of colour (C2) and its rule against an inverted band (C3) are counted from.
 *
 * It is counted off the pixels because the styles do not say. A panel drawn in an svg, a fill inherited through
 * three wrappers and a gradient all paint the screen without being anybody's background colour. `mask` is
 * where the page's pictures are, in CSS pixels of the screenful: a photograph's colours are its subject's, not
 * the interface's, and are left out. `scale` is the device pixels the picture has to each CSS pixel.
 *
 * The picture is read in a blank page of the same browser, through a canvas, so the daemon carries no image
 * decoder of its own. Throws when the picture cannot be read; a caller that can go on without the count does.
 */
export async function colourShares(browser: Browser, png: Buffer, opts: { mask: readonly [number, number, number, number][]; scale: number }): Promise<ColourShares> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    return Shares.parse(await page.evaluate(countPixels, { b64: png.toString('base64'), mask: opts.mask.map((box) => [...box]), scale: opts.scale, cuts: PIXEL_CUTS }));
  } finally {
    await context.close().catch(() => undefined);
  }
}

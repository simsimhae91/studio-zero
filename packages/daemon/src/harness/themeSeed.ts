import { z } from 'zod';
import { createTheme, displayFaces, formatOklch, renderThemeCss, seedFromName, type ThemeSeed } from '@studio-zero/design';

/** The decision a project's theme is generated from: the seed, and one sentence on where it came from. */
export const THEME_SEED_FILE = '.studio-zero/theme.json';
/** What a seed says of itself until someone chooses one from the subject. */
export const PLACEHOLDER_SOURCE = "placeholder: picked from the project's name, not from the subject";

/**
 * What an engine chooses when it sets a theme. The ranges are the generator's: inside them every text and
 * background pair comes out at AAA whatever is asked, so there is nothing here an engine can get wrong except
 * the choice itself.
 *
 * The band is a clear brand on clean paper. Most of a screen is paper and near-white surfaces, the structure is
 * hairlines and wells, and the brand is the one colour, on the few things that must be seen first. A real build
 * (2026-11-13) was given the wider band and chose a warm neutral at 0.018: every screen came out on cream with
 * peach wells, and the reviewer read it as a questionnaire. Tinted paper is no longer a choice the tool offers.
 */
export const ThemeChoice = z.object({
  hue: z.number().min(0).max(360).describe("The brand colour's hue in OKLCH degrees (0 red, 30 coral, 40 orange, 60 yellow, 150 green, 160 emerald, 200 cyan, 260 cobalt, 290 violet, 330 pink)."),
  chroma: z.number().min(0.12).max(0.28).describe('How saturated the brand is: 0.12 clear, 0.2 vivid, 0.28 electric. It is the one colour on the screen, so it is never muted.'),
  lightness: z.number().min(0.4).max(0.75).describe('How light the brand is: 0.4 deep, 0.55 mid, 0.7 bright. It is a fill for the primary action and the figure that matters; the text on it is worked out for you. Darker reads as ink and lighter as a pastel wash, so neither is offered.'),
  neutral_hue: z.number().min(0).max(360).optional().describe('The hue the paper and ink lean toward, barely. Leave out to follow the brand; set it to about 250 for a cool slate grey.'),
  neutral_chroma: z.number().min(0).max(0.005).describe('How much the neutrals lean: 0 pure grey, 0.005 the faintest lean the paper may have. Paper that reads as cream, peach or yellow, or as any colour at all, is not available: the canvas stays near-white (or a cool grey) so the brand is what is seen.'),
  corners: z.enum(['sharp', 'soft', 'round']).describe('The shape of the product: sharp (0 to 12px), soft (4 to 20px) or round (6 to 30px).'),
  display: z.enum(displayFaces).describe('The face titles are set in.'),
  source: z.string().min(12).max(300).describe('One sentence: what in the subject this colour and shape come from (the thing, the place, the material, the people it is for).'),
});
export type ThemeChoice = z.infer<typeof ThemeChoice>;

const toSeed = (c: ThemeChoice): ThemeSeed => ({ hue: c.hue, chroma: c.chroma, lightness: c.lightness, neutralChroma: c.neutral_chroma, ...(c.neutral_hue === undefined ? {} : { neutralHue: c.neutral_hue }), corners: c.corners, display: c.display });

/** The two files a theme is: the decision, and the stylesheet generated from it. */
export function themeFiles(seed: ThemeSeed, source: string): { json: string; css: string } {
  return { json: `${JSON.stringify({ ...seed, source }, null, 2)}\n`, css: renderThemeCss(createTheme(seed)) };
}

/** A new project's theme, before anyone has looked at what the project is. */
export const placeholderTheme = (slug: string): { json: string; css: string } => themeFiles(seedFromName(slug), PLACEHOLDER_SOURCE);

/** The files for an engine's choice, and what to tell it came of the choice. */
export function chosenTheme(choice: ThemeChoice): { json: string; css: string; report: string } {
  const seed = toSeed(choice);
  const theme = createTheme(seed);
  const { brand, accent, bg } = theme.light;
  const moved = Math.abs(brand.l - choice.lightness) > 0.004 ? ` The brand was asked for at lightness ${choice.lightness} and set at ${brand.l.toFixed(2)}: at the lightness asked, neither dark nor light text holds on it.` : '';
  return {
    ...themeFiles(seed, choice.source),
    report: `Theme set. brand ${formatOklch(brand)} carries text ${formatOklch(theme.light['on-brand'])}; brand-soft ${formatOklch(theme.light['brand-soft'])} is its wash; accent (the brand's hue as a text colour) is ${formatOklch(accent)} on ${formatOklch(bg)}.${moved} The stylesheet has every token for light and dark: read it and use those values.`,
  };
}

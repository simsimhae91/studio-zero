import { z } from 'zod';
import { FACE_FILES_DIR, contract, createTheme, faceFiles, faces, formatOklch, renderThemeCss, secondHueFor, seedFromName, type Face, type ThemeSeed } from '@studio-zero/design';
import type { Project } from '@studio-zero/protocol';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { FONT_DIR, fontFile } from './fontKit.ts';

/** The decision a project's theme is generated from: the seed, and one sentence on where it came from. */
export const THEME_SEED_FILE = '.studio-zero/theme.json';
/**
 * The stylesheet generated from it, written again whenever the seed changes. The same path as `THEME_FILE` in
 * prompts.ts, which imports this module and so cannot be imported from here.
 */
const THEME_SHEET_FILE = '.studio-zero/theme.css';
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
  second_hue: z
    .number()
    .min(0)
    .max(360)
    .optional()
    .describe('The hue of a second colour, in OKLCH degrees. Choose it only when the product has two sides or two kinds to tell apart (two players, mine and theirs, in and out): it is the other side, as the brand is this one. Otherwise leave it out: one is derived from the brand, kept clear of the red, amber and green that mean state.'),
  face: z
    .enum(faces)
    .describe('The one typeface the whole product is set in, titles included (a title is the same face, heavier). pretendard: neutral, for products dense with information. suit: geometric and crisp. suite: wide and soft, for consumer products. There is no serif, no second face and no italic to choose.'),
  source: z.string().min(12).max(300).describe('One sentence: what in the subject this colour and shape come from (the thing, the place, the material, the people it is for).'),
});
export type ThemeChoice = z.infer<typeof ThemeChoice>;

const toSeed = (c: ThemeChoice): ThemeSeed => ({ hue: c.hue, chroma: c.chroma, lightness: c.lightness, neutralChroma: c.neutral_chroma, ...(c.neutral_hue === undefined ? {} : { neutralHue: c.neutral_hue }), corners: c.corners, face: c.face, ...(c.second_hue === undefined ? {} : { secondHue: c.second_hue }) });

/**
 * What a theme is, ready to be written: the decision, the stylesheet generated from it, and the face the sheet
 * points at. `tokensCss` is the same sheet without the pointer to the face's file, for a page that carries its
 * faces inside itself: what a direction's engine copies into its mock-up.
 */
export interface ThemeFiles {
  json: string;
  css: string;
  tokensCss: string;
  face: Face;
}

/** The files of a theme, from its seed and where the seed came from. `kept` is what else the stored decision held. */
export function themeFiles(seed: ThemeSeed, source: string | undefined, kept: Record<string, unknown> = {}): ThemeFiles {
  const theme = createTheme(seed);
  return {
    json: `${JSON.stringify({ ...kept, ...seed, ...(source === undefined ? {} : { source }) }, null, 2)}\n`,
    css: renderThemeCss(theme),
    tokensCss: renderThemeCss(theme, undefined, { fontFiles: false }),
    face: seed.face ?? 'pretendard',
  };
}

/** A new project's theme, before anyone has looked at what the project is. */
export const placeholderTheme = (slug: string): ThemeFiles => themeFiles(seedFromName(slug), PLACEHOLDER_SOURCE);

/** The files for an engine's choice, and what to tell it came of the choice. */
export function chosenTheme(choice: ThemeChoice): ThemeFiles & { report: string } {
  const seed = toSeed(choice);
  const theme = createTheme(seed);
  const { brand, accent, bg } = theme.light;
  const moved = Math.abs(brand.l - choice.lightness) > 0.004 ? ` The brand was asked for at lightness ${choice.lightness} and set at ${brand.l.toFixed(2)}: at the lightness asked, neither dark nor light text holds on it.` : '';
  const where = choice.second_hue === undefined ? `derived from the brand, at hue ${Math.round(secondHueFor(seed))} (the clean hue furthest from the brand, never the red, amber or green that mean state): choose second_hue yourself only if the product has two sides or kinds` : 'at the hue you chose: the other side, as the brand is this one';
  const second = ` second ${formatOklch(theme.light.second)} carries text ${formatOklch(theme.light['on-second'])}, ${where}. series-1 to series-6 are the colours of data, used in that order.`;
  return {
    ...themeFiles(seed, choice.source),
    report: `Theme set. brand ${formatOklch(brand)} carries text ${formatOklch(theme.light['on-brand'])}; brand-soft ${formatOklch(theme.light['brand-soft'])} is its wash; accent (the brand's hue as a text colour) is ${formatOklch(accent)} on ${formatOklch(bg)}.${moved}${second} The product is set in ${contract.fonts.face[choice.face][0]}, titles included: its file is already in the project at ${FONT_DIR}/${faceFiles[choice.face].file} and the stylesheet loads it, so there is no font to install. The stylesheet has every token for light and dark: read it and use those values.`,
  };
}

/**
 * A seed as a project stores it. Read from a file an engine could have changed, so nothing about it is assumed;
 * fields this generator does not know are kept as they are.
 */
const StoredSeed = z.looseObject({
  hue: z.number().min(0).max(360),
  chroma: z.number().min(0).max(0.4),
  lightness: z.number().min(0).max(1).optional(),
  neutralChroma: z.number().min(0).max(0.4),
  neutralHue: z.number().min(0).max(360).optional(),
  secondHue: z.number().min(0).max(360).optional(),
  corners: z.enum(['sharp', 'soft', 'round']),
  face: z.enum(faces).optional(),
  source: z.string().optional(),
});

/**
 * The files of a theme a project already has, generated again from the seed it stores.
 *
 * A project keeps the sheet it was given. One from before the faces were fixed names a title pairing (Fraunces,
 * Instrument Serif) that the audit now reports as a foreign font, in a file no engine may edit: the finding
 * could not be acted on. So such a sheet is written again from the same decision. The title face the seed chose
 * is dropped, since there is none to choose any more, and a seed with no face is set in Pretendard; every other
 * field stays, so the product keeps its colour and its shape.
 *
 * Null when what is stored is not a seed this generator can render: the project's sheet is then left as it is.
 */
export function regeneratedTheme(storedJson: string): ThemeFiles | null {
  let value: unknown;
  try {
    value = JSON.parse(storedJson);
  } catch {
    return null;
  }
  const parsed = StoredSeed.safeParse(value);
  if (!parsed.success) return null;
  const { display: _display, source, hue, chroma, lightness, neutralChroma, neutralHue, secondHue, corners, face, ...kept } = parsed.data;
  const seed: ThemeSeed = { hue, chroma, neutralChroma, corners, ...(lightness === undefined ? {} : { lightness }), ...(neutralHue === undefined ? {} : { neutralHue }), ...(secondHue === undefined ? {} : { secondHue }), ...(face === undefined ? {} : { face }) };
  try {
    return themeFiles(seed, source, kept);
  } catch {
    // A seed from outside the ranges the generator solves for (no text colour reaches the contrast asked).
    return null;
  }
}

/**
 * Writes a theme into a project: the seed, the sheet, and the file of the face the sheet points at.
 *
 * Everything that sets a project's theme goes through here (provisioning, set_theme, the recommended direction
 * of a design task), so a sheet is never left pointing at a file that is not there. The file is binary and goes
 * in over stdin. It is written only when it is missing, since it never changes; the files of the other faces
 * are taken away, so a project that changed its face carries one face and not every face it ever tried.
 */
/**
 * Where a project's own server gives out the face, and what the sheet calls it there. A Vite or Next project
 * resolves the sheet's relative address at build time, so the file sits beside the sheet. An Expo project's web
 * server gives out `public/` at its root and nothing under `.studio-zero`: in the first real Expo draft built
 * under these rules the engine found that out for itself, copied the file there and declared the face a second
 * time. So for an Expo project the file goes into `public/fonts` and the sheet points at `/fonts`.
 * (On a device the face is still not loaded: React Native takes fonts through expo-font, and not as woff2.)
 */
export function faceHome(template: Project['template']): { dir: string; url: string } {
  return template === 'mobile-expo' ? { dir: `public/${FACE_FILES_DIR}`, url: `/${FACE_FILES_DIR}` } : { dir: FONT_DIR, url: `./${FACE_FILES_DIR}` };
}

export async function writeProjectTheme(sandboxes: Pick<OrbStackManager, 'exec' | 'writeFile'>, project: Project, theme: Pick<ThemeFiles, 'json' | 'css' | 'face'>): Promise<void> {
  const home = faceHome(project.template);
  await sandboxes.writeFile(project, THEME_SEED_FILE, theme.json);
  await sandboxes.writeFile(project, THEME_SHEET_FILE, theme.css.replace(`url("./${FACE_FILES_DIR}/`, `url("${home.url}/`));
  const file = fontFile(theme.face);
  // The files of the other faces go, wherever a face was ever put, so a project carries the one it is set in.
  const others = [...new Set([FONT_DIR, home.dir])].flatMap((dir) => faces.filter((face) => face !== theme.face).map((face) => `${dir}/${faceFiles[face].file}`));
  const held = await sandboxes.exec(project, `rm -f ${others.join(' ')}; test -s ${home.dir}/${file.name} && echo held; true`, { timeoutSec: 15 });
  if (!held.stdout.includes('held')) await sandboxes.writeFile(project, `${home.dir}/${file.name}`, await file.read());
}

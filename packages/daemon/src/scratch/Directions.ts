import { z } from 'zod';
import { ThemeChoice } from '../harness/themeSeed.ts';
import { overlap } from './AnchorTable.ts';

/** Where a design task says what its directions are, before any of them is drawn. */
export const DIRECTIONS_FILE = 'docs/mockups/directions.json';

const DIRECTION_IDS = ['a', 'b', 'c'] as const;
export type DirectionId = (typeof DIRECTION_IDS)[number];
/**
 * Where the studio leaves the theme it generated for one direction. A file of its own: the project's theme
 * file is one for the whole workspace, and the directions are drawn at the same time.
 */
export const directionThemeFile = (id: DirectionId): string => `.studio-zero/themes/${id}.css`;
/** `docs/mockups/b.html` → "b"; null for anything that is not a direction's page. */
export const directionOf = (file: string): DirectionId | null => (/^docs\/mockups\/([abc])\.html$/.exec(file)?.[1] as DirectionId | undefined) ?? null;

const Direction = z.object({
  id: z.enum(DIRECTION_IDS),
  /** The idea the direction is built on: a duel, a ledger, a map, a single dial. */
  concept: z.string().max(600),
  /** How a person operates it: what they press, in what order, and what answers. */
  operation: z.string().max(600),
  /** What leads on the screen and how the rest is arranged around it. */
  composition: z.string().max(600),
  theme: ThemeChoice,
});
export type Direction = z.infer<typeof Direction>;

export const Directions = z.object({
  /** What every direction shows, so that they can be compared: the person, their data, the names and the numbers. */
  scene: z.string().max(2400),
  directions: z.array(Direction).max(6),
});
export type Directions = z.infer<typeof Directions>;

const EMPTY = /^(?:없음|미정|n\/?a|none|tbd|todo|-+|\.+)?$/i;
const thin = (value: string, min: number): boolean => EMPTY.test(value.trim()) || value.trim().length < min;
/** How far apart two hues are, the short way round. */
const hueApart = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
/** Two brand hues closer than this read as one colour. */
const SAME_HUE_DEG = 30;

/**
 * What is wrong with a directions table, each as a sentence its author can act on. Empty means it holds.
 *
 * The table is what makes the directions different before anyone draws them. Until it existed, one engine
 * wrote page a, then b, then c in one conversation, told only that they should differ: each page inherited
 * the one before it, and nothing checked that they had come apart. Now each direction is drawn from its own
 * row by an engine that has seen no other page, so what is checked here is what can be checked without a
 * judge: that there are two or three, that each says what it is built on, how it is operated and how it is
 * laid out, that no two say nearly the same thing, and that no two share a look. A look is the colour, the
 * shape and the face: two rows are one look only when all three are the same.
 */
export function checkDirections(table: Directions): string[] {
  const problems: string[] = [];
  if (thin(table.scene, 80)) problems.push('scene is empty or a label: describe the one scene every direction shows (who the person is, what they are in the middle of doing, the names, amounts and dates on screen, and one awkward case), in enough detail that pages drawn apart show the same data.');
  const rows = table.directions;
  if (rows.length < 2 || rows.length > 3) problems.push(`directions has ${rows.length} row(s): give two, or three if the third is really different.`);
  rows.forEach((row, i) => {
    if (row.id !== DIRECTION_IDS[i]) problems.push(`directions[${i}] has id "${row.id}": the rows are "a", "b" and then "c", in that order, and "a" is the one the documents recommend.`);
    for (const field of ['concept', 'operation', 'composition'] as const) if (thin(row[field], 24)) problems.push(`direction ${row.id}: ${field} is empty or a label. Say it in a sentence someone could draw from.`);
  });
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const [x, y] = [rows[i]!, rows[j]!];
      if (overlap(`${x.concept} ${x.operation} ${x.composition}`, `${y.concept} ${y.operation} ${y.composition}`) > 0.7) problems.push(`directions ${x.id} and ${y.id} say nearly the same thing: make them differ in what the product is built on, in how it is operated and in what leads on the screen, not in wording.`);
      if (hueApart(x.theme.hue, y.theme.hue) < SAME_HUE_DEG && x.theme.corners === y.theme.corners && x.theme.face === y.theme.face) problems.push(`directions ${x.id} and ${y.id} share a look (hues ${x.theme.hue} and ${y.theme.hue}, ${x.theme.corners} corners, the ${x.theme.face} face): give each a palette and a shape of its own, taken from the subject read a different way.`);
    }
  }
  return problems.slice(0, 16);
}

export type DirectionsRead = { ok: true; table: Directions } | { ok: false; problems: string[] };

/** Reads a directions table from what a workspace holds. Nothing about the input is assumed. */
export function readDirections(input: unknown): DirectionsRead {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, problems: [`${DIRECTIONS_FILE} is not valid JSON.`] };
    }
  }
  const parsed = Directions.safeParse(value);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join('.') || 'the table'}: ${issue.message}`) };
  const problems = checkDirections(parsed.data);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, table: parsed.data };
}

/** One row as text for a prompt. A model wrote its cells: callers fence it as data. */
export const renderDirection = (row: Direction): string => `Concept: ${row.concept.trim()}\nOperated by: ${row.operation.trim()}\nComposition: ${row.composition.trim()}\nLook: ${row.theme.source.trim()}`;

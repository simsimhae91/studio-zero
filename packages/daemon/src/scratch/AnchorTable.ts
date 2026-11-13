import { z } from 'zod';

/** Where a project keeps its anchor table. Committed before the first line of interface code is written. */
export const ANCHOR_FILE = '.studio-zero/anchor-table.json';

export const ANCHOR_CATEGORIES = ['layout', 'typography', 'color', 'surfaces', 'motion', 'interaction'] as const;

/**
 * The anchor table (고정표): what a builder is handed before it builds. Two days of comparing ways to build
 * showed that structure (one session, a builder in the lead, a room of agents) did not change the result; what
 * the builder received before it started did. This is that hand-off, written down and checked.
 *
 * It fixes, before any code: the one idea that came out of this product's own subject, two directions that are
 * really different, what the first screen leads with and what there is to look at and touch on it, and, for
 * each thing learned from a reference, the principle that carries over and the value this product derives for
 * itself. A reference lends principles. Its sizes, ratios, colours and timings stay where they were found:
 * copied, they make every product smell the same.
 */
export interface AnchorTable {
  /** One sentence that came out of this product's subject: what someone remembers after seeing it. */
  idea: string;
  /** Two concrete directions that differ from each other, neither of them the usual list beside a panel. */
  directions: [string, string];
  firstScreen: {
    /** The largest thing on it. */
    primaryElement: string;
    /** What someone can do on the first screen, straight away, with something real. */
    interactiveAction: string;
    /** What there is to look at, and where it comes from: the real product screen, data items, a material. */
    livingVisual: string;
  };
  anchors: Array<{
    category: (typeof ANCHOR_CATEGORIES)[number];
    /** What was seen in the reference. */
    referenceObserved: string;
    /** The principle that carries over. */
    derivedPrinciple: string;
    /** This product's own value, and what in its subject or data it comes from. */
    ourValueAndSource: string;
  }>;
  /** Principles to keep to, three to five. */
  retainedPrinciples: string[];
  /** Defaults to throw out, by name: "a list on the left and cards on the right", "a centred hero slogan". */
  discardedDefaults: string[];
  /** Signatures and assets of the reference that are never to be taken. */
  strictlyExcluded: string[];
}

/**
 * The same shape as a schema, for structured output and for reading the file back from a workspace. Flat and
 * unbounded on purpose, like every schema a model fills in here: the bounds are `checkAnchorTable`'s, where a
 * miss comes back as a sentence the author can act on.
 */
export const AnchorTableShape = z.object({
  idea: z.string().describe('One sentence drawn from this product\'s own subject: what a person remembers after seeing it. Not a slogan, not a feature list.'),
  directions: z.array(z.string()).describe('Exactly two concrete design directions that differ from each other in structure, not in skin. Neither is the usual list beside a panel.'),
  firstScreen: z.object({
    primaryElement: z.string().describe('The single largest thing on the first screen.'),
    interactiveAction: z.string().describe('What a person can do on the first screen straight away, with something real.'),
    livingVisual: z.string().describe('What there is to look at on the first screen and where it comes from: the working product itself, real data items, an element with material response. Never a generic illustration.'),
  }),
  anchors: z.array(
    z.object({
      category: z.enum(ANCHOR_CATEGORIES),
      referenceObserved: z.string().describe('What was seen in the reference (or, with no reference, in the common default for this kind of product).'),
      derivedPrinciple: z.string().describe('The principle behind it that carries over to this product.'),
      ourValueAndSource: z.string().describe('This product\'s own value, derived from its subject or data, and what it was derived from. Not the reference\'s number.'),
    }),
  ),
  retainedPrinciples: z.array(z.string()).describe('Three to five principles the build must keep to.'),
  discardedDefaults: z.array(z.string()).describe('Named defaults this build throws out, e.g. "a list on the left and cards on the right".'),
  strictlyExcluded: z.array(z.string()).describe('Signatures and assets particular to the reference that must never be taken. Empty when there was no reference.'),
});

const EMPTY = /^(?:없음|해당 ?없음|미정|n\/?a|none|tbd|todo|-+|\.+)?$/i;
const CLIPART = /(일러스트|클립 ?아트|스톡 ?(?:이미지|사진)|장식(?:용)? ?(?:그림|이미지)|illustration|clip ?art|stock (?:photo|image)|decorative (?:image|graphic)|placeholder)/i;
/**
 * The same words, said in order to rule them out: "일러스트는 없고", "not an illustration". A table that says what
 * is on the first screen and adds that there is no illustration has followed the brief, not broken it. A real
 * planner writes exactly this, and the check used to refuse it for the word alone.
 */
const RULED_OUT = /(?:일러스트(?:레이션)?|클립 ?아트|스톡 ?(?:이미지|사진)|장식(?:용)? ?(?:그림|이미지))(?:은|는|이|가|도|를|을|나)?\s*(?:없|아니|아닌|않|빼|쓰지|넣지|두지|대신)|(?:\bno|\bnot|\bnever|\bwithout|\binstead of|\brather than)\s+(?:an?\s+|any\s+)?(?:generic\s+|decorative\s+|stock\s+)?(?:illustration|clip ?art|stock (?:photo|image)|decorative (?:image|graphic)|placeholder)s?/gi;
/** A measured value as a reference states it: a number with its unit. */
const VALUE = /\d+(?:\.\d+)?\s?(?:px|rem|em|ms|s|%|deg)\b|#[0-9a-f]{6}\b/gi;

const words = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1));
function overlap(a: string, b: string): number {
  const [x, y] = [words(a), words(b)];
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.max(1, Math.min(x.size, y.size));
}

/**
 * What is wrong with an anchor table, each as a sentence its author can act on. Empty means it holds.
 *
 * These are the checks that do not need a judge: that every part is filled in with something, that the two
 * directions are two, and that no anchor carries the reference's own measurements across as this product's
 * values. Whether the idea is a good one is the reviewer's question, not this function's.
 */
export function checkAnchorTable(table: z.infer<typeof AnchorTableShape>): string[] {
  const problems: string[] = [];
  const blank = (value: string): boolean => EMPTY.test(value.trim());

  if (blank(table.idea)) problems.push('idea is empty: state the one thing a person remembers, in a sentence drawn from this product\'s subject.');
  else if (table.idea.trim().length > 240 || /\n/.test(table.idea.trim())) problems.push('idea must be one sentence (240 characters at most, one line).');

  const directions = table.directions.map((d) => d.trim()).filter((d) => !blank(d));
  if (directions.length !== 2) problems.push(`directions must be exactly two; there ${directions.length === 1 ? 'is 1' : `are ${directions.length}`}.`);
  else if (overlap(directions[0]!, directions[1]!) > 0.7) problems.push('the two directions say nearly the same thing: make them differ in structure (what leads, how it is arranged, what a person does first), not in wording.');
  for (const d of directions) if (d.length < 12) problems.push(`direction "${d}" is a label, not a direction: say what the screen is built around.`);

  const first = table.firstScreen;
  if (blank(first.primaryElement)) problems.push('firstScreen.primaryElement is empty: name the largest thing on the first screen.');
  if (blank(first.interactiveAction)) problems.push('firstScreen.interactiveAction is empty: name what a person can do on the first screen straight away.');
  if (blank(first.livingVisual)) problems.push('firstScreen.livingVisual is empty: a first screen of text and rules only is not accepted. Name what there is to look at and where it comes from (the working product, real data, a material).');
  else if (CLIPART.test(first.livingVisual.replace(RULED_OUT, ' '))) problems.push('firstScreen.livingVisual names an illustration or a stock picture. It has to be the product itself: a working data canvas, a real product screen, an interactive viewfinder, an element that responds like a material.');

  if (table.anchors.length < 3) problems.push(`anchors has ${table.anchors.length} row(s); at least three are needed, in different categories (${ANCHOR_CATEGORIES.join(', ')}).`);
  else if (new Set(table.anchors.map((a) => a.category)).size < 3) problems.push('anchors cover fewer than three categories: spread them across layout, typography, color, surfaces, motion and interaction.');
  table.anchors.forEach((anchor, i) => {
    const row = `anchors[${i}] (${anchor.category})`;
    if (blank(anchor.referenceObserved) || blank(anchor.derivedPrinciple) || blank(anchor.ourValueAndSource)) return void problems.push(`${row} has an empty cell: each row needs what was observed, the principle, and our own value with its source.`);
    const observed = new Set((anchor.referenceObserved.match(VALUE) ?? []).map((v) => v.replace(/\s/g, '').toLowerCase()));
    const carried = (anchor.ourValueAndSource.match(VALUE) ?? []).map((v) => v.replace(/\s/g, '').toLowerCase()).filter((v) => observed.has(v));
    // One number in common can be a coincidence (a 16px body is a 16px body). Two or more is a copy.
    if (new Set(carried).size >= 2) problems.push(`${row} carries the reference's own values across (${[...new Set(carried)].join(', ')}). Keep the principle and derive this product's values from its subject and data.`);
  });

  const kept = table.retainedPrinciples.filter((p) => !blank(p));
  if (kept.length < 3 || kept.length > 5) problems.push(`retainedPrinciples has ${kept.length}; give three to five.`);
  if (table.discardedDefaults.filter((d) => !blank(d)).length === 0) problems.push('discardedDefaults is empty: name at least one default this build throws out.');
  return problems;
}

export type AnchorRead = { ok: true; table: AnchorTable } | { ok: false; problems: string[] };

/** Reads an anchor table from anything a model or a workspace produced. Nothing about the input is assumed. */
export function readAnchorTable(input: unknown): AnchorRead {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, problems: [`${ANCHOR_FILE} is not valid JSON.`] };
    }
  }
  const parsed = AnchorTableShape.safeParse(value);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join('.') || 'the table'}: ${issue.message}`) };
  const problems = checkAnchorTable(parsed.data);
  if (problems.length > 0) return { ok: false, problems };
  const clean = (list: string[]): string[] => list.map((item) => item.trim()).filter((item) => !EMPTY.test(item));
  const [first, second] = clean(parsed.data.directions) as [string, string];
  return {
    ok: true,
    table: {
      idea: parsed.data.idea.trim(),
      directions: [first, second],
      firstScreen: parsed.data.firstScreen,
      anchors: parsed.data.anchors,
      retainedPrinciples: clean(parsed.data.retainedPrinciples),
      discardedDefaults: clean(parsed.data.discardedDefaults),
      strictlyExcluded: clean(parsed.data.strictlyExcluded),
    },
  };
}

/** The table as the file a workspace keeps. */
export function anchorTableJson(table: AnchorTable): string {
  return `${JSON.stringify(table, null, 2)}\n`;
}

/** The table as text for a prompt. Its cells were written by a model reading untrusted pages: callers fence it as data. */
export function renderAnchorTable(table: AnchorTable): string {
  const list = (items: readonly string[]): string => (items.length === 0 ? '  (none)' : items.map((item) => `  - ${item}`).join('\n'));
  return [
    `Idea: ${table.idea}`,
    `Directions:\n  1. ${table.directions[0]}\n  2. ${table.directions[1]}`,
    `First screen:\n  largest element: ${table.firstScreen.primaryElement}\n  what a person does straight away: ${table.firstScreen.interactiveAction}\n  what there is to look at: ${table.firstScreen.livingVisual}`,
    `Anchors (reference → principle → our value):\n${table.anchors.map((a) => `  - [${a.category}] ${a.referenceObserved} → ${a.derivedPrinciple} → ${a.ourValueAndSource}`).join('\n')}`,
    `Principles kept:\n${list(table.retainedPrinciples)}`,
    `Defaults thrown out:\n${list(table.discardedDefaults)}`,
    `Never taken from the reference:\n${list(table.strictlyExcluded)}`,
  ].join('\n');
}

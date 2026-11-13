import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { contract, faceFiles, type Face } from '@studio-zero/design';
import { fontPath } from '../harness/fontKit.ts';

/**
 * The theme's faces, as files a mock-up page can carry inside itself.
 *
 * A mock-up names its fonts by family and is shown with the network off, in a browser container and in the
 * owner's app. Neither has the theme's faces installed, so until the studio supplied the files every page was
 * drawn in the fallback: the look the theme decided on never reached the page, on either screen. A built
 * product gets its face's file with its theme; a mock-up has no build, so the studio puts the file in for it.
 *
 * There are three faces and a page is set in one. Pretendard comes in pieces. Whole it is 2 MB, more than a page
 * may carry, so it is shipped as its publisher splits it: one file per range of code points. A page gets the
 * pieces its own characters fall in and no others, each rule carrying its range, which is also how a browser
 * decides which piece to use. A short page carries a few hundred kilobytes; a page with no Hangul carries the
 * Latin piece alone. SUIT and SUITE are a quarter of that size and are not published in pieces, so they go in
 * whole. The Latin title faces the studio once supplied (Geist, Fraunces, Instrument Serif, Bricolage Grotesque)
 * are no longer faces a theme can name, and are no longer put in.
 */
const HANGUL_FAMILY = 'Pretendard Variable';
/** The publisher's split of the variable face: one `@font-face` per piece, each with its `unicode-range`. */
const HANGUL_CSS = 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
const HANGUL_WEIGHT = faceFiles.pretendard.weight;
/** The faces that go in whole. */
const WHOLE_FACES: readonly Exclude<Face, 'pretendard'>[] = ['suit', 'suite'];

/** The families this module can supply: each face under the name of its variable file. */
export const SUPPLIED_FACES: readonly string[] = [HANGUL_FAMILY, ...WHOLE_FACES.map((face) => contract.fonts.face[face][0]!)];

const require = createRequire(import.meta.url);
const loaded = new Map<string, string | null>();

/** A face's whole file as base64; null when the file is not installed here. */
function wholeFile(face: Face): string | null {
  const key = `whole:${face}`;
  if (!loaded.has(key)) {
    let data: string | null = null;
    try {
      data = readFileSync(fontPath(face)).toString('base64');
    } catch {
      data = null;
    }
    loaded.set(key, data);
  }
  return loaded.get(key) ?? null;
}

/**
 * Whether a page's styling names `family` as a font. Only where a page sets type is read (its style elements,
 * its style attributes and the font-family attribute an SVG text takes), and only the family as a whole name:
 * "suite" is a word a page may say and a class it may use, and SUITE is not SUIT with a letter added.
 */
function names(styling: string, family: string): boolean {
  return new RegExp(`(?<![\\w.#-])${family}(?![\\w-])`, 'i').test(styling);
}

/** Everything in a page that can set a font: the contents of its style elements and of its style and font-family attributes. */
function stylingOf(html: string): string {
  const sheets = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1]!);
  const attributes = [...html.matchAll(/\s(?:style|font-family)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[1] ?? m[2] ?? '');
  return [...sheets, ...attributes].join('\n');
}

/** The rule for a face that goes in whole, under the family name the page uses: the variable name, or the plain one. */
function wholeRule(styling: string, face: Exclude<Face, 'pretendard'>): string[] {
  const [variable, plain] = contract.fonts.face[face] as readonly [string, string];
  if (!names(styling, plain)) return [];
  const data = wholeFile(face);
  if (!data) return [];
  const family = names(styling, variable) ? variable : plain;
  return [`@font-face{font-family:"${family}";font-style:normal;font-weight:${faceFiles[face].weight};font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2-variations")}`];
}

interface Piece {
  file: string;
  /** The range as written in the publisher's stylesheet, for the rule. */
  rangeText: string;
  /** The same, as inclusive code point intervals. */
  ranges: readonly (readonly [number, number])[];
}

let pieces: readonly Piece[] | null | undefined;

/** `U+AC00-D7A3`, `U+2026`, `U+30??` as intervals. A wildcard digit spans 0 to F. */
function parseRanges(text: string): (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  for (const part of text.split(',')) {
    const m = /^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i.exec(part.trim());
    if (!m) continue;
    const from = parseInt(m[1]!.replace(/\?/g, '0'), 16);
    const to = parseInt(m[2] ?? m[1]!.replace(/\?/g, 'F'), 16);
    if (Number.isFinite(from) && Number.isFinite(to)) out.push([from, to]);
  }
  return out;
}

/** The Hangul face's pieces, read once from the installed package; null when it is not installed here. */
function hangulPieces(): readonly Piece[] | null {
  if (pieces !== undefined) return pieces;
  try {
    const cssPath = require.resolve(HANGUL_CSS);
    const dir = dirname(cssPath);
    pieces = [...readFileSync(cssPath, 'utf8').matchAll(/src:\s*url\(([^)]+)\)[^}]*?unicode-range:\s*([^;}]+)/g)].map(([, url, range]) => ({
      file: join(dir, url!.trim().replace(/^['"]|['"]$/g, '')),
      rangeText: range!.trim().replace(/\s+/g, ' '),
      ranges: parseRanges(range!),
    }));
  } catch {
    pieces = null;
  }
  return pieces;
}

/**
 * The characters a page draws: its text and its attribute values (alt text, a placeholder, a sample), without the
 * markup and the stylesheet. The angle brackets and braces of the markup alone would pull in the pieces that hold
 * the rarer symbols, each with its share of syllables the page never shows.
 */
function drawnCodePoints(html: string): Set<number> {
  const text = html
    .replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, (tag) => [...tag.matchAll(/=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => m[1] ?? m[2] ?? '').join(' '));
  const used = new Set<number>();
  for (const ch of text) used.add(ch.codePointAt(0)!);
  return used;
}

/** The rules for the pieces of the Hangul face that `html` draws from, under the family name the page uses. */
function hangulRules(html: string, family: string): string[] {
  const all = hangulPieces();
  if (!all) return [];
  const used = drawnCodePoints(html);
  const rules: string[] = [];
  for (const piece of all) {
    let needed = false;
    for (const cp of used) {
      if (piece.ranges.some(([from, to]) => cp >= from && cp <= to)) {
        needed = true;
        break;
      }
    }
    if (!needed) continue;
    const key = `piece:${piece.file}`;
    if (!loaded.has(key)) {
      try {
        loaded.set(key, readFileSync(piece.file).toString('base64'));
      } catch {
        loaded.set(key, null);
      }
    }
    const data = loaded.get(key);
    if (data) rules.push(`@font-face{font-family:"${family}";font-style:normal;font-weight:${HANGUL_WEIGHT};font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2-variations");unicode-range:${piece.rangeText}}`);
  }
  return rules;
}

/**
 * A page with the faces it names put inside it. Only the faces whose family the page mentions are added, in a
 * `<style>` of the studio's own placed where it cannot change how the document is parsed: after `<head>` when
 * there is one, otherwise after the doctype.
 */
export function withFaces(html: string): string {
  const lower = html.toLowerCase();
  // The page may name the variable face or the plain family; the pieces go in under whichever it uses.
  const hangul = lower.includes('pretendard') ? hangulRules(html, lower.includes('pretendard variable') ? HANGUL_FAMILY : 'Pretendard') : [];
  const styling = stylingOf(html);
  const rules = [...hangul, ...WHOLE_FACES.flatMap((face) => wholeRule(styling, face))];
  if (rules.length === 0) return html;
  const style = `<style data-studio-faces>${rules.join('')}</style>`;
  const head = /<head[^>]*>/i.exec(html);
  if (head) return `${html.slice(0, head.index + head[0].length)}${style}${html.slice(head.index + head[0].length)}`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype ? `${doctype[0]}${style}${html.slice(doctype[0].length)}` : `${style}${html}`;
}

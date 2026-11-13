import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * The theme's faces, as files a mock-up page can carry inside itself.
 *
 * A mock-up names its fonts by family and is shown with the network off, in a browser container and in the
 * owner's app. Neither has Fraunces or Geist installed, so until the studio supplied the files every title a
 * direction had chosen a face for was drawn in the fallback: the look the theme decided on never reached the
 * page, on either screen. A built product installs and self-hosts these faces; a mock-up has no build, so the
 * studio puts the files in for it.
 *
 * The Hangul face comes in pieces. Pretendard whole is 2 MB, more than a page may carry, so it is shipped as its
 * publisher splits it: one file per range of code points. A page gets the pieces its own characters fall in and
 * no others, each rule carrying its range, which is also how a browser decides which piece to use. A short page
 * carries a few hundred kilobytes; a page with no Hangul carries the Latin piece alone. The serif Hangul partners
 * (Noto Serif KR, Gowun Batang) are not supplied: Hangul under a serif title is set in Pretendard, in the
 * container and in the owner's app alike, which is what the page is told.
 */
const FACES: readonly { family: string; file: string; weight: string }[] = [
  { family: 'Geist', file: '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2', weight: '100 900' },
  { family: 'Fraunces', file: '@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2', weight: '100 900' },
  { family: 'Instrument Serif', file: '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2', weight: '400' },
  { family: 'Bricolage Grotesque', file: '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2', weight: '200 800' },
];

const HANGUL_FAMILY = 'Pretendard Variable';
/** The publisher's split of the variable face: one `@font-face` per piece, each with its `unicode-range`. */
const HANGUL_CSS = 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
const HANGUL_WEIGHT = '45 920';

/** The families this module can supply. */
export const SUPPLIED_FACES: readonly string[] = [HANGUL_FAMILY, ...FACES.map((face) => face.family)];

const require = createRequire(import.meta.url);
const loaded = new Map<string, string | null>();

/** One face as an `@font-face` rule with the file inside it; null when its package is not installed here. */
function rule(face: (typeof FACES)[number]): string | null {
  if (!loaded.has(face.family)) {
    let css: string | null = null;
    try {
      const data = readFileSync(require.resolve(face.file)).toString('base64');
      css = `@font-face{font-family:"${face.family}";font-style:normal;font-weight:${face.weight};font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2")}`;
    } catch {
      css = null;
    }
    loaded.set(face.family, css);
  }
  return loaded.get(face.family) ?? null;
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
  const rules = [...hangul, ...FACES.filter((face) => lower.includes(face.family.toLowerCase())).flatMap((face) => rule(face) ?? [])];
  if (rules.length === 0) return html;
  const style = `<style data-studio-faces>${rules.join('')}</style>`;
  const head = /<head[^>]*>/i.exec(html);
  if (head) return `${html.slice(0, head.index + head[0].length)}${style}${html.slice(head.index + head[0].length)}`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype ? `${doctype[0]}${style}${html.slice(doctype[0].length)}` : `${style}${html}`;
}

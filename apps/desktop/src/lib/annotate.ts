/**
 * Notes on a document, by line. The document is shown block by block, each block knowing the source lines it came
 * from, so a passage the owner selects in the rendered page can be named by its lines and quoted from the source.
 * The daemon checks that quote against the same lines before anything reaches a model, so what is sent here is
 * always a piece of the source as it is, never the rendered text.
 */

export type BlockKind = 'heading' | 'paragraph' | 'list' | 'quote' | 'table' | 'code';

/** A top-level block of a Markdown document: 1-based, inclusive source lines, and the source itself. */
export interface DocBlock {
  kind: BlockKind;
  startLine: number;
  endLine: number;
  source: string;
}

/** A note's place in the document, as `knowledge.revise` takes it. */
export interface Passage {
  startLine: number;
  endLine: number;
  quote: string;
}

/** The longest quote the daemon takes. */
export const QUOTE_MAX = 2000;

/** A document's lines, split exactly as the daemon splits them. */
export const docLines = (markdown: string): string[] => markdown.split('\n').map((line) => line.replace(/\r$/, ''));

/** How a quote is compared with its lines, here and in the daemon: any run of whitespace is one space. */
const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** `L12`, or `L12–L15` for a range: the label the owner and the writer both see. */
export const lineLabel = (p: { startLine: number; endLine: number }): string => (p.startLine === p.endLine ? `L${p.startLine}` : `L${p.startLine}–L${p.endLine}`);

const FENCE = /^\s*```/;
const HEADING = /^(#{1,4})\s+(.+?)\s*#*$/;
const ITEM = /^\s*(?:[-*+]|\d+\.)\s+/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}/;
const STRUCTURAL = /^\s*(?:#{1,4}\s|```|[-*+]\s|\d+\.\s|>|\|)/;

/**
 * The blocks of a document, grouped exactly as the Markdown renderer groups them, so each one rendered alone looks
 * as it does in the whole: a fenced block runs to its closing fence (blank lines inside included), a heading is
 * one line, a table and a run of list items or quoted lines is one block (an ordered list keeps its numbers), and
 * any other run of lines is a paragraph. Blank lines belong to no block.
 */
export function splitBlocks(markdown: string): DocBlock[] {
  const lines = docLines(markdown);
  const blocks: DocBlock[] = [];
  const push = (kind: BlockKind, from: number, to: number): void => void blocks.push({ kind, startLine: from + 1, endLine: to + 1, source: lines.slice(from, to + 1).join('\n') });
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const start = i;
    if (line.trim() === '') i += 1;
    else if (FENCE.test(line)) {
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i]!)) i += 1;
      push('code', start, Math.min(i, lines.length - 1));
      i += 1;
    } else if (HEADING.test(line)) {
      push('heading', start, start);
      i += 1;
    } else if (/^\s*\|/.test(line) && TABLE_RULE.test(lines[i + 1] ?? '')) {
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) i += 1;
      push('table', start, i - 1);
    } else if (ITEM.test(line)) {
      while (i < lines.length && ITEM.test(lines[i]!)) i += 1;
      push('list', start, i - 1);
    } else if (/^\s*>/.test(line)) {
      while (i < lines.length && /^\s*>/.test(lines[i]!)) i += 1;
      push('quote', start, i - 1);
    } else {
      while (i < lines.length && lines[i]!.trim() !== '' && !STRUCTURAL.test(lines[i]!)) i += 1;
      if (i === start) i += 1; // a line that looked structural but was not
      push('paragraph', start, i - 1);
    }
  }
  return blocks;
}

/**
 * The visible characters of lines `from`..`to` (1-based) with where each sits in the source: what the renderer
 * shows, without line markers, inline markup, table rules or whitespace. A rendered selection is found in this,
 * and mapped back to the source it came from.
 */
function visible(lines: readonly string[], from: number, to: number): { text: string; at: { line: number; col: number }[] } {
  let text = '';
  const at: { line: number; col: number }[] = [];
  const keep = (line: number, col: number, ch: string): void => {
    if (/\s|\|/.test(ch)) return;
    text += ch;
    at.push({ line, col });
  };
  let fenced = false;
  for (let n = 1; n <= to; n++) {
    const line = lines[n - 1] ?? '';
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (n < from) continue;
    if (fenced) {
      [...line].forEach((ch, col) => keep(n, col, ch));
      continue;
    }
    if (TABLE_RULE.test(line) && /^[\s|:-]*$/.test(line)) continue;
    const lead = /^(?:#{1,4}\s+|\s*(?:[-*+]|\d+\.)\s+|\s*>\s?)/.exec(line)?.[0].length ?? 0;
    // The renderer's inline forms: bold, code, a link's text, a citation's number. Everything else is literal.
    const inline = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\[(\d{1,3})\]/g;
    inline.lastIndex = lead;
    let col = lead;
    for (let m = inline.exec(line); m; m = inline.exec(line)) {
      for (; col < m.index; col++) keep(n, col, line[col]!);
      const inner = m[1] ?? m[2] ?? m[3] ?? m[5] ?? '';
      const offset = m[1] !== undefined ? 2 : 1;
      for (let k = 0; k < inner.length; k++) keep(n, m.index + offset + k, inner[k]!);
      col = m.index + m[0].length;
    }
    for (; col < line.length; col++) keep(n, col, line[col]!);
  }
  return { text, at };
}

/**
 * A note's place from the rendered text the owner selected inside source lines `startLine`..`endLine`. When the
 * selection is found in those lines, the note covers just the lines it touches and quotes the source between its
 * first and last character (a citation's brackets and bold's asterisks included). When it is not (it ran over
 * something the renderer draws), the note covers the whole range and quotes its source lines.
 */
export function rangeToAnnotation(markdown: string, startLine: number, endLine: number, selected: string): Passage {
  const lines = docLines(markdown);
  const needle = selected.replace(/[\s|]+/g, '');
  const shown = visible(lines, startLine, endLine);
  const found = needle === '' ? -1 : shown.text.indexOf(needle);
  if (found >= 0) {
    const first = shown.at[found]!;
    const last = shown.at[found + needle.length - 1]!;
    const span = lines.slice(first.line - 1, last.line);
    // The end is cut before the start: on a one-line span both cuts are of the same line.
    span[span.length - 1] = span.at(-1)!.slice(0, last.col + 1);
    span[0] = span[0]!.slice(first.col);
    return { startLine: first.line, endLine: last.line, quote: span.join('\n').slice(0, QUOTE_MAX) };
  }
  return { startLine, endLine, quote: lines.slice(startLine - 1, endLine).join('\n').slice(0, QUOTE_MAX) };
}

/** Whether a note still stands on this text: its lines exist and its quote is in them. The daemon's own check. */
export function quoteMatches(markdown: string, p: Passage): boolean {
  const lines = docLines(markdown);
  if (p.startLine < 1 || p.endLine < p.startLine || p.endLine > lines.length) return false;
  const quote = collapse(p.quote);
  return quote !== '' && collapse(lines.slice(p.startLine - 1, p.endLine).join('\n')).includes(quote);
}

/** The block of the page a DOM node sits in, by the line range it carries. */
function blockOf(node: Node | null): { start: number; end: number } | null {
  const el = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-line-start]');
  if (!el) return null;
  const start = Number(el.dataset.lineStart);
  const end = Number(el.dataset.lineEnd);
  return Number.isInteger(start) && Number.isInteger(end) ? { start, end } : null;
}

/** A selection in the rendered document as a note's place, or null when it is empty or not wholly in the document. */
export function selectionToAnnotation(selection: Selection, markdown: string): Passage | null {
  if (selection.isCollapsed) return null;
  const a = blockOf(selection.anchorNode);
  const b = blockOf(selection.focusNode);
  if (!a || !b) return null;
  return rangeToAnnotation(markdown, Math.min(a.start, b.start), Math.max(a.end, b.end), selection.toString());
}

/** sha256 of the Markdown as UTF-8, in hex: the same fingerprint the daemon binds a review to. */
export async function hashMarkdown(markdown: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(markdown));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

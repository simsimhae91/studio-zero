import type { CodeNode } from './highlight.ts';

/**
 * Highlighted code cut into its lines, each line keeping the spans it sits inside.
 *
 * A file is shown line by line, so that a long line can wrap and its number still sits beside its first row.
 * The highlighter returns one tree for the whole file, in which a span (a block comment, a fenced block of a
 * markdown file) may run over many lines: such a span is closed at each line end and opened again on the next.
 */
export function splitLines(nodes: readonly CodeNode[]): CodeNode[][] {
  const lines: CodeNode[][] = [[]];
  for (const node of nodes) {
    const parts = node.type === 'text' ? node.value.split('\n').map((value): CodeNode[] => (value === '' ? [] : [{ type: 'text', value }])) : splitLines(node.children).map((children): CodeNode[] => (children.length === 0 ? [] : [{ type: 'span', classes: node.classes, children }]));
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      lines.at(-1)!.push(...part);
    });
  }
  return lines;
}

/** The lines of a file as they are shown: coloured when there is colour for this exact content, plain otherwise. A final newline does not make a last, empty line. */
export function shownLines(content: string, colored: readonly CodeNode[] | null): CodeNode[][] {
  const lines = splitLines(colored ?? [{ type: 'text', value: content }]);
  if (lines.length > 1 && content.endsWith('\n')) lines.pop();
  return lines;
}

/** Files that are prose: read as a document first, and as source when asked. */
export const isMarkdown = (path: string): boolean => /\.(?:md|mdx|markdown)$/i.test(path);

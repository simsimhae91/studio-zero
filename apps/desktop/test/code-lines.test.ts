import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMarkdown, shownLines, splitLines } from '../src/lib/codeLines.ts';
import type { CodeNode } from '../src/lib/highlight.ts';

const text = (value: string): CodeNode => ({ type: 'text', value });
const span = (cls: string, ...children: CodeNode[]): CodeNode => ({ type: 'span', classes: [cls], children });
/** A line back as its text, with each span's class around what it holds. */
const flat = (line: readonly CodeNode[]): string => line.map((node) => (node.type === 'text' ? node.value : `<${node.classes.join('.')}>${flat(node.children)}</>`)).join('');

test('a highlighted file is cut into its lines, and a span that runs over lines is reopened on each', () => {
  const nodes = [span('keyword', text('const')), text(' a = 1;\n'), span('comment', text('/* one\n   two\n'), span('doctag', text('@see')), text(' three */')), text('\n\nend')];
  assert.deepEqual(splitLines(nodes).map(flat), ['<keyword>const</> a = 1;', '<comment>/* one</>', '<comment>   two</>', '<comment><doctag>@see</> three */</>', '', 'end']);
  assert.deepEqual(splitLines([]).map(flat), ['']);
});

test('the lines shown are the file\'s: no empty last line for a final newline, plain text until its colour arrives', () => {
  assert.deepEqual(shownLines('a\n\nb\n', null).map(flat), ['a', '', 'b']);
  assert.deepEqual(shownLines('a\nb', null).map(flat), ['a', 'b']);
  assert.deepEqual(shownLines('', null).map(flat), ['']);
  assert.deepEqual(shownLines('x = 1\n', [span('attr', text('x')), text(' = 1\n')]).map(flat), ['<attr>x</> = 1']);
  // Joined back, the lines are the file.
  const source = 'export const a = 1;\n\n/* two\n   lines */\n';
  assert.equal(shownLines(source, null).map((line) => line.map((n) => (n.type === 'text' ? n.value : '')).join('')).join('\n') + '\n', source);
});

test('a markdown file is read as a document', () => {
  assert.deepEqual(['docs/prd.md', 'README.MD', 'notes.mdx', 'a.markdown'].map(isMarkdown), [true, true, true, true]);
  assert.deepEqual(['docs/openapi.yaml', 'src/App.tsx', 'md', 'readme.md.bak'].map(isMarkdown), [false, false, false, false]);
});

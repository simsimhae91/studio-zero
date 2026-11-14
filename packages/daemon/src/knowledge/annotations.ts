import { createHash } from 'node:crypto';
import type { DocumentAnnotation } from '@studio-zero/protocol';
import { ConflictError } from '../app/errors.ts';
import { untrusted } from '../trust/dataBlock.ts';

/** The fingerprint a review is bound to: sha256 of the Markdown as UTF-8, in hex. The desktop computes the same. */
export function hashMarkdown(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}

/** A document's lines, 1-based by index + 1, split the way the desktop splits them. */
export function documentLines(markdown: string): string[] {
  return markdown.split('\n').map((line) => line.replace(/\r$/, ''));
}

/** How a quote is compared with the lines it names: runs of whitespace (line breaks included) are one space. */
export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** `L12`, or `L12–L15` for a range. */
export const lineLabel = (a: { startLine: number; endLine: number }): string => (a.startLine === a.endLine ? `L${a.startLine}` : `L${a.startLine}–L${a.endLine}`);

/**
 * The owner's notes on a document as one user message for the writer. Pure: no I/O, no clock.
 *
 * Every note is checked against the document as stored, not as the client says it was: its lines must exist, and
 * its quote must be found in those lines. One that fails refuses the whole request, naming the note, so nothing
 * the owner wrote is dropped without them knowing. The text of the document is taken from the stored lines and
 * sits only inside data blocks (it is a model's writing, possibly built on web pages); the owner's comments and
 * note are outside them, as the instructions they are.
 */
export function buildRevisionRequest(markdown: string, annotations: readonly DocumentAnnotation[], note?: string): string {
  const overall = note?.trim() ?? '';
  if (annotations.length === 0 && overall === '') throw new ConflictError('수정할 곳이 없습니다. 구절에 메모를 달거나 문서 전체에 대한 메모를 적어 주세요.');
  const lines = documentLines(markdown);
  const checked = annotations.map((a) => {
    const label = lineLabel(a);
    if (!Number.isInteger(a.startLine) || !Number.isInteger(a.endLine) || a.startLine < 1 || a.endLine < a.startLine || a.endLine > lines.length) {
      throw new ConflictError(`${label} 메모가 가리키는 줄이 문서에 없습니다. 문서는 ${lines.length}줄입니다.`);
    }
    const source = lines.slice(a.startLine - 1, a.endLine).join('\n');
    const quote = collapse(a.quote);
    if (quote === '' || !collapse(source).includes(quote)) throw new ConflictError(`${label} 메모가 인용한 글이 그 줄에 없습니다. 문서를 다시 불러와 그 구절을 다시 골라 주세요.`);
    if (a.comment.trim() === '') throw new ConflictError(`${label} 메모가 비어 있습니다.`);
    return { ...a, label, source, quote, narrower: quote !== collapse(source) };
  });
  checked.sort((x, y) => x.startLine - y.startLine || x.endLine - y.endLine);

  const parts = [
    checked.length > 0
      ? `The owner left ${checked.length} note${checked.length === 1 ? '' : 's'} on the document, in line order. Each gives the lines it is about (taken from the document), the words the owner selected when that is narrower than the lines, then the owner's comment.`
      : 'The owner left no note on a passage; the note on the whole document follows.',
    ...checked.map((a, i) =>
      [
        `Note ${i + 1}, ${a.label}:`,
        untrusted('knowledge-document', a.source, { lines: a.label }),
        a.narrower ? `The owner selected these words within those lines:\n${untrusted('knowledge-document', a.quote)}` : '',
        `The owner's comment:\n${a.comment.trim()}`,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    overall ? `The owner's note on the whole document:\n${overall}` : '',
  ];
  return parts.filter(Boolean).join('\n\n');
}

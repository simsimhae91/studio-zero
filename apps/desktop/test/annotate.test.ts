import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { hashMarkdown, lineLabel, quoteMatches, rangeToAnnotation, splitBlocks } from '../src/lib/annotate.ts';

const DOC = [
  '# 투자 브리핑', // 1
  '', // 2
  '## 결론', // 3
  '', // 4
  '설비 투자는 합계 **1,120억 달러**로 늘었다 [1].', // 5
  '늘어난 금액은 [GPU 서버](https://example.com/gpu)에 쓰였다.', // 6
  '', // 7
  '1. 전력 계약을 확인한다.', // 8
  '2. 가이던스를 확인한다.', // 9
  '', // 10
  '```mermaid', // 11
  'flowchart LR', // 12
  '', // 13
  '  A --> B', // 14
  '```', // 15
  '', // 16
  '| 항목 | 금액 |', // 17
  '| --- | --- |', // 18
  '| 합계 | 1,120억 달러 [1] |', // 19
  '> 인용한 문장', // 20
].join('\n');

test('a document is split into the blocks the renderer draws, each with its source lines', () => {
  assert.deepEqual(
    splitBlocks(DOC).map((b) => [b.kind, b.startLine, b.endLine]),
    [['heading', 1, 1], ['heading', 3, 3], ['paragraph', 5, 6], ['list', 8, 9], ['code', 11, 15], ['table', 17, 19], ['quote', 20, 20]],
  );
  assert.equal(splitBlocks(DOC)[4]!.source, '```mermaid\nflowchart LR\n\n  A --> B\n```', 'a blank line inside a fence stays in it');
  assert.deepEqual(splitBlocks('a\r\nb\r\n\r\n- x\n  - y\nz').map((b) => [b.kind, b.startLine, b.endLine, b.source]), [['paragraph', 1, 2, 'a\nb'], ['list', 4, 5, '- x\n  - y'], ['paragraph', 6, 6, 'z']]);
  assert.deepEqual(splitBlocks(''), []);
  assert.deepEqual(splitBlocks('```\nopen fence'), [{ kind: 'code', startLine: 1, endLine: 2, source: '```\nopen fence' }]);
});

test('a selection in rendered text becomes the source lines it touches and the source between its ends', () => {
  // Bold and a citation are drawn without their marks; the quote is the source, marks included.
  assert.deepEqual(rangeToAnnotation(DOC, 5, 6, '1,120억 달러로 늘었다 1'), { startLine: 5, endLine: 5, quote: '1,120억 달러**로 늘었다 [1' });
  assert.deepEqual(rangeToAnnotation(DOC, 5, 6, '늘었다 1.\n늘어난 금액은 GPU 서버'), { startLine: 5, endLine: 6, quote: '늘었다 [1].\n늘어난 금액은 [GPU 서버' });
  // A selection across two blocks, the list and the paragraph before it: their combined range, narrowed to what it touches.
  assert.deepEqual(rangeToAnnotation(DOC, 5, 9, '에 쓰였다.\n\n전력 계약을 확인한다.\n가이던스'), { startLine: 6, endLine: 9, quote: '에 쓰였다.\n\n1. 전력 계약을 확인한다.\n2. 가이던스' });
  assert.deepEqual(rangeToAnnotation(DOC, 17, 19, '합계\t1,120억 달러 1'), { startLine: 19, endLine: 19, quote: '합계 | 1,120억 달러 [1' }, 'table cells are found without their rules');
  // What cannot be found in the source (a diagram drawn from it) falls back to the whole range, quoted as source.
  assert.deepEqual(rangeToAnnotation(DOC, 11, 15, 'A B'), { startLine: 11, endLine: 15, quote: '```mermaid\nflowchart LR\n\n  A --> B\n```' });
  for (const p of [rangeToAnnotation(DOC, 5, 6, '1,120억 달러로'), rangeToAnnotation(DOC, 5, 9, '쓰였다. 전력'), rangeToAnnotation(DOC, 11, 15, 'nothing')]) assert.ok(quoteMatches(DOC, p), `the daemon will find ${JSON.stringify(p.quote)}`);
  assert.equal(rangeToAnnotation(DOC, 5, 6, 'x'.repeat(3000)).quote.length <= 2000, true);
});

test('a note still stands on text whose lines are unchanged, and not once they change', () => {
  const note = rangeToAnnotation(DOC, 8, 9, '가이던스를 확인한다');
  assert.equal(lineLabel(note), 'L9');
  assert.equal(lineLabel({ startLine: 5, endLine: 9 }), 'L5–L9');
  assert.ok(quoteMatches(DOC, note));
  assert.ok(quoteMatches(DOC.replace('# 투자 브리핑', '# 투자 브리핑 (수정)'), note), 'a change elsewhere leaves it standing');
  assert.ok(!quoteMatches(DOC.replace('가이던스를', '실적 발표를'), note));
  assert.ok(!quoteMatches(DOC.split('\n').slice(0, 7).join('\n'), note), 'nor when its lines are gone');
});

test('the fingerprint is the daemon\'s: sha256 of the UTF-8 text', async () => {
  assert.equal(await hashMarkdown(DOC), createHash('sha256').update(DOC, 'utf8').digest('hex'));
});

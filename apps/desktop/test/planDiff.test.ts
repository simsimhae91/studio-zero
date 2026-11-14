import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_CELLS, diffWords, tokenize, type DiffOp } from '../src/lib/planDiff.ts';

const side = (ops: readonly DiffOp[], drop: DiffOp['kind']): string => ops.filter((op) => op.kind !== drop).map((op) => op.text).join('');
const both = (ops: readonly DiffOp[], before: string, after: string): void => {
  assert.equal(side(ops, 'add'), before, 'same + del is the older text, exactly');
  assert.equal(side(ops, 'del'), after, 'same + add is the newer text, exactly');
};

test('tokenize keeps every character, line breaks included', () => {
  const text = '  ## 단계\n\n1. 목록 화면을 만든다\n2. 저장한다 ';
  assert.equal(tokenize(text).join(''), text);
  assert.deepEqual(tokenize(''), []);
});

test('identical versions are one unchanged run', () => {
  const text = '## 요약\n\n청구서 목록에 결제 이력을 붙인다.\n';
  assert.deepEqual(diffWords(text, text), [{ kind: 'same', text }]);
  assert.deepEqual(diffWords('', ''), []);
});

test('an insertion is the added words alone', () => {
  const before = '1. 목록 화면을 만든다\n2. 저장한다\n';
  const after = '1. 목록 화면을 만든다\n2. 빈 상태를 보여 준다\n3. 저장한다\n';
  const ops = diffWords(before, after);
  both(ops, before, after);
  assert.deepEqual(
    ops.filter((op) => op.kind !== 'same').map((op) => op.kind),
    ['add'],
    'nothing of the old text is counted as removed',
  );
  assert.ok(ops.find((op) => op.kind === 'add')!.text.includes('빈 상태를'));
});

test('a deletion is the removed words alone', () => {
  const before = '목록을 만들고 검색창과 필터를 위에 둔다.';
  const after = '목록을 만들고 검색창을 위에 둔다.';
  const ops = diffWords(before, after);
  both(ops, before, after);
  assert.equal(ops.filter((op) => op.kind === 'del').length, 1);
  assert.equal(ops.filter((op) => op.kind === 'add').length, 1, 'the changed word is one replacement');
  assert.deepEqual(
    diffWords('하나 둘 셋', '하나 셋').filter((op) => op.kind !== 'same'),
    [{ kind: 'del', text: '둘 ' }],
  );
});

test('a paragraph that moved is removed where it was and added where it is', () => {
  const first = 'Show the invoice list with its totals.\n\n';
  const second = 'Add a payment history under each invoice.\n\n';
  const third = 'Keep the export button where it is.\n';
  const before = first + second + third;
  const after = second + first + third;
  const ops = diffWords(before, after);
  both(ops, before, after);
  const changed = ops.filter((op) => op.kind !== 'same');
  assert.equal(changed.length, 2, 'one removal and one insertion');
  assert.deepEqual(changed.map((op) => op.kind).sort(), ['add', 'del']);
  assert.equal(changed[0]!.text, changed[1]!.text, 'the same paragraph, once on each side');
});

test('runs of one kind are merged, so the view gets one span per change', () => {
  const ops = diffWords('a b c', 'x y z');
  both(ops, 'a b c', 'x y z');
  for (let i = 1; i < ops.length; i++) assert.notEqual(ops[i]!.kind, ops[i - 1]!.kind);
});

test('two long texts with nothing in common are not set word against word: the middle goes out and comes in whole', () => {
  const words = Math.ceil(Math.sqrt(MAX_CELLS)) + 10;
  const before = `머리말 ${Array.from({ length: words }, (_, i) => `가${i}`).join(' ')} 맺음말`;
  const after = `머리말 ${Array.from({ length: words }, (_, i) => `나${i}`).join(' ')} 맺음말`;
  const ops = diffWords(before, after);
  assert.deepEqual(ops.map((op) => op.kind), ['same', 'del', 'add', 'same']);
  assert.equal(ops.filter((op) => op.kind !== 'add').map((op) => op.text).join(''), before, 'what was there is all still there');
  assert.equal(ops.filter((op) => op.kind !== 'del').map((op) => op.text).join(''), after);
});

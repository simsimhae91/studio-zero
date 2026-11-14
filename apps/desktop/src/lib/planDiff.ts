/** One run of a word diff: text both versions share, text only the newer one has, or text only the older one had. */
export interface DiffOp {
  kind: 'same' | 'add' | 'del';
  text: string;
}

/**
 * Splits text into words with the whitespace after each kept on it, so that joining the tokens gives the text
 * back exactly, line breaks included. Leading whitespace is a token of its own.
 */
export function tokenize(text: string): string[] {
  return text.match(/^\s+|\S+\s*/g) ?? [];
}

/**
 * The word-level difference between two versions of a plan, in order. Joining the `same` and `del` runs gives
 * `before` back; joining the `same` and `add` runs gives `after`. A paragraph that moved shows as removed where it
 * was and added where it is. Longest common subsequence over the words, after the shared head and tail are set
 * aside; adjacent runs of one kind are merged.
 */
export function diffWords(before: string, after: string): DiffOp[] {
  const a = tokenize(before);
  const b = tokenize(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);

  // lcs[i * (m + 1) + j]: the longest common run of x[i..] and y[j..].
  const n = x.length;
  const m = y.length;
  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] = x[i] === y[j] ? lcs[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(lcs[(i + 1) * (m + 1) + j]!, lcs[i * (m + 1) + j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  const push = (kind: DiffOp['kind'], text: string): void => {
    const last = ops.at(-1);
    if (last?.kind === kind) last.text += text;
    else ops.push({ kind, text });
  };
  for (const token of a.slice(0, head)) push('same', token);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push('same', x[i]!);
      i++;
      j++;
    } else if (lcs[(i + 1) * (m + 1) + j]! >= lcs[i * (m + 1) + j + 1]!) {
      push('del', x[i]!);
      i++;
    } else {
      push('add', y[j]!);
      j++;
    }
  }
  for (; i < n; i++) push('del', x[i]!);
  for (; j < m; j++) push('add', y[j]!);
  for (const token of a.slice(a.length - tail)) push('same', token);
  return ops;
}

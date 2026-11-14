import type { DiffFile, DiffHunk, DiffLine, Project, ReviewComment, ReviewDiff, ReviewResult, Task } from '@studio-zero/protocol';
import { ConflictError } from '../app/errors.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { untrusted } from '../trust/dataBlock.ts';
import { INTEGRATION_BRANCH } from './Harness.ts';

/**
 * The owner's line-by-line review of a task's code: the branch's diff, read with git inside the project's
 * sandbox, and the text a review that sends the work back becomes.
 *
 * The diff is sandbox output, next to code an agent wrote. It is parsed here line by line, the way
 * `SandboxFileService` treats a listing: every path is confined again, control characters are replaced, and
 * limits on size, files and lines hold whatever git printed. Past a limit the parse stops and says `truncated`
 * instead of failing: a review of most of a large change is still a review.
 */

export interface DiffCaps {
  /** Diff text read at most, in bytes. */
  bytes: number;
  /** Files at most. */
  files: number;
  /** Lines kept per file. Its +/- counts still cover the whole file. */
  fileLines: number;
  /** Characters kept per line. */
  lineChars: number;
}

export const DIFF_CAPS: DiffCaps = { bytes: 400_000, files: 300, fileLines: 4000, lineChars: 2000 };

interface Draft {
  path: string | null;
  oldSide: string | null;
  status: DiffFile['status'];
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  kept: number;
}

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** A C-quoted git path (`"caf\303\251.txt"`) as text; anything else as it is. */
function unquote(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const bytes: number[] = [];
  const body = raw.slice(1, -1);
  const escapes: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '\\': 92, '"': 34 };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else {
      bytes.push(escapes[body[i + 1] ?? ''] ?? 63);
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** A path from the diff with its `a/` or `b/` prefix taken off, or null when it is not a path inside the workspace. */
function confine(raw: string, prefix: 'a/' | 'b/'): string | null {
  const text = unquote(raw.endsWith('\t') ? raw.slice(0, -1) : raw);
  const path = text.startsWith(prefix) ? text.slice(prefix.length) : text;
  if (path.length === 0 || path.length > 1024 || path.startsWith('/') || /[\u0000-\u001f\u007f]/.test(path)) return null;
  return path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..') ? null : path;
}

/** The two paths of a `diff --git a/x b/y` header. Plain names are split in the middle, where an unchanged name splits. */
function headerPaths(rest: string): [string, string] | null {
  if (rest.startsWith('"')) {
    const m = /^("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*"|.+)$/.exec(rest);
    return m ? [m[1]!, m[2]!] : null;
  }
  if ((rest.length - 1) % 2 === 0) {
    const half = (rest.length - 1) / 2;
    const [a, b] = [rest.slice(0, half), rest.slice(half + 1)];
    if (a.startsWith('a/') && b.startsWith('b/') && a.slice(2) === b.slice(2)) return [a, b];
  }
  const at = rest.lastIndexOf(' b/');
  return at > 0 ? [rest.slice(0, at), rest.slice(at + 1)] : null;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * `git diff` output as files, hunks and numbered lines. Handles renames, added and deleted files, binary files and
 * `\ No newline at end of file`. `cut` says the text was already cut short where it was read.
 */
export function parseUnifiedDiff(text: string, caps: DiffCaps = DIFF_CAPS, cut = false): { files: DiffFile[]; truncated: boolean } {
  let truncated = cut;
  if (Buffer.byteLength(text) > caps.bytes) {
    text = Buffer.from(text).subarray(0, caps.bytes).toString('utf8');
    truncated = true;
  }
  const rows = text.split('\n');
  // A text cut short ends inside a line; one read whole ends with a newline.
  if (truncated) rows.pop();
  else if (rows.at(-1) === '') rows.pop();

  const files: DiffFile[] = [];
  let file: Draft | null = null;
  let hunk: DiffHunk | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let oldNo = 0;
  let newNo = 0;

  const finish = (): void => {
    if (file?.path) files.push({ path: file.path, oldPath: file.status === 'renamed' ? file.oldSide : null, status: file.status, binary: file.binary, additions: file.additions, deletions: file.deletions, hunks: file.binary ? [] : file.hunks });
    file = null;
    hunk = null;
    oldLeft = newLeft = 0;
  };

  for (const row of rows) {
    if (row.startsWith('\\')) continue; // "\ No newline at end of file": about the line before, not a line
    if (file && hunk && (oldLeft > 0 || newLeft > 0)) {
      const sign = row[0];
      if (sign === ' ' || sign === '+' || sign === '-') {
        const kind: DiffLine['kind'] = sign === '+' ? 'add' : sign === '-' ? 'del' : 'context';
        const line: DiffLine = { kind, oldLine: kind === 'add' ? null : oldNo, newLine: kind === 'del' ? null : newNo, text: '' };
        if (kind !== 'add') {
          oldNo++;
          oldLeft--;
        }
        if (kind !== 'del') {
          newNo++;
          newLeft--;
        }
        if (kind === 'add') file.additions++;
        if (kind === 'del') file.deletions++;
        if (file.kept >= caps.fileLines) {
          truncated = true;
          continue;
        }
        let body = row.slice(1).replace(/\r$/, '').replace(CONTROL, '�');
        if (body.length > caps.lineChars) {
          body = body.slice(0, caps.lineChars);
          truncated = true;
        }
        line.text = body;
        hunk.lines.push(line);
        file.kept++;
        continue;
      }
      hunk = null; // a hunk shorter than its header said: what follows is not part of it
      oldLeft = newLeft = 0;
    }
    if (row.startsWith('diff --git ')) {
      finish();
      if (files.length >= caps.files) {
        truncated = true;
        break;
      }
      const paths = headerPaths(row.slice('diff --git '.length));
      file = { path: paths ? confine(paths[1], 'b/') : null, oldSide: paths ? confine(paths[0], 'a/') : null, status: 'modified', binary: false, additions: 0, deletions: 0, hunks: [], kept: 0 };
      continue;
    }
    if (!file) continue;
    const draft: Draft = file;
    const header = HUNK.exec(row);
    if (header) {
      const [oldStart, oldLines, newStart, newLines] = [Number(header[1]), header[2] === undefined ? 1 : Number(header[2]), Number(header[3]), header[4] === undefined ? 1 : Number(header[4])];
      hunk = { oldStart, oldLines, newStart, newLines, lines: [] };
      draft.hunks.push(hunk);
      oldNo = Math.max(oldStart, 1);
      newNo = Math.max(newStart, 1);
      oldLeft = oldLines;
      newLeft = newLines;
    } else if (row.startsWith('new file mode') || row.startsWith('copy to ')) {
      draft.status = 'added';
      if (row.startsWith('copy to ')) draft.path = confine(row.slice('copy to '.length), 'b/');
    } else if (row.startsWith('deleted file mode')) draft.status = 'deleted';
    else if (row.startsWith('rename from ')) {
      draft.status = 'renamed';
      draft.oldSide = confine(row.slice('rename from '.length), 'a/');
    } else if (row.startsWith('rename to ')) draft.path = confine(row.slice('rename to '.length), 'b/');
    else if (row.startsWith('--- ')) {
      if (row !== '--- /dev/null') draft.oldSide = confine(row.slice(4), 'a/');
    } else if (row.startsWith('+++ ')) {
      if (row !== '+++ /dev/null') draft.path = confine(row.slice(4), 'b/');
    } else if (row.startsWith('Binary files ') || row === 'GIT binary patch') draft.binary = true;
  }
  finish();
  return { files, truncated };
}

/**
 * The diff of a task's branch against where it started, read in the project's sandbox.
 *
 * `startedAt` is the commit the workspace stood at when the task began (its base checkpoint's). The diff is taken
 * from there, not from the base branch as it is now: once a task's branch is merged it is an ancestor of that
 * branch, and `main...branch` then shows no file of a task that changed eighteen. A task that went on from
 * another task's branch (`baseBranch`) is set against that branch, so the review is of what this task added.
 */
export async function readTaskDiff(sandboxes: Pick<OrbStackManager, 'diff'>, project: Project, task: Pick<Task, 'branch' | 'baseBranch'>, startedAt: string | null = null): Promise<ReviewDiff> {
  if (!task.branch) throw new ConflictError('this task has no branch to review');
  const base = task.baseBranch ?? INTEGRATION_BRANCH;
  const from = task.baseBranch ?? startedAt ?? INTEGRATION_BRANCH;
  // A little over the parse limit, so a diff that fits is never reported cut because of the stat line before it.
  const read = await sandboxes.diff(project, from, task.branch, DIFF_CAPS.bytes + 4096);
  const parsed = parseUnifiedDiff(read.diff, DIFF_CAPS, read.truncated);
  return { base, branch: task.branch, files: parsed.files, truncated: parsed.truncated };
}

export function countBlocking(result: ReviewResult): number {
  return result.comments.filter((c) => c.blocking).length;
}

/** The lines a comment is about, from the daemon's own reading of the diff. They must lie in one hunk. */
function linesOf(diff: ReviewDiff, c: ReviewComment): DiffLine[] {
  const file = diff.files.find((f) => f.path === c.path);
  const where = `${c.path} ${c.side === 'new' ? 'new' : 'old'} ${c.startLine}-${c.endLine}`;
  if (!file || file.binary) throw new ConflictError(`${where}: that file has no lines in this task's diff`);
  const key = c.side === 'new' ? 'newLine' : 'oldLine';
  for (const hunk of file.hunks) {
    const lines = hunk.lines.filter((l) => l[key] !== null && l[key] >= c.startLine && l[key] <= c.endLine);
    if (lines.length === c.endLine - c.startLine + 1) return lines;
  }
  throw new ConflictError(`${where}: those lines are not in one hunk of the diff as it is now. Read the diff again and comment on it.`);
}

const LABEL: Record<ReviewComment['label'], string> = { issue: 'issue', suggestion: 'suggestion', question: 'question' };
const PREVIOUS_MAX = 4000;
/** How much of a comment's range is quoted: the file is on the branch, the quote only points at it. */
const QUOTE_LINES = 40;
const QUOTE_CHARS = 400;
/** The longest request a review becomes. Past it the review is refused, not cut: a cut review drops comments. */
export const FEEDBACK_MAX = 120_000;

/** A fence longer than any run of backticks in the code, so the owner's code cannot close it. */
function fenced(code: string): string {
  const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${code}\n${fence}`;
}

/**
 * What an annotated review asks of the task that addresses it: one request whose first line names it, then every
 * comment, blocking ones first, then by file and line. The owner's words go in as they wrote them; the code each
 * comment is about is quoted from the diff the daemon read itself, never from the client, inside a data block.
 * Throws `ConflictError` when a comment's lines are not in one hunk of `diff`.
 */
export function formatReviewFeedback(result: Extract<ReviewResult, { decision: 'annotated' }>, diff: ReviewDiff, previous: Pick<Task, 'prompt'>): string {
  const comments = [...result.comments].sort((a, b) => Number(b.blocking) - Number(a.blocking) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.startLine - b.startLine);
  const quoted = comments.map((c) => linesOf(diff, c));
  const blocking = countBlocking(result);
  const request = previous.prompt.length <= PREVIOUS_MAX ? previous.prompt : `${previous.prompt.split('\n')[0]!.slice(0, 300)} (the rest is on the previous task)`;
  const parts = [
    `코드 리뷰 코멘트 ${comments.length}개 반영${blocking > 0 ? ` (차단 ${blocking}개)` : ''}`,
    '',
    `The owner read the diff of ${diff.branch} against ${diff.base} line by line and left the comments below. This task starts from that branch. Fix every comment marked BLOCKING. Weigh the others and act on them where they hold; where you do not, say why in your final message. Answer each question in your final message. Change nothing the comments do not ask for.`,
    '',
    'The request that branch was built for:',
    request,
  ];
  comments.forEach((c, i) => {
    const lines = quoted[i]!;
    const range = c.startLine === c.endLine ? `line ${c.startLine}` : `lines ${c.startLine}-${c.endLine}`;
    const shown = lines.slice(0, QUOTE_LINES).map((l) => `${String(c.side === 'new' ? l.newLine : l.oldLine).padStart(5)} ${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '} ${l.text.slice(0, QUOTE_CHARS)}`);
    if (lines.length > QUOTE_LINES) shown.push(`(${lines.length - QUOTE_LINES} more lines in the range: read them in the file)`);
    const code = shown.join('\n');
    parts.push(
      '',
      `Comment ${i + 1} of ${comments.length} · ${c.blocking ? 'BLOCKING' : 'not blocking'} · ${LABEL[c.label]}`,
      `File: ${c.path}, ${range} on the ${c.side === 'new' ? 'branch side (new)' : 'base side (old)'}`,
      'The owner says:',
      c.body,
      'The code at those lines, as the diff shows it:',
      untrusted('sandbox-output', code, { path: c.path, side: c.side, lines: `${c.startLine}-${c.endLine}` }),
    );
    if (c.suggestedCode !== undefined) parts.push('Code the owner suggests for those lines:', fenced(c.suggestedCode));
  });
  const text = parts.join('\n');
  if (text.length > FEEDBACK_MAX) throw new ConflictError('리뷰가 작업 하나로 보내기에 너무 깁니다. 코멘트를 나누거나 줄여 주세요.');
  return text;
}

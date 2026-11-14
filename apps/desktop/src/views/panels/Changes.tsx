import { Check, ChevronDown, ChevronRight, MessageSquarePlus, OctagonAlert, RotateCw, X } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { REVIEW_BODY_MAX, REVIEW_CODE_MAX, REVIEW_COMMENTS_MAX, type DiffFile, type DiffHunk, type DiffLine, type ReviewComment, type ReviewDiff, type ReviewLabel, type ReviewOutcome, type ReviewResult, type Task } from '@studio-zero/protocol';
import { splitLines } from '../../lib/codeLines.ts';
import { reviewLabelText } from '../../lib/format.ts';
import type { CodeNode } from '../../lib/highlight.ts';
import { useAction, useQuery, useStudio } from '../../lib/studio.tsx';
import { Button, Empty, IconButton, Problem, Segmented, Status, inputClass } from '../../ui.tsx';

/** A file with more changed lines than this opens folded: its path and counts first, its lines when asked. */
const FOLD_AT = 400;
/** Above this many characters a file is shown without colour: highlighting it would stall the window. */
const HIGHLIGHT_LIMIT = 200_000;

type Side = 'old' | 'new';
/** Lines picked for a comment: one file, one hunk, one side, from one line number to another. */
interface Picked {
  path: string;
  hunk: number;
  side: Side;
  from: number;
  to: number;
}

const LABELS: readonly { id: ReviewLabel; label: string }[] = (['issue', 'suggestion', 'question'] as const).map((id) => ({ id, label: reviewLabelText[id] }));
const statusText: Record<DiffFile['status'], string> = { added: '새 파일', modified: '수정', deleted: '삭제', renamed: '이름 바뀜' };
const sideText: Record<Side, string> = { new: '바뀐 뒤', old: '바뀌기 전' };
const range = (from: number, to: number): string => (from === to ? `${from}번 줄` : `${Math.min(from, to)}–${Math.max(from, to)}번 줄`);
const changed = (file: DiffFile): number => file.additions + file.deletions;
const lineOn = (line: DiffLine, side: Side): number | null => (side === 'new' ? line.newLine : line.oldLine);

/**
 * The code a task changed, for the owner to read before taking it. Files and their hunks as the daemon read
 * them from git in the sandbox; line numbers that can be dragged over (or tapped, then tapped again) to pick
 * lines, and a comment on them with its kind, whether it holds the work back, and code to put there instead.
 *
 * It ends in one of two answers. 승인 is the merge the task's own button makes, and is held while comments are
 * waiting to be sent. 재수정 요청 sends the comments: the daemon starts a task on this branch that is asked to
 * address each one, with the lines it is about quoted from the diff.
 *
 * The code is an agent's: it is shown as text, coloured through the inert highlighter, never as markup.
 */
export function Changes({ task, comments, onComments, onDone }: { task: Task; comments: readonly ReviewComment[]; onComments: (next: ReviewComment[]) => void; onDone: (outcome: ReviewOutcome) => void }) {
  const { backend } = useStudio();
  const diff = useQuery('reviews.diff', { taskId: task.id }, ['task.state']);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<Picked | null>(null);
  const [writing, setWriting] = useState(false);
  const [outcome, setOutcome] = useState<ReviewOutcome | null>(null);
  const dragging = useRef(false);
  const pointer = useRef<string>('');
  const finished = task.state === 'succeeded' || task.state === 'failed' || task.state === 'cancelled';
  // Merging is offered where the task's own merge button is: on work that passed. Comments can go back on any finished task.
  const mergeable = task.state === 'succeeded';

  const isOpen = (file: DiffFile): boolean => (changed(file) > FOLD_AT) === toggled.has(file.path);
  const toggle = (path: string): void =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  // A drag over the line numbers ends wherever the button is let go, inside the panel or not.
  useEffect(() => {
    const up = (): void => {
      if (!dragging.current) return;
      dragging.current = false;
      setWriting(true);
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const colored = useColored(diff.data ?? null, isOpen);

  const submit = useAction(async (result: ReviewResult) => {
    const answer = await backend.call('reviews.submit', { taskId: task.id, result });
    setOutcome(answer);
    setPicked(null);
    setWriting(false);
    onDone(answer);
  });

  const number = {
    down: (e: PointerEvent, at: Omit<Picked, 'from' | 'to'>, line: number): void => {
      pointer.current = e.pointerType;
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      e.preventDefault();
      dragging.current = true;
      setWriting(false);
      setPicked({ ...at, from: line, to: line });
    },
    enter: (at: Omit<Picked, 'from' | 'to'>, line: number): void => {
      if (!dragging.current) return;
      setPicked((prev) => (prev && prev.path === at.path && prev.hunk === at.hunk && prev.side === at.side ? { ...prev, to: line } : prev));
    },
    // A tap or a key: the first picks a line, a second in the same hunk and side reaches to it.
    click: (e: MouseEvent, at: Omit<Picked, 'from' | 'to'>, line: number): void => {
      if (e.detail !== 0 && pointer.current === 'mouse') return;
      setPicked((prev) => (prev && writing && prev.path === at.path && prev.hunk === at.hunk && prev.side === at.side ? { ...prev, to: line } : { ...at, from: line, to: line }));
      setWriting(true);
    },
  };

  if (diff.error && !diff.data) return <div className="p-4"><Problem>{diff.error}</Problem></div>;
  if (!diff.data) return <p className="p-4 text-base text-fg-muted">바뀐 코드를 불러오는 중입니다.</p>;
  const files = diff.data.files;
  if (files.length === 0) {
    return (
      <div className="p-4">
        <Empty title="바뀐 파일이 없습니다">이 작업은 브랜치에 아무것도 커밋하지 않았습니다.</Empty>
      </div>
    );
  }
  const additions = files.reduce((n, f) => n + f.additions, 0);
  const deletions = files.reduce((n, f) => n + f.deletions, 0);
  /** Opens a folded file and brings it into view. */
  const jump = (file: DiffFile, index: number): void => {
    if (!isOpen(file)) toggle(file.path);
    requestAnimationFrame(() => document.getElementById(`diff-${index}`)?.scrollIntoView({ block: 'start' }));
  };
  const add = (comment: ReviewComment): void => {
    onComments([...comments, comment]);
    setPicked(null);
    setWriting(false);
  };

  return (
    <div className="changes flex flex-col gap-6 p-4">
      <section className="flex flex-col gap-3" aria-label="바뀐 코드 검토">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">이 작업이 바꾼 코드</h2>
          <p className="text-base text-fg-muted">
            파일 {files.length}개, +{additions} −{deletions}. 줄 번호를 끌어서 고르면 그 줄에 코멘트를 답니다.
          </p>
          <p className="break-all font-mono text-sm text-fg-muted">
            {diff.data.base}...{diff.data.branch}
          </p>
        </div>
        {diff.data.truncated ? <p className="border-l-4 border-warning pl-3 text-base">변경이 커서 앞부분만 보입니다. 나머지는 브랜치에서 직접 읽어 주세요.</p> : null}
        <ul className="flex flex-col" aria-label="바뀐 파일">
          {files.map((file, i) => (
            <li key={file.path} className="max-w-none">
              <button type="button" onClick={() => jump(file, i)} className="flex min-h-9 pointer-coarse:min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-sunken">
                <span className="w-16 shrink-0 text-fg-muted">{statusText[file.status]}</span>
                <span className="min-w-0 flex-1 break-all font-mono">{file.path}</span>
                <Counts file={file} />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {files.map((file, i) => (
        <section key={file.path} id={`diff-${i}`} aria-label={file.path} className="flex scroll-mt-4 flex-col rounded-lg border border-border bg-surface">
          <button type="button" aria-expanded={isOpen(file)} onClick={() => toggle(file.path)} className="flex min-h-11 w-full items-center gap-3 border-b border-border px-3 py-2 text-left hover:bg-sunken">
            {isOpen(file) ? <ChevronDown className="size-4 shrink-0 text-fg-muted" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-fg-muted" aria-hidden />}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="break-all font-mono text-sm font-medium">{file.path}</span>
              {file.oldPath ? <span className="break-all font-mono text-xs text-fg-muted">{file.oldPath}에서 옮김</span> : null}
            </span>
            <Counts file={file} />
          </button>
          {file.binary ? (
            <p className="px-3 py-2 text-sm text-fg-muted">바이너리 파일은 줄로 비교하지 않습니다.</p>
          ) : !isOpen(file) ? (
            <p className="px-3 py-2 text-sm text-fg-muted">바뀐 줄이 {changed(file)}줄이라 접어 두었습니다. 위의 파일 이름을 누르면 펼쳐집니다.</p>
          ) : (
            file.hunks.map((hunk, h) => (
              <div key={h} className="flex flex-col">
                <Hunk path={file.path} index={h} hunk={hunk} colored={colored} picked={picked} number={number} />
                {writing && picked && picked.path === file.path && picked.hunk === h ? <CommentBox picked={picked} full={comments.length >= REVIEW_COMMENTS_MAX} onAdd={add} onCancel={() => (setPicked(null), setWriting(false))} /> : null}
              </div>
            ))
          )}
        </section>
      ))}

      <section className="flex flex-col gap-3 border-t border-border pt-4" aria-label="코드에 답하기">
        {comments.length > 0 ? (
          <>
            <h3 className="text-base font-semibold">보낼 코멘트 {comments.length}개</h3>
            <CommentList comments={comments} onRemove={(index) => onComments(comments.filter((_, i) => i !== index))} />
          </>
        ) : (
          <p className="text-sm text-fg-muted">코멘트 없이 받으려면 승인을 누르세요.</p>
        )}
        {outcome ? <Status tone={outcome.decision === 'approved' ? 'good' : 'active'}>{outcome.decision === 'approved' ? `${outcome.mergedInto ?? ''}에 합쳤습니다` : `코멘트 ${outcome.blockingCount > 0 ? `${outcome.blockingCount}개가 차단인 ` : ''}재수정을 시작했습니다`}</Status> : null}
        {submit.error ? <Problem>{submit.error}</Problem> : null}
        {!finished ? <p className="text-sm text-fg-muted">작업이 끝나면 답할 수 있습니다.</p> : !mergeable ? <p className="text-sm text-fg-muted">실패한 작업은 합치지 않습니다. 코멘트를 달아 재수정을 요청할 수 있습니다.</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" busy={submit.busy} disabled={!mergeable || outcome !== null || comments.length > 0} onClick={() => void submit.run({ decision: 'approved', comments: [] })} icon={<Check className="size-4" aria-hidden />}>
            승인
          </Button>
          <Button disabled={!finished || submit.busy || outcome !== null || comments.length === 0} onClick={() => void submit.run({ decision: 'annotated', comments: [...comments] })} icon={<RotateCw className="size-4" aria-hidden />}>
            재수정 요청{comments.length > 0 ? ` (코멘트 ${comments.length}개)` : ''}
          </Button>
          {comments.length > 0 ? <span className="text-sm text-fg-muted">승인하려면 코멘트를 보내거나 지워 주세요</span> : null}
        </div>
      </section>
    </div>
  );
}

function Counts({ file }: { file: DiffFile }) {
  return (
    <span className="shrink-0 font-mono text-sm">
      <span className="text-success">+{file.additions}</span> <span className="text-danger">−{file.deletions}</span>
    </span>
  );
}

/** Colour for the hunks of the files that are open, each side of each hunk highlighted as one piece. Fetched with the highlighter, which is large. */
function useColored(diff: ReviewDiff | null, isOpen: (file: DiffFile) => boolean): ReadonlyMap<string, CodeNode[][]> {
  const [colored, setColored] = useState<ReadonlyMap<string, CodeNode[][]>>(new Map());
  const open = diff ? diff.files.filter((f) => !f.binary && isOpen(f)) : [];
  const key = open.map((f) => f.path).join('\n');
  useEffect(() => {
    if (open.length === 0) return;
    let stale = false;
    void import('../../lib/highlight.ts').then(({ highlight }) => {
      const map = new Map<string, CodeNode[][]>();
      for (const file of open) {
        if (file.hunks.reduce((n, h) => n + h.lines.reduce((m, l) => m + l.text.length, 0), 0) > HIGHLIGHT_LIMIT) continue;
        file.hunks.forEach((hunk, h) => {
          for (const side of ['old', 'new'] as const) {
            const nodes = highlight(file.path, hunk.lines.filter((l) => lineOn(l, side) !== null).map((l) => l.text).join('\n'));
            if (nodes) map.set(`${file.path}#${h}:${side}`, splitLines(nodes));
          }
        });
      }
      if (!stale) setColored(map);
    });
    return () => {
      stale = true;
    };
    // `open` is derived from the diff and the folded files, which `key` and `diff` stand for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff, key]);
  return colored;
}

function render(nodes: readonly CodeNode[]): ReactNode {
  return nodes.map((node, i) =>
    node.type === 'text' ? (
      node.value
    ) : (
      <span key={i} className={node.classes.join(' ')}>
        {render(node.children)}
      </span>
    ),
  );
}

type NumberHandlers = {
  down: (e: PointerEvent, at: Omit<Picked, 'from' | 'to'>, line: number) => void;
  enter: (at: Omit<Picked, 'from' | 'to'>, line: number) => void;
  click: (e: MouseEvent, at: Omit<Picked, 'from' | 'to'>, line: number) => void;
};

/**
 * One hunk. Each run of taken-out and put-in lines is one block, its taken-out lines first: read top to bottom
 * below 900px of pane width, and above it laid side by side (taken out on the left, put in on the right) by the
 * stylesheet, with the lines that stayed shown on both sides. The same elements serve both layouts.
 */
function Hunk({ path, index, hunk, colored, picked, number }: { path: string; index: number; hunk: DiffHunk; colored: ReadonlyMap<string, CodeNode[][]>; picked: Picked | null; number: NumberHandlers }) {
  const oldNodes = colored.get(`${path}#${index}:old`);
  const newNodes = colored.get(`${path}#${index}:new`);
  let o = 0;
  let n = 0;
  const groups: { change: boolean; rows: ReactNode[] }[] = [];
  const isPicked = (side: Side, line: number | null): boolean => picked !== null && line !== null && picked.path === path && picked.hunk === index && picked.side === side && line >= Math.min(picked.from, picked.to) && line <= Math.max(picked.from, picked.to);
  const gutter = (side: Side, line: number | null): ReactNode => {
    const cls = `diff-num ${side === 'old' ? 'diff-old' : 'diff-new'}`;
    if (line === null) return <span className={cls} />;
    const at = { path, hunk: index, side };
    return (
      <button
        type="button"
        className={`${cls} pointer-coarse:min-h-11`}
        aria-label={`${sideText[side]} ${line}번 줄에 코멘트`}
        aria-pressed={isPicked(side, line)}
        onPointerDown={(e) => number.down(e, at, line)}
        onPointerEnter={() => number.enter(at, line)}
        onClick={(e) => number.click(e, at, line)}
      >
        {line}
      </button>
    );
  };
  hunk.lines.forEach((line, i) => {
    const nodes = line.kind === 'del' ? oldNodes?.[o] : newNodes?.[n];
    if (line.oldLine !== null) o++;
    if (line.newLine !== null) n++;
    const code = nodes ? render(nodes) : line.text;
    const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ';
    const row = (
      <div key={i} className="diff-row" data-kind={line.kind} data-picked={isPicked('old', line.oldLine) || isPicked('new', line.newLine) || undefined}>
        {gutter('old', line.oldLine)}
        {gutter('new', line.newLine)}
        <code className="diff-code">
          <span className="diff-sign">{sign}</span>
          {code}
        </code>
        {line.kind === 'context' ? (
          <code className="diff-code diff-mirror" aria-hidden>
            <span className="diff-sign"> </span>
            {code}
          </code>
        ) : null}
      </div>
    );
    const change = line.kind !== 'context';
    const last = groups.at(-1);
    if (last && last.change === change) last.rows.push(row);
    else groups.push({ change, rows: [row] });
  });
  return (
    <div className="code-view diff-hunk">
      <p className="diff-head">
        @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </p>
      {groups.map((group, g) => (group.change ? <div key={g} className="diff-block">{group.rows}</div> : group.rows))}
    </div>
  );
}

/** What is said about the picked lines. Only an issue or a suggestion can hold the work back. */
function CommentBox({ picked, full, onAdd, onCancel }: { picked: Picked; full: boolean; onAdd: (comment: ReviewComment) => void; onCancel: () => void }) {
  const [label, setLabel] = useState<ReviewLabel>('issue');
  const [blocking, setBlocking] = useState(false);
  const [body, setBody] = useState('');
  const [code, setCode] = useState('');
  const canBlock = label !== 'question';
  const pickLabel = (next: ReviewLabel): void => {
    setLabel(next);
    if (next === 'question') setBlocking(false);
  };
  const add = (): void => {
    if (body.trim() === '') return;
    onAdd({ path: picked.path, side: picked.side, startLine: Math.min(picked.from, picked.to), endLine: Math.max(picked.from, picked.to), label, blocking: canBlock && blocking, body: body.trim(), ...(code.trim() !== '' ? { suggestedCode: code } : {}) });
  };
  return (
    <div role="group" aria-label="코멘트 쓰기" className="m-3 flex flex-col gap-3 rounded-lg border border-accent bg-bg p-3">
      <div className="flex flex-col gap-1">
        <p className="break-all text-sm font-medium">
          {picked.path} · {range(picked.from, picked.to)} ({sideText[picked.side]})
        </p>
        <p className="text-sm text-fg-muted">같은 묶음의 다른 줄 번호를 누르면 그 줄까지 고릅니다.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented compact label="코멘트 종류" value={label} options={LABELS} onChange={pickLabel} />
        <Button aria-pressed={canBlock && blocking} disabled={!canBlock} onClick={() => setBlocking((on) => !on)} variant={canBlock && blocking ? 'danger' : 'quiet'} icon={<OctagonAlert className="size-4" aria-hidden />}>
          {canBlock && blocking ? '차단: 고쳐야 받음' : '차단 아님'}
        </Button>
      </div>
      <textarea aria-label="코멘트" rows={3} maxLength={REVIEW_BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} placeholder="예: 미결제 건만 보여야 하는데 결제된 건도 섞입니다" className={`${inputClass} resize-y py-2`} />
      <textarea aria-label="대신 넣을 코드 (선택)" rows={3} maxLength={REVIEW_CODE_MAX} value={code} onChange={(e) => setCode(e.target.value)} placeholder="대신 넣을 코드 (선택)" spellCheck={false} autoCapitalize="none" className={`${inputClass} resize-y py-2 font-mono text-sm`} />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={body.trim() === '' || full} onClick={add} icon={<MessageSquarePlus className="size-4" aria-hidden />}>
          코멘트 추가
        </Button>
        <Button onClick={onCancel}>취소</Button>
      </div>
      {full ? <p className="text-sm text-fg-muted">코멘트는 한 번에 {REVIEW_COMMENTS_MAX}개까지 보낼 수 있습니다.</p> : null}
    </div>
  );
}

/** The comments waiting to be sent: where each is, what kind, and what was said. */
function CommentList({ comments, onRemove }: { comments: readonly ReviewComment[]; onRemove: (index: number) => void }) {
  return (
    <ol className="flex flex-col gap-2">
      {comments.map((c, i) => (
        <li key={i} className="flex max-w-none items-start gap-2 rounded-md border border-border bg-surface px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-semibold">{reviewLabelText[c.label]}</span>
              {c.blocking ? <Status tone="bad">차단</Status> : null}
              <span className="break-all font-mono text-fg-muted">
                {c.path} {range(c.startLine, c.endLine)} ({sideText[c.side]})
              </span>
            </p>
            <p className="whitespace-pre-wrap break-words text-base">{c.body}</p>
            {c.suggestedCode ? <pre className="code-view overflow-x-auto rounded-md bg-sunken px-3 py-2">{c.suggestedCode}</pre> : null}
          </div>
          <IconButton label={`코멘트 ${i + 1} 지우기`} onClick={() => onRemove(i)}>
            <X className="size-4" aria-hidden />
          </IconButton>
        </li>
      ))}
    </ol>
  );
}

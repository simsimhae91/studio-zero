import { Check, MessageSquarePlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Markdown } from '@studio-zero/ax/react';
import type { PlanFeedback, PlanVersion, Task } from '@studio-zero/protocol';
import { stamp } from '../../lib/format.ts';
import { diffWords } from '../../lib/planDiff.ts';
import { useAction, useQuery, useStudio } from '../../lib/studio.tsx';
import { Button, Empty, IconButton, Problem, Segmented, Status, inputClass } from '../../ui.tsx';

/** The longest passage a note can quote, as the daemon takes it. */
const QUOTE_MAX = 1000;
const COMMENT_MAX = 2000;

/**
 * A task's plan before any code, for a task the owner asked to see it for. The newest version is the one that
 * waits: the owner reads it with the cross-reviewer's notes beside it, marks passages and says what to change,
 * and approves it or sends it back. Earlier versions can be read, and each set against the one before it.
 *
 * The plan and the reviewer's notes are models' words: the plan goes through the inert Markdown renderer, the
 * notes and the diff are plain text.
 */
export function PlanReview({ task }: { task: Task }) {
  const { backend } = useStudio();
  const plans = useQuery('plans.list', { taskId: task.id }, ['plan.review_requested', 'plan.review_resolved', 'task.state']);
  const versions = plans.data?.versions ?? [];
  const latest = versions.at(-1) ?? null;
  const [picked, setPicked] = useState<number | null>(null);
  const shown = versions.find((v) => v.version === picked) ?? latest;
  const previous = shown ? (versions.find((v) => v.version === shown.version - 1) ?? null) : null;
  const [comparing, setComparing] = useState(false);
  const waiting = task.state === 'awaiting_plan_review' && latest !== null && latest.verdict === null;
  const answerable = waiting && shown !== null && shown.version === latest.version;
  const revisionsLeft = plans.data?.revisionsLeft ?? 0;

  // Notes belong to the version they were written on: a new version starts with none.
  const [notes, setNotes] = useState<PlanFeedback[]>([]);
  const [quote, setQuote] = useState('');
  const [comment, setComment] = useState('');
  const [stale, setStale] = useState(false);
  useEffect(() => {
    setNotes([]);
    setQuote('');
    setComment('');
    setPicked(null);
  }, [latest?.sha256]);
  useEffect(() => {
    if (!previous) setComparing(false);
  }, [previous]);

  // A passage chosen in the plan, by mouse, keyboard or a long press, becomes the quote of the next note.
  const planRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!answerable || comparing) return;
    const onSelect = (): void => {
      const selection = document.getSelection();
      const text = selection?.toString().trim() ?? '';
      if (text === '' || !planRef.current || !selection?.anchorNode || !planRef.current.contains(selection.anchorNode)) return;
      setQuote(text.slice(0, QUOTE_MAX));
    };
    document.addEventListener('selectionchange', onSelect);
    return () => document.removeEventListener('selectionchange', onSelect);
  }, [answerable, comparing]);

  const typed: PlanFeedback | null = comment.trim() === '' ? null : { ...(quote ? { quote } : {}), comment: comment.trim() };
  const feedback = typed ? [...notes, typed] : notes;
  const addNote = (): void => {
    if (!typed) return;
    setNotes((prev) => [...prev, typed]);
    setQuote('');
    setComment('');
  };
  const resolve = useAction(async (verdict: 'approve' | 'changes') => {
    if (!latest) return;
    setStale(false);
    try {
      await backend.call('plans.resolve', { taskId: task.id, version: latest.version, planHash: latest.sha256, verdict, ...(verdict === 'changes' ? { feedback } : {}) });
    } catch (err) {
      // The plan may have moved on (answered on the phone, or redrafted): read again what is waiting now.
      setStale(true);
      plans.reload();
      throw err;
    }
    setNotes([]);
    setQuote('');
    setComment('');
    plans.reload();
  });

  if (plans.error && !plans.data) return <div className="p-4"><Problem>{plans.error}</Problem></div>;
  if (!plans.data) return <p className="p-4 text-base text-fg-muted">계획을 불러오는 중입니다.</p>;
  if (!shown) {
    return (
      <div className="p-4">
        <Empty title="아직 보여 드릴 계획이 없습니다">교차 검토까지 마치면 여기에 나옵니다.</Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <section className="flex flex-col gap-3" aria-label="계획 검토">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">코드 전에 보는 계획</h2>
          <p className="text-base text-fg-muted">
            {waiting
              ? '승인하면 이 안대로 구현을 시작합니다. 고칠 곳은 구절을 골라 메모로 남기세요.'
              : latest?.verdict === 'approve'
                ? `${latest.version}번째 안으로 승인했습니다.`
                : '지난 계획입니다. 읽기만 할 수 있습니다.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {versions.length > 1 ? <Segmented compact label="계획 버전" value={String(shown.version)} options={versions.map((v) => ({ id: String(v.version), label: `${v.version}번째 안` }))} onChange={(id) => setPicked(Number(id))} /> : null}
          <Button aria-pressed={comparing} disabled={!previous} onClick={() => setComparing((on) => !on)}>
            {comparing ? '비교 끄기' : '앞 안과 비교'}
          </Button>
          <VerdictBadge version={shown} waiting={waiting && shown.version === latest?.version} />
        </div>
        {!previous ? <p className="text-sm text-fg-muted">첫 안이라 비교할 앞 안이 없습니다</p> : null}
      </section>

      {comparing && previous ? (
        <section className="flex flex-col gap-2" aria-label={`${previous.version}번째 안과 ${shown.version}번째 안의 차이`}>
          <p className="text-sm text-fg-muted">밑줄: 더한 글 · 취소선: 뺀 글</p>
          <div className="plan-diff whitespace-pre-wrap break-words rounded-lg border border-border bg-surface p-4 text-base">
            {diffWords(previous.planMarkdown, shown.planMarkdown).map((op, i) =>
              op.kind === 'same' ? <span key={i}>{op.text}</span> : op.kind === 'add' ? <ins key={i}>{op.text}</ins> : <del key={i}>{op.text}</del>,
            )}
          </div>
        </section>
      ) : (
        <div ref={planRef} className="rounded-lg border border-border bg-surface p-4">
          <Markdown source={shown.planMarkdown} />
        </div>
      )}

      {shown.reviewerNotes ? (
        <section className="flex flex-col gap-2" aria-label="교차 검토 의견">
          <h3 className="text-base font-semibold">다른 회사 모델의 교차 검토</h3>
          <p className="whitespace-pre-wrap break-words text-base text-fg-muted">{shown.reviewerNotes}</p>
        </section>
      ) : null}

      {shown.feedback.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label="이 안에 보낸 수정 요청">
          <h3 className="text-base font-semibold">이 안에 보낸 수정 요청</h3>
          <NoteList notes={shown.feedback} />
        </section>
      ) : null}

      {answerable ? (
        <section className="flex flex-col gap-3 border-t border-border pt-4" aria-label="계획에 답하기">
          {notes.length > 0 ? <NoteList notes={notes} onRemove={(index) => setNotes((prev) => prev.filter((_, i) => i !== index))} /> : null}
          <div className="flex flex-col gap-2">
            {quote ? (
              <div className="flex items-start gap-2 border-l-4 border-accent pl-3">
                <p className="line-clamp-3 min-w-0 flex-1 break-words text-sm text-fg-muted">{quote}</p>
                <IconButton label="고른 구절 지우기" onClick={() => setQuote('')}>
                  <X className="size-4" aria-hidden />
                </IconButton>
              </div>
            ) : (
              <p className="text-sm text-fg-muted">계획에서 글을 고르면 그 구절에 메모가 붙습니다.</p>
            )}
            <textarea aria-label="계획에 남길 메모" rows={3} maxLength={COMMENT_MAX} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="예: 결제 이력은 상세 화면이 아니라 목록에서 바로 보여야 합니다" className={`${inputClass} resize-y py-2`} />
            <Button className="self-start" disabled={!typed || notes.length >= 20} onClick={addNote} icon={<MessageSquarePlus className="size-4" aria-hidden />}>
              메모 추가
            </Button>
          </div>
          {resolve.error ? <Problem>{stale ? `${resolve.error} 지금 기다리는 안을 다시 불러왔습니다.` : resolve.error}</Problem> : null}
          {revisionsLeft === 0 ? <p className="text-sm text-fg-muted">수정 요청 횟수를 다 썼습니다. 이 안으로 승인하거나 작업을 중단하세요.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" busy={resolve.busy} onClick={() => void resolve.run('approve')} icon={<Check className="size-4" aria-hidden />}>
              승인하고 구현 시작
            </Button>
            <Button disabled={resolve.busy || feedback.length === 0 || revisionsLeft === 0} onClick={() => void resolve.run('changes')}>
              수정 요청{feedback.length > 0 ? ` (메모 ${feedback.length}개)` : ''}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function VerdictBadge({ version, waiting }: { version: PlanVersion; waiting: boolean }) {
  if (waiting) return <Status tone="warn">답을 기다리는 중</Status>;
  if (version.verdict === 'approve') return <Status tone="good">{version.resolvedAt ? `${stamp(version.resolvedAt)} 승인` : '승인'}</Status>;
  if (version.verdict === 'changes') return <Status tone="neutral">수정 요청함</Status>;
  return <Status tone="neutral">답하지 않은 안</Status>;
}

/** Notes on a plan: the passage each is about, if any, and what was said. */
function NoteList({ notes, onRemove }: { notes: readonly PlanFeedback[]; onRemove?: (index: number) => void }) {
  return (
    <ol className="flex flex-col gap-2">
      {notes.map((note, i) => (
        <li key={i} className="flex max-w-none items-start gap-2 rounded-md border border-border bg-surface px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {note.quote ? <p className="line-clamp-3 break-words border-l-4 border-border pl-2 text-sm text-fg-muted">{note.quote}</p> : <p className="text-sm text-fg-muted">계획 전체</p>}
            <p className="whitespace-pre-wrap break-words text-base">{note.comment}</p>
          </div>
          {onRemove ? (
            <IconButton label={`메모 ${i + 1} 지우기`} onClick={() => onRemove(i)}>
              <X className="size-4" aria-hidden />
            </IconButton>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

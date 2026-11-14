import { MessageSquarePlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from '@studio-zero/ax/react';
import { RpcCallError, type KnowledgeJob } from '@studio-zero/protocol';
import { hashMarkdown, lineLabel, quoteMatches, selectionToAnnotation, splitBlocks, type Passage } from '../../lib/annotate.ts';
import { useAction, useQuery, useStudio } from '../../lib/studio.tsx';
import { useSelectionQuote } from '../../lib/useSelectionQuote.ts';
import { Button, IconButton, Problem, Status, inputClass } from '../../ui.tsx';

const COMMENT_MAX = 2000;
/** What the daemon takes in one request: notes on passages, and the notes on the whole document joined. */
const NOTES_MAX = 50;
const OVERALL_MAX = 4000;

/** A note: on a passage, or (with none) on the whole document. */
interface Note {
  passage: Passage | null;
  comment: string;
}

const inLineOrder = (a: Note, b: Note): number => (a.passage && b.passage ? a.passage.startLine - b.passage.startLine || a.passage.endLine - b.passage.endLine : a.passage ? -1 : b.passage ? 1 : 0);

/**
 * A finished document, read to be changed: the third review surface after a plan (PlanReview) and a mock-up. The
 * owner selects passages in the document, leaves a note on each, and sends them all at once; the studio writes the
 * next revision from them and leaves this one as it is.
 *
 * The document is shown block by block, each block carrying its source lines, so a selection is sent as lines and
 * a quote of the source. The request is bound to the text on screen: when that is no longer the document to revise,
 * the newest one is read again and the notes that still stand on it are kept; the rest are shown, not dropped.
 */
export function DocAnnotator({ job, onSent, onStale }: { job: KnowledgeJob; onSent: () => void; onStale: () => void }) {
  const { backend } = useStudio();
  const doc = useQuery('knowledge.get', job.state === 'succeeded' ? { jobId: job.id } : null);
  const markdown = doc.data?.markdown ?? null;
  const blocks = useMemo(() => (markdown === null ? [] : splitBlocks(markdown)), [markdown]);
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => {
    setHash(null);
    if (markdown === null) return;
    let live = true;
    void hashMarkdown(markdown).then((h) => live && setHash(h));
    return () => {
      live = false;
    };
  }, [markdown]);

  const [notes, setNotes] = useState<Note[]>([]);
  const [picked, setPicked] = useState<Passage | null>(null);
  const [comment, setComment] = useState('');
  // After a stale answer: the text the notes were written on, until the newest text has been read.
  const [staleText, setStaleText] = useState<string | null>(null);
  const [reloaded, setReloaded] = useState<{ lost: Note[] } | null>(null);

  const typed: Note | null = comment.trim() === '' ? null : { passage: picked, comment: comment.trim() };
  const all = typed ? [...notes, typed] : notes;
  const annotations = all.flatMap((n) => (n.passage ? [{ ...n.passage, comment: n.comment }] : []));
  const overall = all.filter((n) => !n.passage).map((n) => n.comment).join('\n\n');
  const tooMany = annotations.length > NOTES_MAX || overall.length > OVERALL_MAX;

  const send = useAction(async () => {
    if (markdown === null || hash === null) return;
    try {
      await backend.call('knowledge.revise', { jobId: job.id, contentHash: hash, annotations, ...(overall ? { note: overall } : {}) });
    } catch (err) {
      if (!(err instanceof RpcCallError && err.code === 'stale')) throw err;
      // Nothing typed is lost: the note being written joins the list, and the list is checked against the new text.
      setNotes(all);
      setPicked(null);
      setComment('');
      setStaleText(markdown);
      onStale();
      doc.reload();
      return;
    }
    setNotes([]);
    setPicked(null);
    setComment('');
    setReloaded(null);
    onSent();
  });

  // The newest text has arrived: the notes that still stand on it stay, the others are set apart to be read.
  useEffect(() => {
    if (staleText === null || markdown === null || markdown === staleText) return;
    const stands = (n: Note): boolean => !n.passage || quoteMatches(markdown, n.passage);
    setNotes((prev) => prev.filter(stands));
    setReloaded({ lost: notes.filter((n) => !stands(n)) });
    setStaleText(null);
    // `notes` is read once, at this moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown, staleText]);

  // A passage chosen in the document becomes the place of the next note.
  const textRef = useRef<HTMLDivElement>(null);
  useSelectionQuote(textRef, markdown !== null && !send.busy, (selection) => {
    const passage = markdown === null ? null : selectionToAnnotation(selection, markdown);
    if (passage) setPicked(passage);
  });

  const addNote = (): void => {
    if (!typed) return;
    setNotes((prev) => [...prev, typed].sort(inLineOrder));
    setPicked(null);
    setComment('');
  };

  if (job.state === 'running') return <div className="p-6"><Status tone="active">수정본을 쓰는 중입니다</Status></div>;
  if (doc.error && markdown === null) return <div className="p-6"><Problem>{doc.error}</Problem></div>;
  if (markdown === null) return <p className="p-6 text-base text-fg-muted">문서를 불러오는 중입니다.</p>;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      {/* After a reload, what happened to the notes is the one thing to read first; it takes the place of the intro. */}
      {reloaded ? (
        <section className="flex flex-col gap-2" aria-label="다시 불러온 문서">
          <Status tone="warn">
            {reloaded.lost.length === 0 ? '문서가 바뀌어 새 글을 불러왔고, 메모는 모두 그대로입니다' : `문서가 바뀌어 새 글을 불러왔고, 메모 ${reloaded.lost.length}개는 새 글에 그 구절이 없어 뺐습니다`}
          </Status>
          {reloaded.lost.length > 0 ? <NoteList notes={reloaded.lost} /> : null}
        </section>
      ) : (
        <p className="text-base text-fg-muted">고칠 구절을 골라 메모를 달고, 다 적으면 한 번에 보내세요. 고친 글은 새 판으로 올라오고 지금 문서는 그대로 남습니다.</p>
      )}

      <div ref={textRef} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        {blocks.map((block) => (
          <div key={`${block.startLine}-${block.endLine}`} data-line-start={block.startLine} data-line-end={block.endLine}>
            <Markdown source={block.source} />
          </div>
        ))}
      </div>

      {notes.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label="보낼 메모">
          <NoteList notes={notes} onRemove={send.busy ? undefined : (index) => setNotes((prev) => prev.filter((_, i) => i !== index))} />
        </section>
      ) : null}

      {/* Below the text and kept in sight while it is read: the passage chosen last and the note on it. */}
      <section className="sticky bottom-0 flex flex-col gap-3 border-t border-border bg-bg py-4" aria-label="문서에 메모 달기">
        <div className="flex flex-col gap-2">
          {picked ? (
            <div className="flex items-start gap-2 border-l-4 border-accent pl-3">
              <p className="line-clamp-2 min-w-0 flex-1 break-words text-sm text-fg-muted">
                <span className="font-medium text-fg">{lineLabel(picked)}</span> {picked.quote}
              </p>
              <IconButton label="고른 구절 지우기" onClick={() => setPicked(null)}>
                <X className="size-4" aria-hidden />
              </IconButton>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">글을 고르면 그 구절에, 고르지 않으면 문서 전체에 메모가 붙습니다.</p>
          )}
          <textarea aria-label="문서에 남길 메모" rows={2} maxLength={COMMENT_MAX} disabled={send.busy} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="예: 이 표에 4분기 전망을 한 줄 더 넣어 주세요" className={`${inputClass} resize-y py-2`} />
        </div>
        {send.error ? <Problem>{send.error}</Problem> : null}
        {tooMany ? <p className="text-sm text-fg-muted">한 번에 보낼 수 있는 양을 넘었습니다. 메모를 {NOTES_MAX}개 안으로, 문서 전체 메모를 {OVERALL_MAX.toLocaleString('ko')}자 안으로 줄여 주세요.</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!typed || send.busy} onClick={addNote} icon={<MessageSquarePlus className="size-4" aria-hidden />}>
            메모 추가
          </Button>
          <Button variant="primary" busy={send.busy} disabled={all.length === 0 || hash === null || tooMany} onClick={() => void send.run()}>
            수정 요청{all.length > 0 ? ` (메모 ${all.length}개)` : ''}
          </Button>
        </div>
      </section>
    </div>
  );
}

/** Notes on a document: the lines and passage each is about, or the whole document, and what was said. */
function NoteList({ notes, onRemove }: { notes: readonly Note[]; onRemove?: (index: number) => void }) {
  return (
    <ol className="flex flex-col gap-2">
      {notes.map((note, i) => (
        <li key={i} className="flex max-w-none items-start gap-2 rounded-md border border-border bg-surface px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {note.passage ? (
              <p className="line-clamp-3 break-words border-l-4 border-border pl-2 text-sm text-fg-muted">
                <span className="font-medium text-fg">{lineLabel(note.passage)}</span> {note.passage.quote}
              </p>
            ) : (
              <p className="text-sm text-fg-muted">문서 전체</p>
            )}
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

import { Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { Scratchpad } from '@studio-zero/protocol';
import { useAction, useStudio } from '../lib/studio.tsx';
import { Button, Field, Modal, Problem, inputClass } from '../ui.tsx';

/**
 * Deleting a note removes its conversation, its spec and its decisions, and cannot be undone: it says so and
 * waits for a second click. Putting a note away is the reversible way to get it out of the list.
 */
export function DeleteNoteModal({ note, onOpenChange, onDeleted }: { note: Scratchpad | null; onOpenChange: (open: boolean) => void; onDeleted: (note: Scratchpad) => void }) {
  const { backend } = useStudio();
  const remove = useAction(async () => {
    await backend.call('scratch.delete', { scratchId: note!.id });
    onDeleted(note!);
    onOpenChange(false);
  });
  useEffect(() => remove.clear(), [note?.id, remove.clear]);
  return (
    <Modal open={note !== null} onOpenChange={onOpenChange} title="이 작업 노트를 삭제할까요?" description={note?.title ?? ''}>
      <p className="text-base text-fg-muted">주고받은 이야기, 명세, 결정 기록이 함께 사라지고 되돌릴 수 없습니다. 목록에서만 치우려면 보관을 쓰세요. 보관한 노트는 다시 꺼낼 수 있습니다.</p>
      {remove.error ? <Problem>{remove.error}</Problem> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={remove.busy} onClick={() => onOpenChange(false)}>
          취소
        </Button>
        <Button variant="danger" busy={remove.busy} onClick={() => void remove.run()} icon={<Trash2 className="size-4" aria-hidden />}>
          노트 삭제
        </Button>
      </div>
    </Modal>
  );
}

/** A note is named after its first line, which is often a long one: the name can be changed. */
export function RenameNoteModal({ note, onOpenChange, onRenamed }: { note: Scratchpad | null; onOpenChange: (open: boolean) => void; onRenamed: () => void }) {
  const { backend } = useStudio();
  const [title, setTitle] = useState('');
  useEffect(() => setTitle(note?.title ?? ''), [note]);
  const rename = useAction(async () => {
    await backend.call('scratch.rename', { scratchId: note!.id, title: title.trim() });
    onRenamed();
    onOpenChange(false);
  });
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (title.trim() !== '') void rename.run();
  };
  return (
    <Modal open={note !== null} onOpenChange={onOpenChange} title="작업 노트 이름 변경" description="목록과 노트 머리에 보이는 이름입니다.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="이름">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus required />
        </Field>
        {rename.error ? <Problem>{rename.error}</Problem> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={rename.busy} onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button type="submit" variant="primary" busy={rename.busy} disabled={title.trim() === ''}>
            이름 변경
          </Button>
        </div>
      </form>
    </Modal>
  );
}

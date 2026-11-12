import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Project } from '@studio-zero/protocol';
import type { Backend } from '../lib/backend.ts';
import { useAction, useStudio } from '../lib/studio.tsx';
import { Button, Field, Modal, Problem, inputClass } from '../ui.tsx';

/** Stops the sandbox and starts it again: running processes end, the workspace and installed packages stay. */
export async function restartSandbox(backend: Backend, projectId: string): Promise<void> {
  await backend.call('sandbox.stop', { projectId });
  await backend.call('sandbox.start', { projectId });
}

/**
 * The one irreversible thing in the interface, so it says exactly what goes and waits for a second click.
 * Deleting removes the sandbox container and the workspace volume with everything the project built.
 */
export function DeleteProjectModal({ project, onOpenChange, onDeleted }: { project: Project | null; onOpenChange: (open: boolean) => void; onDeleted: (project: Project) => void }) {
  const { backend } = useStudio();
  const remove = useAction(async () => {
    await backend.call('projects.delete', { projectId: project!.id, deleteWorkspace: true });
    onDeleted(project!);
  });
  useEffect(() => remove.clear(), [project?.id, remove.clear]);
  return (
    <Modal open={project !== null} onOpenChange={onOpenChange} title={`${project?.name ?? ''} 프로젝트를 삭제할까요?`} description="샌드박스 컨테이너와 로컬 작업 디렉터리가 영구 삭제됩니다.">
      <p className="text-base text-fg-muted">합치지 않은 브랜치와 체크포인트도 함께 사라지고, 되돌릴 수 없습니다. 진행 중인 작업이 있으면 먼저 끝나거나 중단되어야 합니다.</p>
      {remove.error ? <Problem>{remove.error}</Problem> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={remove.busy} onClick={() => onOpenChange(false)}>
          취소
        </Button>
        <Button variant="danger" busy={remove.busy} onClick={() => void remove.run()} icon={<Trash2 className="size-4" aria-hidden />}>
          프로젝트 삭제
        </Button>
      </div>
    </Modal>
  );
}

export function RenameProjectModal({ project, onOpenChange, onRenamed }: { project: Project | null; onOpenChange: (open: boolean) => void; onRenamed: () => void }) {
  const { backend } = useStudio();
  const [name, setName] = useState('');
  useEffect(() => setName(project?.name ?? ''), [project]);
  const rename = useAction(async () => {
    await backend.call('projects.rename', { projectId: project!.id, name: name.trim() });
    onRenamed();
    onOpenChange(false);
  });
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (name.trim() !== '') void rename.run();
  };
  return (
    <Modal open={project !== null} onOpenChange={onOpenChange} title="프로젝트 이름 변경" description="표시되는 이름만 바뀝니다. 샌드박스와 주소에 쓰이는 식별자는 그대로입니다.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="이름">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus required />
        </Field>
        {rename.error ? <Problem>{rename.error}</Problem> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={rename.busy} onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button type="submit" variant="primary" busy={rename.busy} disabled={name.trim() === ''}>
            이름 변경
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * A name edited where it stands: Enter or leaving the field keeps it, Escape puts the old one back.
 * Used for the project title in the bar and for session tabs.
 */
export function InlineName({ value, label, maxLength, className = '', onCommit, onCancel }: { value: string; label: string; maxLength: number; className?: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (keep: boolean): void => {
    if (done.current) return;
    done.current = true;
    const name = text.trim();
    if (keep && name !== '' && name !== value) onCommit(name);
    else onCancel();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  };
  return <input aria-label={label} value={text} maxLength={maxLength} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} onBlur={() => finish(true)} className={`min-h-9 pointer-coarse:min-h-11 min-w-0 rounded-md border border-accent bg-surface px-2 text-fg ${className}`} />;
}

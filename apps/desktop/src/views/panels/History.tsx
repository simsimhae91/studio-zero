import { GitFork, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Project } from '@studio-zero/protocol';
import { ago } from '../../lib/format.ts';
import { useAction, useQuery, useStudio } from '../../lib/studio.tsx';
import { Button, Empty, Problem, Status } from '../../ui.tsx';

/**
 * Time travel. Every checkpoint is a state the workspace can be put back to, or branched from: going back
 * rewinds this line of work, forking leaves it alone and starts another from that point.
 */
export function History({ project, focus = null, busy = false, onFork }: { project: Project; focus?: string | null; busy?: boolean; onFork: (branch: string) => void }) {
  const { backend } = useStudio();
  const checkpoints = useQuery('checkpoints.list', { projectId: project.id }, ['checkpoint.created', 'checkpoint.restored']);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const [forking, setForking] = useState<string | null>(null);
  const rollback = useAction(async (checkpointId: string, label: string) => {
    await backend.call('checkpoints.rollback', { projectId: project.id, checkpointId });
    setConfirming(null);
    setRestored(label);
    checkpoints.reload();
  });
  const fork = useAction(async (checkpointId: string) => {
    setForking(checkpointId);
    try {
      const { branch } = await backend.call('checkpoints.fork', { projectId: project.id, checkpointId });
      onFork(branch);
    } finally {
      setForking(null);
    }
  });
  const list = checkpoints.data?.checkpoints ?? [];
  const focused = useRef<HTMLLIElement>(null);
  useEffect(() => focused.current?.scrollIntoView({ block: 'center' }), [focus, list.length]);

  if (checkpoints.data && list.length === 0) {
    return (
      <Empty title="체크포인트가 없습니다">
        <p>작업을 시작하거나 병합할 때마다 그 직전 상태가 자동으로 저장됩니다.</p>
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-base text-fg-muted">되돌리면 지금 상태를 먼저 저장한 뒤 그 시점으로 돌아갑니다. 갈라 시작하면 지금 작업은 그대로 두고, 그 시점에서 새 갈래를 만들어 다음 작업을 거기서 이어갑니다.</p>
      {busy ? <p className="text-base text-fg-muted">작업이 진행 중일 때는 되돌릴 수 없습니다. 작업이 끝나거나 중단된 뒤에 할 수 있습니다.</p> : null}
      {restored ? <Status tone="good">"{restored}" 시점으로 되돌렸습니다. 되돌리기 직전 상태도 맨 위에 저장했습니다.</Status> : null}
      {checkpoints.error ? <Problem>{checkpoints.error}</Problem> : null}
      {rollback.error ? <Problem>{rollback.error}</Problem> : null}
      {fork.error ? <Problem>{fork.error}</Problem> : null}
      <ul className="flex flex-col">
        {list.map((c) => (
          <li key={c.id} ref={c.id === focus ? focused : undefined} className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-l-4 border-t border-t-border py-3 pl-4 ${c.id === focus ? 'border-l-accent bg-sunken' : 'border-l-transparent'}`}>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-base">{c.label}</span>
              <time className="text-sm text-fg-muted" dateTime={new Date(c.createdAt).toISOString()} title={new Date(c.createdAt).toLocaleString('ko')}>
                {ago(c.createdAt)}
              </time>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button busy={forking === c.id} disabled={fork.busy && forking !== c.id} onClick={() => void fork.run(c.id)} icon={<GitFork className="size-4" aria-hidden />}>
                여기서 갈라 시작
              </Button>
              {confirming === c.id ? (
                <>
                  <Button variant="danger" busy={rollback.busy} onClick={() => void rollback.run(c.id, c.label)} icon={<RotateCcw className="size-4" aria-hidden />}>
                    이 시점으로 되돌리기 확인
                  </Button>
                  <Button disabled={rollback.busy} onClick={() => setConfirming(null)}>
                    취소
                  </Button>
                </>
              ) : (
                <Button disabled={busy} onClick={() => (setRestored(null), setConfirming(c.id))} icon={<RotateCcw className="size-4" aria-hidden />}>
                  되돌리기
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

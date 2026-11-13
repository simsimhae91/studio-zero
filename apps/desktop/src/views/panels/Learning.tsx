import type { Lesson, Project } from '@studio-zero/protocol';
import { evalLabel, lessonStateLabel } from '../../lib/format.ts';
import { useAction, useQuery, useStudio } from '../../lib/studio.tsx';
import { Button, Empty, Problem, Status } from '../../ui.tsx';

const lessonTone = { candidate: 'warn', active: 'good', quarantined: 'bad', retired: 'neutral' } as const;

/** What the studio has learned about this project, and the checks every task has to pass. */
export function Learning({ project }: { project: Project }) {
  const { backend } = useStudio();
  const lessons = useQuery('lessons.list', { projectId: project.id }, ['lesson.changed']);
  const evals = useQuery('evals.list', { projectId: project.id }, ['reflection.completed']);
  const setLesson = useAction(async (lesson: Lesson, state: 'active' | 'retired') => {
    await backend.call('lessons.setState', { lessonId: lesson.id, state });
    lessons.reload();
  });
  const setEval = useAction(async (evalId: string, enabled: boolean) => {
    await backend.call('evals.setEnabled', { evalId, enabled });
    evals.reload();
  });
  const visible = (lessons.data?.lessons ?? []).filter((l) => l.state !== 'retired');
  const retired = (lessons.data?.lessons ?? []).filter((l) => l.state === 'retired');

  return (
    <div className="flex flex-col gap-8 p-4">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">교훈</h2>
          <p className="text-base text-fg-muted">작업을 돌아보며 뽑은 규칙입니다. 후보는 에이전트에게 보이지 않고, 서로 다른 작업 두 건이 같은 결론을 내거나 직접 적용하면 쓰이기 시작합니다.</p>
        </div>
        {lessons.error ? <Problem>{lessons.error}</Problem> : null}
        {setLesson.error ? <Problem>{setLesson.error}</Problem> : null}
        {lessons.data && visible.length === 0 ? <Empty title="아직 교훈이 없습니다" /> : null}
        <ul className="flex flex-col">
          {visible.map((l) => (
            <li key={l.id} className="flex flex-col gap-2 border-t border-border py-4">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
                <h3 className="text-base font-semibold">{l.title}</h3>
                <Status tone={lessonTone[l.state]}>{lessonStateLabel[l.state]}</Status>
              </div>
              <p className="text-base">
                {l.trigger}: {l.guidance}
              </p>
              <p className="text-sm text-fg-muted">
                근거가 된 작업 {l.confirmations}건{l.harms > 0 ? `, 해가 된 작업 ${l.harms}건` : ''}
              </p>
              <div className="flex flex-wrap gap-3">
                {l.state !== 'active' ? (
                  <Button busy={setLesson.busy} onClick={() => void setLesson.run(l, 'active')}>
                    적용
                  </Button>
                ) : null}
                <Button disabled={setLesson.busy} onClick={() => void setLesson.run(l, 'retired')}>
                  폐기
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {/* Retiring a lesson is one press, so it has to be possible to see what was retired and take it back. */}
        {retired.length > 0 ? (
          <details className="flex flex-col border-t border-border">
            <summary className="flex min-h-11 cursor-default items-center text-base font-medium text-fg-muted hover:text-fg">폐기한 교훈 {retired.length}개</summary>
            <ul className="flex flex-col">
              {retired.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border py-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <h3 className="text-base font-medium">{l.title}</h3>
                    <p className="text-base text-fg-muted">
                      {l.trigger}: {l.guidance}
                    </p>
                  </div>
                  <Button busy={setLesson.busy} onClick={() => void setLesson.run(l, 'active')}>
                    다시 적용
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">회귀 체크</h2>
          <p className="text-base text-fg-muted">모든 작업이 끝나기 전에 데몬이 직접 실행합니다. 에이전트는 이 목록을 바꿀 수 없습니다.</p>
        </div>
        {evals.error ? <Problem>{evals.error}</Problem> : null}
        {setEval.error ? <Problem>{setEval.error}</Problem> : null}
        <ul className="flex flex-col">
          {(evals.data?.evals ?? []).map((ev) => (
            <li key={ev.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-border py-2">
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-base">{evalLabel(ev.name)}</span>
                {ev.spec.kind === 'command' ? <code className="break-words font-mono text-sm text-fg-muted">{ev.spec.command}</code> : null}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={ev.enabled}
                aria-label={`${evalLabel(ev.name)} 사용`}
                disabled={setEval.busy}
                onClick={() => void setEval.run(ev.id, !ev.enabled)}
                className={`min-h-11 min-w-24 rounded-md border px-4 text-sm font-medium ${ev.enabled ? 'border-accent text-accent' : 'border-control-border text-fg-muted'}`}
              >
                {ev.enabled ? '사용 중' : '꺼짐'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

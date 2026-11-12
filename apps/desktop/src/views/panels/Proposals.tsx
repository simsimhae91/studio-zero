import { GitMerge, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Project, ProposalCard } from '@studio-zero/protocol';
import { metricLabel, proposalStateLabel } from '../../lib/format.ts';
import { useAction, useQuery, useStudio } from '../../lib/studio.tsx';
import { Button, Empty, Field, Problem, Status, inputClass } from '../../ui.tsx';

const stateTone = { proposed: 'neutral', materializing: 'active', ready: 'warn', merged: 'good', rejected: 'neutral', failed: 'bad' } as const;
const riskLabel = { low: '낮음', medium: '보통', high: '높음' } as const;

/** Kirby: practices found in another repository, proposed for this one. */
export function Proposals({ project }: { project: Project }) {
  const { backend } = useStudio();
  const proposals = useQuery('kirby.proposals', { projectId: project.id }, ['kirby.proposal']);
  const [repo, setRepo] = useState('');
  const [started, setStarted] = useState(false);
  const ingest = useAction(async () => {
    await backend.call('kirby.ingest', { projectId: project.id, repoUrl: repo.trim() });
    setStarted(true);
    setRepo('');
  });
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    void ingest.run();
  };
  const list = proposals.data?.proposals ?? [];

  return (
    <div className="flex flex-col gap-8 p-4">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="참고할 저장소" hint="격리된 일회용 컨테이너에서 읽기만 합니다. 그 저장소의 코드는 실행되지도, 이 프로젝트로 복사되지도 않습니다.">
          <input className={inputClass} type="url" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/owner/repo" autoCapitalize="none" spellCheck={false} required />
        </Field>
        {ingest.error ? <Problem>{ingest.error}</Problem> : null}
        {started ? <Status tone="active">분석을 시작했습니다. 제안이 준비되면 아래에 나타납니다.</Status> : null}
        <Button type="submit" busy={ingest.busy} className="self-start" icon={<Search className="size-4" aria-hidden />}>
          분석 시작
        </Button>
      </form>

      {proposals.error ? <Problem>{proposals.error}</Problem> : null}
      {proposals.data && list.length === 0 ? (
        <Empty title="아직 제안이 없습니다">
          <p>잘 만들어진 저장소를 분석하면, 그 저장소에는 있고 이 프로젝트에는 없는 엔지니어링 관행을 근거와 함께 제안합니다.</p>
        </Empty>
      ) : null}
      <ul className="flex flex-col gap-8">
        {list.map((card) => (
          <li key={card.id}>
            <Card card={card} onChanged={proposals.reload} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Card({ card, onChanged }: { card: ProposalCard; onChanged: () => void }) {
  const { backend } = useStudio();
  const act = useAction(async (what: 'materialize' | 'merge' | 'reject') => {
    if (what === 'materialize') await backend.call('kirby.materialize', { proposalId: card.id });
    else if (what === 'merge') await backend.call('git.merge', { projectId: card.projectId, branch: card.branch! });
    else await backend.call('kirby.reject', { proposalId: card.id });
    onChanged();
  });
  const open = card.state === 'proposed' || card.state === 'ready' || card.state === 'failed';

  return (
    <article className="flex flex-col gap-4 border-t-2 border-fg pt-4">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <h3 className="text-lg font-semibold">{card.title}</h3>
        <Status tone={stateTone[card.state]}>{proposalStateLabel[card.state]}</Status>
      </header>
      <p className="text-base">{card.rationale}</p>

      <dl className="flex flex-col">
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-t border-border py-2">
          <dt className="text-sm text-fg-muted">예상 효과 (모델의 추정)</dt>
          <dd className="text-base">{card.estimatedImpact}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-t border-border py-2">
          <dt className="text-sm text-fg-muted">기존 동작이 깨질 위험</dt>
          <dd className="text-base">{riskLabel[card.risk]}</dd>
        </div>
        {(card.measured ?? []).map((m) => (
          <div key={m.metric} className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-t border-border py-2">
            <dt className="text-sm text-fg-muted">실측: {metricLabel(m.metric)}</dt>
            <dd className="text-base font-medium">
              {m.before}에서 {m.after}
            </dd>
          </div>
        ))}
      </dl>

      <details>
        <summary className="flex min-h-11 cursor-pointer items-center text-base font-medium text-accent">근거 {card.evidence.length}곳과 계획된 변경 {card.plannedChanges.length}건</summary>
        <div className="flex flex-col gap-4 pb-2">
          <ul className="flex flex-col gap-2">
            {card.evidence.map((e) => (
              <li key={`${e.file}:${e.line}`} className="flex flex-col gap-1">
                <code className="break-all font-mono text-sm text-fg-muted">
                  {e.file}:{e.line}
                </code>
                {e.excerpt ? <code className="break-all font-mono text-sm">{e.excerpt}</code> : null}
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-2">
            {card.plannedChanges.map((c) => (
              <li key={c.path} className="text-base">
                <code className="break-all font-mono text-sm">{c.path}</code> {c.description}
              </li>
            ))}
          </ul>
          <p className="break-all text-base text-fg-muted">
            출처 {card.sourceRepo}, 커밋 {card.sourceCommit.slice(0, 12)}
          </p>
        </div>
      </details>

      {card.diff ? (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-base font-medium text-accent">
            실제 변경: 파일 {card.diffStat?.files ?? 0}개, 추가 {card.diffStat?.insertions ?? 0}줄, 삭제 {card.diffStat?.deletions ?? 0}줄
          </summary>
          <pre className="overflow-x-auto border border-border bg-sunken p-3 font-mono text-sm">{card.diff}</pre>
        </details>
      ) : null}

      {act.error ? <Problem>{act.error}</Problem> : null}
      {open ? (
        <div className="flex flex-wrap gap-3">
          {card.state === 'ready' ? (
            <Button variant="primary" busy={act.busy} onClick={() => void act.run('merge')} icon={<GitMerge className="size-4" aria-hidden />}>
              병합
            </Button>
          ) : (
            <Button variant="primary" busy={act.busy} onClick={() => void act.run('materialize')}>
              별도 브랜치에 구현
            </Button>
          )}
          <Button disabled={act.busy} onClick={() => void act.run('reject')}>
            거절
          </Button>
        </div>
      ) : null}
    </article>
  );
}

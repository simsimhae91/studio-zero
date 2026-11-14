import { ChevronDown, ChevronRight, Hammer, Map as MapIcon, Square } from 'lucide-react';
import { useState } from 'react';
import type { MilestoneProgress, ProductFeature, ProductMilestone, Project, Roadmap as RoadmapData } from '@studio-zero/protocol';
import { gateLabel } from '../../lib/steps.ts';
import { useAction, useQuery, useStudio } from '../../lib/studio.tsx';
import { Button, Problem, Segmented, Status, inputClass } from '../../ui.tsx';
import { ArtifactImage } from '../artifactImage.tsx';

const REQUEST_MAX = 20_000;
const tierName: Record<ProductFeature['tier'], string> = { core: '핵심', expected: '기본', delight: '매력' };
const standingName: Record<ProductFeature['inPreview'], string> = { real: '', simulated: '프리뷰에서는 예시', 'device-only': '기기에서만' };
const stateName: Record<MilestoneProgress['state'], string> = { planned: '지을 차례를 기다림', building: '짓는 중', built: '지음', failed: '멈춤' };
const stateTone: Record<MilestoneProgress['state'], 'neutral' | 'active' | 'good' | 'bad'> = { planned: 'neutral', building: 'active', built: 'good', failed: 'bad' };
/** One block a milestone in the strip under the title: the colour repeats what the count beside it says in words. */
const stateFill: Record<MilestoneProgress['state'], string> = { planned: 'bg-control-border', building: 'bg-accent', built: 'bg-success', failed: 'bg-danger' };

const checkName: Record<string, string> = { ...gateLabel, 'screen-spec': '화면 명세' };

/** The harness's one-line reason for giving a milestone up, as the owner reads it. Anything else is shown as it came. */
function ownerReason(text: string): string {
  return text.replace(/verification still failing after (\d+) corrections?: ([\w, -]+)/, (_all, n: string, checks: string) => `고칠 기회 ${n}번을 다 쓰고도 통과하지 못한 검사가 있습니다 (${checks.split(', ').map((check) => checkName[check] ?? check).join(', ')})`);
}

/**
 * A product planned whole, and how far it is built. The owner says what the product is; the studio writes its
 * map (every feature a product of its kind has, in milestones) and, when the owner says so, builds the milestones
 * one after another, each walked in a browser before the next starts.
 *
 * The map is a model's writing: every word of it is shown as text.
 */
export function Roadmap({ project, onTask }: { project: Project; onTask: (taskId: string) => void }) {
  const { backend } = useStudio();
  const read = useQuery('roadmap.get', { projectId: project.id }, ['roadmap.changed']);
  const roadmap = read.data?.roadmap ?? null;
  const [request, setRequest] = useState('');
  const [merge, setMerge] = useState(true);
  const [replanning, setReplanning] = useState(false);
  const plan = useAction(async () => {
    await backend.call('roadmap.plan', { projectId: project.id, request: request.trim() });
    setReplanning(false);
    read.reload();
  });
  const run = useAction(async () => {
    await backend.call('roadmap.run', { projectId: project.id, autoMerge: merge });
    read.reload();
  });
  const stop = useAction(async () => {
    await backend.call('roadmap.stop', { projectId: project.id });
    read.reload();
  });

  if (read.error && !read.data) return <div className="p-4"><Problem>{read.error}</Problem></div>;
  if (!read.data) return <p className="p-4 text-base text-fg-muted">로드맵을 불러오는 중입니다.</p>;

  const form = (lead: string) => (
    <section className="flex flex-col gap-3" aria-label="제품 지도 만들기">
      <p className="text-base text-fg-muted">{lead}</p>
      <textarea
        aria-label="어떤 제품인가요"
        rows={7}
        maxLength={REQUEST_MAX}
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        placeholder={'예: 다이어트 배틀 앱. 비슷한 조건의 상대와 2주 동안 감량을 겨룬다.\n- 매칭\n- 사진으로 칼로리 계산\n- 랭킹\n- 승리와 패배 연출'}
        className={`${inputClass} resize-y py-2`}
      />
      {plan.error ? <Problem>{plan.error}</Problem> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" busy={plan.busy} disabled={request.trim() === ''} onClick={() => void plan.run()} icon={<MapIcon className="size-4" aria-hidden />}>
          제품 지도 만들기
        </Button>
        {replanning ? <Button onClick={() => setReplanning(false)}>취소</Button> : null}
      </div>
    </section>
  );

  if (!roadmap || replanning) {
    return (
      <div className="flex flex-col gap-6 p-4">
        <Heading />
        {form('한두 화면으로 끝나는 초안 대신 제품 전체를 먼저 계획합니다. 적어 주신 기능에, 이런 제품이라면 있어야 하는 것을 더해 마일스톤으로 나눕니다. 지도를 읽어 보신 뒤에 짓기를 시작합니다.')}
      </div>
    );
  }
  if (roadmap.state === 'planning') {
    return (
      <div className="flex flex-col gap-6 p-4">
        <Heading />
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <Status tone="active">제품 지도를 쓰는 중</Status>
          <p className="text-base text-fg-muted">몇 분 걸립니다. 다 쓰면 이 자리에 나옵니다.</p>
          <p className="whitespace-pre-wrap break-words border-l-4 border-border pl-3 text-base">{roadmap.request}</p>
        </div>
      </div>
    );
  }
  const map = roadmap.map;
  if (!map) {
    return (
      <div className="flex flex-col gap-6 p-4">
        <Heading />
        <Problem>제품 지도를 쓰지 못했습니다. {roadmap.error ?? ''}</Problem>
        {form('요청을 조금 더 구체적으로 적어 다시 만들어 주세요.')}
      </div>
    );
  }

  const byId = new Map(map.features.map((feature) => [feature.id, feature]));
  const progress = (i: number): MilestoneProgress => roadmap.milestones[i] ?? { state: 'planned', taskIds: [], error: null, debt: [], shots: [] };
  const built = roadmap.milestones.filter((m) => m.state === 'built').length;
  const builtFeatures = map.milestones.reduce((n, milestone, i) => n + (progress(i).state === 'built' ? milestone.features.length : 0), 0);
  const notReal = map.features.filter((feature) => feature.inPreview !== 'real');
  const overall =
    roadmap.state === 'done' ? <Status tone="good">모두 지음</Status> : roadmap.state === 'running' ? <Status tone="active">짓는 중</Status> : roadmap.state === 'stopped' ? <Status tone="bad">멈춤</Status> : <Status tone="neutral">아직 짓지 않음</Status>;

  return (
    <div className="flex flex-col gap-6 p-4">
      <section className="flex flex-col gap-3" aria-label="제품 지도">
        <Heading />
        <p className="break-words text-base">{map.pitch}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {overall}
          <p className="text-sm text-fg-muted">
            마일스톤 {map.milestones.length}개 중 {built}개, 기능 {map.features.length}개 중 {builtFeatures}개를 지었습니다
          </p>
        </div>
        <ol className="flex gap-1" aria-hidden>
          {map.milestones.map((milestone, i) => (
            <li key={milestone.id} className={`h-2 min-w-0 flex-1 rounded-sm ${stateFill[progress(i).state]}`} />
          ))}
        </ol>
        {roadmap.state === 'stopped' && roadmap.error ? <Problem>{ownerReason(roadmap.error)}</Problem> : null}
        {run.error ? <Problem>{run.error}</Problem> : null}
        {stop.error ? <Problem>{stop.error}</Problem> : null}
        {roadmap.state === 'planned' || roadmap.state === 'stopped' ? (
          <div className="flex flex-col gap-3">
            <Segmented compact label="검사를 통과한 마일스톤" value={merge ? 'merge' : 'keep'} options={[{ id: 'merge', label: '통과하면 바로 합치기' }, { id: 'keep', label: '브랜치에 두고 이어 짓기' }]} onChange={(id) => setMerge(id === 'merge')} />
            <p className="text-sm text-fg-muted">마일스톤 하나가 작업 하나입니다. 짓는 동안 구독 사용량을 쓰고, 언제든 멈출 수 있습니다.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" busy={run.busy} onClick={() => void run.run()} icon={<Hammer className="size-4" aria-hidden />}>
                {roadmap.state === 'stopped' ? '멈춘 곳부터 이어서 짓기' : '끝까지 짓기'}
              </Button>
              {built === 0 ? (
                <Button
                  onClick={() => {
                    setRequest(roadmap.request);
                    setReplanning(true);
                  }}
                >
                  지도 다시 만들기
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {roadmap.state === 'running' ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-fg-muted">멈추면 짓고 있는 마일스톤까지만 마치고 다음은 시작하지 않습니다.</p>
            <Button className="self-start" busy={stop.busy} onClick={() => void stop.run()} icon={<Square className="size-4" aria-hidden />}>
              멈추기
            </Button>
          </div>
        ) : null}
      </section>

      <ol className="flex flex-col gap-4" aria-label="마일스톤">
        {map.milestones.map((milestone, i) => (
          <Milestone key={milestone.id} index={i} milestone={milestone} progress={progress(i)} features={milestone.features.flatMap((id) => byId.get(id) ?? [])} startOpen={progress(i).state === 'building' || progress(i).state === 'failed'} onTask={onTask} />
        ))}
      </ol>

      {notReal.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label="프리뷰에서 실제가 아닌 기능">
          <h3 className="text-base font-semibold">연결하거나 기기에서 빌드해야 실제가 되는 기능</h3>
          <ul className="flex flex-col gap-3">
            {notReal.map((feature) => (
              <li key={feature.id} className="flex max-w-none flex-col gap-1 border-l-4 border-warning pl-3">
                <p className="text-base font-medium">
                  {feature.name} <span className="font-normal text-fg-muted">· {standingName[feature.inPreview]}</span>
                </p>
                <p className="break-words text-base text-fg-muted">{feature.simulation}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Heading() {
  return <h2 className="text-lg font-semibold">제품 로드맵</h2>;
}

function Milestone({ index, milestone, progress, features, startOpen, onTask }: { index: number; milestone: ProductMilestone; progress: MilestoneProgress; features: ProductFeature[]; startOpen: boolean; onTask: (taskId: string) => void }) {
  const [open, setOpen] = useState(startOpen);
  const task = progress.taskIds.at(-1) ?? null;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li className="flex max-w-none flex-col rounded-lg border border-border bg-surface">
      <button type="button" aria-expanded={open} onClick={() => setOpen((on) => !on)} className="flex min-h-11 w-full items-start gap-3 rounded-lg px-4 py-3 text-left hover:bg-sunken">
        <Chevron className="mt-1 size-4 shrink-0 text-fg-muted" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="break-words text-base font-semibold">
            {index + 1}. {milestone.name}
          </span>
          <span className="break-words text-sm text-fg-muted">{features.map((feature) => feature.name).join(' · ')}</span>
        </span>
        <span className="shrink-0 pt-1">
          <Status tone={stateTone[progress.state]}>{stateName[progress.state]}</Status>
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
          <p className="break-words text-base text-fg-muted">{milestone.goal}</p>
          {progress.error ? <Problem>{ownerReason(progress.error)}</Problem> : null}
          <ul className="flex flex-col gap-4">
            {features.map((feature) => (
              <li key={feature.id} className="flex max-w-none flex-col gap-1">
                <p className="text-base font-medium">
                  {feature.name}{' '}
                  <span className="font-normal text-fg-muted">
                    · {tierName[feature.tier]}
                    {feature.inPreview === 'real' ? '' : ` · ${standingName[feature.inPreview]}`}
                  </span>
                </p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-base text-fg-muted">
                  {feature.does.map((does, n) => (
                    <li key={n} className="max-w-none break-words">
                      {does}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold">다 지어지면 걸어서 확인하는 것</h4>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-base text-fg-muted">
              {milestone.acceptance.map((line, n) => (
                <li key={n} className="max-w-none break-words">
                  {line}
                </li>
              ))}
            </ul>
          </div>
          {progress.debt.length > 0 ? (
            <div className="flex flex-col gap-1 border-l-4 border-warning pl-3">
              <h4 className="text-sm font-semibold">걸은 화면에서 재고 남은 결함 {progress.debt.length}건</h4>
              <ul className="flex flex-col gap-1 text-base text-fg-muted">
                {progress.debt.map((line, n) => (
                  <li key={n} className="max-w-none break-words">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {progress.shots.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold">걸으면서 찍은 화면 {progress.shots.length}장</h4>
              <ul className="flex gap-3 overflow-x-auto pb-2">
                {progress.shots.map((shot) => (
                  <li key={shot.artifactId} className="flex w-36 max-w-none shrink-0 flex-col gap-1">
                    <ArtifactImage artifactId={shot.artifactId} alt={`${shot.screen} 화면`} className="w-36 rounded-md border border-border" />
                    <code className="text-sm text-fg-muted">{shot.screen}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {task ? (
            <Button className="self-start" onClick={() => onTask(task)}>
              {progress.taskIds.length > 1 ? `작업 보기 (${progress.taskIds.length}번째 시도)` : '작업 보기'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

import { ChevronDown, GitMerge, History as HistoryIcon, Lightbulb, Monitor, ScanEye, Sparkles, Square, SquareTerminal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Approval, EventEnvelope, Phase, Project, Task, TaskKind, TaskState } from '@studio-zero/protocol';
import { Markdown } from '@studio-zero/ax/react';
import { duration, evalLabel, kindLabel, phaseLabel, taskStateLabel, templateLabel, tokens } from '../lib/format.ts';
import { useAction, useQuery, useStudio, useTaskEvents } from '../lib/studio.tsx';
import { Button, IconButton, Problem, Segmented, Sheet, Status, TitlebarSpace } from '../ui.tsx';
import { Composer, Entry, OwnWords, Working, useStickToEnd } from './page.tsx';
import { Audit } from './panels/Audit.tsx';
import { History } from './panels/History.tsx';
import { Learning } from './panels/Learning.tsx';
import { Preview } from './panels/Preview.tsx';
import { Proposals } from './panels/Proposals.tsx';
import { TerminalPane } from './panels/Terminal.tsx';
import type { Route } from './Shell.tsx';

type Panel = 'preview' | 'audit' | 'terminal' | 'history' | 'proposals' | 'learning';
const panelTitle: Record<Panel, string> = { preview: '프리뷰', audit: '시각 감사', terminal: '터미널', history: '시점', proposals: '제안', learning: '학습' };
const panelNote: Partial<Record<Panel, string>> = {
  audit: '폰, 태블릿, 데스크톱 크기로 잰 결과입니다.',
  terminal: '샌드박스에서 실행된 명령과 출력입니다. 읽기 전용입니다.',
  proposals: '다른 저장소에서 배워 온 개선안입니다.',
  learning: '지난 작업에서 얻은 교훈과 회귀 검사입니다.',
};
const KINDS: readonly { id: Exclude<TaskKind, 'kirby_materialize' | 'ideate'>; label: string }[] = [
  { id: 'build', label: kindLabel.build },
  { id: 'refactor', label: kindLabel.refactor },
  { id: 'inline_edit', label: kindLabel.inline_edit },
];
const live = (state: TaskState): boolean => state === 'queued' || state === 'running' || state === 'awaiting_approval';
const stateTone = { queued: 'neutral', running: 'active', awaiting_approval: 'warn', succeeded: 'good', failed: 'bad', cancelled: 'neutral' } as const;
const sandboxLabel = { running: '샌드박스 실행 중', stopped: '샌드박스 꺼짐', absent: '샌드박스 없음' } as const;

interface Call {
  id: string;
  tool: string;
  input: string;
  ok: boolean | null;
  exitCode: number | null;
  ms: number | null;
  preview: string;
}
type Item = { at: number; phase: Phase | null } & (
  | { kind: 'plan'; summary: string; steps: string[]; lessons: number }
  | { kind: 'work'; calls: Call[] }
  | { kind: 'said'; text: string }
  | { kind: 'steer'; text: string; delivered: boolean }
  | { kind: 'checks'; results: { name: string; passed: boolean; detail: string; ms: number }[] }
  | { kind: 'audit'; score: number; passed: boolean; blockers: number; majors: number; minors: number }
  | { kind: 'denied'; reason: string }
  | { kind: 'note'; text: string }
);

/** A task's event stream as the entries of a page: what was planned, done, said, checked and refused, in order. */
function narrate(events: readonly EventEnvelope[]): Item[] {
  const items: Item[] = [];
  const calls = new Map<string, Call>();
  const waiting: Extract<Item, { kind: 'steer' }>[] = [];
  let phase: Phase | null = null;
  for (const e of events) {
    const b = e.body;
    const last = items.at(-1);
    const base = { at: e.at, phase };
    switch (b.type) {
      case 'task.phase':
        phase = b.phase;
        break;
      case 'plan.created':
        items.push({ ...base, kind: 'plan', summary: b.summary, steps: b.steps, lessons: b.appliedLessonIds.length });
        break;
      case 'tool.call': {
        const call: Call = { id: b.callId, tool: b.tool, input: b.input, ok: null, exitCode: null, ms: null, preview: '' };
        calls.set(b.callId, call);
        if (last?.kind === 'work') last.calls.push(call);
        else items.push({ ...base, kind: 'work', calls: [call] });
        break;
      }
      case 'tool.result': {
        const call = calls.get(b.callId);
        if (call) Object.assign(call, { ok: b.ok, exitCode: b.exitCode, ms: b.durationMs, preview: b.preview });
        break;
      }
      case 'agent.text':
        if (b.text.trim()) items.push({ ...base, kind: 'said', text: b.text });
        break;
      case 'steer.queued': {
        const steer = { ...base, kind: 'steer' as const, text: b.text, delivered: false };
        items.push(steer);
        waiting.push(steer);
        break;
      }
      case 'steer.delivered':
        for (const steer of waiting.splice(0)) steer.delivered = true;
        break;
      case 'eval.result': {
        const result = { name: b.name, passed: b.passed, detail: b.detail, ms: b.durationMs };
        if (last?.kind === 'checks') last.results.push(result);
        else items.push({ ...base, kind: 'checks', results: [result] });
        break;
      }
      case 'audit.completed':
        items.push({ ...base, kind: 'audit', score: b.score, passed: b.passed, blockers: b.blockers, majors: b.majors, minors: b.minors });
        break;
      case 'policy.decision':
        if (b.effect === 'deny') items.push({ ...base, kind: 'denied', reason: b.reason });
        break;
      case 'reflection.completed':
        if (b.lessonsAccepted + b.evalsAdded > 0) items.push({ ...base, kind: 'note', text: `이번 작업에서 교훈 ${b.lessonsAccepted}건, 회귀 검사 ${b.evalsAdded}건을 남겼습니다.` });
        break;
      default:
        break;
    }
  }
  return items;
}

/**
 * A project as one page. Every task is a passage on it: the request, what the studio planned and did, what the
 * checks said. Artifacts (the audit proof, the preview, the terminal) open from the passage that produced them,
 * the rail on the right is the page's history, and the bar at the foot talks to whatever is running.
 */
export function ProjectPage({ project, loading, onOpen }: { project: Project | null; loading: boolean; onOpen: (route: Route) => void }) {
  if (!project) {
    return (
      <div className="page flex flex-col gap-4 p-10">
        <TitlebarSpace />
        {loading ? null : (
          <>
            <Problem>이 프로젝트를 찾을 수 없습니다. 삭제되었을 수 있습니다.</Problem>
            <Button onClick={() => onOpen({ kind: 'home' })} className="self-start">
              처음으로
            </Button>
          </>
        )}
      </div>
    );
  }
  return <Page project={project} />;
}

function Page({ project }: { project: Project }) {
  const { backend } = useStudio();
  const tasks = useQuery('tasks.list', { projectId: project.id, limit: 40 }, ['task.state', 'task.phase', 'usage']);
  const approvals = useQuery('approvals.list', { state: 'pending' }, ['approval.requested', 'approval.resolved']);
  const checkpoints = useQuery('checkpoints.list', { projectId: project.id }, ['checkpoint.created', 'checkpoint.restored']);
  const sandbox = useQuery('sandbox.info', { projectId: project.id }, ['sandbox.state']);
  const [picked, setPicked] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [fork, setFork] = useState<string | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]['id']>('build');

  const list = useMemo(() => [...(tasks.data?.tasks ?? [])].sort((a, b) => a.createdAt - b.createdAt), [tasks.data]);
  const active = list.findLast((t) => live(t.state)) ?? null;
  const selected = list.find((t) => t.id === picked) ?? active ?? list.at(-1) ?? null;
  const events = useTaskEvents(selected?.id ?? null);
  const items = useMemo(() => narrate(events), [events]);
  const scroll = useStickToEnd(`${selected?.id}:${events.length}`);
  const pending = (approvals.data?.approvals ?? []).filter((a) => a.projectId === project.id);
  const points = useMemo(() => [...(checkpoints.data?.checkpoints ?? [])].sort((a, b) => a.createdAt - b.createdAt), [checkpoints.data]);

  const steer = useAction((message: string) => backend.call('tasks.steer', { taskId: active!.id, message }));
  const submit = useAction(async (prompt: string) => {
    const task = await backend.call('tasks.submit', { projectId: project.id, kind, prompt, ...(fork ? { baseBranch: fork } : {}) });
    setFork(null);
    setPicked(task.id);
    tasks.reload();
  });
  const cancel = useAction(() => backend.call('tasks.cancel', { taskId: active!.id }));
  const steering = active !== null && active.state !== 'queued';
  const show = (next: Panel, checkpointId: string | null = null): void => {
    setFocus(checkpointId);
    setPanel(next);
  };

  return (
    <div className="has-time-rail relative flex min-h-0 flex-1 flex-col">
      <div ref={scroll} className="pane-scroll min-h-0 flex-1">
        <article className="page flex flex-col pb-56">
          <TitlebarSpace />
          <header className="flex flex-col gap-4 border-b border-border px-4 pb-8 pt-10 md:px-10">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <p className="text-sm font-medium text-fg-muted">{templateLabel[project.template]}</p>
              {sandbox.data ? <Status tone={sandbox.data.state === 'running' ? 'good' : 'neutral'}>{sandboxLabel[sandbox.data.state]}</Status> : null}
            </div>
            <h1 className="text-4xl font-semibold">{project.name}</h1>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => show('preview')} icon={<Monitor className="size-4" aria-hidden />}>
                프리뷰
              </Button>
              <Button onClick={() => show('history')} icon={<HistoryIcon className="size-4" aria-hidden />}>
                시점 {points.length}개
              </Button>
              <Button onClick={() => show('proposals')} icon={<Sparkles className="size-4" aria-hidden />}>
                제안
              </Button>
              <Button onClick={() => show('learning')} icon={<Lightbulb className="size-4" aria-hidden />}>
                학습
              </Button>
            </div>
            {tasks.error ? <Problem>{tasks.error}</Problem> : null}
          </header>

          {tasks.data && list.length === 0 ? (
            <div className="flex flex-col gap-2 px-4 py-10 md:px-10">
              <h2 className="text-2xl font-semibold">아직 아무것도 만들지 않았습니다</h2>
              <p className="text-lg text-fg-muted">아래 입력창에 만들 것을 적으면, 스튜디오가 계획을 세우고 샌드박스에서 구현한 뒤 화면을 재서 보여 줍니다.</p>
            </div>
          ) : null}

          <ol className="flex flex-col">
            {list.map((task) =>
              task.id === selected?.id ? (
                <Passage key={task.id} task={task} items={items} pending={pending} onShow={show} />
              ) : (
                <li key={task.id} className="max-w-none border-b border-border">
                  <button type="button" onClick={() => setPicked(task.id)} className="entry min-h-11 w-full px-4 py-5 text-left hover:bg-sunken md:px-10">
                    <span className="text-sm text-fg-muted">{kindLabel[task.kind]}</span>
                    <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                      <span className="line-clamp-1 text-lg">{task.prompt.split('\n')[0]}</span>
                      <Status tone={stateTone[task.state]}>{taskStateLabel[task.state]}</Status>
                    </span>
                  </button>
                </li>
              ),
            )}
          </ol>
        </article>
      </div>

      <nav className="time-rail flex-col border-l border-border bg-bg" aria-label="시점">
        <TitlebarSpace />
        <ol className="pane-scroll flex min-h-0 flex-1 flex-col items-center py-6">
          {points.map((point, i) => (
            <li key={point.id} className="flex flex-col items-center">
              {i > 0 ? <span className="h-4 w-px bg-control-border" aria-hidden /> : null}
              <button type="button" onClick={() => show('history', point.id)} title={point.label} aria-label={`시점: ${point.label}`} className="flex size-11 items-center justify-center rounded-md hover:bg-sunken">
                <span className={`size-3 border ${point.taskId !== null && point.taskId === selected?.id ? 'border-accent bg-accent' : 'border-control-border bg-surface'}`} />
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <Composer
        key={steering ? 'steer' : 'submit'}
        placeholder={steering ? '진행 중인 작업에 한마디' : fork ? '이 갈래에서 이어서 할 일' : '다음에 할 일'}
        sendLabel={steering ? '작업에 전달' : '작업 시작'}
        onSend={steering ? steer.run : submit.run}
        error={steer.error ?? submit.error ?? cancel.error}
        above={
          steering ? (
            <p className="px-3 pt-1 text-sm text-fg-muted">작업은 멈추지 않습니다. 보낸 말은 다음 차례에 함께 읽힙니다.</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
              <Segmented label="작업 종류" value={kind} options={KINDS} onChange={setKind} />
              {fork ? (
                <span className="flex items-center gap-1 pl-3 text-sm font-medium text-accent">
                  {fork}에서 시작
                  <IconButton label="갈래 선택 취소" onClick={() => setFork(null)}>
                    <X className="size-4" aria-hidden />
                  </IconButton>
                </span>
              ) : null}
            </div>
          )
        }
        tools={
          steering ? (
            <IconButton label="작업 중단" disabled={cancel.busy} onClick={() => void cancel.run()}>
              <Square className="size-4" aria-hidden />
            </IconButton>
          ) : null
        }
      />

      <Sheet open={panel !== null} onOpenChange={(open) => !open && setPanel(null)} title={panel ? panelTitle[panel] : ''} description={panel ? panelNote[panel] : undefined} wide={panel !== 'history' && panel !== 'learning'}>
        {panel === 'preview' ? <Preview project={project} /> : null}
        {panel === 'audit' ? <Audit project={project} /> : null}
        {panel === 'terminal' ? <TerminalPane taskId={selected?.id ?? null} /> : null}
        {panel === 'history' ? (
          <History
            project={project}
            focus={focus}
            onFork={(branch) => {
              setFork(branch);
              setPanel(null);
            }}
          />
        ) : null}
        {panel === 'proposals' ? <Proposals project={project} /> : null}
        {panel === 'learning' ? <Learning project={project} /> : null}
      </Sheet>
    </div>
  );
}

/** One task, opened out. */
function Passage({ task, items, pending, onShow }: { task: Task; items: Item[]; pending: Approval[]; onShow: (panel: Panel, checkpointId?: string | null) => void }) {
  const { backend } = useStudio();
  const [merged, setMerged] = useState<string | null>(null);
  const merge = useAction(async () => {
    const result = await backend.call('git.merge', { projectId: task.projectId, branch: task.branch! });
    setMerged(result.into);
  });
  let phase: Phase | null = null;
  const margin = (item: Item): string | null => {
    if (item.phase === null || item.phase === phase) return null;
    phase = item.phase;
    return phaseLabel[item.phase];
  };

  return (
    <>
      <Entry who="나" at={task.createdAt} note={task.origin === 'desktop' ? kindLabel[task.kind] : `${kindLabel[task.kind]}, ${task.origin}에서`}>
        <OwnWords clamp>{task.prompt}</OwnWords>
      </Entry>

      {items.map((item, i) => {
        const note = margin(item);
        switch (item.kind) {
          case 'plan':
            return (
              <Entry key={i} who="스튜디오" at={item.at} note={note}>
                <p className="text-lg">{item.summary}</p>
                <ol className="flex list-decimal flex-col gap-1 pl-6 text-lg">
                  {item.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {item.lessons > 0 ? <p className="text-base text-fg-muted">지난 작업의 교훈 {item.lessons}건을 반영했습니다.</p> : null}
              </Entry>
            );
          case 'work':
            return (
              <Entry key={i} who="스튜디오" at={item.at} note={note}>
                <Work calls={item.calls} startOpen={live(task.state) && i === items.length - 1} onTerminal={() => onShow('terminal')} />
              </Entry>
            );
          case 'said':
            return (
              <Entry key={i} who="스튜디오" at={item.at} note={note}>
                <Markdown source={item.text} />
              </Entry>
            );
          case 'steer':
            return (
              <Entry key={i} who="나" at={item.at} note={item.delivered ? '전달됨' : '다음 차례에 전달'}>
                <OwnWords>{item.text}</OwnWords>
              </Entry>
            );
          case 'checks':
            return (
              <Entry key={i} who="검증" at={item.at} note={note}>
                <ul className="flex flex-col">
                  {item.results.map((r, n) => (
                    <li key={n} className="flex flex-col gap-2 border-t border-border py-3">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-6">
                        <span className="text-lg">{evalLabel(r.name)}</span>
                        <Status tone={r.passed ? 'good' : 'bad'}>
                          {r.passed ? '통과' : '실패'}, {duration(r.ms)}
                        </Status>
                      </span>
                      {r.passed ? null : <pre className="overflow-x-auto whitespace-pre-wrap bg-sunken p-3 font-mono text-sm">{r.detail}</pre>}
                    </li>
                  ))}
                </ul>
              </Entry>
            );
          case 'audit':
            return (
              <Entry key={i} who="검증" at={item.at} note={note}>
                <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
                  <div className="flex flex-col gap-1">
                    <p className="text-3xl font-semibold">시각 감사 {item.score.toFixed(0)}점</p>
                    <p className="text-base text-fg-muted">
                      {item.passed ? '기준을 넘었습니다' : '기준에 못 미쳤습니다'}. 블로커 {item.blockers}건, 주요 {item.majors}건, 사소 {item.minors}건
                    </p>
                  </div>
                  <Button onClick={() => onShow('audit')} icon={<ScanEye className="size-4" aria-hidden />}>
                    증거 보기
                  </Button>
                </div>
              </Entry>
            );
          case 'denied':
            return (
              <Entry key={i} who="정책" at={item.at} note={note}>
                <p className="border-l-4 border-danger pl-5 text-lg">허용하지 않았습니다. {item.reason}</p>
              </Entry>
            );
          case 'note':
            return (
              <Entry key={i} who="회고" at={item.at} note={note}>
                <p className="text-lg">{item.text}</p>
              </Entry>
            );
        }
      })}

      {pending.filter((a) => a.taskId === null || a.taskId === task.id).map((approval) => (
        <Entry key={approval.id} who="승인 필요" at={approval.requestedAt}>
          <ApprovalCard approval={approval} />
        </Entry>
      ))}

      {task.state === 'running' || task.state === 'queued' ? (
        <Working>
          {task.state === 'queued' ? '차례를 기다리는 중' : `${task.phase ? phaseLabel[task.phase] : '준비'} 중`}, 토큰 {tokens(task.spentTokens)} / {tokens(task.budgetTokens)}
        </Working>
      ) : null}

      {live(task.state) ? null : (
        <Entry who="결과" at={task.finishedAt ?? undefined}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Status tone={stateTone[task.state]}>{taskStateLabel[task.state]}</Status>
            <span className="text-sm text-fg-muted">
              토큰 {tokens(task.spentTokens)} 사용{task.engine ? `, ${task.engine}` : ''}
            </span>
          </div>
          {task.summary ? <Markdown source={task.summary} /> : null}
          {task.error ? <Problem>{task.error}</Problem> : null}
          {merge.error ? <Problem>{merge.error}</Problem> : null}
          <div className="flex flex-wrap gap-2">
            {task.state === 'succeeded' ? (
              <Button onClick={() => onShow('preview')} icon={<Monitor className="size-4" aria-hidden />}>
                프리뷰로 보기
              </Button>
            ) : null}
            {task.state === 'succeeded' && task.branch ? (
              merged ? (
                <Status tone="good">{merged}에 합쳤습니다</Status>
              ) : (
                <Button variant="primary" busy={merge.busy} onClick={() => void merge.run()} icon={<GitMerge className="size-4" aria-hidden />}>
                  합치기
                </Button>
              )
            ) : null}
            {task.state === 'failed' && task.baseCheckpointId ? (
              <Button onClick={() => onShow('history', task.baseCheckpointId)} icon={<HistoryIcon className="size-4" aria-hidden />}>
                시작 전 시점 보기
              </Button>
            ) : null}
          </div>
        </Entry>
      )}
    </>
  );
}

/** A run of tool calls, folded to one line until someone wants the detail. */
function Work({ calls, startOpen, onTerminal }: { calls: Call[]; startOpen: boolean; onTerminal: () => void }) {
  const [open, setOpen] = useState(startOpen);
  const failed = calls.filter((c) => c.ok === false).length;
  const last = calls.at(-1)!;
  return (
    <div className="flex flex-col">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-11 items-center justify-between gap-4 text-left">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-lg">
            작업 {calls.length}단계{failed > 0 ? `, 그중 ${failed}단계 실패 후 계속` : ''}
          </span>
          {open ? null : <span className="line-clamp-1 font-mono text-sm text-fg-muted">{last.tool === 'bash' ? last.input : `${last.tool} ${last.input}`}</span>}
        </span>
        <ChevronDown className={`size-5 shrink-0 text-fg-muted ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open ? (
        <>
          <ol className="flex flex-col">
            {calls.map((call) => (
              <li key={call.id} className="flex flex-col gap-2 border-t border-border py-3">
                <span className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <span className="min-w-0 break-words font-mono text-sm">{call.tool === 'bash' ? call.input : `${call.tool} ${call.input}`}</span>
                  <span className={`text-sm ${call.ok === false ? 'font-medium text-danger' : 'text-fg-muted'}`}>
                    {call.ok === null ? '실행 중' : call.ok ? '완료' : `실패${call.exitCode === null ? '' : `, 종료 코드 ${call.exitCode}`}`}
                    {call.ms === null ? '' : `, ${duration(call.ms)}`}
                  </span>
                </span>
                {/* Sandbox output is untrusted: it is only ever a text node. */}
                {call.ok === false && call.preview ? <pre className="overflow-x-auto whitespace-pre-wrap bg-sunken p-3 font-mono text-sm">{call.preview}</pre> : null}
              </li>
            ))}
          </ol>
          <Button onClick={onTerminal} icon={<SquareTerminal className="size-4" aria-hidden />} className="self-start">
            터미널로 전체 보기
          </Button>
        </>
      ) : null}
    </div>
  );
}

/** A decision only the owner can make. The daemon holds the action until one of these is pressed, here or in a messenger. */
function ApprovalCard({ approval }: { approval: Approval }) {
  const { backend } = useStudio();
  const resolve = useAction((decision: 'approve' | 'deny') => backend.call('approvals.resolve', { approvalId: approval.id, decision }));
  return (
    <div className="flex flex-col gap-4 border-l-4 border-warning pl-5">
      <p className="text-xl">{approval.summary}</p>
      {resolve.error ? <Problem>{resolve.error}</Problem> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" busy={resolve.busy} onClick={() => void resolve.run('approve')}>
          승인
        </Button>
        <Button disabled={resolve.busy} onClick={() => void resolve.run('deny')}>
          거절
        </Button>
      </div>
    </div>
  );
}

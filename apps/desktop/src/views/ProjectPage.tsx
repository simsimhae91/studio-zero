import * as Tabs from '@radix-ui/react-tabs';
import { ChevronDown, FileText, FolderTree, GitMerge, Globe, History as HistoryIcon, Lightbulb, MessageCircleQuestion, Monitor, MoreHorizontal, Pencil, Plus, RotateCw, ScanEye, Smartphone, Sparkles, Square, SquareTerminal, Trash2, X } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AdvisorId, Approval, Project, Session, Task, TaskKind, TaskState, TaskTrack } from '@studio-zero/protocol';
import { Markdown } from '@studio-zero/ax/react';
import { duration, engineLabel, kindLabel, phaseLabel, stamp, taskStateLabel, templateLabel, tokens } from '../lib/format.ts';
import { advisorCommand, narrate, type Item } from '../lib/steps.ts';
import { errorText, useAction, useQuery, useStudio, useTaskEvents } from '../lib/studio.tsx';
import { Button, IconButton, Menu, MenuItem, MenuSeparator, Problem, Segmented, Status, TitlebarSpace } from '../ui.tsx';
import { ActionStepper } from './ActionStepper.tsx';
import { Composer, useStickToEnd } from './page.tsx';
import { Audit } from './panels/Audit.tsx';
import { FileTree } from './panels/FileTree.tsx';
import { History } from './panels/History.tsx';
import { Learning } from './panels/Learning.tsx';
import { Preview } from './panels/Preview.tsx';
import { Proposals } from './panels/Proposals.tsx';
import { DeleteProjectModal, InlineName, restartSandbox } from './projectActions.tsx';
import type { Route } from './Shell.tsx';

// The terminal emulator is the largest thing in the client: fetched when the terminal tab is first opened.
const InteractiveTerminal = lazy(() => import('./panels/InteractiveTerminal.tsx').then((m) => ({ default: m.InteractiveTerminal })));

type TabId = 'preview' | 'files' | 'terminal' | 'history' | 'audit' | 'proposals' | 'learning';
type Pane = 'chat' | 'work';
type Kind = Exclude<TaskKind, 'kirby_materialize' | 'ideate'>;

const KINDS: readonly { id: Kind; label: string }[] = [
  { id: 'build', label: kindLabel.build },
  { id: 'refactor', label: kindLabel.refactor },
  { id: 'inline_edit', label: kindLabel.inline_edit },
];
const TRACKS: readonly { id: TaskTrack; label: string }[] = [
  { id: 'fast', label: '초안 먼저' },
  { id: 'full', label: '검증까지' },
];
const PANES: readonly { id: Pane; label: string }[] = [
  { id: 'chat', label: '대화' },
  { id: 'work', label: '작업공간' },
];
const DEFAULT_SESSION = 'default';
const advisorName: Record<AdvisorId, string> = { codex: 'Codex', gemini: 'Gemini' };
const live = (state: TaskState): boolean => state === 'queued' || state === 'running' || state === 'awaiting_approval';
const stateTone = { queued: 'neutral', running: 'active', awaiting_approval: 'warn', succeeded: 'good', failed: 'bad', cancelled: 'neutral' } as const;
const sandboxLabel = { running: '샌드박스 실행 중', stopped: '샌드박스 꺼짐', absent: '샌드박스 없음' } as const;

/** The documents a deep-track task leaves behind, and what each is. */
const DESIGN_DOCS: readonly { path: string; label: string }[] = [
  { path: 'docs/prd.md', label: '제품 요구사항 (PRD)' },
  { path: 'docs/architecture.md', label: '구조와 기술 선택' },
  { path: 'docs/erd.md', label: '데이터 모델' },
  { path: 'docs/openapi.yaml', label: 'API 명세' },
];
const BUILD_FROM_DESIGN = 'docs/prd.md, docs/architecture.md, docs/erd.md, docs/openapi.yaml에 정리한 설계대로 MVP를 구현해줘. 문서에서 범위 밖으로 둔 것은 만들지 말고, 문서와 다르게 구현해야 하는 부분이 생기면 마지막에 알려줘.';

interface Advice {
  advisor: AdvisorId;
  question: string;
  answer: string;
  ok: boolean;
  durationMs: number;
}

/**
 * A project as a workbench: the conversation with the agent on the left, what it is building on the right.
 * The left pane holds one task stream per session, as compact steps; the right pane is the running preview,
 * the files, a real terminal and the history, a tab apart.
 */
export function ProjectPage({ project, loading, onOpen, onChanged }: { project: Project | null; loading: boolean; onOpen: (route: Route) => void; onChanged: () => void }) {
  if (!project) {
    return (
      <div className="flex flex-col gap-4 p-10">
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
  return <Workbench project={project} onOpen={onOpen} onChanged={onChanged} />;
}

function Workbench({ project, onOpen, onChanged }: { project: Project; onOpen: (route: Route) => void; onChanged: () => void }) {
  const { backend } = useStudio();
  const tasks = useQuery('tasks.list', { projectId: project.id, limit: 200 }, ['task.state', 'task.phase', 'usage']);
  const approvals = useQuery('approvals.list', { state: 'pending' }, ['approval.requested', 'approval.resolved']);
  const sandbox = useQuery('sandbox.info', { projectId: project.id }, ['sandbox.state']);
  const status = useQuery('system.status', {});
  const sessions = useQuery('sessions.list', { projectId: project.id });

  const [pane, setPane] = useState<Pane>('chat');
  const [tab, setTab] = useState<TabId>('preview');
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(new Set<TabId>(['preview']));
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set([DEFAULT_SESSION]));
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [fork, setFork] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>('build');
  const [trackChoice, setTrackChoice] = useState<TaskTrack | null>(null);
  // 'auto' leaves the choice to the routing table; anything else is the owner's own pick for the next task.
  const [engine, setEngine] = useState('auto');
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [asking, setAsking] = useState<AdvisorId | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [advice, setAdvice] = useState<Advice[]>([]);

  const sessionList = sessions.data?.sessions ?? [];
  // A session that was closed elsewhere falls back to the default stream.
  const session = sessionList.some((s) => s.id === sessionId) ? sessionId : null;
  const key = session ?? DEFAULT_SESSION;
  const list = useMemo(() => [...(tasks.data?.tasks ?? [])].sort((a, b) => a.createdAt - b.createdAt), [tasks.data]);
  const bySession = (id: string | null): Task[] => list.filter((t) => (sessionList.some((s) => s.id === t.sessionId) ? t.sessionId : null) === id);
  const inSession = bySession(session);
  const active = inSession.findLast((t) => live(t.state)) ?? null;
  const selected = inSession.find((t) => t.id === picked[key]) ?? active ?? inSession.at(-1) ?? null;
  const steering = active !== null && active.state !== 'queued';
  const busy = list.some((t) => t.state === 'running' || t.state === 'awaiting_approval');
  const ready = list.some((t) => t.state === 'succeeded' && t.kind !== 'ideate');
  // A project that started as a draft keeps iterating as one, until the owner asks for the full checks.
  const track = trackChoice ?? list.findLast((t) => t.kind !== 'ideate')?.track ?? 'fast';
  const pending = (approvals.data?.approvals ?? []).filter((a) => a.projectId === project.id);
  const engines = [{ id: 'auto', label: '자동' }, ...(status.data?.engines ?? []).filter((e) => e.available).map((e) => ({ id: e.id, label: engineLabel[e.id] ?? e.id }))];

  const show = (next: TabId): void => {
    setTab(next);
    setVisited((prev) => new Set(prev).add(next));
    setPane('work');
  };
  const pickSession = (id: string | null): void => {
    setSessionId(id);
    setSeen((prev) => new Set(prev).add(id ?? DEFAULT_SESSION));
  };

  const steer = useAction((message: string) => backend.call('tasks.steer', { taskId: active!.id, message }));
  const submit = useAction(async (prompt: string, as: { kind: Kind; track: TaskTrack } = { kind, track }) => {
    const task = await backend.call('tasks.submit', { projectId: project.id, kind: as.kind, prompt, track: as.track, ...(session ? { sessionId: session } : {}), ...(fork ? { baseBranch: fork } : {}), ...(engine === 'auto' ? {} : { engine: engine as never }) });
    setFork(null);
    setPicked((prev) => ({ ...prev, [key]: task.id }));
    tasks.reload();
  });
  const cancel = useAction(() => backend.call('tasks.cancel', { taskId: active!.id }));
  const rename = useAction(async (name: string) => {
    await backend.call('projects.rename', { projectId: project.id, name });
    onChanged();
  });
  const restart = useAction(async () => {
    await restartSandbox(backend, project.id);
    sandbox.reload();
  });
  const addSession = useAction(async (name: string) => {
    const created = await backend.call('sessions.create', { projectId: project.id, name });
    sessions.reload();
    pickSession(created.id);
  });
  const renameSession = useAction(async (id: string, name: string) => {
    await backend.call('sessions.rename', { sessionId: id, name });
    sessions.reload();
  });
  const closeSession = useAction(async (id: string) => {
    await backend.call('sessions.delete', { sessionId: id });
    if (sessionId === id) setSessionId(null);
    sessions.reload();
    tasks.reload();
  });

  /** Sends what was typed: a question for another model if it starts with /ask-, otherwise to the agent. */
  const send = async (text: string): Promise<boolean> => {
    const command = advisorCommand(text);
    if (!command) return steering ? steer.run(text) : submit.run(text);
    if (command.question === '') {
      setAskError(`/ask-${command.advisor} 뒤에 질문을 적어 주세요.`);
      return false;
    }
    // Not awaited: the answer can take a minute, and the composer should stay free for the agent meanwhile.
    setAsking(command.advisor);
    setAskError(null);
    const taskId = selected?.id;
    backend
      .call('advisor.ask', { projectId: project.id, advisor: command.advisor, question: command.question, ...(taskId ? { taskId } : {}) })
      .then(
        // With a task selected the answer arrives in that task's event stream; without one it is kept here.
        (reply) => (taskId ? undefined : setAdvice((prev) => [...prev, { advisor: reply.advisor, question: command.question, answer: reply.answer, ok: true, durationMs: reply.durationMs }])),
        (err: unknown) => setAskError(errorText(err)),
      )
      .finally(() => setAsking(null));
    return true;
  };

  const TemplateIcon = project.template === 'mobile-expo' ? Smartphone : Globe;
  const tabs: readonly { id: TabId; label: string; icon: typeof Monitor }[] = [
    { id: 'preview', label: '프리뷰', icon: project.template === 'mobile-expo' ? Smartphone : Monitor },
    { id: 'files', label: '파일', icon: FolderTree },
    { id: 'terminal', label: '터미널', icon: SquareTerminal },
    { id: 'history', label: '시점', icon: HistoryIcon },
    { id: 'audit', label: '감사', icon: ScanEye },
    { id: 'proposals', label: '제안', icon: Sparkles },
    { id: 'learning', label: '학습', icon: Lightbulb },
  ];
  const panel = (id: TabId): ReactNode => {
    switch (id) {
      case 'preview':
        return <Preview project={project} busy={busy} ready={ready} />;
      case 'files':
        return <FileTree project={project} openPath={openFile} />;
      case 'terminal':
        return (
          <Suspense fallback={null}>
            <InteractiveTerminal project={project} visible={tab === 'terminal' && pane === 'work'} />
          </Suspense>
        );
      case 'history':
        return (
          <History
            project={project}
            focus={focus}
            onFork={(branch) => {
              setFork(branch);
              setPane('chat');
            }}
          />
        );
      case 'audit':
        return (
          <Audit
            project={project}
            onTaskStarted={(task) => {
              // A redesign runs in the project's default stream: go there and open it.
              setPicked((prev) => ({ ...prev, [DEFAULT_SESSION]: task.id }));
              pickSession(null);
              tasks.reload();
              setPane('chat');
            }}
          />
        );
      case 'proposals':
        return <Proposals project={project} />;
      case 'learning':
        return <Learning project={project} />;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TitlebarSpace />
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2">
        <TemplateIcon className="size-5 shrink-0 text-fg-muted" aria-hidden />
        <h1 className="min-w-0 text-lg font-semibold">
          {renaming ? (
            <InlineName value={project.name} label="프로젝트 이름" maxLength={80} className="text-lg font-semibold" onCommit={(name) => (setRenaming(false), void rename.run(name))} onCancel={() => setRenaming(false)} />
          ) : (
            <button type="button" onClick={() => setRenaming(true)} title="눌러서 이름 변경" className="line-clamp-1 min-h-9 pointer-coarse:min-h-11 break-all rounded-md px-1 text-left hover:bg-sunken">
              {project.name}
            </button>
          )}
        </h1>
        <span className="hidden text-sm text-fg-muted md:inline">{templateLabel[project.template]}</span>
        {sandbox.data ? <Status tone={sandbox.data.state === 'running' ? 'good' : 'neutral'}>{sandboxLabel[sandbox.data.state]}</Status> : null}
        <div className="ml-auto flex items-center gap-2">
          <div className="pane-switch">
            <Segmented compact label="보이는 영역" value={pane} options={PANES} onChange={setPane} />
          </div>
          <Menu
            trigger={
              <IconButton label="프로젝트 설정">
                <MoreHorizontal className="size-5" aria-hidden />
              </IconButton>
            }
          >
            <MenuItem onSelect={() => setRenaming(true)} icon={<Pencil className="size-4" aria-hidden />}>
              이름 변경
            </MenuItem>
            <MenuItem onSelect={() => void restart.run()} disabled={restart.busy} icon={<RotateCw className="size-4" aria-hidden />}>
              샌드박스 재기동
            </MenuItem>
            <MenuSeparator />
            <MenuItem danger onSelect={() => setDeleting(true)} icon={<Trash2 className="size-4" aria-hidden />}>
              프로젝트 삭제
            </MenuItem>
          </Menu>
        </div>
      </header>
      {rename.error ?? restart.error ?? tasks.error ? <Problem>{rename.error ?? restart.error ?? tasks.error}</Problem> : null}

      <div className="workbench" data-pane={pane}>
        <section className="pane-chat flex flex-col border-border lg:border-r" aria-label="에이전트와의 대화">
          <SessionTabs
            sessions={sessionList}
            current={session}
            busy={(id) => bySession(id).some((t) => live(t.state))}
            onSelect={pickSession}
            onCreate={(name) => void addSession.run(name)}
            onRename={(id, name) => void renameSession.run(id, name)}
            onClose={(id) => void closeSession.run(id)}
            error={addSession.error ?? renameSession.error ?? closeSession.error}
          />
          {/* Every session that has been opened stays mounted behind the current one, so each keeps its scroll position. */}
          <div className="relative min-h-0 flex-1">
            {[null, ...sessionList.map((s) => s.id)]
              .filter((id) => seen.has(id ?? DEFAULT_SESSION))
              .map((id) => {
                const mine = bySession(id);
                const current = id === session;
                return (
                  <SessionStream
                    key={id ?? DEFAULT_SESSION}
                    visible={current}
                    loaded={tasks.data !== undefined}
                    tasks={mine}
                    selected={current ? selected : (mine.find((t) => t.id === picked[id ?? DEFAULT_SESSION]) ?? mine.at(-1) ?? null)}
                    pending={pending}
                    asking={current ? asking : null}
                    advice={current ? advice : []}
                    onPick={(taskId) => setPicked((prev) => ({ ...prev, [id ?? DEFAULT_SESSION]: taskId }))}
                    onShow={show}
                    onCheckpoint={(checkpointId) => (setFocus(checkpointId), show('history'))}
                    onFile={(path) => (setOpenFile(path), show('files'))}
                    onBuild={(as) => void submit.run(BUILD_FROM_DESIGN, { kind: 'build', track: as })}
                  />
                );
              })}
          </div>
          <Composer
            key={steering ? 'steer' : 'submit'}
            draft={{ value: drafts[key] ?? '', onChange: (value) => setDrafts((prev) => ({ ...prev, [key]: value })) }}
            placeholder={steering ? '진행 중인 작업에 한마디' : fork ? '이 갈래에서 이어서 할 일' : '다음에 할 일'}
            sendLabel={steering ? '작업에 전달' : '작업 시작'}
            onSend={send}
            error={steer.error ?? submit.error ?? cancel.error ?? askError}
            above={
              steering ? (
                <p className="px-3 pt-1 text-sm text-fg-muted">작업은 멈추지 않습니다. 보낸 말은 다음 차례에 함께 읽힙니다.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border pb-2">
                  <Segmented compact label="작업 종류" value={kind} options={KINDS} onChange={setKind} />
                  <Segmented compact label="검증 범위" value={track} options={TRACKS} onChange={setTrackChoice} />
                  {engines.length > 2 ? (
                    <Menu
                      align="start"
                      trigger={
                        <button type="button" className="inline-flex min-h-9 pointer-coarse:min-h-11 items-center gap-1 rounded-md px-3 text-sm font-medium text-fg-muted hover:bg-sunken hover:text-fg">
                          엔진: {engines.find((e) => e.id === engine)?.label ?? '자동'}
                          <ChevronDown className="size-4" aria-hidden />
                        </button>
                      }
                    >
                      {engines.map((e) => (
                        <MenuItem key={e.id} onSelect={() => setEngine(e.id)}>
                          {e.label}
                        </MenuItem>
                      ))}
                    </Menu>
                  ) : null}
                  {fork ? (
                    <span className="flex items-center gap-1 pl-2 text-sm font-medium text-accent">
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
              <>
                <Menu
                  trigger={
                    <IconButton label="다른 모델에게 의견 묻기 (/ask-codex, /ask-gemini)">
                      <MessageCircleQuestion className="size-5" aria-hidden />
                    </IconButton>
                  }
                >
                  {(['codex', 'gemini'] as const).map((advisor) => (
                    <MenuItem key={advisor} onSelect={() => setDrafts((prev) => ({ ...prev, [key]: `/ask-${advisor} ${(prev[key] ?? '').replace(/^\/ask-\w+\s*/, '')}` }))}>
                      {advisorName[advisor]}에게 묻기
                    </MenuItem>
                  ))}
                </Menu>
                {steering ? (
                  <IconButton label="작업 중단" disabled={cancel.busy} onClick={() => void cancel.run()}>
                    <Square className="size-4" aria-hidden />
                  </IconButton>
                ) : null}
              </>
            }
          />
        </section>

        <Tabs.Root value={tab} onValueChange={(next) => show(next as TabId)} className="pane-work flex flex-col" aria-label="작업공간">
          <Tabs.List className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2" aria-label="작업공간 탭">
            {tabs.map(({ id, label, icon: Icon }) => (
              <Tabs.Trigger key={id} value={id} className="inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-fg-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg">
                <Icon className="size-4" aria-hidden />
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {/* A tab is built the first time it is opened and then kept: the terminal's shell and the file tree's state survive a look at another tab. */}
          {tabs
            .filter(({ id }) => visited.has(id))
            .map(({ id }) => (
              <Tabs.Content key={id} value={id} forceMount className="pane-scroll flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
                {panel(id)}
              </Tabs.Content>
            ))}
        </Tabs.Root>
      </div>

      <DeleteProjectModal
        project={deleting ? project : null}
        onOpenChange={setDeleting}
        onDeleted={() => {
          onChanged();
          onOpen({ kind: 'home' });
        }}
      />
    </div>
  );
}

/** The sessions of a project as tabs: the default stream, each named one, and a way to start another. */
function SessionTabs({ sessions, current, busy, onSelect, onCreate, onRename, onClose, error }: { sessions: Session[]; current: string | null; busy: (id: string | null) => boolean; onSelect: (id: string | null) => void; onCreate: (name: string) => void; onRename: (id: string, name: string) => void; onClose: (id: string) => void; error: string | null }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const tab = (id: string | null, name: string): ReactNode => (
    <button type="button" role="tab" aria-selected={current === id} onClick={() => onSelect(id)} className={`inline-flex min-h-9 pointer-coarse:min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium ${current === id ? 'bg-sunken text-fg' : 'text-fg-muted hover:text-fg'}`}>
      {busy(id) ? <span className="thinking-mark size-2 shrink-0 rounded-full bg-accent" aria-label="작업 진행 중" /> : null}
      {name}
    </button>
  );
  return (
    <div className="flex shrink-0 flex-col border-b border-border">
      <div role="tablist" aria-label="작업 세션" className="flex items-center gap-1 overflow-x-auto px-2 py-1">
        {tab(null, '기본')}
        {sessions.map((s) =>
          editing === s.id ? (
            <InlineName key={s.id} value={s.name} label="세션 이름" maxLength={60} className="w-40 text-sm" onCommit={(name) => (setEditing(null), onRename(s.id, name))} onCancel={() => setEditing(null)} />
          ) : (
            <span key={s.id} className="flex shrink-0 items-center">
              {tab(s.id, s.name)}
              {current === s.id ? (
                <Menu
                  align="start"
                  trigger={
                    <button type="button" aria-label={`${s.name} 세션 메뉴`} className="inline-flex size-9 pointer-coarse:size-11 items-center justify-center rounded-md text-fg-muted hover:bg-sunken hover:text-fg">
                      <ChevronDown className="size-4" aria-hidden />
                    </button>
                  }
                >
                  <MenuItem onSelect={() => setEditing(s.id)} icon={<Pencil className="size-4" aria-hidden />}>
                    이름 변경
                  </MenuItem>
                  <MenuItem onSelect={() => onClose(s.id)} icon={<X className="size-4" aria-hidden />}>
                    세션 닫기 (작업은 기본으로 이동)
                  </MenuItem>
                </Menu>
              ) : null}
            </span>
          ),
        )}
        {adding ? (
          <InlineName value="" label="새 세션 이름" maxLength={60} className="w-40 text-sm" onCommit={(name) => (setAdding(false), onCreate(name))} onCancel={() => setAdding(false)} />
        ) : (
          <IconButton label="새 세션" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden />
          </IconButton>
        )}
      </div>
      {error ? <Problem>{error}</Problem> : null}
    </div>
  );
}

/** One session's task stream, in its own scrolling layer. */
function SessionStream({ visible, loaded, tasks, selected, pending, asking, advice, onPick, onShow, onCheckpoint, onFile, onBuild }: { visible: boolean; loaded: boolean; tasks: Task[]; selected: Task | null; pending: Approval[]; asking: AdvisorId | null; advice: Advice[]; onPick: (taskId: string) => void; onShow: (tab: TabId) => void; onCheckpoint: (checkpointId: string) => void; onFile: (path: string) => void; onBuild: (track: TaskTrack) => void }) {
  const events = useTaskEvents(selected?.id ?? null);
  const items = useMemo(() => narrate(events), [events]);
  const scroll = useStickToEnd(`${selected?.id}:${events.length}:${selected?.state}:${asking}:${advice.length}`);
  return (
    <div ref={scroll} className={`pane-scroll absolute inset-0 ${visible ? '' : 'invisible'}`} aria-hidden={!visible}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
        {loaded && tasks.length === 0 ? (
          <div className="flex flex-col gap-2 py-6">
            <h2 className="text-lg font-semibold">아직 아무것도 만들지 않았습니다</h2>
            <p className="text-base text-fg-muted">아래에 만들 것을 적으면 질문 없이 바로 시작합니다. 오른쪽 프리뷰에서 돌아가는 화면을 보며 고쳐 나가면 됩니다.</p>
          </div>
        ) : null}
        {tasks.map((task) =>
          task.id === selected?.id ? (
            <Passage key={task.id} task={task} items={items} pending={pending} onShow={onShow} onCheckpoint={onCheckpoint} onFile={onFile} onBuild={onBuild} />
          ) : (
            <button key={task.id} type="button" onClick={() => onPick(task.id)} className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-border px-4 py-2 text-left hover:bg-sunken">
              <span className="line-clamp-1 min-w-0 flex-1 break-all text-base">{task.prompt.split('\n')[0]}</span>
              <Status tone={stateTone[task.state]}>{taskStateLabel[task.state]}</Status>
            </button>
          ),
        )}
        {advice.map((a, i) => (
          <AdvisorCard key={i} {...a} />
        ))}
        {asking ? <Working>{advisorName[asking]}에게 묻는 중</Working> : null}
      </div>
    </div>
  );
}

function Working({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-3 px-1 py-2 text-sm text-fg-muted" aria-live="polite">
      <span className="thinking-mark size-2 shrink-0 rounded-full bg-accent" aria-hidden />
      {children}
    </p>
  );
}

/** Something the owner wrote: the request, or a word to a running task. */
function Said({ meta, children, clamp = false }: { meta: string; children: string; clamp?: boolean }) {
  const long = clamp && children.length > 320;
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-sunken px-4 py-3">
      <span className="text-sm text-fg-muted">{meta}</span>
      <p className={`whitespace-pre-wrap break-words text-base ${long && !open ? 'line-clamp-3' : ''}`}>{children}</p>
      {long ? (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-h-9 pointer-coarse:min-h-11 text-sm font-medium text-accent underline underline-offset-4">
          {open ? '접기' : '전체 보기'}
        </button>
      ) : null}
    </div>
  );
}

/** What the agent said at the end of a round. A long message folds to its first lines: the steps above already say what was done. */
function AgentWords({ text }: { text: string }) {
  const long = text.length > 700;
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2 px-1">
      <div className={`[&>div]:text-base ${long && !open ? 'max-h-40 overflow-hidden' : ''}`}>
        <Markdown source={text} />
      </div>
      {long ? (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-h-9 pointer-coarse:min-h-11 text-sm font-medium text-accent underline underline-offset-4">
          {open ? '접기' : '전체 보기'}
        </button>
      ) : null}
    </div>
  );
}

/** Another model's answer to a question the owner asked. Folded: it is an opinion to weigh, not a step of the work. */
function AdvisorCard({ advisor, question, answer, ok, durationMs }: Advice) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left">
        <MessageCircleQuestion className={`size-4 shrink-0 ${ok ? 'text-accent' : 'text-danger'}`} aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">
            {advisorName[advisor]}의 의견{ok ? '' : ' (답을 받지 못했습니다)'}
          </span>
          <span className="line-clamp-1 break-all text-sm text-fg-muted">{question}</span>
        </span>
        <span className="shrink-0 text-sm text-fg-muted">{duration(durationMs)}</span>
        <ChevronDown className={`size-4 shrink-0 text-fg-muted ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-border bg-bg px-4 py-3">
          <p className="whitespace-pre-wrap break-words text-base text-fg-muted">{question}</p>
          {/* A model's reply is untrusted text: the Markdown renderer builds elements and never injects markup. */}
          {ok ? (
            <div className="[&>div]:text-base">
              <Markdown source={answer} />
            </div>
          ) : (
            <Problem>{answer}</Problem>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** One task, opened out: the request, the steps, what was said, and how it ended. */
function Passage({ task, items, pending, onShow, onCheckpoint, onFile, onBuild }: { task: Task; items: Item[]; pending: Approval[]; onShow: (tab: TabId) => void; onCheckpoint: (checkpointId: string) => void; onFile: (path: string) => void; onBuild: (track: TaskTrack) => void }) {
  const { backend } = useStudio();
  const [merged, setMerged] = useState<string | null>(null);
  const merge = useAction(async () => {
    const result = await backend.call('git.merge', { projectId: task.projectId, branch: task.branch! });
    setMerged(result.into);
  });
  useEffect(() => setMerged(null), [task.id]);
  const requestMeta = [kindLabel[task.kind], task.kind !== 'ideate' && task.track === 'fast' ? '초안' : null, task.origin === 'desktop' ? null : `${task.origin}에서`, stamp(task.createdAt)].filter(Boolean).join(' · ');

  return (
    <article className="flex flex-col gap-3" aria-label={`작업: ${task.prompt.split('\n')[0]}`}>
      <Said meta={requestMeta} clamp>
        {task.prompt}
      </Said>

      {items.map((item, i) => {
        switch (item.kind) {
          case 'steps':
            return <ActionStepper key={i} steps={item.steps} onAudit={() => onShow('audit')} />;
          case 'said':
            return <AgentWords key={i} text={item.text} />;
          case 'steer':
            return (
              <Said key={i} meta={`나 · ${item.delivered ? '전달됨' : '다음 차례에 전달'}`}>
                {item.text}
              </Said>
            );
          case 'denied':
            return (
              <p key={i} className="rounded-lg border border-danger px-4 py-3 text-base">
                정책상 허용하지 않았습니다. {item.reason}
              </p>
            );
          case 'note':
            return (
              <p key={i} className="px-1 text-sm text-fg-muted">
                {item.text}
              </p>
            );
          case 'advisor':
            return <AdvisorCard key={i} {...item} />;
        }
      })}

      {pending.filter((a) => a.taskId === null || a.taskId === task.id).map((approval) => (
        <ApprovalCard key={approval.id} approval={approval} />
      ))}

      {task.state === 'running' || task.state === 'queued' ? (
        <Working>
          {task.state === 'queued' ? '차례를 기다리는 중' : `${task.phase ? phaseLabel[task.phase] : '준비'} 중`}, 토큰 {tokens(task.spentTokens)} / {tokens(task.budgetTokens)}
        </Working>
      ) : null}

      {live(task.state) ? null : (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Status tone={stateTone[task.state]}>{taskStateLabel[task.state]}</Status>
            <span className="text-sm text-fg-muted">
              토큰 {tokens(task.spentTokens)} 사용{task.engine ? `, ${engineLabel[task.engine] ?? task.engine}` : ''}
            </span>
          </div>
          {task.error ? <Problem>{task.error}</Problem> : null}
          {merge.error ? <Problem>{merge.error}</Problem> : null}
          {task.state === 'succeeded' && task.kind === 'ideate' ? (
            <DesignDecision onFile={onFile} onBuild={onBuild} />
          ) : (
            <div className="flex flex-wrap gap-2">
              {task.state === 'succeeded' ? (
                <Button onClick={() => onShow('preview')} icon={<Monitor className="size-4" aria-hidden />}>
                  프리뷰 보기
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
                <Button onClick={() => onCheckpoint(task.baseCheckpointId!)} icon={<HistoryIcon className="size-4" aria-hidden />}>
                  시작 전 시점 보기
                </Button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * The end of a deep-track task: the design is written down, and the next step is the owner's to approve.
 * One click starts the build from those documents; nothing is built until then.
 */
function DesignDecision({ onFile, onBuild }: { onFile: (path: string) => void; onBuild: (track: TaskTrack) => void }) {
  return (
    <div className="flex flex-col gap-3 border-l-4 border-accent pl-4">
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold">설계 문서가 준비됐습니다. 이대로 만들까요?</p>
        <p className="text-base text-fg-muted">문서를 읽어 보고, 고칠 곳이 있으면 아래 입력창에 적어 주세요. 승인하면 이 문서들을 기준으로 구현을 시작합니다.</p>
      </div>
      <ul className="flex flex-col">
        {DESIGN_DOCS.map((doc) => (
          <li key={doc.path} className="max-w-none">
            <button type="button" onClick={() => onFile(doc.path)} className="flex min-h-9 pointer-coarse:min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-sunken">
              <FileText className="size-4 shrink-0 text-fg-muted" aria-hidden />
              <span className="font-medium">{doc.label}</span>
              <span className="break-all font-mono text-fg-muted">{doc.path}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => onBuild('full')}>
          승인하고 구현 시작
        </Button>
        <Button onClick={() => onBuild('fast')}>초안만 먼저 만들기</Button>
      </div>
    </div>
  );
}

/** A decision only the owner can make. The daemon holds the action until one of these is pressed, here or in a messenger. */
function ApprovalCard({ approval }: { approval: Approval }) {
  const { backend } = useStudio();
  const resolve = useAction((decision: 'approve' | 'deny') => backend.call('approvals.resolve', { approvalId: approval.id, decision }));
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-warning bg-surface px-4 py-3">
      <span className="text-sm font-medium text-warning">승인 필요</span>
      <p className="text-base">{approval.summary}</p>
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

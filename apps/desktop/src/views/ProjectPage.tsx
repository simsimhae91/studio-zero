import * as Tabs from '@radix-ui/react-tabs';
import { Check, ChevronDown, ClipboardList, FileDiff, FileText, Film, FolderTree, GitFork, GitMerge, Globe, History as HistoryIcon, KeyRound, Lightbulb, Maximize2, MessageCircleQuestion, Monitor, MoreHorizontal, Pencil, Plus, ReceiptText, RotateCw, ScanEye, Smartphone, Sparkles, Square, SquareTerminal, Star, Trash2, X, Power } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ReviewerPref, type AdvisorId, type Approval, type Project, type ReviewComment, type Session, type Task, type TaskKind, type TaskState, type TaskTrack } from '@studio-zero/protocol';
import { Markdown } from '@studio-zero/ax/react';
import { duration, effortLabel, elapsed, engineLabel, kindLabel, phaseLabel, stamp, subscriptionLabel, taskStateLabel, templateLabel, tokens, upcoming } from '../lib/format.ts';
import { redrawRequest, revisionRequest, type MockupNote } from '../lib/mockups.ts';
import { RIGOR_CHECKS } from '../lib/rigor.ts';
import { advisorCommand, buildRequest, flowLine, measuresLine, mockupName, narrate, type Item, type Mockup } from '../lib/steps.ts';
import { errorText, useAction, useQuery, useStudio, useTaskEvents } from '../lib/studio.tsx';
import { EnginePicker, pickerClass, useEngineChoice } from './enginePicker.tsx';
import { Button, IconButton, Menu, MenuItem, MenuSeparator, Problem, Segmented, Sheet, Status, TitlebarSpace, inputClass } from '../ui.tsx';
import { ActionStepper } from './ActionStepper.tsx';
import { ArtifactImage } from './artifactImage.tsx';
import { ExternalApisModal } from './ExternalApis.tsx';
import { MockupDeskContext, MockupThumb, useMockupDesk, useMockupPages, type MockupDesk } from './mockupDesk.tsx';
import { Composer, useStickToEnd } from './page.tsx';
import { Audit } from './panels/Audit.tsx';
import { Changes } from './panels/Changes.tsx';
import { FileTree } from './panels/FileTree.tsx';
import { History } from './panels/History.tsx';
import { Learning } from './panels/Learning.tsx';
import { PlanReview } from './panels/PlanReview.tsx';
import { Ledger } from './panels/Ledger.tsx';
import { SCREEN_SPEC_FILE, ScreenSpecView, useScreenSpec } from './panels/ScreenSpecView.tsx';
import { Preview } from './panels/Preview.tsx';
import { Proposals } from './panels/Proposals.tsx';
import { DeleteProjectModal, InlineName, restartSandbox } from './projectActions.tsx';
import type { Route } from './Shell.tsx';

// The terminal emulator is the largest thing in the client: fetched when the terminal tab is first opened.
const InteractiveTerminal = lazy(() => import('./panels/InteractiveTerminal.tsx').then((m) => ({ default: m.InteractiveTerminal })));

type TabId = 'preview' | 'plan' | 'changes' | 'files' | 'terminal' | 'history' | 'audit' | 'ledger' | 'proposals' | 'learning';
/** Addresses typed into the reference field: up to three, separated by spaces, commas or new lines. */
const referencesOf = (text: string): string[] => text.split(/[\s,]+/).filter((part) => part !== '').slice(0, 3);
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
const live = (state: TaskState): boolean => state === 'queued' || state === 'running' || state === 'awaiting_approval' || state === 'awaiting_plan_review';
const stateTone = { queued: 'neutral', running: 'active', awaiting_approval: 'warn', awaiting_plan_review: 'warn', suspended: 'warn', parked: 'warn', succeeded: 'good', failed: 'bad', cancelled: 'neutral' } as const;
const sandboxLabel = { running: '샌드박스 실행 중', stopped: '샌드박스 꺼짐', absent: '샌드박스 없음' } as const;

/** The documents a deep-track task leaves behind, and what each is. */
const DESIGN_DOCS: readonly { path: string; label: string }[] = [
  { path: 'docs/prd.md', label: '제품 요구사항 (PRD)' },
  { path: 'docs/architecture.md', label: '구조와 기술 선택' },
  { path: 'docs/erd.md', label: '데이터 모델' },
  { path: 'docs/openapi.yaml', label: 'API 명세' },
];
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
  // The engine and model for the next task: the owner's standing choice, shared with the first page.
  const choice = useEngineChoice();
  // Sending a design back is design work: the same engine and model, at the level remembered for design.
  const designChoice = useEngineChoice('design');
  // 'auto' pairs the reviewer with the engine (never its own vendor); anything else is the owner's pick.
  const [reviewer, setReviewer] = useState<ReviewerPref | 'auto'>('auto');
  const [references, setReferences] = useState('');
  // Off unless the owner turns it on for the next task: the studio drafts first and asks nothing.
  const [reviewPlan, setReviewPlan] = useState(false);
  const core = project.template === 'studio-core';
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [keys, setKeys] = useState(false);
  const [asking, setAsking] = useState<AdvisorId | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [advice, setAdvice] = useState<Advice[]>([]);
  // Comments on a task's code not yet sent, per task: they outlast a look at another tab or another task.
  const [reviewNotes, setReviewNotes] = useState<Record<string, ReviewComment[]>>({});

  const sessionList = sessions.data?.sessions ?? [];
  // A session that was closed elsewhere falls back to the default stream.
  const session = sessionList.some((s) => s.id === sessionId) ? sessionId : null;
  const key = session ?? DEFAULT_SESSION;
  const list = useMemo(() => [...(tasks.data?.tasks ?? [])].sort((a, b) => a.createdAt - b.createdAt), [tasks.data]);
  const bySession = (id: string | null): Task[] => list.filter((t) => (sessionList.some((s) => s.id === t.sessionId) ? t.sessionId : null) === id);
  const inSession = bySession(session);
  const active = inSession.findLast((t) => live(t.state)) ?? null;
  const selected = inSession.find((t) => t.id === picked[key]) ?? active ?? inSession.at(-1) ?? null;
  // A task waiting on its plan is not at work: there is nothing to steer, the plan is answered in its own panel.
  const steering = active !== null && active.state !== 'queued' && active.state !== 'awaiting_plan_review';
  const busy = list.some((t) => t.state === 'running' || t.state === 'awaiting_approval' || t.state === 'awaiting_plan_review');
  // The plan a task is waiting with, or the plan of the task in view if it was one the owner asked to see.
  const planTask = list.findLast((t) => t.state === 'awaiting_plan_review') ?? (selected?.reviewPlan ? selected : null);
  const ready = list.some((t) => t.state === 'succeeded' && t.kind !== 'ideate');
  // A project that started as a draft keeps iterating as one, until the owner asks for the full checks.
  const track = trackChoice ?? list.findLast((t) => t.kind !== 'ideate')?.track ?? 'fast';
  const pending = (approvals.data?.approvals ?? []).filter((a) => a.projectId === project.id);

  const show = (next: TabId): void => {
    setTab(next);
    setVisited((prev) => new Set(prev).add(next));
    setPane('work');
  };
  // A plan that starts waiting for the owner opens in the right-hand pane; the pane goes back to the preview when no plan is left to show.
  const waitingPlan = list.findLast((t) => t.state === 'awaiting_plan_review')?.id ?? null;
  useEffect(() => {
    if (waitingPlan === null) return;
    setTab('plan');
    setVisited((prev) => new Set(prev).add('plan'));
  }, [waitingPlan]);
  const hasPlan = planTask !== null;
  useEffect(() => {
    if (tab === 'plan' && !hasPlan) setTab('preview');
  }, [tab, hasPlan]);
  // The code of the task in view, when it has a branch of its own. A design task's branch holds documents and pages, which are read elsewhere.
  const reviewTask = selected?.branch && selected.kind !== 'ideate' ? selected : null;
  const hasChanges = reviewTask !== null;
  useEffect(() => {
    if (tab === 'changes' && !hasChanges) setTab('preview');
  }, [tab, hasChanges]);
  const pickSession = (id: string | null): void => {
    setSessionId(id);
    setSeen((prev) => new Set(prev).add(id ?? DEFAULT_SESSION));
  };

  const steer = useAction((message: string) => backend.call('tasks.steer', { taskId: active!.id, message }));
  const submit = useAction(async (prompt: string, as: { kind: Kind; track: TaskTrack; baseBranch?: string } = { kind, track }) => {
    // The cross-checks and the reference kit belong to a full build: a draft has neither a plan nor a review.
    const designed = as.kind === 'build' && as.track === 'full';
    const refs = designed && !core ? referencesOf(references) : [];
    const planned = (as.kind === 'build' || as.kind === 'refactor') && as.track === 'full';
    const task = await backend.call('tasks.submit', { projectId: project.id, kind: as.kind, prompt, track: as.track, ...(session ? { sessionId: session } : {}), ...((as.baseBranch ?? fork) ? { baseBranch: (as.baseBranch ?? fork)! } : {}), ...choice.fields, ...(designed && reviewer !== 'auto' ? { reviewer } : {}), ...(refs.length > 0 ? { references: refs } : {}), ...(planned && reviewPlan ? { reviewPlan: true } : {}) });
    setFork(null);
    setReferences('');
    setPicked((prev) => ({ ...prev, [key]: task.id }));
    tasks.reload();
  });
  const cancel = useAction(() => backend.call('tasks.cancel', { taskId: active!.id }));
  /** The same request again, as a new task: what a person does after a failure that was not the request's fault, or a cancel they regret. */
  const rerun = useAction(async (old: Task) => {
    if (old.kind === 'kirby_materialize') return;
    const task = await backend.call('tasks.submit', { projectId: project.id, kind: old.kind, prompt: old.prompt, track: old.track, ...(session ? { sessionId: session } : {}), ...(old.kind === 'ideate' ? designChoice.fields : choice.fields) });
    setPicked((prev) => ({ ...prev, [key]: task.id }));
    tasks.reload();
  });
  /** A past request put back in the field, to send again as it is or changed. */
  const reuse = (prompt: string): void => setDrafts((prev) => ({ ...prev, [key]: prompt }));

  // ---- the design's mock-ups: one choice and one set of notes, shared by the card and the browser pane
  const design = list.findLast((t) => t.kind === 'ideate' && t.state === 'succeeded') ?? null;
  const mockupPages = useMockupPages(project.id, `${design?.id}:${busy}`);
  const [mockupPick, setMockupPick] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState<'app' | 'mockup' | null>(null);
  const [mockupNotes, setMockupNotes] = useState<readonly MockupNote[]>([]);
  const [asked, setAsked] = useState(0);
  // Both ways of sending a design back (notes on it, or "draw them all again") are design work on its branch.
  const revise = useAction(async (prompt: string) => {
    if (prompt === '' || !design?.branch) return;
    // A revision is design work on top of the design: it starts from that task's branch, where the pages are.
    const task = await backend.call('tasks.submit', { projectId: project.id, kind: 'ideate', prompt, track: 'full', baseBranch: design.branch, ...(session ? { sessionId: session } : {}), ...designChoice.fields });
    setMockupNotes([]);
    setPicked((prev) => ({ ...prev, [key]: task.id }));
    setPane('chat');
    tasks.reload();
  });
  const desk: MockupDesk = {
    pages: mockupPages.pages,
    reload: mockupPages.reload,
    designTaskId: design?.id ?? null,
    picked: mockupPick,
    pick: (file) => (setMockupPick(file), setPreviewSource('mockup')),
    view: (file) => (setMockupPick(file), setPreviewSource('mockup'), show('preview')),
    ask: (file) => (setMockupPick(file), setPreviewSource('mockup'), show('preview'), setAsked((n) => n + 1)),
    asked,
    // Until something has been built there is no app to show: the mock-ups are what the pane opens on.
    source: mockupPages.pages.length === 0 ? 'app' : (previewSource ?? (ready ? 'app' : 'mockup')),
    showApp: () => setPreviewSource('app'),
    notes: mockupNotes,
    addNote: (note) => setMockupNotes((prev) => [...prev, note]),
    removeNote: (index) => setMockupNotes((prev) => prev.filter((_, i) => i !== index)),
    revise: (also) => void revise.run(revisionRequest(also ? [...mockupNotes, also] : mockupNotes)),
    redraw: (direction) => void revise.run(redrawRequest(direction)),
    revising: revise.busy,
    reviseError: revise.error,
    canRevise: design?.branch != null && !busy,
  };
  const rename = useAction(async (name: string) => {
    await backend.call('projects.rename', { projectId: project.id, name });
    onChanged();
  });
  const restart = useAction(async () => {
    await restartSandbox(backend, project.id);
    sandbox.reload();
  });
  // Off and on by themselves: a sandbox that is not being used need not keep running, and one that is off can be started without a task.
  const power = useAction(async (on: boolean) => {
    await backend.call(on ? 'sandbox.start' : 'sandbox.stop', { projectId: project.id });
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
        (err: unknown) => {
          setAskError(errorText(err));
          // The field was cleared when the question went out. It did not arrive: put it back, unless something else was typed since.
          setDrafts((prev) => ((prev[key] ?? '') === '' ? { ...prev, [key]: `/ask-${command.advisor} ${command.question}` } : prev));
        },
      )
      .finally(() => setAsking(null));
    return true;
  };

  const TemplateIcon = core ? Star : project.template === 'mobile-expo' ? Smartphone : Globe;
  const available = new Set((status.data?.engines ?? []).filter((e) => e.available).map((e) => e.id));
  // Claude can review through its API key or its subscription; the others through their own CLI.
  const reviewers = [{ id: 'auto' as const, label: '자동 짝꿍' }, ...ReviewerPref.options.filter((id) => available.has(id) || (id === 'claude-code' && available.has('native-claude'))).map((id) => ({ id, label: subscriptionLabel[id] }))];
  const designed = kind === 'build' && track === 'full';
  // Only a full-track build or refactor plans before it codes, so only there is a plan to see first.
  const plans = (kind === 'build' || kind === 'refactor') && track === 'full';
  const tabs: readonly { id: TabId; label: string; icon: typeof Monitor }[] = [
    { id: 'preview', label: '프리뷰', icon: project.template === 'mobile-expo' ? Smartphone : Monitor },
    ...(planTask ? [{ id: 'plan' as const, label: '계획', icon: ClipboardList }] : []),
    ...(reviewTask ? [{ id: 'changes' as const, label: '변경', icon: FileDiff }] : []),
    { id: 'files', label: '파일', icon: FolderTree },
    { id: 'terminal', label: '터미널', icon: SquareTerminal },
    { id: 'history', label: '시점', icon: HistoryIcon },
    { id: 'audit', label: '감사', icon: ScanEye },
    { id: 'ledger', label: '장부', icon: ReceiptText },
    { id: 'proposals', label: '제안', icon: Sparkles },
    { id: 'learning', label: '학습', icon: Lightbulb },
  ];
  const panel = (id: TabId): ReactNode => {
    switch (id) {
      case 'preview':
        return <Preview project={project} busy={busy} ready={ready} />;
      case 'plan':
        return planTask ? <PlanReview key={planTask.id} task={planTask} /> : null;
      case 'changes':
        return reviewTask ? (
          <Changes
            key={reviewTask.id}
            task={reviewTask}
            comments={reviewNotes[reviewTask.id] ?? []}
            onComments={(next) => setReviewNotes((prev) => ({ ...prev, [reviewTask.id]: next }))}
            onDone={(outcome) => {
              setReviewNotes((prev) => ({ ...prev, [reviewTask.id]: [] }));
              if (outcome.mergedInto) rememberMerged(reviewTask.id, outcome.mergedInto);
              // The task that addresses the comments is the one to follow now, in the conversation.
              if (outcome.rerunTaskId) {
                setPicked((prev) => ({ ...prev, [key]: outcome.rerunTaskId! }));
                setPane('chat');
              }
              tasks.reload();
            }}
          />
        ) : null;
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
            busy={busy}
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
      case 'ledger':
        return <Ledger project={project} />;
      case 'proposals':
        return <Proposals project={project} />;
      case 'learning':
        return <Learning project={project} />;
    }
  };

  return (
    <MockupDeskContext.Provider value={desk}>
    <div className="flex min-h-0 flex-1 flex-col">
      <TitlebarSpace />
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2">
        <TemplateIcon className="size-5 shrink-0 text-fg-muted" aria-hidden />
        <h1 className="min-w-0 text-lg font-semibold">
          {core ? (
            <span className="line-clamp-1 break-all px-1">{project.name}</span>
          ) : renaming ? (
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
            {core ? null : (
              <MenuItem onSelect={() => setRenaming(true)} icon={<Pencil className="size-4" aria-hidden />}>
                이름 변경
              </MenuItem>
            )}
            <MenuItem onSelect={() => void restart.run()} disabled={restart.busy} icon={<RotateCw className="size-4" aria-hidden />}>
              샌드박스 재기동
            </MenuItem>
            {sandbox.data?.state === 'running' ? (
              <MenuItem onSelect={() => void power.run(false)} disabled={power.busy || busy} icon={<Power className="size-4" aria-hidden />}>
                샌드박스 끄기
              </MenuItem>
            ) : (
              <MenuItem onSelect={() => void power.run(true)} disabled={power.busy} icon={<Power className="size-4" aria-hidden />}>
                샌드박스 켜기
              </MenuItem>
            )}
            {core ? null : (
              <MenuItem onSelect={() => setKeys(true)} icon={<KeyRound className="size-4" aria-hidden />}>
                외부 API 키
              </MenuItem>
            )}
            {core ? null : (
              <>
                <MenuSeparator />
                <MenuItem danger onSelect={() => setDeleting(true)} icon={<Trash2 className="size-4" aria-hidden />}>
                  프로젝트 삭제
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </header>
      {rename.error ?? restart.error ?? power.error ?? rerun.error ?? tasks.error ? <Problem>{rename.error ?? restart.error ?? power.error ?? rerun.error ?? tasks.error}</Problem> : null}

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
                    onBuild={(as, mockup, from) => void submit.run(buildRequest(mockup), { kind: 'build', track: as, ...(from ? { baseBranch: from } : {}) })}
                    onContinue={setFork}
                    onReuse={reuse}
                    onRerun={(task) => rerun.run(task)}
                    core={core}
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
                  <EnginePicker choice={choice} />
                  {plans ? (
                    <button type="button" aria-pressed={reviewPlan} title="계획과 교차 검토 의견을 먼저 보여 드리고, 승인해야 코드를 씁니다" onClick={() => setReviewPlan((on) => !on)} className={`${pickerClass} ${reviewPlan ? 'bg-sunken text-fg' : ''}`}>
                      {reviewPlan ? <Check className="size-4 text-accent" aria-hidden /> : <ClipboardList className="size-4" aria-hidden />}
                      계획 먼저 보기
                    </button>
                  ) : null}
                  {designed && reviewers.length > 2 ? (
                    <Menu
                      align="start"
                      trigger={
                        <button type="button" title="계획을 한 번, 결과를 한 번 다른 회사의 모델이 봅니다" className={pickerClass}>
                          검수: {reviewers.find((r) => r.id === reviewer)?.label ?? '자동 짝꿍'}
                          <ChevronDown className="size-4" aria-hidden />
                        </button>
                      }
                    >
                      {reviewers.map((r) => (
                        <MenuItem key={r.id} onSelect={() => setReviewer(r.id)}>
                          {r.label}
                        </MenuItem>
                      ))}
                    </Menu>
                  ) : null}
                  {designed && !core ? (
                    <input
                      aria-label="레퍼런스 주소"
                      value={references}
                      onChange={(e) => setReferences(e.target.value)}
                      placeholder="레퍼런스 주소 (https, 3개까지)"
                      inputMode="url"
                      autoCapitalize="none"
                      spellCheck={false}
                      className={`${inputClass} min-h-9 pointer-coarse:min-h-11 min-w-56 max-w-sm flex-1 text-sm`}
                    />
                  ) : null}
                  {/* What the verified track holds this build to, said before it is started: it is why it takes longer than a draft. */}
                  {designed && !core ? (
                    <details className="basis-full px-1 text-sm">
                      <summary className="flex min-h-9 pointer-coarse:min-h-11 cursor-pointer items-center font-medium text-fg-muted hover:text-fg">검증까지 가면 통과해야 하는 것 {RIGOR_CHECKS.length}가지</summary>
                      <dl className="flex flex-col pb-2">
                        {RIGOR_CHECKS.map((check) => (
                          <div key={check.title} className="flex flex-col gap-x-4 border-t border-border py-2 md:flex-row md:items-baseline">
                            <dt className="shrink-0 font-semibold md:w-40">{check.title}</dt>
                            <dd className="min-w-0 text-fg-muted">{check.holds}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
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
                {/* Whatever is in flight can be stopped, a task still waiting its turn included. */}
                {active !== null ? (
                  <IconButton label={active.state === 'queued' ? '대기 중인 작업 취소' : '작업 중단'} disabled={cancel.busy} onClick={() => void cancel.run()}>
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

      <ExternalApisModal project={project} open={keys} onOpenChange={setKeys} />
      <DeleteProjectModal
        project={deleting ? project : null}
        onOpenChange={setDeleting}
        onDeleted={() => {
          onChanged();
          onOpen({ kind: 'home' });
        }}
      />
    </div>
    </MockupDeskContext.Provider>
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
function SessionStream({ visible, loaded, tasks, selected, pending, asking, advice, onPick, onShow, onCheckpoint, onFile, onBuild, onContinue, onReuse, onRerun, core }: { onReuse: (prompt: string) => void; onRerun: (task: Task) => Promise<unknown>; visible: boolean; loaded: boolean; tasks: Task[]; selected: Task | null; pending: Approval[]; asking: AdvisorId | null; advice: Advice[]; onPick: (taskId: string) => void; onShow: (tab: TabId) => void; onCheckpoint: (checkpointId: string) => void; onFile: (path: string) => void; onBuild: (track: TaskTrack, mockup: string | null, from: string | null) => void; onContinue: (branch: string) => void; core: boolean }) {
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
            <Passage key={task.id} task={task} items={items} pending={pending} onShow={onShow} onCheckpoint={onCheckpoint} onFile={onFile} onBuild={onBuild} onContinue={onContinue} onReuse={onReuse} onRerun={onRerun} core={core} />
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

/**
 * How long a running task has been at it, counted from when the daemon started it. It ticks every second, so it
 * is kept out of what a screen reader announces.
 */
/** Which tasks were merged, kept on this device: a task does not say so itself, and the button must not come back after a reload. */
const MERGED_KEY = 'studio-zero.merged';
function mergedInto(taskId: string): string | null {
  try {
    const kept = JSON.parse(localStorage.getItem(MERGED_KEY) ?? '{}') as Record<string, unknown>;
    return typeof kept[taskId] === 'string' ? kept[taskId] : null;
  } catch {
    return null;
  }
}
function rememberMerged(taskId: string, into: string): void {
  try {
    const kept = JSON.parse(localStorage.getItem(MERGED_KEY) ?? '{}') as Record<string, string>;
    localStorage.setItem(MERGED_KEY, JSON.stringify(Object.fromEntries([...Object.entries(kept).slice(-199), [taskId, into]])));
  } catch {
    // Storage refused: the button comes back after a reload, and merging again changes nothing.
  }
}

/** How long an approval has left, counted down where the decision is made. */
function Remaining({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = until - now;
  return <span className="text-sm text-fg-muted">{left <= 0 ? '시간이 지났습니다. 곧 닫힙니다.' : `${elapsed(left)} 안에 정하지 않으면 거절로 닫힙니다`}</span>;
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span aria-live="off">, {elapsed(now - since)} 경과</span>;
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
function Passage({ task, items, pending, onShow, onCheckpoint, onFile, onBuild, onContinue, onReuse, onRerun, core }: { onReuse: (prompt: string) => void; onRerun: (task: Task) => Promise<unknown>; task: Task; items: Item[]; pending: Approval[]; onShow: (tab: TabId) => void; onCheckpoint: (checkpointId: string) => void; onFile: (path: string) => void; onBuild: (track: TaskTrack, mockup: string | null, from: string | null) => void; onContinue: (branch: string) => void; core: boolean }) {
  const { backend } = useStudio();
  const [merged, setMerged] = useState<string | null>(() => mergedInto(task.id));
  // Drawn once at the end of a design task; a re-run draws again, and the latest set is the one on offer.
  const mockups = items.findLast((item) => item.kind === 'mockups')?.options ?? [];
  // Shown from the first page the engine has measured, long before the task ends.
  const drafts = items.find((item) => item.kind === 'drafts')?.options ?? [];
  const merge = useAction(async () => {
    const result = await backend.call('git.merge', { projectId: task.projectId, branch: task.branch! });
    rememberMerged(task.id, result.into);
    setMerged(result.into);
  });
  const resume = useAction(() => backend.call('tasks.resume', { taskId: task.id }));
  const drop = useAction(() => backend.call('tasks.cancel', { taskId: task.id }));
  const again = useAction(() => onRerun(task));
  useEffect(() => setMerged(mergedInto(task.id)), [task.id]);
  const requestMeta = [kindLabel[task.kind], task.kind !== 'ideate' && task.track === 'fast' ? '초안' : null, task.origin === 'desktop' ? null : `${task.origin}에서`, stamp(task.createdAt)].filter(Boolean).join(' · ');

  return (
    <article className="flex flex-col gap-3" aria-label={`작업: ${task.prompt.split('\n')[0]}`}>
      <Said meta={requestMeta} clamp>
        {task.prompt}
      </Said>
      {/* A request is worth having back: to send again after a failure, or changed. */}
      <button type="button" onClick={() => onReuse(task.prompt)} className="-mt-1 min-h-9 pointer-coarse:min-h-11 self-start px-1 text-sm font-medium text-fg-muted underline underline-offset-4 hover:text-fg">
        이 요청을 입력창으로 가져오기
      </button>

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
          case 'mockups':
            // Shown on the card that ends the task, where the choice is made.
            return null;
          case 'drafts':
            // Shown below, beside what the task is doing now.
            return null;
        }
      })}

      {pending.filter((a) => a.taskId === null || a.taskId === task.id).map((approval) => (
        <ApprovalCard key={approval.id} approval={approval} />
      ))}

      {drafts.length > 0 ? <DraftMockups mockups={drafts} running={live(task.state)} /> : null}

      {task.state === 'running' || task.state === 'queued' ? (
        <Working>
          {task.state === 'queued' ? '차례를 기다리는 중' : `${task.phase ? phaseLabel[task.phase] : '준비'} 중`}
          {task.state === 'running' && task.startedAt !== null ? <Elapsed since={task.startedAt} /> : null}, 토큰 {tokens(task.spentTokens)} / {tokens(task.budgetTokens)}
        </Working>
      ) : null}
      {task.state === 'awaiting_plan_review' ? (
        <div className="flex flex-col gap-3 rounded-lg border border-warning bg-surface px-4 py-3">
          <span className="text-sm font-medium text-warning">계획 검토 대기</span>
          <p className="text-base">계획이 나왔습니다. 승인 전에는 코드를 쓰지 않습니다.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => onShow('plan')} icon={<ClipboardList className="size-4" aria-hidden />}>
              계획 보기
            </Button>
            <Button busy={drop.busy} onClick={() => void drop.run()} icon={<Square className="size-4" aria-hidden />}>
              작업 중단
            </Button>
          </div>
          {drop.error ? <Problem>{drop.error}</Problem> : null}
        </div>
      ) : null}
      {/* Stopped from the task itself, where it says it is running or waiting: not only from the field below. */}
      {task.state === 'running' || task.state === 'queued' ? (
        <div className="flex flex-col items-start gap-2 px-1">
          <Button busy={drop.busy} onClick={() => void drop.run()} icon={<Square className="size-4" aria-hidden />}>
            {task.state === 'queued' ? '대기 중인 작업 취소' : '작업 중단'}
          </Button>
          {drop.error ? <Problem>{drop.error}</Problem> : null}
        </div>
      ) : null}

      {live(task.state) ? null : (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Status tone={stateTone[task.state]}>{taskStateLabel[task.state]}</Status>
            <span className="text-sm text-fg-muted">
              {[
                `토큰 ${tokens(task.spentTokens)} 사용`,
                // 'default' is the CLI's own setting: there is no name to show for it.
                task.engine ? [engineLabel[task.engine] ?? task.engine, task.model && task.model !== 'default' ? task.model : null, task.effort ? `추론 ${effortLabel[task.effort] ?? task.effort}` : null].filter(Boolean).join(' · ') : null,
                task.startedAt !== null && task.finishedAt !== null ? `${elapsed(task.finishedAt - task.startedAt)} 걸림` : null,
              ]
                .filter(Boolean)
                .join(', ')}
            </span>
          </div>
          {task.error ? <Problem>{task.error}</Problem> : null}
          {(merge.error ?? resume.error ?? drop.error ?? again.error) ? <Problem>{merge.error ?? resume.error ?? drop.error ?? again.error}</Problem> : null}
          {task.state === 'suspended' ? (
            <div className="flex flex-col gap-3 border-l-4 border-warning pl-4">
              <div className="flex flex-col gap-1">
                <p className="text-base font-semibold">디자인 심사를 기다리는 중입니다</p>
                <p className="text-base text-fg-muted">
                  만든 것은 브랜치에 저장했고 다른 검사는 모두 통과했습니다. 심사를 맡길 구독이 전부 사용 한도에 걸려 세워 뒀습니다. 한도가 풀리면 자동으로 이어서 심사받고, 그동안 이 프로젝트에서 다른 작업을 시작할 수 있습니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button busy={resume.busy} onClick={() => void resume.run()} icon={<RotateCw className="size-4" aria-hidden />}>
                  지금 다시 시도
                </Button>
                <Button onClick={() => onShow('audit')} icon={<ScanEye className="size-4" aria-hidden />}>
                  감사 결과 보기
                </Button>
                <Button variant="danger" busy={drop.busy} onClick={() => void drop.run()}>
                  작업 취소
                </Button>
              </div>
            </div>
          ) : task.state === 'parked' ? (
            <div className="flex flex-col gap-3 border-l-4 border-warning pl-4">
              <div className="flex flex-col gap-1">
                <p className="text-base font-semibold">사용 한도가 풀리기를 기다리는 중입니다</p>
                <p className="text-base text-fg-muted">
                  이 작업을 돌리던 구독이 사용 한도에 걸려 세워 뒀습니다. {task.parkedUntil === null ? '한도가 풀리면' : `${upcoming(task.parkedUntil)}에`} 자동으로 다시 시작합니다.{' '}
                  {task.kind === 'ideate' ? '기획 문서는 처음부터 다시 씁니다.' : '멈추기 전까지 한 것은 브랜치에 저장했고, 하던 데서 이어 갑니다.'} 그동안 이 프로젝트에서 다른 작업을 시작할 수 있습니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" busy={drop.busy} onClick={() => void drop.run()}>
                  작업 취소
                </Button>
              </div>
            </div>
          ) : task.state === 'succeeded' && task.kind === 'ideate' ? (
            <DesignDecision task={task} mockups={mockups} onFile={onFile} onBuild={(track, mockup) => onBuild(track, mockup, task.branch)} />
          ) : core && task.state === 'succeeded' ? (
            <CoreHandover task={task} onReview={() => onShow('changes')} />
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
              {/* Asking for changes in words still works from the field below; this pins them to lines of the code. */}
              {(task.state === 'succeeded' || task.state === 'failed') && task.branch && !merged ? (
                <Button onClick={() => onShow('changes')} icon={<FileDiff className="size-4" aria-hidden />}>
                  줄에 코멘트 달기
                </Button>
              ) : null}
              {/* A failed task's work is committed on its branch. The next task can start from there instead of from scratch. */}
              {task.state === 'failed' && task.branch ? (
                <Button variant="primary" onClick={() => onContinue(task.branch!)} icon={<GitFork className="size-4" aria-hidden />}>
                  이 작업물에서 이어가기
                </Button>
              ) : null}
              {(task.state === 'failed' || task.state === 'cancelled') && task.kind !== 'kirby_materialize' ? (
                <Button busy={again.busy} onClick={() => void again.run()} icon={<RotateCw className="size-4" aria-hidden />}>
                  같은 요청 다시 실행
                </Button>
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
 * The end of a task on the studio's own repository. Its branch has been copied to this Mac's checkout as a
 * feature branch; nothing is merged until the owner, having read it, says so here.
 */
function CoreHandover({ task, onReview }: { task: Task; onReview: () => void }) {
  const { backend } = useStudio();
  const status = useQuery('selfhost.status', {}, ['selfhost.exported', 'selfhost.merged']);
  const [merged, setMerged] = useState<string | null>(null);
  const merge = useAction(async () => {
    const result = await backend.call('selfhost.merge', { taskId: task.id });
    setMerged(result.into);
    status.reload();
  });
  const branch = status.data?.pending.find((p) => p.taskId === task.id);
  if (merged) return <Status tone="good">{merged}에 합쳤습니다</Status>;
  if (!branch) return status.data ? <p className="text-base text-fg-muted">넘겨받을 브랜치가 없습니다. 이미 합쳤거나, 이 작업이 바꾼 파일이 없습니다.</p> : null;
  return (
    <div className="flex flex-col gap-3 border-l-4 border-accent pl-4">
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold">Studio Zero 자체 기능 브랜치를 확인하고 머지하시겠습니까?</p>
        <p className="text-base text-fg-muted">
          이 Mac의 저장소에 <code className="break-all font-mono text-sm">{branch.branch}</code> 브랜치가 생겼습니다. 파일 {branch.files}개, +{branch.insertions} −{branch.deletions}. {status.data?.baseBranch}는 그대로입니다.
        </p>
        <code className="break-all font-mono text-sm text-fg-muted">
          git diff {status.data?.baseBranch}...{branch.branch}
        </code>
      </div>
      {merge.error ? <Problem>{merge.error}</Problem> : null}
      {status.data?.clean === false ? <p className="text-sm text-fg-muted">저장소에 커밋하지 않은 변경이 있으면 머지를 받지 않습니다.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" busy={merge.busy} onClick={() => void merge.run()} icon={<GitMerge className="size-4" aria-hidden />}>
          {status.data?.baseBranch}에 머지
        </Button>
        <Button onClick={onReview} icon={<FileDiff className="size-4" aria-hidden />}>
          줄에 코멘트 달기
        </Button>
      </div>
    </div>
  );
}

/**
 * The end of a deep-track task: the design is written down and its directions are drawn, and the next step is
 * the owner's. They pick a direction by looking at it, send it back with notes if it is not there yet, and
 * start the build from the documents and that page when it is. Nothing is built until then.
 *
 * The pictures are the pages themselves, live, at a phone's width; the browser pane beside the conversation
 * shows the chosen one at full size, as a phone, a tablet or a desktop. An earlier design's card, or one whose
 * pages are no longer in the workspace, falls back to the pictures taken when it finished.
 */
function DesignDecision({ task, mockups, onFile, onBuild }: { task: Task; mockups: Mockup[]; onFile: (path: string) => void; onBuild: (track: TaskTrack, mockup: string | null) => void }) {
  const desk = useMockupDesk();
  const current = desk.designTaskId === task.id;
  // The first page is the direction the documents argue for, so it starts chosen.
  const pick = mockups.find((m) => m.file === desk.picked) ?? mockups[0] ?? null;
  const drawn = mockups.length > 0;
  // Drawing them all again is a whole design pass on the owner's subscription: asked for in two steps.
  const [redrawing, setRedrawing] = useState(false);
  const [direction, setDirection] = useState('');
  // The walk of one mock-up as pictures, and the screen spec as a document: each opens beside the card.
  const [film, setFilm] = useState<Mockup | null>(null);
  const [reading, setReading] = useState(false);
  const spec = useScreenSpec(task.projectId, `${task.id}:${task.state}`);
  const walked = mockups.some((m) => m.flow);
  return (
    <div className="@container flex flex-col gap-3 border-l-4 border-accent pl-4">
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold">{drawn ? `설계 문서와 첫 화면 시안 ${mockups.length}개가 준비됐습니다. 어느 안으로 만들까요?` : '설계 문서가 준비됐습니다. 이대로 만들까요?'}</p>
        <p className="text-base text-fg-muted">
          {drawn
            ? `시안마다 구성이 다릅니다. 하나를 눌러 옆 프리뷰에 띄우고 직접 조작해 보세요.${walked ? ' 시안 아래 숫자는 QA 브라우저가 같은 핵심 흐름을 눌러 보며 센 값입니다.' : ''} 고칠 곳은 프리뷰에서 요소를 골라 적어 보내세요.`
            : '문서를 읽어 보고, 승인하면 이 문서들을 기준으로 구현을 시작합니다.'}
        </p>
      </div>
      {drawn ? (
        <div role="group" aria-label="첫 화면 시안" className={`grid grid-cols-2 gap-3 ${mockups.length > 2 ? '@xl:grid-cols-3' : ''}`}>
          {mockups.map((m, i) => {
            const on = m.file === pick?.file;
            const page = current ? desk.pages.find((p) => p.file === m.file) : undefined;
            return (
              <div key={m.file} className={`flex flex-col rounded-lg border bg-surface ${on ? 'border-accent' : 'border-border'}`}>
                <button type="button" aria-pressed={on} onClick={() => desk.pick(m.file)} className="flex flex-1 flex-col gap-2 rounded-lg p-2 text-left">
                  {page ? <MockupThumb html={page.html} label={`${mockupName(m.file)} 첫 화면 시안`} /> : <MockupImage mockup={m} className="w-full rounded-md border border-border" />}
                  <span className="flex items-center gap-2">
                    <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${on ? 'border-accent bg-accent text-on-accent' : 'border-control-border'}`} aria-hidden>
                      {on ? <Check className="size-3" /> : null}
                    </span>
                    <span className="text-sm font-semibold">
                      {mockupName(m.file)}
                      {i === 0 ? ' · 문서의 추천' : ''}
                    </span>
                  </span>
                  {/* The page's own title and description: a model's words, shown as text. */}
                  <span className="break-words text-sm font-medium">{m.title}</span>
                  {m.idea ? <span className="break-words text-sm text-fg-muted">{m.idea}</span> : null}
                  {/* What the daemon counted on this page: the way it works, as numbers that can be set side by side. */}
                  {m.flow ? <Measured {...flowLine(m.flow)} /> : null}
                  {m.measures ? <Measured {...measuresLine(m.measures)} /> : null}
                </button>
                <button type="button" onClick={() => desk.view(m.file)} className="flex min-h-9 pointer-coarse:min-h-11 items-center gap-2 border-t border-border px-3 text-sm text-fg-muted hover:bg-sunken">
                  <Maximize2 className="size-4 shrink-0" aria-hidden />
                  프리뷰에서 눌러 보기
                </button>
                {m.flow?.filmArtifactId ? (
                  <button type="button" onClick={() => setFilm(m)} className="flex min-h-9 pointer-coarse:min-h-11 items-center gap-2 border-t border-border px-3 text-sm text-fg-muted hover:bg-sunken">
                    <Film className="size-4 shrink-0" aria-hidden />
                    브라우저가 눌러 본 장면
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <ul className="flex flex-col">
        <li className="max-w-none">
          <button type="button" onClick={() => (spec ? setReading(true) : onFile(SCREEN_SPEC_FILE))} className="flex min-h-9 pointer-coarse:min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-sunken">
            <FileText className="size-4 shrink-0 text-fg-muted" aria-hidden />
            <span className="font-medium">화면 명세{spec ? ` (화면 ${spec.screens.length}개, 핵심 흐름 ${spec.tasks.length}단계)` : ''}</span>
            <code className="break-all text-fg-muted">{SCREEN_SPEC_FILE}</code>
          </button>
        </li>
        {DESIGN_DOCS.map((doc) => (
          <li key={doc.path} className="max-w-none">
            <button type="button" onClick={() => onFile(doc.path)} className="flex min-h-9 pointer-coarse:min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-sunken">
              <FileText className="size-4 shrink-0 text-fg-muted" aria-hidden />
              <span className="font-medium">{doc.label}</span>
              <code className="break-all text-fg-muted">{doc.path}</code>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => onBuild('full', pick?.file ?? null)}>
          {pick ? `${mockupName(pick.file)}으로 승인하고 구현 시작` : '승인하고 구현 시작'}
        </Button>
        <Button onClick={() => onBuild('fast', pick?.file ?? null)}>초안만 먼저 만들기</Button>
        {pick && current ? <Button onClick={() => desk.ask(pick.file)}>시안 수정 요청</Button> : null}
        {drawn && current && !redrawing ? <Button onClick={() => setRedrawing(true)}>전부 새로 그리기</Button> : null}
      </div>
      {redrawing ? (
        <form
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
          onSubmit={(e) => {
            e.preventDefault();
            desk.redraw(direction);
            setRedrawing(false);
            setDirection('');
          }}
        >
          <p className="text-base">
            <span className="font-semibold">시안을 전부 새로 그립니다.</span>
            <span className="text-fg-muted"> 지금 시안은 버리고 세 방향을 처음부터 다시 잡습니다. 원하는 방향이 있으면 적어 주세요. 비워 두면 알아서 새로 찾습니다.</span>
          </p>
          {/* A steer can run to a sentence or two: it wraps instead of scrolling out of sight. */}
          <textarea aria-label="새로 그릴 방향" rows={2} className={`${inputClass} resize-none py-2`} value={direction} maxLength={500} placeholder="예: 상대와 겨루는 장면이 주인이 되게" onChange={(e) => setDirection(e.target.value)} />
          {desk.reviseError ? <Problem>{desk.reviseError}</Problem> : null}
          {!desk.canRevise ? <p className="text-base text-fg-muted">진행 중인 작업이 끝나면 보낼 수 있습니다.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={desk.revising} disabled={!desk.canRevise}>
              새로 그리기
            </Button>
            <Button onClick={() => setRedrawing(false)}>취소</Button>
          </div>
        </form>
      ) : null}
      <Sheet open={film !== null} onOpenChange={(open) => !open && setFilm(null)} title={film ? `${mockupName(film.file)}을 눌러 본 장면` : ''} description="QA 브라우저가 이 시안에서 핵심 흐름을 직접 눌러 본 기록입니다. 처음 화면, 그리고 한 번 누를 때마다 한 장." wide>
        {film?.flow?.filmArtifactId ? (
          <div className="flex flex-col gap-4 p-6">
            <Measured {...flowLine(film.flow)} />
            <ArtifactImage artifactId={film.flow.filmArtifactId} alt={`${mockupName(film.file)}에서 핵심 흐름을 누른 순서대로 찍은 화면`} className="w-full rounded-md border border-border" />
          </div>
        ) : null}
      </Sheet>
      <Sheet open={reading && spec !== null} onOpenChange={setReading} title="화면 명세" description="화면마다 무엇을 하는 곳인지, 각 요소가 어떤 규칙으로 동작하는지 적은 문서입니다. 생김새는 여기에 없습니다: 시안이 달라도 이 명세는 같고, 구현은 이 명세를 따릅니다." wide>
        {spec ? <ScreenSpecView spec={spec} /> : null}
      </Sheet>
    </div>
  );
}

/** One line of what the daemon measured on a mock-up. Plain when it is fine; marked when it found something. */
/**
 * A design task's directions before it has finished: each page as the studio last drew it, when the engine asked
 * for it to be measured. Pictures and counts only. Nothing is chosen here: the page may still change, and no
 * design reviewer has seen it.
 */
function DraftMockups({ mockups, running }: { mockups: Mockup[]; running: boolean }) {
  return (
    <section aria-label="그리는 중인 시안" className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold">{running ? `시안 ${mockups.length}개를 그리는 중입니다` : `끝나기 전에 그린 시안 ${mockups.length}개`}</p>
        <p className="text-base text-fg-muted">엔진이 측정을 맡길 때마다 그때 화면으로 바뀌는 초안입니다. 고르는 것은 작업이 끝난 뒤입니다.</p>
      </div>
      <div className={`grid grid-cols-2 gap-3 ${mockups.length > 2 ? '@xl:grid-cols-3' : ''}`}>
        {mockups.map((m) => {
          const found = m.measures ? m.measures.blockers + m.measures.majors + m.measures.copyHabits : null;
          return (
            <div key={m.file} className="flex flex-col gap-2 rounded-lg border border-border p-2">
              <MockupImage mockup={m} className="w-full rounded-md border border-border" />
              <span className="text-sm font-semibold">{mockupName(m.file)}</span>
              {/* The page's own title: a model's words, shown as text. */}
              <span className="break-words text-sm font-medium">{m.title}</span>
              {m.flow ? <Measured {...flowLine(m.flow)} /> : null}
              {found === null ? null : <Measured ok={found === 0} text={found === 0 ? '측정된 결함 없음' : `측정된 결함 ${found}건, 고치는 중`} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Measured({ ok, text }: { ok: boolean; text: string }) {
  return <span className={`break-words text-sm ${ok ? 'text-fg-muted' : 'font-medium text-warning'}`}>{text}</span>;
}

/** A mock-up as the QA browser drew it. A picture: whatever the page contained, nothing of it runs here. */
function MockupImage({ mockup, className }: { mockup: Mockup; className: string }) {
  const { backend } = useStudio();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setSrc(null);
    setFailed(false);
    let stale = false;
    backend.artifactUrl(mockup.artifactId).then(
      (url) => !stale && setSrc(url),
      () => !stale && setFailed(true),
    );
    return () => {
      stale = true;
    };
  }, [backend, mockup.artifactId]);
  if (failed) return <p className="px-1 py-6 text-sm text-fg-muted">그림을 불러오지 못했습니다.</p>;
  // The box keeps the picture's proportions while it loads, so the card does not jump.
  return src ? (
    <img src={src} alt={`${mockupName(mockup.file)} 첫 화면 시안`} width={mockup.width} height={mockup.height} className={`block h-auto ${className}`} />
  ) : (
    <div className={`bg-sunken ${className}`} style={{ aspectRatio: `${mockup.width} / ${mockup.height}` }} aria-hidden />
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
      <Remaining until={approval.expiresAt} />
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

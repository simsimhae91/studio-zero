import { Archive, ArchiveRestore, Coffee, Globe, Lightbulb, Menu as MenuIcon, Moon, MoreHorizontal, PenLine, Pencil, Plus, RotateCw, Settings as SettingsIcon, Smartphone, Star, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { PowerMode, Project, SandboxState, Scratchpad, SubscriptionQuota, Template } from '@studio-zero/protocol';
import { creatableTemplates, powerLabel, slugify, stamp, subscriptionLabel, tokens } from '../lib/format.ts';
import { markTrayPower, onTrayPowerRequest } from '../lib/platform.ts';
import { useAction, useQuery, useStudio } from '../lib/studio.tsx';
import { Button, Field, IconButton, Menu, MenuItem, MenuSeparator, Modal, Problem, Segmented, Sheet, Status, TitlebarSpace, inputClass } from '../ui.tsx';
import { Home } from './Home.tsx';
import { DeleteNoteModal, RenameNoteModal } from './noteActions.tsx';
import { DeleteProjectModal, RenameProjectModal, restartSandbox } from './projectActions.tsx';
import { ProjectPage } from './ProjectPage.tsx';
import { ScratchPage } from './ScratchPage.tsx';
import { Settings } from './Settings.tsx';

export type Route = { kind: 'home' } | { kind: 'scratch'; id: string } | { kind: 'project'; id: string };
const ROUTE_KEY = 'studio-zero.route';
export const scratchState = { exploring: '정리 중', ready: '만들 준비됨', promoted: '넘겨짐', archived: '보관됨' } as const;
const TEMPLATES = creatableTemplates;

function restore(): Route {
  try {
    const saved = JSON.parse(localStorage.getItem(ROUTE_KEY) ?? 'null') as Route | null;
    if (saved && (saved.kind === 'home' || typeof saved.id === 'string')) return saved;
  } catch {
    // fall through to home
  }
  return { kind: 'home' };
}

/** The frame: a rail listing every project and note, and the desk where one of them is open. One theme across both. */
export function Shell({ onDisconnect }: { onDisconnect: () => void }) {
  const { backend, link } = useStudio();
  const projects = useQuery('projects.list', {}, ['sandbox.state', 'task.state', 'project.changed']);
  const pads = useQuery('scratch.list', {}, ['scratch.state', 'scratch.entry', 'scratch.changed']);
  // What was put away: listed apart, so that putting a note away is not the same as losing it.
  const shelved = useQuery('scratch.list', { archived: true }, ['scratch.state', 'scratch.changed']);
  const approvals = useQuery('approvals.list', { state: 'pending' }, ['approval.requested', 'approval.resolved']);
  const [route, setRoute] = useState<Route>(restore);
  const [settings, setSettings] = useState(false);
  const [menu, setMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [renamingNote, setRenamingNote] = useState<Scratchpad | null>(null);
  const [deletingNote, setDeletingNote] = useState<Scratchpad | null>(null);

  useEffect(() => localStorage.setItem(ROUTE_KEY, JSON.stringify(route)), [route]);
  // The page the app was closed on may be gone (a note or project deleted since, or from another window). Looked at
  // once, when the lists have first arrived: after that a route is only ever set to something that was just listed or made.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !projects.data || !pads.data || !shelved.data) return;
    restored.current = true;
    const there = route.kind === 'home' || (route.kind === 'project' ? projects.data.projects.some((p) => p.id === route.id) : [...pads.data.scratchpads, ...shelved.data.scratchpads].some((p) => p.id === route.id));
    if (!there) setRoute({ kind: 'home' });
  }, [projects.data, pads.data, shelved.data, route]);
  const go = (next: Route): void => {
    setRoute(next);
    setMenu(false);
  };
  const reload = (): void => {
    projects.reload();
    pads.reload();
    shelved.reload();
  };
  const restart = useAction(async (projectId: string) => {
    await restartSandbox(backend, projectId);
    projects.reload();
  });
  const shelve = useAction(async (note: Scratchpad, away: boolean) => {
    await backend.call(away ? 'scratch.archive' : 'scratch.restore', { scratchId: note.id });
    reload();
    if (away && route.kind === 'scratch' && route.id === note.id) go({ kind: 'home' });
  });

  const projectList = projects.data?.projects ?? [];
  const live = new Map((projects.data?.live ?? []).map((l) => [l.projectId, l]));
  const waiting = new Map<string, number>();
  for (const a of approvals.data?.approvals ?? []) if (a.projectId) waiting.set(a.projectId, (waiting.get(a.projectId) ?? 0) + 1);
  // A note that became a project lives on as that project; one that became a document keeps its page.
  const padList = (pads.data?.scratchpads ?? []).filter((p) => p.state !== 'archived' && !(p.state === 'promoted' && p.projectId));
  const shelvedList = shelved.data?.scratchpads ?? [];
  const linkStatus = backend.demo ? <Status tone="warn">데모 데이터</Status> : link === 'connected' ? <Status tone="good">{backend.host}</Status> : <Status tone="warn">다시 연결하는 중</Status>;

  const index = (
    <>
      <div className="flex gap-2 px-3">
        <button type="button" onClick={() => go({ kind: 'home' })} className="flex min-h-11 flex-1 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-on-accent">
          <PenLine className="size-4" aria-hidden />새로 시작
        </button>
        <IconButton label="빈 프로젝트 만들기" className="border border-control-border" onClick={() => (setMenu(false), setCreating(true))}>
          <Plus className="size-4" aria-hidden />
        </IconButton>
      </div>
      <nav aria-label="프로젝트와 작업 노트" className="pane-scroll flex min-h-0 flex-1 flex-col gap-6 px-2 py-4">
        <Group title="프로젝트" empty="아이디어를 적으면 여기에 생깁니다">
          {projectList.map((p) => {
            const state = live.get(p.id);
            return (
              <ProjectCard
                key={p.id}
                project={p}
                sandbox={state?.sandbox ?? 'absent'}
                busy={state?.busy ?? false}
                planWaiting={state?.planWaiting ?? false}
                waiting={waiting.get(p.id) ?? 0}
                current={route.kind === 'project' && route.id === p.id}
                onOpen={() => go({ kind: 'project', id: p.id })}
                onRename={() => (setMenu(false), setRenaming(p))}
                onRestart={() => void restart.run(p.id)}
                onDelete={() => (setMenu(false), setDeleting(p))}
              />
            );
          })}
        </Group>
        {restart.error ? <Problem>{restart.error}</Problem> : null}
        <Group title="작업 노트" empty="생각 정리, 조사, 문서가 여기에 쌓입니다">
          {padList.map((p) => (
            <NoteCard key={p.id} note={p} current={route.kind === 'scratch' && route.id === p.id} onOpen={() => go({ kind: 'scratch', id: p.id })} onRename={() => (setMenu(false), setRenamingNote(p))} onShelve={() => void shelve.run(p, true)} onDelete={() => (setMenu(false), setDeletingNote(p))} />
          ))}
        </Group>
        {shelve.error ? <Problem>{shelve.error}</Problem> : null}
        {shelvedList.length > 0 ? (
          <details className="flex flex-col gap-1">
            <summary className="flex min-h-11 cursor-default items-center rounded-md px-2 text-sm font-medium text-fg-muted hover:bg-bg hover:text-fg">보관한 노트 {shelvedList.length}개</summary>
            {shelvedList.map((p) => (
              <NoteCard key={p.id} note={p} current={false} onOpen={() => void shelve.run(p, false).then(() => go({ kind: 'scratch', id: p.id }))} onRename={() => (setMenu(false), setRenamingNote(p))} onShelve={() => void shelve.run(p, false)} onDelete={() => (setMenu(false), setDeletingNote(p))} />
            ))}
          </details>
        ) : null}
      </nav>
    </>
  );

  return (
    <div className="shell bg-bg text-fg">
      <aside className="hidden min-h-0 flex-col border-r border-border bg-sunken lg:flex">
        <TitlebarSpace />
        <div className="flex flex-col gap-3 px-4 pb-4 pt-4">
          <div className="flex flex-col gap-1">
            <p className="text-lg font-semibold">Studio Zero</p>
            {linkStatus}
          </div>
          <PowerToggle tray />
        </div>
        {index}
        <div className="border-t border-border p-2">
          <button type="button" onClick={() => setSettings(true)} className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-fg-muted hover:bg-bg hover:text-fg">
            <SettingsIcon className="size-4" aria-hidden />
            설정
          </button>
        </div>
      </aside>

      <header className="border-b border-border bg-sunken lg:hidden">
        <TitlebarSpace />
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <IconButton label="프로젝트와 작업 노트" onClick={() => setMenu(true)}>
            <MenuIcon className="size-5" aria-hidden />
          </IconButton>
          <p className="text-base font-semibold">Studio Zero</p>
          <IconButton label="설정" onClick={() => setSettings(true)}>
            <SettingsIcon className="size-5" aria-hidden />
          </IconButton>
        </div>
      </header>

      <main className="desk">
        {/* The rail's status line is not on screen below the widest layout, and says nothing of what to do. */}
        {link !== 'connected' && !backend.demo ? (
          <div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-warning bg-surface px-4 py-2">
            <p className="text-base">데몬과 연결이 끊겼습니다. 다시 연결하는 중이고, 연결되면 화면을 새로 읽습니다. 그동안 보낸 것은 전달되지 않습니다.</p>
            <Button onClick={onDisconnect}>연결 설정으로</Button>
          </div>
        ) : null}
        {route.kind === 'home' ? (
          <Home scratchpads={padList} projects={projectList} onOpen={go} onCreated={reload} />
        ) : route.kind === 'scratch' ? (
          <ScratchPage key={route.id} scratchId={route.id} onOpen={go} onChanged={reload} />
        ) : (
          <ProjectPage key={route.id} project={projectList.find((p: Project) => p.id === route.id) ?? null} loading={projects.data === undefined} onOpen={go} onChanged={reload} />
        )}
      </main>

      <QuotaBar />

      <Sheet open={menu} onOpenChange={setMenu} title="Studio Zero">
        <div className="flex flex-1 flex-col gap-4 bg-sunken pt-4">
          <div className="px-3">
            <PowerToggle />
          </div>
          {index}
        </div>
      </Sheet>
      <Settings open={settings} onOpenChange={setSettings} onDisconnect={onDisconnect} />
      <CreateProjectModal
        open={creating}
        onOpenChange={setCreating}
        onCreated={(project) => {
          reload();
          go({ kind: 'project', id: project.id });
        }}
      />
      <RenameProjectModal project={renaming} onOpenChange={(open) => !open && setRenaming(null)} onRenamed={reload} />
      <RenameNoteModal note={renamingNote} onOpenChange={(open) => !open && setRenamingNote(null)} onRenamed={reload} />
      <DeleteNoteModal
        note={deletingNote}
        onOpenChange={(open) => !open && setDeletingNote(null)}
        onDeleted={(note) => {
          reload();
          if (route.kind === 'scratch' && route.id === note.id) go({ kind: 'home' });
        }}
      />
      <DeleteProjectModal
        project={deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        onDeleted={(project) => {
          setDeleting(null);
          reload();
          if (route.kind === 'project' && route.id === project.id) go({ kind: 'home' });
        }}
      />
    </div>
  );
}

const PowerModeNames: ReadonlySet<string> = new Set<PowerMode>(['off', 'system', 'display']);
const POWER_MODES: readonly { id: PowerMode; icon: typeof Coffee }[] = [
  { id: 'off', icon: Coffee },
  { id: 'system', icon: Moon },
  { id: 'display', icon: Lightbulb },
];

/**
 * Whether the daemon's Mac is held awake, switched with one press: let it sleep, keep the system up while the
 * display rests, or keep the display on too. Not shown where the daemon has no way to do it.
 */
function PowerToggle({ tray = false }: { tray?: boolean }) {
  const { backend } = useStudio();
  const power = useQuery('power.get', {}, ['power.changed']);
  const set = useAction(async (mode: PowerMode) => {
    await backend.call('power.set', { mode });
    power.reload();
  });
  // One instance (the rail's, which is always mounted) also serves the desktop shell's menu-bar item: a choice
  // made there is carried out here, over the socket, and the menu's check mark follows what the daemon says.
  const request = set.run;
  useEffect(() => (tray ? onTrayPowerRequest((mode) => void (PowerModeNames.has(mode) && request(mode as PowerMode))) : undefined), [tray, request]);
  const current = power.data?.supported ? power.data.mode : null;
  useEffect(() => void (tray && current && markTrayPower(current)), [tray, current]);
  if (!power.data?.supported) return null;
  const mode = power.data.mode;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <div role="radiogroup" aria-label="Mac 잠자기 방지" className="inline-flex gap-1 rounded-lg border border-border bg-bg p-1">
          {POWER_MODES.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={mode === id}
              aria-label={powerLabel[id].short}
              title={`${powerLabel[id].short}: ${powerLabel[id].does}`}
              disabled={set.busy}
              onClick={() => void set.run(id)}
              className={`inline-flex size-9 pointer-coarse:size-11 items-center justify-center rounded-md border disabled:opacity-60 ${mode === id ? 'border-control-border bg-surface text-fg shadow-sm' : 'border-transparent text-fg-muted hover:text-fg'}`}
            >
              <Icon className="size-4" aria-hidden />
            </button>
          ))}
        </div>
        <span className="text-sm text-fg-muted">{powerLabel[mode].short}</span>
      </div>
      {set.error ? <Problem>{set.error}</Problem> : null}
    </div>
  );
}

function remaining(until: number, now: number): string {
  const minutes = Math.max(1, Math.round((until - now) / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 뒤` : `${minutes}분 뒤`;
}

function quotaWord(s: SubscriptionQuota, now: number): string {
  if (!s.connected) return '연결 안 됨';
  if (s.state === 'limited') return s.resetsAt ? `한도 도달, ${remaining(s.resetsAt, now)} 풀림` : '한도 도달';
  return s.state === 'ok' ? '정상' : '아직 쓰지 않음';
}

/**
 * The strip along the bottom of the window: each subscription the studio works through, and whether it is
 * connected and under a usage limit. Pressing it opens the detail. These are the daemon's own observations
 * (what it spent, when a vendor refused), not the account's balance, and the detail says so.
 */
function QuotaBar() {
  const quota = useQuery('quota.get', {}, ['quota.changed']);
  const [now, setNow] = useState(() => Date.now());
  const reload = quota.reload;
  useEffect(() => {
    // The countdown moves with the clock even when nothing happens in the daemon.
    const timer = setInterval(() => (setNow(Date.now()), reload()), 60_000);
    return () => clearInterval(timer);
  }, [reload]);
  const subscriptions = quota.data?.subscriptions ?? [];
  if (subscriptions.length === 0) return null;
  // Green only for a subscription that has answered; one that is installed but unused yet is not known to be fine.
  const mark = (s: SubscriptionQuota): string => (!s.connected || s.state === 'unknown' ? 'bg-control-border' : s.state === 'limited' ? 'bg-warning' : 'bg-success');
  const limited = subscriptions.filter((s) => s.connected && s.state === 'limited');
  return (
    <footer className="statusbar border-t border-border bg-sunken">
      <Menu
        align="start"
        trigger={
          <button type="button" aria-label="구독 사용 현황" className="flex min-h-9 pointer-coarse:min-h-11 w-full items-center gap-x-6 gap-y-1 px-4 text-left text-sm text-fg-muted hover:text-fg">
            <span className="font-medium">구독</span>
            {subscriptions.map((s) => (
              <span key={s.id} className={`items-center gap-2 ${s.state === 'limited' && s.connected ? 'inline-flex font-medium text-warning' : 'hidden md:inline-flex'}`}>
                <span className={`size-2 rounded-full ${mark(s)}`} aria-hidden />
                {subscriptionLabel[s.id]}
                {s.connected && s.state !== 'limited' ? null : <span>{quotaWord(s, now)}</span>}
              </span>
            ))}
            {limited.length === 0 ? <span className="md:hidden">{subscriptions.filter((s) => s.connected).length}개 연결</span> : null}
          </button>
        }
      >
        <div className="flex w-80 max-w-full flex-col gap-3 p-3">
          {subscriptions.map((s) => (
            <div key={s.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm font-semibold">{subscriptionLabel[s.id]}</span>
                <span className={`text-sm font-medium ${!s.connected || s.state === 'unknown' ? 'text-fg-muted' : s.state === 'limited' ? 'text-warning' : 'text-success'}`}>{quotaWord(s, now)}</span>
              </div>
              {s.connected ? (
                <>
                  <span className="text-sm text-fg-muted">
                    최근 5시간 {tokens(s.recent.tokens)} 토큰, {s.recent.calls}회 · 7일 {tokens(s.week.tokens)} 토큰, {s.week.calls}회
                  </span>
                  {s.state === 'limited' && s.resetsAt ? <span className="text-sm text-fg-muted">{stamp(s.resetsAt)}에 풀린다고 했습니다</span> : null}
                </>
              ) : (
                <span className="break-words text-sm text-fg-muted">{s.detail}</span>
              )}
            </div>
          ))}
          <p className="text-base text-fg-muted">스튜디오가 이 구독으로 쓴 양과 한도에 걸렸을 때 받은 답입니다. 계정에 남은 한도는 각 CLI의 로그인 안에 있어 읽지 않습니다.</p>
        </div>
      </Menu>
    </footer>
  );
}

function Group({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="px-2 text-sm font-medium text-fg-muted">{title}</h2>
      {children.length === 0 ? <p className="px-2 text-sm text-fg-muted">{empty}</p> : children}
    </section>
  );
}

/**
 * A work note in the rail, with a menu for what can be done to it without opening it, as a project has.
 * A note that was put away is listed under its own heading: opening it or "꺼내기" brings it back.
 */
function NoteCard({ note, current, onOpen, onRename, onShelve, onDelete }: { note: Scratchpad; current: boolean; onOpen: () => void; onRename: () => void; onShelve: () => void; onDelete: () => void }) {
  const away = note.state === 'archived';
  return (
    <div className={`rail-item flex items-center rounded-md ${current ? 'bg-bg' : 'hover:bg-bg'}`}>
      <button type="button" onClick={onOpen} aria-current={current ? 'page' : undefined} title={note.title} className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-md py-1 pl-2 text-left">
        <span className="line-clamp-2 break-words text-sm font-medium">{note.title}</span>
        <span className="text-sm text-fg-muted">{scratchState[note.state]}</span>
      </button>
      <Menu
        trigger={
          <button type="button" aria-label={`${note.title} 메뉴`} className="rail-menu inline-flex size-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:text-fg">
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        }
      >
        <MenuItem onSelect={onRename} icon={<Pencil className="size-4" aria-hidden />}>
          이름 변경
        </MenuItem>
        <MenuItem onSelect={onShelve} icon={away ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}>
          {away ? '다시 꺼내기' : '보관'}
        </MenuItem>
        <MenuSeparator />
        <MenuItem danger onSelect={onDelete} icon={<Trash2 className="size-4" aria-hidden />}>
          노트 삭제
        </MenuItem>
      </Menu>
    </div>
  );
}

const sandboxWord: Record<SandboxState, string> = { running: '샌드박스 실행 중', stopped: '샌드박스 꺼짐', absent: '샌드박스 없음' };

/**
 * A project in the rail: a mark for its sandbox (green while it runs, pulsing while a task is working in it),
 * the kind of app, its name, and a menu for what can be done to it without opening it.
 */
function ProjectCard({ project, sandbox, busy, planWaiting, waiting, current, onOpen, onRename, onRestart, onDelete }: { project: Project; sandbox: SandboxState; busy: boolean; planWaiting: boolean; waiting: number; current: boolean; onOpen: () => void; onRename: () => void; onRestart: () => void; onDelete: () => void }) {
  // The studio's own repository: marked, and neither renamed nor deleted from here.
  const core = project.template === 'studio-core';
  const Icon = core ? Star : project.template === 'mobile-expo' ? Smartphone : Globe;
  // What is the owner's to answer comes first: an approval, then a plan. Neither is the studio at work.
  const turn = waiting > 0 ? `승인 대기 ${waiting}건` : planWaiting ? '계획 검토 대기' : null;
  const state = turn ?? (busy ? '작업 중' : sandboxWord[sandbox]);
  return (
    <div className={`rail-item flex items-center rounded-md ${current ? 'bg-bg' : 'hover:bg-bg'}`}>
      <button type="button" onClick={onOpen} aria-current={current ? 'page' : undefined} title={`${project.name}, ${state}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md py-1 pl-2 text-left">
        <span className={`size-2 shrink-0 rounded-full ${sandbox === 'running' ? 'bg-success' : 'bg-control-border'} ${busy && turn === null ? 'status-pulse' : ''}`} aria-hidden />
        <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden />
        <span className="flex min-w-0 flex-col">
          <span className="line-clamp-2 break-words text-sm font-medium">{project.name}</span>
          <span className={`break-all text-sm ${turn !== null ? 'font-medium text-accent' : 'text-fg-muted'}`}>{turn ?? (busy ? '작업 중' : project.slug)}</span>
        </span>
      </button>
      <Menu
        trigger={
          <button type="button" aria-label={`${project.name} 메뉴`} className="rail-menu inline-flex size-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:text-fg">
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        }
      >
        {core ? null : (
          <MenuItem onSelect={onRename} icon={<Pencil className="size-4" aria-hidden />}>
            이름 변경
          </MenuItem>
        )}
        <MenuItem onSelect={onRestart} icon={<RotateCw className="size-4" aria-hidden />}>
          샌드박스 재기동
        </MenuItem>
        {core ? null : (
          <>
            <MenuSeparator />
            <MenuItem danger onSelect={onDelete} icon={<Trash2 className="size-4" aria-hidden />}>
              프로젝트 삭제
            </MenuItem>
          </>
        )}
      </Menu>
    </div>
  );
}

/** A project with nothing in it yet, for when the owner knows the name and the stack and wants to start from the workbench. */
function CreateProjectModal({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (project: Project) => void }) {
  const { backend } = useStudio();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [template, setTemplate] = useState<Template>('web-vite-react');
  // Until the owner types a slug of their own, it follows the name.
  const [slugTouched, setSlugTouched] = useState(false);
  const autoSlug = (value: string): string => {
    const ascii = value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(ascii) ? ascii : '';
  };
  const create = useAction(async () => {
    const project = await backend.call('projects.create', { name: name.trim(), slug: slug.trim() || slugify(name), template });
    setName('');
    setSlug('');
    setSlugTouched(false);
    onOpenChange(false);
    onCreated(project);
  });
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (name.trim() !== '') void create.run();
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="빈 프로젝트 만들기" description="샌드박스와 저장소만 준비합니다. 무엇을 만들지는 프로젝트 안에서 적습니다.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="이름">
          <input
            className={inputClass}
            value={name}
            maxLength={80}
            autoFocus
            required
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(autoSlug(e.target.value));
            }}
          />
        </Field>
        <Field label="식별자" hint="영문 소문자, 숫자, 하이픈 3~40자. 컨테이너 이름과 프리뷰 주소에 쓰이고 나중에 바꿀 수 없습니다. 비워 두면 자동으로 정합니다.">
          <input className={`${inputClass} font-mono`} value={slug} maxLength={40} pattern="[a-z][a-z0-9-]{1,38}[a-z0-9]" autoCapitalize="none" spellCheck={false} onChange={(e) => (setSlugTouched(true), setSlug(e.target.value.toLowerCase()))} />
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">무엇으로 만들지</span>
          <Segmented label="템플릿" value={template} options={TEMPLATES} onChange={setTemplate} />
        </div>
        {create.error ? <Problem>{create.error}</Problem> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={create.busy} onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button type="submit" variant="primary" busy={create.busy} disabled={name.trim() === ''}>
            프로젝트 만들기
          </Button>
        </div>
      </form>
    </Modal>
  );
}

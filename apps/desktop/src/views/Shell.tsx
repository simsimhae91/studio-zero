import { Globe, Menu as MenuIcon, MoreHorizontal, PenLine, Pencil, Plus, RotateCw, Settings as SettingsIcon, Smartphone, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Project, SandboxState, Template } from '@studio-zero/protocol';
import { slugify, templateLabel } from '../lib/format.ts';
import { useAction, useQuery, useStudio } from '../lib/studio.tsx';
import { Button, Field, IconButton, Menu, MenuItem, MenuSeparator, Modal, Problem, Segmented, Sheet, Status, TitlebarSpace, inputClass } from '../ui.tsx';
import { Home } from './Home.tsx';
import { DeleteProjectModal, RenameProjectModal, restartSandbox } from './projectActions.tsx';
import { ProjectPage } from './ProjectPage.tsx';
import { ScratchPage } from './ScratchPage.tsx';
import { Settings } from './Settings.tsx';

export type Route = { kind: 'home' } | { kind: 'scratch'; id: string } | { kind: 'project'; id: string };
const ROUTE_KEY = 'studio-zero.route';
export const scratchState = { exploring: '정리 중', ready: '만들 준비됨', promoted: '넘겨짐', archived: '보관됨' } as const;
const TEMPLATES = (Object.keys(templateLabel) as Template[]).map((id) => ({ id, label: templateLabel[id] }));

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
  const pads = useQuery('scratch.list', {}, ['scratch.state', 'scratch.entry']);
  const approvals = useQuery('approvals.list', { state: 'pending' }, ['approval.requested', 'approval.resolved']);
  const [route, setRoute] = useState<Route>(restore);
  const [settings, setSettings] = useState(false);
  const [menu, setMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);

  useEffect(() => localStorage.setItem(ROUTE_KEY, JSON.stringify(route)), [route]);
  const go = (next: Route): void => {
    setRoute(next);
    setMenu(false);
  };
  const reload = (): void => {
    projects.reload();
    pads.reload();
  };
  const restart = useAction(async (projectId: string) => {
    await restartSandbox(backend, projectId);
    projects.reload();
  });

  const projectList = projects.data?.projects ?? [];
  const live = new Map((projects.data?.live ?? []).map((l) => [l.projectId, l]));
  const waiting = new Map<string, number>();
  for (const a of approvals.data?.approvals ?? []) if (a.projectId) waiting.set(a.projectId, (waiting.get(a.projectId) ?? 0) + 1);
  // A note that became a project lives on as that project; one that became a document keeps its page.
  const padList = (pads.data?.scratchpads ?? []).filter((p) => p.state !== 'archived' && !(p.state === 'promoted' && p.projectId));
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
            <RailRow key={p.id} current={route.kind === 'scratch' && route.id === p.id} onClick={() => go({ kind: 'scratch', id: p.id })} title={p.title} meta={scratchState[p.state]} />
          ))}
        </Group>
      </nav>
    </>
  );

  return (
    <div className="shell bg-bg text-fg">
      <aside className="hidden min-h-0 flex-col border-r border-border bg-sunken lg:flex">
        <TitlebarSpace />
        <div className="flex flex-col gap-1 px-4 pb-4 pt-4">
          <p className="text-lg font-semibold">Studio Zero</p>
          {linkStatus}
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
        {route.kind === 'home' ? (
          <Home scratchpads={padList} projects={projectList} onOpen={go} onCreated={reload} />
        ) : route.kind === 'scratch' ? (
          <ScratchPage key={route.id} scratchId={route.id} onOpen={go} onChanged={reload} />
        ) : (
          <ProjectPage key={route.id} project={projectList.find((p: Project) => p.id === route.id) ?? null} loading={projects.data === undefined} onOpen={go} onChanged={reload} />
        )}
      </main>

      <Sheet open={menu} onOpenChange={setMenu} title="Studio Zero">
        <div className="flex flex-1 flex-col bg-sunken pt-4">{index}</div>
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

function Group({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="px-2 text-sm font-medium text-fg-muted">{title}</h2>
      {children.length === 0 ? <p className="px-2 text-sm text-fg-muted">{empty}</p> : children}
    </section>
  );
}

function RailRow({ title, meta, current, onClick }: { title: string; meta: string; current: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={current ? 'page' : undefined} title={title} className={`flex min-h-11 flex-col items-start justify-center rounded-md px-2 py-1 text-left ${current ? 'bg-bg' : 'hover:bg-bg'}`}>
      <span className="line-clamp-2 break-words text-sm font-medium">{title}</span>
      <span className="text-sm text-fg-muted">{meta}</span>
    </button>
  );
}

const sandboxWord: Record<SandboxState, string> = { running: '샌드박스 실행 중', stopped: '샌드박스 꺼짐', absent: '샌드박스 없음' };

/**
 * A project in the rail: a mark for its sandbox (green while it runs, pulsing while a task is working in it),
 * the kind of app, its name, and a menu for what can be done to it without opening it.
 */
function ProjectCard({ project, sandbox, busy, waiting, current, onOpen, onRename, onRestart, onDelete }: { project: Project; sandbox: SandboxState; busy: boolean; waiting: number; current: boolean; onOpen: () => void; onRename: () => void; onRestart: () => void; onDelete: () => void }) {
  const Icon = project.template === 'mobile-expo' ? Smartphone : Globe;
  const state = busy ? '작업 중' : sandboxWord[sandbox];
  return (
    <div className={`rail-item flex items-center rounded-md ${current ? 'bg-bg' : 'hover:bg-bg'}`}>
      <button type="button" onClick={onOpen} aria-current={current ? 'page' : undefined} title={`${project.name}, ${state}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md py-1 pl-2 text-left">
        <span className={`size-2 shrink-0 rounded-full ${sandbox === 'running' ? 'bg-success' : 'bg-control-border'} ${busy ? 'status-pulse' : ''}`} aria-hidden />
        <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden />
        <span className="flex min-w-0 flex-col">
          <span className="line-clamp-2 break-words text-sm font-medium">{project.name}</span>
          <span className={`break-all text-sm ${waiting > 0 ? 'font-medium text-accent' : 'text-fg-muted'}`}>{waiting > 0 ? `승인 대기 ${waiting}건` : busy ? '작업 중' : project.slug}</span>
        </span>
      </button>
      <Menu
        trigger={
          <button type="button" aria-label={`${project.name} 메뉴`} className="rail-menu inline-flex size-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:text-fg">
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        }
      >
        <MenuItem onSelect={onRename} icon={<Pencil className="size-4" aria-hidden />}>
          이름 변경
        </MenuItem>
        <MenuItem onSelect={onRestart} icon={<RotateCw className="size-4" aria-hidden />}>
          샌드박스 재기동
        </MenuItem>
        <MenuSeparator />
        <MenuItem danger onSelect={onDelete} icon={<Trash2 className="size-4" aria-hidden />}>
          프로젝트 삭제
        </MenuItem>
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

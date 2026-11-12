import { Menu, PenLine, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Project } from '@studio-zero/protocol';
import { useQuery, useStudio } from '../lib/studio.tsx';
import { IconButton, Sheet, Status, TitlebarSpace } from '../ui.tsx';
import { Home } from './Home.tsx';
import { ProjectPage } from './ProjectPage.tsx';
import { ScratchPage } from './ScratchPage.tsx';
import { Settings } from './Settings.tsx';

export type Route = { kind: 'home' } | { kind: 'scratch'; id: string } | { kind: 'project'; id: string };
const ROUTE_KEY = 'studio-zero.route';
export const scratchState = { exploring: '정리 중', ready: '만들 준비됨', promoted: '넘겨짐', archived: '보관됨' } as const;

function restore(): Route {
  try {
    const saved = JSON.parse(localStorage.getItem(ROUTE_KEY) ?? 'null') as Route | null;
    if (saved && (saved.kind === 'home' || typeof saved.id === 'string')) return saved;
  } catch {
    // fall through to home
  }
  return { kind: 'home' };
}

/** The frame: an ink rail listing every worksheet, and the desk where one of them is open. */
export function Shell({ onDisconnect }: { onDisconnect: () => void }) {
  const { backend, link } = useStudio();
  const projects = useQuery('projects.list', {});
  const pads = useQuery('scratch.list', {}, ['scratch.state', 'scratch.entry']);
  const [route, setRoute] = useState<Route>(restore);
  const [settings, setSettings] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => localStorage.setItem(ROUTE_KEY, JSON.stringify(route)), [route]);
  const go = (next: Route): void => {
    setRoute(next);
    setMenu(false);
  };
  const projectList = projects.data?.projects ?? [];
  const approvals = useQuery('approvals.list', { state: 'pending' }, ['approval.requested', 'approval.resolved']);
  const waiting = new Map<string, number>();
  for (const a of approvals.data?.approvals ?? []) if (a.projectId) waiting.set(a.projectId, (waiting.get(a.projectId) ?? 0) + 1);
  // A note that became a project lives on as that project; one that became a document keeps its page.
  const padList = (pads.data?.scratchpads ?? []).filter((p) => p.state !== 'archived' && !(p.state === 'promoted' && p.projectId));
  const linkStatus = backend.demo ? <Status tone="warn">데모 데이터</Status> : link === 'connected' ? <Status tone="good">{backend.host}</Status> : <Status tone="warn">다시 연결하는 중</Status>;

  const index = (
    <>
      <button type="button" onClick={() => go({ kind: 'home' })} className="mx-4 flex min-h-11 items-center gap-3 rounded-md bg-accent px-4 text-base font-medium text-on-accent">
        <PenLine className="size-4" aria-hidden />새 작업 노트
      </button>
      <nav aria-label="작업 노트와 프로젝트" className="pane-scroll flex min-h-0 flex-1 flex-col gap-8 px-2 py-6">
        <Group title="작업 노트" empty="아직 없습니다">
          {padList.map((p) => (
            <IndexItem key={p.id} title={p.title} meta={scratchState[p.state]} current={route.kind === 'scratch' && route.id === p.id} onClick={() => go({ kind: 'scratch', id: p.id })} />
          ))}
        </Group>
        <Group title="프로젝트" empty="작업 노트를 승격하면 생깁니다">
          {projectList.map((p) => (
            <IndexItem key={p.id} title={p.name} meta={waiting.has(p.id) ? `승인 대기 ${waiting.get(p.id)}건` : p.slug} flag={waiting.has(p.id)} current={route.kind === 'project' && route.id === p.id} onClick={() => go({ kind: 'project', id: p.id })} />
          ))}
        </Group>
      </nav>
    </>
  );

  return (
    <div className="shell bg-bg text-fg">
      <aside className="theme-dark hidden min-h-0 flex-col bg-bg lg:flex">
        <TitlebarSpace />
        <div className="flex flex-col gap-2 px-6 pb-6 pt-6">
          <p className="text-xl font-semibold">Studio Zero</p>
          {linkStatus}
        </div>
        {index}
        <div className="border-t border-border p-2">
          <button type="button" onClick={() => setSettings(true)} className="flex min-h-11 w-full items-center gap-3 rounded-md px-4 text-base text-fg-muted hover:bg-surface hover:text-fg">
            <SettingsIcon className="size-4" aria-hidden />
            설정
          </button>
        </div>
      </aside>

      <header className="theme-dark bg-bg lg:hidden">
        <TitlebarSpace />
        <div className="flex items-center justify-between gap-2 px-2 py-2">
          <IconButton label="작업 노트와 프로젝트" onClick={() => setMenu(true)}>
            <Menu className="size-5" aria-hidden />
          </IconButton>
          <p className="text-base font-semibold">Studio Zero</p>
          <IconButton label="설정" onClick={() => setSettings(true)}>
            <SettingsIcon className="size-5" aria-hidden />
          </IconButton>
        </div>
      </header>

      <main className="desk">
        {route.kind === 'home' ? (
          <Home scratchpads={padList} projects={projectList} onOpen={go} onCreated={() => (projects.reload(), pads.reload())} />
        ) : route.kind === 'scratch' ? (
          <ScratchPage key={route.id} scratchId={route.id} onOpen={go} onChanged={() => (projects.reload(), pads.reload())} />
        ) : (
          <ProjectPage key={route.id} project={projectList.find((p: Project) => p.id === route.id) ?? null} loading={projects.data === undefined} onOpen={go} />
        )}
      </main>

      <Sheet open={menu} onOpenChange={setMenu} title="Studio Zero">
        <div className="flex flex-1 flex-col pt-6">{index}</div>
      </Sheet>
      <Settings open={settings} onOpenChange={setSettings} onDisconnect={onDisconnect} />
    </div>
  );
}

function Group({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="px-4 text-sm font-medium text-fg-muted">{title}</h2>
      {children.length === 0 ? <p className="px-4 text-base text-fg-muted">{empty}</p> : children}
    </section>
  );
}

function IndexItem({ title, meta, current, flag = false, onClick }: { title: string; meta: string; current: boolean; flag?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={current ? 'page' : undefined} className={`flex min-h-11 flex-col items-start justify-center gap-1 rounded-md border-l-4 px-3 py-2 text-left ${current ? 'border-accent bg-surface' : 'border-transparent hover:bg-surface'}`}>
      <span className="text-base font-medium">{title}</span>
      <span className={`text-sm ${flag ? 'font-medium text-accent' : 'text-fg-muted'}`}>{meta}</span>
    </button>
  );
}


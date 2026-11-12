import { ExternalLink, Monitor, MousePointerClick, Play, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Project } from '@studio-zero/protocol';
import { mockupName } from '../../lib/steps.ts';
import { useAction, useStudio } from '../../lib/studio.tsx';
import { Button, Empty, IconButton, Problem } from '../../ui.tsx';
import { useMockupDesk } from '../mockupDesk.tsx';
import { MobileFramePreview, PHONE_SCREEN, ScaledFrame } from './MobileFramePreview.tsx';
import { MockupNotes, MockupStage, type Target } from './MockupStage.tsx';

type Viewport = 'mobile' | 'tablet' | 'desktop';
const VIEWPORTS: readonly { id: Viewport; label: string; icon: typeof Monitor }[] = [
  { id: 'mobile', label: '모바일', icon: Smartphone },
  { id: 'tablet', label: '태블릿', icon: Tablet },
  { id: 'desktop', label: '데스크톱', icon: Monitor },
];
const TABLET = { width: 834, height: 1194 } as const;
const demoShot: Record<Viewport, string> = { mobile: 'art_phone', tablet: 'art_tablet', desktop: 'art_desktop' };

/**
 * The running app, beside the conversation that is building it. A mobile project opens in a phone; a web
 * project opens at the pane's width, one click from a phone or a tablet.
 *
 * Before there is an app there are the design task's mock-ups, and this is where they are looked at: the same
 * frames, the page itself and not a picture of it, one click between the directions. Pointing at an element
 * and writing what should change is how a revision is asked for.
 *
 * `busy` is true while a task holds the workspace; `ready` once a task has produced something to run. The
 * preview brings itself up when there is something to show and nothing is mid-change, and refreshes when a
 * task ends, so nobody has to ask for it.
 */
export function Preview({ project, busy, ready }: { project: Project; busy: boolean; ready: boolean }) {
  const { backend } = useStudio();
  const [url, setUrl] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>(project.template === 'mobile-expo' ? 'mobile' : 'desktop');
  const [reloads, setReloads] = useState(0);
  const [demoImage, setDemoImage] = useState<string | null>(null);
  const start = useAction(async () => {
    const preview = await backend.call('preview.start', { projectId: project.id });
    setUrl(preview.localhost);
    setReloads((n) => n + 1);
  });
  const remote = !backend.demo && !['localhost', '127.0.0.1', '[::1]'].includes(backend.host);
  const desk = useMockupDesk();
  const mockup = desk.source === 'mockup' ? (desk.pages.find((page) => page.file === desk.picked) ?? desk.pages[0] ?? null) : null;
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  // A choice of element belongs to the page it was made on.
  useEffect(() => setTarget(null), [mockup?.file]);

  // Starting is safe to repeat: a dev server that already answers is left running.
  const wasBusy = useRef(busy);
  useEffect(() => {
    const finished = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (backend.demo || busy || !ready) return;
    if (url === null || finished) void start.run();
    // `start` is stable; `url` is read, not watched: a failed start must not retry in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, busy, ready, project.id]);
  useEffect(() => {
    if (backend.demo) void backend.artifactUrl(demoShot[viewport]).then(setDemoImage);
  }, [backend, viewport]);

  const title = `${project.name} 프리뷰`;
  // The built app is content, not part of this interface: a sandboxed frame on another origin, with no access to the shell.
  const frame = (className: string, size?: { width: number; height: number }) =>
    mockup ? (
      <MockupStage page={mockup} className={`${className}${className === 'device-screen' ? '' : ' relative'}`} picking={picking} target={target} onTarget={setTarget} />
    ) : backend.demo ? (
      demoImage ? <img src={demoImage} alt={`${VIEWPORTS.find((v) => v.id === viewport)!.label} 크기의 예시 화면`} className={`${className} object-cover object-top`} {...size} /> : null
    ) : url ? (
      <iframe key={`${url}#${reloads}`} title={title} src={url} className={className} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" {...size} />
    ) : null;

  const showing = mockup !== null || backend.demo || url !== null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-2 py-1">
        {desk.pages.length > 0 ? (
          <div role="radiogroup" aria-label="보여 줄 것" className="flex gap-1">
            <button type="button" role="radio" aria-checked={mockup === null} onClick={desk.showApp} className={`inline-flex min-h-9 pointer-coarse:min-h-11 items-center rounded-md px-3 text-sm font-medium ${mockup === null ? 'bg-sunken text-fg' : 'text-fg-muted hover:text-fg'}`}>
              앱
            </button>
            {desk.pages.map((page) => (
              <button key={page.file} type="button" role="radio" aria-checked={mockup?.file === page.file} onClick={() => desk.pick(page.file)} className={`inline-flex min-h-9 pointer-coarse:min-h-11 items-center rounded-md px-3 text-sm font-medium ${mockup?.file === page.file ? 'bg-sunken text-fg' : 'text-fg-muted hover:text-fg'}`}>
                시안 {mockupName(page.file).slice(0, 1)}
              </button>
            ))}
          </div>
        ) : null}
        <div role="radiogroup" aria-label="화면 크기" className="flex gap-1">
          {VIEWPORTS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="radio" aria-checked={viewport === id} onClick={() => setViewport(id)} className={`inline-flex min-h-9 pointer-coarse:min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium ${viewport === id ? 'bg-sunken text-fg' : 'text-fg-muted hover:text-fg'}`}>
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {busy ? <span className="px-2 text-sm text-fg-muted">작업이 끝나면 새로 고칩니다</span> : null}
          {mockup ? (
            <>
              <button type="button" aria-pressed={picking} onClick={() => (setPicking(!picking), setTarget(null))} className={`inline-flex min-h-9 pointer-coarse:min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium ${picking ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-sunken hover:text-fg'}`}>
                <MousePointerClick className="size-4" aria-hidden />
                요소 고르기
              </button>
              <IconButton label="시안 다시 읽기" onClick={desk.reload}>
                <RefreshCw className="size-4" aria-hidden />
              </IconButton>
            </>
          ) : url ? (
            <>
              <IconButton label="새로 고침" onClick={() => setReloads((n) => n + 1)}>
                <RefreshCw className="size-4" aria-hidden />
              </IconButton>
              <a className="inline-flex size-11 items-center justify-center rounded-md text-fg-muted hover:bg-sunken hover:text-fg" href={url} target="_blank" rel="noreferrer" aria-label="브라우저에서 열기" title="브라우저에서 열기">
                <ExternalLink className="size-4" aria-hidden />
              </a>
            </>
          ) : null}
        </div>
      </div>

      {!showing ? (
        <Empty title={start.busy ? '프리뷰를 켜는 중입니다' : ready ? '프리뷰가 꺼져 있습니다' : '아직 보여 줄 화면이 없습니다'}>
          <p>{start.busy ? '샌드박스에서 개발 서버가 응답하기를 기다리고 있습니다.' : ready ? '샌드박스에서 개발 서버를 켜면 만들어진 화면이 여기에 뜹니다.' : '첫 작업이 끝나면 만들어진 화면이 여기에 바로 뜹니다.'}</p>
          {remote ? <p>원격 데몬의 프리뷰 포트는 그 Mac의 localhost에만 열립니다. 이 기기에서 보려면 그 Mac에서 해당 포트를 tailscale serve로 열어 주세요.</p> : null}
          {start.error ? <Problem>{start.error}</Problem> : null}
          <Button variant="primary" busy={start.busy} onClick={() => void start.run()} icon={<Play className="size-4" aria-hidden />}>
            프리뷰 켜기
          </Button>
        </Empty>
      ) : viewport === 'mobile' ? (
        <MobileFramePreview label={`iPhone 15 Pro 안의 ${title}`}>{frame('device-screen', PHONE_SCREEN)}</MobileFramePreview>
      ) : viewport === 'tablet' ? (
        <ScaledFrame {...TABLET}>{frame('preview-frame')}</ScaledFrame>
      ) : (
        <div className="flex min-h-0 flex-1 bg-sunken">{frame('preview-frame')}</div>
      )}
      {mockup ? <MockupNotes file={mockup.file} target={target} onClear={() => setTarget(null)} /> : null}
    </div>
  );
}

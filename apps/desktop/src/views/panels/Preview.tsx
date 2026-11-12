import { ExternalLink, Play, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Project, ViewportId } from '@studio-zero/protocol';
import { viewportLabel } from '../../lib/format.ts';
import { useAction, useQuery, useStudio } from '../../lib/studio.tsx';
import { Button, Empty, IconButton, Problem } from '../../ui.tsx';

const SIZES: ViewportId[] = ['iphone-15-pro', 'ipad-pro-11', 'desktop-1440'];
const frameClass: Record<ViewportId, string> = { 'iphone-15-pro': 'preview-frame preview-phone', 'ipad-pro-11': 'preview-frame preview-tablet', 'desktop-1440': 'preview-frame' };
const demoShot: Record<ViewportId, string> = { 'iphone-15-pro': 'art_phone', 'ipad-pro-11': 'art_tablet', 'desktop-1440': 'art_desktop' };

/** The running app, at the three widths the audit measures. */
export function Preview({ project }: { project: Project }) {
  const { backend } = useStudio();
  const sandbox = useQuery('sandbox.info', { projectId: project.id }, ['sandbox.state']);
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<ViewportId>('iphone-15-pro');
  const [reloads, setReloads] = useState(0);
  const [demoImage, setDemoImage] = useState<string | null>(null);
  const start = useAction(async () => {
    const preview = await backend.call('preview.start', { projectId: project.id });
    setUrl(preview.localhost);
  });
  const remote = !backend.demo && !['localhost', '127.0.0.1', '[::1]'].includes(backend.host);

  useEffect(() => setUrl(null), [project.id]);
  useEffect(() => {
    if (backend.demo) void backend.artifactUrl(demoShot[size]).then(setDemoImage);
  }, [backend, size]);

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
      <div role="radiogroup" aria-label="화면 크기" className="flex gap-1">
        {SIZES.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={size === id} onClick={() => setSize(id)} className={`min-h-11 min-w-11 rounded-md px-3 text-sm font-medium ${size === id ? 'bg-sunken text-fg' : 'text-fg-muted'}`}>
            {viewportLabel[id]}
          </button>
        ))}
      </div>
      {url ? (
        <div className="flex items-center gap-1">
          <IconButton label="새로 고침" onClick={() => setReloads((n) => n + 1)}>
            <RefreshCw className="size-4" aria-hidden />
          </IconButton>
          <a className="inline-flex size-11 items-center justify-center rounded-md text-fg-muted hover:bg-sunken hover:text-fg" href={url} target="_blank" rel="noreferrer" aria-label="브라우저에서 열기" title="브라우저에서 열기">
            <ExternalLink className="size-4" aria-hidden />
          </a>
        </div>
      ) : null}
    </div>
  );

  if (backend.demo) {
    return (
      <>
        {toolbar}
        <div className="pane-scroll flex min-h-0 flex-1 justify-center bg-sunken p-4">{demoImage ? <img src={demoImage} alt={`${viewportLabel[size]} 크기의 예시 화면`} className={`h-auto max-w-full self-start border border-border ${size === 'iphone-15-pro' ? 'preview-phone' : ''}`} /> : null}</div>
      </>
    );
  }

  if (!url) {
    return (
      <Empty title="프리뷰가 꺼져 있습니다">
        <p>샌드박스에서 개발 서버를 켜면 만들어진 화면을 여기서 바로 볼 수 있습니다.</p>
        {remote ? <p>원격 데몬의 프리뷰 포트는 그 Mac의 localhost에만 열립니다. 이 기기에서 보려면 Mac mini에서 해당 포트를 tailscale serve로 열어 주세요.</p> : null}
        {start.error ? <Problem>{start.error}</Problem> : null}
        {sandbox.error ? <Problem>{sandbox.error}</Problem> : null}
        <Button variant="primary" busy={start.busy} onClick={() => void start.run()} icon={<Play className="size-4" aria-hidden />}>
          프리뷰 켜기
        </Button>
      </Empty>
    );
  }

  return (
    <>
      {toolbar}
      <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-sunken">
        {/* The built app is content, not part of this interface: a sandboxed frame on another origin, with no access to the shell. */}
        <iframe key={`${url}#${reloads}`} title={`${project.name} 프리뷰`} src={url} className={frameClass[size]} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" />
      </div>
    </>
  );
}

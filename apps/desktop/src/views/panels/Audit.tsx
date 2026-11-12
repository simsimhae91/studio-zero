import { ScanEye } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AuditReport, Finding, Project, ViewportId } from '@studio-zero/protocol';
import { ago, ruleTitle, severityLabel, viewportLabel } from '../../lib/format.ts';
import { useAction, useQuery, useStudio } from '../../lib/studio.tsx';
import { Button, Empty, Problem, Status } from '../../ui.tsx';

const rubricLabel: Record<string, string> = { hierarchy: '위계', whitespace: '여백', typography: '타이포그래피', color: '색', copy: '문구', originality: '독창성' };
const severityTone = { blocker: 'bad', major: 'warn', minor: 'neutral' } as const;
const severityOrder = { blocker: 0, major: 1, minor: 2 } as const;

/**
 * The proof view. A finding is not a line in a report: it is a mark on the captured screen, at the measured
 * position, with the change that removes it.
 */
export function Audit({ project }: { project: Project }) {
  const { backend } = useStudio();
  const audits = useQuery('audits.list', { projectId: project.id, limit: 1 }, ['audit.completed']);
  const latest = audits.data?.audits[0];
  const report = useQuery('audits.get', latest ? { auditId: latest.id } : null);
  const run = useAction(async () => {
    await backend.call('audits.run', { projectId: project.id });
    audits.reload();
  });

  if (audits.data && !latest) {
    return (
      <Empty title="아직 감사 결과가 없습니다">
        <p>폰, 태블릿, 데스크톱 크기로 화면을 렌더링해 대비, 터치 영역, 넘침, 글자와 간격을 재고, 디자인 리뷰어가 위계와 여백, 문구를 봅니다.</p>
        {run.error ? <Problem>{run.error}</Problem> : null}
        <Button variant="primary" busy={run.busy} onClick={() => void run.run()} icon={<ScanEye className="size-4" aria-hidden />}>
          지금 감사하기
        </Button>
      </Empty>
    );
  }
  if (!report.data) return audits.error || report.error ? <div className="p-4"><Problem>{audits.error ?? report.error}</Problem></div> : null;
  return <Proof report={report.data} onRun={() => void run.run()} running={run.busy} runError={run.error} />;
}

function Proof({ report, onRun, running, runError }: { report: AuditReport; onRun: () => void; running: boolean; runError: string | null }) {
  const findings = useMemo(() => [...report.findings].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]), [report]);
  const [selected, setSelected] = useState<Finding | null>(findings[0] ?? null);
  const [viewport, setViewport] = useState<ViewportId>(findings[0]?.viewport ?? report.screenshots[0]?.viewport ?? 'iphone-15-pro');
  useEffect(() => {
    setSelected(findings[0] ?? null);
    setViewport(findings[0]?.viewport ?? report.screenshots[0]?.viewport ?? 'iphone-15-pro');
  }, [report.id, findings, report.screenshots]);

  const viewports = [...new Set(report.screenshots.map((s) => s.viewport))];
  const choose = (finding: Finding): void => {
    setSelected(finding);
    if (finding.viewport) setViewport(finding.viewport);
  };

  return (
    <div className="pane-scroll @container flex min-h-0 flex-1 flex-col gap-6 p-4">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="flex flex-col gap-1">
          <p className="text-3xl font-semibold">
            {report.score.toFixed(0)}
            <span className="text-base font-normal text-fg-muted"> / 100, 기준 {report.threshold}</span>
          </p>
          <Status tone={report.passed ? 'good' : 'bad'}>{report.passed ? '통과' : '기준에 못 미칩니다'}</Status>
          <time className="text-sm text-fg-muted" dateTime={new Date(report.createdAt).toISOString()}>
            {ago(report.createdAt)} 측정
          </time>
        </div>
        <Button busy={running} onClick={onRun} icon={<ScanEye className="size-4" aria-hidden />}>
          다시 감사하기
        </Button>
      </header>
      {runError ? <Problem>{runError}</Problem> : null}

      {report.rubric ? (
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 @xl:grid-cols-3">
          {Object.entries(report.rubric).map(([axis, value]) => (
            <div key={axis} className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
              <dt className="text-sm text-fg-muted">{rubricLabel[axis] ?? axis}</dt>
              <dd className="text-base font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-fg-muted">디자인 리뷰는 실행되지 않았습니다. 점수는 측정값만으로 계산했습니다.</p>
      )}

      {/* Findings beside the capture whenever the pane can hold both: the mark should be visible next to what it marks. */}
      <div className="grid gap-6 @xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="flex min-w-0 flex-col gap-3" aria-label="발견 사항">
          <h2 className="text-lg font-semibold">{findings.length === 0 ? '발견 사항이 없습니다' : `발견 사항 ${findings.length}건`}</h2>
          <ul className="flex flex-col">
            {findings.map((f, i) => {
              const active = f === selected;
              return (
                <li key={`${f.rule}-${f.viewport}-${i}`} className="border-t border-border">
                  <button type="button" onClick={() => choose(f)} aria-pressed={active} className={`flex min-h-11 w-full flex-col items-start gap-2 border-l-4 px-3 py-3 text-left ${active ? 'border-accent bg-surface' : 'border-transparent'}`}>
                    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <Status tone={severityTone[f.severity]}>{severityLabel[f.severity]}</Status>
                      <span className="text-sm text-fg-muted">
                        {f.viewport ? viewportLabel[f.viewport] : '소스'}, {f.source === 'vlm' ? '디자인 리뷰' : f.source === 'lint' ? '린트' : '측정'}
                      </span>
                    </span>
                    <span className="text-base font-medium">{ruleTitle(f.rule)}</span>
                    <span className="text-base">{f.message}</span>
                    {active && f.fix ? <span className="text-base text-fg-muted">고치는 법: {f.fix}</span> : null}
                    {active && f.selector ? <code className="break-all font-mono text-sm text-fg-muted">{f.selector}</code> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="flex min-w-0 flex-col gap-3" aria-label="캡처">
          <div role="radiogroup" aria-label="캡처 크기" className="flex gap-1">
            {viewports.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={viewport === id} onClick={() => setViewport(id)} className={`min-h-11 min-w-11 rounded-md px-3 text-sm font-medium ${viewport === id ? 'bg-sunken text-fg' : 'text-fg-muted'}`}>
                {viewportLabel[id]}
              </button>
            ))}
          </div>
          <Capture report={report} viewport={viewport} finding={selected?.viewport === viewport ? selected : null} />
        </section>
      </div>
    </div>
  );
}

/** One captured screenful with the selected finding marked on it. Positions are percentages of the capture, so the mark stays put at any display size. */
function Capture({ report, viewport, finding }: { report: AuditReport; viewport: ViewportId; finding: Finding | null }) {
  const { backend } = useStudio();
  const folds = report.screenshots.filter((s) => s.viewport === viewport && (finding?.route == null || s.route === finding.route)).sort((a, b) => a.fold - b.fold);
  const foldHeight = folds[0]?.height ?? 1;
  const index = finding?.bbox ? Math.min(folds.length - 1, Math.max(0, Math.floor(finding.bbox.y / foldHeight))) : 0;
  const shot = folds[index];
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    setSrc(null);
    setFailed(null);
    if (!shot) return;
    let stale = false;
    backend.artifactUrl(shot.artifactId).then(
      (url) => !stale && setSrc(url),
      (err: unknown) => !stale && setFailed(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      stale = true;
    };
  }, [backend, shot?.artifactId]);

  if (!shot) return <p className="text-base text-fg-muted">이 크기의 캡처가 없습니다.</p>;
  if (failed) return <Problem>캡처를 불러오지 못했습니다. {failed}</Problem>;
  const box = finding?.bbox;
  const pct = (value: number, of: number): string => `${Math.min(100, Math.max(0, (value / of) * 100))}%`;
  return (
    <figure className="flex flex-col gap-2">
      <div className="relative self-start overflow-hidden border border-border bg-surface">
        {src ? <img src={src} alt={`${viewportLabel[viewport]} 캡처, ${shot.route}`} width={shot.width} height={shot.height} className="block h-auto max-w-full" /> : <div className="h-64 w-48" aria-hidden />}
        {src && box ? (
          <div
            className="proof-mark"
            style={{ left: pct(box.x, shot.width), top: pct(box.y - index * foldHeight, shot.height), width: pct(Math.min(box.w, shot.width - box.x), shot.width), height: pct(box.h, shot.height) }}
            role="img"
            aria-label="선택한 발견 사항의 위치"
          />
        ) : null}
      </div>
      <figcaption className="text-sm text-fg-muted">
        {shot.route}, {shot.width}×{shot.height}
        {folds.length > 1 ? `, ${index + 1}/${folds.length}번째 화면` : ''}
        {finding && !box ? ', 이 발견 사항은 화면 전체에 대한 것입니다' : ''}
      </figcaption>
    </figure>
  );
}

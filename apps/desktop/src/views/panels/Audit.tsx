import { ChevronLeft, ChevronRight, ScanEye, TriangleAlert, WandSparkles } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import { UNREVIEWED_SCORE_CAP, type AuditReport, type DesignGrade, type Finding, type FindingCategory, type Project, type RedesignPatch, type Task, type ViewportId } from '@studio-zero/protocol';
import { ago, archetypeLabel, gradeLabel, redesignActionLabel, reviewerLabel, ruleTitle, severityLabel, viewportLabel, visionGap } from '../../lib/format.ts';
import { useAction, useQuery, useStudio } from '../../lib/studio.tsx';
import { Button, Empty, IconButton, Problem, Status } from '../../ui.tsx';

const rubricLabel: Record<string, string> = { hierarchy: '위계', whitespace: '여백', typography: '타이포그래피', color: '색', copy: '문구', originality: '독창성', tactility: '촉감' };
const severityTone = { blocker: 'bad', major: 'warn', minor: 'neutral' } as const;
const severityOrder = { blocker: 0, major: 1, minor: 2 } as const;
const gradeTone: Record<DesignGrade, string> = { S: 'border-success text-success', A: 'border-success text-success', B: 'border-success text-success', C: 'border-warning text-warning', D: 'border-warning text-warning', F: 'border-danger text-danger' };

/** The three things a design lead's notes are about. Every finding category files under one of them. */
const GROUPS: readonly { title: string; categories: readonly FindingCategory[] }[] = [
  { title: '위계와 레이아웃', categories: ['hierarchy', 'spacing', 'responsive', 'originality'] },
  { title: '촉감과 어포던스', categories: ['tactility', 'touch-target'] },
  { title: '타이포그래피와 톤', categories: ['typography', 'contrast', 'color', 'copy'] },
];

/** A finding with the number it carries in the notes and on the capture. */
interface Note {
  n: number;
  finding: Finding;
}

type Picked = { kind: 'note'; n: number } | { kind: 'patch'; index: number } | null;

interface View {
  viewport: ViewportId;
  route: string;
  fold: number;
}

/**
 * The proof view. A finding is not a line in a report: it is a mark on the captured screen, at the measured
 * position, with the change that removes it. The verdict says who looked: a grade exists only when a design
 * reviewer saw every screen, and when none did the view says that instead of showing a number that looks earned.
 */
export function Audit({ project, onTaskStarted }: { project: Project; onTaskStarted?: (task: Task) => void }) {
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
        <p>폰, 태블릿, 데스크톱 크기로 화면을 렌더링해 대비, 터치 영역, 넘침, 글자와 간격을 재고, 디자인 리뷰어가 위계와 촉감, 문구를 보고 다시 설계할 곳을 짚습니다.</p>
        {run.error ? <Problem>{run.error}</Problem> : null}
        <Button variant="primary" busy={run.busy} onClick={() => void run.run()} icon={<ScanEye className="size-4" aria-hidden />}>
          지금 감사하기
        </Button>
      </Empty>
    );
  }
  if (!report.data) return audits.error || report.error ? <div className="p-4"><Problem>{audits.error ?? report.error}</Problem></div> : null;
  return <Proof report={report.data} onRun={() => void run.run()} running={run.busy} runError={run.error} onTaskStarted={onTaskStarted} />;
}

const foldOf = (report: AuditReport, viewport: ViewportId, route: string, y: number): number => {
  const folds = report.screenshots.filter((s) => s.viewport === viewport && s.route === route);
  const height = folds.find((s) => s.fold === 0)?.height ?? 1;
  return Math.min(Math.max(0, folds.length - 1), Math.max(0, Math.floor(y / height)));
};

/** The same move on the same element is one line of the plan, however many viewports asked for it. */
function distinctPatches(patches: readonly RedesignPatch[]): RedesignPatch[] {
  const seen = new Set<string>();
  return patches.filter((p) => {
    const key = `${p.route}|${p.action}|${p.target ?? ''}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

function Proof({ report, onRun, running, runError, onTaskStarted }: { report: AuditReport; onRun: () => void; running: boolean; runError: string | null; onTaskStarted?: (task: Task) => void }) {
  const { backend } = useStudio();
  const notes = useMemo<Note[]>(() => [...report.findings].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]).map((finding, i) => ({ n: i + 1, finding })), [report]);
  const plan = useMemo(() => distinctPatches(report.redesignPatches), [report]);

  const first = (): View => {
    const lead = notes.find((note) => note.finding.viewport && note.finding.bbox)?.finding ?? null;
    const shot = report.screenshots[0];
    const viewport = lead?.viewport ?? shot?.viewport ?? 'iphone-15-pro';
    const route = lead?.route ?? report.screenshots.find((s) => s.viewport === viewport)?.route ?? shot?.route ?? '/';
    return { viewport, route, fold: lead?.bbox ? foldOf(report, viewport, route, lead.bbox.y) : 0 };
  };
  const [view, setView] = useState<View>(first);
  const [picked, setPicked] = useState<Picked>(notes[0] ? { kind: 'note', n: notes[0].n } : null);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    setView(first());
    setPicked(notes[0] ? { kind: 'note', n: notes[0].n } : null);
    setStarted(false);
    // A new report resets what is being looked at; `first` reads only that report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id]);

  const redesign = useAction(async () => {
    const task = await backend.call('audits.redesign', { auditId: report.id });
    setStarted(true);
    onTaskStarted?.(task);
  });

  const show = (at: { viewport: ViewportId | null; route: string | null; bbox: Finding['bbox'] }): void => {
    const viewport = at.viewport ?? view.viewport;
    const route = at.route ?? view.route;
    setView({ viewport, route, fold: at.bbox ? foldOf(report, viewport, route, at.bbox.y) : 0 });
  };
  const pickNote = (note: Note): void => {
    setPicked({ kind: 'note', n: note.n });
    if (note.finding.viewport) show(note.finding);
  };
  const pickPatch = (index: number): void => {
    setPicked({ kind: 'patch', index });
    show(plan[index]!);
  };

  const viewports = [...new Set(report.screenshots.map((s) => s.viewport))];
  const routes = [...new Set(report.screenshots.filter((s) => s.viewport === view.viewport).map((s) => s.route))];
  const actionable = notes.length > 0 || plan.length > 0;

  return (
    <div className="pane-scroll @container flex min-h-0 flex-1 flex-col p-4">
      {/* Notes beside the capture whenever the pane can hold both: a mark should be visible next to what it marks. */}
      <div className="grid gap-6 @xl:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
        <div className="contents @xl:flex @xl:min-w-0 @xl:flex-col @xl:gap-6">
          <div className="order-1 flex flex-col gap-4">
            <Verdict report={report} />
            {runError ? <Problem>{runError}</Problem> : null}
          </div>

          <div className="order-3 flex min-w-0 flex-col gap-6">
            {report.critique ? (
              <figure className="flex flex-col gap-2 border-l-4 border-accent pl-4">
                <blockquote className="text-base">{report.critique}</blockquote>
                <figcaption className="text-sm text-fg-muted">디자인 리드의 평</figcaption>
              </figure>
            ) : null}

            <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4" aria-label="다음에 할 일">
              {plan.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <h2 className="text-lg font-semibold">재설계 계획</h2>
                  <ol className="flex flex-col">
                    {plan.map((patch, index) => {
                      const active = picked?.kind === 'patch' && picked.index === index;
                      return (
                        <li key={`${patch.route}-${patch.action}-${patch.target ?? index}`} className="max-w-none border-t border-border">
                          <button type="button" onClick={() => pickPatch(index)} aria-pressed={active} className={`flex min-h-11 w-full flex-col items-start gap-1 border-l-4 px-3 py-3 text-left ${active ? 'border-accent bg-sunken' : 'border-transparent'}`}>
                            <span className="text-sm font-medium text-accent">{redesignActionLabel[patch.action]}</span>
                            <span className="text-base">{patch.instruction}</span>
                            {active && patch.target ? <code className="break-all font-mono text-sm text-fg-muted">{patch.target}</code> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ) : null}
              {redesign.error ? <Problem>{redesign.error}</Problem> : null}
              {started ? <Status tone="active">다시 디자인하는 작업을 시작했습니다. 끝나면 같은 심사를 다시 받습니다.</Status> : null}
              <div className="flex flex-wrap gap-2">
                {actionable ? (
                  <Button variant={report.visionReviewed ? 'primary' : 'quiet'} busy={redesign.busy} disabled={started} onClick={() => void redesign.run()} icon={<WandSparkles className="size-4" aria-hidden />}>
                    {report.visionReviewed ? '디자이너 피드백대로 다시 디자인' : '측정된 문제만 고치기'}
                  </Button>
                ) : null}
                <Button variant={report.visionReviewed ? 'quiet' : 'primary'} busy={running} onClick={onRun} icon={<ScanEye className="size-4" aria-hidden />}>
                  다시 감사하기
                </Button>
              </div>
            </section>

            {report.rubric ? (
              <dl className="grid grid-cols-2 gap-x-6">
                {Object.entries(report.rubric).map(([axis, value]) => (
                  <div key={axis} className="flex items-baseline justify-between gap-3 border-t border-border py-2">
                    <dt className="text-sm text-fg-muted">{rubricLabel[axis] ?? axis}</dt>
                    <dd className="text-base font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <Notes notes={notes} report={report} picked={picked?.kind === 'note' ? picked.n : null} onPick={pickNote} />
          </div>
        </div>

        <section className="order-2 flex min-w-0 flex-col gap-3 @xl:sticky @xl:top-0 @xl:self-start" aria-label="캡처">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="radiogroup" aria-label="캡처 크기" className="flex gap-1">
              {viewports.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={view.viewport === id}
                  onClick={() => setView({ viewport: id, route: report.screenshots.some((s) => s.viewport === id && s.route === view.route) ? view.route : (report.screenshots.find((s) => s.viewport === id)?.route ?? view.route), fold: 0 })}
                  className={`min-h-11 min-w-11 rounded-md px-3 text-sm font-medium ${view.viewport === id ? 'bg-sunken text-fg' : 'text-fg-muted'}`}
                >
                  {viewportLabel[id]}
                </button>
              ))}
            </div>
            {routes.length > 1 ? (
              <div role="radiogroup" aria-label="캡처한 경로" className="flex flex-wrap gap-1">
                {routes.map((route) => (
                  <button key={route} type="button" role="radio" aria-checked={view.route === route} onClick={() => setView({ ...view, route, fold: 0 })} className={`min-h-11 min-w-11 break-all rounded-md px-3 text-sm ${view.route === route ? 'bg-sunken text-fg' : 'text-fg-muted'}`}>
                    <code>{route}</code>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <Capture report={report} view={view} notes={notes} patch={picked?.kind === 'patch' ? (plan[picked.index] ?? null) : null} picked={picked?.kind === 'note' ? picked.n : null} onPick={pickNote} onFold={(fold) => setView({ ...view, fold })} />
        </section>
      </div>
    </div>
  );
}

/** Who judged this, and what they concluded. Without a design review there is no grade to show, only that fact. */
function Verdict({ report }: { report: AuditReport }) {
  const measured = (
    <time className="text-sm text-fg-muted" dateTime={new Date(report.createdAt).toISOString()}>
      {ago(report.createdAt)} 측정
    </time>
  );
  if (!report.visionReviewed) {
    return (
      <header className="flex flex-col gap-3 rounded-lg border border-warning bg-surface p-4">
        <div className="flex items-start gap-3">
          <TriangleAlert className="size-6 shrink-0 text-warning" aria-hidden />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-2xl font-semibold">비전 심사 미실행 (디자인 미보증)</h2>
            <p className="text-base">{visionGap(report.vision)} 이 화면을 디자이너의 눈으로 본 사람이 없습니다.</p>
          </div>
        </div>
        <p className="text-base text-fg-muted">
          측정으로 알 수 있는 것은 글자가 읽히고 버튼이 눌리는지까지입니다. 그래서 점수는 측정값만으로 계산해 {UNREVIEWED_SCORE_CAP}점을 넘지 않게 했고, 디자인 심사를 받기 전에는 감사를 통과하지 못합니다.
        </p>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="text-base">
            <span className="font-semibold">{report.score.toFixed(0)}</span> / 100, 기준 {report.threshold}
          </p>
          <Status tone="warn">디자인 미보증</Status>
          {measured}
        </div>
        {/* What a reviewer's command line said when it refused: a program's output, set as one. */}
        {report.vision.reason ? (
          <p className="break-words text-sm text-fg-muted">
            <samp>{report.vision.reason}</samp>
          </p>
        ) : null}
      </header>
    );
  }
  const grade = report.grade;
  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        {grade ? (
          <p className={`flex size-20 shrink-0 items-center justify-center rounded-lg border-2 bg-surface text-5xl font-semibold ${gradeTone[grade]}`} aria-label={`디자인 등급 ${grade}`}>
            {grade}
          </p>
        ) : null}
        <h2 className="min-w-0 text-2xl font-semibold">{grade ? gradeLabel[grade] : report.passed ? '통과' : '기준 미달'}</h2>
      </div>
      <p className="text-base">
        <span className="font-semibold">{report.score.toFixed(0)}</span> / 100, 기준 {report.threshold}
        {report.slopScore === null ? '' : `, 슬롭 지수 ${report.slopScore} (낮을수록 좋습니다)`}
      </p>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <Status tone={report.passed ? 'good' : 'bad'}>{report.passed ? '통과' : '기준에 못 미칩니다'}</Status>
        {report.archetype ? <span className="text-sm text-fg-muted">화면 유형: {archetypeLabel[report.archetype]}</span> : null}
      </div>
      <p className="text-sm text-fg-muted">
        {report.vision.via ? `${reviewerLabel[report.vision.via]}으로 화면 ${report.vision.reviewed}개를 심사했습니다. ` : ''}
        {measured}
      </p>
    </header>
  );
}

/** The reviewer's notes, filed under what they are about. The number on a note is the number on its mark. */
function Notes({ notes, report, picked, onPick }: { notes: Note[]; report: AuditReport; picked: number | null; onPick: (note: Note) => void }) {
  // With no review, an empty list is only what the measurements found: it must not read as a clean bill.
  if (notes.length === 0) return <h2 className="text-lg font-semibold">{report.visionReviewed ? '발견 사항이 없습니다' : '측정으로 찾은 문제는 없습니다'}</h2>;
  return (
    <section className="flex min-w-0 flex-col gap-6" aria-label="발견 사항">
      {GROUPS.map((group) => {
        const mine = notes.filter((note) => group.categories.includes(note.finding.category));
        if (mine.length === 0) return null;
        return (
          <div key={group.title} className="flex flex-col gap-2">
            <h2 className="flex items-baseline justify-between gap-3 text-lg font-semibold">
              {group.title}
              <span className="text-sm font-normal text-fg-muted">{mine.length}건</span>
            </h2>
            <ul className="flex flex-col">
              {mine.map((note) => {
                const f = note.finding;
                const active = note.n === picked;
                const patch = active ? patchFor(report, f) : null;
                return (
                  <li key={note.n} className="max-w-none border-t border-border">
                    <button type="button" onClick={() => onPick(note)} aria-pressed={active} className={`flex min-h-11 w-full flex-col items-start gap-2 border-l-4 px-3 py-3 text-left ${active ? 'border-accent bg-surface' : 'border-transparent'}`}>
                      <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className={`proof-number ${f.severity === 'minor' ? 'bg-fg-muted' : 'bg-danger'}`} aria-hidden>
                          {note.n}
                        </span>
                        <Status tone={severityTone[f.severity]}>{severityLabel[f.severity]}</Status>
                        <span className="text-sm text-fg-muted">
                          {f.viewport ? viewportLabel[f.viewport] : '소스'}, {f.source === 'vlm' ? '디자인 리뷰' : f.source === 'lint' ? '린트' : '측정'}
                        </span>
                      </span>
                      <span className="text-base font-medium">{ruleTitle(f.rule)}</span>
                      <span className="text-base">{f.message}</span>
                      {active && f.fix ? <span className="text-base text-fg-muted">고치는 법: {f.fix}</span> : null}
                      {patch ? (
                        <span className="text-base text-fg-muted">
                          재설계: {redesignActionLabel[patch.action]}. {patch.instruction}
                        </span>
                      ) : null}
                      {active && f.selector ? <code className="break-all font-mono text-sm text-fg-muted">{f.selector}</code> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/** The redesign move prescribed for the element a finding is about, if the reviewer wrote one. */
function patchFor(report: AuditReport, finding: Finding): RedesignPatch | null {
  if (!finding.selector) return null;
  return report.redesignPatches.find((p) => p.target === finding.selector && p.route === finding.route) ?? null;
}

const pct = (value: number, of: number): number => Math.min(100, Math.max(0, (value / of) * 100));

/** Where a mark sits on the shown screenful, as percentages of it, so it stays put at any display size. */
function place(bbox: NonNullable<Finding['bbox']>, shot: { width: number; height: number }, fold: number, foldHeight: number): { left: number; top: number; width: number; height: number } {
  const left = pct(bbox.x, shot.width);
  const top = pct(bbox.y - fold * foldHeight, shot.height);
  return { left, top, width: Math.min(100 - left, pct(bbox.w, shot.width)), height: Math.min(100 - top, pct(bbox.h, shot.height)) };
}

/** Beside the mark, on whichever side has room; a mark that covers much of the screen carries its note inside it. */
function beside(box: { left: number; top: number; width: number; height: number }): CSSProperties {
  const vertical = box.height >= 40 ? { top: `calc(${box.top}% + 1.25rem)` } : box.top + box.height / 2 < 55 ? { top: `calc(${box.top + box.height}% + 0.75rem)` } : { bottom: `calc(${100 - box.top}% + 0.75rem)` };
  return { ...vertical, ...(box.left + box.width / 2 < 50 ? { left: `${box.left}%` } : { right: `${Math.max(0, 100 - box.left - box.width)}%` }) };
}

/**
 * One captured screenful with every located finding of this viewport marked on it. Pointing at a mark, or
 * focusing its number, shows the design lead's note and the proposed fix beside it; choosing it opens the note.
 */
function Capture({ report, view, notes, patch, picked, onPick, onFold }: { report: AuditReport; view: View; notes: Note[]; patch: RedesignPatch | null; picked: number | null; onPick: (note: Note) => void; onFold: (fold: number) => void }) {
  const { backend } = useStudio();
  const tipId = useId();
  const folds = report.screenshots.filter((s) => s.viewport === view.viewport && s.route === view.route).sort((a, b) => a.fold - b.fold);
  const foldHeight = folds[0]?.height ?? 1;
  const index = Math.min(Math.max(0, folds.length - 1), view.fold);
  const shot = folds[index];
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pointed, setPointed] = useState<number | null>(null);

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

  const onThisFold = (bbox: NonNullable<Finding['bbox']>): boolean => Math.min(Math.max(0, folds.length - 1), Math.max(0, Math.floor(bbox.y / foldHeight))) === index;
  const located = notes.flatMap((note) => {
    const f = note.finding;
    return f.viewport === view.viewport && f.route === view.route && f.bbox && onThisFold(f.bbox) ? [{ note, box: place(f.bbox, shot, index, foldHeight) }] : [];
  });
  // Boxes that start at the same corner would stack their numbers on one spot: each later one steps to the right.
  const marks = located.map((mark, i) => ({ ...mark, step: located.slice(0, i).filter((other) => Math.abs(other.box.left - mark.box.left) < 5 && Math.abs(other.box.top - mark.box.top) < 5).length }));
  // The note of a chosen mark is already open in the list; the capture explains only what is being pointed at.
  const told = marks.find((m) => m.note.n === pointed) ?? null;
  const patchBox = patch && patch.viewport === view.viewport && patch.route === view.route && patch.bbox && onThisFold(patch.bbox) ? place(patch.bbox, shot, index, foldHeight) : null;
  const wholeScreen = picked !== null && !marks.some((m) => m.note.n === picked) && notes.some((note) => note.n === picked && note.finding.viewport === view.viewport && !note.finding.bbox);

  return (
    <figure className="flex flex-col gap-2">
      <div className="relative self-start border border-border bg-surface">
        {src ? <img src={src} alt={`${viewportLabel[view.viewport]} 캡처, ${shot.route}`} width={shot.width} height={shot.height} className="block h-auto max-h-[72vh] w-auto max-w-full" /> : <div className="h-64 w-48" aria-hidden />}
        {src
          ? marks.map(({ note, box, step }) => {
              const active = note.n === picked;
              const tone = note.finding.severity === 'minor' ? 'minor' : 'slop';
              return (
                <div key={note.n}>
                  <div className="proof-mark" data-tone={tone} data-active={active || note.n === pointed} style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }} onMouseEnter={() => setPointed(note.n)} onMouseLeave={() => setPointed(null)} />
                  <button
                    type="button"
                    onClick={() => onPick(note)}
                    onMouseEnter={() => setPointed(note.n)}
                    onMouseLeave={() => setPointed(null)}
                    onFocus={() => setPointed(note.n)}
                    onBlur={() => setPointed(null)}
                    aria-pressed={active}
                    aria-label={`${note.n}번 지적, ${severityLabel[note.finding.severity]}: ${ruleTitle(note.finding.rule)}`}
                    aria-describedby={told?.note.n === note.n ? tipId : undefined}
                    className={`proof-number proof-pin ${tone === 'minor' ? 'bg-fg-muted' : 'bg-danger'}`}
                    style={{ left: `calc(${box.left}% + ${step * 1.75}rem)`, top: `${box.top}%` }}
                  >
                    {note.n}
                  </button>
                </div>
              );
            })
          : null}
        {src && patchBox ? <div className="proof-mark" data-tone="patch" data-active style={{ left: `${patchBox.left}%`, top: `${patchBox.top}%`, width: `${patchBox.width}%`, height: `${patchBox.height}%` }} role="img" aria-label="재설계할 요소의 위치" /> : null}
        {src && told ? (
          <div role="tooltip" id={tipId} className="pointer-events-none absolute z-20 flex w-72 max-w-full flex-col gap-2 rounded-md border border-border bg-surface p-3 text-left shadow-md" style={beside(told.box)}>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Status tone={severityTone[told.note.finding.severity]}>{severityLabel[told.note.finding.severity]}</Status>
              <span className="text-sm font-medium">{ruleTitle(told.note.finding.rule)}</span>
            </span>
            <span className="text-base">{told.note.finding.message}</span>
            {told.note.finding.fix ? <span className="text-base text-fg-muted">제안: {told.note.finding.fix}</span> : null}
          </div>
        ) : null}
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
        <span>
          {shot.route}, {shot.width}×{shot.height}
          {marks.length > 0 ? `, 표시 ${marks.length}곳` : ''}
          {wholeScreen ? ', 선택한 지적은 화면 전체에 대한 것입니다' : ''}
        </span>
        {folds.length > 1 ? (
          <span className="flex items-center gap-1">
            <IconButton label="이전 화면" disabled={index === 0} onClick={() => onFold(index - 1)} className="disabled:opacity-60">
              <ChevronLeft className="size-4" aria-hidden />
            </IconButton>
            {index + 1} / {folds.length}번째 화면
            <IconButton label="다음 화면" disabled={index === folds.length - 1} onClick={() => onFold(index + 1)} className="disabled:opacity-60">
              <ChevronRight className="size-4" aria-hidden />
            </IconButton>
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

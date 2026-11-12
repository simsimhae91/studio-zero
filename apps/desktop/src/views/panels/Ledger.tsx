import type { LedgerDelta, LedgerEntry, Project, Task } from '@studio-zero/protocol';
import { duration, engineLabel, kindLabel, reviewerLabel, stamp, tokens } from '../../lib/format.ts';
import { useQuery } from '../../lib/studio.tsx';
import { Empty, Problem, Status } from '../../ui.tsx';

const pct = (share: number | null): string => (share === null ? '재지 않음' : `${Math.round(share * 100)}%`);
const size = (bytes: number | null): string => (bytes === null ? '재지 않음' : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`);
const dollars = (micros: number): string => (micros === 0 ? '구독' : `$${(micros / 1_000_000).toFixed(2)}`);

/**
 * The project's ledger: one receipt per finished task, newest first, and above them how the judged score and
 * the slop score have moved from task to task. Every figure is the daemon's own measurement.
 */
export function Ledger({ project }: { project: Project }) {
  const ledger = useQuery('ledger.list', { projectId: project.id, limit: 60 }, ['ledger.recorded']);
  const tasks = useQuery('tasks.list', { projectId: project.id, limit: 200 }, ['ledger.recorded']);
  const entries = ledger.data?.entries ?? [];
  const byId = new Map((tasks.data?.tasks ?? []).map((t) => [t.id, t]));

  return (
    <div className="flex flex-col gap-8 p-4">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">장부</h2>
          <p className="text-base text-fg-muted">끝난 작업마다 영수증 한 장. 숫자는 엔진의 자기 보고가 아니라 데몬이 돌린 검사와 사용량 기록에서 나옵니다.</p>
        </div>
        {ledger.error ? <Problem>{ledger.error}</Problem> : null}
        {ledger.data && entries.length === 0 ? <Empty title="아직 영수증이 없습니다">첫 작업이 끝나면 타입 에러, 디자인 등급, 토큰이 여기에 찍힙니다.</Empty> : null}
        {entries.length > 0 ? <Trend entries={entries} /> : null}
      </section>

      {entries.length > 0 ? (
        <ol className="flex flex-col" aria-label="작업별 영수증">
          {entries.map((entry) => (
            <Receipt key={entry.id} entry={entry} task={byId.get(entry.taskId) ?? null} />
          ))}
        </ol>
      ) : null}
    </div>
  );
}

const W = 640;
const H = 160;
const PAD = 12;

/** Design score and slop score across the graded tasks, oldest on the left. Drawn in theme colours; the table below is the same data in words. */
function Trend({ entries }: { entries: readonly LedgerEntry[] }) {
  const graded = [...entries].reverse().filter((e) => e.design.score !== null);
  if (graded.length < 2) return <p className="text-sm text-fg-muted">디자인 심사를 받은 작업이 두 건이 되면 점수 변화가 그래프로 나옵니다.</p>;
  const x = (i: number): number => PAD + (i * (W - PAD * 2)) / (graded.length - 1);
  const y = (value: number): number => H - PAD - (Math.max(0, Math.min(100, value)) * (H - PAD * 2)) / 100;
  const line = (pick: (e: LedgerEntry) => number | null): string => graded.flatMap((e, i) => { const v = pick(e); return v === null ? [] : [`${x(i).toFixed(1)},${y(v).toFixed(1)}`]; }).join(' ');
  const first = graded[0]!;
  const last = graded.at(-1)!;
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`디자인 점수 ${first.design.score}에서 ${last.design.score}, 슬롭 지수 ${first.design.slopScore ?? '없음'}에서 ${last.design.slopScore ?? '없음'}. 작업 ${graded.length}건.`} className="h-40 w-full rounded-md border border-border bg-surface">
        {[0, 50, 100].map((mark) => (
          <line key={mark} x1={PAD} x2={W - PAD} y1={y(mark)} y2={y(mark)} stroke="var(--color-border)" strokeWidth="1" />
        ))}
        <polyline points={line((e) => e.design.slopScore)} fill="none" stroke="var(--color-fg-muted)" strokeWidth="2" strokeDasharray="6 4" strokeLinejoin="round" />
        <polyline points={line((e) => e.design.score)} fill="none" stroke="var(--color-accent)" strokeWidth="3" strokeLinejoin="round" />
        {graded.map((e, i) => (
          <circle key={e.id} cx={x(i)} cy={y(e.design.score ?? 0)} r="4" fill={e.outcome === 'succeeded' ? 'var(--color-accent)' : 'var(--color-danger)'}>
            <title>{`${stamp(e.createdAt)} · 점수 ${e.design.score}${e.design.grade ? ` · 등급 ${e.design.grade}` : ''}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-fg-muted">
        <span className="font-medium text-accent">실선: 디자인 점수 (높을수록 좋음)</span>
        <span>점선: 슬롭 지수 (낮을수록 좋음)</span>
        <span>왼쪽이 오래된 작업</span>
      </figcaption>
    </figure>
  );
}

function Delta({ delta }: { delta: LedgerDelta }) {
  const tone = delta.better === null ? 'text-fg-muted' : delta.better ? 'text-success' : 'text-danger';
  return (
    <li className="max-w-none text-sm">
      <span className="text-fg-muted">{delta.metric} </span>
      <span className={`font-medium ${tone}`}>
        {delta.before} → {delta.after}
      </span>
    </li>
  );
}

function Row({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border py-1">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

function Receipt({ entry, task }: { entry: LedgerEntry; task: Task | null }) {
  const { code, design, cost, review } = entry;
  const checks = code.checksPassed + code.checksFailed.length;
  return (
    <li className="flex max-w-none flex-col gap-3 border-t border-border py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="line-clamp-1 min-w-0 flex-1 break-all text-base font-semibold">{task?.prompt.split('\n')[0] ?? entry.taskId}</h3>
        <Status tone={entry.outcome === 'succeeded' ? 'good' : 'bad'}>{entry.outcome === 'succeeded' ? '완료' : '실패'}</Status>
      </div>
      <p className="text-sm text-fg-muted">
        {[kindLabel[entry.taskKind], entry.track === 'fast' ? '초안' : null, entry.engine ? (engineLabel[entry.engine] ?? entry.engine) : null, stamp(entry.createdAt)].filter(Boolean).join(' · ')}
      </p>
      {entry.delta.length > 0 ? (
        <ul className="flex flex-wrap gap-x-6 gap-y-1" aria-label="직전 작업 대비">
          {entry.delta.map((d) => (
            <Delta key={d.metric} delta={d} />
          ))}
        </ul>
      ) : null}
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-3">
        <dl className="flex flex-col">
          <dt className="pb-1 text-sm font-semibold">코드</dt>
          <Row label="타입 에러">{code.compilerErrors === null ? '컴파일할 것 없음' : code.firstCompilerErrors !== null && code.firstCompilerErrors !== code.compilerErrors ? `${code.firstCompilerErrors} → ${code.compilerErrors}` : String(code.compilerErrors)}</Row>
          <Row label="검증 회차">{`${code.verifyRounds}회`}</Row>
          <Row label="회귀 체크">{checks === 0 ? '없음' : code.checksFailed.length === 0 ? `${checks}건 통과` : `실패: ${code.checksFailed.join(', ')}`}</Row>
          <Row label="빌드">{code.buildMs === null ? '재지 않음' : `${duration(code.buildMs)}, ${size(code.bundleBytes)}`}</Row>
        </dl>
        <dl className="flex flex-col">
          <dt className="pb-1 text-sm font-semibold">디자인</dt>
          <Row label="등급과 점수">{design.grade === null ? (design.score === null ? '감사 없음' : `심사 없음, ${design.score}점`) : `${design.grade}, ${design.score}점`}</Row>
          <Row label="슬롭 지수">{design.slopScore === null ? '심사 없음' : String(design.slopScore)}</Row>
          <Row label="첫 화면 볼거리">{design.livingVisual === null ? '심사 없음' : design.livingVisual ? '있음' : '없음'}</Row>
          <Row label="텍스트 슬롭">{design.textSlop === null ? '재지 않음' : design.textSlop === 0 ? '0건' : `${design.textSlop}건`}</Row>
          <Row label="AAA 대비">{pct(design.contrastAaa)}</Row>
          <Row label="터치 타깃">{pct(design.touchTargets)}</Row>
        </dl>
        <dl className="flex flex-col">
          <dt className="pb-1 text-sm font-semibold">비용</dt>
          <Row label="모델 호출">{`${cost.modelCalls}회`}</Row>
          <Row label="토큰 (입력 / 출력)">{`${tokens(cost.inputTokens)} / ${tokens(cost.outputTokens)}`}</Row>
          <Row label="금액">{dollars(cost.usdMicros)}</Row>
          <Row label="걸린 시간">{duration(cost.wallMs)}</Row>
          <Row label="계획 교차 검토">{review.plan ? reviewerLabel[review.plan] : '받지 않음'}</Row>
          <Row label="최종 인수 검수">{review.acceptance ? `${reviewerLabel[review.acceptance]}, ${review.verdict === 'patch' ? '보정 패치 1건' : '통과'}` : '받지 않음'}</Row>
        </dl>
      </div>
    </li>
  );
}

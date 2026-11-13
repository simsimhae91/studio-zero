import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AcceptanceVerdict, AuditReport, DesignGrade, FlowTotals, LedgerDelta, LedgerEntry, Project, ReviewerId, Task } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { COPY_RULE_PREFIX } from '../qa/checks.ts';
import { errorMessage, newId, type Clock, type Logger } from '../util/core.ts';

/** What a task's run measured, gathered by the harness as it went. The ledger adds the cost and the comparison. */
export interface RunRecord {
  /** Verification rounds run. */
  rounds: number;
  /** Errors on the first compile of the task and on the last; null when there was nothing to compile. */
  firstCompilerErrors: number | null;
  compilerErrors: number | null;
  /** Regression commands on the last round: how many passed, and which did not. */
  checksPassed: number;
  checksFailed: string[];
  /** The last visual audit of the task. */
  audit: AuditReport | null;
  build: { ms: number; bytes: number | null } | null;
  /** The screen spec's core flow as last walked on the running app, and what that walk found wrong. Null when there was nothing to walk by. */
  flow: (FlowTotals & { problems: string[] }) | null;
  planReviewer: ReviewerId | null;
  acceptanceReviewer: ReviewerId | null;
  /** How acceptance ended. `patched` only once the harness has seen the patch land (see `AcceptanceVerdict`). */
  verdict: AcceptanceVerdict | null;
}

export const emptyRun = (): RunRecord => ({ rounds: 0, firstCompilerErrors: null, compilerErrors: null, checksPassed: 0, checksFailed: [], audit: null, build: null, flow: null, planReviewer: null, acceptanceReviewer: null, verdict: null });

/**
 * How many errors a failed compile reported. `tsc` numbers its errors, so those are counted; any other tool's
 * failure is at least one error, and its lines that say "error" are counted up to what it printed.
 */
export function countCompilerErrors(output: string, passed: boolean): number {
  if (passed) return 0;
  const typed = output.match(/\berror TS\d+\b/g)?.length ?? 0;
  if (typed > 0) return typed;
  return Math.max(1, output.split('\n').filter((line) => /(?:^|\W)error(?:\W|$)/i.test(line)).length);
}

const GRADE_RANK: Record<DesignGrade, number> = { S: 5, A: 4, B: 3, C: 2, D: 1, F: 0 };
const pct = (share: number): string => `${Math.round(share * 100)}%`;
const share = (m: { passed: number; total: number } | undefined): number | null => (m && m.total > 0 ? m.passed / m.total : null);
const kb = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`);
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}초`;

type Measured = Omit<LedgerEntry, 'delta' | 'proof'>;

/**
 * What changed between two entries, as before-and-after pairs. Only metrics both entries have and that differ
 * are listed, so the first build of a project, and a task that changed nothing measurable, have no deltas.
 * `better` is the direction a reader wants: fewer errors, a higher grade, less slop, a lighter bundle.
 */
export function ledgerDelta(prev: Measured, next: Measured): LedgerDelta[] {
  const deltas: LedgerDelta[] = [];
  const number = (metric: string, before: number | null, after: number | null, show: (n: number) => string, lowerIsBetter: boolean | null): void => {
    if (before === null || after === null || before === after) return;
    deltas.push({ metric, before: show(before), after: show(after), better: lowerIsBetter === null ? null : lowerIsBetter ? after < before : after > before });
  };
  number('타입 에러', prev.code.compilerErrors, next.code.compilerErrors, String, true);
  number('검증 회차', prev.code.verifyRounds, next.code.verifyRounds, (n) => `${n}회`, true);
  if (prev.code.checksFailed.length !== next.code.checksFailed.length) number('실패한 회귀 체크', prev.code.checksFailed.length, next.code.checksFailed.length, (n) => `${n}건`, true);
  if (prev.design.grade !== null && next.design.grade !== null && prev.design.grade !== next.design.grade) {
    deltas.push({ metric: '디자인 등급', before: prev.design.grade, after: next.design.grade, better: GRADE_RANK[next.design.grade] > GRADE_RANK[prev.design.grade] });
  }
  number('디자인 점수', prev.design.score, next.design.score, String, false);
  number('슬롭 지수', prev.design.slopScore, next.design.slopScore, String, true);
  number('텍스트 슬롭', prev.design.textSlop, next.design.textSlop, (n) => (n === 0 ? '0건 클린' : `${n}건`), true);
  if (prev.design.livingVisual !== null && next.design.livingVisual !== null && prev.design.livingVisual !== next.design.livingVisual) {
    deltas.push({ metric: '첫 화면 볼거리', before: prev.design.livingVisual ? '있음' : '없음', after: next.design.livingVisual ? '있음' : '없음', better: next.design.livingVisual });
  }
  // The way the product works, counted: fewer presses for the same flow is better, a flow that goes through is better still.
  if (prev.flow && next.flow && prev.flow.tasks === next.flow.tasks) {
    number('핵심 흐름 완주', prev.flow.reached, next.flow.reached, (n) => `${n}/${next.flow!.tasks}`, false);
    if (prev.flow.reached === prev.flow.tasks && next.flow.reached === next.flow.tasks) number('핵심 흐름 누름', prev.flow.presses, next.flow.presses, (n) => `${n}번`, true);
  }
  number('AAA 대비 통과율', prev.design.contrastAaa, next.design.contrastAaa, pct, false);
  number('터치 타깃 적합도', prev.design.touchTargets, next.design.touchTargets, pct, false);
  number('누름에 답하는 컨트롤', prev.design.pressAnswer ?? null, next.design.pressAnswer ?? null, pct, false);
  number('보이는 키보드 포커스', prev.design.focusVisible ?? null, next.design.focusVisible ?? null, pct, false);
  number('번들', prev.code.bundleBytes, next.code.bundleBytes, kb, true);
  number('빌드 시간', prev.code.buildMs, next.code.buildMs, secs, true);
  return deltas;
}

/**
 * The quality ledger: one receipt per finished task.
 *
 * An entry holds what the daemon measured of the task's code (compiler errors, rounds to a pass, regression
 * checks, the production build), of its design (grade, slop, whether the first screen has something to look
 * at, contrast and target-size pass rates, copy habits) and of its cost (model calls, tokens, dollars, wall
 * time), and the difference from the project's previous entry. Nothing in it is an engine's account of itself:
 * the figures come from gates the daemon ran and from its own usage rows.
 *
 * The database is the record. Each entry is also appended to `ledger.jsonl` in the project's folder under the
 * daemon's home, outside the workspace, where the engine whose work it grades cannot rewrite it.
 */
export class Ledger {
  readonly #config: Config;
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #clock: Clock;
  readonly #log: Logger;

  constructor(deps: { config: Config; store: Store; events: EventLog; clock: Clock; log: Logger }) {
    this.#config = deps.config;
    this.#store = deps.store;
    this.#events = deps.events;
    this.#clock = deps.clock;
    this.#log = deps.log;
  }

  /** Where a project's entries are also written, one JSON object a line. */
  fileFor(project: Pick<Project, 'slug'>): string {
    return join(this.#config.home, 'projects', project.slug, 'ledger.jsonl');
  }

  /** Writes the receipt of a task that has reached a verdict. `task` is the task as it finished. */
  async record(project: Project, task: Task, run: RunRecord): Promise<LedgerEntry> {
    const usage = this.#store.taskUsage(task.id);
    const audit = run.audit;
    const now = this.#clock();
    const measured: Measured = {
      id: newId('led'),
      projectId: project.id,
      taskId: task.id,
      createdAt: now,
      taskKind: task.kind,
      track: task.track,
      outcome: task.state === 'succeeded' ? 'succeeded' : 'failed',
      engine: task.engine,
      code: {
        compilerErrors: run.compilerErrors,
        firstCompilerErrors: run.firstCompilerErrors,
        verifyRounds: run.rounds,
        checksPassed: run.checksPassed,
        checksFailed: run.checksFailed,
        buildMs: run.build?.ms ?? null,
        bundleBytes: run.build?.bytes ?? null,
      },
      design: {
        grade: audit?.grade ?? null,
        score: audit?.score ?? null,
        slopScore: audit?.slopScore ?? null,
        livingVisual: audit?.livingVisual ?? null,
        contrastAaa: share(audit?.measures?.contrast),
        touchTargets: share(audit?.measures?.touchTargets),
        pressAnswer: share(audit?.measures?.pressAnswer),
        focusVisible: share(audit?.measures?.focusVisible),
        copySlop: audit?.copy?.slopScore ?? null,
        textSlop: audit ? (audit.copy?.habits ?? audit.findings.filter((f) => f.rule.startsWith(COPY_RULE_PREFIX)).length) : null,
      },
      cost: { modelCalls: usage.calls, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, usdMicros: usage.usdMicros, wallMs: Math.max(0, (task.finishedAt ?? now) - (task.startedAt ?? task.createdAt)) },
      review: { plan: run.planReviewer, acceptance: run.acceptanceReviewer, verdict: run.verdict },
      flow: run.flow ? { tasks: run.flow.tasks, reached: run.flow.reached, presses: run.flow.presses, scrolls: run.flow.scrolls, smallestTargetPx: run.flow.smallestTargetPx, answered: run.flow.answered } : null,
    };
    const previous = this.#store.listLedgerEntries(project.id, 2).find((e) => e.taskId !== task.id);
    const delta = previous ? ledgerDelta(previous, measured) : [];
    const entry: LedgerEntry = { ...measured, delta, proof: delta.map((d) => `${d.metric} ${d.before}→${d.after}`).join(', ') };
    this.#store.insertLedgerEntry(entry);
    try {
      const file = this.fileFor(project);
      await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
      await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch (err) {
      // The row is the record; the file is a convenience for reading it elsewhere.
      this.#log.warn({ projectId: project.id, err: errorMessage(err) }, 'could not append to ledger.jsonl');
    }
    this.#events.emit({ projectId: project.id, taskId: task.id }, { type: 'ledger.recorded', entryId: entry.id, proof: entry.proof });
    return entry;
  }

  list(projectId: string, limit: number): LedgerEntry[] {
    return this.#store.listLedgerEntries(projectId, limit);
  }
}

/** A run's figures as the acceptance reviewer reads them: plain lines, written by code from measured values. */
export function renderEvidence(run: RunRecord): string {
  const audit = run.audit;
  const lines = [
    `Verification rounds: ${run.rounds}.`,
    run.compilerErrors === null ? 'Compiler: nothing to compile.' : `Compiler: ${run.compilerErrors} error(s) on the last run${run.firstCompilerErrors !== null && run.firstCompilerErrors !== run.compilerErrors ? `, ${run.firstCompilerErrors} on the first` : ''}.`,
    `Regression checks: ${run.checksPassed} passed${run.checksFailed.length > 0 ? `, failed: ${run.checksFailed.join(', ')}` : ''}.`,
  ];
  if (audit) {
    const counts = (['blocker', 'major', 'minor'] as const).map((s) => `${audit.findings.filter((f) => f.severity === s).length} ${s}`).join(', ');
    lines.push(
      audit.visionReviewed ? `Visual audit: score ${audit.score}/100 (needs ${audit.threshold}), grade ${audit.grade}, slop ${audit.slopScore}/100, laid out as ${audit.archetype}. Findings: ${counts}.` : `Visual audit: measured only, no design reviewer saw it (${audit.vision.reason ?? audit.vision.status}). Findings: ${counts}.`,
      audit.livingVisual === null || audit.livingVisual === undefined ? 'First screen: not judged for something to look at.' : `First screen has something real to look at: ${audit.livingVisual ? 'yes' : 'no'}.`,
      audit.copy ? `Copy lint: ${audit.copy.habits} habit(s), copy slop ${audit.copy.slopScore}/100.` : 'Copy lint: not run.',
    );
    if (audit.critique) lines.push(`Design reviewer: ${audit.critique}`);
    for (const f of audit.findings.filter((x) => x.severity !== 'minor').slice(0, 8)) lines.push(`- [${f.severity}] ${f.rule}: ${f.message}`);
  } else lines.push('Visual audit: not run for this task.');
  if (run.flow) {
    const f = run.flow;
    lines.push(`Core flow of the screen spec, walked on the running app: ${f.reached} of ${f.tasks} task(s) carried out to their outcome, in ${f.presses} press(es) and ${f.scrolls} scroll(s)${f.smallestTargetPx === null ? '' : `, smallest control ${f.smallestTargetPx}px`}, ${f.answered} of ${f.presses} control(s) answering the press.`);
    for (const problem of f.problems.slice(0, 6)) lines.push(`- ${problem}`);
  }
  return lines.join('\n');
}

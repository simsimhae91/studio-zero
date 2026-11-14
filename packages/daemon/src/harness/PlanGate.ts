import { z } from 'zod';
import { PlanFeedback, type PlanVersion, type ScreenSpec } from '@studio-zero/protocol';
import { ConflictError, NotFoundError } from '../app/errors.ts';
import type { Config } from '../config.ts';
import type { PlanVersionRow, Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { readAnchorTable, renderAnchorTable } from '../scratch/AnchorTable.ts';
import { readScreenSpec, screenSpecMarkdown } from '../scratch/ScreenSpec.ts';
import { sha256Hex, type Clock } from '../util/core.ts';
import { PlanCritique, renderCritique } from './SandwichReviewer.ts';

const HOUR_MS = 60 * 60 * 1000;
/** The longest a timer can be set for before it overflows. One that fires early only finds the deadline later. */
const MAX_TIMER_MS = 2 ** 31 - 1;
const Feedback = z.array(PlanFeedback).max(20);

/** The parts of a plan the owner is shown. The planner's structured output (`Plan` in Harness.ts) is one. */
export interface ReviewablePlan {
  summary: string;
  steps: readonly string[];
  auditRoutes: readonly string[];
  openQuestions: readonly string[];
  anchor: unknown;
  screens: ScreenSpec | null;
}

/**
 * The plan as the owner reads it. Daemon code, not a model: the same plan always renders to the same text, so its
 * hash names the plan. Every part of it is the planner's words, shown as text.
 */
export function renderPlanMarkdown(plan: ReviewablePlan): string {
  const parts = [`## 요약\n\n${plan.summary.trim()}`, `## 단계\n\n${plan.steps.map((step, i) => `${i + 1}. ${step.trim()}`).join('\n')}`];
  if (plan.auditRoutes.length > 0) parts.push(`## 끝나고 볼 화면\n\n${plan.auditRoutes.map((route) => `- \`${route}\``).join('\n')}`);
  if (plan.openQuestions.length > 0) parts.push(`## 가정한 것\n\n${plan.openQuestions.map((q) => `- ${q.trim()}`).join('\n')}`);
  if (plan.anchor !== null && plan.anchor !== undefined) {
    const read = readAnchorTable(plan.anchor);
    parts.push(`## 앵커 표\n\n\`\`\`text\n${read.ok ? renderAnchorTable(read.table) : JSON.stringify(plan.anchor, null, 2)}\n\`\`\``);
  }
  if (plan.screens) {
    const read = readScreenSpec(plan.screens);
    parts.push(`## 화면 명세\n\n${read.ok ? screenSpecMarkdown(read.spec).replace(/^(#+) /gm, '##$1 ').trim() : `\`\`\`json\n${JSON.stringify(plan.screens, null, 2)}\n\`\`\``}`);
  }
  return `${parts.join('\n\n')}\n`;
}

export function hashPlan(markdown: string): string {
  return sha256Hex(markdown);
}

/**
 * What the owner said about a version, as the harness acts on it. `approved` and `changes` carry the stored
 * version they are about; `timeout` means nobody answered in `planReview.timeoutHours`.
 */
export type GateOutcome = { outcome: 'approved'; row: PlanVersionRow } | { outcome: 'changes'; row: PlanVersionRow } | { outcome: 'timeout'; row: PlanVersionRow };

interface Waiter {
  version: number;
  settle: (outcome: GateOutcome) => void;
}

/**
 * The owner's look at a plan before any code, for a task submitted with `reviewPlan`. Each plan the owner is
 * shown is stored as a version, with its rendered text, that text's hash and the cross-reviewer's critique;
 * the task then waits, in `awaiting_plan_review`, until the owner approves it or sends it back with notes.
 *
 * A verdict names the version and the hash it was given on and lands only on the version waiting now, the way
 * an approval is bound to the hash of its action: a tap on an old message cannot approve a plan that has since
 * changed. The wait is in this process, but the verdict is in the database: a task whose daemon restarted
 * comes back here (`wait` on the stored version) instead of planning again, and a verdict given while it was
 * on its way back is found when it arrives. The deadline is counted from when the version was stored, so a
 * restart does not reset it.
 */
export class PlanGate {
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #config: Config['planReview'];
  readonly #clock: Clock;
  readonly #waiters = new Map<string, Waiter>();

  constructor(deps: { store: Store; events: EventLog; config: Config['planReview']; clock: Clock }) {
    this.#store = deps.store;
    this.#events = deps.events;
    this.#config = deps.config;
    this.#clock = deps.clock;
  }

  /** The version a task's plan review is at: the newest stored one, or null when it has none. */
  latest(taskId: string): PlanVersionRow | null {
    return this.#store.latestPlanVersion(taskId);
  }

  list(taskId: string): PlanVersion[] {
    return this.#store.listPlanVersions(taskId).map(toWire);
  }

  /** Stores the plan as the next version and waits for the owner's verdict on it. */
  open(scope: { projectId: string; taskId: string }, plan: ReviewablePlan, critique: PlanCritique | null, signal: AbortSignal): Promise<GateOutcome> {
    const markdown = renderPlanMarkdown(plan);
    const version = (this.latest(scope.taskId)?.version ?? 0) + 1;
    const row = this.#store.insertPlanVersion({ taskId: scope.taskId, version, planJson: JSON.stringify(plan), planMarkdown: markdown, sha256: hashPlan(markdown), reviewerNotes: critique ? JSON.stringify(critique) : null, createdAt: this.#clock() });
    this.#events.emit(scope, { type: 'plan.review_requested', version: row.version, planHash: row.sha256 });
    return this.wait(scope, row, signal);
  }

  /**
   * The owner's verdict on a stored version: at once when it was given already, otherwise when it is given, or
   * `timeout` at the deadline. Rejects with the signal's reason when the task is stopped meanwhile.
   */
  wait(scope: { projectId: string; taskId: string }, row: PlanVersionRow, signal: AbortSignal): Promise<GateOutcome> {
    if (row.verdict !== null) return Promise.resolve({ outcome: row.verdict === 'approve' ? 'approved' : 'changes', row });
    this.#store.updateTask(scope.taskId, { state: 'awaiting_plan_review', phase: 'plan' });
    this.#events.emit(scope, { type: 'task.state', state: 'awaiting_plan_review', error: null });
    return new Promise<GateOutcome>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        if (this.#waiters.get(scope.taskId)?.version === row.version) this.#waiters.delete(scope.taskId);
      };
      const onAbort = (): void => {
        done();
        reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      const settle = (outcome: GateOutcome): void => {
        done();
        this.#store.updateTask(scope.taskId, { state: 'running' });
        this.#events.emit(scope, { type: 'task.state', state: 'running', error: null });
        resolve(outcome);
      };
      this.#waiters.set(scope.taskId, { version: row.version, settle });
      const deadline = row.createdAt + this.#config.timeoutHours * HOUR_MS;
      const expire = (): void => {
        // A verdict that reached the database by another way (the instant before this) still counts.
        const now = this.#store.listPlanVersions(scope.taskId).find((v) => v.version === row.version);
        if (now && now.verdict !== null) return settle({ outcome: now.verdict === 'approve' ? 'approved' : 'changes', row: now });
        this.#events.emit(scope, { type: 'plan.review_resolved', version: row.version, outcome: 'timeout' });
        settle({ outcome: 'timeout', row });
      };
      const arm = (left: number): void => {
        timer = setTimeout(() => (left > MAX_TIMER_MS ? arm(left - MAX_TIMER_MS) : expire()), Math.min(Math.max(0, left), MAX_TIMER_MS));
        timer.unref();
      };
      arm(deadline - this.#clock());
    });
  }

  /** How many more times the owner may send this task's plan back. */
  revisionsLeft(taskId: string): number {
    const asked = this.#store.listPlanVersions(taskId).filter((v) => v.verdict === 'changes').length;
    return Math.max(0, this.#config.maxRevisions - asked);
  }

  /**
   * Records the owner's verdict on the version a task is waiting with, and wakes the task. Refused unless
   * `version` and `planHash` are that version's, unless the task is still before its first line of code, and for
   * `changes`, without a note or past the revision cap. The caller has authorized the owner.
   */
  resolve(taskId: string, version: number, planHash: string, verdict: 'approve' | 'changes', rawFeedback: readonly PlanFeedback[] = []): PlanVersion {
    const task = this.#store.getTask(taskId);
    if (!task) throw new NotFoundError(`task ${taskId}`);
    const latest = this.latest(taskId);
    if (!latest) throw new NotFoundError(`a plan for task ${taskId}`);
    if (task.state === 'succeeded' || task.state === 'failed' || task.state === 'cancelled') throw new ConflictError('이 작업은 끝났습니다. 계획을 더 고칠 수 없습니다.');
    if (latest.version !== version || latest.sha256 !== planHash || latest.verdict !== null) throw new ConflictError(`계획이 바뀌었습니다. 지금 기다리는 것은 ${latest.version}번째 계획${latest.verdict === null ? '' : '이고 이미 답을 받았습니다'}. 새 계획을 보고 다시 답해 주세요.`);
    const feedback = Feedback.parse(rawFeedback);
    if (verdict === 'changes') {
      if (feedback.length === 0) throw new ConflictError('무엇을 고칠지 한 가지 이상 적어 주세요.');
      if (this.revisionsLeft(taskId) === 0) throw new ConflictError(`계획은 ${this.#config.maxRevisions}번까지 고쳐 달라고 할 수 있습니다. 이 계획으로 승인하거나 작업을 취소해 주세요.`);
    }
    const at = this.#clock();
    if (!this.#store.resolvePlanVersion(taskId, version, verdict, verdict === 'changes' ? feedback : [], at)) throw new ConflictError('이 계획에는 방금 다른 곳에서 답했습니다.');
    const row = this.latest(taskId)!;
    this.#events.emit({ projectId: task.projectId, taskId }, { type: 'plan.review_resolved', version, outcome: verdict });
    const waiter = this.#waiters.get(taskId);
    if (waiter?.version === version) waiter.settle({ outcome: verdict === 'approve' ? 'approved' : 'changes', row });
    return toWire(row);
  }
}

export function toWire(row: PlanVersionRow): PlanVersion {
  const notes = row.reviewerNotes === null ? null : PlanCritique.safeParse(JSON.parse(row.reviewerNotes));
  return {
    taskId: row.taskId,
    version: row.version,
    planMarkdown: row.planMarkdown,
    sha256: row.sha256,
    reviewerNotes: notes?.success ? renderCritique(notes.data, 'owner') : null,
    verdict: row.verdict,
    feedback: row.feedback,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}

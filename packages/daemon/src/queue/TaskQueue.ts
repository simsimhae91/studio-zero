import type { Task } from '@studio-zero/protocol';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { ShutdownSignal } from '../harness/Harness.ts';
import { errorMessage, type Clock, type Logger } from '../util/core.ts';

const MAX_ATTEMPTS = 2;

/**
 * Durable task queue on SQLite. Tasks survive restarts: anything that was mid-flight when the daemon stopped is
 * re-queued once on boot (and failed if it had already been retried). At most one heavy task runs per project,
 * because a project's workspace is a single working tree; small edits and full checks run beside it in the
 * project's slots, as many as it has (see `Store.claimNextTask`).
 *
 * A suspended task is not in flight: it holds no slot and does not block its project. `resume` queues it again.
 *
 * A task waiting for the owner's word on its plan (`awaiting_plan_review`) is in flight and holds its slot. After a
 * restart it is queued again without spending its retry, and its run goes back to the stored plan (see `PlanGate`).
 *
 * Nor is a parked one (see `Harness`): it waits for the reset time its subscription named. One timer is kept for
 * the soonest of them; when it is due the task is queued again, behind whatever its project is running, the way
 * an interrupted task is after a restart. A wake is not a crash, so it does not spend the restart retry.
 * Parked tasks stay parked across a restart, and those whose time passed while the daemon was down wake on boot.
 */
export class TaskQueue {
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #execute: (task: Task, signal: AbortSignal) => Promise<void>;
  readonly #concurrency: number;
  readonly #slots: number;
  readonly #clock: Clock;
  readonly #log: Logger;
  readonly #running = new Map<string, { abort: AbortController; done: Promise<void> }>();
  #accepting = false;
  #wakeTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #onSettled: ((taskId: string) => void) | null;

  /**
   * `onSettled` is told when a task's run has wholly ended, whatever became of it: after its verdict, its receipt
   * and its reflection, with its workspace no longer in use. A task's `succeeded` event is earlier than that.
   */
  constructor(deps: { store: Store; events: EventLog; execute: (task: Task, signal: AbortSignal) => Promise<void>; concurrency?: number; /** How many slots a project has, for light tasks (see `Store.claimNextTask`). */ slots?: number; clock: Clock; log: Logger; onSettled?: (taskId: string) => void }) {
    this.#onSettled = deps.onSettled ?? null;
    this.#store = deps.store;
    this.#events = deps.events;
    this.#execute = deps.execute;
    this.#concurrency = deps.concurrency ?? 2;
    this.#slots = deps.slots ?? 0;
    this.#clock = deps.clock;
    this.#log = deps.log;
  }

  start(): void {
    const { requeued, failed } = this.#store.recoverInterruptedTasks(this.#clock(), MAX_ATTEMPTS);
    for (const id of failed) {
      const task = this.#store.getTask(id);
      if (task) this.#events.emit({ projectId: task.projectId, taskId: id }, { type: 'task.state', state: 'failed', error: task.error });
    }
    if (requeued.length + failed.length > 0) this.#log.info({ requeued, failed }, 'recovered interrupted tasks');
    this.#accepting = true;
    this.wakeDue();
    this.pump();
  }

  /** Queues every parked task whose time has come, and sets the timer for the next. Returns the ids woken. */
  wakeDue(): string[] {
    const now = this.#clock();
    const woken: string[] = [];
    for (const task of this.#store.listParkedTasks()) {
      if (task.parkedUntil !== null && task.parkedUntil > now) break;
      const queued = this.#store.wakeTask(task.id);
      if (!queued) continue;
      this.#log.info({ taskId: task.id }, 'a usage limit has reset; the parked task is queued again');
      this.#queued(queued);
      woken.push(task.id);
    }
    this.#armWake();
    return woken;
  }

  /** One timer, for the soonest parked task. Re-armed whenever a task may have been parked or woken. */
  #armWake(): void {
    if (this.#wakeTimer) clearTimeout(this.#wakeTimer);
    this.#wakeTimer = null;
    if (!this.#accepting) return;
    const next = this.#store.listParkedTasks()[0]?.parkedUntil;
    if (next === undefined) return;
    // A timer longer than about 24.8 days overflows; one that fires early only finds nothing due and re-arms.
    const delay = Math.min(Math.max(0, (next ?? 0) - this.#clock()), 2 ** 31 - 1);
    this.#wakeTimer = setTimeout(() => void this.wakeDue(), delay);
    this.#wakeTimer.unref();
  }

  #queued(task: Task): void {
    this.#events.emit({ projectId: task.projectId, taskId: task.id }, { type: 'task.state', state: 'queued', error: null });
    this.pump();
  }

  /** Call after enqueueing or when a slot may have freed up. Cheap and idempotent. */
  pump(): void {
    while (this.#accepting && this.#running.size < this.#concurrency) {
      const task = this.#store.claimNextTask(this.#clock(), this.#slots);
      if (!task) return;
      const abort = new AbortController();
      const done = this.#execute(task, abort.signal)
        .catch((err: unknown) => {
          // The executor reports its own failures; reaching this means it broke outside its own error handling.
          this.#log.error({ taskId: task.id, err: errorMessage(err) }, 'task executor crashed');
          this.#store.updateTask(task.id, { state: 'failed', phase: null, error: `internal error: ${errorMessage(err)}`, finishedAt: this.#clock() });
          this.#events.emit({ projectId: task.projectId, taskId: task.id }, { type: 'task.state', state: 'failed', error: errorMessage(err) });
        })
        .finally(() => {
          this.#running.delete(task.id);
          // The task may have been parked: its wake time may now be the soonest.
          this.#armWake();
          this.pump();
          try {
            this.#onSettled?.(task.id);
          } catch (err) {
            this.#log.error({ taskId: task.id, err: errorMessage(err) }, 'a listener for a settled task failed');
          }
        });
      this.#running.set(task.id, { abort, done });
    }
  }

  /** Cancels a queued, running, suspended or parked task. Returns false when the task is already finished. */
  cancel(taskId: string): boolean {
    const task = this.#store.getTask(taskId);
    if (!task || task.state === 'succeeded' || task.state === 'failed' || task.state === 'cancelled') return false;
    this.#store.requestCancel(taskId);
    const running = this.#running.get(taskId);
    if (running) running.abort.abort(new Error('cancelled by the owner'));
    else if (task.state === 'queued' || task.state === 'suspended' || task.state === 'parked') {
      this.#store.updateTask(taskId, { state: 'cancelled', finishedAt: this.#clock(), error: 'cancelled by the owner' });
      this.#events.emit({ projectId: task.projectId, taskId }, { type: 'task.state', state: 'cancelled', error: 'cancelled by the owner' });
    }
    return true;
  }

  /** Queues a suspended task again. It runs when its project is free, and picks up where it was suspended. */
  resume(taskId: string): boolean {
    const task = this.#store.resumeTask(taskId);
    if (!task) return false;
    this.#queued(task);
    return true;
  }

  /** Stops taking work and waits for running tasks to wind down. They are re-queued by `start()` on the next boot. */
  async stop(graceMs = 10_000): Promise<void> {
    this.#accepting = false;
    this.#armWake();
    for (const { abort } of this.#running.values()) abort.abort(new ShutdownSignal());
    const all = Promise.allSettled([...this.#running.values()].map((r) => r.done));
    await Promise.race([all, new Promise((resolve) => setTimeout(resolve, graceMs).unref())]);
  }
}

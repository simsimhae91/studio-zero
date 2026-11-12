import type { Task } from '@studio-zero/protocol';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { ShutdownSignal } from '../harness/Harness.ts';
import { errorMessage, type Clock, type Logger } from '../util/core.ts';

const MAX_ATTEMPTS = 2;

/**
 * Durable task queue on SQLite. Tasks survive restarts: anything that was mid-flight when the daemon stopped is
 * re-queued once on boot (and failed if it had already been retried). At most one task runs per project,
 * because a project's workspace is a single working tree.
 *
 * A suspended task is not in flight: it holds no slot and does not block its project. `resume` queues it again.
 */
export class TaskQueue {
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #execute: (task: Task, signal: AbortSignal) => Promise<void>;
  readonly #concurrency: number;
  readonly #clock: Clock;
  readonly #log: Logger;
  readonly #running = new Map<string, { abort: AbortController; done: Promise<void> }>();
  #accepting = false;

  constructor(deps: { store: Store; events: EventLog; execute: (task: Task, signal: AbortSignal) => Promise<void>; concurrency?: number; clock: Clock; log: Logger }) {
    this.#store = deps.store;
    this.#events = deps.events;
    this.#execute = deps.execute;
    this.#concurrency = deps.concurrency ?? 2;
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
    this.pump();
  }

  /** Call after enqueueing or when a slot may have freed up. Cheap and idempotent. */
  pump(): void {
    while (this.#accepting && this.#running.size < this.#concurrency) {
      const task = this.#store.claimNextTask(this.#clock());
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
          this.pump();
        });
      this.#running.set(task.id, { abort, done });
    }
  }

  /** Cancels a queued or running task. Returns false when the task is already finished. */
  cancel(taskId: string): boolean {
    const task = this.#store.getTask(taskId);
    if (!task || task.state === 'succeeded' || task.state === 'failed' || task.state === 'cancelled') return false;
    this.#store.requestCancel(taskId);
    const running = this.#running.get(taskId);
    if (running) running.abort.abort(new Error('cancelled by the owner'));
    else if (task.state === 'queued' || task.state === 'suspended') {
      this.#store.updateTask(taskId, { state: 'cancelled', finishedAt: this.#clock(), error: 'cancelled by the owner' });
      this.#events.emit({ projectId: task.projectId, taskId }, { type: 'task.state', state: 'cancelled', error: 'cancelled by the owner' });
    }
    return true;
  }

  /** Queues a suspended task again. It runs when its project is free, and picks up where it was suspended. */
  resume(taskId: string): boolean {
    const task = this.#store.resumeTask(taskId);
    if (!task) return false;
    this.#events.emit({ projectId: task.projectId, taskId }, { type: 'task.state', state: 'queued', error: null });
    this.pump();
    return true;
  }

  /** Stops taking work and waits for running tasks to wind down. They are re-queued by `start()` on the next boot. */
  async stop(graceMs = 10_000): Promise<void> {
    this.#accepting = false;
    for (const { abort } of this.#running.values()) abort.abort(new ShutdownSignal());
    const all = Promise.allSettled([...this.#running.values()].map((r) => r.done));
    await Promise.race([all, new Promise((resolve) => setTimeout(resolve, graceMs).unref())]);
  }
}

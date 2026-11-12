import type { Store } from '../db/Store.ts';
import type { QaVisionBridge } from '../qa/QaVisionBridge.ts';
import type { TaskQueue } from '../queue/TaskQueue.ts';
import { errorMessage, type Logger } from '../util/core.ts';

/** How often suspended tasks are looked at. A usage limit lifts on the hour or the day, not on the second. */
export const REVIEW_RECHECK_MS = 10 * 60 * 1000;

/**
 * Brings suspended tasks back. A task is suspended when its work is done and the design review it still owes
 * was refused by every reviewer for a usage limit (see `Harness`). Nothing announces that a limit has lifted,
 * so this asks: every few minutes, for each suspended task, the reviewers are put a one-word question in order.
 * The first that answers means a review can be had, and the task is queued again; it resumes at verification.
 *
 * A reviewer still at its limit refuses the question for free. One that answers costs a few tokens, once.
 */
export class ReviewResumer {
  readonly #store: Store;
  readonly #vision: Pick<QaVisionBridge, 'probe'>;
  readonly #queue: Pick<TaskQueue, 'resume'>;
  readonly #log: Logger;
  readonly #intervalMs: number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #looking = false;

  constructor(deps: { store: Store; vision: Pick<QaVisionBridge, 'probe'>; queue: Pick<TaskQueue, 'resume'>; log: Logger; intervalMs?: number }) {
    this.#store = deps.store;
    this.#vision = deps.vision;
    this.#queue = deps.queue;
    this.#log = deps.log;
    this.#intervalMs = deps.intervalMs ?? REVIEW_RECHECK_MS;
  }

  start(): void {
    this.#timer = setInterval(() => void this.tick(), this.#intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** One look at the suspended tasks. Returns the ids it queued again. */
  async tick(): Promise<string[]> {
    if (this.#looking) return [];
    this.#looking = true;
    try {
      const resumed: string[] = [];
      for (const task of this.#store.listSuspendedTasks()) {
        const reviewer = await this.#vision.probe({ projectId: task.projectId, taskId: task.id }).catch((err: unknown) => {
          this.#log.warn({ taskId: task.id, err: errorMessage(err) }, 'could not ask whether a design reviewer is back');
          return null;
        });
        if (reviewer === null || !this.#queue.resume(task.id)) continue;
        this.#log.info({ taskId: task.id, reviewer }, 'a design reviewer is back; resuming the suspended task');
        resumed.push(task.id);
      }
      return resumed;
    } finally {
      this.#looking = false;
    }
  }
}

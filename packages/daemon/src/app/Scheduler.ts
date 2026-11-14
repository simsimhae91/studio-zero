import type { Schedule, Task } from '@studio-zero/protocol';
import { EngineId } from '../config.ts';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import type { Actor } from '../policy/actions.ts';
import { errorMessage, type Clock, type Logger } from '../util/core.ts';
import type { Studio } from './Studio.ts';

/** How often the schedules are looked at. A schedule is set to the minute and no finer. */
export const SCHEDULER_TICK_MS = 60 * 1000;

/**
 * Who a scheduled run is submitted as. A schedule is made, changed and removed only by the owner, at the desk
 * (`schedule.configure`), and its prompt is the one they wrote then: the run is theirs, as a task they typed is.
 */
const OWNER: Actor = { type: 'owner', via: 'desktop' };

/** States in which the task a schedule last started is still under way, so the next run waits its turn by being skipped. */
const ACTIVE: ReadonlySet<Task['state']> = new Set(['queued', 'running', 'awaiting_approval', 'awaiting_plan_review', 'parked']);

/**
 * When an interval schedule next falls due after `now`: on its own cadence from `from`, the first slot strictly
 * later than `now`. However many slots were missed (the daemon was down, the schedule was paused), this is one.
 */
export function nextSlot(from: number, intervalMinutes: number, now: number): number {
  const step = intervalMinutes * 60 * 1000;
  return from > now ? from : from + (Math.floor((now - from) / step) + 1) * step;
}

/**
 * Submits the owner's saved prompts when their time comes. One timer, about once a minute, and a look at start.
 *
 * At most once per slot: the schedule is moved on to its next time first, and only if it still stood at the
 * time it was read at; the task is submitted after that. A crash between the two loses that run and never
 * starts it twice, the rule every paid task here keeps. A run whose submission is refused (policy, a spent
 * budget) is not tried again. After downtime, the missed slots of a schedule come to one run, at start.
 */
export class Scheduler {
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #studio: Pick<Studio, 'submitTask'>;
  readonly #clock: Clock;
  readonly #log: Logger;
  readonly #intervalMs: number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #ticking: Promise<string[]> | null = null;

  constructor(deps: { store: Store; events: EventLog; studio: Pick<Studio, 'submitTask'>; clock: Clock; log: Logger; intervalMs?: number }) {
    this.#store = deps.store;
    this.#events = deps.events;
    this.#studio = deps.studio;
    this.#clock = deps.clock;
    this.#log = deps.log;
    this.#intervalMs = deps.intervalMs ?? SCHEDULER_TICK_MS;
  }

  start(): void {
    if (this.#timer) return;
    void this.tick();
    this.#timer = setInterval(() => void this.tick(), this.#intervalMs);
    this.#timer.unref();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#ticking;
  }

  /** One look at the schedules. Returns the ids of the tasks it submitted. */
  tick(): Promise<string[]> {
    this.#ticking ??= this.#tick().finally(() => {
      this.#ticking = null;
    });
    return this.#ticking;
  }

  async #tick(): Promise<string[]> {
    const submitted: string[] = [];
    const now = this.#clock();
    for (const schedule of this.#store.dueSchedules(now)) {
      try {
        const taskId = await this.#fire(schedule, now);
        if (taskId !== null) submitted.push(taskId);
      } catch (err) {
        this.#log.error({ scheduleId: schedule.id, err: errorMessage(err) }, 'a schedule could not be looked at');
      }
    }
    return submitted;
  }

  async #fire(schedule: Schedule, now: number): Promise<string | null> {
    const scope = { projectId: schedule.projectId, taskId: null };
    const dueAt = schedule.nextDueAt!;
    const once = schedule.mode === 'at' || schedule.intervalMinutes === null;
    const next = { dueAt, nextDueAt: once ? null : nextSlot(dueAt, schedule.intervalMinutes!, now), enabled: !once };
    const previous = schedule.lastTaskId === null ? null : this.#store.getTask(schedule.lastTaskId);
    if (previous && ACTIVE.has(previous.state)) {
      if (!this.#store.advanceSchedule(schedule.id, { ...next, firedAt: null })) return null;
      this.#events.emit(scope, { type: 'schedule.skipped', scheduleId: schedule.id, reason: 'previous_active', detail: `task ${previous.id} from the last run is still ${previous.state}` });
      return null;
    }
    // Moved on before anything is started: from here, whatever happens, this slot does not run again.
    if (!this.#store.advanceSchedule(schedule.id, { ...next, firedAt: now })) return null;
    let task: Task;
    try {
      const engine = EngineId.safeParse(schedule.engine).data;
      task = await this.#studio.submitTask(OWNER, { projectId: schedule.projectId, kind: schedule.kind, prompt: schedule.prompt, ...(engine ? { engine } : {}), ...(engine && schedule.model ? { model: schedule.model } : {}) }, 'system');
    } catch (err) {
      this.#log.warn({ scheduleId: schedule.id, err: errorMessage(err) }, 'a scheduled run was refused');
      this.#events.emit(scope, { type: 'schedule.skipped', scheduleId: schedule.id, reason: 'submit_rejected', detail: errorMessage(err) });
      return null;
    }
    this.#store.setScheduleLastTask(schedule.id, task.id);
    this.#events.emit({ projectId: schedule.projectId, taskId: task.id }, { type: 'schedule.fired', scheduleId: schedule.id, taskId: task.id, firedAt: now });
    return task.id;
  }
}

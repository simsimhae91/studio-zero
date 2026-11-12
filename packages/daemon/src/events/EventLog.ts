import type { EventBody, EventEnvelope, EventFilter } from '@studio-zero/protocol';
import type { Store } from '../db/Store.ts';
import type { Clock } from '../util/core.ts';

export interface EventScope {
  projectId: string | null;
  taskId: string | null;
}

/**
 * Durable event stream. `emit` persists first and fans out second, so anything a live subscriber has seen is
 * also what a reconnecting client replays from `sinceSeq`.
 */
export class EventLog {
  readonly #store: Store;
  readonly #clock: Clock;
  readonly #listeners = new Set<(e: EventEnvelope) => void>();

  constructor(store: Store, clock: Clock) {
    this.#store = store;
    this.#clock = clock;
  }

  emit(scope: EventScope, body: EventBody): EventEnvelope {
    const envelope = this.#store.appendEvent({ at: this.#clock(), projectId: scope.projectId, taskId: scope.taskId, body });
    for (const listener of this.#listeners) {
      try {
        listener(envelope);
      } catch {
        // A broken subscriber (closed socket, relay hiccup) must never fail the operation that emitted the event.
      }
    }
    return envelope;
  }

  subscribe(listener: (e: EventEnvelope) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  history(filter: EventFilter, sinceSeq: number, limit: number): EventEnvelope[] {
    return this.#store.listEvents(filter, sinceSeq, limit);
  }

  headSeq(): number {
    return this.#store.headSeq();
  }
}

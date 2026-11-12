import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RpcCallError, type EventEnvelope, type EventType, type MethodName, type ParamsOf, type ResultOf } from '@studio-zero/protocol';
import type { Backend, LinkState } from './backend.ts';

interface StudioContext {
  backend: Backend;
  link: LinkState;
  /** Calls `listener` for every event from now on. Returns an unsubscribe function. */
  onEvent: (listener: (e: EventEnvelope) => void) => () => void;
}

const Context = createContext<StudioContext | null>(null);

export function StudioProvider({ backend, link, children }: { backend: Backend; link: LinkState; children: ReactNode }) {
  const listeners = useRef(new Set<(e: EventEnvelope) => void>());
  // One live subscription for the whole window; views listen to it instead of each opening their own.
  useEffect(() => backend.subscribe({}, (e) => listeners.current.forEach((l) => l(e)), 'now'), [backend]);
  const onEvent = useCallback((listener: (e: EventEnvelope) => void) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);
  const value = useMemo(() => ({ backend, link, onEvent }), [backend, link, onEvent]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useStudio(): StudioContext {
  const value = useContext(Context);
  if (!value) throw new Error('useStudio must be used inside StudioProvider');
  return value;
}

/** A message a person can act on, from whatever a call rejected with. */
export function errorText(err: unknown): string {
  if (err instanceof RpcCallError) {
    if (err.code === 'disconnected') return '데몬과 연결이 끊겼습니다. 다시 연결되면 한 번 더 시도해 주세요.';
    if (err.code === 'policy_denied') return `정책상 허용되지 않습니다. ${err.message}`;
    if (err.code === 'unavailable') return `지금은 할 수 없습니다. ${err.message}`;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export interface Query<T> {
  data: T | undefined;
  error: string | null;
  reload: () => void;
}

/**
 * Loads one RPC result and keeps it fresh: it reloads when an event of one of the `refreshOn` types arrives.
 * Pass `params: null` to skip the call (for example while no project is selected).
 */
export function useQuery<M extends MethodName>(method: M, params: ParamsOf<M> | null, refreshOn: readonly EventType[] = []): Query<ResultOf<M>> {
  const { backend, onEvent } = useStudio();
  const [state, setState] = useState<{ key: string; data: ResultOf<M> | undefined; error: string | null }>({ key: '', data: undefined, error: null });
  const [tick, setTick] = useState(0);
  const key = params === null ? '' : `${method}:${JSON.stringify(params)}`;
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (params === null) return;
    let stale = false;
    backend.call(method, params).then(
      (data) => !stale && setState({ key, data, error: null }),
      (err: unknown) => !stale && setState((prev) => ({ key, data: prev.key === key ? prev.data : undefined, error: errorText(err) })),
    );
    return () => {
      stale = true;
    };
    // `key` stands for method + params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, key, tick]);

  const types = refreshOn.join(',');
  useEffect(() => {
    if (types === '') return;
    const wanted = new Set(types.split(','));
    let scheduled = false;
    return onEvent((e) => {
      if (!wanted.has(e.body.type) || scheduled) return;
      scheduled = true; // a burst of events becomes one reload
      setTimeout(() => {
        scheduled = false;
        reload();
      }, 150);
    });
  }, [onEvent, reload, types]);

  return { data: state.key === key ? state.data : undefined, error: state.key === key ? state.error : null, reload };
}

/** The full event history of one task, replayed from the start and then kept live. */
export function useTaskEvents(taskId: string | null): EventEnvelope[] {
  const { backend } = useStudio();
  const [events, setEvents] = useState<EventEnvelope[]>([]);
  useEffect(() => {
    setEvents([]);
    if (taskId === null) return;
    let buffer: EventEnvelope[] = [];
    let frame = 0;
    const unsubscribe = backend.subscribe(
      { taskId },
      (e) => {
        buffer.push(e);
        // Replay delivers hundreds of events in one tick; render them as one update.
        frame ||= requestAnimationFrame(() => {
          frame = 0;
          const batch = buffer;
          buffer = [];
          setEvents((prev) => [...prev, ...batch]);
        });
      },
      0,
    );
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [backend, taskId]);
  return events;
}

/** Runs a mutation and reports its state, so a button can show progress and the reason for a failure. */
export function useAction<Args extends unknown[]>(run: (...args: Args) => Promise<unknown>): { run: (...args: Args) => Promise<boolean>; busy: boolean; error: string | null; clear: () => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(run);
  latest.current = run;
  const wrapped = useCallback(async (...args: Args): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await latest.current(...args);
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run: wrapped, busy, error, clear: useCallback(() => setError(null), []) };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AxBlock } from '../blocks.ts';
import { AgentStreamError, streamAgent } from '../stream.ts';
import type { Telemetry } from '../telemetry.ts';

export interface AgentStream {
  status: 'idle' | 'streaming' | 'done' | 'stopped' | 'error';
  /** Prose so far. */
  text: string;
  /** Blocks so far, in the order they arrived. All of them passed the schema. */
  blocks: AxBlock[];
  /** What the agent says it is doing right now, if it said. */
  activity: string | null;
  error: string | null;
}

const IDLE: AgentStream = { status: 'idle', text: '', blocks: [], activity: null, error: null };

/**
 * Runs one request against an agent endpoint and keeps its output as state: text as it streams, blocks as
 * they arrive, and what the agent is doing in between.
 *
 * `steer` sends a message to `steerUrl` while a response is streaming, without stopping it; whether and when the
 * agent reads it is the server's business. `stop` abandons the response.
 */
export function useAgentStream(options: { url: string; steerUrl?: string; headers?: Record<string, string>; telemetry?: Telemetry; fetch?: typeof fetch }) {
  const [state, setState] = useState<AgentStream>(IDLE);
  const latest = useRef(options);
  latest.current = options;
  const running = useRef<AbortController | null>(null);

  const start = useCallback(async (body: unknown): Promise<void> => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    const { url, headers, telemetry, fetch: customFetch } = latest.current;
    const began = performance.now();
    const since = (): number => Math.round(performance.now() - began);
    let chars = 0;
    let blocks = 0;
    let invalid = 0;
    let failure: string | null = null;
    setState({ ...IDLE, status: 'streaming' });
    telemetry?.track({ name: 'stream.started' });
    try {
      for await (const event of streamAgent(url, { body, headers, signal: controller.signal, fetch: customFetch })) {
        if (chars + blocks === 0 && (event.type === 'text' || event.type === 'block')) telemetry?.track({ name: 'stream.first_output', ms: since() });
        if (event.type === 'text') {
          chars += event.delta.length;
          setState((s) => ({ ...s, text: s.text + event.delta, activity: null }));
        } else if (event.type === 'block') {
          blocks += 1;
          setState((s) => ({ ...s, blocks: [...s.blocks, event.block], activity: null }));
        } else if (event.type === 'activity') {
          setState((s) => ({ ...s, activity: event.label }));
        } else if (event.type === 'invalid') {
          invalid += 1;
        } else if (event.type === 'error') {
          failure = event.message;
          break;
        } else break;
      }
      if (failure !== null) {
        telemetry?.track({ name: 'stream.failed', ms: since(), code: 'server_error' });
        setState((s) => ({ ...s, status: 'error', activity: null, error: failure }));
      } else {
        telemetry?.track({ name: 'stream.completed', ms: since(), blocks, chars, invalid });
        setState((s) => ({ ...s, status: 'done', activity: null }));
      }
    } catch (err) {
      if (controller.signal.aborted) {
        telemetry?.track({ name: 'stream.stopped', ms: since() });
        // A newer request owns the state when this one was replaced rather than stopped.
        if (running.current === controller) setState((s) => ({ ...s, status: 'stopped', activity: null }));
        return;
      }
      telemetry?.track({ name: 'stream.failed', ms: since(), code: err instanceof AgentStreamError ? err.code : 'unknown' });
      setState((s) => ({ ...s, status: 'error', activity: null, error: err instanceof AgentStreamError ? err.message : 'The response was interrupted.' }));
    } finally {
      if (running.current === controller) running.current = null;
    }
  }, []);

  const stop = useCallback((): void => running.current?.abort(), []);

  const steer = useCallback(async (message: string): Promise<boolean> => {
    const { steerUrl, headers, telemetry, fetch: customFetch } = latest.current;
    if (!steerUrl || running.current === null) return false;
    const res = await (customFetch ?? fetch)(steerUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ message }) }).catch(() => null);
    if (res?.ok) telemetry?.track({ name: 'steer.sent' });
    return res?.ok ?? false;
  }, []);

  useEffect(() => () => running.current?.abort(), []);
  return { ...state, start, stop, steer };
}

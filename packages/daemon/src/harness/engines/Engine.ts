import type { Project, Task } from '@studio-zero/protocol';
import type { EngineId, RouteCandidate } from '../../config.ts';

export interface EngineRun {
  project: Project;
  task: Task;
  route: RouteCandidate;
  /** Trusted instructions written by this codebase. Never contains untrusted content. */
  system: string;
  signal: AbortSignal;
  onWaiting: (waiting: boolean) => void;
}

export interface EngineResult {
  /** The engine's closing message. Model output: rendered as text, never interpreted. */
  finalText: string;
  stopped: 'completed' | 'budget' | 'max_turns' | 'cancelled';
  /** When `stopped` is `budget`: the policy rule that refused the next model request. */
  deniedRule?: string;
}

/** One task's conversation with an engine. `send` may be called several times (execute, then verify feedback). */
export interface EngineSession {
  send(userContent: string): Promise<EngineResult>;
  close(): Promise<void>;
}

export interface Engine {
  readonly id: EngineId;
  /** Cheap, side-effect-free check used by the router. `reason` explains either outcome. */
  availability(): Promise<{ available: boolean; reason: string }>;
  open(run: EngineRun): Promise<EngineSession>;
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

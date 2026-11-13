import type { EngineModel, Project, Task } from '@studio-zero/protocol';
import type { Effort, EngineId, RouteCandidate } from '../../config.ts';

export interface EngineRun {
  project: Project;
  task: Task;
  route: RouteCandidate;
  /** Trusted instructions written by this codebase. Never contains untrusted content. */
  system: string;
  signal: AbortSignal;
  onWaiting: (waiting: boolean) => void;
  /**
   * Which of the task's conversations this is, when it has more than one at once (a design task draws its
   * directions side by side: "a", "b", "c"). Travels with every tool call the conversation makes.
   */
  lane?: string;
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
  /**
   * The models the owner can pick from on this engine. A menu, not a gate: what a model id means is the
   * vendor's to say, so the list is the vendor's own and a pick outside it is still handed over as asked.
   * Empty when the list could not be read.
   */
  models(): Promise<EngineModel[]>;
  /**
   * The levels of effort this engine takes as a setting of their own. Empty where the vendor folds the level
   * into the model's name (`…-high`): there the model is the choice, and a separate level would go nowhere.
   */
  readonly efforts: readonly Effort[];
  open(run: EngineRun): Promise<EngineSession>;
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

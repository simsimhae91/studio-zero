import type { TaskKind } from '@studio-zero/protocol';
import { UnavailableError } from '../app/errors.ts';
import type { Config, EngineId, RouteCandidate } from '../config.ts';
import type { Engine } from '../harness/engines/Engine.ts';

export interface RouteDecision {
  engine: Engine;
  candidate: RouteCandidate;
  /** Every candidate that was looked at, in order, with why it was or was not usable. Emitted as an event. */
  considered: { engine: string; available: boolean; reason: string }[];
}

/**
 * Picks the engine and model for a task kind. A table lookup plus availability checks: for the same
 * configuration and the same installed credentials it always returns the same answer, and the answer is
 * explainable from `considered` alone. No model is asked which model to use.
 */
export class ModelRouter {
  readonly #config: Config;
  readonly #engines: ReadonlyMap<EngineId, Engine>;

  constructor(config: Config, engines: Engine[]) {
    this.#config = config;
    this.#engines = new Map(engines.map((e) => [e.id, e]));
  }

  /**
   * `pref` is the owner's own choice of engine for this task. It is honoured or refused, never substituted:
   * someone who asked for Codex should not find out afterwards that something else did the work.
   */
  async route(kind: TaskKind, pref: EngineId | null = null): Promise<RouteDecision> {
    if (pref) {
      const engine = this.#engines.get(pref);
      const status = engine ? await engine.availability() : { available: false, reason: 'engine not registered' };
      if (!engine || !status.available) throw new UnavailableError(`the engine chosen for this task is not available: ${pref} (${status.reason})`);
      const listed = this.#config.routes[kind].find((c) => c.engine === pref);
      // 'default' leaves the model to the CLI's own configuration; the API loop needs a concrete one.
      const candidate: RouteCandidate = listed ?? { engine: pref, model: pref === 'native-claude' ? 'claude-opus-5-5' : 'default', effort: 'high' };
      return { engine, candidate, considered: [{ engine: pref, ...status }] };
    }
    const considered: RouteDecision['considered'] = [];
    for (const candidate of this.#config.routes[kind]) {
      const engine = this.#engines.get(candidate.engine);
      const status = engine ? await engine.availability() : { available: false, reason: 'engine not registered' };
      considered.push({ engine: candidate.engine, ...status });
      if (engine && status.available) return { engine, candidate, considered };
    }
    throw new UnavailableError(`no engine available for ${kind} tasks: ${considered.map((c) => `${c.engine} (${c.reason})`).join('; ')}`);
  }

  async status(): Promise<{ id: string; available: boolean; reason: string }[]> {
    return Promise.all([...this.#engines.values()].map(async (e) => ({ id: e.id, ...(await e.availability()) })));
  }
}

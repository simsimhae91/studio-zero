import type { EngineModel, ReviewerPref, TaskKind } from '@studio-zero/protocol';
import { UnavailableError } from '../app/errors.ts';
import type { Config, Effort, EngineId, RouteCandidate } from '../config.ts';
import type { Engine } from '../harness/engines/Engine.ts';

/** Whose model an engine runs: the vendor a cross-check must not share with it. */
const VENDOR: Record<EngineId, ReviewerPref> = { 'native-claude': 'claude-code', 'claude-code': 'claude-code', codex: 'codex', cursor: 'cursor', antigravity: 'antigravity' };

/**
 * Complementary pairing: who cross-checks a lead, most preferred first. Claude is checked by Codex and Codex by
 * Claude; a lead that runs in the host jail (Cursor, Antigravity) is checked by Claude, then Codex. A vendor is
 * never on its own list: a second opinion from the same model family is the first opinion again.
 */
export const REVIEW_PAIRS: Record<ReviewerPref, readonly ReviewerPref[]> = {
  'claude-code': ['codex', 'antigravity', 'cursor'],
  codex: ['claude-code', 'antigravity', 'cursor'],
  cursor: ['claude-code', 'codex', 'antigravity'],
  antigravity: ['claude-code', 'codex', 'cursor'],
};

/** Said wherever an effort is asked of an engine that has no such setting: at submission, and again at routing. */
export const noEffortSetting = (engine: EngineId): string => `${engine} has no effort setting of its own: the level is part of its model names, so pick the model instead`;

export interface ReviewerDecision {
  /** Null when nobody on the list can be asked. */
  reviewer: ReviewerPref | null;
  considered: { reviewer: ReviewerPref; available: boolean; reason: string }[];
}

/**
 * The owner's own choice of who runs a task: an engine, and optionally the model and the effort on it. A model
 * is named the way its engine names it, and not every engine has effort as a setting, so neither means anything
 * without the engine.
 */
export interface EnginePick {
  engine: EngineId;
  model?: string | null;
  effort?: Effort | null;
}

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
   * `pick` is the owner's own choice for this task. It is honoured or refused, never substituted: someone who
   * asked for Codex should not find out afterwards that something else did the work, and the same goes for the
   * model and the effort they asked of it. What they left unsaid comes from the routing table's entry for that engine.
   */
  async route(asked: TaskKind, pick: EnginePick | null = null): Promise<RouteDecision> {
    // A full check is the studio's own walk: no engine works on it, and asking for one is a mistake in the caller.
    if (asked === 'check') throw new UnavailableError('a full check is not routed to an engine');
    const kind = asked;
    if (pick) {
      const pref = pick.engine;
      const engine = this.#engines.get(pref);
      const status = engine ? await engine.availability() : { available: false, reason: 'engine not registered' };
      if (!engine || !status.available) throw new UnavailableError(`the engine chosen for this task is not available: ${pref} (${status.reason})`);
      if (pick.effort && !engine.efforts.includes(pick.effort)) throw new UnavailableError(noEffortSetting(pref));
      const listed = this.#config.routes[kind].find((c) => c.engine === pref);
      // 'default' leaves the model to the CLI's own configuration; the API loop needs a concrete one.
      const usual: RouteCandidate = listed ?? { engine: pref, model: pref === 'native-claude' ? 'claude-opus-5-5' : 'default', effort: 'high' };
      const candidate: RouteCandidate = { ...usual, ...(pick.model ? { model: pick.model } : {}), ...(pick.effort ? { effort: pick.effort } : {}) };
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

  /**
   * Who cross-checks work authored by `author`. A table lookup and availability checks, like routing itself:
   * the first complement that can be asked. `pref` is the owner's own choice for this task; like an engine
   * choice it is honoured or reported unavailable, never swapped for another.
   */
  async pairReviewer(author: EngineId, pref: ReviewerPref | null = null): Promise<ReviewerDecision> {
    const considered: ReviewerDecision['considered'] = [];
    for (const reviewer of pref ? [pref] : REVIEW_PAIRS[VENDOR[author]]) {
      const status = await this.#reviewerStatus(reviewer);
      considered.push({ reviewer, ...status });
      if (status.available) return { reviewer, considered };
    }
    return { reviewer: null, considered };
  }

  /** Claude reviews through the API key or the subscription, whichever is set up; the others through their CLI. */
  async #reviewerStatus(reviewer: ReviewerPref): Promise<{ available: boolean; reason: string }> {
    const ids: EngineId[] = reviewer === 'claude-code' ? ['native-claude', 'claude-code'] : [reviewer];
    let last = { available: false, reason: 'engine not registered' };
    for (const id of ids) {
      const engine = this.#engines.get(id);
      if (!engine) continue;
      last = await engine.availability();
      if (last.available) return last;
    }
    return last;
  }

  /** What the owner can choose from on one engine. Nothing for an engine that cannot run a task now. */
  async catalog(id: EngineId): Promise<{ models: EngineModel[]; efforts: Effort[] }> {
    const engine = this.#engines.get(id);
    if (!engine || !(await engine.availability()).available) return { models: [], efforts: [] };
    return { models: await engine.models(), efforts: [...engine.efforts] };
  }

  /** The effort levels an engine takes as a setting of their own. Known without asking anything: it is how the engine is driven. */
  efforts(id: EngineId): readonly Effort[] {
    return this.#engines.get(id)?.efforts ?? [];
  }

  async status(): Promise<{ id: string; available: boolean; reason: string }[]> {
    return Promise.all([...this.#engines.values()].map(async (e) => ({ id: e.id, ...(await e.availability()) })));
  }
}

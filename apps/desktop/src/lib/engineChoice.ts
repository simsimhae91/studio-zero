import { EnginePref, ModelId, type EngineModel } from '@studio-zero/protocol';

/** What the owner last picked, as it is remembered: `auto` and `default` stand for "not picked". */
export interface RememberedChoice {
  engine: string;
  model: string;
}

/** Who runs the next task, worked out from what was picked and what the daemon says can run now. */
export interface ResolvedChoice {
  /** Null: left to the routing table. */
  engine: EnginePref | null;
  /** Null: the engine's usual model. */
  model: string | null;
  /** What to call that model on screen: the vendor's name for it, or its id until the list has arrived. */
  modelLabel: string | null;
}

/**
 * A remembered pick is honoured until the daemon has said otherwise. While the list of engines or of models is
 * still on its way, the pick goes out as it was made: a task sent in those first seconds must not quietly run
 * on something else. Once a list has arrived, a pick that is not on it is no pick: the owner is shown "자동" or
 * "기본", and that is what is sent.
 *
 * `engines` and `models` are undefined while they have not been read.
 */
export function resolveChoice(picked: RememberedChoice, engines: readonly { id: string; available: boolean }[] | undefined, models: readonly EngineModel[] | undefined): ResolvedChoice {
  const asked = EnginePref.safeParse(picked.engine);
  const engine = asked.success && (engines === undefined || engines.some((e) => e.id === asked.data && e.available)) ? asked.data : null;
  if (engine === null || picked.model === 'default' || !ModelId.safeParse(picked.model).success) return { engine, model: null, modelLabel: null };
  if (models === undefined) return { engine, model: picked.model, modelLabel: picked.model };
  const listed = models.find((m) => m.id === picked.model);
  return listed ? { engine, model: listed.id, modelLabel: listed.label } : { engine, model: null, modelLabel: null };
}

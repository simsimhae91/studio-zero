import type { Calibration as CalibrationStats, Confidence } from '@studio-zero/protocol';
import type { Store } from '../db/Store.ts';
import type { Clock } from '../util/core.ts';

const WINDOW = 20;
const MIN_SAMPLES = 8;
const MAX_OVERRIDE_RATE = 0.25;

/**
 * Keeps an agent's stated confidence honest by comparing it with what the owner actually decided.
 *
 * Every time the owner answers a question the agent had a recommendation for, the outcome is recorded: agreed
 * or overridden, at the confidence the agent claimed. When recent `high`-confidence recommendations have been
 * overridden too often, the daemon stops taking `high` at face value and treats it as `medium`, which means the
 * agent has to ask instead of deciding. The rule is arithmetic on stored outcomes; no model is consulted.
 */
export class ConfidenceCalibration {
  readonly #store: Store;
  readonly #clock: Clock;

  constructor(store: Store, clock: Clock) {
    this.#store = store;
    this.#clock = clock;
  }

  record(confidence: Confidence, agreed: boolean): void {
    this.#store.insertOutcome(confidence, agreed, this.#clock());
  }

  highDemoted(): boolean {
    const recent = this.#store.recentOutcomes('high', WINDOW);
    return recent.length >= MIN_SAMPLES && recent.filter((agreed) => !agreed).length / recent.length > MAX_OVERRIDE_RATE;
  }

  /** The confidence the daemon acts on, which may be lower than the one the agent stated. */
  effective(stated: Confidence): Confidence {
    return stated === 'high' && this.highDemoted() ? 'medium' : stated;
  }

  stats(): CalibrationStats {
    const levels: CalibrationStats['levels'] = { high: { total: 0, overridden: 0 }, medium: { total: 0, overridden: 0 }, speculative: { total: 0, overridden: 0 } };
    for (const row of this.#store.outcomeTotals()) levels[row.confidence] = { total: row.total, overridden: row.overridden };
    return { levels, highDemoted: this.highDemoted() };
  }
}

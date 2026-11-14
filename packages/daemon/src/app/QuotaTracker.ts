import { ReviewerPref, type SubscriptionQuota } from '@studio-zero/protocol';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { saysUsageLimit } from '../llm/ReviewDesk.ts';
import { errorMessage, type Clock } from '../util/core.ts';

const HOUR = 60 * 60 * 1000;
export const RECENT_WINDOW_MS = 5 * HOUR;
export const WEEK_WINDOW_MS = 7 * 24 * HOUR;
const key = (cli: ReviewerPref): string => `quota:${cli}`;

interface Seen {
  limitedSince: number | null;
  resetsAt: number | null;
  lastAnswerAt: number | null;
}
const NOTHING: Seen = { limitedSince: null, resetsAt: null, lastAnswerAt: null };

/**
 * When a vendor's refusal says the limit lifts, read out of its words. Vendors phrase it as a wait ("try again
 * in 3h 12m", "resets in 45 minutes") or as a clock time ("resets at 3:00pm", "resets 14:30"). A time of day
 * with no date is the next time the clock shows it. Null when the words name no time.
 */
export function parseResetHint(text: string, now: number): number | null {
  const wait = /(?:try again|retry|resets?|available|back)\s+(?:again\s+)?(?:in|after)\s+((?:\d+\s*(?:d(?:ays?)?|h(?:(?:ou)?rs?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)[\s,]*(?:and\s+)?)+)/i.exec(text);
  if (wait) {
    let ms = 0;
    for (const [, amount, unit] of wait[1]!.matchAll(/(\d+)\s*([dhms])/gi)) ms += Number(amount) * { d: 24 * HOUR, h: HOUR, m: 60_000, s: 1000 }[unit!.toLowerCase() as 'd' | 'h' | 'm' | 's'];
    if (ms > 0) return now + ms;
  }
  const clock = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (clock && (clock[2] !== undefined || clock[3] !== undefined)) {
    let hour = Number(clock[1]);
    const meridiem = clock[3]?.toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour > 23) return null;
    const at = new Date(now);
    at.setHours(hour, Number(clock[2] ?? 0), 0, 0);
    return at.getTime() <= now ? at.getTime() + 24 * HOUR : at.getTime();
  }
  return null;
}

/**
 * Words that are a usage limit and nothing else. Narrower than `saysUsageLimit`, which also takes rate limits,
 * 429s, overload and capacity: those are a busy server, not a subscription waiting for its reset.
 */
const EXPLICIT_LIMIT = /usage limit|limit reached|hit your [\w ]*limit/i;

/**
 * Whether a failed engine turn was a subscription's usage limit with the time it resets, read from what the
 * CLI or provider said. `engine` is the engine the task ran on; a refusal through the session brain is the
 * Claude subscription's whoever the engine was. Null unless both the limit and a reset time in the future were
 * said in so many words: a reset time is never guessed, from a default or from the length of a window.
 */
export function classifyQuotaFailure(failure: { engine: string | null; error: unknown }, now: number): { subscription: ReviewerPref; resetAt: number } | null {
  const said = errorMessage(failure.error);
  if (!EXPLICIT_LIMIT.test(said)) return null;
  const subscription = failure.error instanceof Error && failure.error.name === 'SessionBrainError' ? 'claude-code' : ReviewerPref.safeParse(failure.engine).data;
  if (subscription === undefined) return null;
  const resetAt = parseResetHint(said, now);
  return resetAt !== null && resetAt > now ? { subscription, resetAt } : null;
}

/**
 * What the daemon knows about each subscription it works through, from its own side of the wire.
 *
 * The daemon never reads a vendor's login, so it cannot ask an account for its balance, and none of the four
 * CLIs reports one in a run it can drive. What it can see is exact, though narrower: whether the CLI is there,
 * every token the studio itself put through it (the usage ledger), and each refusal for a usage limit, with
 * the reset time when the vendor's message names one. That is what this records and reports. A subscription
 * shared with other tools can be nearer its limit than these numbers say.
 *
 * The engines and the session brain report each outcome here; a change of state goes out as `quota.changed`.
 * What was last seen is kept in the database, so a restart does not forget that a limit is still in force.
 */
export class QuotaTracker {
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #clock: Clock;

  constructor(deps: { store: Store; events: EventLog; clock: Clock }) {
    this.#store = deps.store;
    this.#events = deps.events;
    this.#clock = deps.clock;
  }

  /** The subscription answered: whatever limit it was under has lifted. */
  answered(cli: ReviewerPref): void {
    const seen = this.#seen(cli);
    this.#save(cli, { limitedSince: null, resetsAt: null, lastAnswerAt: this.#clock() });
    if (seen.limitedSince !== null) this.#events.emit({ projectId: null, taskId: null }, { type: 'quota.changed', subscription: cli, state: 'ok', resetsAt: null });
  }

  /** A call through the subscription failed. Only a refusal for a usage limit changes what is known. */
  failed(cli: ReviewerPref, err: unknown): void {
    const said = errorMessage(err);
    if (!saysUsageLimit(said)) return;
    const now = this.#clock();
    const seen = this.#seen(cli);
    const resetsAt = parseResetHint(said, now) ?? seen.resetsAt;
    this.#save(cli, { ...seen, limitedSince: seen.limitedSince ?? now, resetsAt });
    if (seen.limitedSince === null || seen.resetsAt !== resetsAt) this.#events.emit({ projectId: null, taskId: null }, { type: 'quota.changed', subscription: cli, state: 'limited', resetsAt });
  }

  /** Every subscription as of now. `connections` is the engines' own report of whether each CLI is installed and answering. */
  snapshot(connections: readonly { id: string; available: boolean; reason: string }[]): { at: number; subscriptions: SubscriptionQuota[] } {
    const now = this.#clock();
    const subscriptions = ReviewerPref.options.map((id): SubscriptionQuota => {
      const seen = this.#seen(id);
      const connection = connections.find((c) => c.id === id);
      // A reset time that has passed is a limit that should have lifted: unknown until the next call says.
      const lapsed = seen.limitedSince !== null && seen.resetsAt !== null && seen.resetsAt <= now;
      return {
        id,
        connected: connection?.available ?? false,
        detail: connection?.reason ?? 'not registered',
        state: seen.limitedSince !== null ? (lapsed ? 'unknown' : 'limited') : seen.lastAnswerAt !== null ? 'ok' : 'unknown',
        resetsAt: lapsed ? null : seen.resetsAt,
        limitedSince: seen.limitedSince,
        lastAnswerAt: seen.lastAnswerAt,
        recent: this.#store.subscriptionUsage(id, now - RECENT_WINDOW_MS),
        week: this.#store.subscriptionUsage(id, now - WEEK_WINDOW_MS),
      };
    });
    return { at: now, subscriptions };
  }

  #seen(cli: ReviewerPref): Seen {
    try {
      return { ...NOTHING, ...(JSON.parse(this.#store.kvGet(key(cli)) ?? '{}') as Partial<Seen>) };
    } catch {
      return NOTHING;
    }
  }

  #save(cli: ReviewerPref, seen: Seen): void {
    this.#store.kvSet(key(cli), JSON.stringify(seen));
  }
}

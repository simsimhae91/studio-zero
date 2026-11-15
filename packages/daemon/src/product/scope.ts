import type { ScreenSpec, Trails } from '@studio-zero/protocol';
import { SCREEN_SPEC_FILE } from '../scratch/ScreenSpec.ts';

/** What a set of changed files reaches through imports, as `reachScript` reads it off a workspace. */
export interface Reach {
  /** The changed files and every file that imports one of them, however far up. */
  affected: string[];
  /** Of those, the files that name a screen (its id as a quoted string), with the ids. */
  named: Record<string, string[]>;
  /** How many files of the whole workspace name a screen. */
  screenFiles: number;
  /** Changed files that are not source and that nothing imports. */
  loose: string[];
}

/**
 * How much of a product a change has to be walked for. Never "skip it": a change is refused, or it needs no
 * walk and that is said, or everything is walked, or the scenarios that stand on the screens it reaches.
 */
export type Scope =
  /** It may not land as a small edit at all. */
  | { kind: 'refused'; why: string }
  | { kind: 'none'; why: string }
  | { kind: 'all'; why: string }
  | { kind: 'some'; screens: string[]; scenarios: string[]; why: string };

/** A step that this share of the scenarios carry is the way in (signing up, the first run), not what a scenario is about. */
export const PREFIX_SHARE = 0.8;
/** A change that reaches more than this share of the files that name a screen is a change to the whole product. */
export const WIDE_SHARE = 0.6;

const isDoc = (file: string): boolean => /\.(md|mdx|txt)$/i.test(file) || (file.startsWith('docs/') && !file.endsWith('.json'));
const list = (items: readonly string[], limit = 4): string => `${items.slice(0, limit).join(', ')}${items.length > limit ? ` and ${items.length - limit} more` : ''}`;

/**
 * The scope of a small edit, from what it changed. A pure function of the diff, the plan, what the diff reaches
 * (`reach`, null when it could not be read) and where the project's last full walk went (`trails`, null before
 * there has been one).
 *
 * Screens come from the files: a file that names a screen's id is that screen, and a changed file is every
 * screen whose file imports it, however far up. Scenarios come from the screens: every scenario with a step of
 * its own on one of them. A step nearly every scenario carries (the way in) is nobody's own, so a screen that
 * only such steps stand on is walked once, by the shortest scenario; a screen no step stands on is found in the
 * trails. Whatever cannot be placed is walked for in full.
 */
export function scopeOf(input: { changed: readonly string[]; spec: ScreenSpec; reach: Reach | null; trails: Trails | null }): Scope {
  const { spec, reach, trails } = input;
  const changed = [...new Set(input.changed.map((file) => file.trim()).filter(Boolean))];
  if (changed.length === 0) return { kind: 'none', why: 'nothing was changed' };
  const schema = changed.filter((file) => file.startsWith('supabase/'));
  if (schema.length > 0) return { kind: 'refused', why: `it changes the backend (${list(schema)}). A small edit does not change the schema or what the backend runs: the database is one for the whole project and for every task at work on it. Ask for this as a build.` };
  const code = changed.filter((file) => !isDoc(file));
  if (code.length === 0) return { kind: 'none', why: `only documents were changed (${list(changed)})` };
  if (code.includes(SCREEN_SPEC_FILE)) return { kind: 'all', why: `the screen plan (${SCREEN_SPEC_FILE}) was changed` };
  // A brought-in product may sit in a folder of its repository. What is changed outside that folder (a shared
  // package, a script the build runs) reaches the product by ways the imports under it do not show.
  const outside = code.filter((file) => file.startsWith('../'));
  if (outside.length > 0) return { kind: 'all', why: `${list(outside)} ${outside.length === 1 ? 'is' : 'are'} outside the product's folder, so what ${outside.length === 1 ? 'it reaches' : 'they reach'} cannot be read off the product's imports` };
  if (!reach) return { kind: 'all', why: 'what the change reaches could not be read off the imports' };
  if (reach.loose.length > 0) return { kind: 'all', why: `${list(reach.loose)} ${reach.loose.length === 1 ? 'is' : 'are'} not source that anything imports, so what ${reach.loose.length === 1 ? 'it reaches' : 'they reach'} is the whole product` };

  const planned = new Set(spec.screens.map((screen) => screen.id));
  const naming = reach.affected.filter((file) => (reach.named[file] ?? []).some((id) => planned.has(id)));
  const screens = [...new Set(naming.flatMap((file) => reach.named[file]!.filter((id) => planned.has(id))))];
  if (screens.length === 0) return { kind: 'all', why: `${list(code)} ${code.length === 1 ? 'reaches' : 'reach'} no file that names a screen of the plan` };
  if (reach.screenFiles > 0 && naming.length / reach.screenFiles > WIDE_SHARE) return { kind: 'all', why: `the change reaches ${naming.length} of the ${reach.screenFiles} files that name a screen` };

  const scenarios = spec.scenarios;
  if (scenarios.length <= 2) return { kind: 'all', why: `the plan has ${scenarios.length === 1 ? 'one scenario' : `${scenarios.length} scenarios`}` };
  const carried = new Map<string, number>();
  for (const scenario of scenarios) for (const id of new Set(scenario.steps.map((step) => step.id))) carried.set(id, (carried.get(id) ?? 0) + 1);
  const isPrefix = (step: string): boolean => (carried.get(step) ?? 0) / scenarios.length >= PREFIX_SHARE;
  const shortest = (candidates: readonly string[]): string => candidates.map((id) => scenarios.find((s) => s.id === id)!).reduce((a, b) => (b.steps.length < a.steps.length ? b : a)).id;

  const picked = new Set<string>();
  for (const screen of screens) {
    const own = scenarios.filter((s) => s.steps.some((step) => step.screen.trim() === screen && !isPrefix(step.id))).map((s) => s.id);
    const passedOnOwn = scenarios.filter((s) => (trails?.[s.id] ?? []).some((at) => at.screen === screen && !isPrefix(at.step))).map((s) => s.id);
    const theirs = [...new Set([...own, ...passedOnOwn])];
    if (theirs.length > 0) {
      for (const id of theirs) picked.add(id);
      continue;
    }
    const onTheWayIn = scenarios.filter((s) => s.steps.some((step) => step.screen.trim() === screen) || (trails?.[s.id] ?? []).some((at) => at.screen === screen)).map((s) => s.id);
    if (onTheWayIn.length === 0) return { kind: 'all', why: `no scenario is known to reach screen ${screen}${trails ? '' : ' (the project has not been walked in full yet: a full check records where every scenario goes)'}` };
    picked.add(shortest(onTheWayIn));
  }
  // A scenario that goes on from another (the second person joining what the first made) needs it walked first.
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  for (const id of [...picked]) for (let before = byId.get(id)?.after?.trim(); before && byId.has(before) && !picked.has(before); before = byId.get(before)?.after?.trim()) picked.add(before);
  if (picked.size === scenarios.length) return { kind: 'all', why: `the screens it reaches (${list(screens)}) are stood on by every scenario` };
  return { kind: 'some', screens, scenarios: scenarios.map((s) => s.id).filter((id) => picked.has(id)), why: `${list(code)} ${code.length === 1 ? 'reaches' : 'reach'} ${screens.length === 1 ? 'screen' : 'screens'} ${list(screens, 8)}` };
}

/** A scope in a few Korean words, for the line a task card shows. `total` is how many scenarios the plan has. */
export function scopeLabel(scope: Scope, total: number): string {
  if (scope.kind === 'refused') return '들어갈 수 없음';
  if (scope.kind === 'none') return '걷지 않음';
  if (scope.kind === 'all') return `시나리오 전체 ${total}개`;
  return `화면 ${scope.screens.length}개 · 시나리오 ${scope.scenarios.length}/${total}개`;
}

/** A scope as a sentence, for the gate's detail and for the engine it may be sent back to. */
export function renderScope(scope: Scope, total: number): string {
  if (scope.kind === 'refused') return `This change cannot land as a small edit: ${scope.why}`;
  if (scope.kind === 'none') return `Nothing is walked: ${scope.why}.`;
  if (scope.kind === 'all') return `Every scenario is walked (${total}): ${scope.why}.`;
  return `${scope.scenarios.length} of ${total} scenarios walked (${scope.scenarios.join(', ')}) and ${scope.screens.length === 1 ? 'one screen' : `${scope.screens.length} screens`} measured (${scope.screens.join(', ')}): ${scope.why}.`;
}

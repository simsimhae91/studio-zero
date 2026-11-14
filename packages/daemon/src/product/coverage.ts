import type { ProductMap, ScreenSpec } from '@studio-zero/protocol';
import { SCREEN_SPEC_FILE } from '../scratch/ScreenSpec.ts';

/**
 * The features of the milestones built so far (up to and including `upTo`, counted from 0) that no scenario of
 * the screen plan walks. One sentence each, for the builder. Counted, not judged: a feature is walked when a
 * scenario carries its id in "feature" and has a step after signing up.
 *
 * This is what keeps a wide plan from being built thin. The scenario gate walks whatever the plan lists; a plan
 * that lists nothing for a feature would pass with the feature unbuilt, or built and never opened.
 */
export function uncovered(map: ProductMap, spec: ScreenSpec, upTo: number): string[] {
  const walked = new Set(spec.scenarios.filter((scenario) => scenario.steps.length >= 2).map((scenario) => (scenario.feature ?? '').trim()));
  const byId = new Map(map.features.map((feature) => [feature.id, feature]));
  const problems: string[] = [];
  for (const [i, milestone] of map.milestones.entries()) {
    if (i > upTo) break;
    for (const id of milestone.features) {
      if (walked.has(id)) continue;
      const name = byId.get(id)?.name.trim() ?? id;
      problems.push(
        `Feature "${id}" (${name}), of milestone ${i + 1}: no scenario in ${SCREEN_SPEC_FILE} walks it. Give it one marked "feature": "${id}": a new person signs up and uses it to its outcome, with at least one step after signing up${i < upTo ? '. It was walked before this milestone and its scenario is gone: put it back' : ''}.`,
      );
    }
  }
  // A scenario that names a feature the map does not have is a mistyped id, and would leave the real one unwalked.
  for (const scenario of spec.scenarios) {
    const id = (scenario.feature ?? '').trim();
    if (id !== '' && !byId.has(id)) problems.push(`Scenario "${scenario.id}" is marked "feature": "${id}", and the product map has no feature of that id. Its features are: ${map.features.map((feature) => feature.id).join(', ')}.`);
  }
  return problems;
}

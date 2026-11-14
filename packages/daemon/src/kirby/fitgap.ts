import type { RepoProfile } from './analyze.ts';

/** The numbers reported before and after a proposal is implemented. Same function on both sides, so deltas are comparable. */
export function measure(profile: RepoProfile, lintMajors: number): Record<string, number> {
  const metrics: Record<string, number> = {
    'source files': profile.sourceFiles,
    'lines of code': profile.loc,
    '`any` annotations': profile.metrics.anyCount,
    'type/lint suppressions': profile.metrics.suppressions,
    'import cycles': profile.metrics.importCycles,
    'test files': profile.metrics.testFiles,
    'mean file complexity': profile.metrics.meanComplexity,
    'slop-lint major findings': lintMajors,
  };
  for (const p of profile.practices) metrics[`practice: ${p.id}`] = p.present ? 1 : 0;
  return metrics;
}

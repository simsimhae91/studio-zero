import type { Evidence, PracticeId, RepoProfile } from './analyze.ts';

export interface Gap {
  practiceId: PracticeId;
  title: string;
  /** How the source repository does it. */
  sourceEvidence: Evidence[];
  sourceDetail: string;
  /** What the target project has instead. */
  targetDetail: string;
  /** Why this gap is ranked where it is. */
  basis: string;
}

/**
 * Order in which gaps are worth closing: guards on correctness first, then the safety net, then structure and
 * polish. A fixed order keeps proposals comparable from one ingest to the next.
 */
const PRIORITY: PracticeId[] = [
  'strict-typescript',
  'schema-validated-boundaries',
  'automated-tests',
  'typed-env',
  'error-boundaries',
  'exhaustive-switch',
  'accessible-primitives',
  'design-tokens',
  'lint-and-format',
  'ci-verification',
  'import-boundaries',
  'result-types',
];

/** Practices that only make sense once the target has UI code. */
const UI_ONLY: PracticeId[] = ['error-boundaries', 'accessible-primitives', 'design-tokens'];

/**
 * Deterministic fit-gap: a practice is a gap when the source repository demonstrably uses it (with evidence)
 * and the target project demonstrably does not, and it applies to what the target is.
 * The model is not asked what is missing; it is only asked, later, how to close a gap found here.
 */
export function fitGap(source: RepoProfile, target: RepoProfile): Gap[] {
  const targetHasUi = target.modules.some((m) => m.jsx);
  const targetUsesTypeScript = target.modules.some((m) => /\.[cm]?tsx?$/.test(m.path));
  const gaps: Gap[] = [];
  for (const id of PRIORITY) {
    const theirs = source.practices.find((p) => p.id === id);
    const ours = target.practices.find((p) => p.id === id);
    if (!theirs?.present || !ours || ours.present) continue;
    if (UI_ONLY.includes(id) && !targetHasUi) continue;
    if ((id === 'strict-typescript' || id === 'exhaustive-switch') && !targetUsesTypeScript) continue;
    if (target.sourceFiles === 0) continue; // nothing to improve yet
    gaps.push({
      practiceId: id,
      title: theirs.title,
      sourceEvidence: theirs.evidence,
      sourceDetail: theirs.detail,
      targetDetail: ours.detail,
      basis: `present in source (${theirs.detail}); absent in target (${ours.detail})`,
    });
  }
  return gaps;
}

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

import type { Readiness, ScratchEntry, Scratchpad, SpecSection } from '@studio-zero/protocol';
import type { DecisionRow } from '../db/Store.ts';

const SECTION_TITLES: [SpecSection, string][] = [
  ['problem', '문제'],
  ['users', '사용자'],
  ['scope_in', '범위: 포함'],
  ['scope_out', '범위: 제외'],
  ['requirements', '요구사항'],
  ['success', '성공 기준'],
  ['open_questions', '열린 질문'],
];
const REQUIRED: SpecSection[] = ['problem', 'users', 'scope_in', 'requirements'];
const CONFIDENCE = { high: '높음', medium: '보통', speculative: '추정' } as const;

/** spec.md, assembled from the stored sections in a fixed order. Empty sections are left out, not padded. */
export function compileSpec(pad: Scratchpad, sections: Partial<Record<SpecSection, string>>): string {
  const body = SECTION_TITLES.flatMap(([key, title]) => (sections[key]?.trim() ? [`## ${title}\n\n${sections[key]!.trim()}`] : []));
  return `# ${pad.title}\n\n${body.join('\n\n')}\n`;
}

/**
 * decision_log.md: every settled question with what was chosen, who settled it, and each alternative that lost
 * with the reason. Compiled from rows, so it cannot drift from what was actually decided.
 */
export function compileDecisionLog(pad: Scratchpad, decisions: readonly DecisionRow[]): string {
  const entries = decisions.map((d, i) => {
    const rejected = d.rejected.length === 0 ? '- 검토한 다른 대안 없음' : `- 기각한 대안:\n${d.rejected.map((r) => `  - ${r.option}: ${r.why}`).join('\n')}`;
    return `## ${i + 1}. ${d.question}\n\n- 결정: ${d.chosen}\n- 결정한 쪽: ${d.decidedBy === 'owner' ? '소유자' : `에이전트 (확신도 ${CONFIDENCE[d.confidence]})`}\n- 이유: ${d.why}\n${rejected}`;
  });
  return `# 결정 기록: ${pad.title}\n\n${entries.length === 0 ? '아직 기록된 결정이 없습니다.' : entries.join('\n\n')}\n`;
}

/** Questions the owner was asked and has not answered yet. */
export function openQuestions(entries: readonly ScratchEntry[]): string[] {
  const answered = new Set(entries.flatMap((e) => (e.response ? [e.response.blockId] : [])));
  return entries.flatMap((e) => e.blocks.flatMap((b) => ((b.type === 'choice' || b.type === 'form') && !answered.has(b.id) ? [b.type === 'choice' ? b.question : b.title] : [])));
}

/** Whether a scratchpad can be handed to a builder, and if not, what is missing. Arithmetic on stored state. */
export function readiness(sections: Partial<Record<SpecSection, string>>, decisions: readonly DecisionRow[], entries: readonly ScratchEntry[]): Readiness {
  const titles = new Map(SECTION_TITLES);
  const missing = REQUIRED.filter((key) => !sections[key]?.trim()).map((key) => `기획 명세의 "${titles.get(key)}" 항목`);
  if (decisions.length === 0) missing.push('기록된 결정 1건 이상');
  const open = openQuestions(entries);
  if (open.length > 0) missing.push(`답하지 않은 질문 ${open.length}건`);
  return { ready: missing.length === 0, missing };
}

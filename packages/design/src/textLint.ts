import type { TextFinding } from '@studio-zero/protocol';

export type DocumentKind = 'brief' | 'report' | 'prd' | 'rfc';

/**
 * The written half of the anti-slop gate. Finds, in a Markdown document, the habits that make text read as
 * generated: inflated vocabulary, an opening that talks about the document instead of saying something,
 * quantities with no number, hedges stacked on hedges, lists of virtues, claims with no source.
 *
 * Deterministic, so a document either passes or comes back with line numbers, and the same check runs on every
 * draft. It judges form, not truth: whether a claim is right is the research pipeline's job.
 */

/** Phrases that carry no information. Matched case-insensitively; each entry is a regular expression source. */
const CLICHES: string[] = [
  // Korean
  '혁신적인?', '획기적인?', '패러다임', '게임\\s?체인저', '시너지', '차세대', '최첨단', '원활한', '극대화', '고도화', '선도적인?', '탁월한', '강력한 솔루션', '새로운 지평', '무궁무진', '각광받', '4차 산업혁명', '디지털 전환의 시대',
  '급변하는', '빠르게 변화하는', '오늘날[^.\\n]{0,12}시대', '주목할 만한 점은', '결론적으로', '종합적으로 볼 때', '다양한 측면에서', '에 있어서',
  // English
  'seamless(?:ly)?', 'leverag(?:e|es|ed|ing)', 'delve', 'tapestry', 'paradigm', 'game[- ]chang(?:er|ing)', 'cutting[- ]edge', 'state[- ]of[- ]the[- ]art', 'revolutioni[sz]e', 'unlock(?:s|ing)? the', 'supercharge', 'empower(?:s|ing)?', 'robust', 'holistic', 'synerg(?:y|ies)', 'best[- ]in[- ]class', 'world[- ]class',
  "in today's (?:fast[- ]paced|rapidly|digital)", "it(?:'s| is) (?:worth noting|important to note)", 'in conclusion', 'at the end of the day', 'plays? a (?:crucial|vital|key|pivotal) role', 'a testament to', 'navigat(?:e|ing) the (?:complex|landscape)',
];
const CLICHE_RE = new RegExp(`(${CLICHES.join('|')})`, 'i');

/** Openings that announce the document instead of starting it. */
const THROAT_CLEARING = /^(?:이\s?(?:문서|보고서|글|리포트)(?:는|에서는)|본\s?(?:문서|보고서|리포트)(?:는|에서는)|오늘날|최근\s?들어|현대\s?사회|in this (?:document|report|brief)|this (?:document|report|brief) (?:will|aims|provides|explores|outlines)|in recent years|as (?:we all )?know)/i;

const VAGUE = /(많은|다수의|상당한|수많은|대부분의|여러 가지|일부|크게|대폭|significant(?:ly)?|substantial(?:ly)?|numerous|several|many|a lot of|considerabl[ey]|dramatically)/i;
const HEDGE = /(일 수도 있을 것으로 보(?:입니다|인다)|할 수 있을 것으로 (?:보|예상|기대)|것으로 사료|may potentially|could possibly|might perhaps|it (?:could|might) be argued that|seems to possibly)/i;
const HAS_NUMBER = /\d/;
const CITATION = /\[\d+\]|\]\(https?:\/\//;

/** Sections a document of each kind must contain. A heading matches when it contains any of the listed words. */
const REQUIRED_SECTIONS: Record<DocumentKind, [string, string[]][]> = {
  brief: [['결론', ['결론', '요약', '핵심', 'bottom line', 'summary', 'conclusion']]],
  report: [
    ['결론', ['결론', '요약', '핵심', 'bottom line', 'summary', 'conclusion', 'recommendation']],
    ['근거', ['근거', '분석', '데이터', '사실', 'evidence', 'analysis', 'findings']],
    ['한계와 리스크', ['리스크', '한계', '위험', '불확실', 'risk', 'limitation', 'caveat']],
    ['다음 단계', ['다음', '실행', '권고', '조치', 'next', 'action', 'recommend']],
  ],
  prd: [
    ['문제', ['문제', 'problem']],
    ['사용자', ['사용자', '대상', 'user', 'audience']],
    ['범위', ['범위', 'scope']],
    ['요구사항', ['요구', 'requirement']],
    ['성공 기준', ['성공', '지표', 'success', 'metric']],
  ],
  rfc: [
    ['요약', ['요약', 'summary']],
    ['동기', ['동기', '배경', '문제', 'motivation', 'background']],
    ['설계', ['설계', '제안', 'design', 'proposal']],
    ['대안', ['대안', 'alternative']],
    ['미해결 질문', ['미해결', '열린', 'open', 'unresolved']],
  ],
};
const BLUF_HEADINGS = ['결론', '요약', '핵심', 'bottom line', 'summary', 'conclusion', 'recommendation', 'tl;dr', '문제'];

const MERMAID_KINDS = /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|timeline|mindmap|quadrantChart|xychart-beta|gitGraph|C4Context|C4Container)\b/;

export interface TextLintOptions {
  kind: DocumentKind;
  /** Research-backed documents must cite: a sentence that states a figure needs a source marker. */
  requireCitations?: boolean;
}

export function lintText(markdown: string, opts: TextLintOptions): TextFinding[] {
  const findings: TextFinding[] = [];
  const add = (rule: string, severity: TextFinding['severity'], line: number, message: string, fix: string): void => void findings.push({ rule, severity, line, message, fix });
  const lines = markdown.split('\n');

  // Walk the document once, skipping code fences (but checking Mermaid ones).
  const prose: { line: number; text: string }[] = [];
  const headings: { line: number; level: number; text: string }[] = [];
  let fence: { lang: string; start: number; body: string[] } | null = null;
  lines.forEach((raw, i) => {
    const line = i + 1;
    const open = /^\s*(```|~~~)\s*([\w-]*)/.exec(raw);
    if (open) {
      if (fence === null) fence = { lang: open[2] ?? '', start: line, body: [] };
      else {
        if (fence.lang === 'mermaid' && !MERMAID_KINDS.test(fence.body.find((l) => l.trim() !== '' && !l.trim().startsWith('%%'))?.trim() ?? '')) {
          add('text/mermaid-syntax', 'major', fence.start, 'This Mermaid block does not start with a diagram type, so it will not render.', 'Begin the block with a diagram type such as `flowchart TD`, `sequenceDiagram` or `erDiagram`.');
        }
        fence = null;
      }
      return;
    }
    if (fence !== null) return void fence.body.push(raw);
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(raw);
    if (heading) return void headings.push({ line, level: heading[1]!.length, text: heading[2]! });
    if (raw.trim() !== '' && !/^\s*\|/.test(raw)) prose.push({ line, text: raw });
  });

  // 1. Inflated vocabulary.
  for (const { line, text } of prose) {
    const hit = CLICHE_RE.exec(text);
    if (hit) add('text/cliche', 'major', line, `"${hit[1]}" says nothing a reader can check.`, 'Replace it with the specific thing it stands for: what changes, by how much, for whom. If nothing specific is behind it, delete the sentence.');
  }
  for (const h of headings) {
    const hit = CLICHE_RE.exec(h.text);
    if (hit) add('text/cliche', 'major', h.line, `Heading uses "${hit[1]}".`, 'Name the section by what it contains.');
  }

  // 2. Bottom line up front.
  const firstProse = prose[0];
  if (firstProse && THROAT_CLEARING.test(firstProse.text.replace(/^[\s>*_-]+/, ''))) {
    add('text/throat-clearing', 'major', firstProse.line, 'The document opens by describing itself or the times instead of stating its conclusion.', 'Start with the conclusion or recommendation in one or two sentences; the reader may stop after them.');
  }
  const sectionHeads = headings.filter((h) => h.level >= 2);
  const firstSection = sectionHeads[0];
  if (!firstSection) add('text/structure', 'major', 1, 'The document has no sections.', 'Give it headed sections, the first of which states the conclusion.');
  else if (!BLUF_HEADINGS.some((word) => firstSection.text.toLowerCase().includes(word))) {
    add('text/no-bluf', 'major', firstSection.line, `The first section is "${firstSection.text}"; a reader should meet the conclusion first.`, 'Open with a "결론" (or "요약") section of at most five sentences, then give the support.');
  } else {
    const end = sectionHeads[1]?.line ?? Infinity;
    const body = prose.filter((p) => p.line > firstSection.line && p.line < end).map((p) => p.text).join(' ');
    if (body.split(/(?<=[.!?。])\s+|(?<=다\.)\s*/).filter((s) => s.trim().length > 0).length > 6) {
      add('text/long-bluf', 'minor', firstSection.line, 'The opening section runs past six sentences.', 'Cut it to the decision, the main reason and the one number that matters. Move the rest down.');
    }
  }

  // 3. Required sections for this kind of document.
  for (const [name, words] of REQUIRED_SECTIONS[opts.kind]) {
    if (!headings.some((h) => words.some((w) => h.text.toLowerCase().includes(w)))) add('text/structure', 'major', 1, `A ${opts.kind} needs a "${name}" section.`, `Add a section whose heading contains "${name}".`);
  }

  // 4. Quantities without numbers, stacked hedges, unsourced figures.
  let vague = 0;
  for (const { line, text } of prose) {
    for (const sentence of text.split(/(?<=[.!?。])\s+/)) {
      if (VAGUE.test(sentence) && !HAS_NUMBER.test(sentence)) {
        vague += 1;
        if (vague <= 5) add('text/vague-quantity', 'minor', line, `"${VAGUE.exec(sentence)![1]}" with no number: ${sentence.trim().slice(0, 80)}`, 'Give the number, the range or the comparison. If it is not known, say so in those words.');
      }
      if (HEDGE.test(sentence)) add('text/hedge-stack', 'minor', line, `Stacked hedging: ${sentence.trim().slice(0, 80)}`, 'State what is known and, separately, what is uncertain and why.');
      if (opts.requireCitations && /\d[\d,.]*\s?(?:%|퍼센트|억|조|만|원|달러|명|개|건|배|\$|USD|KRW|million|billion|percent)/i.test(sentence) && !CITATION.test(sentence)) {
        add('text/unsourced-figure', 'major', line, `A figure with no source: ${sentence.trim().slice(0, 80)}`, 'Add the citation marker of the source that states it, e.g. [2], or remove the figure.');
      }
    }
  }
  if (vague > 5) add('text/vague-quantity', 'major', 1, `${vague} quantities are stated without a number.`, 'A document that says "many" and "significant" throughout is asking to be taken on trust. Replace them with figures.');
  if (opts.kind !== 'brief' && !prose.some((p) => HAS_NUMBER.test(p.text))) add('text/no-numbers', 'major', 1, 'The document contains no numbers at all.', 'State sizes, dates, counts, costs or thresholds. A report or spec without one is a description of intentions.');

  // 5. Lists of virtues: many bullets, each a word or two.
  let run: { start: number; short: number; total: number } | null = null;
  const closeRun = (): void => {
    if (run && run.total >= 5 && run.short / run.total >= 0.8) add('text/empty-list', 'minor', run.start, `A list of ${run.total} items with almost no content in each.`, 'Say what each item means here and why it is on the list, or turn the list into one sentence.');
    run = null;
  };
  lines.forEach((raw, i) => {
    const item = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(raw);
    if (!item) return closeRun();
    run ??= { start: i + 1, short: 0, total: 0 };
    run.total += 1;
    if (item[1]!.trim().split(/\s+/).length <= 3) run.short += 1;
  });
  closeRun();

  // 6. Tone of a formal document.
  for (const { line, text } of prose) {
    if (/[\p{Extended_Pictographic}](?<![©®™0-9#*])/u.test(text)) add('text/emoji', 'minor', line, 'Emoji in a formal document.', 'Remove it.');
    if (/!{1,}\s*$/.test(text.trim()) || /!!/.test(text)) add('text/exclamation', 'minor', line, 'Exclamation mark.', 'End the sentence with a full stop; let the content carry the emphasis.');
  }

  return findings.sort((a, b) => a.line - b.line);
}

export const textLintRuleIds = ['text/cliche', 'text/throat-clearing', 'text/no-bluf', 'text/long-bluf', 'text/structure', 'text/vague-quantity', 'text/hedge-stack', 'text/unsourced-figure', 'text/no-numbers', 'text/empty-list', 'text/emoji', 'text/exclamation', 'text/mermaid-syntax'];

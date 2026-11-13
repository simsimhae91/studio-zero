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

// ------------------------------------------------------------------ interface copy

/**
 * The habits that make Korean interface copy read as generated. Each entry is one habit: what it is called, the
 * wording that gives it away, and what to write instead. `lintInterfaceText` applies them to the text of a
 * rendered screen; the `rule` is what the builder is told.
 *
 * A habit is matched where it lives. A list of features is a sentence that chains predicates and ends as a
 * statement; an empty slogan is a title; a stock call to action is the whole label of a control. So each entry
 * says which kind of text it reads, and the regular expression only has to be right for that kind.
 */
export const KOREAN_TEXT_SLOP_PATTERNS = [
  {
    id: 'feature-list-dumping',
    name: '사실 목록을 설명문으로 줄줄이 나열',
    // Predicates chained with -하고/-하며 and closed with a statement of doing: "…토론하고 …고칩니다". The closing
    // verb is one of doing or providing, so "친구하고 봅니다" (with a friend) is not a list of features.
    regex: /(?:[가-힣]+(?:하고|하며|되고|되며)|고치고|만들고|나누고|모으고|바꾸고|찾고|돕고)[,\s][^.!?\n]*?(?:[가-힣]+(?:합니다|됩니다)|고칩니다|만듭니다|줍니다|드립니다|나눕니다|모읍니다|바꿉니다|찾습니다|돕습니다)/,
    rule: '기능 나열 대신 구체적인 단 하나의 장면(누가, 어떤 순간에)으로 교체하라.',
    reads: 'sentence',
    severity: 'major',
  },
  {
    id: 'passive-explanation-tone',
    name: '…합니다/…됩니다 설명조 연속',
    regex: /((?:으)?로 이루어집니다|따라가면 됩니다|확인하실 수 있습니다|하실 수 있습니다|제공됩니다|구성되어 있습니다)/,
    rule: '설명문 대신 유저가 던질 말 또는 화면이 바로 내놓는 직관적 상태로 교체하라.',
    reads: 'sentence',
    severity: 'major',
  },
  {
    id: 'empty-slogan-title',
    name: '알맹이 없는 구호형 제목',
    regex: /(목표.*최종.*까지|새로운.*경험|더 나은.*미래|스마트한.*관리|쉽고 빠르게|한 ?곳에서|모든 것을 한|당신의 .*(?:파트너|동반자)|일의 미래|함께 만드는 .*(?:내일|미래))/,
    rule: '추상적 구호 대신 고유한 숫자와 실제 기능 낱말을 써라 (예: "채우는 쪽이 2,000원 이득이에요").',
    reads: 'title',
    severity: 'major',
  },
  {
    id: 'generic-cta',
    name: '어디에나 붙는 공용 버튼 문구',
    // "확인" is not here on purpose: it is the honest label of an acknowledgement, and flagging it would have every
    // dialog's OK button renamed into something contrived.
    regex: /^(시작하기|더 알아보기|지금 확인하기|첫 .* 열어보기|지금 시작하기|무료로 시작하기|바로 시작하기|자세히 알아보기|제출|제출하기|Get started|Learn more|Submit)$/i,
    rule: '그 제품에서만 나올 수 있는 구체적인 행동 동사를 써라 (예: "사진에서 주소 지우기").',
    reads: 'cta',
    severity: 'major',
  },
  {
    id: 'translationese',
    name: '영어 문장을 옮겨 적은 번역투',
    // "Welcome to …", "Experience …", "Meet …", "your …", "through … you can …": sentences that were English first.
    regex: /(에 오신 (?:것|걸) ?(?:을 )?환영|(?:경험|체험)해 ?보세요|만나 ?보세요|당신(?:의|만의|을|이|에게|과)|[을를] 통해 [^.!?\n]{0,40}(?:수 있|하세요|해 ?보세요|드립니다))/,
    rule: '번역한 문장 대신 한국어로 처음 쓴 문장으로 바꿔라: 인사와 권유를 빼고, 지금 이 사람이 할 수 있는 일과 그 결과를 말하라 (예: "누수되는 관리비 3초 만에 찾기").',
    reads: 'any',
    severity: 'major',
  },
  {
    id: 'long-notice',
    name: '세 문장이 넘는 독백형 안내문',
    regex: null,
    rule: '안내를 한 줄의 핵심으로 줄이고, 나머지는 조건이나 수치를 담은 짧은 라벨로 나눠라.',
    reads: 'body',
    // An interface can also hold real prose (a message someone wrote, a policy), which read as text alone looks
    // the same as a notice. So this one is said and not held to zero.
    severity: 'minor',
  },
  {
    id: 'uniform-card-grid',
    name: '동일한 무게의 카드 무지성 3~4개 나열',
    regex: null,
    rule: '중요도 1순위 항목을 2~3배 크게 배치하고 나머지는 서브로 위계를 분리하라.',
    reads: 'layout',
    severity: 'minor',
  },
] as const;

export type KoreanTextSlopId = (typeof KOREAN_TEXT_SLOP_PATTERNS)[number]['id'];

/** One piece of text on a screen, with what it is there. Given in reading order. */
export interface InterfaceText {
  role: 'title' | 'body' | 'cta' | 'label';
  text: string;
}

/** A box that might be one of a row of cards: its parent group and where it sits, in CSS px. */
export interface CardBox {
  group: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextSlopHit {
  pattern: KoreanTextSlopId;
  severity: 'major' | 'minor';
  /** Index into the texts (or into the cards, for `uniform-card-grid`) the hit is about. */
  index: number;
  /** The wording that matched, as it appears on the screen. */
  quote: string;
  message: string;
  /** What to write instead: the pattern's rule. */
  fix: string;
}

/** A statement in the formal explaining register: "…합니다.", "…됩니다.", "…있습니다." */
const STATEMENT_END = /[가-힣]니다[.。]?$/;
const RUN_LENGTH = 3;
/** One piece of body text that is a notice grown into a monologue: this many sentences, and at least this long. */
const NOTICE_SENTENCES = 3;
const NOTICE_CHARS = 90;
const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?。…])\s+|\n+/).map((s) => s.trim()).filter((s) => s !== '');
const pattern = (id: KoreanTextSlopId): (typeof KOREAN_TEXT_SLOP_PATTERNS)[number] => KOREAN_TEXT_SLOP_PATTERNS.find((p) => p.id === id)!;

/**
 * Reads the words of a screen the way `lintText` reads a document: deterministically, so the same copy gets the
 * same verdict on every round and a builder is told the exact wording to replace. It judges the writing alone.
 * `texts` is the screen's text and nothing else, in reading order; `cards` are candidate card boxes for the one
 * habit that is about layout (equal boxes in a row, where one should lead).
 *
 * Nothing here is a matter of taste a model has to weigh: each hit names a habit from the table above.
 */
export function lintInterfaceText(texts: readonly InterfaceText[], cards: readonly CardBox[] = []): TextSlopHit[] {
  const hits: TextSlopHit[] = [];
  const add = (id: KoreanTextSlopId, index: number, quote: string, message: string): void => {
    const p = pattern(id);
    hits.push({ pattern: id, severity: p.severity, index, quote: quote.slice(0, 120), message, fix: p.rule });
  };
  const listing = pattern('feature-list-dumping').regex!;
  const explaining = pattern('passive-explanation-tone').regex!;
  const slogan = pattern('empty-slogan-title').regex!;
  const stockCta = pattern('generic-cta').regex!;
  const translated = pattern('translationese').regex!;

  let run: { index: number; first: string; count: number } | null = null;
  const closeRun = (): void => {
    if (run && run.count >= RUN_LENGTH) add('passive-explanation-tone', run.index, run.first, `설명조 문장이 ${run.count}개 이어집니다: "${run.first.slice(0, 60)}"부터.`);
    run = null;
  };

  texts.forEach((item, index) => {
    const text = item.text.trim();
    if (text === '') return;
    // Translated phrasing gives itself away wherever it stands: a title, a sentence, a button. A short label is too little to tell.
    if (item.role !== 'label') {
      const phrase = translated.exec(text);
      if (phrase) add('translationese', index, phrase[0], `번역투입니다: "${text.slice(0, 80)}"`);
    }
    if (item.role === 'cta') {
      if (stockCta.test(text)) add('generic-cta', index, text, `버튼 문구 "${text}"는 어느 제품에나 붙습니다.`);
      return closeRun();
    }
    if (item.role === 'title') {
      const hit = slogan.exec(text);
      // A title that carries a number names something particular, whatever words surround it.
      if (hit && !/\d/.test(text)) add('empty-slogan-title', index, text, `제목 "${text.slice(0, 60)}"는 구호입니다: 무엇을 하는 제품인지 말하지 않습니다.`);
      return closeRun();
    }
    // A run is one passage of explanation. A label or a control between two statements means they belong to
    // different things on the screen (a list of options, each described in a line), which is not a passage.
    if (item.role !== 'body') return closeRun();
    const sentences = sentencesOf(text);
    if (sentences.length >= NOTICE_SENTENCES && text.length >= NOTICE_CHARS) add('long-notice', index, text, `안내문 하나가 ${sentences.length}문장입니다: "${text.slice(0, 60)}…"`);
    for (const sentence of sentences) {
      const chained = listing.exec(sentence);
      if (chained) add('feature-list-dumping', index, chained[0], `기능을 한 문장에 이어 붙였습니다: "${sentence.slice(0, 80)}"`);
      const phrase = explaining.exec(sentence);
      if (phrase) add('passive-explanation-tone', index, phrase[0], `화면이 스스로를 설명합니다: "${sentence.slice(0, 80)}"`);
      if (STATEMENT_END.test(sentence)) {
        run ??= { index, first: sentence, count: 0 };
        run.count += 1;
      } else closeRun();
    }
  });
  closeRun();

  // Equal boxes side by side: three or more of one size on one row, under one parent.
  const rows = new Map<string, number[]>();
  cards.forEach((card, i) => {
    if (card.w < 120 || card.h < 80) return;
    const key = `${card.group}|${Math.round(card.y)}|${Math.round(card.w)}x${Math.round(card.h)}`;
    rows.set(key, [...(rows.get(key) ?? []), i]);
  });
  for (const members of rows.values()) {
    if (members.length >= 3) add('uniform-card-grid', members[0]!, '', `같은 크기의 카드 ${members.length}개가 한 줄에 나란히 있습니다.`);
  }

  // One finding per habit and wording: a phrase repeated on every card is one thing to fix.
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = `${hit.pattern}|${hit.quote}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

const SLOP_WEIGHT = { major: 20, minor: 8 } as const;

/** 0 to 100, higher is worse: how much a screen's copy reads as generated. 0 means no habit was found. */
export function textSlopScore(hits: readonly TextSlopHit[]): number {
  return Math.min(100, hits.reduce((sum, hit) => sum + SLOP_WEIGHT[hit.severity], 0));
}

import type Anthropic from '@anthropic-ai/sdk';
import { lintText, type DocumentKind } from '@studio-zero/design';
import type { Fact, TextFinding } from '@studio-zero/protocol';
import { writeTurn, type ClaudeClient, type LlmScope } from '../llm/ClaudeClient.ts';
import { DATA_HANDLING_CONTRACT, untrusted } from '../trust/dataBlock.ts';
import { numberSources } from './ResearchPipeline.ts';

const WRITER_MODEL = 'claude-fable-5-2';
const MAX_ROUNDS = 3;

const SHAPES: Record<DocumentKind, string> = {
  brief: 'A one-page briefing: a "결론" section of two to four sentences, then the three to six facts that support it, then what to watch next. About 300 to 500 words.',
  report: 'A report for a decision-maker with these sections in this order: 결론, 근거, 한계와 리스크, 다음 단계. Put comparisons in tables.',
  prd: 'A product requirements document with these sections: 문제, 사용자, 범위 (what is in and what is explicitly out), 요구사항 (each with an acceptance criterion a tester could check), 성공 기준 (measurable). Include a Mermaid diagram of the main user flow.',
  rfc: 'A technical RFC with these sections: 요약, 동기, 설계, 대안 (each alternative with why it was not chosen), 미해결 질문. Include a Mermaid diagram where the design has moving parts.',
};

export const WRITER_SYSTEM_PROMPT = `You write documents that busy people act on. The reader may read only the first section, so the first section is the conclusion: what is true or what should be done, the main reason, and the number that matters. Everything after it is support the reader can check.

Write in the language of the brief (Korean when the brief is Korean), in plain declarative sentences. State sizes, dates, costs, counts and thresholds; where a number is not known, say that it is not known instead of writing "many" or "significant". Prefer a table to a paragraph when comparing things along the same dimensions, and a Mermaid diagram (in a \`\`\`mermaid fence, starting with the diagram type) when the subject is a flow, a sequence or a data model. Use headings that name what the section contains.

Leave out what carries no information: openings about the document itself or about the times we live in, inflated words ("혁신적인", "획기적인", "패러다임", "seamless", "leverage", "robust", "cutting-edge"), closing summaries that repeat the opening, lists of virtues, and hedges stacked on hedges. If something is uncertain, say what is uncertain and why, once.

When you are given numbered facts with sources, build the document on them and cite each one where you use it with its bracketed number, like [3]. Do not state a figure that is not in the facts. If the facts do not support a conclusion the brief hoped for, say so. End a cited document with a "출처" section listing each number with its title and URL.

Your draft is checked by a linter for exactly these things, and comes back with line numbers if it fails; fix the lines it names and return the whole document again. Reply with the Markdown document only, starting at its title.

${DATA_HANDLING_CONTRACT}`;

export interface CompiledDocument {
  markdown: string;
  /** What the linter still finds in the final draft. Empty when the document is clean. */
  lint: TextFinding[];
  rounds: number;
}

/**
 * Writes a document and holds it to the text guardrails: draft → deterministic lint → the findings go back to
 * the writer with line numbers → redraft, up to three rounds. The linter, not the writer, decides whether a
 * draft is acceptable, and whatever it still finds at the end is returned with the document.
 */
export class DocumentCompiler {
  readonly #claude: ClaudeClient;

  constructor(claude: ClaudeClient) {
    this.#claude = claude;
  }

  async compile(input: { kind: DocumentKind; title: string; brief: string; facts?: readonly Fact[] }, scope: LlmScope, onStep: (step: string) => void, signal?: AbortSignal): Promise<CompiledDocument> {
    const cited = (input.facts?.length ?? 0) > 0;
    const sources = numberSources(input.facts ?? []);
    const factSheet = (input.facts ?? [])
      .map((f) => `- ${f.claim} ${[...new Set(f.sources.map((s) => `[${sources.index.get(s.url)}]`))].join('')} (근거 수준: ${f.confidence})`)
      .join('\n');
    const sourceList = sources.list.map((s) => `[${s.n}] ${s.title} ${s.url}`).join('\n');

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: 'user',
        content: [
          `Document to write: ${input.title}`,
          `Shape: ${SHAPES[input.kind]}`,
          `Brief from the owner:\n${input.brief}`,
          cited ? `Facts established by research, with their source numbers. They were gathered from the web:\n${untrusted('browser-page', `${factSheet}\n\nSources:\n${sourceList}`)}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ];

    let markdown = '';
    let lint: TextFinding[] = [];
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      onStep(round === 1 ? '초안 작성 중' : `다듬는 중 (${round}회차)`);
      const draft = await writeTurn(this.#claude, { scope, model: WRITER_MODEL, effort: 'high', system: WRITER_SYSTEM_PROMPT, messages, signal });
      markdown = stripFence(draft.text);
      lint = [...lintText(markdown, { kind: input.kind, requireCitations: cited }), ...checkCitations(markdown, sources.list.length, cited)];
      const blocking = lint.filter((f) => f.severity === 'major');
      if (blocking.length === 0 || round === MAX_ROUNDS) return { markdown, lint, rounds: round };
      messages.push(draft.turn, {
        role: 'user',
        content: `The linter found these in your draft. Fix each one and return the whole document.\n${blocking.map((f) => `- line ${f.line}: ${f.message} ${f.fix}`).join('\n')}`,
      });
    }
    return { markdown, lint, rounds: MAX_ROUNDS };
  }
}

/** A citation must point at a source that exists; a cited document must cite. */
export function checkCitations(markdown: string, sourceCount: number, cited: boolean): TextFinding[] {
  if (!cited) return [];
  const findings: TextFinding[] = [];
  let any = false;
  markdown.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\[(\d{1,3})\]/g)) {
      any = true;
      if (Number(m[1]) < 1 || Number(m[1]) > sourceCount) findings.push({ rule: 'text/bad-citation', severity: 'major', line: i + 1, message: `[${m[1]}] does not match any source (there are ${sourceCount}).`, fix: 'Cite only the numbered sources you were given.' });
    }
  });
  if (!any) findings.push({ rule: 'text/no-citations', severity: 'major', line: 1, message: 'The document was given sourced facts and cites none of them.', fix: 'Mark each fact you use with its source number.' });
  return findings;
}

function stripFence(text: string): string {
  const fenced = /^```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/.exec(text.trim());
  return (fenced ? fenced[1]! : text).trim();
}

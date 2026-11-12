import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AxBlock, DocumentKind, Fact, KnowledgeJob, Origin, ResearchReport, TextFinding } from '@studio-zero/protocol';
import { ConflictError, NotFoundError } from '../app/errors.ts';
import type { Config } from '../config.ts';
import { STUDIO_PROJECT_ID, type KnowledgeRow, type Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import type { ClaudeClient, LlmScope } from '../llm/ClaudeClient.ts';
import { errorMessage, newId, type Clock, type Logger } from '../util/core.ts';
import { DocumentCompiler } from './DocumentCompiler.ts';
import { documentHtml, type PdfRenderer } from './exportPdf.ts';
import { ResearchPipeline, numberSources } from './ResearchPipeline.ts';

type Input = { kind: 'research'; question: string; depth: 'brief' | 'deep' } | { kind: 'document'; title: string; documentKind: DocumentKind; brief: string; researchJobId: string | null };

/**
 * Knowledge work that is not code: research, and documents written from it. Jobs run in the background on the
 * host with no sandbox (nothing here executes anything), are metered against the studio's own budget scope,
 * and report through events like everything else. A job started from a scratchpad puts its result back into
 * that scratchpad as blocks.
 */
export class KnowledgeService {
  readonly #config: Config;
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #research: ResearchPipeline;
  readonly #documents: DocumentCompiler;
  readonly #renderPdf: PdfRenderer;
  readonly #onResult: (scratchId: string, blocks: AxBlock[]) => void;
  readonly #clock: Clock;
  readonly #log: Logger;
  readonly #running = new Set<Promise<void>>();

  constructor(deps: { config: Config; store: Store; events: EventLog; claude: ClaudeClient; renderPdf: PdfRenderer; onResult: (scratchId: string, blocks: AxBlock[]) => void; clock: Clock; log: Logger }) {
    this.#config = deps.config;
    this.#store = deps.store;
    this.#events = deps.events;
    this.#research = new ResearchPipeline(deps.claude);
    this.#documents = new DocumentCompiler(deps.claude);
    this.#renderPdf = deps.renderPdf;
    this.#onResult = deps.onResult;
    this.#clock = deps.clock;
    this.#log = deps.log;
  }

  startResearch(p: { question: string; depth: 'brief' | 'deep'; scratchId?: string }, origin: Origin): KnowledgeJob {
    return this.#start({ kind: 'research', title: p.question.split('\n')[0]!.slice(0, 120), origin, scratchId: p.scratchId ?? null }, { kind: 'research', question: p.question, depth: p.depth });
  }

  compileDocument(p: { title: string; kind: DocumentKind; brief: string; researchJobId?: string; scratchId?: string }, origin: Origin): KnowledgeJob {
    if (p.researchJobId !== undefined && this.#row(p.researchJobId).job.state !== 'succeeded') throw new ConflictError('that research job has not finished successfully');
    return this.#start({ kind: 'document', title: p.title, origin, scratchId: p.scratchId ?? null }, { kind: 'document', title: p.title, documentKind: p.kind, brief: p.brief, researchJobId: p.researchJobId ?? null });
  }

  get(jobId: string): { job: KnowledgeJob; markdown: string; report: ResearchReport | null; lint: TextFinding[] } {
    const { job, markdown, report, lint } = this.#row(jobId);
    return { job, markdown, report, lint };
  }

  list(): KnowledgeJob[] {
    return this.#store.listKnowledgeJobs().map((row) => row.job);
  }

  /** Renders a finished document as PDF and stores it as an artifact. */
  async exportPdf(jobId: string): Promise<string> {
    const row = this.#row(jobId);
    if (row.job.state !== 'succeeded') throw new ConflictError('the document is not finished');
    const pdf = await this.#renderPdf(documentHtml(row.job.title, row.markdown));
    const artifactId = newId('art');
    const dir = join(this.#config.artifactsDir, STUDIO_PROJECT_ID);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `${artifactId}.pdf`);
    await writeFile(file, pdf, { mode: 0o600 });
    this.#store.insertArtifact({ id: artifactId, projectId: STUDIO_PROJECT_ID, mime: 'application/pdf', file, createdAt: this.#clock() });
    return artifactId;
  }

  /** Resolves when no job is running. For shutdown and tests. */
  async idle(): Promise<void> {
    while (this.#running.size > 0) await Promise.allSettled([...this.#running]);
  }

  #row(jobId: string): KnowledgeRow {
    const row = this.#store.getKnowledgeJob(jobId);
    if (!row) throw new NotFoundError(`job ${jobId}`);
    return row;
  }

  #start(meta: Pick<KnowledgeJob, 'kind' | 'title' | 'origin' | 'scratchId'>, input: Input): KnowledgeJob {
    const job: KnowledgeJob = { id: newId('job'), ...meta, state: 'running', error: null, spentTokens: 0, createdAt: this.#clock(), finishedAt: null };
    this.#store.insertKnowledgeJob(job, input);
    const scope: LlmScope = { projectId: STUDIO_PROJECT_ID, taskId: job.id, onUsage: (u) => this.#store.addKnowledgeTokens(job.id, u.inputTokens + u.outputTokens) };
    const step = (text: string | null, state: KnowledgeJob['state'] = 'running'): void => void this.#events.emit({ projectId: null, taskId: job.id }, { type: 'knowledge.state', jobId: job.id, state, step: text });
    step('시작');
    const run = this.#run(job, input, scope, step)
      .then((result) => {
        this.#store.finishKnowledgeJob(job.id, result, this.#clock());
        step(null, 'succeeded');
        if (job.scratchId) this.#onResult(job.scratchId, resultBlocks(result));
      })
      .catch((err: unknown) => {
        this.#log.warn({ jobId: job.id, err: errorMessage(err) }, 'knowledge job failed');
        this.#store.finishKnowledgeJob(job.id, { error: errorMessage(err) }, this.#clock());
        step(errorMessage(err), 'failed');
      })
      .finally(() => this.#running.delete(run));
    this.#running.add(run);
    return job;
  }

  async #run(job: KnowledgeJob, input: Input, scope: LlmScope, step: (text: string) => void): Promise<{ markdown: string; report: ResearchReport | null; lint: TextFinding[] }> {
    // No task row exists for a knowledge job, so the budget rule is the studio scope's daily total.
    const budgetScope: LlmScope = { ...scope, taskId: null };
    if (input.kind === 'research') {
      const report = await this.#research.run(input.question, input.depth, budgetScope, step);
      if (report.facts.length === 0) throw new Error('조사에서 확인된 사실이 없습니다. 질문을 더 구체적으로 적어 주세요.');
      const doc = await this.#documents.compile({ kind: input.depth === 'brief' ? 'brief' : 'report', title: job.title, brief: input.question, facts: report.facts }, budgetScope, step);
      return { markdown: doc.markdown, report, lint: doc.lint };
    }
    const facts: Fact[] = input.researchJobId ? (this.#row(input.researchJobId).report?.facts ?? []) : [];
    const doc = await this.#documents.compile({ kind: input.documentKind, title: input.title, brief: input.brief, facts }, budgetScope, step);
    return { markdown: doc.markdown, report: null, lint: doc.lint };
  }
}

/** A finished job as worksheet blocks: the document, then where its claims come from. */
function resultBlocks(result: { markdown: string; report: ResearchReport | null }): AxBlock[] {
  const blocks: AxBlock[] = [{ type: 'text', markdown: result.markdown.slice(0, 12_000) }];
  const sources = result.report ? numberSources(result.report.facts).list.slice(0, 30) : [];
  if (result.report && sources.length > 0) {
    const quotes = new Map(result.report.facts.flatMap((f) => f.sources.map((s) => [s.url, s.quote] as const)));
    blocks.push({ type: 'sources', title: `출처 ${sources.length}곳`, items: sources.filter((s) => /^https?:\/\//.test(s.url)).map((s) => ({ title: (s.title || s.url).slice(0, 200), url: s.url.slice(0, 600), quote: (quotes.get(s.url) ?? '').slice(0, 600) })) });
  }
  return blocks;
}

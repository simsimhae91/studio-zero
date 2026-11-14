import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { DocumentAnnotation, DocumentKind, type AxBlock, type Fact, type KnowledgeJob, type Origin, type ResearchReport, type TextFinding } from '@studio-zero/protocol';
import { ConflictError, NotFoundError, StaleError } from '../app/errors.ts';
import type { Config } from '../config.ts';
import { STUDIO_PROJECT_ID, budgetTokens, type KnowledgeRow, type Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import type { ClaudeClient, LlmScope } from '../llm/ClaudeClient.ts';
import { errorMessage, newId, type Clock, type Logger } from '../util/core.ts';
import { buildRevisionRequest, hashMarkdown } from './annotations.ts';
import { DocumentCompiler } from './DocumentCompiler.ts';
import { documentHtml, type PdfRenderer } from './exportPdf.ts';
import { ResearchPipeline, numberSources } from './ResearchPipeline.ts';

type Input =
  | { kind: 'research'; question: string; depth: 'brief' | 'deep' }
  | { kind: 'document'; title: string; documentKind: DocumentKind; brief: string; researchJobId: string | null }
  | { kind: 'revision'; sourceJobId: string; contentHash: string; annotations: DocumentAnnotation[]; note: string | null };
/** What a job was asked, as it is read back from its row to run it again. */
const StoredInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('research'), question: z.string().min(1), depth: z.enum(['brief', 'deep']) }),
  z.object({ kind: z.literal('document'), title: z.string().min(1), documentKind: DocumentKind, brief: z.string(), researchJobId: z.string().nullable() }),
  z.object({ kind: z.literal('revision'), sourceJobId: z.string(), contentHash: z.string(), annotations: z.array(DocumentAnnotation), note: z.string().nullable() }),
]);
/** The reason on a job the owner stopped. */
const STOPPED = '중단했습니다.';

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
  /** How to stop each running job. */
  readonly #stops = new Map<string, AbortController>();

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
    return this.#start({ kind: 'research', title: p.question.split('\n')[0]!.slice(0, 120), origin, scratchId: p.scratchId ?? null, revisedFrom: null }, { kind: 'research', question: p.question, depth: p.depth });
  }

  compileDocument(p: { title: string; kind: DocumentKind; brief: string; researchJobId?: string; scratchId?: string }, origin: Origin): KnowledgeJob {
    if (p.researchJobId !== undefined && this.#row(p.researchJobId).job.state !== 'succeeded') throw new ConflictError('that research job has not finished successfully');
    return this.#start({ kind: 'document', title: p.title, origin, scratchId: p.scratchId ?? null, revisedFrom: null }, { kind: 'document', title: p.title, documentKind: p.kind, brief: p.brief, researchJobId: p.researchJobId ?? null });
  }

  /**
   * Starts the next version of a finished document from the owner's notes on it. The notes are bound to the text
   * they were written on (`contentHash`) and checked against it here, before any model is asked: a review of a
   * document that has changed, or that already has a revision, is refused as stale, and a note whose lines or
   * quote do not match the document refuses the request. The reviewed document is never changed; the revision is
   * a new job in the same note, pointing back at it.
   */
  revise(p: { jobId: string; contentHash: string; annotations: readonly DocumentAnnotation[]; note?: string }, origin: Origin): KnowledgeJob {
    const input: Input = { kind: 'revision', sourceJobId: p.jobId, contentHash: p.contentHash, annotations: [...p.annotations], note: p.note?.trim() || null };
    const source = this.#revisable(input);
    return this.#start({ kind: 'document', title: source.title, origin, scratchId: source.scratchId, revisedFrom: source.id }, input);
  }

  get(jobId: string): { job: KnowledgeJob; markdown: string; report: ResearchReport | null; lint: TextFinding[] } {
    const { job, markdown, report, lint } = this.#row(jobId);
    return { job, markdown, report, lint };
  }

  list(): KnowledgeJob[] {
    return this.#store.listKnowledgeJobs().map((row) => row.job);
  }

  /** Whether a job that belongs to this note is still running. */
  busyFor(scratchId: string): boolean {
    return this.#store.listKnowledgeJobs(scratchId).some((row) => row.job.state === 'running');
  }

  /** Stops a running job. It ends as failed, and its reason says it was stopped and not that it broke. */
  cancel(jobId: string): void {
    const { job } = this.#row(jobId);
    const stop = this.#stops.get(jobId);
    if (job.state !== 'running' || !stop) throw new ConflictError('진행 중인 작업이 아닙니다.');
    stop.abort();
  }

  /** Runs a failed job again from what it was asked. The failed one stays on record; this is a new job. */
  retry(jobId: string): KnowledgeJob {
    const row = this.#row(jobId);
    if (row.job.state !== 'failed') throw new ConflictError('실패한 작업만 다시 시도할 수 있습니다.');
    const input = StoredInput.safeParse(row.input);
    if (!input.success) throw new ConflictError('이 작업이 무엇을 요청받았는지 남아 있지 않아 다시 시도할 수 없습니다.');
    // A revision is tried again only while the document it revises is still the one to revise.
    if (input.data.kind === 'revision') this.#revisable(input.data);
    return this.#start({ kind: row.job.kind, title: row.job.title, origin: row.job.origin, scratchId: row.job.scratchId, revisedFrom: row.job.revisedFrom }, input.data);
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

  /** The document a revision is asked of, if the request may go ahead. Throws `StaleError` or `ConflictError`. */
  #revisable(input: Extract<Input, { kind: 'revision' }>): KnowledgeJob {
    const source = this.#row(input.sourceJobId);
    if (source.job.state !== 'succeeded' || source.markdown.trim() === '') throw new ConflictError('다 쓴 문서에만 메모를 보낼 수 있습니다.');
    if (hashMarkdown(source.markdown) !== input.contentHash) throw new StaleError('메모를 단 글이 지금 저장된 문서와 다릅니다. 문서를 다시 불러와서 보내 주세요.');
    if (this.#store.listKnowledgeRevisions(source.job.id).some((j) => j.state !== 'failed')) throw new StaleError('이 문서의 수정본이 이미 있습니다. 수정본에 메모를 다시 달아 주세요.');
    buildRevisionRequest(source.markdown, input.annotations, input.note ?? undefined);
    return source.job;
  }

  /** What a document was written as and from: its shape, and the facts its citations number. A revision keeps both. */
  #basis(row: KnowledgeRow, depth = 0): { kind: DocumentKind; facts: Fact[] } {
    const input = StoredInput.safeParse(row.input);
    if (!input.success || depth > 50) return { kind: 'report', facts: row.report?.facts ?? [] };
    const i = input.data;
    if (i.kind === 'research') return { kind: i.depth === 'brief' ? 'brief' : 'report', facts: row.report?.facts ?? [] };
    if (i.kind === 'document') return { kind: i.documentKind, facts: i.researchJobId ? (this.#store.getKnowledgeJob(i.researchJobId)?.report?.facts ?? []) : [] };
    const source = this.#store.getKnowledgeJob(i.sourceJobId);
    return source ? this.#basis(source, depth + 1) : { kind: 'report', facts: [] };
  }

  #start(meta: Pick<KnowledgeJob, 'kind' | 'title' | 'origin' | 'scratchId' | 'revisedFrom'>, input: Input): KnowledgeJob {
    const job: KnowledgeJob = { id: newId('job'), ...meta, state: 'running', error: null, spentTokens: 0, createdAt: this.#clock(), finishedAt: null };
    this.#store.insertKnowledgeJob(job, input);
    const scope: LlmScope = { projectId: STUDIO_PROJECT_ID, taskId: job.id, onUsage: (u) => this.#store.addKnowledgeTokens(job.id, budgetTokens(u)) };
    const step = (text: string | null, state: KnowledgeJob['state'] = 'running'): void => void this.#events.emit({ projectId: null, taskId: job.id }, { type: 'knowledge.state', jobId: job.id, state, step: text });
    step('시작');
    const stop = new AbortController();
    this.#stops.set(job.id, stop);
    const run = this.#run(job, input, scope, step, stop.signal)
      .then((result) => {
        this.#store.finishKnowledgeJob(job.id, result, this.#clock());
        step(null, 'succeeded');
        if (job.scratchId) this.#onResult(job.scratchId, resultBlocks(result));
      })
      .catch((err: unknown) => {
        const reason = stop.signal.aborted ? STOPPED : errorMessage(err);
        if (!stop.signal.aborted) this.#log.warn({ jobId: job.id, err: reason }, 'knowledge job failed');
        this.#store.finishKnowledgeJob(job.id, { error: reason }, this.#clock());
        step(reason, 'failed');
      })
      .finally(() => {
        this.#running.delete(run);
        this.#stops.delete(job.id);
      });
    this.#running.add(run);
    return job;
  }

  async #run(job: KnowledgeJob, input: Input, scope: LlmScope, step: (text: string) => void, signal: AbortSignal): Promise<{ markdown: string; report: ResearchReport | null; lint: TextFinding[] }> {
    // No task row exists for a knowledge job, so the budget rule is the studio scope's daily total.
    const budgetScope: LlmScope = { ...scope, taskId: null };
    if (input.kind === 'research') {
      const report = await this.#research.run(input.question, input.depth, budgetScope, step, signal);
      if (signal.aborted) throw new Error(STOPPED);
      if (report.facts.length === 0) throw new Error('조사에서 확인된 사실이 없습니다. 질문을 더 구체적으로 적어 주세요.');
      const doc = await this.#documents.compile({ kind: input.depth === 'brief' ? 'brief' : 'report', title: job.title, brief: input.question, facts: report.facts }, budgetScope, step, signal);
      return { markdown: doc.markdown, report, lint: doc.lint };
    }
    if (input.kind === 'revision') {
      const source = this.#row(input.sourceJobId);
      const basis = this.#basis(source);
      const request = buildRevisionRequest(source.markdown, input.annotations, input.note ?? undefined);
      const doc = await this.#documents.compile({ kind: basis.kind, title: job.title, brief: '', facts: basis.facts, revision: { previousMarkdown: source.markdown, request } }, budgetScope, step, signal);
      return { markdown: doc.markdown, report: null, lint: doc.lint };
    }
    const facts: Fact[] = input.researchJobId ? (this.#row(input.researchJobId).report?.facts ?? []) : [];
    const doc = await this.#documents.compile({ kind: input.documentKind, title: input.title, brief: input.brief, facts }, budgetScope, step, signal);
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

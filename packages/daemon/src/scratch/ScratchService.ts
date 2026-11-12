import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AxBlock, Confidence, SpecSection, type AxResponse, type KnowledgeJob, type Readiness, type ScratchEntry, type ScratchMode, type ScratchMove, type Scratchpad } from '@studio-zero/protocol';
import { ConflictError, NotFoundError } from '../app/errors.ts';
import type { ConfidenceCalibration } from '../ax/Calibration.ts';
import { describeBlock, describeResponse } from '../ax/blocks.ts';
import { STUDIO_PROJECT_ID, type Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import type { ClaudeClient } from '../llm/ClaudeClient.ts';
import { loopTool, runToolLoop } from '../llm/toolLoop.ts';
import { errorMessage, newId, type Clock, type Logger } from '../util/core.ts';
import { compileDecisionLog, compileSpec, readiness } from './compile.ts';
import { SCRATCH_SYSTEM_PROMPT, moveInstruction } from './prompts.ts';

const MODEL = 'claude-fable-5-2';
const SCOPE = { projectId: STUDIO_PROJECT_ID, taskId: null };

export interface ScratchView {
  scratchpad: Scratchpad;
  entries: ScratchEntry[];
  spec: string;
  decisionLog: string;
  readiness: Readiness;
  thinking: boolean;
  jobs: KnowledgeJob[];
}

/**
 * Tier 1 of the lifecycle: a scratchpad is rows in the database and nothing else. No container is created and
 * no repository exists until it is promoted, so starting one costs a database insert.
 *
 * Each owner message, answer or technique runs one agent turn. The agent can only do three things, all of them
 * validated here: show typed blocks, record a decision, update a spec section. Whether it may settle a decision
 * without asking is decided by `ConfidenceCalibration`, not by the agent.
 */
export class ScratchService {
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #claude: ClaudeClient;
  readonly #calibration: ConfidenceCalibration;
  readonly #clock: Clock;
  readonly #log: Logger;
  readonly #running = new Map<string, Promise<void>>();
  readonly #queued = new Map<string, string[]>();

  constructor(deps: { store: Store; events: EventLog; claude: ClaudeClient; calibration: ConfidenceCalibration; clock: Clock; log: Logger }) {
    this.#store = deps.store;
    this.#events = deps.events;
    this.#claude = deps.claude;
    this.#calibration = deps.calibration;
    this.#clock = deps.clock;
    this.#log = deps.log;
  }

  create(opening: string, mode: ScratchMode): Scratchpad {
    const now = this.#clock();
    const pad: Scratchpad = { id: newId('scr'), title: opening.split('\n')[0]!.trim().slice(0, 80), mode, state: 'exploring', projectId: null, createdAt: now, updatedAt: now };
    this.#store.insertScratchpad(pad);
    this.#append(pad.id, { author: 'owner', text: opening, response: null, blocks: [] });
    // Research and document scratchpads are driven by the knowledge pipeline; a thinking scratchpad starts talking.
    if (mode === 'think') this.#kick(pad.id, '');
    return pad;
  }

  list(): Scratchpad[] {
    return this.#store.listScratchpads();
  }

  view(scratchId: string): ScratchView {
    const pad = this.#pad(scratchId);
    const entries = this.#store.listScratchEntries(scratchId);
    const sections = this.#store.getSpec(scratchId);
    const decisions = this.#store.listDecisions(scratchId);
    return {
      scratchpad: pad,
      entries,
      spec: compileSpec(pad, sections),
      decisionLog: compileDecisionLog(pad, decisions),
      readiness: readiness(sections, decisions, entries),
      thinking: this.#running.has(scratchId),
      jobs: this.#store.listKnowledgeJobs(scratchId).map((row) => row.job),
    };
  }

  say(scratchId: string, text: string): void {
    this.#open(scratchId);
    this.#append(scratchId, { author: 'owner', text, response: null, blocks: [] });
    this.#kick(scratchId, '');
  }

  respond(scratchId: string, response: AxResponse): void {
    this.#open(scratchId);
    const entries = this.#store.listScratchEntries(scratchId);
    const block = entries.flatMap((e) => e.blocks).find((b) => (b.type === 'choice' || b.type === 'form') && b.id === response.blockId);
    if (!block) throw new NotFoundError(`question ${response.blockId}`);
    if (entries.some((e) => e.response?.blockId === response.blockId)) throw new ConflictError('this question has already been answered');
    if (block.type === 'choice' && response.kind === 'choice') {
      if (response.optionId !== null && !block.options.some((o) => o.id === response.optionId)) throw new ConflictError('that is not one of the options');
      if (response.optionId === null && !(block.allowOther && response.other?.trim())) throw new ConflictError('choose one of the options');
      // The owner agreeing with or overriding a recommendation is the signal confidence is calibrated on.
      if (block.recommended !== null) this.#calibration.record(block.confidence, response.optionId === block.recommended);
    } else if (block.type !== response.kind) throw new ConflictError('the answer does not match the question');
    this.#append(scratchId, { author: 'owner', text: null, response, blocks: [] });
    this.#kick(scratchId, '');
  }

  move(scratchId: string, move: ScratchMove): void {
    this.#open(scratchId);
    this.#kick(scratchId, moveInstruction(move));
  }

  /** Adds blocks produced outside a turn (a finished research job, a compiled document). */
  appendResult(scratchId: string, blocks: AxBlock[]): void {
    if (this.#store.getScratchpad(scratchId)) this.#append(scratchId, { author: 'agent', text: null, response: null, blocks });
  }

  archive(scratchId: string): Scratchpad {
    this.#pad(scratchId);
    return this.#setState(scratchId, 'archived');
  }

  markPromoted(scratchId: string, projectId: string | null): Scratchpad {
    const pad = this.#store.updateScratchpad(scratchId, { state: 'promoted', ...(projectId ? { projectId } : {}) }, this.#clock());
    this.#events.emit(SCOPE, { type: 'scratch.state', scratchId, state: 'promoted' });
    return pad;
  }

  /** Resolves when no turn is running. For shutdown and tests. */
  async idle(): Promise<void> {
    while (this.#running.size > 0) await Promise.allSettled([...this.#running.values()]);
  }

  // -------------------------------------------------------------- internals

  #pad(scratchId: string): Scratchpad {
    const pad = this.#store.getScratchpad(scratchId);
    if (!pad) throw new NotFoundError(`scratchpad ${scratchId}`);
    return pad;
  }

  #open(scratchId: string): Scratchpad {
    const pad = this.#pad(scratchId);
    if (pad.state === 'promoted' || pad.state === 'archived') throw new ConflictError(`this scratchpad is ${pad.state}`);
    return pad;
  }

  #append(scratchId: string, entry: Pick<ScratchEntry, 'author' | 'text' | 'response' | 'blocks'>): ScratchEntry {
    const stored = this.#store.appendScratchEntry({ scratchId, at: this.#clock(), ...entry });
    this.#events.emit(SCOPE, { type: 'scratch.entry', scratchId, seq: stored.seq });
    return stored;
  }

  #setState(scratchId: string, state: Scratchpad['state']): Scratchpad {
    const pad = this.#store.updateScratchpad(scratchId, { state }, this.#clock());
    this.#events.emit(SCOPE, { type: 'scratch.state', scratchId, state });
    return pad;
  }

  /** Starts a turn, or queues the instruction behind the one that is running. One turn at a time per scratchpad. */
  #kick(scratchId: string, instruction: string): void {
    if (this.#running.has(scratchId)) {
      this.#queued.set(scratchId, [...(this.#queued.get(scratchId) ?? []), instruction]);
      return;
    }
    const run = (async () => {
      let next: string[] = [instruction];
      while (next.length > 0) {
        this.#events.emit(SCOPE, { type: 'scratch.thinking', scratchId, active: true, error: null });
        let error: string | null = null;
        try {
          await this.#turn(scratchId, next.filter(Boolean).join('\n\n'));
        } catch (err) {
          error = errorMessage(err);
          this.#log.warn({ scratchId, err: error }, 'scratchpad turn failed');
        }
        next = this.#queued.get(scratchId) ?? [];
        this.#queued.delete(scratchId);
        if (next.length === 0 || error) {
          this.#running.delete(scratchId);
          this.#events.emit(SCOPE, { type: 'scratch.thinking', scratchId, active: false, error });
          if (error) return;
        }
      }
    })();
    this.#running.set(scratchId, run);
  }

  async #turn(scratchId: string, instruction: string): Promise<void> {
    const pad = this.#pad(scratchId);
    const entries = this.#store.listScratchEntries(scratchId);
    const blocksById = new Map(entries.flatMap((e) => e.blocks.flatMap((b) => ('id' in b ? [[b.id, b] as const] : []))));
    const usedIds = new Set(blocksById.keys());

    const messages: Anthropic.Beta.BetaMessageParam[] = entries.map((e) =>
      e.author === 'owner'
        ? { role: 'user' as const, content: e.response ? describeResponse(e.response, blocksById.get(e.response.blockId)) : (e.text ?? '') }
        : { role: 'assistant' as const, content: e.blocks.map(describeBlock).join('\n\n') || '(nothing shown)' },
    );
    const sections = this.#store.getSpec(scratchId);
    const decisions = this.#store.listDecisions(scratchId);
    const state = `State of this scratchpad.\nSpec sections filled: ${Object.keys(sections).join(', ') || 'none'}.\nDecisions on record: ${decisions.length === 0 ? 'none' : decisions.map((d) => `${d.question} → ${d.chosen}`).join('; ')}.\nStill needed before it can be promoted: ${readiness(sections, decisions, entries).missing.join(', ') || 'nothing'}.`;
    messages.push({ role: 'user', content: instruction ? `${state}\n\n${instruction}` : state });

    const present = loopTool({
      name: 'present',
      description: 'Show typed blocks to the owner in the worksheet. This is the only way anything reaches the owner. Give choice and form blocks an id that has not been used in this scratchpad.',
      schema: z.object({ blocks: z.array(AxBlock).min(1).max(6) }),
      run: async ({ blocks }) => {
        for (const block of blocks) {
          if ((block.type === 'choice' || block.type === 'form' || block.type === 'decision') && usedIds.has(block.id)) return { content: `id "${block.id}" is already used in this scratchpad; choose another`, isError: true };
          if (block.type === 'choice' && block.recommended !== null && !block.options.some((o) => o.id === block.recommended)) return { content: `recommended "${block.recommended}" is not one of the option ids`, isError: true };
          if (block.type === 'comparison' && block.options.some((o) => o.cells.length !== block.criteria.length)) return { content: 'each comparison option needs exactly one cell per criterion', isError: true };
          if (block.type === 'sources' && block.items.some((s) => !/^https?:\/\//.test(s.url))) return { content: 'source URLs must be http(s)', isError: true };
          if (block.type === 'decision') return { content: 'decisions are recorded with record_decision, which also shows them', isError: true };
        }
        for (const block of blocks) if ('id' in block) usedIds.add(block.id);
        this.#append(scratchId, { author: 'agent', text: null, response: null, blocks });
        return { content: 'shown' };
      },
    });

    const recordDecision = loopTool({
      name: 'record_decision',
      description: 'Put a settled question on the record: what was chosen, why, and each alternative considered with the reason it lost. If the owner settled it by answering a choice block, pass that block id as answersBlockId.',
      schema: z.object({
        question: z.string().min(1).max(200),
        chosen: z.string().min(1).max(200),
        why: z.string().min(1).max(2000),
        rejected: z.array(z.object({ option: z.string().min(1).max(200), why: z.string().min(1).max(600) })).max(8),
        confidence: Confidence,
        answersBlockId: z.string().nullable(),
      }),
      run: async (input) => {
        const current = this.#store.listScratchEntries(scratchId);
        const answered = input.answersBlockId !== null && current.some((e) => e.response?.blockId === input.answersBlockId);
        if (input.answersBlockId !== null && !answered) return { content: `the owner has not answered "${input.answersBlockId}" yet; wait for the answer`, isError: true };
        // The calibration gate: below (effective) high confidence, the owner decides. Enforced here, not in the prompt.
        if (!answered && this.#calibration.effective(input.confidence) !== 'high') {
          return { content: 'Not recorded. At this confidence the decision is the owner\'s: present it as a choice block with your recommendation, and record it after they answer.', isError: true };
        }
        const id = newId('dec');
        this.#store.insertDecision({ id, scratchId, question: input.question, chosen: input.chosen, why: input.why, rejected: input.rejected, confidence: input.confidence, decidedBy: answered ? 'owner' : 'agent', createdAt: this.#clock() });
        this.#append(scratchId, { author: 'agent', text: null, response: null, blocks: [{ type: 'decision', id: id.replace('_', '-'), question: input.question, chosen: input.chosen, why: input.why, rejected: input.rejected, confidence: input.confidence }] });
        return { content: 'recorded' };
      },
    });

    const updateSpec = loopTool({
      name: 'update_spec',
      description: 'Replace one section of the spec with its current text (Markdown). Write for a builder who has not seen this conversation.',
      schema: z.object({ section: SpecSection, content: z.string().min(1).max(8000) }),
      run: async ({ section, content }) => {
        this.#store.setSpecSection(scratchId, section, content, this.#clock());
        return { content: 'saved' };
      },
    });

    const result = await runToolLoop(this.#claude, { scope: SCOPE, model: MODEL, effort: 'high', system: SCRATCH_SYSTEM_PROMPT, messages, tools: [present, recordDecision, updateSpec], maxTurns: 10 });
    // Anything the model said outside `present` is still the owner's to read.
    if (result.finalText && !this.#store.listScratchEntries(scratchId).some((e) => e.seq > (entries.at(-1)?.seq ?? 0) && e.author === 'agent')) {
      this.#append(scratchId, { author: 'agent', text: null, response: null, blocks: [{ type: 'text', markdown: result.finalText.slice(0, 12_000) }] });
    }

    const after = this.view(scratchId);
    if (after.readiness.ready && pad.state === 'exploring') this.#setState(scratchId, 'ready');
    else if (!after.readiness.ready && this.#pad(scratchId).state === 'ready') this.#setState(scratchId, 'exploring');
  }
}

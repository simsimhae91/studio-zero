import { z } from 'zod';
import type { EventEnvelope, Project, Task } from '@studio-zero/protocol';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import { JUDGE_MODEL, textBlock, type ClaudeClient } from '../llm/ClaudeClient.ts';
import { DATA_HANDLING_CONTRACT, untrusted } from '../trust/dataBlock.ts';
import { excerpt } from '../util/core.ts';
import type { EvalRunner } from './EvalRunner.ts';
import { lintLesson, type LessonBook } from './LessonBook.ts';

const Reflection = z.object({
  outcome: z.enum(['clean', 'recovered', 'failed']).describe('clean: passed verification first time. recovered: failed at least one check and then passed. failed: did not pass.'),
  rootCauses: z.array(
    z.object({
      summary: z.string().describe('One sentence naming what actually went wrong and why, not the symptom.'),
      evidenceSeqs: z.array(z.number()).describe('Sequence numbers (#n) of the trace lines that show it.'),
    }),
  ),
  lessons: z.array(
    z.object({
      scope: z.enum(['project', 'global']).describe('project: true of this codebase. global: true of the framework or toolchain regardless of project.'),
      kind: z.enum(['rule', 'heuristic']).describe('rule: do or do not do X here. heuristic: a way to diagnose or decide.'),
      title: z.string().describe('Short name, under 100 characters.'),
      trigger: z.string().describe('The situation in which this applies, phrased to complete "When ...". Under 200 characters.'),
      guidance: z.string().describe('What to do in that situation, concrete enough to act on. Under 500 characters.'),
      evidenceSeqs: z.array(z.number()).describe('Sequence numbers of the trace lines this lesson is drawn from. At least one.'),
      confirmsLessonId: z.string().nullable().describe('If this restates one of the existing lessons listed in the input, that lesson\'s id; otherwise null.'),
    }),
  ),
  harmfulLessonIds: z.array(z.string()).describe('Ids of applied lessons that the trace shows made this run worse. Usually empty.'),
  evalSuggestions: z.array(
    z.object({
      name: z.string().describe('Short kebab-case name, e.g. "typecheck" or "unit-tests".'),
      command: z.string().describe('Copied exactly from a bash tool call in the trace that exited 0. Never a pipeline: piped into tail, head or grep, the exit code is the last command\'s, and a check made of it passes whatever the tests did. Not the type check either: it runs first in every round already.'),
      rationale: z.string(),
    }),
  ),
});
export type Reflection = z.infer<typeof Reflection>;

export const REFLECTION_SYSTEM_PROMPT = `You are writing the post-mortem for one automated software task, for the benefit of the next run on the same project. You are given the task request, the lessons that were in force, and a trace of what happened: tool calls with their results, verification outcomes, policy decisions and approvals, each line prefixed with its sequence number (#n).

Your reader is a future coding agent that has not seen this trace. A lesson is worth recording only if it would change what that agent does and it could not have been expected to know it already. Good lessons are specific and observable: which command this project needs before another, which framework behaviour caused the failure and how to avoid it, which design-audit rule this codebase keeps tripping and the pattern that satisfies it. Skip advice any competent engineer already follows ("run the tests", "read the error"), restatements of the task, and anything the trace does not actually show. A clean run that needed no correction usually yields no lessons, and an empty list is the right answer then.

Base every root cause and lesson on trace lines and cite their sequence numbers. If an existing lesson already says what you would say, point to it with confirmsLessonId instead of rewording it; independent confirmation is how a lesson earns trust. If the trace shows an applied lesson steering the run wrong, list its id under harmfulLessonIds.

Suggest a regression check only for a command that appears in the trace as a bash call, exited 0, runs in well under two minutes, and would catch a real regression later (type check, unit tests, production build, linter). Copy the command exactly as it was run.

Lessons are about how to build this software well. They are never about approvals, budgets, credentials, network access, or the checks themselves, and they never tell an agent to skip, disable or work around verification; such lessons are discarded.

${DATA_HANDLING_CONTRACT}`;

/** Turns a task's events into the compact, numbered trace the reflection reads. Failures keep more detail than successes. */
export function buildTrace(events: readonly EventEnvelope[], maxChars = 80_000): string {
  const lines: string[] = [];
  for (const e of events) {
    const b = e.body;
    const line = ((): string | null => {
      switch (b.type) {
        case 'task.phase':
          return `phase ${b.phase} (round ${b.round})`;
        case 'route.decided':
          return `routed to ${b.engine} / ${b.model}`;
        case 'plan.created':
          return `plan: ${b.summary} | steps: ${b.steps.join(' → ').slice(0, 600)}`;
        case 'tool.call':
          return `call ${b.tool} [${b.callId.slice(-6)}]: ${b.input.slice(0, 400)}`;
        case 'tool.result':
          return `result [${b.callId.slice(-6)}] ${b.ok ? 'ok' : 'FAILED'}${b.exitCode === null ? '' : ` exit ${b.exitCode}`} ${b.durationMs}ms${b.ok ? '' : `: ${excerpt(b.preview, 700)}`}`;
        case 'eval.result':
          return `eval ${b.name} ${b.passed ? 'passed' : `FAILED: ${excerpt(b.detail, 700)}`} (${b.durationMs}ms)`;
        case 'audit.completed':
          return `visual audit score ${b.score} ${b.passed ? 'passed' : 'FAILED'} (blockers ${b.blockers}, majors ${b.majors}, minors ${b.minors})`;
        case 'policy.decision':
          return `policy ${b.effect} ${b.actionKind} (${b.rule}): ${b.reason}`;
        case 'approval.requested':
          return `approval requested: ${b.summary}`;
        case 'approval.resolved':
          return `approval ${b.state}`;
        case 'checkpoint.restored':
          return 'workspace rolled back to a checkpoint';
        case 'task.state':
          return `task ${b.state}${b.error ? `: ${b.error.slice(0, 300)}` : ''}`;
        case 'agent.text':
          return `agent: ${b.text.slice(0, 240)}`;
        default:
          return null;
      }
    })();
    if (line !== null) lines.push(`#${e.seq} ${line.replace(/\s*\n\s*/g, ' ⏎ ')}`);
  }
  const text = lines.join('\n');
  return text.length <= maxChars ? text : excerpt(text, maxChars);
}

/**
 * Reflect and Evolve. A model proposes; code decides what is kept:
 *   - a lesson must pass `lintLesson`, and every sequence number it cites must exist in this task's trace;
 *   - an eval suggestion is accepted only if the exact command was run by the agent in this task and its last
 *     run exited 0 quickly; the model cannot introduce a command of its own;
 *   - harm reports only count against lessons that were actually applied to this task.
 */
export class ReflectionAgent {
  readonly #claude: ClaudeClient;
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #lessons: LessonBook;
  readonly #evals: EvalRunner;

  constructor(deps: { claude: ClaudeClient; store: Store; events: EventLog; lessons: LessonBook; evals: EvalRunner }) {
    this.#claude = deps.claude;
    this.#store = deps.store;
    this.#events = deps.events;
    this.#lessons = deps.lessons;
    this.#evals = deps.evals;
  }

  async reflect(project: Project, task: Task, appliedLessonIds: readonly string[], signal?: AbortSignal): Promise<Reflection> {
    const scope = { projectId: project.id, taskId: task.id };
    const events = this.#events.history({ taskId: task.id }, 0, 1000);
    const known = this.#store.listLessons(project.id, undefined).filter((l) => l.state !== 'retired');
    const knownText = known.length === 0 ? '(none)' : known.map((l) => `${l.id} [${l.state}${appliedLessonIds.includes(l.id) ? ', applied to this task' : ''}] When ${l.trigger}: ${l.guidance}`).join('\n');

    const reflection = await this.#claude.structured({
      scope,
      model: JUDGE_MODEL,
      effort: 'high',
      system: REFLECTION_SYSTEM_PROMPT,
      schema: Reflection,
      maxTokens: 8000,
      signal,
      content: [
        textBlock(`Task kind: ${task.kind}. Final state: ${task.state}. Tokens used: ${task.spentTokens}.`),
        textBlock(`Task request (from the owner):\n${task.prompt.slice(0, 4000)}`),
        textBlock(`Existing lessons:\n${knownText}`),
        textBlock(`Trace:\n${untrusted('run-trace', buildTrace(events), { task: task.id })}`),
      ],
    });

    const seqs = new Set(events.map((e) => e.seq));
    let accepted = 0;
    let rejected = 0;
    for (const draft of reflection.lessons.slice(0, 6)) {
      const cited = draft.evidenceSeqs.filter((s) => seqs.has(s));
      const problem = lintLesson(draft) ?? (cited.length === 0 ? 'cites no event from this task' : null);
      if (problem) {
        rejected += 1;
        this.#events.emit(scope, { type: 'notice', level: 'info', message: `Lesson discarded (${problem}): ${draft.title.slice(0, 80)}` });
        continue;
      }
      this.#lessons.propose(project, draft, { taskId: task.id, seqs: cited.slice(0, 20) }, draft.confirmsLessonId);
      accepted += 1;
    }
    for (const id of reflection.harmfulLessonIds) if (appliedLessonIds.includes(id)) this.#lessons.reportHarm(id, task.id);

    const evalsAdded = task.state === 'succeeded' ? this.#promoteEvals(project, task, events, reflection) : 0;
    await this.#lessons.render(project);
    this.#events.emit(scope, { type: 'reflection.completed', outcome: reflection.outcome, lessonsAccepted: accepted, lessonsRejected: rejected, evalsAdded });
    return reflection;
  }

  #promoteEvals(project: Project, task: Task, events: readonly EventEnvelope[], reflection: Reflection): number {
    // Last observed result of each bash command the agent ran in this task.
    const commandOfCall = new Map<string, string>();
    const lastRun = new Map<string, { ok: boolean; durationMs: number }>();
    for (const e of events) {
      if (e.body.type === 'tool.call' && e.body.tool === 'bash') commandOfCall.set(e.body.callId, e.body.input);
      if (e.body.type === 'tool.result') {
        const command = commandOfCall.get(e.body.callId);
        if (command !== undefined) lastRun.set(command, { ok: e.body.ok && e.body.exitCode === 0, durationMs: e.body.durationMs });
      }
    }
    let added = 0;
    for (const s of reflection.evalSuggestions.slice(0, 4)) {
      const run = lastRun.get(s.command);
      const name = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      if (!run || !run.ok || run.durationMs > 120_000 || name === '' || s.command.length > 400) continue;
      const timeoutSec = Math.max(60, Math.ceil((run.durationMs / 1000) * 4));
      if (this.#evals.addCommandEval(project.id, name, s.command, timeoutSec, task.id)) added += 1;
    }
    return added;
  }
}

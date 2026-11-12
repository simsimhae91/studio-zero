import type Anthropic from '@anthropic-ai/sdk';
import { Effort, type EngineModel } from '@studio-zero/protocol';
import { steeringNote, type SteeringQueue } from '../../ax/Steering.ts';
import type { Config } from '../../config.ts';
import type { EventLog } from '../../events/EventLog.ts';
import { ModelRefusedError, fallbackParams, type ClaudeClient } from '../../llm/ClaudeClient.ts';
import { PolicyDeniedError } from '../../policy/PolicyEngine.ts';
import type { Toolbox } from '../Toolbox.ts';
import { EngineError, type Engine, type EngineResult, type EngineRun, type EngineSession } from './Engine.ts';

/** The models this loop can be pointed at: the current one of each tier, which are the ones `ClaudeClient` can price. */
const MODELS: EngineModel[] = [
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
];

/**
 * Coding loop on the Claude Messages API, run inside the daemon. The model's only tools are the Toolbox, so
 * the API key stays in this process and every action it takes is a policy-checked sandbox call.
 *
 * A hand-written loop rather than the SDK tool runner because three things must happen between turns:
 * the budget rule is re-evaluated before every request, usage is metered into the ledger after every response,
 * and cancellation is honoured at turn boundaries.
 *
 * History is append-only and assistant turns are echoed back verbatim, which keeps thinking blocks valid and
 * the prompt cache warm from one turn to the next.
 */
export class NativeClaudeEngine implements Engine {
  readonly id = 'native-claude' as const;
  // `output_config.effort`: all five on every model listed above.
  readonly efforts = Effort.options;
  readonly #claude: ClaudeClient;
  readonly #toolbox: Toolbox;
  readonly #events: EventLog;
  readonly #config: Config;
  readonly #steering: SteeringQueue;

  constructor(deps: { claude: ClaudeClient; toolbox: Toolbox; events: EventLog; config: Config; steering: SteeringQueue }) {
    this.#steering = deps.steering;
    this.#claude = deps.claude;
    this.#toolbox = deps.toolbox;
    this.#events = deps.events;
    this.#config = deps.config;
  }

  async availability(): Promise<{ available: boolean; reason: string }> {
    return this.#claude.hasApiKey() ? { available: true, reason: 'Anthropic API key present in vault' } : { available: false, reason: 'no Anthropic API key in vault' };
  }

  async models(): Promise<EngineModel[]> {
    return MODELS;
  }

  async open(run: EngineRun): Promise<EngineSession> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [];
    const tools: Anthropic.Beta.BetaTool[] = this.#toolbox.definitions().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      // Large file bodies stream as they are generated. The API then no longer validates inputs, so the
      // Toolbox's own schema check is what stands between a truncated input and the sandbox.
      eager_input_streaming: true,
    }));
    return {
      send: (userContent) => this.#turns(run, tools, messages, userContent),
      close: async () => undefined,
    };
  }

  async #turns(run: EngineRun, tools: Anthropic.Beta.BetaTool[], messages: Anthropic.Beta.BetaMessageParam[], userContent: string): Promise<EngineResult> {
    const scope = { projectId: run.project.id, taskId: run.task.id };
    const sdk = await this.#claude.sdk();
    const { APIError } = await import('@anthropic-ai/sdk');
    messages.push({ role: 'user', content: userContent });
    let unparseable = 0;

    for (let turn = 0; turn < this.#config.budgets.maxTurns; turn++) {
      if (run.signal.aborted) return { finalText: lastText(messages), stopped: 'cancelled' };
      try {
        await this.#claude.gate(scope, run.route.model);
      } catch (err) {
        if (err instanceof PolicyDeniedError) return { finalText: lastText(messages), stopped: 'budget', deniedRule: err.rule };
        throw err;
      }

      const stream = sdk.beta.messages.stream(
        {
          model: run.route.model,
          max_tokens: 64_000,
          system: [{ type: 'text', text: run.system, cache_control: { type: 'ephemeral' } }],
          tools,
          messages,
          cache_control: { type: 'ephemeral' },
          output_config: { effort: run.route.effort },
          ...fallbackParams(run.route.model),
        },
        { signal: run.signal },
      );

      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await stream.finalMessage();
        unparseable = 0;
      } catch (err) {
        if (run.signal.aborted) return { finalText: lastText(messages), stopped: 'cancelled' };
        // With eager input streaming the SDK rejects when a tool input is not parseable JSON. Re-issue the turn
        // a bounded number of times; typed API errors are real failures and propagate.
        if (err instanceof APIError || unparseable++ >= 2) throw err;
        continue;
      }
      this.#claude.record(scope, message.model, message.usage);

      const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
      if (text) this.#events.emit(scope, { type: 'agent.text', text: text.slice(0, 8000) });

      // A refusal can cut a tool call off mid-input: never execute that turn's tools.
      if (message.stop_reason === 'refusal') throw new ModelRefusedError(message.stop_details?.category ?? null);
      if (message.stop_reason === 'max_tokens') throw new EngineError('model output was cut off at max_tokens');

      messages.push({ role: 'assistant', content: message.content as Anthropic.Beta.BetaContentBlockParam[] });
      if (message.stop_reason === 'pause_turn') continue;

      const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (calls.length === 0) {
        // The engine thinks it is done. If the owner sent something in the meantime, it is not: carry on with that.
        const late = this.#steering.drain(run.task.id);
        if (late.length === 0) return { finalText: text, stopped: 'completed' };
        this.#events.emit(scope, { type: 'steer.delivered', count: late.length });
        messages.push({ role: 'user', content: steeringNote(late) });
        continue;
      }

      // Sequential on purpose: the calls of one turn act on one working tree. All results go back in a single
      // user message, which is what keeps the model issuing parallel calls.
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        const outcome = await this.#toolbox.call({ project: run.project, taskId: run.task.id, signal: run.signal, onWaiting: run.onWaiting }, call.name, call.input);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: outcome.content, is_error: outcome.isError });
      }
      const ctx = { project: run.project, taskId: run.task.id };
      if (calls.some((c) => this.#toolbox.mutates(c.name))) await this.#toolbox.checkpointTurn(ctx, `${turn + 1}턴: ${describeCall(calls.find((c) => this.#toolbox.mutates(c.name))!)}`);

      // Non-blocking steering: whatever the owner sent while these tools ran is read together with their results.
      const steer = this.#steering.drain(run.task.id);
      if (steer.length > 0) this.#events.emit(scope, { type: 'steer.delivered', count: steer.length });
      messages.push({ role: 'user', content: steer.length > 0 ? [...results, { type: 'text', text: steeringNote(steer) }] : results });
    }
    return { finalText: lastText(messages), stopped: 'max_turns' };
  }
}

function describeCall(call: Anthropic.Beta.BetaToolUseBlock): string {
  const input = call.input as { command?: unknown; path?: unknown };
  return typeof input.command === 'string' ? input.command : typeof input.path === 'string' ? `${call.name} ${input.path}` : call.name;
}

function lastText(messages: Anthropic.Beta.BetaMessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'assistant' || typeof m.content === 'string') continue;
    const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
    if (text) return text;
  }
  return '';
}

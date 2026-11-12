import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Effort } from '../config.ts';
import type { BridgeTools } from '../bridge/BridgeSessions.ts';
import { ModelRefusedError, fallbackParams, transcript, type ClaudeClient, type LlmScope } from './ClaudeClient.ts';

/** A tool implemented inside the daemon. Its input is validated against `schema` before `run` sees it. */
export interface LoopTool<Schema extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  schema: Schema;
  run: (input: z.infer<Schema>) => Promise<{ content: string; isError?: boolean; stop?: boolean }>;
}

export function loopTool<Schema extends z.ZodObject>(tool: LoopTool<Schema>): LoopTool {
  return tool as unknown as LoopTool;
}

export interface LoopResult {
  finalText: string;
  /** Every content block the model produced, in order, including server-tool results (web search, web fetch). */
  blocks: Anthropic.Beta.BetaContentBlock[];
  stopped: 'completed' | 'tool_stop' | 'max_turns';
}

/**
 * A model working with in-process tools until it is done: the loop used for scratchpad turns and research.
 * (The coding engines have their own loop, which also talks to a sandbox.)
 *
 * Budget is checked before every request and usage recorded after every response. Client tools run one at a
 * time; server tools run at the provider and their results simply arrive in the response.
 */
export async function runToolLoop(
  claude: ClaudeClient,
  opts: {
    scope: LlmScope;
    model: string;
    effort: Effort;
    system: string;
    messages: Anthropic.Beta.BetaMessageParam[];
    tools: LoopTool[];
    serverTools?: Anthropic.Beta.BetaToolUnion[];
    maxTurns: number;
    signal?: AbortSignal;
  },
): Promise<LoopResult> {
  if (claude.mode() === 'session') return runSessionLoop(claude, opts);
  const sdk = await claude.sdk();
  const messages = [...opts.messages];
  const blocks: Anthropic.Beta.BetaContentBlock[] = [];
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    ...opts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: z.toJSONSchema(t.schema) as Anthropic.Beta.BetaTool.InputSchema })),
    ...(opts.serverTools ?? []),
  ];
  let finalText = '';

  for (let turn = 0; turn < opts.maxTurns; turn++) {
    await claude.gate(opts.scope, opts.model);
    const message = await sdk.beta.messages
      .stream(
        {
          model: opts.model,
          max_tokens: 32_000,
          system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
          tools,
          messages,
          cache_control: { type: 'ephemeral' },
          output_config: { effort: opts.effort },
          ...fallbackParams(opts.model),
        },
        { signal: opts.signal },
      )
      .finalMessage();
    claude.record(opts.scope, message.model, message.usage);
    blocks.push(...message.content);
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
    if (text) finalText = text;

    if (message.stop_reason === 'refusal') throw new ModelRefusedError(message.stop_details?.category ?? null);
    if (message.stop_reason === 'max_tokens') throw new Error('model output was cut off at max_tokens');
    messages.push({ role: 'assistant', content: message.content as Anthropic.Beta.BetaContentBlockParam[] });
    if (message.stop_reason === 'pause_turn') continue; // a long server-tool turn: send it back to be continued

    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (calls.length === 0) return { finalText, blocks, stopped: 'completed' };

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    let stop = false;
    for (const call of calls) {
      const tool = opts.tools.find((t) => t.name === call.name);
      const parsed = tool?.schema.safeParse(call.input);
      if (!tool || !parsed?.success) {
        results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: tool ? `invalid input: ${z.prettifyError(parsed!.error!)}` : `unknown tool: ${call.name}` });
        continue;
      }
      const out = await tool.run(parsed.data);
      stop ||= out.stop === true;
      results.push({ type: 'tool_result', tool_use_id: call.id, is_error: out.isError === true, content: out.content });
    }
    if (stop) return { finalText, blocks, stopped: 'tool_stop' };
    messages.push({ role: 'user', content: results });
  }
  return { finalText, blocks, stopped: 'max_turns' };
}

/**
 * The same loop on the owner's subscription. The CLI drives the turns itself; the daemon's tools reach it
 * through the MCP shim, each call validated here exactly as in the API loop. Of the provider's server tools
 * only web search has an equivalent (page fetch does not), and what the searches returned comes back in the
 * same block shape the API uses, so callers that check sources against retrieved pages work unchanged.
 */
async function runSessionLoop(claude: ClaudeClient, opts: Parameters<typeof runToolLoop>[1]): Promise<LoopResult> {
  await claude.gate(opts.scope, opts.model);
  let stopped = false;
  const tools: BridgeTools = {
    definitions: () => opts.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.schema) as Record<string, unknown> })),
    call: async (name, args) => {
      const tool = opts.tools.find((t) => t.name === name);
      const parsed = tool?.schema.safeParse(args);
      if (!tool || !parsed?.success) return { content: tool ? `invalid input: ${z.prettifyError(parsed!.error!)}` : `unknown tool: ${name}`, isError: true };
      const out = await tool.run(parsed.data);
      stopped ||= out.stop === true;
      return { content: out.content, isError: out.isError === true };
    },
  };
  const webSearch = (opts.serverTools ?? []).some((t) => 'type' in t && typeof t.type === 'string' && t.type.startsWith('web_search'));
  const answer = await claude.session().ask({ system: opts.system, content: [{ type: 'text', text: transcript(opts.messages) }], model: opts.model, effort: opts.effort, tools: opts.tools.length > 0 ? tools : undefined, webSearch, signal: opts.signal });
  claude.recordSession(opts.scope, opts.model, answer.usage);
  const blocks = answer.searches.map((hits, i) => ({ type: 'web_search_tool_result', tool_use_id: `session_${i}`, content: hits.map((hit) => ({ type: 'web_search_result', url: hit.url, title: hit.title, encrypted_content: '', page_age: null })) })) as unknown as Anthropic.Beta.BetaContentBlock[];
  return { finalText: answer.text.trim(), blocks, stopped: stopped ? 'tool_stop' : 'completed' };
}

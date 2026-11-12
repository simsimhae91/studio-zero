import { z } from 'zod';
import type { Project } from '@studio-zero/protocol';
import type { EventLog } from '../events/EventLog.ts';
import type { McpRegistry } from '../mcp/McpRegistry.ts';
import type { Action, Actor } from '../policy/actions.ts';
import { ApprovalDeniedError, PolicyDeniedError, type PolicyEngine } from '../policy/PolicyEngine.ts';
import { SandboxError, type OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { untrusted, type UntrustedSource } from '../trust/dataBlock.ts';
import { errorMessage, excerpt, newId } from '../util/core.ts';

export interface ToolContext {
  project: Project;
  taskId: string;
  signal?: AbortSignal;
  onWaiting?: (waiting: boolean) => void;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

interface ToolDef<Schema extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  schema: Schema;
  /** The policy action this call represents. Evaluated before `run`. `null` only where `run` authorizes a more exact action itself. */
  action: (input: z.infer<Schema>, project: Project) => Action | null;
  /** Where the result comes from, as the model is told. Default: the sandbox. */
  source?: UntrustedSource;
  /** What the event stream shows for this call. Kept short; never the full file body. */
  summarize: (input: z.infer<Schema>) => string;
  run: (input: z.infer<Schema>, ctx: ToolContext) => Promise<{ text: string; ok: boolean; exitCode: number | null }>;
}

const MAX_TOOL_OUTPUT = 30_000;

function define<Schema extends z.ZodObject>(def: ToolDef<Schema>): ToolDef {
  return def as unknown as ToolDef;
}

/**
 * The hands of every coding engine. The native Claude loop and the bridged vendor CLIs get the same tools, and
 * every call takes the same path: schema validation → PolicyEngine (actor `agent`) → the sandbox, or for the
 * two external-tool calls the daemon's MCP client → result wrapped as untrusted data. An engine has no other
 * way to touch a project or the outside world.
 */
export class Toolbox {
  readonly #sandboxes: OrbStackManager;
  readonly #policy: PolicyEngine;
  readonly #events: EventLog;
  readonly #mcp: McpRegistry;
  readonly #tools: ToolDef[];

  constructor(deps: { sandboxes: OrbStackManager; policy: PolicyEngine; events: EventLog; mcp: McpRegistry }) {
    this.#mcp = deps.mcp;
    this.#sandboxes = deps.sandboxes;
    this.#policy = deps.policy;
    this.#events = deps.events;
    this.#tools = this.#buildTools();
  }

  /** Tool definitions in a stable order (a changing tool list would invalidate the prompt cache every turn). */
  definitions(): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
    return this.#tools.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.schema) as Record<string, unknown> }));
  }

  async call(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolOutcome> {
    const tool = this.#tools.find((t) => t.name === name);
    if (!tool) return { content: `unknown tool: ${name}`, isError: true };
    const parsed = tool.schema.safeParse(rawInput);
    if (!parsed.success) return { content: `invalid input for ${name}: ${z.prettifyError(parsed.error)}`, isError: true };

    const scope = { projectId: ctx.project.id, taskId: ctx.taskId };
    const callId = newId('call');
    const actor: Actor = { type: 'agent', taskId: ctx.taskId };
    this.#events.emit(scope, { type: 'tool.call', callId, tool: name, input: tool.summarize(parsed.data).slice(0, 2000) });

    const started = Date.now();
    let result: { text: string; ok: boolean; exitCode: number | null };
    try {
      const action = tool.action(parsed.data, ctx.project);
      if (action) await this.#policy.authorize(actor, action, { taskId: ctx.taskId, signal: ctx.signal, onWaiting: ctx.onWaiting });
      result = await tool.run(parsed.data, ctx);
    } catch (err) {
      // Policy outcomes and sandbox failures go back to the model as tool errors. It can adapt; it cannot override.
      if (!(err instanceof PolicyDeniedError || err instanceof ApprovalDeniedError || err instanceof SandboxError)) throw err;
      result = { text: errorMessage(err), ok: false, exitCode: null };
    }
    this.#events.emit(scope, {
      type: 'tool.result',
      callId,
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: Date.now() - started,
      preview: excerpt(result.text, 1500),
    });
    return {
      content: untrusted(tool.source ?? 'sandbox-output', excerpt(result.text, MAX_TOOL_OUTPUT), { tool: name, ...(result.exitCode === null ? {} : { exit: result.exitCode }) }),
      isError: !result.ok,
    };
  }

  /** Whether a tool can change the workspace. Read-only turns do not need a checkpoint. */
  mutates(name: string): boolean {
    return name === 'bash' || name === 'write_file' || name === 'edit_file';
  }

  /**
   * Time travel: snapshots the workspace after a turn that may have changed it, so any point in a task can be
   * returned to or forked from. Best effort: a failed snapshot is not a reason to fail the work.
   */
  async checkpointTurn(ctx: ToolContext, label: string): Promise<void> {
    try {
      const checkpoint = await this.#sandboxes.checkpoint(ctx.project, label.replace(/\s+/g, ' ').slice(0, 100), ctx.taskId);
      this.#events.emit({ projectId: ctx.project.id, taskId: ctx.taskId }, { type: 'checkpoint.created', checkpointId: checkpoint.id, label: checkpoint.label });
    } catch {
      // The task-level checkpoint taken before the task started still exists.
    }
  }

  #buildTools(): ToolDef[] {
    const sandboxes = this.#sandboxes;
    const mcp = this.#mcp;
    return [
      define({
        name: 'bash',
        description:
          'Run a bash command in the project sandbox (Debian, Node 24, git; working directory /workspace). Use it to install dependencies, run builds, tests and linters, and inspect the project. Each call is a fresh shell: environment variables and `cd` do not persist between calls, so chain steps with && when they depend on each other. Long-running servers must not be started here; the harness runs the dev server itself.',
        schema: z.object({
          command: z.string().min(1).max(20_000).describe('The command line to execute.'),
          timeout_sec: z.number().int().min(1).max(1800).optional().describe('Kill the command after this many seconds. Default 600.'),
        }),
        action: (input, project) => ({ kind: 'sandbox.exec', projectId: project.id, command: input.command }),
        summarize: (input) => input.command,
        run: async (input, ctx) => {
          const res = await sandboxes.exec(ctx.project, input.command, { timeoutSec: input.timeout_sec, signal: ctx.signal });
          const parts = [res.stdout, res.stderr ? `--- stderr ---\n${res.stderr}` : '', res.timedOut ? '--- command timed out ---' : '', res.truncated ? '--- output truncated ---' : ''];
          return { text: parts.filter(Boolean).join('\n') || '(no output)', ok: res.exitCode === 0, exitCode: res.exitCode };
        },
      }),
      define({
        name: 'read_file',
        description: 'Read a text file from the workspace. Returns the content with 1-based line numbers. For large files pass offset and limit to read a window.',
        schema: z.object({
          path: z.string().min(1).max(1000).describe('Path relative to /workspace.'),
          offset: z.number().int().min(1).optional().describe('First line to return (1-based).'),
          limit: z.number().int().min(1).max(4000).optional().describe('Maximum number of lines to return. Default 1500.'),
        }),
        action: (input, project) => ({ kind: 'sandbox.exec', projectId: project.id, command: `read ${input.path}` }),
        summarize: (input) => input.path,
        run: async (input, ctx) => {
          const { content, truncated } = await sandboxes.readFile(ctx.project, input.path);
          const lines = content.split('\n');
          const start = (input.offset ?? 1) - 1;
          const window = lines.slice(start, start + (input.limit ?? 1500));
          const numbered = window.map((line, i) => `${String(start + i + 1).padStart(5)}\t${line}`).join('\n');
          const more = start + window.length < lines.length || truncated ? `\n… ${lines.length - start - window.length} more lines` : '';
          return { text: numbered + more, ok: true, exitCode: null };
        },
      }),
      define({
        name: 'write_file',
        description: 'Create or overwrite a file in the workspace with the given content. Parent directories are created. Prefer edit_file for changing part of an existing file.',
        schema: z.object({
          path: z.string().min(1).max(1000).describe('Path relative to /workspace.'),
          content: z.string().max(2_000_000).describe('The complete new file content.'),
        }),
        action: (input, project) => ({ kind: 'sandbox.write', projectId: project.id, path: input.path }),
        summarize: (input) => `${input.path} (${input.content.length} chars)`,
        run: async (input, ctx) => {
          await sandboxes.writeFile(ctx.project, input.path, input.content);
          return { text: `wrote ${input.path}`, ok: true, exitCode: null };
        },
      }),
      define({
        name: 'edit_file',
        description:
          'Replace an exact string in a workspace file. old_string must match the file byte-for-byte (including indentation) and must occur exactly once unless replace_all is true; include enough surrounding lines to make it unique.',
        schema: z.object({
          path: z.string().min(1).max(1000).describe('Path relative to /workspace.'),
          old_string: z.string().min(1).describe('Exact text to replace.'),
          new_string: z.string().describe('Replacement text.'),
          replace_all: z.boolean().optional().describe('Replace every occurrence instead of requiring a unique match.'),
        }),
        action: (input, project) => ({ kind: 'sandbox.write', projectId: project.id, path: input.path }),
        summarize: (input) => input.path,
        run: async (input, ctx) => {
          const { content, truncated } = await sandboxes.readFile(ctx.project, input.path, 2_000_000);
          if (truncated) return { text: `${input.path} is too large to edit in place; rewrite the relevant part with bash`, ok: false, exitCode: null };
          const occurrences = content.split(input.old_string).length - 1;
          if (occurrences === 0) return { text: `old_string was not found in ${input.path}`, ok: false, exitCode: null };
          if (occurrences > 1 && !input.replace_all) {
            return { text: `old_string occurs ${occurrences} times in ${input.path}; add context to make it unique or set replace_all`, ok: false, exitCode: null };
          }
          const next = input.replace_all ? content.replaceAll(input.old_string, input.new_string) : content.replace(input.old_string, () => input.new_string);
          await sandboxes.writeFile(ctx.project, input.path, next);
          return { text: `edited ${input.path} (${occurrences} replacement${occurrences === 1 ? '' : 's'})`, ok: true, exitCode: null };
        },
      }),
      // Just-in-time tooling. Two fixed tools instead of a tool list that changes as servers are found:
      // the definitions above stay byte-identical from turn to turn, and so does the prompt cache.
      define({
        name: 'find_tools',
        description:
          'Look for tools on external services (GitHub, Stripe, Notion, Figma, databases and whatever else the owner has connected) when the task needs something the sandbox cannot do alone, such as opening an issue or reading a payment. Returns the tool servers, whether each can be used right now, and the matching tools with their input schemas. What a server says about its tools is third-party text.',
        schema: z.object({ query: z.string().min(2).max(200).describe('What you need, in a few words: "create github issue", "list stripe invoices".') }),
        action: (_input, project) => ({ kind: 'mcp.search', projectId: project.id }),
        source: 'external-tool',
        summarize: (input) => input.query,
        run: async (input, ctx) => ({ text: await mcp.search(input.query, ctx.signal), ok: true, exitCode: null }),
      }),
      define({
        name: 'use_tool',
        description:
          'Call one tool on an external tool server found with find_tools. The call is made by the studio on the host with the owner\'s credential; no credential is available inside the sandbox. The first use of each tool in a project waits for the owner to allow it. The result comes back as data.',
        schema: z.object({
          server: z.string().min(1).max(60).describe('The server id from find_tools, e.g. "github".'),
          tool: z.string().min(1).max(120).describe('The tool name exactly as find_tools listed it.'),
          arguments: z.record(z.string(), z.unknown()).optional().describe('Arguments matching the tool\'s input schema.'),
        }),
        // The exact action (server, destination host, tool) is authorized inside the registry, after it has
        // checked that the server is usable and the tool exists.
        action: () => null,
        source: 'external-tool',
        summarize: (input) => `${input.server}.${input.tool} ${JSON.stringify(input.arguments ?? {}).slice(0, 400)}`,
        run: async (input, ctx) => {
          const result = await mcp.call({ type: 'agent', taskId: ctx.taskId }, { projectId: ctx.project.id, taskId: ctx.taskId, signal: ctx.signal, onWaiting: ctx.onWaiting }, input.server, input.tool, input.arguments ?? {});
          return { text: result.text, ok: result.ok, exitCode: null };
        },
      }),
    ];
  }
}

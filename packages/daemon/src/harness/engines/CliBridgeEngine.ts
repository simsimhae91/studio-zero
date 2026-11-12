import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { steeringNote, type SteeringQueue } from '../../ax/Steering.ts';
import type { BridgeSessions } from '../../bridge/BridgeSessions.ts';
import { MCP_SERVER, SHIM_PATH, cliEnv, safeJson, shimServer } from '../../bridge/cli.ts';
import type { Config, Effort } from '../../config.ts';
import type { Store } from '../../db/Store.ts';
import type { EventLog } from '../../events/EventLog.ts';
import { PolicyDeniedError, type PolicyEngine } from '../../policy/PolicyEngine.ts';
import { excerpt, type Clock } from '../../util/core.ts';
import type { Toolbox } from '../Toolbox.ts';
import { runCommand, type CommandRunner } from '../../util/run.ts';
import { EngineError, type Engine, type EngineResult, type EngineRun, type EngineSession } from './Engine.ts';

interface Invocation {
  scratch: string;
  shim: string;
  bridgeUrl: string;
  tokenFile: string;
  system: string;
  lastMessageFile: string;
  model: string;
  effort: Effort;
}

interface Parsed {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * How one vendor CLI is run headless with its own tools switched off. The session credential (a Claude or
 * ChatGPT subscription login) stays wherever the vendor's CLI keeps it on the host; this daemon never reads it.
 */
interface VendorAdapter {
  id: 'claude-code' | 'codex';
  /** How the native tools are disabled, for the router's availability report. */
  lockdown: string;
  prepare: (inv: Invocation) => Promise<string[]>;
  parse: (stdout: string, inv: Invocation) => Promise<Parsed>;
}

const ClaudeResult = z.object({
  result: z.string().optional(),
  is_error: z.boolean().optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
    })
    .optional(),
});

/** Flags verified against `claude --help` of Claude Code 2.1.322. */
const claudeCode: VendorAdapter = {
  id: 'claude-code',
  lockdown: '--tools "" (no built-in tools) + --strict-mcp-config',
  prepare: async (inv) => {
    const mcpConfig = join(inv.scratch, 'mcp.json');
    await writeFile(
      mcpConfig,
      JSON.stringify({
        mcpServers: { [MCP_SERVER]: shimServer(inv.bridgeUrl, inv.tokenFile) },
      }),
      { mode: 0o600 },
    );
    return [
      '--print',
      '--output-format', 'json',
      '--tools', '', // disable every built-in tool: no Bash, no file access on the host
      '--strict-mcp-config', '--mcp-config', mcpConfig, // the daemon's shim is the only MCP server
      '--allowedTools', `mcp__${MCP_SERVER}`,
      '--permission-mode', 'dontAsk',
      '--setting-sources', 'project', // the scratch dir has none, so user hooks/plugins/CLAUDE.md are not loaded
      '--disable-slash-commands',
      '--no-session-persistence',
      '--system-prompt', inv.system,
      '--effort', inv.effort,
      ...(inv.model === 'default' ? [] : ['--model', inv.model]),
    ];
  },
  parse: async (stdout) => {
    const parsed = ClaudeResult.safeParse(safeJson(stdout));
    if (!parsed.success) throw new EngineError(`claude returned unparseable output: ${excerpt(stdout, 300)}`);
    if (parsed.data.is_error) throw new EngineError(`claude reported an error: ${excerpt(parsed.data.result ?? '', 300)}`);
    const u = parsed.data.usage ?? {};
    return {
      text: parsed.data.result ?? '',
      inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
    };
  },
};

/** Feature names taken from `codex features list` of codex-cli 0.153.4. */
const CODEX_NATIVE_TOOL_FEATURES = ['shell_tool', 'unified_exec', 'view_image', 'apps', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation', 'in_app_browser', 'in_app_local_automation', 'hooks'];

const codex: VendorAdapter = {
  id: 'codex',
  lockdown: `--sandbox read-only + --disable ${CODEX_NATIVE_TOOL_FEATURES.slice(0, 3).join('/')}/… (feature flags, weaker than an empty tool list)`,
  prepare: async (inv) => [
    'exec',
    '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '--cd', inv.scratch,
    ...CODEX_NATIVE_TOOL_FEATURES.flatMap((feature) => ['--disable', feature]),
    // `-c` values are TOML; JSON strings and string arrays are valid TOML as written.
    '-c', `mcp_servers.${MCP_SERVER}.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.${MCP_SERVER}.args=${JSON.stringify([inv.shim])}`,
    '-c', `mcp_servers.${MCP_SERVER}.env={SZ_BRIDGE_URL=${JSON.stringify(inv.bridgeUrl)},SZ_BRIDGE_TOKEN_FILE=${JSON.stringify(inv.tokenFile)}}`,
    '-c', `model_reasoning_effort=${JSON.stringify(inv.effort === 'max' ? 'xhigh' : inv.effort)}`,
    ...(inv.model === 'default' ? [] : ['--model', inv.model]),
    '--output-last-message', inv.lastMessageFile,
    '-', // prompt on stdin
  ],
  parse: async (stdout, inv) => {
    let inputTokens = 0;
    let outputTokens = 0;
    for (const line of stdout.split('\n')) {
      const event = z.object({ type: z.string(), usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional() }).safeParse(safeJson(line));
      if (event.success && event.data.type === 'turn.completed') {
        inputTokens += event.data.usage?.input_tokens ?? 0;
        outputTokens += event.data.usage?.output_tokens ?? 0;
      }
    }
    return { text: await readFile(inv.lastMessageFile, 'utf8').catch(() => ''), inputTokens, outputTokens };
  },
};

const adapters = { 'claude-code': claudeCode, codex } as const;

/**
 * "Session bridge": lets a subscription-authenticated vendor CLI act as the reasoning engine for a task while
 * the daemon keeps custody of everything it can do.
 *
 * The CLI runs on the host as the *brain only*. Its native tools are disabled, its working directory is an
 * empty scratch folder, and the one MCP server it is given forwards to the daemon's Toolbox. So:
 * - the subscription credential never enters a sandbox (it never leaves the vendor's own store),
 * - every file edit and command still passes the PolicyEngine as actor `agent`,
 * - tool results reach the vendor model as untrusted data blocks, exactly as in the native loop.
 *
 * A CLI whose native tools cannot be switched off (cursor-agent, agy at the versions inspected) is not bridged:
 * with host file access it could read its own credential and pass it into a sandbox through a tool argument.
 */
export class CliBridgeEngine implements Engine {
  readonly id: 'claude-code' | 'codex';
  readonly #adapter: VendorAdapter;
  readonly #bin: string;
  readonly #enabled: boolean;
  readonly #config: Config;
  readonly #sessions: BridgeSessions;
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #policy: PolicyEngine;
  readonly #clock: Clock;
  readonly #run: CommandRunner;
  readonly #steering: SteeringQueue;
  readonly #toolbox: Toolbox;
  #probe: { at: number; available: boolean; reason: string } | null = null;

  constructor(deps: { id: 'claude-code' | 'codex'; config: Config; sessions: BridgeSessions; store: Store; events: EventLog; policy: PolicyEngine; clock: Clock; steering: SteeringQueue; toolbox: Toolbox; run?: CommandRunner }) {
    this.id = deps.id;
    this.#toolbox = deps.toolbox;
    this.#steering = deps.steering;
    this.#adapter = adapters[deps.id];
    const settings = deps.id === 'claude-code' ? deps.config.engines.claudeCode : deps.config.engines.codex;
    this.#bin = settings.bin;
    this.#enabled = settings.enabled;
    this.#config = deps.config;
    this.#sessions = deps.sessions;
    this.#store = deps.store;
    this.#events = deps.events;
    this.#policy = deps.policy;
    this.#clock = deps.clock;
    this.#run = deps.run ?? runCommand;
  }

  async availability(): Promise<{ available: boolean; reason: string }> {
    if (!this.#enabled) return { available: false, reason: `disabled in config (engines.${this.id === 'claude-code' ? 'claudeCode' : 'codex'}.enabled)` };
    if (this.#probe && this.#clock() - this.#probe.at < 60_000) return this.#probe;
    let result: { available: boolean; reason: string };
    try {
      const res = await this.#run(this.#bin, ['--version'], { timeoutMs: 10_000, env: cliEnv() });
      result = res.exitCode === 0 ? { available: true, reason: `${res.stdout.trim().split('\n')[0]}; lockdown: ${this.#adapter.lockdown}` } : { available: false, reason: `${this.#bin} --version exited ${res.exitCode}` };
    } catch {
      result = { available: false, reason: `${this.#bin} is not installed` };
    }
    this.#probe = { at: this.#clock(), ...result };
    return result;
  }

  async open(run: EngineRun): Promise<EngineSession> {
    const scratch = await mkdtemp(join(tmpdir(), 'sz-bridge-'));
    await chmod(scratch, 0o700);
    const ctx = { project: run.project, taskId: run.task.id, signal: run.signal, onWaiting: run.onWaiting };
    const toolbox = this.#toolbox;
    const token = this.#sessions.create({ definitions: () => toolbox.definitions(), call: (name, args) => toolbox.call(ctx, name, args) }, 6 * 60 * 60 * 1000);
    const system = `${run.system}\n\nYou have no local tools in this session. Act on the project only through the "${MCP_SERVER}" MCP tools (bash, read_file, write_file, edit_file work inside the project sandbox at /workspace; find_tools and use_tool reach external services).`;
    const inv: Invocation = {
      scratch,
      shim: SHIM_PATH,
      bridgeUrl: `http://127.0.0.1:${this.#config.listen.port}/v1/bridge`,
      tokenFile: join(scratch, 'token'),
      system,
      lastMessageFile: join(scratch, 'last-message.txt'),
      model: run.route.model,
      effort: run.route.effort,
    };
    await writeFile(inv.tokenFile, token, { mode: 0o600 });

    const scope = { projectId: run.project.id, taskId: run.task.id };
    let previous = '';
    return {
      send: async (userContent): Promise<EngineResult> => {
        if (run.signal.aborted) return { finalText: previous, stopped: 'cancelled' };
        try {
          await this.#policy.authorize({ type: 'agent', taskId: run.task.id }, { kind: 'llm.request', projectId: run.project.id, taskId: run.task.id, model: `${this.id}:${inv.model}` }, { taskId: run.task.id });
        } catch (err) {
          if (err instanceof PolicyDeniedError) return { finalText: previous, stopped: 'budget', deniedRule: err.rule };
          throw err;
        }
        // Each call is a fresh CLI process; continuity comes from restating where the last round ended.
        // Codex has no system-prompt flag, so its instructions lead the prompt instead.
        // A vendor CLI runs a whole round per process, so steering reaches it at round boundaries.
        const steer = this.#steering.drain(run.task.id);
        if (steer.length > 0) this.#events.emit(scope, { type: 'steer.delivered', count: steer.length });
        const prompt = [this.id === 'codex' ? system : '', previous ? `Your previous round ended with:\n${previous}` : '', userContent, steer.length > 0 ? steeringNote(steer) : ''].filter(Boolean).join('\n\n');
        const args = await this.#adapter.prepare(inv);
        let res;
        try {
          res = await this.#run(this.#bin, args, { stdin: prompt, cwd: scratch, env: cliEnv(), timeoutMs: 60 * 60 * 1000, maxOutputBytes: 32 * 1024 * 1024, signal: run.signal });
        } catch (err) {
          if (run.signal.aborted) return { finalText: previous, stopped: 'cancelled' };
          throw err;
        }
        if (res.exitCode !== 0) throw new EngineError(`${this.id} exited ${res.exitCode}: ${excerpt(res.stderr || res.stdout, 600)}`);
        const parsed = await this.#adapter.parse(res.stdout, inv);
        const model = `${this.id}:${inv.model}`;
        const usage = { inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens, usdMicros: 0 }; // subscription-billed
        this.#store.addUsage({ ...scope, source: 'bridge', model, ...usage }, this.#clock());
        this.#events.emit(scope, { type: 'usage', source: 'bridge', model, ...usage });
        if (parsed.text) this.#events.emit(scope, { type: 'agent.text', text: parsed.text.slice(0, 8000) });
        previous = excerpt(parsed.text, 4000);
        return { finalText: parsed.text, stopped: 'completed' };
      },
      close: async () => {
        this.#sessions.revoke(token);
        await rm(scratch, { recursive: true, force: true });
      },
    };
  }
}


import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { steeringNote, type SteeringQueue } from '../../ax/Steering.ts';
import type { BridgeSessions } from '../../bridge/BridgeSessions.ts';
import { acpPrompt, type AcpRequest, type AcpResult } from '../../bridge/acp.ts';
import { MCP_SERVER, SHIM_PATH, cliEnv, safeJson, shimServer } from '../../bridge/cli.ts';
import { jailAvailable, jailProfile, jailed, which, type JailRules } from '../../bridge/jail.ts';
import type { BridgeEngineId, Config, Effort } from '../../config.ts';
import type { Store } from '../../db/Store.ts';
import type { EventLog } from '../../events/EventLog.ts';
import { PolicyDeniedError, type PolicyEngine } from '../../policy/PolicyEngine.ts';
import { excerpt, type Clock } from '../../util/core.ts';
import type { Toolbox } from '../Toolbox.ts';
import { runCommand, type CommandRunner } from '../../util/run.ts';
import { EngineError, type Engine, type EngineResult, type EngineRun, type EngineSession } from './Engine.ts';

interface Invocation {
  /** The CLI as configured: a name to find on PATH, or a path. */
  bin: string;
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

/** One round of a CLI: what to start, with what, and (for CLIs that keep their own tools) what to confine it to. */
interface Launch {
  file: string;
  args: string[];
  stdin?: string;
  env?: Record<string, string>;
  jail?: JailRules;
  /** Commands to run first, in the same confinement (for a CLI that must be told to accept its MCP server). */
  before?: string[][];
  /** Set when the CLI is driven over the Agent Client Protocol instead of a one-shot print mode. */
  acp?: { mcpServers: AcpRequest['mcpServers'] };
}

/**
 * How one vendor CLI is run headless so that the daemon's tools are the only hands it has. The session
 * credential (a Claude, ChatGPT, Cursor or Google login) stays wherever the vendor's CLI keeps it on the host;
 * this daemon never reads it.
 */
interface VendorAdapter {
  id: BridgeEngineId;
  /** How the CLI's own tools are taken out of play, for the router's availability report. */
  lockdown: string;
  /** True when that is done by an OS sandbox around the process, which exists on macOS only. */
  jailed: boolean;
  /** True when the CLI has no flag for a system prompt, so the instructions lead the prompt instead. */
  systemInPrompt: boolean;
  launch: (inv: Invocation, prompt: string) => Promise<Launch>;
  parse: (stdout: string, inv: Invocation) => Promise<Parsed>;
  /** Removes what a run left in the CLI's own state folder. */
  cleanup?: (inv: Invocation) => Promise<void>;
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
  jailed: false,
  systemInPrompt: false,
  launch: async (inv, prompt) => {
    const mcpConfig = join(inv.scratch, 'mcp.json');
    await writeFile(
      mcpConfig,
      JSON.stringify({
        mcpServers: { [MCP_SERVER]: shimServer(inv.bridgeUrl, inv.tokenFile) },
      }),
      { mode: 0o600 },
    );
    const args = [
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
    return { file: inv.bin, args, stdin: prompt };
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
  jailed: false,
  systemInPrompt: true,
  launch: async (inv, prompt) => ({ file: inv.bin, stdin: prompt, args: [
    'exec',
    '--json', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '--cd', inv.scratch,
    ...CODEX_NATIVE_TOOL_FEATURES.flatMap((feature) => ['--disable', feature]),
    // `-c` values are TOML; JSON strings and string arrays are valid TOML as written.
    '-c', `mcp_servers.${MCP_SERVER}.command=${JSON.stringify(process.execPath)}`,
    '-c', `mcp_servers.${MCP_SERVER}.args=${JSON.stringify([inv.shim])}`,
    '-c', `mcp_servers.${MCP_SERVER}.env={SZ_BRIDGE_URL=${JSON.stringify(inv.bridgeUrl)},SZ_BRIDGE_TOKEN_FILE=${JSON.stringify(inv.tokenFile)}}`,
    // Non-interactive runs cannot answer an approval prompt. The studio's tools are approved up front, and only
    // they: each call is still decided by the daemon's own policy when it arrives at the bridge.
    '-c', `mcp_servers.${MCP_SERVER}.default_tools_approval_mode="approve"`,
    '-c', `model_reasoning_effort=${JSON.stringify(inv.effort === 'max' ? 'xhigh' : inv.effort)}`,
    ...(inv.model === 'default' ? [] : ['--model', inv.model]),
    '--output-last-message', inv.lastMessageFile,
    '-', // prompt on stdin
  ] }),
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

const CursorResult = z.object({ is_error: z.boolean().optional(), result: z.string().optional(), usage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional(), cacheReadTokens: z.number().optional(), cacheWriteTokens: z.number().optional() }).optional() });

/**
 * Cursor's CLI has no way to run without its shell and file tools ("--print has access to all tools"), so it runs
 * inside the host jail (see `jailProfile`). Its launcher is a shell script; inside a jail no shell may start, so
 * the Node it bundles is started directly on the same entry point. Checked against cursor-agent 2026.11.11.
 */
const cursor: VendorAdapter = {
  id: 'cursor',
  lockdown: 'host jail: home hidden, no shell can start; the studio MCP server is the only way to act',
  jailed: true,
  systemInPrompt: true,
  launch: async (inv, prompt) => {
    const launcher = which(inv.bin, cliEnv());
    if (!launcher) throw new EngineError(`${inv.bin} is not installed`);
    const install = dirname(launcher);
    // Project-level MCP configuration, read from the workspace the CLI is pointed at: the scratch folder.
    await mkdir(join(inv.scratch, '.cursor'), { recursive: true });
    await writeFile(join(inv.scratch, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { [MCP_SERVER]: shimServer(inv.bridgeUrl, inv.tokenFile) } }), { mode: 0o600 });
    const entry = join(install, 'index.js');
    return {
      file: join(install, 'node'),
      // A project-level MCP server is ignored until it is approved for that workspace: `mcp enable` does that.
      before: [[entry, 'mcp', 'enable', MCP_SERVER]],
      args: [entry, '--print', '--output-format', 'json', '--workspace', inv.scratch, '--trust', '--approve-mcps', '--force', '--model', inv.model === 'default' ? 'auto' : inv.model, prompt],
      env: { CURSOR_INVOKED_AS: 'cursor-agent' },
      jail: { own: [join(homedir(), '.cursor')], exec: [dirname(install)], hide: [join(homedir(), '.cursor', 'mcp.json')] },
    };
  },
  // The CLI keeps a trust marker and a log per workspace; the workspace was a scratch folder that no longer exists.
  cleanup: async (inv) => {
    const projects = join(homedir(), '.cursor', 'projects');
    const mine = inv.scratch.replace(/^\//, '').replaceAll('/', '-');
    await rm(join(projects, mine), { recursive: true, force: true });
  },
  parse: async (stdout) => {
    const parsed = CursorResult.safeParse(safeJson(stdout.trim().split('\n').at(-1) ?? ''));
    if (!parsed.success) throw new EngineError(`cursor-agent returned unparseable output: ${excerpt(stdout, 300)}`);
    if (parsed.data.is_error) throw new EngineError(`cursor-agent reported an error: ${excerpt(parsed.data.result ?? '', 300)}`);
    const u = parsed.data.usage ?? {};
    return { text: parsed.data.result ?? '', inputTokens: (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0), outputTokens: u.outputTokens ?? 0 };
  },
};

/**
 * Antigravity's CLI (`agy`) also keeps its own tools, so it is jailed the same way. Its print mode can only use
 * the MCP servers saved in the owner's configuration, so it is driven over the Agent Client Protocol instead,
 * where a session brings its own. Checked against agy 1.5.6.
 */
const antigravity: VendorAdapter = {
  id: 'antigravity',
  lockdown: 'host jail: home hidden, no shell can start; the studio MCP server is the only way to act',
  jailed: true,
  systemInPrompt: true,
  launch: async (inv) => {
    const bin = which(inv.bin, cliEnv());
    if (!bin) throw new EngineError(`${inv.bin} is not installed`);
    const state = join(homedir(), '.gemini');
    return {
      file: bin,
      args: ['acp'],
      acp: { mcpServers: [{ name: MCP_SERVER, ...shimServer(inv.bridgeUrl, inv.tokenFile) }] },
      jail: { own: [state], exec: [bin], hide: [join(state, 'config', 'mcp_config.json'), join(state, 'config', 'mcp_config.json.bak')] },
    };
  },
  parse: async () => {
    throw new EngineError('agy is driven over ACP and has no print-mode output to parse');
  },
};

const adapters: Record<BridgeEngineId, VendorAdapter> = { 'claude-code': claudeCode, codex, cursor, antigravity };
const settingsKey: Record<BridgeEngineId, 'claudeCode' | 'codex' | 'cursor' | 'antigravity'> = { 'claude-code': 'claudeCode', codex: 'codex', cursor: 'cursor', antigravity: 'antigravity' };

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
 * A CLI whose native tools cannot be switched off (cursor-agent, agy) runs inside a host jail instead: an OS
 * sandbox in which the owner's files are invisible and no shell can start, so those tools have nothing to act on.
 */
export class CliBridgeEngine implements Engine {
  readonly id: BridgeEngineId;
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
  readonly #acp: (req: AcpRequest) => Promise<AcpResult>;
  #probe: { at: number; available: boolean; reason: string } | null = null;

  constructor(deps: { id: BridgeEngineId; config: Config; sessions: BridgeSessions; store: Store; events: EventLog; policy: PolicyEngine; clock: Clock; steering: SteeringQueue; toolbox: Toolbox; run?: CommandRunner; acp?: (req: AcpRequest) => Promise<AcpResult> }) {
    this.id = deps.id;
    this.#acp = deps.acp ?? acpPrompt;
    this.#toolbox = deps.toolbox;
    this.#steering = deps.steering;
    this.#adapter = adapters[deps.id];
    const settings = deps.config.engines[settingsKey[deps.id]];
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
    if (!this.#enabled) return { available: false, reason: `disabled in config (engines.${settingsKey[this.id]}.enabled)` };
    if (this.#adapter.jailed && !jailAvailable()) return { available: false, reason: 'its own tools cannot be switched off, and the sandbox that would confine them exists on macOS only' };
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
    // The real path, because that is what a sandbox profile matches against (/var is a link to /private/var).
    const scratch = await realpath(await mkdtemp(join(tmpdir(), 'sz-bridge-')));
    await chmod(scratch, 0o700);
    const ctx = { project: run.project, taskId: run.task.id, signal: run.signal, onWaiting: run.onWaiting };
    const toolbox = this.#toolbox;
    const token = this.#sessions.create({ definitions: () => toolbox.definitions(), call: (name, args) => toolbox.call(ctx, name, args) }, 6 * 60 * 60 * 1000);
    const system = `${run.system}\n\n${this.#adapter.jailed ? 'Your own shell and file tools do not work in this session: they are confined to an empty folder and cannot run commands.' : 'You have no local tools in this session.'} Act on the project only through the "${MCP_SERVER}" MCP tools (bash, read_file, write_file, edit_file work inside the project sandbox at /workspace; find_tools and use_tool reach external services).`;
    const inv: Invocation = {
      bin: this.#bin,
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
        const prompt = [this.#adapter.systemInPrompt ? system : '', previous ? `Your previous round ended with:\n${previous}` : '', userContent, steer.length > 0 ? steeringNote(steer) : ''].filter(Boolean).join('\n\n');
        let parsed: Parsed;
        try {
          parsed = await this.#round(inv, prompt, 60 * 60 * 1000, run.signal);
        } catch (err) {
          if (run.signal.aborted) return { finalText: previous, stopped: 'cancelled' };
          throw err;
        }
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
        await this.#adapter.cleanup?.(inv).catch(() => undefined);
        await rm(scratch, { recursive: true, force: true });
      },
    };
  }

  /**
   * One question, one answer: the CLI as an advisor rather than as an engine. It runs under the same lockdown
   * as a task round, and the tool server it is pointed at offers nothing, so it can read and change nothing,
   * neither on this machine nor in any sandbox. No state is kept between questions.
   */
  async ask(req: { system: string; question: string; signal?: AbortSignal; timeoutMs?: number }): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const scratch = await realpath(await mkdtemp(join(tmpdir(), 'sz-advisor-')));
    await chmod(scratch, 0o700);
    const token = this.#sessions.create({ definitions: () => [], call: async () => ({ content: 'There are no tools in this session.', isError: true }) }, 30 * 60 * 1000);
    const system = `${req.system}\n\nYou have no tools in this session: answer from what you know and from the question itself.`;
    const inv: Invocation = {
      bin: this.#bin,
      scratch,
      shim: SHIM_PATH,
      bridgeUrl: `http://127.0.0.1:${this.#config.listen.port}/v1/bridge`,
      tokenFile: join(scratch, 'token'),
      system,
      lastMessageFile: join(scratch, 'last-message.txt'),
      model: 'default',
      effort: 'medium',
    };
    try {
      await writeFile(inv.tokenFile, token, { mode: 0o600 });
      return await this.#round(inv, [this.#adapter.systemInPrompt ? system : '', req.question].filter(Boolean).join('\n\n'), req.timeoutMs ?? 10 * 60 * 1000, req.signal);
    } finally {
      this.#sessions.revoke(token);
      await this.#adapter.cleanup?.(inv).catch(() => undefined);
      await rm(scratch, { recursive: true, force: true });
    }
  }

  /** Starts the CLI once with `prompt` and reads its answer. The confinement is the adapter's, whoever is asking. */
  async #round(inv: Invocation, prompt: string, timeoutMs: number, signal: AbortSignal | undefined): Promise<Parsed> {
    const launch = await this.#adapter.launch(inv, prompt);
    // A jailed CLI gets the scratch folder as its temp directory too: it is one of the few places it may write.
    const profile = launch.jail ? jailProfile(inv.scratch, launch.jail) : null;
    const confined = (file: string, args: readonly string[]): { file: string; args: readonly string[] } => (profile ? jailed(profile, file, args) : { file, args });
    const env = { ...cliEnv(), ...launch.env, ...(launch.jail ? { TMPDIR: inv.scratch } : {}) };
    for (const step of launch.before ?? []) {
      const pre = confined(launch.file, step);
      const done = await this.#run(pre.file, pre.args, { cwd: inv.scratch, env, timeoutMs: 60_000, signal });
      if (done.exitCode !== 0) throw new EngineError(`${this.id} could not be set up: ${excerpt(done.stderr || done.stdout, 400)}`);
    }
    const command = confined(launch.file, launch.args);
    if (launch.acp) {
      const answer = await this.#acp({ file: command.file, args: command.args, env, cwd: inv.scratch, mcpServers: launch.acp.mcpServers, prompt, signal, timeoutMs });
      // The protocol reports no token counts. Budgets still need a number, so one is estimated from the
      // text that crossed the wire (about four characters a token); what the agent read through tools is not in it.
      return { text: answer.text, inputTokens: Math.ceil(prompt.length / 4), outputTokens: Math.ceil(answer.text.length / 4) };
    }
    const res = await this.#run(command.file, command.args, { stdin: launch.stdin, cwd: inv.scratch, env, timeoutMs, maxOutputBytes: 32 * 1024 * 1024, signal });
    if (res.exitCode !== 0) throw new EngineError(`${this.id} exited ${res.exitCode}: ${excerpt(res.stderr || res.stdout, 600)}`);
    return this.#adapter.parse(res.stdout, inv);
  }
}


import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { BridgeSessions, BridgeTools } from '../bridge/BridgeSessions.ts';
import type { SubscriptionWatch } from '../harness/engines/CliBridgeEngine.ts';
import { MCP_SERVER, cliEnv, safeJson, writeShimConfig } from '../bridge/cli.ts';
import type { Config, Effort } from '../config.ts';
import { excerpt, type Clock } from '../util/core.ts';
import { runCommand, type CommandRunner } from '../util/run.ts';

export type BrainPart = { type: 'text'; text: string } | { type: 'image'; mediaType: string; base64: string };

export interface BrainRequest {
  system: string;
  content: BrainPart[];
  model: string;
  effort: Effort;
  /** When set, the answer must be a JSON value matching this schema. */
  jsonSchema?: Record<string, unknown>;
  /** Tools implemented in the daemon, offered to the model through the MCP shim. */
  tools?: BridgeTools;
  /** Lets the model search the web. The search runs at the provider; nothing is fetched by this machine. */
  webSearch?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface BrainResult {
  text: string;
  structured: unknown;
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number };
  /** One entry per web search the model ran, with the pages it returned. */
  searches: { url: string; title: string }[][];
}

export class SessionBrainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionBrainError';
  }
}

const Result = z.object({
  type: z.literal('result'),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional(), cache_read_input_tokens: z.number().optional(), cache_creation_input_tokens: z.number().optional() }).optional(),
});
const SearchOutcome = z.object({ tool_use_result: z.object({ query: z.string(), results: z.array(z.unknown()) }) });
const SearchHits = z.object({ content: z.array(z.object({ url: z.string(), title: z.string().optional() })) });

/**
 * The daemon's own thinking (planning, judging, scratchpad turns, writing) done through the owner's Claude
 * subscription instead of an API key. It runs the Claude Code CLI headless, as a brain and nothing more:
 *
 * - every built-in tool is switched off (`--tools ""`), so the process cannot read or change this machine;
 *   for research it gets web search alone, which runs at the provider;
 * - it starts in an empty scratch folder with no user settings, hooks or plugins loaded;
 * - the only other things it can call are tools the daemon offers through its MCP shim for this one request.
 *
 * The subscription credential stays where the CLI keeps it. The daemon never reads it.
 * Flags and output shapes were checked against Claude Code 2.1.322 with real runs.
 */
export class SessionBrain {
  readonly #bin: string;
  readonly #enabled: boolean;
  readonly #bridgeUrl: string;
  readonly #sessions: BridgeSessions;
  readonly #clock: Clock;
  readonly #run: CommandRunner;
  readonly #quota: SubscriptionWatch | null;
  #probe: { at: number; available: boolean; reason: string } | null = null;

  constructor(deps: { config: Config; sessions: BridgeSessions; clock: Clock; run?: CommandRunner; quota?: SubscriptionWatch }) {
    this.#quota = deps.quota ?? null;
    this.#bin = deps.config.engines.claudeCode.bin;
    this.#enabled = deps.config.engines.claudeCode.enabled;
    this.#bridgeUrl = `http://127.0.0.1:${deps.config.listen.port}/v1/bridge`;
    this.#sessions = deps.sessions;
    this.#clock = deps.clock;
    this.#run = deps.run ?? runCommand;
  }

  /** Whether the CLI is installed and switched on. A login that has lapsed only shows on the first real call. */
  async availability(): Promise<{ available: boolean; reason: string }> {
    if (!this.#enabled) return { available: false, reason: 'Claude Code is disabled in config (engines.claudeCode.enabled)' };
    let result: { available: boolean; reason: string };
    try {
      const res = await this.#run(this.#bin, ['--version'], { timeoutMs: 10_000, env: cliEnv() });
      result = res.exitCode === 0 ? { available: true, reason: res.stdout.trim().split('\n')[0] ?? '' } : { available: false, reason: `${this.#bin} --version exited ${res.exitCode}` };
    } catch {
      result = { available: false, reason: `${this.#bin} is not installed` };
    }
    this.#probe = { at: this.#clock(), ...result };
    return result;
  }

  /** The last known answer, without waiting. Refreshes itself in the background once a minute. */
  ready(): boolean {
    if (!this.#enabled) return false;
    if (!this.#probe || this.#clock() - this.#probe.at > 60_000) void this.availability().catch(() => undefined);
    return this.#probe?.available ?? false;
  }

  /** One request, with its outcome noted for the Claude subscription: an answer, or a refusal for a usage limit. */
  async ask(req: BrainRequest): Promise<BrainResult> {
    try {
      const result = await this.#ask(req);
      this.#quota?.answered('claude-code');
      return result;
    } catch (err) {
      if (!req.signal?.aborted) this.#quota?.failed('claude-code', err);
      throw err;
    }
  }

  async #ask(req: BrainRequest): Promise<BrainResult> {
    const scratch = await mkdtemp(join(tmpdir(), 'sz-brain-'));
    await chmod(scratch, 0o700);
    const token = req.tools ? this.#sessions.create(req.tools, 2 * 60 * 60 * 1000) : null;
    try {
      const mcp = token ? await writeShimConfig(scratch, this.#bridgeUrl, token) : null;
      const images = req.content.some((part) => part.type === 'image');
      const allowed = [...(mcp ? [`mcp__${MCP_SERVER}`] : []), ...(req.webSearch ? ['WebSearch'] : [])];
      const notes = [
        req.tools ? `Your tools in this session come from the "${MCP_SERVER}" tool server, so their names carry its prefix: ${req.tools.definitions().map((t) => `mcp__${MCP_SERVER}__${t.name}`).join(', ')}. Where these instructions name a tool, call the prefixed one.` : '',
        req.webSearch ? 'For the web you have the WebSearch tool and nothing else: there is no page fetch in this session, so work from what the searches return.' : '',
      ].filter(Boolean);
      const args = [
        '--print',
        '--output-format', 'stream-json', '--verbose', // the event stream is where tool results (search hits) can be read
        '--tools', req.webSearch ? 'WebSearch' : '', // no Bash, no file access: an empty list unless research asked for search
        '--strict-mcp-config', ...(mcp ? ['--mcp-config', mcp.mcpConfig] : []),
        ...(allowed.length > 0 ? ['--allowedTools', ...allowed] : []),
        '--permission-mode', 'dontAsk',
        '--setting-sources', 'project', // the scratch folder has none, so user hooks, plugins and CLAUDE.md are not loaded
        '--disable-slash-commands',
        '--no-session-persistence',
        '--system-prompt', [req.system, ...notes].join('\n\n'),
        '--effort', req.effort,
        ...(req.model === 'default' ? [] : ['--model', req.model]),
        ...(req.jsonSchema ? ['--json-schema', JSON.stringify(withoutDialect(req.jsonSchema))] : []),
        ...(images ? ['--input-format', 'stream-json'] : []),
      ];
      // The prompt travels on stdin, never in the argument list, where other local processes could read it.
      const stdin = images
        ? `${JSON.stringify({ type: 'user', message: { role: 'user', content: req.content.map((part) => (part.type === 'text' ? part : { type: 'image', source: { type: 'base64', media_type: part.mediaType, data: part.base64 } })) } })}\n`
        : req.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n\n');

      const res = await this.#run(this.#bin, args, { stdin, cwd: scratch, env: cliEnv(), timeoutMs: req.timeoutMs ?? 30 * 60 * 1000, maxOutputBytes: 64 * 1024 * 1024, signal: req.signal });
      return parse(res.stdout, res.exitCode, res.stderr);
    } finally {
      if (token) this.#sessions.revoke(token);
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

/** The CLI's validator does not carry the 2020-12 meta-schema and rejects a schema that names it; the keywords used are common to every draft. */
function withoutDialect(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _dialect, ...rest } = schema;
  return rest;
}

/** Reads the CLI's event stream: the final result, and what each web search returned along the way. */
export function parse(stdout: string, exitCode: number, stderr: string): BrainResult {
  let result: z.infer<typeof Result> | null = null;
  const searches: BrainResult['searches'] = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    const event = safeJson(line);
    const final = Result.safeParse(event);
    if (final.success) {
      result = final.data;
      continue;
    }
    const search = SearchOutcome.safeParse(event);
    if (search.success) searches.push(search.data.tool_use_result.results.flatMap((r) => (SearchHits.safeParse(r).success ? SearchHits.parse(r).content.map((hit) => ({ url: hit.url, title: hit.title ?? '' })) : [])));
  }
  if (!result) throw new SessionBrainError(`Claude Code가 결과 없이 끝났습니다 (종료 코드 ${exitCode}). ${excerpt(stderr || stdout, 400)}`);
  if (result.is_error) {
    const said = result.result ?? '';
    if (/\/login|not logged in|authentication|invalid api key|oauth/i.test(said)) throw new SessionBrainError('Claude Code에 로그인되어 있지 않습니다. 터미널에서 claude 를 한 번 실행해 로그인한 뒤 다시 시도해 주세요.');
    if (/usage limit|rate limit|limit reached|quota/i.test(said)) throw new SessionBrainError(`Claude 구독의 사용 한도에 걸렸습니다. ${excerpt(said, 200)}`);
    throw new SessionBrainError(`Claude Code가 오류를 보고했습니다: ${excerpt(said, 400)}`);
  }
  const u = result.usage ?? {};
  return {
    text: result.result ?? '',
    structured: result.structured_output ?? null,
    usage: { inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0, cachedTokens: u.cache_read_input_tokens ?? 0 },
    searches,
  };
}

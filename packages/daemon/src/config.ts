import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { DEFAULT_DAEMON_PORT, DEFAULT_GATEWAY_PORT, Effort, TaskKind, ViewportId } from '@studio-zero/protocol';

export type { Effort };

export const EngineId = z.enum(['native-claude', 'claude-code', 'codex', 'cursor', 'antigravity']);
/** The engines that are a vendor's CLI run on the owner's subscription. */
export type BridgeEngineId = Exclude<z.infer<typeof EngineId>, 'native-claude'>;
export type EngineId = z.infer<typeof EngineId>;

const RouteCandidate = z.object({ engine: EngineId, model: z.string(), effort: Effort });
export type RouteCandidate = z.infer<typeof RouteCandidate>;

/**
 * Routing is a table, not a judgement call: for each task kind, the first candidate whose engine is available wins.
 * Planning-class work goes to Claude Fable 5.2; multi-file refactors prefer a bridged coding CLI and fall back to
 * the native loop; verification-side model calls are fixed in code: the audit's design review to `claude-fable-5-2`
 * (`qa/vision.ts`), reflection to `claude-opus-5-5`.
 */
const defaultRoutes: Record<TaskKind, z.input<typeof RouteCandidate>[]> = {
  ideate: [
    { engine: 'native-claude', model: 'claude-fable-5-2', effort: 'high' },
    { engine: 'claude-code', model: 'claude-fable-5-2', effort: 'high' },
  ],
  build: [
    { engine: 'native-claude', model: 'claude-opus-5-5', effort: 'high' },
    { engine: 'claude-code', model: 'opus', effort: 'high' },
  ],
  refactor: [
    { engine: 'codex', model: 'default', effort: 'high' }, // 'default' = whatever the CLI's own config selects
    { engine: 'claude-code', model: 'opus', effort: 'high' },
    { engine: 'native-claude', model: 'claude-opus-5-5', effort: 'high' },
  ],
  inline_edit: [
    { engine: 'native-claude', model: 'claude-opus-5-5', effort: 'low' },
    { engine: 'claude-code', model: 'opus', effort: 'low' },
  ],
  kirby_materialize: [
    { engine: 'native-claude', model: 'claude-opus-5-5', effort: 'high' },
    { engine: 'claude-code', model: 'opus', effort: 'high' },
  ],
};

export const ConfigSchema = z.object({
  listen: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.number().int().default(DEFAULT_DAEMON_PORT),
      /** Extra `Host` header values to accept, e.g. the Tailscale MagicDNS name. Loopback names are always accepted. */
      allowedHosts: z.array(z.string()).default([]),
      /** Browser origins allowed to open the control socket. Requests without an Origin (native clients) are allowed. */
      allowedOrigins: z.array(z.string()).default(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:1420', 'http://127.0.0.1:1420']),
    })
    .prefault({}),
  gateway: z.object({ host: z.string().default('127.0.0.1'), port: z.number().int().default(DEFAULT_GATEWAY_PORT) }).prefault({}),
  runtime: z
    .object({
      dockerBin: z.string().default('docker'),
      /** OrbStack registers the Docker context `orbstack`. Any Docker-compatible engine works by changing this. */
      dockerContext: z.string().default('orbstack'),
      /** Engine endpoint, e.g. `unix:///Users/me/.orbstack/run/docker.sock`. Default: looked up from `dockerContext`. */
      dockerHost: z.string().optional(),
      /** Base for the sandbox image the daemon builds on first use (adds pnpm). */
      baseImage: z.string().regex(/^[\w][\w./:@-]*$/).default('node:24-bookworm'),
      /** Use this prebuilt image for sandboxes as is, instead of building one from `baseImage`. */
      image: z.string().regex(/^[\w][\w./:@-]*$/).optional(),
      cpus: z.number().min(0.25).max(16).default(2),
      // A ceiling, not a reservation. At 2048 a phone project that renders on its server sat at 1GB with its dev
      // server alone and reached the ceiling 11,772 times in one build, beside the compiler and the tests an
      // engine runs (measured 2026-11-14 on a 24GB Mac).
      memoryMb: z.number().int().min(256).default(4096),
      pidsLimit: z.number().int().min(64).default(512),
      previewPorts: z.array(z.number().int().min(1).max(65535)).max(8).default([3000, 5173, 8081]),
      execTimeoutSec: z.number().int().min(5).max(3600).default(600),
    })
    .prefault({}),
  budgets: z
    .object({
      taskTokens: z.number().int().default(2_000_000),
      projectDailyTokens: z.number().int().default(20_000_000),
      maxTurns: z.number().int().default(80),
      verifyRounds: z.number().int().min(1).max(8).default(3),
    })
    .prefault({}),
  approvals: z
    .object({
      ttlSec: z.number().int().min(30).default(3600),
      protectedBranches: z.array(z.string()).default(['main']),
    })
    .prefault({}),
  telegram: z
    .object({
      enabled: z.boolean().default(false),
      /** Numeric Telegram user ids allowed to command the daemon. Everything else is dropped before parsing. */
      allowedUserIds: z.array(z.number().int()).default([]),
      apiBase: z.string().default('https://api.telegram.org'),
    })
    .prefault({}),
  slack: z
    .object({
      enabled: z.boolean().default(false),
      /** Slack member ids (`U…`) allowed to command the daemon, in direct messages to the bot only. */
      allowedUserIds: z.array(z.string().regex(/^[UW][A-Z0-9]{6,}$/)).default([]),
    })
    .prefault({}),
  ntfy: z
    .object({
      enabled: z.boolean().default(false),
      server: z.string().url().default('https://ntfy.sh'),
      /** Where notifications are published. On a public server the name is the only thing keeping them private. */
      topic: z.string().default(''),
      /** Where button presses arrive. Must differ from `topic`. */
      commandTopic: z.string().default(''),
    })
    .prefault({}),
  voice: z.object({ model: z.string().default('whisper-1') }).prefault({}),
  audit: z
    .object({
      threshold: z.number().min(0).max(100).default(85),
      viewports: z.array(ViewportId).min(1).default(['iphone-15-pro', 'ipad-pro-11', 'desktop-1440']),
      maxFolds: z.number().int().min(1).max(5).default(3),
      /** Base for the QA browser image. Default: the official Playwright image matching the installed `playwright-core`. */
      browserImage: z.string().regex(/^[\w][\w./:@-]*$/).optional(),
      vision: z.boolean().default(true),
      /**
       * The subscriptions a design review is offered to, in order, each through its own CLI. The first that
       * answers reviews the screen; the next is asked only when the one before fails or is at its usage limit.
       * A stored Anthropic API key is always tried before any of them.
       */
      reviewers: z.array(z.enum(['codex', 'claude-code', 'antigravity', 'cursor'])).min(1).default(['codex', 'claude-code', 'antigravity', 'cursor']),
    })
    .prefault({}),
  engines: z
    .object({
      claudeCode: z.object({ enabled: z.boolean().default(true), bin: z.string().default('claude') }).prefault({}),
      /** Its native tools are disabled by feature flags and a read-only sandbox, which is weaker than Claude Code's `--tools ""`. */
      codex: z.object({ enabled: z.boolean().default(true), bin: z.string().default('codex') }).prefault({}),
      /** These two cannot switch their own tools off; they run inside the host jail (macOS). */
      cursor: z.object({ enabled: z.boolean().default(true), bin: z.string().default('cursor-agent') }).prefault({}),
      antigravity: z.object({ enabled: z.boolean().default(true), bin: z.string().default('agy') }).prefault({}),
    })
    .prefault({}),
  routes: z.record(TaskKind, z.array(RouteCandidate).min(1)).default(defaultRoutes as Record<TaskKind, RouteCandidate[]>),
  images: z
    .object({
      /** Whether engines may have pictures made for a product through a connected subscription's image tool. */
      enabled: z.boolean().default(true),
      /** How many one task may ask for. Each is a call on the owner's subscription. */
      perTask: z.number().int().min(0).max(40).default(8),
    })
    .default({ enabled: true, perTask: 8 }),
  review: z
    .object({
      /**
       * The two cross-checks of a full build task by another vendor's model: one on the plan before the build,
       * one on the result after it. Each is a single call on the owner's subscription; off, neither is made.
       */
      sandwich: z.boolean().default(true),
    })
    .prefault({}),
  quotaPark: z
    .object({
      /**
       * How many times one task may wait out a subscription's usage limit before it fails. A task is parked
       * only when the vendor named the time its limit resets; each wait ends with the task run again.
       */
      maxParks: z.number().int().min(0).max(10).default(2),
      /** The longest wait a task is parked for. A limit that resets later than this fails the task, as before. */
      maxWaitHours: z.number().min(0).max(24 * 7).default(6),
    })
    .prefault({}),
  scheduler: z
    .object({
      /** Whether the owner's schedules fire. Off, they are kept and can still be listed and changed. */
      enabled: z.boolean().default(true),
    })
    .prefault({}),
  selfHosting: z
    .object({
      /** Mount the studio's own repository as the pinned first project. */
      enabled: z.boolean().default(true),
      /** The checkout to work on. Default: the repository this daemon is running from. */
      repoPath: z.string().optional(),
      /** The branch tasks start from and finished work is merged into. */
      baseBranch: z.string().regex(/^[\w][\w./-]{0,80}$/).default('main'),
    })
    .prefault({}),
  kirby: z
    .object({
      allowedHosts: z.array(z.string()).default(['github.com', 'gitlab.com', 'codeberg.org']),
      maxFiles: z.number().int().default(4000),
      maxFileBytes: z.number().int().default(200_000),
      maxTotalBytes: z.number().int().default(24_000_000),
    })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema> & {
  /** State directory: config.json, studio-zero.db, artifacts/. */
  home: string;
  dbPath: string;
  artifactsDir: string;
};

/** Loads `$SZ_HOME/config.json` (default `~/.studio-zero`). A missing file means defaults; a malformed one is fatal. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = env.SZ_HOME ?? join(homedir(), '.studio-zero');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = join(home, 'config.json');
  const raw: unknown = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const parsed = ConfigSchema.parse(raw);
  const artifactsDir = join(home, 'artifacts');
  mkdirSync(artifactsDir, { recursive: true, mode: 0o700 });
  return { ...parsed, home, dbPath: join(home, 'studio-zero.db'), artifactsDir };
}

export function testConfig(home: string, overrides: z.input<typeof ConfigSchema> = {}): Config {
  return { ...ConfigSchema.parse(overrides), home, dbPath: ':memory:', artifactsDir: join(home, 'artifacts') };
}

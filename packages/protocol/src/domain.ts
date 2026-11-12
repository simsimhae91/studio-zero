import { z } from 'zod';

/** Wire protocol version. Bumped on any breaking change to frames, methods or events. */
export const PROTOCOL_VERSION = 1;
export const DEFAULT_DAEMON_PORT = 49200;
export const DEFAULT_GATEWAY_PORT = 49201;

export const Slug = z.string().regex(/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/, 'lowercase letters, digits and dashes (3-40 chars)');

export const TaskKind = z.enum(['build', 'refactor', 'inline_edit', 'ideate', 'kirby_materialize']);
export type TaskKind = z.infer<typeof TaskKind>;

/**
 * `suspended`: the work is done and committed on its branch, and the checks it still owes cannot be had right
 * now (every design reviewer is at its usage limit). The task holds no slot and no engine; the daemon queues it
 * again by itself when a reviewer answers, and it then resumes at verification.
 */
export const TaskState = z.enum(['queued', 'running', 'awaiting_approval', 'suspended', 'succeeded', 'failed', 'cancelled']);
export type TaskState = z.infer<typeof TaskState>;

export const Phase = z.enum(['plan', 'execute', 'verify', 'reflect', 'evolve']);
export type Phase = z.infer<typeof Phase>;

/** Where a request came from: the control socket (desktop and mobile apps, CLI), one of the messenger relays, or the daemon itself. */
export const Origin = z.enum(['desktop', 'telegram', 'slack', 'ntfy', 'system']);
export type Origin = z.infer<typeof Origin>;

/** What an owner can start a project as. */
export const Template = z.enum(['web-vite-react', 'web-next', 'mobile-expo']);
export type Template = z.infer<typeof Template>;

/**
 * What a project is. `studio-core` is the studio's own repository, mounted as the pinned first project: it is
 * made by the daemon, not by an owner, and it can be neither created nor deleted through the protocol.
 */
export const ProjectTemplate = z.enum([...Template.options, 'studio-core']);
export type ProjectTemplate = z.infer<typeof ProjectTemplate>;
export const CORE_PROJECT_ID = 'prj_core';

/**
 * How much of the loop a task runs.
 * - `fast` (Draft 0): no separate planning call, then the execution gates only: the compiler, a headless smoke
 *   load of the running app, and the project's regression commands. No design gates, no reflection.
 * - `full`: planning, the execution gates, the design gates (slop lint, visual audit) and reflection.
 */
export const TaskTrack = z.enum(['fast', 'full']);
export type TaskTrack = z.infer<typeof TaskTrack>;

export const Project = z.object({
  id: z.string(),
  slug: Slug,
  name: z.string().min(1).max(80),
  template: ProjectTemplate,
  createdAt: z.number().int(),
});
export type Project = z.infer<typeof Project>;

/** A named stream of tasks inside a project (a feature, a fix, a scratch line of work). Tasks still run one at a time per project: the workspace is one working tree. */
export const Session = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1).max(60),
  createdAt: z.number().int(),
});
export type Session = z.infer<typeof Session>;

export const SandboxState = z.enum(['absent', 'running', 'stopped']);
export type SandboxState = z.infer<typeof SandboxState>;
export const SandboxInfo = z.object({
  projectId: z.string(),
  state: SandboxState,
  container: z.string(),
  image: z.string(),
  /** Host-side URLs for the live preview; empty while the sandbox is not running. */
  previewUrls: z.array(z.object({ containerPort: z.number().int(), localhost: z.string(), orbLocal: z.string() })),
});
export type SandboxInfo = z.infer<typeof SandboxInfo>;

export const Task = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: TaskKind,
  prompt: z.string(),
  origin: Origin,
  state: TaskState,
  phase: Phase.nullable(),
  engine: z.string().nullable(),
  model: z.string().nullable(),
  branch: z.string().nullable(),
  budgetTokens: z.number().int(),
  spentTokens: z.number().int(),
  spentUsdMicros: z.number().int(),
  baseCheckpointId: z.string().nullable(),
  /** Branch this task started from. The integration branch unless the task continues a fork. */
  baseBranch: z.string().nullable(),
  /** The engine the owner asked for, if they picked one instead of leaving it to the routing table. */
  enginePref: z.string().nullable(),
  /** The session (task stream) this task belongs to; null for the project's default stream. */
  sessionId: z.string().nullable(),
  /** The subscription the owner chose for this task's two cross-checks, instead of the one paired with the engine. */
  reviewerPref: z.string().nullable(),
  /** Pages the owner pointed at as references. Opened only inside the QA browser container, before any code is written. */
  references: z.array(z.string()),
  track: TaskTrack,
  summary: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.number().int(),
  startedAt: z.number().int().nullable(),
  finishedAt: z.number().int().nullable(),
});
export type Task = z.infer<typeof Task>;

export const ApprovalState = z.enum(['pending', 'approved', 'denied', 'expired', 'consumed']);
export type ApprovalState = z.infer<typeof ApprovalState>;

export const Approval = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  taskId: z.string().nullable(),
  actionKind: z.string(),
  /** sha256 of the canonical action JSON. The grant is valid for exactly this action. */
  actionHash: z.string(),
  summary: z.string(),
  state: ApprovalState,
  requestedAt: z.number().int(),
  expiresAt: z.number().int(),
  resolvedAt: z.number().int().nullable(),
  resolvedVia: Origin.nullable(),
});
export type Approval = z.infer<typeof Approval>;

export const Checkpoint = z.object({
  id: z.string(),
  projectId: z.string(),
  taskId: z.string().nullable(),
  label: z.string(),
  commit: z.string(),
  createdAt: z.number().int(),
});
export type Checkpoint = z.infer<typeof Checkpoint>;

// ------------------------------------------------------------- workspace files

/** One entry of a workspace listing. `path` is relative to /workspace; `mtime` is epoch milliseconds. */
export const FileEntry = z.object({
  path: z.string().min(1).max(1024),
  name: z.string().min(1).max(255),
  type: z.enum(['file', 'directory']),
  size: z.number().int().min(0),
  mtime: z.number().int().min(0),
});
export type FileEntry = z.infer<typeof FileEntry>;

/** A second opinion can be asked of these subscription CLIs: Codex, and Gemini through Antigravity's `agy`. */
export const AdvisorId = z.enum(['codex', 'gemini']);
export type AdvisorId = z.infer<typeof AdvisorId>;

// ------------------------------------------------------------ tool servers

/** An external tool server (MCP) the daemon can call on an agent's behalf. */
export const McpServerInfo = z.object({
  id: z.string(),
  name: z.string(),
  /** `http`: a remote server at `url`. `stdio`: a program on the daemon's Mac, started as `command` with `args`. */
  transport: z.enum(['http', 'stdio']),
  url: z.string(),
  command: z.string().nullable(),
  args: z.array(z.string()),
  /** For a stdio server that wants its token in an environment variable: the variable's name. */
  tokenEnv: z.string().nullable(),
  auth: z.enum(['bearer', 'none', 'oauth']),
  about: z.string(),
  /** True for the servers the daemon ships knowing; false for ones the owner added. */
  builtin: z.boolean(),
  /** The vault entry that holds this server's token. */
  credentialId: z.string(),
  state: z.enum(['ready', 'needs-token', 'unsupported']),
  /** Tools the owner has allowed, per project. Each was approved once. */
  grants: z.array(z.object({ projectId: z.string(), tool: z.string() })),
});
export type McpServerInfo = z.infer<typeof McpServerInfo>;

// ---------------------------------------------------------------- visual QA

export const ViewportId = z.enum(['iphone-15-pro', 'ipad-pro-11', 'desktop-1440']);
export type ViewportId = z.infer<typeof ViewportId>;

export const FindingCategory = z.enum([
  'contrast',
  'touch-target',
  'responsive',
  'typography',
  'spacing',
  'hierarchy',
  'color',
  'copy',
  'originality',
  /** Whether what can be touched looks and answers like it: pressed states, affordances, a place to act. */
  'tactility',
]);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const Severity = z.enum(['blocker', 'major', 'minor']);
export type Severity = z.infer<typeof Severity>;

export const BBox = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type BBox = z.infer<typeof BBox>;

export const Finding = z.object({
  rule: z.string(),
  category: FindingCategory,
  severity: Severity,
  /** 'dom' findings are measured; 'vlm' findings are a vision model's judgement; 'lint' findings come from source. */
  source: z.enum(['dom', 'vlm', 'lint']),
  viewport: ViewportId.nullable(),
  route: z.string().nullable(),
  message: z.string(),
  /** CSS selector of the offending element when known. */
  selector: z.string().nullable(),
  /** Bounding box in CSS pixels, page coordinates of the given viewport. */
  bbox: BBox.nullable(),
  /** Concrete remediation, phrased in terms of design tokens / CSS. */
  fix: z.string().nullable(),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
});
export type Finding = z.infer<typeof Finding>;

/** What a screen is laid out as, whatever the project calls itself. */
export const ScreenArchetype = z.enum(['mobile-app', 'web-app', 'web-dashboard', 'marketing']);
export type ScreenArchetype = z.infer<typeof ScreenArchetype>;

/** The moves a design reviewer can prescribe. A closed set, so a client can label them and an engine can act on them. */
export const RedesignAction = z.enum(['replace_with_viewfinder', 'dock_to_bottom', 'add_app_bar', 'move_to_sheet', 'restructure', 'restyle', 'rewrite_copy', 'remove']);
export type RedesignAction = z.infer<typeof RedesignAction>;

/** One concrete change the design reviewer asks for, located the same way a finding is. */
export const RedesignPatch = z.object({
  viewport: ViewportId,
  route: z.string(),
  /** CSS selector of the element to change; null when the patch is about the screen as a whole. */
  target: z.string().nullable(),
  bbox: BBox.nullable(),
  action: RedesignAction,
  /** What to build instead, in terms of the project's components and theme tokens. */
  instruction: z.string(),
});
export type RedesignPatch = z.infer<typeof RedesignPatch>;

/** S: ships as it is. A, B: passes. C, D: does not pass. F: reads as generated. */
export const DesignGrade = z.enum(['S', 'A', 'B', 'C', 'D', 'F']);
export type DesignGrade = z.infer<typeof DesignGrade>;

/** Who can carry a design review: the Anthropic API key, or one of the owner's subscriptions through its CLI. */
export const ReviewerId = z.enum(['api', 'codex', 'claude-code', 'antigravity', 'cursor']);
export type ReviewerId = z.infer<typeof ReviewerId>;

/**
 * A subscription that can cross-check a task's lead engine: once on the plan, once on the result. Named by
 * its CLI. Chosen by pairing (never the lead's own vendor) unless the owner picks one.
 */
export const ReviewerPref = z.enum(['claude-code', 'codex', 'antigravity', 'cursor']);
export type ReviewerPref = z.infer<typeof ReviewerPref>;

/** How the design review went: who looked, at how much, and why not when it did not happen. */
export const VisionCoverage = z.object({
  /**
   * `reviewed`: every captured screen was seen. `partial`: some were. `failed`: it was tried and none were.
   * `off`: switched off in the daemon's config. `unavailable`: no API key and no subscription CLI to ask.
   */
  status: z.enum(['reviewed', 'partial', 'failed', 'off', 'unavailable']),
  /** The reviewer that carried the reviews (the first one that answered). */
  via: ReviewerId.nullable(),
  model: z.string().nullable(),
  /**
   * True when a reviewer refused for a usage or budget limit, so that time alone brings the review back.
   * A task whose audit is unreviewed for this reason is suspended until it does, instead of ending unverified.
   */
  limited: z.boolean(),
  /** Screens (viewport × route) a reviewer saw, out of those captured. */
  reviewed: z.number().int(),
  expected: z.number().int(),
  /** Why screens went unreviewed, in the daemon's words. */
  reason: z.string().nullable(),
});
export type VisionCoverage = z.infer<typeof VisionCoverage>;

/** The most an audit can score when no design reviewer saw every screen. Well under any passing threshold. */
export const UNREVIEWED_SCORE_CAP = 50;

export const AuditReport = z.object({
  id: z.string(),
  projectId: z.string(),
  taskId: z.string().nullable(),
  createdAt: z.number().int(),
  score: z.number(),
  threshold: z.number(),
  passed: z.boolean(),
  /**
   * True only when a design reviewer saw every captured screen. When false the score is capped and the audit
   * does not pass: measurements say a screen is legible, not that it is designed.
   */
  visionReviewed: z.boolean(),
  vision: VisionCoverage,
  /** 0-10 per rubric axis, averaged across viewports; null when the vision pass did not run. */
  rubric: z.record(z.string(), z.number()).nullable(),
  /** 0-100, higher is worse: how much the screens read as the default output of a code generator. Null without a review. */
  slopScore: z.number().nullable(),
  archetype: ScreenArchetype.nullable(),
  /** The design reviewer's verdict on the weakest screen, in a few sentences. */
  critique: z.string().nullable(),
  /** Null when no reviewer saw the screens: an unreviewed design has no grade. */
  grade: DesignGrade.nullable(),
  redesignPatches: z.array(RedesignPatch),
  findings: z.array(Finding),
  screenshots: z.array(
    z.object({ viewport: ViewportId, route: z.string(), fold: z.number().int(), artifactId: z.string(), width: z.number(), height: z.number() }),
  ),
  /**
   * The words on the audited screens and nothing else, and what the copy lint made of them. Absent on audits
   * recorded before copy was read apart from the rendering.
   */
  copy: z
    .object({
      /** The text of each route, in reading order: page content, to be shown and judged as data. */
      texts: z.array(z.object({ route: z.string(), role: z.enum(['title', 'body', 'cta', 'label']), text: z.string() })),
      /** 0-100, higher is worse: how much the copy reads as generated. */
      slopScore: z.number(),
      /** Distinct copy habits found (the `copy/…` findings). */
      habits: z.number().int(),
    })
    .optional(),
  /** Counts behind the pass rates a ledger reports. Absent on older audits. */
  measures: z
    .object({
      /** Text elements measured for contrast, and how many met WCAG AAA. */
      contrast: z.object({ passed: z.number().int(), total: z.number().int() }),
      /** Controls measured on touch viewports, and how many met the target size. */
      touchTargets: z.object({ passed: z.number().int(), total: z.number().int() }),
    })
    .optional(),
  /**
   * Whether the first screen has something real to look at or act on. False when the reviewer found it to be
   * text and rules only; null when no reviewer saw it. Absent on older audits.
   */
  livingVisual: z.boolean().nullable().optional(),
});
export type AuditReport = z.infer<typeof AuditReport>;

// -------------------------------------------------------------------- ledger

/** One before-and-after in a ledger entry, against the project's previous entry. */
export const LedgerDelta = z.object({
  metric: z.string(),
  before: z.string(),
  after: z.string(),
  /** Null when neither direction is better (a count that merely changed). */
  better: z.boolean().nullable(),
});
export type LedgerDelta = z.infer<typeof LedgerDelta>;

/**
 * The receipt of one finished task: what its code, its design and its cost measured, and how that compares
 * with the task before it. Every number is taken by the daemon from its own checks and its own usage rows;
 * none is reported by the engine whose work it describes.
 */
export const LedgerEntry = z.object({
  id: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  createdAt: z.number().int(),
  taskKind: TaskKind,
  track: TaskTrack,
  outcome: z.enum(['succeeded', 'failed']),
  engine: z.string().nullable(),
  code: z.object({
    /** Errors the compiler reported on the last run; null when the workspace had nothing to compile. */
    compilerErrors: z.number().int().nullable(),
    /** The same on the first verification round, before any correction. */
    firstCompilerErrors: z.number().int().nullable(),
    /** Verification rounds it took until every check passed, or until the task gave up. */
    verifyRounds: z.number().int(),
    /** Regression commands (the project's tests among them) that passed, and the names of those that did not. */
    checksPassed: z.number().int(),
    checksFailed: z.array(z.string()),
    /** The production build, when the project has one: how long it took and what it weighs. */
    buildMs: z.number().int().nullable(),
    bundleBytes: z.number().int().nullable(),
  }),
  design: z.object({
    grade: DesignGrade.nullable(),
    score: z.number().nullable(),
    slopScore: z.number().nullable(),
    livingVisual: z.boolean().nullable(),
    /** Share of measured text at WCAG AAA contrast, 0 to 1. */
    contrastAaa: z.number().nullable(),
    /** Share of touch controls at the target size, 0 to 1. */
    touchTargets: z.number().nullable(),
    /** Copy habits the Korean text lint found. */
    textSlop: z.number().int().nullable(),
  }),
  cost: z.object({
    modelCalls: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    usdMicros: z.number().int(),
    wallMs: z.number().int(),
  }),
  review: z.object({
    /** Who red-teamed the plan and who accepted the result; null when that cross-check did not run. */
    plan: ReviewerId.nullable(),
    acceptance: ReviewerId.nullable(),
    verdict: z.enum(['pass', 'patch']).nullable(),
  }),
  delta: z.array(LedgerDelta),
  /** The deltas as one line, written by code: "타입 에러 3→0, 디자인 등급 B→S". Empty for a project's first entry. */
  proof: z.string(),
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

// ------------------------------------------------------------ this Mac

/**
 * What keeps the Mac awake. `system`: the display may sleep, the machine does not (a long build overnight).
 * `display`: the display stays on too (watching, a demo). `off`: the system's own settings apply.
 */
export const PowerMode = z.enum(['off', 'system', 'display']);
export type PowerMode = z.infer<typeof PowerMode>;

export const PowerState = z.object({
  mode: PowerMode,
  /** False where there is no `caffeinate` to run (anything but macOS). */
  supported: z.boolean(),
});
export type PowerState = z.infer<typeof PowerState>;

/**
 * What the daemon has seen of one subscription. It does not read the vendor's login, so this is not the
 * account's balance: it is the CLI's presence, what the studio itself spent through it, and the last time the
 * vendor refused for a usage limit, with the reset time when the refusal named one.
 */
export const SubscriptionQuota = z.object({
  id: ReviewerPref,
  /** The CLI is installed and answers. */
  connected: z.boolean(),
  detail: z.string(),
  /** `limited`: the last call was refused for a usage limit and none has succeeded since. */
  state: z.enum(['ok', 'limited', 'unknown']),
  /** When the vendor said the limit lifts; null when it did not say, or when not limited. */
  resetsAt: z.number().int().nullable(),
  limitedSince: z.number().int().nullable(),
  lastAnswerAt: z.number().int().nullable(),
  /** Tokens and calls the studio put through this subscription in the last five hours and the last seven days. */
  recent: z.object({ tokens: z.number().int(), calls: z.number().int() }),
  week: z.object({ tokens: z.number().int(), calls: z.number().int() }),
});
export type SubscriptionQuota = z.infer<typeof SubscriptionQuota>;

/**
 * An outside API a project's own code may call with a key the owner holds. The key stays in the Keychain: the
 * project's sandbox is given a base URL on the daemon's gateway and, for each variable, a stand-in value. A call
 * through that URL has the real value put in on the host and goes to `origin`, and nowhere else.
 */
export const ExternalApi = z.object({
  projectId: z.string(),
  /** Names the gateway path (`/ext/<name>`) and prefixes the variables. */
  name: z.string().regex(/^[a-z][a-z0-9-]{1,23}$/, 'lowercase letters, digits and dashes (2-24 chars)'),
  /** Where calls go: an https origin, e.g. `https://openapi.example.com:9443`. */
  origin: z.string(),
  /** The variables it has, by name (`APP_KEY`, `APP_SECRET`). Their values never leave the daemon. */
  variables: z.array(z.string()),
  createdAt: z.number().int(),
});
export type ExternalApi = z.infer<typeof ExternalApi>;

/** Where the studio's own repository stands as a project: what a task there would work on, and whether its result can be merged. */
export const SelfHostStatus = z.object({
  available: z.boolean(),
  /** Why not, when it is not; otherwise what was found. */
  detail: z.string(),
  repoPath: z.string().nullable(),
  /** The branch tasks start from and results are merged into. */
  baseBranch: z.string().nullable(),
  head: z.string().nullable(),
  /** False when the checkout has uncommitted changes: tasks do not see them, and a merge would be refused. */
  clean: z.boolean().nullable(),
  projectId: z.string().nullable(),
  /** Feature branches exported from Core tasks and not yet merged. */
  pending: z.array(z.object({ taskId: z.string(), branch: z.string(), files: z.number().int(), insertions: z.number().int(), deletions: z.number().int() })),
});
export type SelfHostStatus = z.infer<typeof SelfHostStatus>;

// ---------------------------------------------------------- self-improvement

export const LessonState = z.enum(['candidate', 'active', 'quarantined', 'retired']);
export type LessonState = z.infer<typeof LessonState>;

export const Lesson = z.object({
  id: z.string(),
  scope: z.enum(['project', 'global']),
  projectId: z.string().nullable(),
  kind: z.enum(['rule', 'heuristic']),
  title: z.string(),
  trigger: z.string(),
  guidance: z.string(),
  state: LessonState,
  confirmations: z.number().int(),
  harms: z.number().int(),
  originTaskId: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Lesson = z.infer<typeof Lesson>;

export const EvalSpec = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('command'), command: z.string().min(1).max(400), timeoutSec: z.number().int().min(1).max(900) }),
  z.object({ kind: z.literal('slop-lint'), maxMajor: z.number().int().min(0) }),
  z.object({ kind: z.literal('visual'), routes: z.array(z.string()).min(1).max(8), minScore: z.number().min(0).max(100) }),
]);
export type EvalSpec = z.infer<typeof EvalSpec>;

export const Eval = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  spec: EvalSpec,
  enabled: z.boolean(),
  originTaskId: z.string().nullable(),
  createdAt: z.number().int(),
});
export type Eval = z.infer<typeof Eval>;

// --------------------------------------------------------------------- kirby

export const ProposalState = z.enum(['proposed', 'materializing', 'ready', 'merged', 'rejected', 'failed']);
export type ProposalState = z.infer<typeof ProposalState>;

export const MetricDelta = z.object({ metric: z.string(), before: z.number(), after: z.number() });

export const ProposalCard = z.object({
  id: z.string(),
  projectId: z.string(),
  ingestId: z.string(),
  sourceRepo: z.string(),
  sourceCommit: z.string(),
  practiceId: z.string(),
  title: z.string(),
  rationale: z.string(),
  /** Where the pattern was observed in the source repository. */
  evidence: z.array(z.object({ file: z.string(), line: z.number().int(), excerpt: z.string() })),
  plannedChanges: z.array(z.object({ path: z.string(), action: z.enum(['create', 'modify', 'delete']), description: z.string() })),
  risk: z.enum(['low', 'medium', 'high']),
  /** The model's expectation. Always labelled as an estimate in clients; `measured` is the evidence. */
  estimatedImpact: z.string(),
  state: ProposalState,
  branch: z.string().nullable(),
  taskId: z.string().nullable(),
  /** Unified diff of the materialized branch against the target branch; null until materialized. */
  diff: z.string().nullable(),
  diffStat: z.object({ files: z.number().int(), insertions: z.number().int(), deletions: z.number().int() }).nullable(),
  measured: z.array(MetricDelta).nullable(),
  createdAt: z.number().int(),
});
export type ProposalCard = z.infer<typeof ProposalCard>;

export const CredentialMeta = z.object({
  /** e.g. `provider/anthropic/api-key`, `relay/telegram/bot-token`. The secret itself never crosses this protocol outbound. */
  id: z.string().regex(/^[a-z0-9]+(\/[a-z0-9-]+){1,3}$/),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type CredentialMeta = z.infer<typeof CredentialMeta>;

import { z } from 'zod';

/** Wire protocol version. Bumped on any breaking change to frames, methods or events. */
export const PROTOCOL_VERSION = 1;
export const DEFAULT_DAEMON_PORT = 49200;
export const DEFAULT_GATEWAY_PORT = 49201;

export const Slug = z.string().regex(/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/, 'lowercase letters, digits and dashes (3-40 chars)');

export const TaskKind = z.enum(['build', 'refactor', 'inline_edit', 'ideate', 'kirby_materialize']);
export type TaskKind = z.infer<typeof TaskKind>;

export const TaskState = z.enum(['queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled']);
export type TaskState = z.infer<typeof TaskState>;

export const Phase = z.enum(['plan', 'execute', 'verify', 'reflect', 'evolve']);
export type Phase = z.infer<typeof Phase>;

/** Where a request came from: the control socket (desktop and mobile apps, CLI), one of the messenger relays, or the daemon itself. */
export const Origin = z.enum(['desktop', 'telegram', 'slack', 'ntfy', 'system']);
export type Origin = z.infer<typeof Origin>;

export const Template = z.enum(['web-vite-react', 'web-next', 'mobile-expo']);
export type Template = z.infer<typeof Template>;

export const Project = z.object({
  id: z.string(),
  slug: Slug,
  name: z.string().min(1).max(80),
  template: Template,
  createdAt: z.number().int(),
});
export type Project = z.infer<typeof Project>;

export const SandboxState = z.enum(['absent', 'running', 'stopped']);
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

// ------------------------------------------------------------ tool servers

/** An external tool server (MCP) the daemon can call on an agent's behalf. */
export const McpServerInfo = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
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

export const AuditReport = z.object({
  id: z.string(),
  projectId: z.string(),
  taskId: z.string().nullable(),
  createdAt: z.number().int(),
  score: z.number(),
  threshold: z.number(),
  passed: z.boolean(),
  /** 0-10 per rubric axis, averaged across viewports; null when the vision pass did not run. */
  rubric: z.record(z.string(), z.number()).nullable(),
  findings: z.array(Finding),
  screenshots: z.array(
    z.object({ viewport: ViewportId, route: z.string(), fold: z.number().int(), artifactId: z.string(), width: z.number(), height: z.number() }),
  ),
});
export type AuditReport = z.infer<typeof AuditReport>;

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

import { z } from 'zod';
import { AxBlock, AxResponse, Confidence } from '@studio-zero/ax';
import { Origin, Project, Task } from './domain.ts';

// The block vocabulary (A2UI) lives in the AX kit, because generated apps use the same one.
export { AxBlock, AxResponse, Confidence } from '@studio-zero/ax';

// ---------------------------------------------------------------- scratchpad

export const ScratchState = z.enum(['exploring', 'ready', 'promoted', 'archived']);
export type ScratchState = z.infer<typeof ScratchState>;

export const ScratchMode = z.enum(['think', 'research', 'document']);
export type ScratchMode = z.infer<typeof ScratchMode>;

/** Tier 1 of the lifecycle: a place to think that costs no sandbox, no repository and no setup. */
export const Scratchpad = z.object({
  id: z.string(),
  title: z.string(),
  mode: ScratchMode,
  state: ScratchState,
  /** The project this scratchpad became, once promoted. */
  projectId: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Scratchpad = z.infer<typeof Scratchpad>;

export const ScratchEntry = z.object({
  seq: z.number().int(),
  scratchId: z.string(),
  at: z.number().int(),
  author: z.enum(['owner', 'agent', 'system']),
  /** What the owner typed, when the author is the owner. */
  text: z.string().nullable(),
  /** The owner's answer to an earlier block. */
  response: AxResponse.nullable(),
  blocks: z.array(AxBlock),
});
export type ScratchEntry = z.infer<typeof ScratchEntry>;

/** What still stands between a scratchpad and a build. Computed by the daemon from the spec and decision log. */
export const Readiness = z.object({ ready: z.boolean(), missing: z.array(z.string()) });
export type Readiness = z.infer<typeof Readiness>;

export const SpecSection = z.enum(['problem', 'users', 'scope_in', 'scope_out', 'requirements', 'success', 'open_questions']);
export type SpecSection = z.infer<typeof SpecSection>;

export const ScratchMove = z.enum(['crazy-eights', 'personas', 'red-team', 'converge']);
export type ScratchMove = z.infer<typeof ScratchMove>;

// ----------------------------------------------------------------- knowledge

export const KnowledgeKind = z.enum(['research', 'document']);
export const DocumentKind = z.enum(['brief', 'report', 'prd', 'rfc']);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const KnowledgeJob = z.object({
  id: z.string(),
  kind: KnowledgeKind,
  title: z.string(),
  state: z.enum(['running', 'succeeded', 'failed']),
  origin: Origin,
  scratchId: z.string().nullable(),
  error: z.string().nullable(),
  spentTokens: z.number().int(),
  createdAt: z.number().int(),
  finishedAt: z.number().int().nullable(),
});
export type KnowledgeJob = z.infer<typeof KnowledgeJob>;

export const Fact = z.object({
  claim: z.string(),
  /** Set by the daemon from the evidence, not by the model: two independent domains or more is `high`. */
  confidence: Confidence,
  sources: z.array(z.object({ url: z.string(), title: z.string(), domain: z.string(), quote: z.string(), quoteVerified: z.boolean() })),
});
export type Fact = z.infer<typeof Fact>;

export const ResearchReport = z.object({
  question: z.string(),
  facts: z.array(Fact),
  /** Claims the model made that no retrieved source supported. Reported, not used. */
  dropped: z.array(z.object({ claim: z.string(), reason: z.string() })),
  gaps: z.array(z.string()),
  searches: z.number().int(),
});
export type ResearchReport = z.infer<typeof ResearchReport>;

export const TextFinding = z.object({
  rule: z.string(),
  severity: z.enum(['major', 'minor']),
  line: z.number().int(),
  message: z.string(),
  fix: z.string(),
});
export type TextFinding = z.infer<typeof TextFinding>;

export const PromotionResult = z.object({ scratchpad: Scratchpad, project: Project.nullable(), task: Task.nullable(), job: KnowledgeJob.nullable() });
export type PromotionResult = z.infer<typeof PromotionResult>;

/** How the owner's answers have compared with what the agent recommended, per confidence level. */
export const Calibration = z.object({
  levels: z.record(Confidence, z.object({ total: z.number().int(), overridden: z.number().int() })),
  /** True when `high` has been overridden often enough lately that the daemon treats it as `medium`. */
  highDemoted: z.boolean(),
});
export type Calibration = z.infer<typeof Calibration>;

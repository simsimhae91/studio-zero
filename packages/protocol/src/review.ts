import { z } from 'zod';

/**
 * The owner's review of a task's code: the branch's diff as the daemon read it in the sandbox, comments on line
 * ranges of it, and one typed result. The rules of a review are here and nowhere else: what may be blocking,
 * what a decision must carry. The daemon dispatches on `decision` alone and never reads the comments to decide.
 */

/** A path in the diff, relative to the workspace. The daemon has already refused anything absolute or with `..`. */
const DiffPath = z.string().min(1).max(1024);

export const DiffLine = z.object({
  kind: z.enum(['context', 'add', 'del']),
  /** The line's number on the base side; null for an added line. */
  oldLine: z.number().int().min(1).nullable(),
  /** The line's number on the branch side; null for a deleted line. */
  newLine: z.number().int().min(1).nullable(),
  text: z.string().max(2000),
});
export type DiffLine = z.infer<typeof DiffLine>;

export const DiffHunk = z.object({
  oldStart: z.number().int().min(0),
  oldLines: z.number().int().min(0),
  newStart: z.number().int().min(0),
  newLines: z.number().int().min(0),
  lines: z.array(DiffLine),
});
export type DiffHunk = z.infer<typeof DiffHunk>;

export const DiffFile = z.object({
  path: DiffPath,
  /** Where a renamed file was before. */
  oldPath: DiffPath.nullable(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed']),
  /** Git saw a binary file: there are no lines to show or comment on. */
  binary: z.boolean(),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  hunks: z.array(DiffHunk),
});
export type DiffFile = z.infer<typeof DiffFile>;

/** The diff of a task's branch against the branch it started from (`base...branch`). `truncated`: a size or count limit cut it short. */
export const ReviewDiff = z.object({
  base: z.string(),
  branch: z.string(),
  files: z.array(DiffFile),
  truncated: z.boolean(),
});
export type ReviewDiff = z.infer<typeof ReviewDiff>;

/** What kind of comment it is. Only an issue or a suggestion can block; a question asks and does not hold anything up. */
export const ReviewLabel = z.enum(['issue', 'suggestion', 'question']);
export type ReviewLabel = z.infer<typeof ReviewLabel>;

export const REVIEW_BODY_MAX = 2000;
export const REVIEW_CODE_MAX = 4000;
export const REVIEW_COMMENTS_MAX = 30;

export const ReviewComment = z
  .object({
    path: DiffPath,
    /** Which side of the diff the line numbers count on: the base (`old`) or the branch (`new`). */
    side: z.enum(['old', 'new']),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    label: ReviewLabel,
    /** Must be fixed before the work is taken. Only an issue or a suggestion can be blocking. */
    blocking: z.boolean(),
    body: z.string().trim().min(1).max(REVIEW_BODY_MAX),
    /** Code the owner proposes for those lines. */
    suggestedCode: z.string().min(1).max(REVIEW_CODE_MAX).optional(),
  })
  .refine((c) => c.endLine >= c.startLine, { message: 'endLine comes before startLine', path: ['endLine'] })
  .refine((c) => !c.blocking || c.label !== 'question', { message: 'only an issue or a suggestion can be blocking', path: ['blocking'] });
export type ReviewComment = z.infer<typeof ReviewComment>;

/**
 * The owner's word on the code. `approved` takes the branch as it is, with no comments; `annotated` sends it back
 * with at least one. There is no third way and no inference from the comment text.
 */
export const ReviewResult = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approved'), comments: z.array(ReviewComment).length(0) }),
  z.object({ decision: z.literal('annotated'), comments: z.array(ReviewComment).min(1).max(REVIEW_COMMENTS_MAX) }),
]);
export type ReviewResult = z.infer<typeof ReviewResult>;

/** What a submitted review set going: the merge's target branch, or the task that addresses the comments. */
export const ReviewOutcome = z.object({
  reviewId: z.string(),
  decision: z.enum(['approved', 'annotated']),
  blockingCount: z.number().int().min(0),
  /** The branch the work was merged into (`approved`). */
  mergedInto: z.string().nullable(),
  /** The task started to address the comments (`annotated`). */
  rerunTaskId: z.string().nullable(),
});
export type ReviewOutcome = z.infer<typeof ReviewOutcome>;

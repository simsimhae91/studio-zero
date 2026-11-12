import { z } from 'zod';

/**
 * A2UI: the vocabulary an agent has for showing something other than prose.
 *
 * An agent never sends markup or code to a client. It picks blocks from this typed set, the daemon validates
 * them, and the client renders each with a component it already trusts. "Generative UI" here means the agent
 * chooses and fills the widget; it does not get to write one.
 */
export const Confidence = z.enum(['high', 'medium', 'speculative']);
export type Confidence = z.infer<typeof Confidence>;

const short = z.string().min(1).max(200);
const prose = z.string().min(1).max(4000);
const blockId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,40}$/);

export const AxBlock = z.discriminatedUnion('type', [
  /** Prose, in Markdown. For anything a paragraph says best. */
  z.object({ type: z.literal('text'), markdown: z.string().min(1).max(12_000) }),
  /** A question only the owner can settle, with the options laid out. Waits for an answer. */
  z.object({
    type: z.literal('choice'),
    id: blockId,
    question: short,
    options: z.array(z.object({ id: blockId, label: short, detail: z.string().max(600).nullable() })).min(2).max(6),
    recommended: blockId.nullable(),
    confidence: Confidence,
    allowOther: z.boolean(),
  }),
  /** Options against criteria, as a table. */
  z.object({
    type: z.literal('comparison'),
    title: short,
    criteria: z.array(short).min(1).max(8),
    options: z.array(z.object({ label: short, cells: z.array(z.string().max(300)) })).min(2).max(6),
    recommended: short.nullable(),
    confidence: Confidence,
  }),
  /** A few values to set: sliders, toggles, short text. Waits for an answer. */
  z.object({
    type: z.literal('form'),
    id: blockId,
    title: short,
    fields: z
      .array(
        z.object({
          id: blockId,
          label: short,
          kind: z.enum(['text', 'number', 'range', 'toggle', 'select']),
          min: z.number().nullable(),
          max: z.number().nullable(),
          step: z.number().nullable(),
          options: z.array(short).max(12).nullable(),
          value: z.union([z.string().max(400), z.number(), z.boolean()]).nullable(),
        }),
      )
      .min(1)
      .max(8),
    submitLabel: short,
  }),
  /** A Mermaid diagram: flows, sequences, entity relations. */
  z.object({ type: z.literal('diagram'), title: short, mermaid: z.string().min(1).max(6000) }),
  /** A decision on the record: what was chosen, why, and what was turned down and why. */
  z.object({
    type: z.literal('decision'),
    id: blockId,
    question: short,
    chosen: short,
    why: prose,
    rejected: z.array(z.object({ option: short, why: z.string().min(1).max(600) })).max(8),
    confidence: Confidence,
  }),
  /** Where a claim comes from. */
  z.object({
    type: z.literal('sources'),
    title: short,
    // http(s) only: a source is rendered as a link, and a link an agent supplies must not be able to run script.
    items: z.array(z.object({ title: short, url: z.string().url().max(600).regex(/^https?:\/\//i), quote: z.string().max(600) })).min(1).max(30),
  }),
  z.object({ type: z.literal('checklist'), title: short, items: z.array(z.object({ label: short, done: z.boolean() })).min(1).max(20) }),
]);
export type AxBlock = z.infer<typeof AxBlock>;

/** The owner's answer to a `choice` or `form` block. */
export const AxResponse = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), blockId, optionId: blockId.nullable(), other: z.string().max(2000).nullable() }),
  z.object({ kind: z.literal('form'), blockId, values: z.record(blockId, z.union([z.string().max(400), z.number(), z.boolean()])) }),
]);
export type AxResponse = z.infer<typeof AxResponse>;

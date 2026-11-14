import { z } from 'zod';

/**
 * A product as a whole, planned before any of it is built: what a real product of its kind is made of, and the
 * order it is built in. The owner's request names a few features; the map is what a person who downloads the
 * product expects to find. It is written by a model, checked by the daemon, kept in the project as
 * `docs/product.json`, and built one milestone at a time (see `Roadmap`).
 */

/** Where a feature stands in the studio's preview, which is a browser on this Mac. */
export const PreviewStanding = z.enum(['real', 'simulated', 'device-only']);
export type PreviewStanding = z.infer<typeof PreviewStanding>;

export const ProductFeature = z.object({
  /** A short lowercase word or two with hyphens: `matching`, `meal-photo`. A scenario names the feature it walks by this. */
  id: z.string(),
  name: z.string(),
  /** What a person gets from it, in a sentence. */
  why: z.string(),
  /** `core`: the product is not itself without it. `expected`: every product of this kind has it. `delight`: what makes this one worth showing a friend. */
  tier: z.enum(['core', 'expected', 'delight']),
  /** What a person can do with it and what they see, one concrete behaviour a line. */
  does: z.array(z.string()),
  /** The screens it needs, by name. Their ids are given in the screen plan when the feature is built. */
  screens: z.array(z.string()),
  needs: z.object({
    /** What is kept: the tables, in a word each. */
    data: z.array(z.string()).default([]),
    /** What of the device it uses: camera, health, push, location, haptics. */
    device: z.array(z.string()).default([]),
    /** Whether a model answers inside the product (reading a photo, writing advice). */
    ai: z.boolean().default(false),
    /** Outside services it calls, by name. */
    external: z.array(z.string()).default([]),
  }),
  /**
   * `real`: it works in the preview as it will for a user. `simulated`: it is built whole and something stands in
   * for a part the preview does not have (a model nobody connected, a sensor); `simulation` says what stands in and
   * what makes it real. `device-only`: it has no meaning in a browser and is built behind an adapter for the device.
   */
  inPreview: PreviewStanding,
  simulation: z.string().nullable().default(null),
});
export type ProductFeature = z.infer<typeof ProductFeature>;

export const ProductMilestone = z.object({
  id: z.string(),
  name: z.string(),
  /** What a person can do once this milestone is built that they could not before. */
  goal: z.string(),
  /** The ids of the features it builds. Every feature is in exactly one milestone. */
  features: z.array(z.string()),
  /** What has to be true when it is done, each as something a new person does and then sees. */
  acceptance: z.array(z.string()),
});
export type ProductMilestone = z.infer<typeof ProductMilestone>;

export const ProductMap = z.object({
  pitch: z.string(),
  /** What kind of product this is, and which real products it sits beside. */
  category: z.string(),
  /** The few things this product has to be good at. */
  pillars: z.array(z.string()),
  features: z.array(ProductFeature),
  milestones: z.array(ProductMilestone),
});
export type ProductMap = z.infer<typeof ProductMap>;

export const RoadmapState = z.enum(['planning', 'planned', 'running', 'stopped', 'done', 'failed']);
export type RoadmapState = z.infer<typeof RoadmapState>;

export const MilestoneState = z.enum(['planned', 'building', 'built', 'failed']);
export type MilestoneState = z.infer<typeof MilestoneState>;

/** How one milestone of the map stands: the tasks that built it, and what was found on its screens and left. */
export const MilestoneProgress = z.object({
  state: MilestoneState,
  /** The tasks submitted for it, oldest first: one, or more when it was tried again. */
  taskIds: z.array(z.string()),
  error: z.string().nullable(),
  /** Measured defects on its screens that one repair round did not clear: work for the last milestone, said to the owner. */
  debt: z.array(z.string()),
  /** The screens its scenarios stood on, as they looked, newest walk. */
  shots: z.array(z.object({ screen: z.string(), artifactId: z.string() })),
});
export type MilestoneProgress = z.infer<typeof MilestoneProgress>;

/**
 * A project's product map and how far it has been built. One a project. `planning`: the map is being written.
 * `planned`: it is written and nothing is being built. `running`: its milestones are being built one after
 * another, each an ordinary task. `stopped`: a milestone failed or the owner stopped it; running it again goes
 * on from there. `done`: every milestone is built. `failed`: no map that holds could be written.
 */
export const Roadmap = z.object({
  projectId: z.string(),
  /** The owner's words the map was written from. */
  request: z.string(),
  state: RoadmapState,
  map: ProductMap.nullable(),
  /** One entry a milestone of the map, in its order. Empty until the map is written. */
  milestones: z.array(MilestoneProgress),
  /** Whether a milestone that passed its checks is merged before the next starts. Otherwise the next starts from its branch. */
  autoMerge: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Roadmap = z.infer<typeof Roadmap>;

# Product Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A product built in the studio is planned as a whole product (a product map), built milestone by milestone until the map is built, and every feature of it is walked and every screen walked is measured.

**Architecture:** A daemon model call writes `docs/product.json` (features in milestones), checked by daemon code. A `RoadmapRunner` turns each milestone into an ordinary fast-track `build` task with a milestone brief, merges it when its gates pass and starts the next. The harness adds two checks to a milestone task: every built feature has a scenario that walks it, and every screen a scenario stands on is measured.

**Tech Stack:** TypeScript run by Node 24 (erasable syntax), zod contracts in `packages/protocol`, node:sqlite, node:test, playwright-core for the browser checks.

**Spec:** `docs/superpowers/specs/2026-11-15-product-depth-design.md`

## Global Constraints

- Every side effect is a typed Action with a rule: `roadmap.configure` (owner only; agent and system denied).
- System prompts are constants in `harness/prompts.ts`; nothing is concatenated into them. The owner's request and the model-written map travel in the user turn.
- Limits copied from the spec: features ≥ 6; milestones 3 to 12; features per milestone ≤ 4; `does` ≥ 2 lines per feature; `acceptance` ≥ 1 line per milestone; scenarios ≤ 30 where the project has a product map (6 elsewhere).
- A roadmap never runs on Studio Zero Core.
- Korean interface copy passes the copy lint; the daemon's messages to the owner are Korean, to engines English.
- Migrations are forward only: 18 adds `roadmaps` and `tasks.milestone`.

## Review Focus

- A map whose milestones name a feature that does not exist, or leave a feature out: refused with the feature's id.
- A milestone task that succeeds and whose merge is refused (the base moved, a re-verification failed): the roadmap stops with the reason and the task's branch is kept.
- The daemon restarts while a milestone is building: the roadmap goes on from that task's result, and no milestone is submitted twice.
- An engine that builds a milestone and writes no scenario for one of its features: sent back naming the feature, not accepted.
- A screen with a measured blocker after its one repair round: the milestone still passes, and the finding is on the roadmap as debt.

---

### Task 1: The product map

**Files:**
- Create: `packages/protocol/src/product.ts`, `packages/daemon/src/product/ProductMap.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/daemon/test/product-map.test.ts`

**Interfaces:**
- Produces: `ProductMap`, `ProductFeature`, `ProductMilestone` (zod, in protocol). `readProductMap(input: unknown): { ok: true; map: ProductMap } | { ok: false; problems: string[] }`, `renderProductMap(map: ProductMap): string` (Markdown, Korean headings), `PRODUCT_MAP_FILE = 'docs/product.json'`, `PRODUCT_DOC_FILE = 'docs/product.md'`.

- [x] Write tests: a sound map reads; each rule of the spec's list refuses with a sentence naming the feature or milestone; rendering is stable (same map, same text).
- [x] Implement, run `node --test packages/daemon/test/product-map.test.ts`, commit.

### Task 2: Planning a map

**Files:**
- Create: `packages/daemon/src/product/planner.ts`
- Modify: `packages/daemon/src/harness/prompts.ts` (`PRODUCT_MAP_PROMPT`)
- Test: `packages/daemon/test/product-map.test.ts`

**Interfaces:**
- Consumes: `ClaudeClient.structured`, `readProductMap`.
- Produces: `planProductMap(deps: { claude; scope }, input: { request: string; template: Template; connected: string[]; existing: string | null; signal? }): Promise<ProductMap>`: one call, and one more with the problems when the first map does not hold; throws with the problems when the second does not either.

- [x] Test with a scripted model: a bad first map is sent back with its problems in the user turn and the system prompt is the constant; two bad maps throw.
- [x] Implement, commit.

### Task 3: Roadmap storage, policy, RPC

**Files:**
- Modify: `packages/protocol/src/product.ts` (`Roadmap`), `rpc.ts`, `events.ts`, `domain.ts` (`Task.milestone`), `packages/daemon/src/db/schema.ts` (migration 18), `db/Store.ts`, `policy/actions.ts`, `policy/PolicyEngine.ts`, `server/handlers.ts`
- Test: `packages/daemon/test/roadmap.test.ts`

**Interfaces:**
- Produces: `Roadmap { projectId, request, state: 'planning'|'planned'|'running'|'stopped'|'done'|'failed', map: ProductMap | null, milestones: { state: 'planned'|'building'|'built'|'failed'; taskIds: string[]; error: string | null; debt: string[]; shots: { screen: string; artifactId: string }[] }[], autoMerge, error, createdAt, updatedAt }`. Store: `getRoadmap`, `putRoadmap`, `listRoadmapsInState`. RPC `roadmap.get | plan | run | stop`. Event `roadmap.changed { state, milestone: number | null, milestoneState: string | null, name: string | null }`.

- [x] Tests: policy (owner allowed, agent and system denied), store round trip, migration on a copy of a version-17 database.
- [x] Implement, commit.

### Task 4: The runner

**Files:**
- Create: `packages/daemon/src/app/RoadmapRunner.ts`, `packages/daemon/src/product/brief.ts`
- Modify: `app/Studio.ts`, `app/compose.ts`, `relay/RelayCore.ts`, `cli.ts`
- Test: `packages/daemon/test/roadmap.test.ts`

**Interfaces:**
- Consumes: `planProductMap`, `Studio.submitTask`, `Studio.merge`, events.
- Produces: `RoadmapRunner.plan(projectId, request)`, `.run(projectId, opts)`, `.stop(projectId)`, `.start()` (boot recovery), `milestoneRequest(map, index, earlier?: { branch: string; error: string | null }): string` whose first line is `마일스톤 k/n: <name>`.

- [x] Tests (scripted model and engine, real harness, queue, store, git emulator): map → milestone 1 → merged → milestone 2 → done; a failed milestone stops the roadmap and `run` again starts from the failed branch; a restart in the middle goes on without a second submission; `--no-merge` chains by base branch.
- [x] Implement, commit.

### Task 5: The milestone brief and the coverage gate

**Files:**
- Create: `packages/daemon/src/product/coverage.ts`
- Modify: `harness/prompts.ts` (`MILESTONE_BRIEF`), `harness/Harness.ts`, `scratch/ScreenSpec.ts` (scenario `feature`, the limit), `packages/protocol/src/domain.ts`
- Test: `packages/daemon/test/product-map.test.ts`, `roadmap.test.ts`

**Interfaces:**
- Produces: `uncovered(map: ProductMap, spec: ScreenSpec, upTo: number): string[]` (one sentence per feature with no scenario). A milestone task's first message carries `MILESTONE_BRIEF` in place of `DRAFT_BRIEF`; its verify fails with `coverage` when `uncovered` is not empty; `docs/product.json` and `docs/product.md` are in the workspace before the engine starts.

- [x] Tests: coverage sentences; a milestone task whose engine leaves a feature unwalked is sent back with that sentence and passes once the scenario is there; the brief is in the first message and the draft brief is not.
- [x] Implement, commit.

### Task 6: Measuring what is walked

**Files:**
- Modify: `qa/ScenarioRunner.ts`, `harness/Harness.ts`
- Test: `packages/daemon/test/scenarios.test.ts`

**Interfaces:**
- Produces: `ScenarioOutcome.looks: { screen: string; scenario: string; findings: Finding[]; png: Buffer | null }[]`, one per screen id, taken after the step that stands on it. In a milestone task, blockers and majors found there fail one verify round (`screens`), then become the milestone's `debt`.

- [x] Test in real Chrome: a product whose second screen has unreadable text is found at that screen; a clean one has no finding; one look per screen.
- [x] Implement, commit.

### Task 7: Run it for real

- [x] Deploy. Create the project, plan the map from the owner's example, read the map, run the roadmap to its end, fixing what the first real run shows in the studio.
- [x] Record: milestones passed, features and screens walked, what stayed simulated, time and tokens. Put the numbers beside the two earlier builds in `docs/ARCHITECTURE.md`.

### Task 8: The roadmap tab (through the studio)

- [x] `sz kirby`-free: submit as a Core task with `--plan`: `views/panels/Roadmap.tsx`, tab, demo data, audit screens, built the way `PlanReview.tsx` and `Changes.tsx` are. Review, look at it in `?demo`, merge.

---

## What happened (2026-11-15)

All eight tasks are done. Differences from the plan as written:

- Task 4: a milestone whose checks still fail is retried once by the runner from its branch before the roadmap stops (the plan had it stop at once). The next attempt is handed what the last failing check said.
- Task 5: a plan whose scenarios name features is read as a product's plan by every reader (the plan had the wide limits only for the milestone task). Screens: 90.
- Task 6: the look is taken after every press and before the first, named by the screen's own `data-screen` mark; the core screen and the door are held to first-screen rules; debt stays on the milestone that found it and is handed to the last one. Gate name `looks` (the plan said `screens`, which was taken).
- Task 7: the run and what it changed are in `docs/runs/2026-11-15-diet-battle/README.md`. Added because of it: plan-shape problems said in one reading and not charged to corrections, 24 presses a step, the sample photo for file choosers, the `walk_scenario` tool, a lean walk.
- Task 8: built directly, not as a Core task, so that two engines would not draw on the same subscription during the run.

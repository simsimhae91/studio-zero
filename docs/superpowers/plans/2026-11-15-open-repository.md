# Open Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project's repository opens to the owner's Mac through git (a gate they clone from and push to), an existing checkout becomes a studio project through that gate, and an agent-instructions block keeps outside sessions to the studio's contract.

**Architecture:** A bare repository per project on the host mirrors the container repository's branches; a `pre-receive` hook hands a push to the daemon, which takes it into the container under the landing lock or refuses it. A project carries `root` (the product's folder inside its repository) and `adopted` (where it came from); the sandbox layer resolves the working folder from `root` the way it resolves a slot. Adopted projects keep their own design: house files, slop lint and the full track are left out, and a task of kind `adopt` makes the product walkable.

**Tech Stack:** TypeScript (Node 24, `node:test`), git, SQLite, React (desktop).

**Spec:** `docs/superpowers/specs/2026-11-15-open-repository-design.md`

## Global Constraints

- The integration branch is `main` everywhere inside the studio (`INTEGRATION_BRANCH`).
- The gate holds `refs/heads/*` only; `refs/sz/*` never leaves the container.
- The Core project (`prj_core`) has no gate and cannot be adopted into.
- Objects that come out of a sandbox are fetched with `fetch.fsckObjects=true`.
- Nothing is written into an adopted checkout but one git remote named `studio`.
- `projects.adopt` and `repo.receive` are allowed to `actor.type === 'owner' && actor.via === 'desktop'` only.
- Heavy tasks' path for house projects is not changed. Test daemons keep `slots.perProject: 0` unless a test asks.
- User-facing text is Korean; code, comments, prompts and commit messages are English. No em-dashes.
- Subagents, if any, run on `opus` or `sonnet`, set explicitly.

## Review Focus

1. A push that races a landing: main must move once, and the loser is refused with a reason. (Task 4: `a push that arrives while main is being moved waits its turn`.)
2. A product folder with a space or a leading dash in its name must be refused at adoption, not quoted wrongly later. (Task 5: `root` pattern.)
3. A change outside the product folder must not be judged by imports: scope `all`. (Task 2: `scopeOf` test.)
4. A gate that is behind the container (daemon was down when a task ended) must not accept a push on a stale `old`. (Task 4.)
5. An adopted project must never get house files committed to it by the provisioner. (Task 5.)

---

## File map

| File | Responsibility |
|---|---|
| `packages/protocol/src/domain.ts` | `Project.root`, `Project.adopted`, `TaskKind` + `adopt`, `RepoStatus`, `RepoUpdate` |
| `packages/protocol/src/events.ts` | `repo.received`, `repo.published` |
| `packages/protocol/src/rpc.ts` | `repo.open`, `repo.status`, `repo.receive`, `projects.adopt` |
| `packages/daemon/src/db/schema.ts`, `Store.ts` | migration 20: `projects.root`, `projects.adopted_json` |
| `packages/daemon/src/config.ts` | `repos: { dir, checkOnPush, maxPackMb }`; route for `adopt` |
| `packages/daemon/src/sandbox/OrbStackManager.ts` | `productDir(place)`, `resolveInProject` |
| `packages/daemon/src/sandbox/scripts.ts` | `changedFilesScript` at the top level, `depsScript`, `slotDepsScript` with product dirs, `gateOutScript`, `packInScript`, `receiveScript` |
| `packages/daemon/src/repo/Gate.ts` | the gate: `open`, `publish`, `receive`, `status`, hook files |
| `packages/daemon/src/repo/Adoption.ts` | reading a checkout: `inspect`, `detectStack`, `import` |
| `packages/daemon/src/repo/agentFile.ts` | `agentBlock`, `withBlock`, `AGENT_FILE`, `CLAUDE_FILE` |
| `packages/daemon/src/harness/bootstrap.ts` | adopted branch of provisioning; agent file for house projects |
| `packages/daemon/src/harness/prompts.ts` | `ADOPTED_SYSTEM_PROMPT`, `ADOPT_BRIEF`, `codingSystemPrompt(project)` |
| `packages/daemon/src/harness/Harness.ts` | `adopt` kind: brief, verify with look, remembered walk, agent file |
| `packages/daemon/src/app/Studio.ts` | `adoptProject`, `repoOpen`, `repoStatus`, `repoReceive`, track forcing and refusals |
| `packages/daemon/src/cli.ts` | `sz adopt`, `sz fit`, `sz clone`, `sz repo`, hidden `sz gate-receive` |
| `apps/desktop/src/…` | adopt dialog, repository panel, labels, demo data, audit screens |

## Interfaces (shared by the tasks)

```ts
// protocol/domain.ts
Project.root: string                       // '' or a relative folder, /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*){0,3}$/
Project.adopted: { path: string; base: string } | null
TaskKind: … | 'adopt'
RepoUpdate = { ref: string; old: string; new: string }          // 40-hex, zeros for none
RepoStatus = { open: boolean; path: string | null; cloneCommand: string | null; branches: { name: string; commit: string; subject: string; at: number }[]; adopted: Project['adopted']; root: string; planned: boolean }

// events
{ type: 'repo.received'; branch: string; old: string | null; new: string | null; commits: number }
{ type: 'repo.published'; branches: number }

// rpc
'repo.open':    { projectId } -> RepoStatus
'repo.status':  { projectId } -> RepoStatus
'repo.receive': { projectId, updates: RepoUpdate[], pack: string | null } -> { accepted: boolean; lines: string[] }
'projects.adopt': { path, dir?: string, base?: string, name?: string, slug?: string } -> { project: Project; gate: string; remote: 'added' | 'kept' | 'differs'; base: string; uncommitted: number; lines: string[] }

// sandbox/OrbStackManager.ts
productDir(place: Place): string            // WORKSPACE_DIR or `${WORKSPACE_DIR}/${root}`
resolveInProject(place: Place, path: string): string   // relative to productDir, confined to WORKSPACE_DIR

// repo/Gate.ts
class Gate {
  constructor(deps: { config; store; events; sandboxes; landing: Slots['landing']; log; run?: CommandRunner; hook?: { node: string; cli: string } })
  pathOf(project): string
  isOpen(project): boolean
  open(project): Promise<void>               // create + hooks + publish
  publish(project): Promise<number>          // branches moved; 0 when the gate is not open
  seed(project, from: { repo: string; base: string }): Promise<string>   // host fetch into the gate's main; returns the commit
  fill(project): Promise<void>               // the gate's main into an empty container repository
  receive(project, updates, packPath): Promise<{ accepted: boolean; lines: string[]; mainMoved: { old: string; new: string } | null }>
  branches(project): Promise<RepoStatus['branches']>
  forget(project): Promise<void>
}

// repo/Adoption.ts
inspect(run, path, opts: { dir?, base? }): Promise<{ repo: string; base: string; commit: string; root: string; template: Template; name: string; uncommitted: number }>   // throws ConflictError with the reason
detectStack(pkg: unknown): Template | null

// repo/agentFile.ts
agentBlock(facts: { slug: string; root: string; adopted: boolean; planned: boolean; backend: boolean }): string
withBlock(existing: string, block: string): string
```

---

### Task 1: Protocol, storage, config

**Files:** `packages/protocol/src/{domain,events,rpc}.ts`, `packages/daemon/src/db/{schema,Store}.ts`, `packages/daemon/src/config.ts`, test `packages/daemon/test/open-repository.test.ts`

- [x] Test: `migration 20 gives every project an empty root and no origin`; `a project keeps its root and where it was adopted from`.
- [x] Add the shapes above; migration 20 (`ALTER TABLE projects ADD COLUMN root TEXT NOT NULL DEFAULT ''`, `ADD COLUMN adopted_json TEXT`); `toProject`, `insertProject`; config `repos` (`dir` default `<dataDir>/repos`, `checkOnPush` true, `maxPackMb` 512); `EngineKind` keeps `adopt` with the build route.
- [x] Typecheck, test, commit.

### Task 2: The product folder

**Files:** `sandbox/OrbStackManager.ts`, `sandbox/scripts.ts`, `sandbox/Slots.ts`, `harness/Harness.ts` (changed files → product-relative), `product/scope.ts`, `arms/ProjectArms.ts` (`.git/info/exclude` by `git rev-parse --git-path`), tests `open-repository.test.ts`, `scope.test.ts`

- [x] Test: `a command of a project with a root runs in its product folder, and git scripts in the repository`; `a file tool path is relative to the product folder and may reach the rest of the repository but not leave it`; `a change outside the product folder is walked for in full`; `a slot of a project with a root installs in the product folder`.
- [x] `productDir`, `resolveInProject` used by `exec`, `readFile`, `writeFile`, `startProcess`; `changedFilesScript` at the top level + `toProduct(root, file)`; `scopeOf`: a non-document path starting `../` gives `all`; `slotDepsScript({ workspace, main })` given product dirs, marker at `$(git rev-parse --git-dir)/sz-deps`; `depsScript({ workspace })` for a project's own workspace (marker `node_modules/.sz-lock`).
- [x] Full suite, commit.

### Task 3: The gate, outward

**Files:** `repo/Gate.ts`, `sandbox/scripts.ts` (`gateOutScript`), `app/compose.ts`, test `gate.test.ts`

- [x] Test (real git): `opening a gate mirrors every branch and no checkpoint ref`; `a branch that moved or went away is moved or removed at the gate`; `a gate that is not open is not written`; `the Core project has no gate`.
- [x] `Gate.open/publish/branches/isOpen/pathOf/forget`; hook file written on open and at boot for gates that exist; publish on `task.state` (terminal, parked, suspended), `task.landed`, `git.merged`, `checkpoint.restored` through an event subscriber, serialised per project.
- [x] Commit.

### Task 4: The gate, inward

**Files:** `repo/Gate.ts` (`receive`), `sandbox/scripts.ts` (`packInScript`, `receiveScript`), `app/Studio.ts` (`repoReceive`, after-main steps), `policy`, `server/handlers.ts`, `cli.ts` (`gate-receive`, `clone`, `repo`), test `gate.test.ts`

- [x] Test (real `git push` through the hook into a test daemon): `a push to main that goes forward is in the container when git says it was pushed`; `a push to main that does not go forward is refused and nothing moves`; `a new branch is taken, and one a task at work holds is refused`; `main cannot be deleted and a tag is not taken`; `a gate that is behind is brought up and the push refused`; `a push with the daemon down is refused`; `after a push to main a full check is queued once`; `a push that arrives while main is being moved waits its turn`.
- [x] Hook → `sz gate-receive <projectId>`: reads updates, packs new objects (`git pack-objects --revs --stdout`) into `<gate>/sz-incoming/`, calls `repo.receive`, prints lines, exits 0 or 1.
- [x] `Studio.repoReceive`: policy, landing lock, `Gate.receive`, then for main: deps, schema, preview, check.
- [x] Commit.

### Task 5: Adoption

**Files:** `repo/Adoption.ts`, `repo/Gate.ts` (`seed`, `fill`), `app/Studio.ts` (`adoptProject`, forcing and refusals), `harness/bootstrap.ts`, `harness/EvalRunner.ts` (`seed`), `cli.ts` (`adopt`), tests `adoption.test.ts`

- [x] Test: `detectStack` table; `a checkout whose product is one folder down is found there, and two candidates are refused`; `adoption takes the base branch as main, adds the remote, and leaves the working tree alone`; `an adopted project gets no house file and no slop lint`; `a build on an adopted project runs on the fast track, and a design task is refused`; `a root with a space is refused`.
- [x] Implement; commit.

### Task 6: Fitting and the agent file

**Files:** `harness/prompts.ts`, `harness/Harness.ts`, `repo/agentFile.ts`, `harness/bootstrap.ts`, `cli.ts` (`fit`), tests `adoption.test.ts`, `agent-file.test.ts`

- [x] Test: `withBlock` replaces only its block and appends when there is none; `agentBlock` names the product folder, the plan and the remote; `a fit task is told what a fit is and not how to start a product`; `a fit task's walk writes the project's first trails and ledger and is not sent back for what it measured`; `a fit task leaves AGENTS.md with the block on its branch`; `a house project gets the agent file with its other studio files`.
- [x] Implement; commit.

### Task 7: Desktop

**Files:** `apps/desktop/src/…` (found at execution: new-project dialog, project header, task kind labels, activity lines, demo data, audit screen list)

- [ ] Adopt dialog (path, folder, name), repository panel (gate path, clone command, branches, origin, "스튜디오에 맞추기"), labels for `adopt` and `repo.received`, demo project `credeal-demo`, audit screens `adopt-dialog`, `repo-panel`, `adopted-unfit`.
- [ ] Desktop audit: 0 blocker, 0 major. Commit.

### Task 8: Document, deploy, run for real

- [ ] ARCHITECTURE.md §23, README commands.
- [ ] Idle check, DB backup, build, restart.
- [ ] `diet-battle-lab`: open the gate, clone, push a hand-made commit, see the check queued.
- [ ] `credeal`: adopt, then fit on the owner's subscription; fetch the branch through the gate.
- [ ] Run record `docs/runs/2026-11-15-open-repository/README.md`; commit.

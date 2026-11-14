import type { MilestoneProgress, Project, Roadmap, Task } from '@studio-zero/protocol';
import type { Store } from '../db/Store.ts';
import type { EventLog } from '../events/EventLog.ts';
import type { ClaudeClient } from '../llm/ClaudeClient.ts';
import type { Actor } from '../policy/actions.ts';
import { milestoneRequest } from '../product/brief.ts';
import { planProductMap } from '../product/planner.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { SCREEN_SPEC_FILE, readScreenSpec, renderScreenSpec } from '../scratch/ScreenSpec.ts';
import { errorMessage, type Clock, type Logger } from '../util/core.ts';
import { ConflictError, NotFoundError } from './errors.ts';
import type { ExternalApis } from './ExternalApis.ts';
import type { Studio } from './Studio.ts';

/**
 * Who a milestone's task is submitted as, and who its merge is made by. A roadmap is set going only by the owner
 * (`roadmap.configure`), who chose there whether what passes is merged: each task and each merge is theirs, as a
 * scheduled run is.
 */
const OWNER: Actor = { type: 'owner', via: 'desktop' };

/**
 * How many times a milestone whose checks still failed is tried again by the runner itself, from what the attempt
 * left, before the roadmap stops and waits for the owner. A roadmap runs for hours with nobody at the desk, and a
 * milestone that ran out of corrections is most often one more round from done. Once, so a milestone that cannot
 * be built does not spend the night trying.
 */
const AUTO_RETRIES = 1;

const fresh = (): MilestoneProgress => ({ state: 'planned', taskIds: [], error: null, debt: [], shots: [] });

/**
 * Builds a product to the end of its map (see the design, docs/superpowers/specs/2026-11-15-product-depth-design.md).
 *
 * A build used to be one task: one screen that works, or once, a whole product in one sitting of which a third
 * worked. A roadmap is the product planned whole and built in slices: each milestone of the map is an ordinary
 * task, held to everything a task is held to and to its features being walked, and the next one starts only
 * when it has passed. Nothing here builds or checks anything itself.
 *
 * The state is the roadmap's row. A milestone is `building` from the moment its task is submitted until that
 * task has wholly ended (the queue says when: a task's `succeeded` is said while the harness is still writing
 * its receipt), so a restart in the middle finds the task and goes on from its result, and submits nothing twice.
 */
export class RoadmapRunner {
  readonly #store: Store;
  readonly #events: EventLog;
  readonly #claude: Pick<ClaudeClient, 'structured'>;
  readonly #studio: Pick<Studio, 'submitTask' | 'merge'>;
  readonly #external: Pick<ExternalApis, 'list'>;
  readonly #sandboxes: Pick<OrbStackManager, 'exec'>;
  readonly #clock: Clock;
  readonly #log: Logger;
  /** One thing at a time a project: a task ending and the owner pressing run do not interleave. */
  readonly #turn = new Map<string, Promise<unknown>>();
  readonly #writing = new Set<Promise<void>>();

  constructor(deps: { store: Store; events: EventLog; claude: Pick<ClaudeClient, 'structured'>; studio: Pick<Studio, 'submitTask' | 'merge'>; external: Pick<ExternalApis, 'list'>; sandboxes: Pick<OrbStackManager, 'exec'>; clock: Clock; log: Logger }) {
    this.#store = deps.store;
    this.#events = deps.events;
    this.#claude = deps.claude;
    this.#studio = deps.studio;
    this.#external = deps.external;
    this.#sandboxes = deps.sandboxes;
    this.#clock = deps.clock;
    this.#log = deps.log;
  }

  /** At boot: a map that was being written when the daemon stopped is said to have failed, and roadmaps that were running go on. */
  start(): void {
    for (const roadmap of this.#store.listRoadmaps('planning')) this.#save({ ...roadmap, state: 'failed', error: '지도를 쓰는 중에 데몬이 다시 시작됐습니다. 다시 만들어 주세요.' }, null);
    for (const roadmap of this.#store.listRoadmaps('running')) void this.#inTurn(roadmap.projectId, () => this.#advance(roadmap.projectId));
  }

  /** Waits for a map that is being written, and for whatever a project's turn is doing. For shutdown and for tests. */
  async idle(): Promise<void> {
    while (this.#writing.size > 0 || this.#turn.size > 0) await Promise.allSettled([...this.#writing, ...this.#turn.values()]);
  }

  get(projectId: string): Roadmap | null {
    return this.#store.getRoadmap(projectId);
  }

  /** Has the project's product map written from the owner's words. Returns at once, `planning`; `roadmap.changed` says when it is there. */
  plan(project: Project, request: string): Roadmap {
    const current = this.#store.getRoadmap(project.id);
    if (current?.state === 'planning') throw new ConflictError('이 프로젝트의 제품 지도를 쓰고 있습니다.');
    if (current?.state === 'running') throw new ConflictError('로드맵을 짓는 중입니다. 멈춘 뒤에 지도를 다시 만들 수 있습니다.');
    if (current?.milestones.some((m) => m.state === 'built')) throw new ConflictError('이 지도의 마일스톤이 이미 지어졌습니다. 지도를 다시 쓰면 무엇이 지어졌는지 알 수 없게 됩니다. 남은 마일스톤을 이어 지어 주세요.');
    const now = this.#clock();
    const roadmap = this.#save({ projectId: project.id, request: request.trim(), state: 'planning', map: null, milestones: [], autoMerge: true, error: null, createdAt: now, updatedAt: now }, null);
    const writing = this.#write(project, roadmap).finally(() => this.#writing.delete(writing));
    this.#writing.add(writing);
    return roadmap;
  }

  async #write(project: Project, roadmap: Roadmap): Promise<void> {
    try {
      const map = await planProductMap({ claude: this.#claude, scope: { projectId: project.id, taskId: null } }, { request: roadmap.request, template: project.template === 'studio-core' ? 'web-vite-react' : project.template, connected: this.#external.list(project.id).map((api) => api.name), existing: await this.#existing(project) });
      this.#save({ ...roadmap, state: 'planned', map, milestones: map.milestones.map(fresh) }, null);
    } catch (err) {
      this.#log.warn({ projectId: project.id, err: errorMessage(err) }, 'the product map could not be written');
      this.#save({ ...roadmap, state: 'failed', error: errorMessage(err) }, null);
    }
  }

  /** What the project's screen plan says is there already, for a map planned on a product that has a first build. */
  async #existing(project: Project): Promise<string | null> {
    const res = await this.#sandboxes.exec(project, `[ -f ${SCREEN_SPEC_FILE} ] && head -c 262144 ${SCREEN_SPEC_FILE}`, { timeoutSec: 20, maxOutputBytes: 300_000 }).catch(() => null);
    if (!res || res.exitCode !== 0 || res.stdout.trim() === '') return null;
    const spec = readScreenSpec(res.stdout);
    return spec.ok ? renderScreenSpec(spec.spec, 6000) : null;
  }

  /**
   * Builds the map's milestones one after another. On a roadmap that stopped, goes on from the milestone that
   * stopped it, starting from the work its last task left.
   */
  run(projectId: string, opts: { autoMerge?: boolean } = {}): Promise<Roadmap> {
    return this.#inTurn(projectId, async () => {
      const roadmap = this.#require(projectId);
      if (roadmap.state === 'planning') throw new ConflictError('제품 지도를 아직 쓰는 중입니다.');
      if (roadmap.map === null) throw new ConflictError(`지을 지도가 없습니다${roadmap.error ? `: ${roadmap.error}` : '.'} 지도를 먼저 만들어 주세요.`);
      if (roadmap.state === 'done') throw new ConflictError('이 지도의 마일스톤은 모두 지어졌습니다.');
      const milestones = roadmap.milestones.map((m) => (m.state === 'failed' ? { ...m, state: 'planned' as const } : m));
      this.#save({ ...roadmap, state: 'running', error: null, milestones, autoMerge: opts.autoMerge ?? roadmap.autoMerge }, null);
      await this.#advance(projectId);
      return this.#require(projectId);
    });
  }

  /** Starts no further milestone. The one being built is left to finish, and is recorded (and merged) when it does. */
  stop(projectId: string): Promise<Roadmap> {
    return this.#inTurn(projectId, async () => {
      const roadmap = this.#require(projectId);
      if (roadmap.state !== 'running') throw new ConflictError('짓고 있는 로드맵이 아닙니다.');
      return this.#save({ ...roadmap, state: 'stopped', error: '소유자가 멈췄습니다.' }, null);
    });
  }

  /** The queue's word that a task has wholly ended: its verdict is in, its receipt written, its workspace still. */
  taskSettled(taskId: string): void {
    const task = this.#store.getTask(taskId);
    if (!task || task.milestone === null || task.milestone === undefined) return;
    void this.#inTurn(task.projectId, () => this.#taken(task)).catch((err: unknown) => this.#log.error({ taskId, err: errorMessage(err) }, 'a milestone\'s result could not be recorded'));
  }

  /** What became of a milestone's task. Ending for a while (a usage limit) is not an end: the task comes back and settles again. */
  async #taken(task: Task): Promise<void> {
    const roadmap = this.#store.getRoadmap(task.projectId);
    const index = task.milestone ?? -1;
    const progress = roadmap?.milestones[index];
    if (!roadmap?.map || !progress || progress.state !== 'building' || progress.taskIds.at(-1) !== task.id) return;
    if (task.state !== 'succeeded' && task.state !== 'failed' && task.state !== 'cancelled') return;
    const name = roadmap.map.milestones[index]!.name;
    const put = (change: Partial<MilestoneProgress>, whole: Partial<Roadmap> = {}): Roadmap =>
      this.#save({ ...this.#require(task.projectId), ...whole, milestones: this.#require(task.projectId).milestones.map((m, i) => (i === index ? { ...m, ...change } : m)) }, index);

    if (task.state === 'failed' && roadmap.state === 'running' && /^verification still failing/.test(task.error ?? '') && progress.taskIds.length <= AUTO_RETRIES) {
      this.#log.info({ projectId: task.projectId, milestone: index, taskId: task.id }, 'a milestone ran out of corrections: trying it once more from its branch');
      put({ state: 'planned', error: task.error });
      await this.#advance(task.projectId);
      return;
    }
    if (task.state !== 'succeeded') {
      const why = task.state === 'cancelled' ? '취소됐습니다' : `실패했습니다: ${task.error ?? '알 수 없는 오류'}`;
      put({ state: 'failed', error: task.error ?? task.state }, { state: 'stopped', error: `마일스톤 ${index + 1} "${name}"이 ${why}` });
      return;
    }
    if (roadmap.autoMerge && task.branch) {
      try {
        await this.#studio.merge(OWNER, task.projectId, task.branch);
      } catch (err) {
        put({ state: 'failed', error: `검사는 통과했고 합치지 못했습니다: ${errorMessage(err)}` }, { state: 'stopped', error: `마일스톤 ${index + 1} "${name}"을 합치지 못했습니다: ${errorMessage(err)}` });
        return;
      }
    }
    put({ state: 'built', error: null });
    await this.#advance(task.projectId);
  }

  /** Submits the next milestone's task, or says the map is built. Does nothing while a milestone is being built or the roadmap is not running. */
  async #advance(projectId: string): Promise<void> {
    const roadmap = this.#store.getRoadmap(projectId);
    if (!roadmap?.map || roadmap.state !== 'running') return;
    const index = roadmap.milestones.findIndex((m) => m.state !== 'built');
    if (index < 0) {
      this.#save({ ...roadmap, state: 'done', error: null }, null);
      return;
    }
    const progress = roadmap.milestones[index]!;
    if (progress.state === 'building') {
      // Found so at boot: its task ended while the daemon was down, or is in the queue again and will settle.
      const task = this.#store.getTask(progress.taskIds.at(-1) ?? '');
      if (task) await this.#taken(task);
      return;
    }
    // Tried before: go on from what that attempt left. Not merging: go on from the milestone before.
    const last = (at: number): Task | null => this.#store.getTask(roadmap.milestones[at]?.taskIds.at(-1) ?? '');
    const earlier = last(index);
    const base = earlier?.branch ?? (roadmap.autoMerge || index === 0 ? null : (last(index - 1)?.branch ?? null));
    const prompt = milestoneRequest(roadmap.map, index, earlier?.branch ? { branch: earlier.branch, error: this.#whatStopped(earlier, progress.error) } : undefined);
    let task: Task;
    try {
      task = await this.#studio.submitTask(OWNER, { projectId, kind: 'build', prompt, track: 'fast', milestone: index, ...(base ? { baseBranch: base } : {}) }, 'system');
    } catch (err) {
      this.#save({ ...roadmap, state: 'stopped', error: `마일스톤 ${index + 1}의 작업을 시작하지 못했습니다: ${errorMessage(err)}` }, index);
      return;
    }
    // Read again: the submission was awaited, and the row is written whole.
    const now = this.#require(projectId);
    this.#save({ ...now, milestones: now.milestones.map((m, i) => (i === index ? { ...m, state: 'building', taskIds: [...m.taskIds, task.id], error: null } : m)) }, index);
  }

  /**
   * Why an attempt stopped, for the attempt that follows it: its error, and what the last check that failed said.
   * The next engine starts with no memory of the last one; without this it finds the same failure by building again.
   */
  #whatStopped(task: Task, recorded: string | null): string | null {
    const failed = this.#events
      .history({ taskId: task.id }, 0, 10_000)
      .flatMap((e) => (e.body.type === 'gate.result' && !e.body.passed ? [e.body] : []))
      .at(-1);
    const error = recorded ?? task.error;
    if (!failed) return error;
    return `${error ?? 'stopped'}\nThe last check that failed (${failed.gate}) said:\n${failed.detail}`;
  }

  #require(projectId: string): Roadmap {
    const roadmap = this.#store.getRoadmap(projectId);
    if (!roadmap) throw new NotFoundError(`a roadmap for project ${projectId}`);
    return roadmap;
  }

  /** Writes the roadmap and says it changed; `milestone` is the one the change is about, if it is one's. */
  #save(roadmap: Roadmap, milestone: number | null): Roadmap {
    const saved = this.#store.putRoadmap({ ...roadmap, updatedAt: this.#clock() });
    const progress = milestone === null ? null : (saved.milestones[milestone] ?? null);
    this.#events.emit({ projectId: saved.projectId, taskId: null }, { type: 'roadmap.changed', state: saved.state, milestone: progress ? milestone : null, milestoneState: progress?.state ?? null, name: progress && milestone !== null ? (saved.map?.milestones[milestone]?.name ?? null) : null });
    return saved;
  }

  #inTurn<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    const next = (this.#turn.get(projectId) ?? Promise.resolve()).then(work, work);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.#turn.set(projectId, settled);
    void settled.then(() => {
      if (this.#turn.get(projectId) === settled) this.#turn.delete(projectId);
    });
    return next;
  }
}

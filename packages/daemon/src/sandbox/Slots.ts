import type { Project } from '@studio-zero/protocol';
import type { Config } from '../config.ts';
import { KeyedMutex, type Clock } from '../util/core.ts';
import { SandboxError, SLOT_MAIN_DIR, slotOf, type OrbStackManager, type Place } from './OrbStackManager.ts';
import { INTEGRATION_BRANCH, bundleInScript, bundleOutScript, rebaseOntoScript, slotDepsScript, syncSlotScript } from './scripts.ts';
import { WORKSPACE_DIR } from '../policy/PolicyEngine.ts';

/** What became of an attempt to put a slot's branch on the project's integration branch. */
export type Landing =
  | { landed: true; commit: string }
  /** The branch holds nothing the integration branch does not. */
  | { landed: false; why: 'nothing' }
  /** The integration branch had moved, and it and the branch changed the same lines of these files. */
  | { landed: false; why: 'conflict'; files: string[] }
  /** The integration branch had moved, the work was put on top of it, and there it no longer passed its checks. */
  | { landed: false; why: 'checks' }
  /** The project's own workspace has a change, not committed, in a file the work touches. */
  | { landed: false; why: 'dirty' };

type Sandboxes = Pick<OrbStackManager, 'ensure' | 'exec' | 'stop'>;
type Log = { warn: (obj: object, msg: string) => void };

const SYNC_TIMEOUT_SEC = 120;
/** Installing from a lockfile when the project's own dependencies cannot be copied: a phone project's take minutes. */
const DEPS_TIMEOUT_SEC = 900;
/** A bundle of one edit is a few kilobytes; one of a branch that went on for an hour is still small. As the Core export allows. */
const MAX_BUNDLE_BYTES = 96 * 1024 * 1024;

/**
 * A project's slots: clones of it in containers of their own, where a small edit or a full check works beside
 * whatever the project's own workspace is doing.
 *
 * The studio had one gear. A project was one working tree, so one task at a time, and a one-line fix stood in
 * the same queue as a milestone and was checked the same way. The owner works otherwise: one directory, several
 * sessions, something else going on beside. A slot is the second and third working tree, made as a whole
 * sandbox (see `OrbStackManager`'s `Place`) so that inside it every path and port is where the harness, the
 * tools, the dev server and the walk already expect them.
 *
 * What a slot is to the project's repository: it reads it (the project's volume is mounted in it, read-only),
 * follows it (`take` brings every branch over and stands on the integration branch), and gives back commits as
 * git bundles (`export`, `land`), since it can write nothing there. Landing is one at a time for a project,
 * under the lock `landing` also lends to the studio's other ways of moving the integration branch.
 */
export class Slots {
  readonly #config: Config;
  readonly #sandboxes: Sandboxes;
  readonly #clock: Clock;
  readonly #log: Log;
  /** Which task holds which slot, by project. Memory only: after a restart nothing runs and nothing is held. */
  readonly #held = new Map<string, Map<number, string>>();
  /** Slots that were used and are now free, with when they were let go and the project they are of. */
  readonly #free = new Map<string, { project: Project; slot: number; since: number }>();
  readonly #waiting = new Map<string, (() => void)[]>();
  readonly #landing = new KeyedMutex();

  constructor(deps: { config: Config; sandboxes: Sandboxes; clock: Clock; log: Log }) {
    this.#config = deps.config;
    this.#sandboxes = deps.sandboxes;
    this.#clock = deps.clock;
    this.#log = deps.log;
  }

  /** How many slots a project has. With none, nothing runs in a slot. */
  get perProject(): number {
    return this.#config.slots.perProject;
  }

  /**
   * Takes a free slot of the project for a task, waiting for one if all are held, and brings it to the project
   * as it stands: every branch, the integration branch checked out, dependencies installed for its lockfile.
   * The handle that comes back is the project with the slot named; hand it wherever the project would go.
   */
  async take(project: Project, taskId: string, signal?: AbortSignal): Promise<Place> {
    if (this.perProject < 1) throw new SandboxError('this studio has no slots (slots.perProject is 0)');
    const held = this.#held.get(project.id) ?? new Map<number, string>();
    this.#held.set(project.id, held);
    for (;;) {
      signal?.throwIfAborted();
      const free = Array.from({ length: this.perProject }, (_, i) => i + 1).find((slot) => !held.has(slot));
      if (free !== undefined) {
        held.set(free, taskId);
        this.#free.delete(`${project.id}#${free}`);
        const place: Place = { ...project, slot: free };
        try {
          await this.#prepare(project, place, signal);
          return place;
        } catch (err) {
          this.release(place);
          throw err;
        }
      }
      await new Promise<void>((resolve, reject) => {
        const wake = (): void => {
          signal?.removeEventListener('abort', stop);
          resolve();
        };
        const stop = (): void => {
          const queue = this.#waiting.get(project.id) ?? [];
          queue.splice(queue.indexOf(wake), 1);
          reject(signal!.reason);
        };
        this.#waiting.set(project.id, [...(this.#waiting.get(project.id) ?? []), wake]);
        signal?.addEventListener('abort', stop, { once: true });
      });
    }
  }

  async #prepare(project: Project, place: Place, signal?: AbortSignal): Promise<void> {
    // The project's own sandbox first: a slot is a clone of its workspace and mounts its volume.
    await this.#sandboxes.ensure(project);
    await this.#sandboxes.ensure(place);
    const synced = await this.#sandboxes.exec(place, syncSlotScript({ workspace: WORKSPACE_DIR, main: SLOT_MAIN_DIR, into: INTEGRATION_BRANCH }), { timeoutSec: SYNC_TIMEOUT_SEC, signal });
    if (synced.exitCode !== 0) throw new SandboxError(`slot ${slotOf(place)} of ${project.slug} could not be brought to the project's ${INTEGRATION_BRANCH}`, synced.stderr);
    const deps = await this.#sandboxes.exec(place, slotDepsScript({ workspace: WORKSPACE_DIR, main: SLOT_MAIN_DIR }), { timeoutSec: DEPS_TIMEOUT_SEC, signal });
    if (deps.exitCode !== 0) throw new SandboxError(`slot ${slotOf(place)} of ${project.slug} could not install the project's dependencies`, deps.stderr);
  }

  /** Lets a slot go. Its container stays as it is, dev server and all, for whoever takes it next; `reap` stops it if nobody does. */
  release(place: Place): void {
    const slot = slotOf(place);
    const held = this.#held.get(place.id);
    if (!held?.delete(slot)) return;
    const { slot: _slot, ...project } = place;
    this.#free.set(`${place.id}#${slot}`, { project, slot, since: this.#clock() });
    this.#waiting.get(place.id)?.shift()?.();
  }

  /** Which task holds each slot of a project that is held. */
  holders(projectId: string): Map<number, string> {
    return new Map(this.#held.get(projectId) ?? []);
  }

  /**
   * Puts what `branch` holds beyond the integration branch into the project's own repository, under the same
   * name: unfinished work that someone may go on from. False when the branch holds nothing more.
   */
  async export(place: Place, branch: string): Promise<boolean> {
    const bundle = await this.#bundle(place, INTEGRATION_BRANCH, branch);
    if (bundle === null) return false;
    const taken = await this.#sandboxes.exec(this.#projectOf(place), bundleInScript({ workspace: WORKSPACE_DIR, branch }), { stdin: bundle.bytes, timeoutSec: SYNC_TIMEOUT_SEC });
    if (taken.exitCode !== 0) throw new SandboxError(`could not take ${branch} into the project's repository`, taken.stderr);
    return true;
  }

  /**
   * Puts a slot's branch on the project's integration branch, one landing a project at a time. When the
   * integration branch has moved since the slot was taken, the branch is first put on top of it and `again` is
   * asked whether the work still passes there: what lands is what was checked, on the ground it lands on.
   */
  land(place: Place, branch: string, again: () => Promise<boolean>): Promise<Landing> {
    return this.#landing.run(place.id, async () => {
      // Twice at most: the second time is for an integration branch that moved between the look and the move,
      // which the lock leaves to the owner's own hand in a terminal.
      for (let attempt = 0; attempt < 2; attempt++) {
        const rebased = await this.#sandboxes.exec(place, rebaseOntoScript({ workspace: WORKSPACE_DIR, main: SLOT_MAIN_DIR, into: INTEGRATION_BRANCH }), { timeoutSec: SYNC_TIMEOUT_SEC });
        if (rebased.exitCode === 3) return { landed: false, why: 'conflict', files: rebased.stdout.split('\n').map((line) => line.trim()).filter(Boolean) };
        const [how, old] = rebased.stdout.trim().split(/\s+/);
        if (rebased.exitCode !== 0 || !old || !/^[0-9a-f]{40}$/.test(old)) throw new SandboxError(`could not put ${branch} on the project's ${INTEGRATION_BRANCH}`, rebased.stderr);
        if (how === 'moved' && !(await again())) return { landed: false, why: 'checks' };
        const bundle = await this.#bundle(place, old, branch);
        if (bundle === null) return { landed: false, why: 'nothing' };
        const taken = await this.#sandboxes.exec(this.#projectOf(place), bundleInScript({ workspace: WORKSPACE_DIR, branch, land: { into: INTEGRATION_BRANCH, commit: bundle.commit, old } }), { stdin: bundle.bytes, timeoutSec: SYNC_TIMEOUT_SEC });
        if (taken.exitCode === 0) return { landed: true, commit: bundle.commit };
        if (taken.exitCode === 8) return { landed: false, why: 'dirty' };
        if (taken.exitCode !== 6) throw new SandboxError(`could not move the project's ${INTEGRATION_BRANCH} to ${branch}`, taken.stderr);
      }
      throw new SandboxError(`the project's ${INTEGRATION_BRANCH} kept moving while ${branch} was being put on it`, '');
    });
  }

  /** The landing lock, for whatever else moves a project's integration branch (a merge, a rollback). */
  landing<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    return this.#landing.run(projectId, fn);
  }

  /** Stops the containers of slots nobody has taken for `slots.idleStopMinutes`: each holds a dev server's memory for nothing. */
  async reap(now = this.#clock()): Promise<void> {
    const idleMs = this.#config.slots.idleStopMinutes * 60_000;
    for (const [key, free] of this.#free) {
      if (now - free.since < idleMs) continue;
      this.#free.delete(key);
      await this.#sandboxes.stop({ ...free.project, slot: free.slot }).catch((err: unknown) => this.#log.warn({ projectId: free.project.id, slot: free.slot, err: String(err) }, 'an idle slot could not be stopped'));
    }
  }

  #projectOf(place: Place): Project {
    const { slot: _slot, ...project } = place;
    return project;
  }

  /** `base..branch` of a slot as a bundle with the commit it ends on, or null when there is nothing between them. */
  async #bundle(place: Place, base: string, branch: string): Promise<{ bytes: Uint8Array; commit: string } | null> {
    const made = await this.#sandboxes.exec(place, bundleOutScript({ workspace: WORKSPACE_DIR, base, branch }), { timeoutSec: SYNC_TIMEOUT_SEC, maxOutputBytes: MAX_BUNDLE_BYTES });
    if (made.exitCode === 7) return null;
    const commit = made.stderr.trim().split('\n').at(-1)?.trim() ?? '';
    if (made.exitCode !== 0 || made.truncated || !/^[0-9a-f]{40}$/.test(commit)) throw new SandboxError(made.truncated ? `${branch} is too large to leave its slot (over ${MAX_BUNDLE_BYTES / (1024 * 1024)}MB)` : `could not bundle ${branch}`, made.stderr);
    return { bytes: Buffer.from(made.stdout, 'base64'), commit };
  }
}

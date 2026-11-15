// Slots, on real git: the fake docker gives each container a directory, and every script here is the one the
// daemon runs. A slot follows the project's repository, and what is made in it reaches the project's main as
// what was checked, on the ground it lands on.
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'node:test';
import { testConfig } from '../src/config.ts';
import { Store } from '../src/db/Store.ts';
import { OrbStackManager, slotOf, type Place } from '../src/sandbox/OrbStackManager.ts';
import { Slots } from '../src/sandbox/Slots.ts';
import { dockerArgs, localDocker, sampleProject, tempDir } from './helpers.ts';

const TIP = "export const label = '이 팁 저장하기';\n";
const HOME = "export const title = '오늘';\n";

async function rig(perProject = 2) {
  const [home, ws] = [tempDir(), tempDir('sz-ws-')];
  const docker = localDocker(ws.dir);
  const store = new Store(':memory:');
  const project = sampleProject('duel');
  store.insertProject(project);
  const config = testConfig(home.dir, { slots: { perProject } });
  const time = { now: 1_000_000 };
  const sandboxes = new OrbStackManager({ config, store, clock: () => time.now, run: docker.run });
  const slots = new Slots({ config, sandboxes, clock: () => time.now, log: { warn: () => undefined } });
  await sandboxes.ensure(project);
  await sandboxes.writeFile(project, 'app/tip.tsx', TIP);
  await sandboxes.writeFile(project, 'app/home.tsx', HOME);
  await sandboxes.commitAll(project, 'feat: two screens');
  const sh = async (place: Place, script: string): Promise<string> => {
    const res = await sandboxes.exec(place, script);
    assert.equal(res.exitCode, 0, `${script}: ${res.stderr}`);
    return res.stdout.trim();
  };
  /** One edit in a slot: a branch from main, a file rewritten, committed. */
  const edit = async (place: Place, branch: string, file: string, content: string): Promise<void> => {
    await sandboxes.startBranch(place, branch, 'main');
    await sandboxes.writeFile(place, file, content);
    await sandboxes.commitAll(place, `fix: ${file}`);
  };
  const never = async (): Promise<boolean> => assert.fail('the work stood on main as it was: nothing to check again');
  const cleanup = (): void => {
    for (const dir of [...docker.slots.values()]) for (const path of [dir, `${dir}-scratch`]) rmSync(path, { recursive: true, force: true });
    rmSync(`${ws.dir}-scratch`, { recursive: true, force: true });
    home.cleanup();
    ws.cleanup();
  };
  return { sandboxes, slots, project, docker, time, sh, edit, never, cleanup };
}

test('a slot starts as the project\'s main and follows it', async () => {
  const { sandboxes, slots, project, sh, cleanup } = await rig();
  try {
    const first = await slots.take(project, 't1');
    assert.deepEqual([slotOf(first), first.id, first.slug], [1, project.id, project.slug]);
    assert.equal((await sandboxes.readFile(first, 'app/tip.tsx')).content, TIP);
    assert.equal(await sh(first, 'git rev-parse HEAD'), await sh(project, 'git rev-parse main'));
    assert.equal(await sh(first, 'git symbolic-ref --short HEAD'), 'main');
    // Whoever was here leaves things behind: a file nobody tracks, a branch checked out, work half committed.
    await sandboxes.startBranch(first, 'sz/t1', 'main');
    await sandboxes.writeFile(first, 'app/tip.tsx', 'half done');
    await sandboxes.writeFile(first, 'junk.txt', 'left behind');
    slots.release(first);
    // Meanwhile the project goes on: main moves, and a branch appears.
    await sandboxes.writeFile(project, 'app/home.tsx', "export const title = '내일';\n");
    await sandboxes.commitAll(project, 'feat: tomorrow');
    await sh(project, 'git branch sz/elsewhere');

    const next = await slots.take(project, 't2');
    assert.equal(slotOf(next), 1, 'the same slot, taken again');
    assert.equal((await sandboxes.readFile(next, 'app/home.tsx')).content, "export const title = '내일';\n");
    assert.equal((await sandboxes.readFile(next, 'app/tip.tsx')).content, TIP, 'what was half done is not carried over');
    assert.equal(await sh(next, 'test -e junk.txt && echo there || echo gone'), 'gone');
    assert.equal(await sh(next, 'git status --porcelain'), '');
    assert.equal(await sh(next, 'git rev-parse HEAD'), await sh(project, 'git rev-parse main'));
    assert.equal(await sh(next, 'git rev-parse sz/elsewhere'), await sh(project, 'git rev-parse sz/elsewhere'), 'the project\'s branches come over, to start from');
    // A slot cannot write where it reads the project from. (Enforced by the mount in a real sandbox; here the two are only apart.)
    assert.deepEqual(slots.holders(project.id), new Map([[1, 't2']]));
  } finally {
    cleanup();
  }
});

test('an edit made in a slot lands on main, and the project\'s working files follow when it stands on main', async () => {
  const { sandboxes, slots, project, sh, edit, never, cleanup } = await rig();
  try {
    const slot = await slots.take(project, 't1');
    await edit(slot, 'sz/t1', 'app/tip.tsx', "export const label = '저장함';\n");
    const landing = await slots.land(slot, 'sz/t1', never);
    assert.ok(landing.landed);
    assert.equal(landing.commit, await sh(slot, 'git rev-parse sz/t1'));
    assert.equal(await sh(project, 'git rev-parse main'), landing.commit);
    assert.equal((await sandboxes.readFile(project, 'app/tip.tsx')).content, "export const label = '저장함';\n", 'the working file is the landed one: a preview of main shows it at once');
    assert.equal(await sh(project, 'git status --porcelain'), '');
    assert.equal(await sh(project, 'git rev-parse sz/t1'), landing.commit, 'the branch is in the project\'s repository too');
    assert.equal(await sh(project, 'git log --format=%s -1'), 'fix: app/tip.tsx');
  } finally {
    cleanup();
  }
});

test('it lands while the project\'s checkout is on another branch, and that checkout is not touched', async () => {
  const { sandboxes, slots, project, sh, edit, never, cleanup } = await rig();
  try {
    // A heavy task at work in the project's own workspace: its branch, a file it has not committed.
    await sandboxes.startBranch(project, 'sz/heavy', 'main');
    await sandboxes.writeFile(project, 'app/heavy.tsx', 'work in progress');
    const slot = await slots.take(project, 't1');
    assert.equal(await sh(slot, 'git symbolic-ref --short HEAD'), 'main', 'a slot stands on main whatever the project has checked out');
    await edit(slot, 'sz/t1', 'app/tip.tsx', "export const label = '저장함';\n");
    const landing = await slots.land(slot, 'sz/t1', never);
    assert.ok(landing.landed);
    assert.equal(await sh(project, 'git rev-parse main'), landing.commit);
    assert.equal(await sh(project, 'git symbolic-ref --short HEAD'), 'sz/heavy');
    assert.equal((await sandboxes.readFile(project, 'app/heavy.tsx')).content, 'work in progress');
    assert.equal((await sandboxes.readFile(project, 'app/tip.tsx')).content, TIP, 'the heavy task still sees the tip it started from');
    assert.equal(await sh(project, 'git status --porcelain'), '?? app/heavy.tsx');
  } finally {
    cleanup();
  }
});

test('main moved: the edit is put on top of it, checked again, and lands; one that no longer passes there does not', async () => {
  const { sandboxes, slots, project, sh, edit, never, cleanup } = await rig();
  try {
    const [a, b] = [await slots.take(project, 't1'), await slots.take(project, 't2')];
    assert.deepEqual([slotOf(a), slotOf(b)], [1, 2]);
    await edit(a, 'sz/t1', 'app/tip.tsx', "export const label = '저장함';\n");
    await edit(b, 'sz/t2', 'app/home.tsx', "export const title = '오늘의 기록';\n");
    const first = await slots.land(a, 'sz/t1', never);
    assert.ok(first.landed);
    let asked = 0;
    const second = await slots.land(b, 'sz/t2', async () => {
      asked++;
      // Asked on the new ground: the slot holds the first edit under its own by now.
      assert.equal((await sandboxes.readFile(b, 'app/tip.tsx')).content, "export const label = '저장함';\n");
      return true;
    });
    assert.ok(second.landed);
    assert.equal(asked, 1);
    assert.equal(await sh(project, 'git rev-parse main'), second.commit);
    assert.equal(await sh(project, 'git rev-parse main~1'), first.commit, 'one after the other, no merge commit');
    assert.deepEqual([(await sandboxes.readFile(project, 'app/tip.tsx')).content, (await sandboxes.readFile(project, 'app/home.tsx')).content], ["export const label = '저장함';\n", "export const title = '오늘의 기록';\n"]);

    // A third, taken before the second landed and found wanting once it stands on it: main stays where it is.
    slots.release(a);
    const c = await slots.take(project, 't3');
    await edit(c, 'sz/t3', 'app/tip.tsx', "export const label = '저장 완료';\n");
    await sandboxes.writeFile(project, 'app/extra.tsx', 'another change to main');
    await sandboxes.commitAll(project, 'feat: extra');
    const moved = await sh(project, 'git rev-parse main');
    assert.deepEqual(await slots.land(c, 'sz/t3', async () => false), { landed: false, why: 'checks' });
    assert.equal(await sh(project, 'git rev-parse main'), moved);
  } finally {
    cleanup();
  }
});

test('two edits to the same lines: the second is told which files, and main is not moved', async () => {
  const { sandboxes, slots, project, sh, edit, never, cleanup } = await rig();
  try {
    const [a, b] = [await slots.take(project, 't1'), await slots.take(project, 't2')];
    await edit(a, 'sz/t1', 'app/tip.tsx', "export const label = '저장함';\n");
    await edit(b, 'sz/t2', 'app/tip.tsx', "export const label = '보관함에 넣기';\n");
    const first = await slots.land(a, 'sz/t1', never);
    assert.ok(first.landed);
    assert.deepEqual(await slots.land(b, 'sz/t2', never), { landed: false, why: 'conflict', files: ['app/tip.tsx'] });
    assert.equal(await sh(project, 'git rev-parse main'), first.commit);
    // The slot is left on its branch as it was, to be worked on: nothing half rebased.
    assert.equal(await sh(b, 'git symbolic-ref --short HEAD'), 'sz/t2');
    assert.equal(await sh(b, 'git status --porcelain'), '');
    assert.equal((await sandboxes.readFile(b, 'app/tip.tsx')).content, "export const label = '보관함에 넣기';\n");
  } finally {
    cleanup();
  }
});

test('what cannot land says why: nothing in it, or the project\'s own workspace holds a change to the same file', async () => {
  const { sandboxes, slots, project, sh, edit, never, cleanup } = await rig();
  try {
    const slot = await slots.take(project, 't1');
    await sandboxes.startBranch(slot, 'sz/t1', 'main');
    assert.deepEqual(await slots.land(slot, 'sz/t1', never), { landed: false, why: 'nothing' });
    assert.equal(await slots.export(slot, 'sz/t1'), false);

    // The owner has changed the tip in the project's workspace and not committed it.
    await sandboxes.writeFile(project, 'app/tip.tsx', "export const label = '내가 고치는 중';\n");
    const before = await sh(project, 'git rev-parse main');
    await edit(slot, 'sz/t1', 'app/tip.tsx', "export const label = '저장함';\n");
    assert.deepEqual(await slots.land(slot, 'sz/t1', never), { landed: false, why: 'dirty' });
    assert.equal(await sh(project, 'git rev-parse main'), before);
    assert.equal((await sandboxes.readFile(project, 'app/tip.tsx')).content, "export const label = '내가 고치는 중';\n", 'their change is as they left it');
  } finally {
    cleanup();
  }
});

test('export puts an unfinished branch into the project\'s repository, to go on from', async () => {
  const { sandboxes, slots, project, sh, cleanup } = await rig();
  try {
    const slot = await slots.take(project, 't1');
    await sandboxes.startBranch(slot, 'sz/t1', 'main');
    await sandboxes.writeFile(slot, 'app/tip.tsx', 'half done');
    await sandboxes.commitAll(slot, 'wip: t1 (failed)');
    const main = await sh(project, 'git rev-parse main');
    assert.equal(await slots.export(slot, 'sz/t1'), true);
    assert.equal(await sh(project, 'git show sz/t1:app/tip.tsx'), 'half done');
    assert.equal(await sh(project, 'git rev-parse main'), main, 'main is where it was');
    assert.equal((await sandboxes.readFile(project, 'app/tip.tsx')).content, TIP);
    // The next task that takes a slot finds that branch there, as `--from` needs.
    slots.release(slot);
    const next = await slots.take(project, 't2');
    assert.equal(await sh(next, 'git show sz/t1:app/tip.tsx'), 'half done');
  } finally {
    cleanup();
  }
});

test('a project has so many slots: the next task waits for one, and stops waiting when it is cancelled', async () => {
  const { slots, project, cleanup } = await rig(2);
  try {
    const [a, b] = [await slots.take(project, 't1'), await slots.take(project, 't2')];
    let third: Place | null = null;
    const waiting = slots.take(project, 't3').then((place) => (third = place));
    const abort = new AbortController();
    const fourth = slots.take(project, 't4', abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(third, null, 'both slots are held');
    abort.abort(new Error('cancelled'));
    await assert.rejects(fourth, /cancelled/);
    slots.release(b);
    await waiting;
    assert.equal(slotOf(third!), 2);
    assert.deepEqual(slots.holders(project.id), new Map([[1, 't1'], [2, 't3']]));
    slots.release(a);
    slots.release(a);
    assert.deepEqual(slots.holders(project.id), new Map([[2, 't3']]), 'letting go twice lets go once');
  } finally {
    cleanup();
  }
});

test('a slot nobody takes for fifteen minutes has its container stopped; one that is held, or taken again, has not', async () => {
  const { slots, project, docker, time, cleanup } = await rig();
  try {
    const stops = (): string[] => docker.calls.map((c) => dockerArgs(c.args)).filter((args) => args[0] === 'stop').map((args) => args.at(-1)!);
    const [a, b] = [await slots.take(project, 't1'), await slots.take(project, 't2')];
    slots.release(a);
    time.now += 14 * 60_000;
    await slots.reap();
    assert.deepEqual(stops(), []);
    time.now += 60_000;
    await slots.reap();
    assert.deepEqual(stops(), ['sz-duel-s1'], 'the idle one, and not the one a task holds');
    await slots.reap();
    assert.deepEqual(stops(), ['sz-duel-s1'], 'once');
    slots.release(b);
    const again = await slots.take(project, 't3');
    time.now += 60 * 60_000;
    await slots.reap();
    assert.deepEqual([slotOf(again), stops()], [1, ['sz-duel-s1', 'sz-duel-s2']], 'slot 1 was taken again and is left running; slot 2 has been idle since');
  } finally {
    cleanup();
  }
});

test('a slot\'s dependencies are the project\'s, copied while the lockfile is the same and kept until it changes', async () => {
  const { sandboxes, slots, project, sh, cleanup } = await rig();
  try {
    await sandboxes.writeFile(project, '.gitignore', 'node_modules/\n');
    await sandboxes.writeFile(project, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
    await sandboxes.commitAll(project, 'chore: lockfile');
    await sandboxes.writeFile(project, 'node_modules/dep/index.js', 'module.exports = 1;\n');
    const slot = await slots.take(project, 't1');
    assert.equal((await sandboxes.readFile(slot, 'node_modules/dep/index.js')).content, 'module.exports = 1;\n');
    assert.equal(await sh(slot, 'cat .git/sz-deps'), await sh(slot, 'git hash-object pnpm-lock.yaml'));
    // Taken again with the same lockfile: what is installed is left alone.
    await sandboxes.writeFile(slot, 'node_modules/dep/built.txt', 'a cache made while working');
    slots.release(slot);
    assert.equal((await sandboxes.readFile(await slots.take(project, 't2'), 'node_modules/dep/built.txt')).content, 'a cache made while working');
    slots.release(slot);
    // The project takes a new dependency: the slot's are put down again from the project's.
    await sandboxes.writeFile(project, 'pnpm-lock.yaml', 'lockfileVersion: 9\n# one more\n');
    await sandboxes.commitAll(project, 'chore: one more dependency');
    await sandboxes.writeFile(project, 'node_modules/more/index.js', 'module.exports = 2;\n');
    const next = await slots.take(project, 't3');
    assert.equal((await sandboxes.readFile(next, 'node_modules/more/index.js')).content, 'module.exports = 2;\n');
    assert.equal(await sh(next, 'test -e node_modules/dep/built.txt && echo there || echo gone'), 'gone');
    assert.equal(await sh(next, 'git status --porcelain'), '', 'installed dependencies are nobody\'s change');
  } finally {
    cleanup();
  }
});

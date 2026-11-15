// The fine gear's ground: what the store keeps for it. A small edit may run beside a heavy task of its project,
// up to the slots the project has; a sandbox row is kept for each slot; and a project keeps where its last full
// walk went and what each screen was found breaking.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CORE_PROJECT_ID, type ProjectWalks, type TaskKind } from '@studio-zero/protocol';
import { Store } from '../src/db/Store.ts';
import { ensureDevServer } from '../src/harness/devServer.ts';
import { OrbStackManager, sandboxNames, type Place } from '../src/sandbox/OrbStackManager.ts';
import { testConfig } from '../src/config.ts';
import { dockerArgs, localDocker, sampleProject, tempDir } from './helpers.ts';

function storeWith(...slugs: string[]): Store {
  const store = new Store(':memory:');
  for (const slug of slugs) store.insertProject(sampleProject(slug));
  return store;
}

let seq = 0;
function queue(store: Store, projectId: string, kind: TaskKind): string {
  const id = `tsk_${++seq}`;
  store.insertTask({ id, projectId, kind, prompt: kind, origin: 'desktop', budgetTokens: 1000, branch: null, createdAt: seq });
  return id;
}

test('the queue lets small edits run beside a heavy task, up to the slots a project has', () => {
  const store = storeWith('duel');
  const project = 'prj_duel';
  const build = queue(store, project, 'build');
  assert.equal(store.claimNextTask(10, 2)?.id, build, 'the heavy task is claimed first');
  const [e1, e2, e3] = [queue(store, project, 'inline_edit'), queue(store, project, 'inline_edit'), queue(store, project, 'inline_edit')];
  const waiting = queue(store, project, 'build');
  assert.equal(store.claimNextTask(11, 2)?.id, e1, 'an edit does not wait for the build');
  assert.equal(store.claimNextTask(12, 2)?.id, e2);
  assert.equal(store.claimNextTask(13, 2), null, 'a third edit waits for a slot, and a second build for the first');
  // A full check is light too, and takes a slot like an edit.
  store.updateTask(e1, { state: 'succeeded', finishedAt: 14 });
  const check = queue(store, project, 'check');
  assert.equal(store.claimNextTask(15, 2)?.id, e3, 'the oldest light task takes the slot that came free');
  assert.equal(store.claimNextTask(16, 2), null);
  store.updateTask(e2, { state: 'failed', finishedAt: 17 });
  assert.equal(store.claimNextTask(18, 2)?.id, check);
  // The heavy task ends: the build that waited is claimed, with two light tasks still running.
  store.updateTask(build, { state: 'succeeded', finishedAt: 19 });
  assert.equal(store.claimNextTask(20, 2)?.id, waiting);
  // Where projects have no slots, an edit is a task like any other and waits for the project's workspace.
  const none = storeWith('plain');
  const heavy = queue(none, 'prj_plain', 'build');
  const waits = queue(none, 'prj_plain', 'inline_edit');
  assert.equal(none.claimNextTask(1)?.id, heavy);
  assert.equal(none.claimNextTask(2), null);
  none.updateTask(heavy, { state: 'succeeded', finishedAt: 3 });
  assert.equal(none.claimNextTask(4)?.id, waits);
  // A project with one slot runs one light task at a time.
  const solo = storeWith('solo');
  queue(solo, 'prj_solo', 'inline_edit');
  queue(solo, 'prj_solo', 'inline_edit');
  assert.ok(solo.claimNextTask(1, 1));
  assert.equal(solo.claimNextTask(2, 1), null);
});

test('on the studio\'s own repository an edit is a task like any other: one at a time', () => {
  const store = new Store(':memory:');
  store.ensureCoreProject(1);
  const first = queue(store, CORE_PROJECT_ID, 'refactor');
  const edit = queue(store, CORE_PROJECT_ID, 'inline_edit');
  assert.equal(store.claimNextTask(10, 2)?.id, first);
  assert.equal(store.claimNextTask(11, 2), null, 'the edit waits');
  store.updateTask(first, { state: 'succeeded', finishedAt: 12 });
  assert.equal(store.claimNextTask(13, 2)?.id, edit);
  // And while it runs, nothing else of that project does.
  queue(store, CORE_PROJECT_ID, 'inline_edit');
  assert.equal(store.claimNextTask(14, 2), null);
});

test('a task says which slot it ran in and the commit it put on main', () => {
  const store = storeWith('duel');
  const id = queue(store, 'prj_duel', 'inline_edit');
  assert.deepEqual([store.getTask(id)!.slot, store.getTask(id)!.landedCommit], [null, null]);
  const done = store.updateTask(id, { slot: 2, landedCommit: 'a1b2c3d4' });
  assert.deepEqual([done.slot, done.landedCommit], [2, 'a1b2c3d4']);
});

test('a sandbox row is kept for each slot of a project, and goes with the project', () => {
  const store = storeWith('duel');
  const row = (slot: number) => ({ projectId: 'prj_duel', slot, container: slot === 0 ? 'sz-duel' : `sz-duel-s${slot}`, volume: slot === 0 ? 'sz-duel-ws' : `sz-duel-s${slot}-ws`, network: 'sz-duel-net', image: 'img', gatewayTokenHash: `hash${slot}` });
  store.upsertSandbox(row(0), 1);
  store.upsertSandbox(row(1), 2);
  assert.equal(store.getSandbox('prj_duel')?.container, 'sz-duel', 'the project\'s own sandbox is slot 0');
  assert.equal(store.getSandbox('prj_duel', 1)?.container, 'sz-duel-s1');
  assert.equal(store.getSandbox('prj_duel', 2), null);
  assert.deepEqual(store.listSandboxes('prj_duel').map((s) => s.slot), [0, 1]);
  assert.equal(store.getSandboxByTokenHash('hash1')?.slot, 1);
  // Made again, a slot's row takes the new image and token and stays one row.
  store.upsertSandbox({ ...row(1), image: 'img2', gatewayTokenHash: 'hash1b' }, 3);
  assert.deepEqual([store.listSandboxes('prj_duel').length, store.getSandbox('prj_duel', 1)?.image], [2, 'img2']);
  store.deleteProject('prj_duel');
  assert.deepEqual(store.listSandboxes('prj_duel'), []);
});

test('a project keeps where its last full walk went and what each screen was found breaking', () => {
  const store = storeWith('duel');
  assert.equal(store.getWalks('prj_duel'), null);
  const walks: ProjectWalks = {
    trails: { tips: [{ screen: 'A-02', step: 'sign-up' }, { screen: 'TP-02', step: 'save-tip' }] },
    ledger: { 'TP-02': { rules: ['type/broken-label'], at: 5 } },
    commit: 'a1b2c3d',
    updatedAt: 5,
  };
  store.putWalks('prj_duel', walks);
  assert.deepEqual(store.getWalks('prj_duel'), walks);
  store.putWalks('prj_duel', { ...walks, ledger: {}, updatedAt: 9 });
  assert.deepEqual(store.getWalks('prj_duel')?.ledger, {});
  store.deleteProject('prj_duel');
  assert.equal(store.getWalks('prj_duel'), null);
});

// ------------------------------------------------------------------ slot containers

test('a slot is a second container of the project: its own volume, the project\'s to read, and reached through the handle that names it', async () => {
  const [home, ws] = [tempDir(), tempDir('sz-ws-')];
  const docker = localDocker(ws.dir);
  const store = new Store(':memory:');
  const project = sampleProject('duel');
  store.insertProject(project);
  const sandboxes = new OrbStackManager({ config: testConfig(home.dir), store, clock: () => 1000, run: docker.run });
  const slot: Place = { ...project, slot: 1 };
  try {
    assert.deepEqual(sandboxNames('duel', 1), { container: 'sz-duel-s1', volume: 'sz-duel-s1-ws', network: 'sz-duel-net' });
    await assert.rejects(sandboxes.ensure(slot), /slot 1 of duel has no project sandbox to be a clone of/);
    await sandboxes.ensure(project);
    const before = docker.calls.length;
    const info = await sandboxes.ensure(slot);
    assert.deepEqual([info.container, info.state], ['sz-duel-s1', 'running']);

    const create = docker.calls.slice(before).find((c) => c.args.includes('run') && c.args.includes('--detach'))!;
    const line = dockerArgs(create.args).join(' ');
    for (const flag of ['--name sz-duel-s1', '--hostname duel-s1', '--network sz-duel-net', 'type=volume,source=sz-duel-s1-ws,target=/workspace,volume-nocopy', 'type=volume,source=sz-duel-ws,target=/main,readonly', '--label studio-zero.project=prj_duel', '--label studio-zero.role=slot', '--label studio-zero.slot=1', '--user 1000:1000', '--cap-drop ALL', '--security-opt no-new-privileges']) {
      assert.ok(line.includes(flag), `missing ${flag}`);
    }
    assert.ok(!/type=bind|docker\.sock|--privileged/.test(line), 'a slot is a sandbox like the project\'s: no host mounts, no socket');
    // Its workspace is not begun: the slot is a clone, made when it is first taken.
    assert.ok(!docker.calls.slice(before).some((c) => dockerArgs(c.args)[0] === 'exec' && String(c.args.at(-1)).includes('git init')), 'no repository is begun in a slot');
    assert.deepEqual(store.listSandboxes('prj_duel').map((row) => [row.slot, row.container]), [[0, 'sz-duel'], [1, 'sz-duel-s1']]);
    assert.notEqual(store.getSandbox('prj_duel', 1)!.gatewayTokenHash, store.getSandbox('prj_duel')!.gatewayTokenHash, 'a token of its own');

    // The handle decides where a command runs: the same call, two workspaces.
    await sandboxes.writeFile(slot, 'where.txt', 'slot');
    await sandboxes.writeFile(project, 'where.txt', 'project');
    assert.equal((await sandboxes.readFile(slot, 'where.txt')).content, 'slot');
    assert.equal((await sandboxes.readFile(project, 'where.txt')).content, 'project');
    // And the slot reads the project's workspace where it is mounted.
    assert.equal((await sandboxes.exec(slot, 'cat /main/where.txt')).stdout, 'project');

    // The project goes, and its slots with it, volume and all.
    await sandboxes.destroy(project, { deleteWorkspace: false });
    const removed = docker.calls.map((c) => dockerArgs(c.args).join(' '));
    assert.ok(removed.includes('rm -f sz-duel-s1') && removed.includes('volume rm sz-duel-s1-ws') && removed.includes('rm -f sz-duel'));
    assert.ok(!removed.includes('volume rm sz-duel-ws'), 'the project\'s own workspace is kept unless asked');
    assert.deepEqual(store.listSandboxes('prj_duel').map((row) => row.slot), [0]);
  } finally {
    home.cleanup();
    ws.cleanup();
  }
});

// ------------------------------------------------------------------ a dev server that does not follow its files

test('whoever judges by what the dev server serves gets the code as it is: a server that was up before the workspace changed is restarted', async () => {
  // Every sandbox sets CI=1, and Metro under it serves the bundle it first built until it is restarted. The
  // first quick fixes on a real product were walked on such a server and passed against the code they replaced.
  const project = sampleProject('duel');
  const file = { dev: { command: 'pnpm expo start --web --port 8081', port: 8081 }, routes: ['/'], states: [] };
  const box = { workspace: 'hash-of-A', startedOn: '', answering: false, starts: 0 };
  const sandboxes = {
    exec: async (_project: unknown, script: string) => {
      const out = script.startsWith('git ls-files') ? box.workspace : script.startsWith('cat ') ? box.startedOn : ((box.startedOn = /printf %s '?([^' ]*)'? >/.exec(script)?.[1] ?? box.startedOn), '');
      return { exitCode: 0, stdout: out, stderr: '', truncated: false, timedOut: false, durationMs: 1 };
    },
    waitForHttp: async () => box.answering,
    startProcess: async () => {
      box.starts++;
      box.answering = true;
    },
    processLog: async () => '',
  };
  const ensure = (opts: { reuse: boolean; current?: boolean }) => ensureDevServer(sandboxes as never, project, file as never, opts);
  // Nothing answers: started, and the workspace it was started on is noted.
  assert.deepEqual([await ensure({ reuse: true, current: true }), box.starts, box.startedOn], [{ ready: true, log: '' }, 1, 'hash-of-A']);
  // The same workspace: left running.
  await ensure({ reuse: true, current: true });
  assert.equal(box.starts, 1);
  // The workspace changed under it (an engine wrote a file, a branch was checked out): restarted, and noted again.
  box.workspace = 'hash-of-B';
  await ensure({ reuse: true, current: true });
  assert.deepEqual([box.starts, box.startedOn], [2, 'hash-of-B']);
  // The owner's preview does not ask: a task's walk may be standing on that server.
  box.workspace = 'hash-of-C';
  await ensure({ reuse: true });
  assert.equal(box.starts, 2);
  // A workspace that cannot be stamped is never "the same as before", and a server nobody noted is not trusted.
  box.workspace = '';
  await ensure({ reuse: true, current: true });
  assert.equal(box.starts, 3);
  // Without reuse it is restarted whatever the workspace says, as the smoke gate has always done.
  box.workspace = 'hash-of-C';
  await ensure({ reuse: false });
  assert.deepEqual([box.starts, box.startedOn], [4, 'hash-of-C']);
});

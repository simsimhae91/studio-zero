// The gate, on real git: a test daemon whose sandbox is a directory, a bare repository on this machine that
// mirrors it, and a clone of that repository pushed from with the git on this machine. The hook is the one the
// daemon writes, and it runs the studio's own command line against the test daemon.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CORE_PROJECT_ID, type Project } from '@studio-zero/protocol';
import { runCommand, type RunResult } from '../src/util/run.ts';
import { sleep } from '../src/util/core.ts';
import { tempDir, testDaemon, type TestDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
const QUIET = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
const ME = ['-c', 'user.name=owner', '-c', 'user.email=owner@localhost'];

interface Rig {
  d: TestDaemon;
  project: Project;
  gate: string;
  clone: string;
  /** git in the owner's clone; a push from it reaches the test daemon through the hook. */
  git: (...args: string[]) => Promise<RunResult>;
  /** A command in the project's sandbox, at the repository's root. */
  inside: (script: string) => Promise<string>;
  commit: (file: string, content: string, message: string) => Promise<string>;
  cleanup: () => Promise<void>;
}

async function rig(config: Parameters<typeof testDaemon>[0] = {}): Promise<Rig> {
  const d = await testDaemon(config);
  await d.daemon.start();
  const project = await d.daemon.studio.createProjectAndProvision(OWNER, { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
  const repo = await d.daemon.studio.repoOpen(OWNER, project.id);
  const where = tempDir('sz-clone-');
  const clone = join(where.dir, 'ledger');
  const env = { ...process.env, ...QUIET, SZ_URL: d.url(), SZ_TOKEN: d.daemon.clientToken.expose() };
  const cloned = await runCommand('git', ['clone', '-q', '-o', 'studio', repo.path!, clone], { env });
  assert.equal(cloned.exitCode, 0, cloned.stderr);
  const git = (...args: string[]): Promise<RunResult> => runCommand('git', ['-C', clone, ...ME, ...args], { env, timeoutMs: 60_000 });
  const inside = async (script: string): Promise<string> => {
    const res = await d.daemon.sandboxes.exec(project, script, { cwd: '/workspace' });
    assert.equal(res.exitCode, 0, `${script}: ${res.stderr}`);
    return res.stdout.trim();
  };
  const commit = async (file: string, content: string, message: string): Promise<string> => {
    writeFileSync(join(clone, file), content);
    assert.equal((await git('add', '-A')).exitCode, 0);
    const made = await git('commit', '-q', '-m', message);
    assert.equal(made.exitCode, 0, made.stderr);
    return (await git('rev-parse', 'HEAD')).stdout.trim();
  };
  return { d, project, gate: repo.path!, clone, git, inside, commit, cleanup: async () => { await d.cleanup(); where.cleanup(); } };
}

/** A plan that holds, of a product nobody signs in to. */
const PLAN = {
  coreMoment: '오늘 쓴 돈을 적는다.',
  screens: [{ id: 'H-01', name: '장부', purpose: '쓴 돈을 적고 본다', entry: ['앱을 연다'], elements: [], states: [], exceptions: [] }],
  tasks: [{ id: 'log', goal: '쓴 돈을 적는다', outcome: '적은 줄이 보인다', screen: 'H-01' }],
  events: [],
  roles: [{ id: 'keeper', name: '적는 사람', does: '쓴 돈을 적는다' }],
  entry: null,
  noAccounts: '적은 것은 이 기기에만 둔다.',
  scenarios: [{ id: 'log-one', role: 'keeper', after: null, steps: [{ id: 'log', screen: 'H-01', does: '금액을 적는다', saves: null, outcome: '적은 줄이 보인다' }] }],
  data: [],
};

const refs = async (repo: string): Promise<string[]> => (await runCommand('git', ['-C', repo, 'for-each-ref', '--format=%(refname)'], { env: { ...process.env, ...QUIET } })).stdout.trim().split('\n').filter(Boolean).sort();

test('opening a gate mirrors every branch and no checkpoint ref, and a gate that is not open is not written', async () => {
  const d = await testDaemon();
  try {
    await d.daemon.start();
    const project = await d.daemon.studio.createProjectAndProvision(OWNER, { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
    const { sandboxes, studio, gate } = d.daemon;
    await sandboxes.startBranch(project, 'sz/tsk_one', 'main');
    await sandboxes.writeFile(project, 'src/a.ts', 'export const a = 1;\n');
    await sandboxes.commitAll(project, 'feat: a');
    await sandboxes.checkpoint(project, 'a checkpoint');
    await sandboxes.checkout(project, 'main');
    // Nothing is on the host's disk until the owner asks.
    assert.equal(gate.isOpen(project), false);
    assert.equal(await gate.publish(project), 0);
    assert.equal(existsSync(gate.pathOf(project)), false);
    assert.deepEqual((await studio.repoStatus(project.id)).open, false);

    const opened = await studio.repoOpen(OWNER, project.id);
    assert.equal(opened.open, true);
    assert.deepEqual(await refs(opened.path!), ['refs/heads/main', 'refs/heads/sz/tsk_one']);
    assert.deepEqual(opened.branches.map((branch) => branch.name).sort(), ['main', 'sz/tsk_one']);
    assert.match(opened.cloneCommand!, /^git clone -o studio .*ledger\.git ledger$/);
    assert.match(readFileSync(join(opened.path!, 'hooks', 'pre-receive'), 'utf8'), /gate-receive 'prj_/);

    // A branch that moved is moved, one that went away is removed, and a rollback goes backwards there too.
    const tip = (await sandboxes.exec(project, 'git rev-parse sz/tsk_one', { cwd: '/workspace' })).stdout.trim();
    await sandboxes.exec(project, 'git branch -q sz/tsk_two sz/tsk_one && git branch -q -D sz/tsk_one && git branch -q -f back main', { cwd: '/workspace' });
    assert.equal(await gate.publish(project), 3);
    assert.deepEqual(await refs(opened.path!), ['refs/heads/back', 'refs/heads/main', 'refs/heads/sz/tsk_two']);
    assert.equal((await runCommand('git', ['-C', opened.path!, 'rev-parse', 'sz/tsk_two'])).stdout.trim(), tip);
    assert.equal(await gate.publish(project), 0, 'nothing moved, nothing is written');

    // Whatever moves the project's branches is copied out by itself.
    await sandboxes.exec(project, 'git branch -q later main', { cwd: '/workspace' });
    d.daemon.events.emit({ projectId: project.id, taskId: null }, { type: 'git.merged', branch: 'later', into: 'main', commit: tip });
    for (let i = 0; i < 50 && !(await refs(opened.path!)).includes('refs/heads/later'); i++) await sleep(50);
    assert.ok((await refs(opened.path!)).includes('refs/heads/later'));

    // The studio's own repository has its own way out.
    await assert.rejects(studio.repoOpen(OWNER, CORE_PROJECT_ID));
    // And only the owner at this Mac opens one.
    await assert.rejects(studio.repoOpen({ type: 'owner', via: 'telegram' }, project.id), /only from this Mac/);
  } finally {
    await d.cleanup();
  }
});

test('a push to main that goes forward is in the sandbox when git says it was pushed', async () => {
  const r = await rig();
  try {
    const pushed = await r.commit('NOTES.md', 'by hand\n', 'docs: a note made by hand');
    const out = await r.git('push', 'studio', 'main');
    assert.equal(out.exitCode, 0, out.stderr);
    assert.match(out.stderr, /Studio Zero: main: 받았습니다\(커밋 1개\)/);
    assert.equal(await r.inside('git rev-parse main'), pushed);
    assert.equal(await r.inside('cat NOTES.md'), 'by hand', 'the workspace stood on main: its files followed');
    assert.equal((await runCommand('git', ['-C', r.gate, 'rev-parse', 'main'])).stdout.trim(), pushed);
    const events = r.d.daemon.store.listEvents({ projectId: r.project.id }, 0, 500).map((e) => e.body);
    assert.ok(events.some((b) => b.type === 'repo.received' && b.branch === 'main' && b.new === pushed && b.commits === 1));
  } finally {
    await r.cleanup();
  }
});

test('a push to main that does not go forward is refused and nothing moves', async () => {
  const r = await rig();
  try {
    const before = await r.inside('git rev-parse main');
    // The studio moves main (a small edit landed), and the gate follows.
    await r.d.daemon.sandboxes.writeFile(r.project, 'src/landed.ts', 'export const landed = true;\n');
    const landed = await r.d.daemon.sandboxes.commitAll(r.project, 'fix: landed meanwhile');
    await r.d.daemon.gate.publish(r.project);
    await r.commit('NOTES.md', 'by hand\n', 'docs: on the old main');
    const plain = await r.git('push', 'studio', 'main');
    assert.notEqual(plain.exitCode, 0, 'git itself refuses what is not a fast-forward');
    const forced = await r.git('push', '--force', 'studio', 'main');
    assert.notEqual(forced.exitCode, 0);
    assert.match(forced.stderr, /Studio Zero: main: 앞으로만 움직입니다/);
    assert.equal(await r.inside('git rev-parse main'), landed);
    assert.notEqual(landed, before);
    // Fetched and put on top, it goes in.
    assert.equal((await r.git('pull', '-q', '--rebase', 'studio', 'main')).exitCode, 0);
    const again = await r.git('push', 'studio', 'main');
    assert.equal(again.exitCode, 0, again.stderr);
    assert.equal(await r.inside('git rev-parse main'), (await r.git('rev-parse', 'HEAD')).stdout.trim());
    // Main is never deleted, and a tag is not a branch.
    const deleted = await r.git('push', 'studio', ':main');
    assert.notEqual(deleted.exitCode, 0);
    assert.match(deleted.stderr, /main은 지울 수 없습니다/);
    await r.git('tag', 'v1');
    const tagged = await r.git('push', 'studio', 'v1');
    assert.notEqual(tagged.exitCode, 0);
    assert.match(tagged.stderr, /브랜치만 받습니다/);
  } finally {
    await r.cleanup();
  }
});

test('a new branch is taken, moved by force and removed; one a task holds is refused', async () => {
  const r = await rig();
  try {
    await r.git('checkout', '-q', '-b', 'feat/by-hand');
    const first = await r.commit('feature.ts', 'export const v = 1;\n', 'feat: by hand');
    const made = await r.git('push', 'studio', 'feat/by-hand');
    assert.equal(made.exitCode, 0, made.stderr);
    assert.match(made.stderr, /feat\/by-hand: 새 브랜치로 받았습니다\(커밋 1개\)/);
    assert.equal(await r.inside('git rev-parse feat/by-hand'), first);
    assert.equal(await r.inside('git symbolic-ref --short HEAD'), 'main', 'the workspace stays where it was');
    // The owner's branch is theirs to rewrite.
    assert.equal((await r.git('commit', '-q', '--amend', '-m', 'feat: by hand, said better')).exitCode, 0);
    const amended = (await r.git('rev-parse', 'HEAD')).stdout.trim();
    assert.equal((await r.git('push', '--force', 'studio', 'feat/by-hand')).exitCode, 0);
    assert.equal(await r.inside('git rev-parse feat/by-hand'), amended);
    // A branch made at a commit the studio already has brings no objects with it.
    assert.equal((await r.git('push', 'studio', 'feat/by-hand:feat/copy')).exitCode, 0);
    assert.equal(await r.inside('git rev-parse feat/copy'), amended);
    assert.equal((await r.git('push', 'studio', ':feat/copy')).exitCode, 0);
    assert.equal((await r.d.daemon.sandboxes.exec(r.project, 'git rev-parse -q --verify refs/heads/feat/copy', { cwd: '/workspace' })).exitCode, 1);

    // A task that has not finished holds its branch.
    const { store } = r.d.daemon;
    store.insertTask({ id: 'tsk_busy', projectId: r.project.id, kind: 'build', prompt: 'x', origin: 'desktop', budgetTokens: 1000, branch: 'feat/by-hand', createdAt: 1 });
    await r.commit('feature.ts', 'export const v = 2;\n', 'feat: more');
    const held = await r.git('push', 'studio', 'feat/by-hand');
    assert.notEqual(held.exitCode, 0);
    assert.match(held.stderr, /작업 tsk_busy/);
    assert.equal(await r.inside('git rev-parse feat/by-hand'), amended);
    // And the branch the workspace stands on is not moved under it.
    store.updateTask('tsk_busy', { state: 'cancelled', finishedAt: 2 });
    await r.inside('git checkout -q feat/by-hand');
    const stood = await r.git('push', 'studio', 'feat/by-hand');
    assert.notEqual(stood.exitCode, 0);
    assert.match(stood.stderr, /작업 공간이 지금 이 브랜치에 서 있습니다/);
  } finally {
    await r.cleanup();
  }
});

test('a gate that is behind is brought up and the push refused; with the daemon down nothing is taken', async () => {
  const r = await rig();
  try {
    // Main moved in the sandbox and nobody copied it out (the daemon was down when it happened).
    await r.d.daemon.sandboxes.writeFile(r.project, 'src/unseen.ts', 'export const unseen = true;\n');
    const unseen = await r.d.daemon.sandboxes.commitAll(r.project, 'fix: not yet at the gate');
    await r.commit('NOTES.md', 'by hand\n', 'docs: a note');
    const stale = await r.git('push', 'studio', 'main');
    assert.notEqual(stale.exitCode, 0);
    assert.match(stale.stderr, /스튜디오가 그사이 움직였습니다/);
    assert.equal(await r.inside('git rev-parse main'), unseen);
    assert.equal((await runCommand('git', ['-C', r.gate, 'rev-parse', 'main'])).stdout.trim(), unseen, 'the gate was brought up, so a fetch gets what was missing');
    assert.equal((await r.git('pull', '-q', '--rebase', 'studio', 'main')).exitCode, 0);
    assert.equal((await r.git('push', 'studio', 'main')).exitCode, 0);

    await r.commit('NOTES.md', 'again\n', 'docs: again');
    const before = await r.inside('git rev-parse main');
    const down = await runCommand('git', ['-C', r.clone, ...ME, 'push', 'studio', 'main'], { env: { ...process.env, ...QUIET, SZ_URL: 'ws://127.0.0.1:9/v1/ws', SZ_TOKEN: 'x' }, timeoutMs: 60_000 });
    assert.notEqual(down.exitCode, 0);
    assert.match(down.stderr, /cannot reach the daemon/);
    assert.equal(await r.inside('git rev-parse main'), before);
  } finally {
    await r.cleanup();
  }
});

test('after a push to main a full check is queued once, for a product that has a plan', async () => {
  const r = await rig();
  try {
    const { store } = r.d.daemon;
    const checks = (): number => store.listTasks(r.project.id, 100).filter((task) => task.kind === 'check').length;
    await r.commit('NOTES.md', 'one\n', 'docs: one');
    const unplanned = await r.git('push', 'studio', 'main');
    assert.equal(unplanned.exitCode, 0, unplanned.stderr);
    assert.equal(checks(), 0, 'a product with no plan has nothing to walk');
    // The owner pushes a plan: from this push on, main can be walked, and is.
    mkdirSync(join(r.clone, 'docs'), { recursive: true });
    await r.commit('docs/screens.json', JSON.stringify(PLAN), 'docs: the screen plan');
    const planned = await r.git('push', 'studio', 'main');
    assert.equal(planned.exitCode, 0, planned.stderr);
    assert.match(planned.stderr, /전체 점검을 걸었습니다/);
    assert.equal(checks(), 1);
    // One that is already waiting is the one a second push gets.
    for (const task of store.listTasks(r.project.id, 100)) if (task.kind === 'check') store.updateTask(task.id, { state: 'cancelled', finishedAt: 2 });
    store.insertTask({ id: 'tsk_waiting', projectId: r.project.id, kind: 'check', prompt: 'x', origin: 'desktop', budgetTokens: 1000, branch: null, createdAt: 3 });
    await r.commit('NOTES.md', 'two\n', 'docs: two');
    const second = await r.git('push', 'studio', 'main');
    assert.equal(second.exitCode, 0, second.stderr);
    assert.match(second.stderr, /전체 점검이 이미 줄 서 있습니다 \(tsk_waiting\)/);
    assert.equal(checks(), 2);
  } finally {
    await r.cleanup();
  }
});

test('a push that arrives while main is being moved waits its turn', async () => {
  const r = await rig();
  try {
    await r.commit('NOTES.md', 'by hand\n', 'docs: a note');
    let finished = false;
    let pushing: Promise<RunResult> | null = null;
    // Something else holds the project's main (a small edit landing).
    await r.d.daemon.slots.landing(r.project.id, async () => {
      pushing = r.git('push', 'studio', 'main').then((res) => {
        finished = true;
        return res;
      });
      await sleep(1500);
      assert.equal(finished, false, 'the push waits for whoever is moving main');
    });
    const out = await pushing!;
    assert.equal(out.exitCode, 0, out.stderr);
    assert.equal(await r.inside('git rev-parse main'), (await r.git('rev-parse', 'HEAD')).stdout.trim());
  } finally {
    await r.cleanup();
  }
});

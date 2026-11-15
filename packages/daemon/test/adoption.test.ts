// Adoption, on real git: a checkout made in a temp folder, with its product one folder down, brought into a test
// daemon. What is read is what is committed; what is written into the checkout is one remote.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConflictError } from '../src/app/errors.ts';
import { detectStack, inspect, slugOf } from '../src/repo/Adoption.ts';
import { runCommand, type RunResult } from '../src/util/run.ts';
import { tempDir, testDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
const QUIET = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
const ME = ['-c', 'user.name=owner', '-c', 'user.email=owner@localhost'];

/** A checkout with a proposal at its root and an Expo app in `app/`, as the first repository brought in was. */
async function checkout(opts: { branch?: string; files?: Record<string, string> } = {}): Promise<{ dir: string; git: (...args: string[]) => Promise<RunResult>; cleanup: () => void }> {
  const where = tempDir('sz-checkout-');
  const dir = join(where.dir, 'CreDeal');
  mkdirSync(dir);
  const git = (...args: string[]): Promise<RunResult> => runCommand('git', ['-C', dir, ...ME, ...args], { env: { ...process.env, ...QUIET }, timeoutMs: 60_000 });
  const files: Record<string, string> = opts.files ?? {
    'package.json': JSON.stringify({ name: 'credeal-proposal', devDependencies: { pptxgenjs: '^4.0.1' } }),
    'docs/plan.md': '# plan\n',
    'app/package.json': JSON.stringify({ name: 'credeal-app', version: '1.0.0', dependencies: { expo: '~58.0.22', react: '19.3.0' } }),
    'app/src/home.tsx': 'export const title = "CreDeal";\n',
    'app/AGENTS.md': 'This is an Expo app.\n',
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  assert.equal((await git('init', '-q', '-b', opts.branch ?? 'main')).exitCode, 0);
  await git('add', '-A');
  assert.equal((await git('commit', '-q', '-m', 'the product as it is')).exitCode, 0);
  return { dir, git, cleanup: where.cleanup };
}

test('a stack is read off a package.json, and only the three the studio can walk', () => {
  assert.equal(detectStack({ dependencies: { expo: '~58', react: '19' } }), 'mobile-expo');
  assert.equal(detectStack({ dependencies: { next: '16', react: '19' } }), 'web-next');
  assert.equal(detectStack({ devDependencies: { vite: '7' }, dependencies: { react: '19' } }), 'web-vite-react');
  assert.equal(detectStack({ devDependencies: { vite: '7' }, dependencies: { vue: '3' } }), null);
  assert.equal(detectStack({ dependencies: { express: '5' } }), null);
  for (const not of [null, 'x', 3, [], { dependencies: 'expo' }]) assert.equal(detectStack(not), null);
  assert.equal(slugOf('CreDeal'), 'credeal');
  assert.equal(slugOf('my app (v2)'), 'my-app-v2');
  assert.equal(slugOf('42'), 'app-app');
  assert.match(slugOf('한글 이름'), /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/);
});

test('a checkout whose product is one folder down is found there, and what cannot be placed is refused with the reason', async () => {
  const one = await checkout();
  const two = await checkout({ files: { 'web/package.json': JSON.stringify({ dependencies: { next: '16', react: '19' } }), 'mobile/package.json': JSON.stringify({ dependencies: { expo: '58' } }) } });
  const none = await checkout({ files: { 'package.json': JSON.stringify({ dependencies: { express: '5' } }), 'README.md': 'x\n' } });
  const develop = await checkout({ branch: 'develop', files: { 'package.json': JSON.stringify({ dependencies: { next: '16' } }) } });
  try {
    writeFileSync(join(one.dir, 'scratch.txt'), 'not committed\n');
    const found = await inspect(runCommand, one.dir);
    assert.deepEqual({ root: found.root, template: found.template, base: found.base, name: found.name, uncommitted: found.uncommitted, commits: found.commits }, { root: 'app', template: 'mobile-expo', base: 'main', name: 'CreDeal', uncommitted: 1, commits: 1 });
    assert.equal(found.commit, (await one.git('rev-parse', 'main')).stdout.trim());
    // Named, it is taken as named; a name that is not a folder inside the repository is refused before git sees it.
    assert.equal((await inspect(runCommand, one.dir, { dir: 'app' })).root, 'app');
    for (const bad of ['my app', '../elsewhere', '-rf', 'app/../..']) await assert.rejects(inspect(runCommand, one.dir, { dir: bad }), ConflictError, bad);
    await assert.rejects(inspect(runCommand, one.dir, { dir: 'docs' }), /Expo, Next, Vite/);
    await assert.rejects(inspect(runCommand, join(one.dir, 'app')), /저장소의 루트가 아닙니다/);
    await assert.rejects(inspect(runCommand, join(one.dir, 'nowhere')), /그런 폴더가 없습니다/);
    await assert.rejects(inspect(runCommand, one.dir, { base: 'release' }), /브랜치 release/);
    await assert.rejects(inspect(runCommand, two.dir), /여럿입니다 \(mobile: mobile-expo, web: web-next\)/);
    assert.equal((await inspect(runCommand, two.dir, { dir: 'web' })).template, 'web-next');
    await assert.rejects(inspect(runCommand, none.dir), /찾지 못했습니다/);
    // No main: the branch the checkout stands on is the base.
    assert.deepEqual([(await inspect(runCommand, develop.dir)).base, (await inspect(runCommand, develop.dir)).root], ['develop', '']);
  } finally {
    for (const made of [one, two, none, develop]) made.cleanup();
  }
});

test('adoption takes the base branch as main, adds the remote, puts nothing of the house on it, and leaves the working tree alone', async () => {
  const d = await testDaemon();
  const mine = await checkout();
  try {
    await d.daemon.start();
    const { studio, sandboxes, store, gate } = d.daemon;
    writeFileSync(join(mine.dir, 'scratch.txt'), 'not committed\n');
    const before = (await mine.git('status', '--porcelain')).stdout;
    const head = (await mine.git('rev-parse', 'main')).stdout.trim();

    await assert.rejects(studio.adoptProject({ type: 'owner', via: 'telegram' }, { path: mine.dir }), /only from this Mac/);
    const adopted = await studio.adoptProject(OWNER, { path: mine.dir });
    const project = adopted.project;
    assert.deepEqual({ slug: project.slug, name: project.name, template: project.template, root: project.root, base: project.adopted?.base }, { slug: 'credeal', name: 'CreDeal', template: 'mobile-expo', root: 'app', base: 'main' });
    assert.equal(adopted.remote, 'added');
    assert.equal(adopted.uncommitted, 1);
    assert.match(adopted.lines.join('\n'), /sz fit credeal/);
    assert.deepEqual(store.getProject(project.id)?.adopted, project.adopted);

    // The gate and the sandbox both stand where the checkout's main does, commit for commit.
    assert.equal((await runCommand('git', ['-C', gate.pathOf(project), 'rev-parse', 'main'])).stdout.trim(), head);
    assert.equal((await sandboxes.exec(project, 'git rev-parse main', { cwd: '/workspace' })).stdout.trim(), head);
    assert.equal((await sandboxes.exec(project, 'git symbolic-ref --short HEAD', { cwd: '/workspace' })).stdout.trim(), 'main');
    assert.equal((await sandboxes.readFile(project, 'src/home.tsx')).content, 'export const title = "CreDeal";\n', 'a tool path is from the product folder');

    // The checkout: one remote more, and not a file touched.
    assert.equal((await mine.git('remote', 'get-url', 'studio')).stdout.trim(), gate.pathOf(project));
    assert.equal((await mine.git('status', '--porcelain')).stdout, before);
    assert.equal((await mine.git('rev-parse', 'main')).stdout.trim(), head);

    // Provisioned (this checkout has no lockfile to install by; where dependencies go is `depsScript`'s own
    // test), and nothing of the house's is in the repository.
    await studio.settle();
    const said = store.listEvents({ projectId: project.id }, 0, 200).map((e) => e.body);
    assert.equal(said.some((b) => b.type === 'notice' && b.level === 'warn'), false, 'provisioning went through');
    assert.ok(said.some((b) => b.type === 'notice' && /의존성 설치가 끝났습니다/.test(b.message)));
    assert.equal((await sandboxes.exec(project, 'git status --porcelain', { cwd: '/workspace' })).stdout.trim(), '', 'nothing was written into the repository');
    assert.equal((await sandboxes.exec(project, 'git rev-parse main', { cwd: '/workspace' })).stdout.trim(), head, 'and nothing committed to it');
    assert.equal(existsSync(join(d.workspace, 'app', '.studio-zero')), false);
    assert.equal(existsSync(join(d.workspace, '.studio-zero')), false);
    assert.deepEqual(store.listEvals(project.id).map((e) => e.name), ['visual-audit'], 'no slop lint: its design is its own');

    // The same checkout is not brought in twice.
    await assert.rejects(studio.adoptProject(OWNER, { path: mine.dir }), /이미 들여왔습니다: credeal/);

    // And the door works from the checkout it came from.
    writeFileSync(join(mine.dir, 'app', 'src', 'home.tsx'), 'export const title = "CreDeal 2";\n');
    await mine.git('add', 'app/src/home.tsx');
    await mine.git('commit', '-q', '-m', 'feat: a new title');
    const pushed = await runCommand('git', ['-C', mine.dir, ...ME, 'push', 'studio', 'main'], { env: { ...process.env, ...QUIET, SZ_URL: d.url(), SZ_TOKEN: d.daemon.clientToken.expose() }, timeoutMs: 60_000 });
    assert.equal(pushed.exitCode, 0, pushed.stderr);
    assert.equal((await sandboxes.readFile(project, 'src/home.tsx')).content, 'export const title = "CreDeal 2";\n');
    const status = await studio.repoStatus(project.id);
    assert.deepEqual({ open: status.open, root: status.root, planned: status.planned, adopted: status.adopted?.base }, { open: true, root: 'app', planned: false, adopted: 'main' });
  } finally {
    await d.cleanup();
    mine.cleanup();
  }
});

test('a build on an adopted project runs on the fast track, and what is the house\'s way of starting a product is refused', async () => {
  const d = await testDaemon();
  const mine = await checkout();
  try {
    // Not started: tasks are queued and nothing runs them.
    const { studio } = d.daemon;
    const { project } = await studio.adoptProject(OWNER, { path: mine.dir, name: 'Cre Deal', slug: 'cre-deal' });
    assert.deepEqual([project.slug, project.name], ['cre-deal', 'Cre Deal']);
    const build = await studio.submitTask(OWNER, { projectId: project.id, kind: 'build', prompt: 'add a screen', track: 'full' }, 'desktop');
    assert.equal(build.track, 'fast', 'the full track is the house\'s design gates');
    assert.equal(build.reviewPlan, false);
    const fit = await studio.submitTask(OWNER, { projectId: project.id, kind: 'adopt', prompt: 'fit it' }, 'desktop');
    assert.deepEqual([fit.kind, fit.track], ['adopt', 'fast']);
    await assert.rejects(studio.submitTask(OWNER, { projectId: project.id, kind: 'ideate', prompt: 'design it' }, 'desktop'), /들여온 제품에는/);
    await assert.rejects(studio.runRoadmap(OWNER, project.id), /로드맵을 두지 않습니다/);
    // And fitting is not something a product the studio built needs.
    const house = await studio.createProjectAndProvision(OWNER, { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' }).catch(() => null);
    if (house) await assert.rejects(studio.submitTask(OWNER, { projectId: house.id, kind: 'adopt', prompt: 'fit it' }, 'desktop'), /들여온 프로젝트의 작업/);
    await studio.settle();
  } finally {
    await d.cleanup();
    mine.cleanup();
  }
});

test('a checkout that cannot be brought in leaves nothing behind', async () => {
  const d = await testDaemon();
  const mine = await checkout();
  try {
    const { studio, store, gate } = d.daemon;
    // The sandbox cannot be filled: docker refuses the one command that would do it.
    const broken = await testDaemon({}, {}, (base) => async (file, args, opts) => (args.some((word) => typeof word === 'string' && word.includes('gate-in.bundle')) ? { exitCode: 1, stdout: '', stderr: 'no space left on device', truncated: false, timedOut: false, durationMs: 1 } : base(file, args, opts)));
    try {
      await assert.rejects(broken.daemon.studio.adoptProject(OWNER, { path: mine.dir }), /could not put the repository into the sandbox/);
      assert.equal(broken.daemon.store.listProjects().length, 0);
      assert.equal(existsSync(join(broken.config.reposDir, 'credeal.git')), false);
      assert.notEqual((await mine.git('remote', 'get-url', 'studio')).exitCode, 0, 'the checkout was not touched');
    } finally {
      await broken.cleanup();
    }
    // The same checkout then comes in on a daemon that works.
    const { project } = await studio.adoptProject(OWNER, { path: mine.dir });
    assert.equal(store.listProjects().some((p) => p.id === project.id), true);
    assert.equal(readFileSync(join(gate.pathOf(project), 'HEAD'), 'utf8').trim(), 'ref: refs/heads/main');
    await studio.settle();
  } finally {
    await d.cleanup();
    mine.cleanup();
  }
});

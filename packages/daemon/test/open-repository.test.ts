// The open repository's ground: a project may have its product in a folder of its repository, and may have been
// brought in from a checkout. What is about the product runs in that folder; what is about the repository runs
// at its root. The fake docker gives the container a directory, and every script here is the one the daemon runs.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { Project, ScreenSpec } from '@studio-zero/protocol';
import { ConfigSchema, testConfig } from '../src/config.ts';
import { Store } from '../src/db/Store.ts';
import { migrate } from '../src/db/schema.ts';
import { scopeOf } from '../src/product/scope.ts';
import { OrbStackManager, SandboxError, productDir, resolveInProject } from '../src/sandbox/OrbStackManager.ts';
import { changedFilesScript, depsScript, fromProduct } from '../src/sandbox/scripts.ts';
import { dockerArgs, localDocker, sampleProject, tempDir } from './helpers.ts';

test('migration 20 gives every project an empty root and no origin', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db, 19);
  db.prepare("INSERT INTO projects (id, slug, name, template, created_at) VALUES ('prj_old', 'old-one', 'Old', 'mobile-expo', 1)").run();
  migrate(db);
  const row = db.prepare('SELECT root, adopted_json FROM projects WHERE id = ?').get('prj_old') as { root: string; adopted_json: string | null };
  assert.deepEqual({ ...row }, { root: '', adopted_json: null });
});

test('a project keeps its root and where it was adopted from', () => {
  const store = new Store(':memory:');
  store.insertProject(sampleProject('plain'));
  store.insertProject({ ...sampleProject('credeal'), template: 'mobile-expo', root: 'app', adopted: { path: '/Users/someone/credeal', base: 'main' } });
  assert.deepEqual([store.getProject('prj_plain')!.root, store.getProject('prj_plain')!.adopted], ['', null]);
  const kept = store.getProjectBySlug('credeal')!;
  assert.equal(kept.root, 'app');
  assert.deepEqual(kept.adopted, { path: '/Users/someone/credeal', base: 'main' });
});

test('a config written before a kind existed keeps that kind on its default route', () => {
  const parsed = ConfigSchema.parse({ routes: { build: [{ engine: 'codex', model: 'default', effort: 'high' }] } });
  assert.equal(parsed.routes.build[0]!.engine, 'codex');
  assert.ok(parsed.routes.adopt.length > 0, 'adopt has a route though the file named none');
  assert.ok(parsed.routes.inline_edit.length > 0);
});

test('a product folder is a folder inside the repository and nothing else', () => {
  const at = (root: string): Pick<Project, 'root'> => ({ root });
  assert.equal(productDir(at('')), '/workspace');
  assert.equal(productDir({}), '/workspace');
  assert.equal(productDir(at('app')), '/workspace/app');
  assert.equal(productDir(at('apps/mobile')), '/workspace/apps/mobile');
  for (const bad of ['../x', '/etc', 'a b', '-rf', 'a/../b', 'app/', '.git']) assert.throws(() => productDir(at(bad)), SandboxError, bad);
  // A tool's path is relative to the product, may reach the rest of the repository, and may not leave it.
  assert.equal(resolveInProject(at('app'), 'src/a.ts'), '/workspace/app/src/a.ts');
  assert.equal(resolveInProject(at('app'), '../docs/plan.md'), '/workspace/docs/plan.md');
  assert.equal(resolveInProject(at('app'), '/workspace/README.md'), '/workspace/README.md');
  assert.throws(() => resolveInProject(at('app'), '../../etc/passwd'), SandboxError);
  assert.equal(resolveInProject(at(''), 'src/a.ts'), '/workspace/src/a.ts');
});

test('a path from the repository root is said from the product folder', () => {
  assert.equal(fromProduct('', 'src/a.ts'), 'src/a.ts');
  assert.equal(fromProduct('app', 'app/src/a.ts'), 'src/a.ts');
  assert.equal(fromProduct('app', 'docs/plan.md'), '../docs/plan.md');
  assert.equal(fromProduct('apps/mobile', 'packages/ui/button.tsx'), '../../packages/ui/button.tsx');
  assert.equal(fromProduct('app', 'application/x.ts'), '../application/x.ts', 'a folder that only begins like the product folder is outside it');
});

async function rig(root: string) {
  const [home, ws] = [tempDir(), tempDir('sz-ws-')];
  const docker = localDocker(ws.dir);
  const store = new Store(':memory:');
  const project: Project = { ...sampleProject('credeal'), template: 'mobile-expo', root };
  store.insertProject(project);
  const sandboxes = new OrbStackManager({ config: testConfig(home.dir), store, clock: () => 1, run: docker.run });
  const cleanup = (): void => {
    home.cleanup();
    ws.cleanup();
  };
  return { sandboxes, project, ws: ws.dir, cleanup };
}

test('a command of a project with a root runs in its product folder, and the git scripts in the repository', async () => {
  const { sandboxes, project, ws, cleanup } = await rig('app');
  try {
    // The sandbox is made before the product folder exists (it arrives with the repository): nothing in that needs it.
    await sandboxes.ensure(project);
    mkdirSync(join(ws, 'app', 'src'), { recursive: true });
    mkdirSync(join(ws, 'docs'), { recursive: true });
    writeFileSync(join(ws, 'docs', 'plan.md'), '# plan\n');
    await sandboxes.writeFile(project, 'src/home.tsx', 'export const a = 1;\n');
    assert.equal((await sandboxes.exec(project, 'pwd -P')).stdout.trim().endsWith('/app'), true, 'a command runs in the product folder');
    assert.equal((await sandboxes.exec(project, 'cat src/home.tsx')).stdout, 'export const a = 1;\n');
    assert.equal((await sandboxes.readFile(project, '../docs/plan.md')).content, '# plan\n', 'the rest of the repository is in reach');
    // A commit takes the whole repository, not the product folder alone.
    await sandboxes.commitAll(project, 'feat: a screen and a plan');
    const tracked = (await sandboxes.exec(project, 'git ls-files', { cwd: '/workspace' })).stdout.trim().split('\n').sort();
    assert.deepEqual(tracked, ['app/src/home.tsx', 'docs/plan.md']);
    // What a branch changed is listed from the repository's root, and said from the product's folder.
    await sandboxes.startBranch(project, 'sz/edit', 'main');
    await sandboxes.writeFile(project, 'src/home.tsx', 'export const a = 2;\n');
    await sandboxes.writeFile(project, '../docs/new.md', 'new\n');
    const listed = await sandboxes.exec(project, changedFilesScript({ workspace: '/workspace', base: 'main' }), { cwd: '/workspace' });
    assert.deepEqual(listed.stdout.trim().split('\n').map((file) => fromProduct('app', file)), ['src/home.tsx', '../docs/new.md']);
    // A checkpoint and a rollback are the repository's too.
    const before = await sandboxes.checkpoint(project, 'before');
    await sandboxes.writeFile(project, '../docs/plan.md', '# changed\n');
    await sandboxes.rollback(project, before.id);
    assert.equal((await sandboxes.readFile(project, '../docs/plan.md')).content, '# plan\n');
  } finally {
    cleanup();
  }
});

test('a brought-in product runs on this machine\'s clock, and one the studio builds on the sandbox\'s', async () => {
  const [home, ws] = [tempDir(), tempDir('sz-ws-')];
  const docker = localDocker(ws.dir);
  const store = new Store(':memory:');
  const house = sampleProject('ledger');
  const brought: Project = { ...sampleProject('credeal'), adopted: { path: '/Users/someone/credeal', base: 'main' } };
  for (const project of [house, brought]) store.insertProject(project);
  const sandboxes = new OrbStackManager({ config: testConfig(home.dir), store, clock: () => 1, run: docker.run });
  try {
    await sandboxes.ensure(house);
    await sandboxes.ensure(brought);
    const made = (name: string): string[] => docker.calls.map((call) => dockerArgs(call.args)).find((args) => args[0] === 'run' && args.includes(name)) ?? [];
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    assert.ok(made('sz-credeal').includes(`TZ=${zone}`), made('sz-credeal').join(' '));
    assert.ok(!made('sz-ledger').some((word) => word.startsWith('TZ=')));
  } finally {
    home.cleanup();
    ws.cleanup();
  }
});

test('dependencies are installed where the product is, once for a lockfile', async () => {
  const { sandboxes, project, ws, cleanup } = await rig('app');
  try {
    await sandboxes.ensure(project);
    mkdirSync(join(ws, 'app'), { recursive: true });
    assert.equal((await sandboxes.exec(project, depsScript({ workspace: productDir(project) }), { cwd: '/workspace' })).stdout.trim(), 'none', 'nothing to install by');
    // A lockfile of a manager that is not on this machine's path would fail the install: the marker is what is under test.
    writeFileSync(join(ws, 'app', 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
    writeFileSync(join(ws, 'app', 'package.json'), '{"name":"p","version":"1.0.0"}\n');
    const first = await sandboxes.exec(project, depsScript({ workspace: productDir(project) }), { cwd: '/workspace', timeoutSec: 120 });
    assert.equal(first.exitCode, 0, first.stderr);
    assert.equal(first.stdout.trim(), 'installed');
    assert.equal((await sandboxes.exec(project, depsScript({ workspace: productDir(project) }), { cwd: '/workspace' })).stdout.trim(), 'kept');
    writeFileSync(join(ws, 'app', 'package-lock.json'), '{"lockfileVersion":3,"name":"p","packages":{}}\n');
    assert.equal((await sandboxes.exec(project, depsScript({ workspace: productDir(project) }), { cwd: '/workspace', timeoutSec: 120 })).stdout.trim(), 'installed', 'a lockfile that changed is installed for again');
  } finally {
    cleanup();
  }
});

const SPEC: ScreenSpec = {
  coreMoment: 'x',
  screens: ['A-01', 'B-01', 'C-01'].map((id) => ({ id, name: id, purpose: 'p', entry: ['open'], elements: [], states: [], exceptions: [] })),
  tasks: [],
  events: [],
  roles: [{ id: 'user', name: 'User', does: 'd' }],
  entry: null,
  noAccounts: 'kept on the device',
  scenarios: ['a', 'b', 'c'].map((id, i) => ({ id, role: 'user', steps: [{ id: `do-${id}`, screen: ['A-01', 'B-01', 'C-01'][i]!, does: 'd', outcome: 'o' }] })),
  data: [],
};

test('a change outside the product folder is walked for in full', () => {
  const reach = { affected: ['src/a.tsx'], named: { 'src/a.tsx': ['A-01'] }, screenFiles: 3, loose: [] };
  const inside = scopeOf({ changed: ['src/a.tsx'], spec: SPEC, reach, trails: null });
  assert.equal(inside.kind, 'some');
  const both = scopeOf({ changed: ['src/a.tsx', '../packages/ui/button.tsx'], spec: SPEC, reach, trails: null });
  assert.equal(both.kind, 'all');
  assert.match(both.kind === 'all' ? both.why : '', /outside the product's folder/);
  // A document outside it is a document.
  assert.equal(scopeOf({ changed: ['../docs/plan.md'], spec: SPEC, reach, trails: null }).kind, 'none');
  assert.equal(scopeOf({ changed: ['src/a.tsx', '../docs/plan.md'], spec: SPEC, reach, trails: null }).kind, 'some');
});

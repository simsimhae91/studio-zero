import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { RpcCallError, RpcClient } from '@studio-zero/protocol';
import { ConflictError, NotFoundError } from '../src/app/errors.ts';
import { testConfig } from '../src/config.ts';
import { Store } from '../src/db/Store.ts';
import { OrbStackManager } from '../src/sandbox/OrbStackManager.ts';
import { MAX_READ_BYTES, SandboxFileService } from '../src/sandbox/SandboxFileService.ts';
import { localDocker, sampleProject, tempDir, testDaemon } from './helpers.ts';

async function setup() {
  const home = tempDir();
  const ws = tempDir('sz-ws-');
  const outside = tempDir('sz-outside-');
  const docker = localDocker(ws.dir);
  const store = new Store(':memory:');
  const project = sampleProject();
  store.insertProject(project);
  const sandboxes = new OrbStackManager({ config: testConfig(home.dir), store, clock: () => 1000, run: docker.run });
  await sandboxes.ensure(project);
  const files = new SandboxFileService({ sandboxes });
  const file = (rel: string): string => join(ws.dir, rel);
  const put = (rel: string, content: string | Buffer): void => {
    mkdirSync(join(file(rel), '..'), { recursive: true });
    writeFileSync(file(rel), content);
  };
  return { files, project, file, put, outside: outside.dir, cleanup: () => (home.cleanup(), ws.cleanup(), outside.cleanup()) };
}

test('files.list follows .gitignore, always leaves out heavy directories, and lists one level at a time', async () => {
  const { files, project, put, file, cleanup } = await setup();
  try {
    put('.gitignore', 'secret.env\n*.log\ngenerated/\n');
    put('package.json', '{}\n');
    put('README.md', '# hi\n');
    put('secret.env', 'TOKEN=abc\n');
    put('debug.log', 'noise\n');
    put('src/App.tsx', 'export const App = () => null;\n');
    put('src/lib/format.ts', 'export const x = 1;\n');
    put('src/lib/deep/more.ts', 'export const y = 2;\n');
    put('generated/out.js', 'x\n');
    put('node_modules/react/index.js', 'module.exports = {}\n'); // not in .gitignore here: still never listed
    put('dist/bundle.js', 'x\n');
    put('.next/cache/x', 'x\n');
    put('.studio-zero/project.json', '{}\n');
    mkdirSync(file('empty-dir'));

    const top = await files.list(project);
    assert.equal(top.truncated, false);
    assert.deepEqual(top.entries.map((e) => `${e.type === 'directory' ? 'd' : 'f'} ${e.path}`), ['d .studio-zero', 'd empty-dir', 'd src', 'f .gitignore', 'f package.json', 'f README.md'], 'directories first, then names; ignored and heavy entries are absent, an empty directory is not');
    const readme = top.entries.find((e) => e.path === 'README.md')!;
    assert.deepEqual([readme.name, readme.size, readme.type], ['README.md', 5, 'file']);
    assert.ok(readme.mtime > 1_600_000_000_000, 'mtime is epoch milliseconds');
    assert.equal(top.entries.find((e) => e.path === 'src')!.size, 0);

    assert.deepEqual((await files.list(project, 'src')).entries.map((e) => e.path), ['src/lib', 'src/App.tsx'], 'one level by default');
    assert.deepEqual((await files.list(project, 'src', 3)).entries.map((e) => e.path), ['src/lib', 'src/App.tsx', 'src/lib/deep', 'src/lib/format.ts', 'src/lib/deep/more.ts'], 'deeper on request, level by level');
    assert.deepEqual((await files.list(project, '/workspace/src/lib')).entries.map((e) => e.path), ['src/lib/deep', 'src/lib/format.ts'], 'an absolute path inside the workspace is the same place');

    await assert.rejects(files.list(project, 'nope'), NotFoundError);
    await assert.rejects(files.list(project, 'README.md'), ConflictError);
    await assert.rejects(files.list(project, '../..'), /escapes/);
    await assert.rejects(files.list(project, '/etc'), /escapes/);
  } finally {
    cleanup();
  }
});

test('files.read returns text with its size, marks binaries and oversize files, and will not follow a link out of the workspace', async () => {
  const { files, project, put, file, outside, cleanup } = await setup();
  try {
    put('src/hello.ts', 'export const greeting = "안녕하세요 $(whoami) `id`";\n');
    put('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
    put('big.txt', 'x'.repeat(MAX_READ_BYTES + 10));
    writeFileSync(join(outside, 'host-secret.txt'), 'not for the viewer\n');
    symlinkSync(join(outside, 'host-secret.txt'), file('escape-link'));
    symlinkSync(file('src/hello.ts'), file('inside-link'));

    const hello = await files.read(project, 'src/hello.ts');
    assert.deepEqual(hello, { content: 'export const greeting = "안녕하세요 $(whoami) `id`";\n', encoding: 'utf-8', size: Buffer.byteLength(hello.content), truncated: false, binary: false });
    assert.deepEqual(await files.read(project, 'logo.png'), { content: '', encoding: 'utf-8', size: 8, truncated: false, binary: true });
    const big = await files.read(project, 'big.txt');
    assert.deepEqual([big.size, big.truncated, big.content.length], [MAX_READ_BYTES + 10, true, MAX_READ_BYTES]);
    assert.equal((await files.read(project, 'inside-link')).content, hello.content, 'a link that stays inside is read');

    await assert.rejects(files.read(project, 'escape-link'), (err: unknown) => err instanceof ConflictError && /leaves the workspace/.test(err.message));
    await assert.rejects(files.read(project, 'src'), ConflictError);
    await assert.rejects(files.read(project, 'missing.ts'), NotFoundError);
    await assert.rejects(files.read(project, '../outside.txt'), /escapes/);
    await assert.rejects(files.read(project, '.'), ConflictError);
  } finally {
    cleanup();
  }
});

test('files.write creates parents, keeps shell metacharacters literal, and refuses .git and paths outside', async () => {
  const { files, project, file, cleanup } = await setup();
  try {
    const content = 'const a = `${"$HOME"}`; // $(rm -rf /) \'quoted\'\n';
    await files.write(project, 'src/new/dir/file.ts', content);
    assert.equal(readFileSync(file('src/new/dir/file.ts'), 'utf8'), content);
    assert.equal((await files.read(project, 'src/new/dir/file.ts')).content, content, 'what was written is what is read back');
    await files.write(project, 'src/new/dir/file.ts', 'replaced\n');
    assert.equal(readFileSync(file('src/new/dir/file.ts'), 'utf8'), 'replaced\n');

    await assert.rejects(files.write(project, '.git/config', 'x'), (err: unknown) => err instanceof ConflictError && /\.git/.test(err.message));
    await assert.rejects(files.write(project, 'sub/.git/hooks/pre-commit', 'x'), ConflictError);
    await assert.rejects(files.write(project, '../escape.txt', 'x'), /escapes/);
    await assert.rejects(files.write(project, '/etc/passwd', 'x'), /escapes/);
    assert.ok(!existsSync(join(file('.'), '..', 'escape.txt')));
  } finally {
    cleanup();
  }
});

test('files over RPC: the owner lists, reads and writes; the write is a policy-checked sandbox.write', async () => {
  const t = await testDaemon();
  await t.daemon.start();
  const rpc = new RpcClient({ url: t.url(), token: t.daemon.clientToken.expose(), client: 'test' });
  try {
    const project = await rpc.call('projects.create', { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
    // The first listing may race the background provisioning; both take the same lock, so it simply waits.
    for (let i = 0; i < 200 && !existsSync(join(t.workspace, '.studio-zero/project.json')); i++) await new Promise((r) => setTimeout(r, 10));

    const listed = await rpc.call('files.list', { projectId: project.id });
    assert.deepEqual(listed.entries.map((e) => e.path), ['.studio-zero']);
    assert.ok((await rpc.call('files.list', { projectId: project.id, path: '.studio-zero', depth: 1 })).entries.some((e) => e.path === '.studio-zero/project.json'));

    assert.deepEqual(await rpc.call('files.write', { projectId: project.id, path: 'src/main.ts', content: 'export {};\n' }), { written: true });
    assert.deepEqual(await rpc.call('files.read', { projectId: project.id, path: 'src/main.ts' }), { content: 'export {};\n', encoding: 'utf-8', size: 11, truncated: false, binary: false });
    assert.equal(readFileSync(join(t.workspace, 'src/main.ts'), 'utf8'), 'export {};\n');

    await assert.rejects(rpc.call('files.write', { projectId: project.id, path: '../../escape.txt', content: 'x' }), (e: unknown) => e instanceof RpcCallError && e.code === 'policy_denied');
    await assert.rejects(rpc.call('files.read', { projectId: project.id, path: 'nope.ts' }), (e: unknown) => e instanceof RpcCallError && e.code === 'not_found');
    await assert.rejects(rpc.call('files.list', { projectId: 'prj_missing' }), (e: unknown) => e instanceof RpcCallError && e.code === 'not_found');
    await assert.rejects(rpc.call('files.list', { projectId: project.id, depth: 99 }), (e: unknown) => e instanceof RpcCallError && e.code === 'invalid_params');

    const decisions = t.daemon.events.history({ projectId: project.id }, 0, 200).filter((e) => e.body.type === 'policy.decision');
    assert.ok(decisions.some((e) => e.body.type === 'policy.decision' && e.body.rule === 'sandbox.write-inside-workspace' && e.body.effect === 'deny'));
  } finally {
    rpc.close();
    await t.cleanup();
  }
});

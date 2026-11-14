import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { testConfig } from '../src/config.ts';
import { Store } from '../src/db/Store.ts';
import { OrbStackManager, SandboxError, parsePortOutput, qaBrowserDockerfile, resolveInWorkspace, sandboxNames } from '../src/sandbox/OrbStackManager.ts';
import { assertBranchName } from '../src/sandbox/scripts.ts';
import { extractorScript, parseExtraction } from '../src/sandbox/extract.ts';
import { sha256Hex } from '../src/util/core.ts';
import { dockerArgs, localDocker, sampleProject, tempDir } from './helpers.ts';

function setup() {
  const home = tempDir();
  const ws = tempDir('sz-ws-');
  const docker = localDocker(ws.dir);
  const config = testConfig(home.dir);
  const store = new Store(':memory:');
  const project = sampleProject();
  store.insertProject(project);
  const sandboxes = new OrbStackManager({ config, store, clock: () => 1000, run: docker.run });
  const file = (rel: string): string => join(ws.dir, rel);
  return { sandboxes, store, project, docker, config, file, ws: ws.dir, cleanup: () => (home.cleanup(), ws.cleanup()) };
}

test('ensure() creates a hardened container and keeps the gateway token out of argv and out of the database', async () => {
  const { sandboxes, store, project, docker, cleanup } = setup();
  const info = await sandboxes.ensure(project);
  assert.equal(info.state, 'running');
  assert.deepEqual(info.previewUrls[0], { containerPort: 5173, localhost: 'http://localhost:55173', orbLocal: 'http://sz-ledger.orb.local:5173' });

  const create = docker.calls.find((c) => c.args.includes('run') && c.args.includes('--detach'))!;
  const line = dockerArgs(create.args).join(' '); // the container's own flags, without the client's --config/--host
  assert.deepEqual([create.args[0], create.args[2], create.args[3]], ['--config', '--host', 'unix:///emulated/docker.sock'], 'own client config, explicit engine socket');
  for (const flag of ['--user 1000:1000', '--cap-drop ALL', '--security-opt no-new-privileges', '--pids-limit 512', '--memory 2048m', '--network sz-ledger-net', 'type=volume,source=sz-ledger-ws,target=/workspace,volume-nocopy', '--publish 127.0.0.1::5173']) {
    assert.ok(line.includes(flag), `missing ${flag}`);
  }
  assert.ok(!/docker\.sock|--privileged|type=bind/.test(line), 'no host mounts, no socket, not privileged');

  // The sandbox-scoped token reaches the container through the docker client's environment only.
  const token = create.env?.ANTHROPIC_API_KEY ?? '';
  assert.match(token, /^szg_[\w-]{32}$/);
  assert.ok(!line.includes(token), 'token must not appear in the argument list');
  assert.ok(line.includes('--env ANTHROPIC_API_KEY ') && line.includes('--env ANTHROPIC_BASE_URL=http://host.docker.internal:'));
  const row = store.getSandbox(project.id)!;
  assert.equal(row.gatewayTokenHash, sha256Hex(token));
  assert.ok(!JSON.stringify(row).includes(token), 'only the hash is persisted');

  const before = docker.calls.length;
  await sandboxes.ensure(project);
  assert.ok(!docker.calls.slice(before).some((c) => c.args.includes('--detach')), 'ensure is idempotent');
  cleanup();
});

test('checkpoint and rollback restore the working tree exactly (real git)', async () => {
  const { sandboxes, project, file, cleanup } = setup();
  await sandboxes.ensure(project);
  writeFileSync(file('.gitignore'), 'node_modules/\n');
  writeFileSync(file('tracked.txt'), 'v1\n');
  writeFileSync(file('removed-later.txt'), 'keep me\n');
  await sandboxes.commitAll(project, 'initial');

  // State at checkpoint time: one committed file modified but uncommitted, one untracked file, one ignored dir.
  writeFileSync(file('tracked.txt'), 'v2 uncommitted\n');
  writeFileSync(file('untracked.txt'), 'draft\n');
  mkdirSync(file('node_modules/pkg'), { recursive: true });
  writeFileSync(file('node_modules/pkg/index.js'), 'ignored\n');
  const status = async (): Promise<string> => (await sandboxes.exec(project, 'git status --porcelain && git rev-parse --abbrev-ref HEAD && git rev-parse HEAD')).stdout;
  const statusAtCheckpoint = await status();
  const checkpoint = await sandboxes.checkpoint(project, 'before experiment');
  assert.match(checkpoint.commit, /^[0-9a-f]{40}$/);
  assert.equal(await status(), statusAtCheckpoint, 'taking a checkpoint does not disturb HEAD, the index or the tree');

  // The "experiment": edits, a new file, a deletion, new commits, and a branch switch.
  writeFileSync(file('tracked.txt'), 'v3 broken\n');
  writeFileSync(file('created-after.txt'), 'should disappear\n');
  rmSync(file('removed-later.txt'));
  await sandboxes.commitAll(project, 'experiment 1');
  await sandboxes.startBranch(project, 'sz/experiment', 'main');
  writeFileSync(file('untracked.txt'), 'overwritten\n');
  writeFileSync(file('node_modules/pkg/index.js'), 'ignored, changed\n');

  const { restored, safety } = await sandboxes.rollback(project, checkpoint.id);
  assert.equal(restored.id, checkpoint.id);
  assert.equal(readFileSync(file('tracked.txt'), 'utf8'), 'v2 uncommitted\n');
  assert.equal(readFileSync(file('untracked.txt'), 'utf8'), 'draft\n');
  assert.equal(readFileSync(file('removed-later.txt'), 'utf8'), 'keep me\n');
  assert.ok(!existsSync(file('created-after.txt')), 'files created after the checkpoint are removed');
  assert.equal(readFileSync(file('node_modules/pkg/index.js'), 'utf8'), 'ignored, changed\n', 'ignored files are left alone');
  assert.equal(await status(), statusAtCheckpoint, 'branch, HEAD and uncommitted/untracked status are exactly as they were');

  // A rollback is itself undoable: restoring the safety checkpoint brings the experiment back.
  await sandboxes.rollback(project, safety.id);
  assert.equal(readFileSync(file('untracked.txt'), 'utf8'), 'overwritten\n');
  assert.ok(existsSync(file('created-after.txt')));
  assert.match(await status(), /sz\/experiment/);

  await assert.rejects(sandboxes.rollback(project, 'ckp_missing'), SandboxError);
  cleanup();
});

test('merge produces one revertable commit and aborts cleanly on conflict', async () => {
  const { sandboxes, project, file, cleanup } = setup();
  await sandboxes.ensure(project);
  writeFileSync(file('a.txt'), 'base\n');
  await sandboxes.commitAll(project, 'base');

  await sandboxes.startBranch(project, 'sz/feature', 'main');
  writeFileSync(file('b.txt'), 'feature\n');
  await sandboxes.commitAll(project, 'feature');
  const { stat, diff } = await sandboxes.diff(project, 'main', 'sz/feature');
  assert.deepEqual(stat, { files: 1, insertions: 1, deletions: 0 });
  assert.match(diff, /\+feature/);
  const merged = await sandboxes.merge(project, 'sz/feature', 'main');
  assert.match(merged, /^[0-9a-f]{40}$/);
  assert.match((await sandboxes.exec(project, 'git log -1 --format=%s%n%P')).stdout, /^merge: sz\/feature\n\w+ \w+/);

  await sandboxes.startBranch(project, 'sz/conflict', 'main');
  writeFileSync(file('a.txt'), 'theirs\n');
  await sandboxes.commitAll(project, 'theirs');
  await sandboxes.checkout(project, 'main');
  writeFileSync(file('a.txt'), 'ours\n');
  await sandboxes.commitAll(project, 'ours');
  await assert.rejects(sandboxes.merge(project, 'sz/conflict', 'main'), /conflicts/);
  assert.equal((await sandboxes.exec(project, 'git status --porcelain')).stdout, '', 'a failed merge leaves a clean tree');
  assert.equal(readFileSync(file('a.txt'), 'utf8'), 'ours\n');
  // Tried from the branch the owner was looking at, it leaves them on that branch.
  await sandboxes.checkout(project, 'sz/conflict');
  await assert.rejects(sandboxes.merge(project, 'sz/conflict', 'main'), /conflicts/);
  assert.equal((await sandboxes.exec(project, 'git branch --show-current')).stdout.trim(), 'sz/conflict');
  assert.equal(readFileSync(file('a.txt'), 'utf8'), 'theirs\n');
  cleanup();
});

test('file access and names are confined', async () => {
  const { sandboxes, project, cleanup } = setup();
  await sandboxes.ensure(project);
  await sandboxes.writeFile(project, 'src/deep/file.txt', 'hello $(whoami) `id` "quotes"\n');
  assert.equal((await sandboxes.readFile(project, 'src/deep/file.txt')).content, 'hello $(whoami) `id` "quotes"\n');
  await assert.rejects(sandboxes.writeFile(project, '../outside.txt', 'x'), /escapes/);
  await assert.rejects(sandboxes.exec(project, 'pwd', { cwd: '/etc' }), /escapes/);

  assert.equal(resolveInWorkspace('src/../a.txt'), '/workspace/a.txt');
  assert.throws(() => resolveInWorkspace('/workspace/../etc/passwd'), SandboxError);
  assert.throws(() => sandboxNames('x; rm -rf /'), SandboxError);
  for (const bad of ['-rf', 'a..b', 'a b', 'x;y', 'a/', 'refs.lock', '']) assert.throws(() => assertBranchName(bad), /invalid branch/, bad);
  for (const good of ['main', 'sz/tsk_abc123', 'kirby/prp_1', 'release-1.2']) assertBranchName(good);
  cleanup();
});

test('the QA browser image carries the Hangul face, so a screen is photographed in the face its theme names and not in the image\'s stand-in', () => {
  // Microsoft's Playwright image draws Hangul with WenQuanYi Zen Hei, a Chinese face: what the reviewer saw on every
  // screenshot of a Korean product until the face was put in the image.
  const recipe = qaBrowserDockerfile('1.65.0', undefined);
  assert.match(recipe, /^FROM mcr\.microsoft\.com\/playwright:v1\.65\.0-noble\n/);
  assert.match(recipe, /npm install -g playwright@1\.65\.0/);
  assert.match(recipe, /npm pack pretendard@1\.3\.9/, 'the same release the studio inlines into mock-ups');
  assert.match(recipe, /PretendardVariable\.ttf/);
  assert.match(recipe, /\/usr\/share\/fonts\//);
  // The file alone changed nothing for a page that fell to the generic family: fontconfig is told the face is Korean's and sans-serif's.
  assert.match(recipe, /> \/etc\/fonts\/conf\.d\/40-pretendard\.conf && fc-cache -f/);
  assert.match(recipe, /<alias binding="strong"><family>sans-serif<\/family><prefer><family>Pretendard Variable<\/family><\/prefer><\/alias>/);
  assert.match(recipe, /<test name="lang" compare="contains"><string>ko<\/string><\/test><edit name="family" mode="prepend" binding="strong"><string>Pretendard Variable<\/string><\/edit>/);
  assert.ok(!recipe.includes('`'), 'nothing in the recipe that a shell would run as a command');
  assert.ok(qaBrowserDockerfile('1.65.0', 'ghcr.io/x/browser:1').startsWith('FROM ghcr.io/x/browser:1\n'), 'an owner\'s own base image is kept');
  assert.notEqual(recipe, qaBrowserDockerfile('1.66.0', undefined));
});

test('docker port output parsing', () => {
  const ports = parsePortOutput('3000/tcp -> 127.0.0.1:55001\n3000/tcp -> [::1]:55001\n5173/tcp -> 0.0.0.0:49153\ngarbage\n');
  assert.deepEqual([...ports], [[3000, 55001], [5173, 49153]]);
});

test('the extractor lists a repository through git and its output is re-validated on the host', async () => {
  const { sandboxes, project, file, cleanup } = setup();
  await sandboxes.ensure(project);
  writeFileSync(file('.gitignore'), 'node_modules/\nsecret.env\n');
  mkdirSync(file('src'), { recursive: true });
  mkdirSync(file('node_modules/x'), { recursive: true });
  writeFileSync(file('src/app.ts'), 'export const a = 1;\n');
  writeFileSync(file('src/logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
  writeFileSync(file('pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  writeFileSync(file('node_modules/x/index.js'), 'module.exports = 1\n');
  writeFileSync(file('secret.env'), 'TOKEN=abc\n');
  writeFileSync(file('big.ts'), 'x'.repeat(5000));

  const limits = { maxFiles: 100, maxFileBytes: 1000, maxTotalBytes: 100_000 };
  const res = await sandboxes.exec(project, 'node -', { stdin: extractorScript(limits) });
  assert.equal(res.exitCode, 0, res.stderr);
  const { files, partial } = parseExtraction(res.stdout, limits);
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  assert.equal(partial, false);
  assert.equal(byPath.get('src/app.ts'), 'export const a = 1;\n');
  assert.equal(byPath.get('src/logo.png'), null, 'binary files are listed without content');
  assert.equal(byPath.get('pnpm-lock.yaml'), null, 'lockfiles are listed without content');
  assert.equal(byPath.get('big.ts'), null, 'oversized files are listed without content');
  assert.ok(!byPath.has('node_modules/x/index.js') && !byPath.has('secret.env'), 'ignored files are not listed at all');

  // The producer is not trusted: traversal paths, oversize content and junk lines are dropped on the host.
  const hostile = [
    JSON.stringify({ p: '../../etc/passwd', c: 'root' }),
    JSON.stringify({ p: '/abs/path.ts', c: 'x' }),
    JSON.stringify({ p: 'ok.ts', c: 'y'.repeat(2000) }),
    'not json',
    JSON.stringify({ p: 'fine.ts', c: 'z' }),
  ].join('\n');
  const parsed = parseExtraction(hostile, limits);
  assert.deepEqual(parsed.files, [{ path: 'ok.ts', content: null }, { path: 'fine.ts', content: 'z' }]);
  assert.equal(parsed.partial, true, 'output without the terminating line is treated as incomplete');
  cleanup();
});

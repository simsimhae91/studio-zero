// A copy of a product for someone to run beside it: what is committed, the installed dependencies, a stack name
// of its own. Verifiers, whoever shows the product to the owner while it is verified, and anyone who runs flows
// side by side made these by hand, each time (fourteen times in one first pass, 2026-11-17).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COPY_MARK, copyText, endCopy, makeCopy } from '../src/copy.ts';
import { saysDown, stacksOf } from '../src/supabase.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const git = (cwd: string, ...args: string[]): string => {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
};
const put = (root: string, path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

/** A product with one workspace, dependencies installed, a built folder, stored data and something uncommitted. */
function product(): { root: string; project: string; first: string; cleanup: () => void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sz-copy-')));
  const project = join(root, 'alpha');
  mkdirSync(project);
  git(project, 'init', '-q', '-b', 'main');
  put(project, '.gitignore', 'node_modules\ndist\ndata\n.stack\n');
  put(project, 'package.json', '{"name":"alpha"}\n');
  put(project, 'app/package.json', '{"name":"app"}\n');
  put(project, 'src/a.txt', 'committed\n');
  put(project, '.sz/map.md', '# map\n');
  put(project, '.sz/evidence/first/screens/a.png', 'a picture\n');
  put(project, 'supabase/config.toml', '# the stack\nproject_id = "alpha"\n\n[api]\nport = 54321\n');
  git(project, 'add', '-A');
  git(project, 'commit', '-q', '-m', 'first');
  const first = git(project, 'rev-parse', 'HEAD');
  put(project, 'src/b.txt', 'second\n');
  git(project, 'add', '-A');
  git(project, 'commit', '-q', '-m', 'second');
  put(project, 'node_modules/left-pad/index.js', 'module.exports = 1;\n');
  put(project, 'app/node_modules/dep/index.js', 'module.exports = 2;\n');
  put(project, 'dist/build.json', '{"commit":"x"}\n');
  put(project, 'data/app.db', 'what people entered\n');
  put(project, '.stack/env', 'SECRET=1\n');
  put(project, 'src/a.txt', 'being edited, not committed\n');
  put(project, 'scratch.txt', 'untracked\n');
  return { root, project, first, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('a copy holds what is committed and the installed dependencies, under a stack name of its own, and nothing the product stored', () => {
  const p = product();
  try {
    const folder = join(p.root, 'copies', 'v1');
    const made = makeCopy(p.project, folder, {});
    assert.equal(made.folder, folder);
    assert.equal(made.commit, git(p.project, 'rev-parse', 'HEAD'));
    assert.equal(readFileSync(join(folder, 'src/a.txt'), 'utf8'), 'committed\n', 'the file as committed, not as it is being edited');
    assert.equal(readFileSync(join(folder, 'src/b.txt'), 'utf8'), 'second\n');
    assert.equal(existsSync(join(folder, 'scratch.txt')), false, 'nothing uncommitted');
    assert.equal(existsSync(join(folder, '.git')), false, 'not a repository: nothing is committed from a copy');
    assert.equal(readFileSync(join(folder, '.sz/map.md'), 'utf8'), '# map\n');
    assert.equal(existsSync(join(folder, '.sz/evidence')), false, 'the pictures kept as evidence stay in the project');
    assert.equal(readFileSync(join(folder, 'node_modules/left-pad/index.js'), 'utf8'), 'module.exports = 1;\n');
    assert.equal(readFileSync(join(folder, 'app/node_modules/dep/index.js'), 'utf8'), 'module.exports = 2;\n');
    assert.deepEqual(made.cloned, ['node_modules', 'app/node_modules']);
    assert.equal(existsSync(join(folder, 'data')), false, 'what the product stored is never copied');
    assert.equal(existsSync(join(folder, '.stack')), false);
    assert.equal(existsSync(join(folder, 'dist')), false, 'a built folder only when asked for');
    assert.equal(made.stack, 'alpha-v1');
    // The Supabase command line this house uses keeps a stack by the folder it was started in (seen on the first real copy,
    // 2026-11-18: a copy's stack ran under the folder's name, whatever the file said), so the copy says where it is started and stopped.
    assert.match(readFileSync(join(folder, 'supabase/config.toml'), 'utf8'), /^# the stack\nproject_id = "alpha-v1"\n\n\[api\]\nport = 54321\n$/);
    assert.match(readFileSync(join(p.project, 'supabase/config.toml'), 'utf8'), /project_id = "alpha"\n/, 'the project is not touched');

    // What the map says is built and not in git comes along when it is named; an earlier commit can be asked for.
    const older = makeCopy(p.project, join(p.root, 'copies', 'at-first'), { at: p.first, with: ['dist'] });
    assert.equal(older.commit, p.first);
    assert.equal(existsSync(join(older.folder, 'src/b.txt')), false);
    assert.equal(readFileSync(join(older.folder, 'dist/build.json'), 'utf8'), '{"commit":"x"}\n');
    assert.deepEqual(older.cloned, ['node_modules', 'app/node_modules', 'dist']);
    assert.equal(older.stack, 'alpha-at-first');
  } finally {
    p.cleanup();
  }
});

test('a copy is refused where it would be taken for the product, over something that is there, or of what is not there', () => {
  const p = product();
  try {
    assert.throws(() => makeCopy(p.project, join(p.project, 'copy'), {}), /outside the project's folder/);
    mkdirSync(join(p.root, 'taken'));
    writeFileSync(join(p.root, 'taken', 'x'), 'x');
    assert.throws(() => makeCopy(p.project, join(p.root, 'taken'), {}), /is not empty/);
    assert.throws(() => makeCopy(p.project, join(p.root, 'c1'), { at: 'no-such-commit' }), /no commit "no-such-commit"/);
    assert.throws(() => makeCopy(p.project, join(p.root, 'c2'), { with: ['../elsewhere'] }), /inside the project/);
    assert.throws(() => makeCopy(p.project, join(p.root, 'c3'), { with: ['nothing-here'] }), /nothing-here is not there/);
    assert.throws(() => makeCopy(p.project, join(p.root, 'c4'), { with: ['src'] }), /src is part of what is committed/);
    assert.throws(() => makeCopy(join(p.root, 'not-a-project'), join(p.root, 'c5'), {}), /not a git repository|is not there/);
    for (const name of ['c1', 'c2', 'c3', 'c4', 'c5']) assert.equal(existsSync(join(p.root, name)), false, `${name}: a refused copy leaves nothing behind`);
  } finally {
    p.cleanup();
  }
});

test('from the command line: the folder is the last line, and a product with no stack of this kind is copied as it is', () => {
  const p = product();
  try {
    rmSync(join(p.project, 'supabase'), { recursive: true });
    git(p.project, 'add', '-A', 'supabase');
    git(p.project, 'commit', '-q', '-m', 'no stack');
    const folder = join(p.root, 'shown');
    const run = spawnSync(process.execPath, [join(HERE, '../src/cli.ts'), 'copy', folder, '--with', 'dist', '--dir', p.project], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const lines = run.stdout.trim().split('\n');
    assert.equal(lines.at(-1), folder);
    assert.match(run.stdout, /dependencies and built folders cloned: node_modules, app\/node_modules, dist/);
    assert.doesNotMatch(run.stdout, /its stack is its own/);
    assert.match(run.stdout, /Launch it there the way the map says, on a port of its own \(PORT=\$\(sz-eyes port\)\)/);
    assert.ok(run.stdout.includes(`end the copy: sz-eyes copy ${folder} --end (it removes the folder)`), run.stdout);
    const refused = spawnSync(process.execPath, [join(HERE, '../src/cli.ts'), 'copy', folder, '--dir', p.project], { encoding: 'utf8' });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /is not empty/);
  } finally {
    p.cleanup();
  }
});

test('a copy is ended in one step: every stack started in it is stopped by its id first, and the folder goes only when that worked', async () => {
  // (2026-11-19: a verifier stopped two copies' stacks with a flag the command does not have, threw away what it
  // said, and removed the folders. A stack is known by its folder: the two ran on with nothing to stop them from.)
  const p = product();
  try {
    const folder = join(p.root, 'copies', 'v1');
    const made = makeCopy(p.project, folder, {});
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(folder, COPY_MARK), 'utf8'))), ['of', 'commit', 'made']);
    const said = copyText(made, p.project);
    assert.ok(said.includes(`end the copy: sz-eyes copy ${folder} --end (it stops the copy's stack and then removes the folder; never remove the folder yourself`), said);
    assert.equal(said.trim().split('\n').at(-1), folder);

    // A stack of the copy's does not stop: the folder stays, and it is said why and how it is stopped.
    const asked: string[] = [];
    const ID = 'a'.repeat(64);
    const one = { of: () => [ID] };
    await assert.rejects(endCopy(folder, { ...one, stop: async (id, cwd) => (asked.push(`${id.slice(0, 4)} ${cwd}`), false) }), /the stack aaaaaaaaaaaa of .*copies\/v1 did not stop[^,]*, so the folder is kept[^]*sz-eyes supabase stop --stack-id aaaaaaaaaaaa/);
    assert.deepEqual(asked, [`aaaa ${folder}`]);
    assert.equal(existsSync(join(folder, 'src/a.txt')), true);

    // Two stacks were started in it (one before it was made a repository, one after): the folder goes only when
    // both are down, and each is stopped by its id.
    const TWO = ['a'.repeat(64), 'b'.repeat(64)];
    await assert.rejects(endCopy(folder, { of: () => TWO, stop: async (id) => id.startsWith('a') }), /the stack bbbbbbbbbbbb of/);
    assert.equal(existsSync(join(folder, 'src/a.txt')), true);
    const stopped: string[] = [];
    assert.deepEqual(await endCopy(folder, { of: (copy) => (stopped.push(`of ${copy}`), TWO), stop: async (id) => (stopped.push(id.slice(0, 2)), true) }), { folder, stacks: 2 });
    assert.equal(existsSync(folder), false);
    assert.deepEqual(stopped, [`of ${folder}`, 'aa', 'bb']);

    // A folder of the product's own, or any folder a copy was not made in, is never ended this way.
    await assert.rejects(endCopy(p.project, { of: () => (asked.push('project'), [ID]), stop: async () => (asked.push('project'), true) }), /was not made by sz-eyes copy[^:]*: nothing was stopped and nothing removed/);
    assert.equal(asked.includes('project'), false, 'its stacks are neither looked up nor stopped');
    assert.equal(existsSync(join(p.project, 'src/a.txt')), true);
    await assert.rejects(endCopy(join(p.root, 'gone'), { of: () => [], stop: async () => true }), /is not there/);

    // From the command line, a copy of a product with no stack of this kind: the folder goes, and nothing else is asked.
    rmSync(join(p.project, 'supabase'), { recursive: true });
    git(p.project, 'add', '-A', 'supabase');
    git(p.project, 'commit', '-q', '-m', 'no stack');
    const plain = join(p.root, 'plain');
    assert.equal(spawnSync(process.execPath, [join(HERE, '../src/cli.ts'), 'copy', plain, '--dir', p.project], { encoding: 'utf8' }).status, 0);
    const ended = spawnSync(process.execPath, [join(HERE, '../src/cli.ts'), 'copy', plain, '--end'], { encoding: 'utf8' });
    assert.equal(ended.status, 0, ended.stderr);
    assert.match(ended.stdout, /^ended: .*plain \(the folder removed\)\. What you started there yourself/);
    assert.equal(existsSync(plain), false);
    const twice = spawnSync(process.execPath, [join(HERE, '../src/cli.ts'), 'copy', plain, '--end'], { encoding: 'utf8' });
    assert.equal(twice.status, 1);
    assert.match(twice.stderr, /is not there/);
  } finally {
    p.cleanup();
  }
});

test('the stacks of a folder are found by what the command line keeps of them, whatever branch they were started on', () => {
  // (2026-11-19: a verifier ran `git init` in a copy whose stack was up. The command line finds a folder's stack by
  // the folder and its git branch together, so the stop run from the folder found none, said so, and exited 0:
  // the copy was reported ended with its stack stopped, and the stack ran on for three hours.)
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sz-stacks-')));
  try {
    const home = join(root, 'home');
    const copy = join(root, 'copies', 'v1');
    mkdirSync(copy, { recursive: true });
    const keep = (id: string, state: unknown): void => {
      mkdirSync(join(home, '.supabase', 'stacks', id), { recursive: true });
      writeFileSync(join(home, '.supabase', 'stacks', id, 'state.json'), typeof state === 'string' ? state : JSON.stringify(state));
    };
    keep('1'.repeat(64), { id: '1'.repeat(64), identity: { projectRoot: copy, branchContext: null, stackName: 'default' } });
    keep('2'.repeat(64), { id: '2'.repeat(64), identity: { projectRoot: copy, branchContext: 'refs/heads/main', stackName: 'default' } });
    keep('3'.repeat(64), { id: '3'.repeat(64), identity: { projectRoot: join(root, 'copies', 'v1b'), branchContext: null, stackName: 'default' } });
    keep('4'.repeat(64), 'not json');
    mkdirSync(join(home, '.supabase', 'stacks', '5'.repeat(64)));
    assert.deepEqual(stacksOf(copy, { HOME: home }), ['1'.repeat(64), '2'.repeat(64)], 'both branches of the one folder, and no neighbour whose name begins the same');
    // The folder named through a link (as /tmp is on macOS) is the same folder.
    symlinkSync(join(root, 'copies'), join(root, 'link'));
    assert.deepEqual(stacksOf(join(root, 'link', 'v1'), { HOME: home }), ['1'.repeat(64), '2'.repeat(64)]);
    assert.deepEqual(stacksOf(join(root, 'nowhere'), { HOME: home }), []);
    assert.deepEqual(stacksOf(copy, { HOME: join(root, 'no-home') }), [], 'a machine that never started a stack has none');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const id = 'a'.repeat(64);
  assert.equal(saysDown(`{"stopped":["${id}"],"not_running":[],"message":""}\n`, id), true);
  assert.equal(saysDown(`A new version is available\n{"stopped":[],"not_running":["${id}"],"message":""}\n`, id), true, 'already down is down');
  assert.equal(saysDown('{"found":false,"message":"No managed stack found for this context."}\n', id), false, 'an answer that names no stack stopped nothing');
  assert.equal(saysDown(`{"stopped":["${'b'.repeat(64)}"],"not_running":[],"message":""}\n`, id), false);
  assert.equal(saysDown('', id), false);
});


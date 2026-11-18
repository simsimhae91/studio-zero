// A copy of a product for someone to run beside it: what is committed, the installed dependencies, a stack name
// of its own. Verifiers, whoever shows the product to the owner while it is verified, and anyone who runs flows
// side by side made these by hand, each time (fourteen times in one first pass, 2026-11-17).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeCopy } from '../src/copy.ts';

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
    assert.equal(readFileSync(join(folder, 'node_modules/left-pad/index.js'), 'utf8'), 'module.exports = 1;\n');
    assert.equal(readFileSync(join(folder, 'app/node_modules/dep/index.js'), 'utf8'), 'module.exports = 2;\n');
    assert.deepEqual(made.cloned, ['node_modules', 'app/node_modules']);
    assert.equal(existsSync(join(folder, 'data')), false, 'what the product stored is never copied');
    assert.equal(existsSync(join(folder, '.stack')), false);
    assert.equal(existsSync(join(folder, 'dist')), false, 'a built folder only when asked for');
    assert.equal(made.stack, 'alpha-v1');
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
    assert.doesNotMatch(run.stdout, /its stack is named/);
    assert.match(run.stdout, /Launch it there the way the map says, on a port of its own \(PORT=\$\(sz-eyes port\)\)/);
    const refused = spawnSync(process.execPath, [join(HERE, '../src/cli.ts'), 'copy', folder, '--dir', p.project], { encoding: 'utf8' });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /is not empty/);
  } finally {
    p.cleanup();
  }
});

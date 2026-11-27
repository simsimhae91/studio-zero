// A copy of a product for someone to run beside it: what is committed, the installed dependencies, a stack name
// of its own. Verifiers, whoever shows the product to the owner while it is verified, and anyone who runs flows
// side by side made these by hand, each time (fourteen times in one first pass, 2026-11-17).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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

const eyes = (project: string, ...args: string[]): { code: number | null; text: string } => {
  const run = spawnSync(process.execPath, [join(HERE, '../src/cli.ts'), ...args, '--dir', project], { encoding: 'utf8' });
  return { code: run.status, text: `${run.stdout}${run.stderr}` };
};

test('a copy runs the checks its open contract holds, not the ones the last commit happens to carry', () => {
  // (2026-11-26: verifiers wrote flows their contract then held, and an arbiter corrected one; none of it was
  // committed yet. Copies made from the commit had the old flow or none, and three verifiers copied `.sz/flows`
  // into their copies by hand, nineteen times.)
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sz-copy-flow-')));
  const project = join(root, 'alpha');
  try {
    mkdirSync(project);
    git(project, 'init', '-q', '-b', 'main');
    put(project, 'package.json', '{"name":"alpha"}\n');
    put(project, '.sz/flows/saw.sh', 'echo old\n');
    put(project, 'src/a.txt', 'committed\n');
    git(project, 'add', '-A');
    git(project, 'commit', '-q', '-m', 'first');
    assert.equal(eyes(project, 'contract', 'new', 'm1-saw', '--lane', 'M', '--request', '본다', '--claim', 'saw|탭 이름만 보낸다|flow:.sz/flows/saw.sh', '--claim', 'new|새 흐름이 돈다|flow:.sz/flows/new.sh').code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'm1-saw', '--frozen', '.sz/flows/saw.sh').code, 0);
    // Corrected and recorded, not committed; and a flow a verifier wrote, held by the contract, in no commit at all.
    put(project, '.sz/flows/saw.sh', 'echo corrected\n');
    assert.match(eyes(project, 'contract', 'amend', 'm1-saw', '--file', '.sz/flows/saw.sh', '--why', '제목 키 대신 사이트 이름으로 찾는다', '--no-commit').text, /not committed \(--no-commit\)/);
    put(project, '.sz/flows/new.sh', 'echo new\n');
    chmodSync(join(project, '.sz/flows/new.sh'), 0o755);
    assert.equal(eyes(project, 'contract', 'add-check', 'm1-saw', '--frozen', '.sz/flows/new.sh').code, 0);
    put(project, 'src/a.txt', 'being edited, not committed\n');
    const made = makeCopy(project, join(root, 'copies', 'v1'), {});
    assert.equal(readFileSync(join(made.folder, '.sz/flows/saw.sh'), 'utf8'), 'echo corrected\n', 'the check the contract holds, not the one the commit carries');
    assert.equal(readFileSync(join(made.folder, '.sz/flows/new.sh'), 'utf8'), 'echo new\n', 'and one no commit has');
    assert.equal(statSync(join(made.folder, '.sz/flows/new.sh')).mode & 0o111, 0o111, 'still to be run as ./new.sh');
    assert.deepEqual(made.carried.sort(), ['.sz/flows/new.sh (m1-saw)', '.sz/flows/saw.sh (m1-saw)']);
    assert.deepEqual(made.stale, []);
    assert.equal(readFileSync(join(made.folder, 'src/a.txt'), 'utf8'), 'committed\n', 'nothing else of the working folder comes along');
    assert.match(copyText(made, project), /checks its open contract holds, taken from the project's folder because the commit does not have them so: \.sz\/flows\/new\.sh \(m1-saw\), \.sz\/flows\/saw\.sh \(m1-saw\)/);
    // Changed in the project with no correction recorded: the copy keeps what is committed, and it is said.
    put(project, '.sz/flows/saw.sh', 'echo bent\n');
    const second = makeCopy(project, join(root, 'copies', 'v2'), {});
    assert.equal(readFileSync(join(second.folder, '.sz/flows/saw.sh'), 'utf8'), 'echo old\n');
    assert.deepEqual(second.stale, ['.sz/flows/saw.sh (m1-saw)']);
    assert.deepEqual(second.carried, ['.sz/flows/new.sh (m1-saw)']);
    assert.match(copyText(second, project), /changed in the project with no correction recorded, so the copy has them as committed: \.sz\/flows\/saw\.sh \(m1-saw\)/);
    // Deleted in the project with no correction recorded: likewise said, and the copy keeps the committed one.
    rmSync(join(project, '.sz/flows/saw.sh'));
    const third = makeCopy(project, join(root, 'copies', 'v2b'), {});
    assert.deepEqual(third.stale, ['.sz/flows/saw.sh (m1-saw)']);
    assert.equal(readFileSync(join(third.folder, '.sz/flows/saw.sh'), 'utf8'), 'echo old\n');
    // A copy of an earlier commit is that commit: nothing of today's folder is put into it.
    const first = git(project, 'rev-parse', 'HEAD');
    const earlier = makeCopy(project, join(root, 'copies', 'v0'), { at: first });
    assert.deepEqual([earlier.carried, earlier.stale], [[], []]);
    assert.equal(existsSync(join(earlier.folder, '.sz/flows/new.sh')), false);
    // Once the contract is closed its checks are the commit's: a closed contract's check is not taken from the folder.
    put(project, '.sz/flows/saw.sh', 'echo corrected\n');
    for (const id of ['saw', 'new']) assert.equal(eyes(project, 'contract', 'claim', 'm1-saw', id, '--status', 'proven', '--note', '돌려서 봤다').code, 0);
    assert.match(eyes(project, 'contract', 'close', 'm1-saw').text, /^closed: m1-saw/);
    const after = makeCopy(project, join(root, 'copies', 'v3'), {});
    assert.deepEqual([after.carried, after.stale], [[], []]);
    assert.equal(readFileSync(join(after.folder, '.sz/flows/saw.sh'), 'utf8'), 'echo old\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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

test('nothing is recorded inside a copy: it is refused with the command that records it in the project, and reading stays open', () => {
  // (2026-11-27: shown by running it. In a copy `contract claim` answered "a: proven" while the project's contract
  // still said unproven, and `contract close` answered "closed" while the project's contract stayed open.)
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sz-copy-write-')));
  // A folder with a space in its name, as the owner's own folders have.
  const project = join(root, 'my product');
  const copy = join(root, 'copies', 'v1');
  const CLI = join(HERE, '../src/cli.ts');
  const here = (cwd: string, ...args: string[]): { code: number | null; text: string } => {
    const run = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
    return { code: run.status, text: `${run.stdout}${run.stderr}` };
  };
  try {
    mkdirSync(project);
    git(project, 'init', '-q', '-b', 'main');
    put(project, 'package.json', '{"name":"alpha"}\n');
    put(project, '.sz/flows/a.sh', 'true\n');
    put(project, '.sz/flows/two.sh', 'true\n');
    git(project, 'add', '-A');
    git(project, 'commit', '-q', '-m', 'first');
    assert.equal(eyes(project, 'contract', 'new', 'm1-split', '--lane', 'M', '--request', '나눠 낸다', '--claim', 'a|a is true|flow:.sz/flows/a.sh', '--claim', 'two|two is true|flow:.sz/flows/two.sh').code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'm1-split', '--frozen', '.sz/flows/a.sh', '--frozen', '.sz/flows/two.sh').code, 0);
    git(project, 'add', '-A');
    git(project, 'commit', '-q', '-m', 'freeze');
    const said = copyText(makeCopy(project, copy, {}), project);
    assert.match(said, /so does everything recorded with sz-eyes \(a verdict, a notice, a standing record, a close, a backlog line\)/, 'whoever makes a copy is told at that moment');
    const inProject = (): string => readFileSync(join(project, '.sz/contracts/m1-split.json'), 'utf8');
    const inCopy = (): string => readFileSync(join(copy, '.sz/contracts/m1-split.json'), 'utf8');
    const before = [inProject(), inCopy()];
    const note = `흐름을 돌렸고 12단계가 모두 끝났다 (exit 0), it's "done" for $HOME`;

    // Every command that changes what the work is known by is refused, and says where it is recorded and how.
    const refusals = [
      ['contract', 'claim', 'm1-split', 'a', '--status', 'proven', '--note', note],
      ['contract', 'close', 'm1-split'],
      ['contract', 'close', 'm1-split', '--accepted', '그대로 닫아요'],
      ['contract', 'notice', 'm1-split', '본 것'],
      ['contract', 'amend', 'm1-split', '--file', '.sz/flows/a.sh', '--why', '따옴표를 고쳤다 그뿐이다'],
      ['contract', 'add-check', 'm1-split', '--frozen', '.sz/flows/new.sh'],
      ['contract', 'judged', 'm1-split', 'a', '--verdict', 'yes', '--said', '좋다'],
      ['contract', 'new', 'm2-more', '--lane', 'M', '--request', '더', '--claim', 'b|b is true|look:화면'],
      ['standing', 'record', 'm1-split/a', '--status', 'holds', '--note', '사본에서 봤다'],
      ['backlog', 'add', '나중에 이것도'],
      ['backlog', 'done', '나중에', '--by', 'm1-split/a'],
      ['feedback', 'new', '이건 좋다'],
      ['web', 'review', 'http://127.0.0.1:9/'],
      ['evidence', 'm1-split'],
      ['evidence', 'm1-split', '--dry-run'],
      ['evidence', 'prune', 'm1-split'],
    ];
    for (const args of refusals) {
      const run = here(copy, ...args);
      assert.equal(run.code, 1, `${args.join(' ')}: ${run.text}`);
      assert.match(run.text, /^sz-eyes: not recorded: .* is a copy of .*my product \(sz-eyes copy made it\), not the project/, run.text);
      assert.ok(run.text.trimEnd().endsWith(` --dir '${project}'`), `the last line is the command, with the project quoted as a shell takes it: ${run.text}`);
    }
    assert.deepEqual([inProject(), inCopy()], before, 'neither contract moved');
    assert.equal(existsSync(join(copy, '.sz/evidence')), false, 'and no page was written in the copy');
    assert.equal(existsSync(join(copy, '.sz/backlog.md')), false);

    // The command it prints is run as it stands, by a shell, from inside the copy: every word arrives whole.
    const refused = here(copy, 'contract', 'claim', 'm1-split', 'a', '--status', 'proven', '--note', note).text.trimEnd().split('\n').at(-1)!;
    assert.ok(refused.startsWith('  sz-eyes contract claim m1-split a --status proven --note \''), refused);
    const again = spawnSync('/bin/sh', ['-c', refused.replace(/^\s*sz-eyes /, '"$NODE" "$CLI" ')], { cwd: copy, encoding: 'utf8', env: { ...process.env, NODE: process.execPath, CLI } });
    assert.equal(again.status, 0, `${again.stdout}${again.stderr}`);
    assert.match(again.stdout, /^a: proven/);
    const recorded = (JSON.parse(inProject()) as { claims: { id: string; status: string; note: string }[] }).claims[0]!;
    assert.deepEqual([recorded.status, recorded.note], ['proven', note], 'recorded in the project, with the whole note');
    assert.equal(inCopy(), before[1], 'the copy keeps the committed record');
    // The owner's shell is zsh, which reads a word that begins with `=` as the path of a command: quoted, it is a
    // word. (Found by a reviewer: `zsh:1: see not found`.)
    if (existsSync('/bin/zsh')) {
      const line = here(copy, 'contract', 'notice', 'm1-split', '=see').text.trimEnd().split('\n').at(-1)!;
      assert.ok(line.includes(` '=see' `), line);
      const inZsh = spawnSync('/bin/zsh', ['-f', '-c', line.replace(/^\s*sz-eyes /, '"$NODE" "$CLI" ')], { cwd: copy, encoding: 'utf8', env: { ...process.env, NODE: process.execPath, CLI } });
      assert.equal(inZsh.status, 0, `${inZsh.stdout}${inZsh.stderr}`);
      assert.ok((JSON.parse(inProject()) as { noticed: { text: string }[] }).noticed.some((n) => n.text === '=see'));
    }
    // A verdict that names a picture is told where pictures are looked for: one taken in the copy is not in the project.
    assert.match(here(copy, 'contract', 'claim', 'm1-split', 'two', '--status', 'proven', '--evidence', 'look/home.png').text, /The evidence it names is looked for under the project's \.sz\/evidence\/<contract>\/, not here: copy what you kept in this copy there first\. Record it in the project/);
    assert.doesNotMatch(here(copy, 'contract', 'notice', 'm1-split', '본 것').text, /The evidence it names/);
    // Given --dir with a copy, a command is refused the same way and the project's --dir takes its place.
    assert.match(here(root, 'contract', 'notice', 'm1-split', '본 것', '--dir', copy).text, /\n  sz-eyes contract notice m1-split '본 것' --dir '[^']*my product'\n$/);

    // Reading is what a copy is for: it stays open.
    assert.equal(here(copy, 'contract', 'show', 'm1-split').code, 0);
    assert.match(here(copy, 'contract', 'status').text, /still owes/);
    assert.equal(here(copy, 'contract', 'frozen', 'm1-split').code, 0);
    assert.match(here(copy, 'contract', 'built').text, /^nothing is built and waiting to be closed/, 'the list a session waits on is a read');
    assert.equal(here(copy, 'standing').code, 0);
    assert.match(here(copy, 'backlog').text, /nothing is written down/);
    assert.doesNotMatch(here(copy, 'evidence', 'prune', 'm1-split', '--dry-run').text, /is a copy/, 'what a prune would remove is a read');
    assert.doesNotMatch(here(copy, 'feedback', 'show').text, /is a copy/);

    // A copy whose mark cannot be read is still a copy: it refuses, and says the project's folder is to be named.
    writeFileSync(join(copy, COPY_MARK), 'not json');
    const unread = here(copy, 'backlog', 'add', '나중에 이것도');
    assert.equal(unread.code, 1);
    assert.match(unread.text, /is a copy \(sz-eyes copy made it\), not the project[^]*--dir <the project's folder>\n$/);

    // Ending a copy is done in the copy: that is not a record, and it is not refused.
    const ended = here(copy, 'copy', copy, '--end');
    assert.equal(ended.code, 0, ended.text);
    assert.match(ended.text, /^ended: /);
    assert.equal(existsSync(copy), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


// What is left of a closed milestone's evidence, how much room the disk has, and films kept out of git.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { Contract, writeContract } from '../src/contract.ts';
import { filmsStayOutOfGit } from '../src/ios.ts';
import { keepsAll, pruneEvidence, prunedText } from '../src/prune.ts';
import { TAKES, diskRoom, roomText } from '../src/room.ts';

const claim = (id: string, more: Record<string, unknown> = {}) => ({ id, says: `${id} is true`, shownBy: { kind: 'flow', ref: `e2e/${id}.sh` }, status: 'proven', ...more });

/** A project with one contract, the files of its evidence folder (a kilobyte each), and what else is written under `.sz`. */
function project(contract: Record<string, unknown>, files: string[], written: Record<string, string> = {}): { root: string; contract: Contract; has: (path: string) => boolean } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sz-prune-')));
  const parsed = Contract.parse({ request: '첫 판', lane: 'M', createdAt: '2026-11-22T00:00:00.000Z', ...contract });
  mkdirSync(join(root, '.sz', 'contracts'), { recursive: true });
  writeContract(join(root, '.sz', 'contracts', `${parsed.id}.json`), parsed);
  const folder = join(root, '.sz', 'evidence', parsed.id);
  for (const path of files) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), 'x'.repeat(1024));
  }
  for (const [name, text] of Object.entries(written)) writeFileSync(join(root, '.sz', name), text);
  return { root, contract: parsed, has: (path) => existsSync(join(folder, path)) };
}

test('a closed milestone keeps the page and what a verdict, a notice or a record names, and the rest of its evidence goes', () => {
  // 2026-11-22: two milestones of a web product held 10,314 pictures, 2.1 GB; every look had taken every picture
  // again under a folder of its own, and the verdicts point at the last look's. A dry run on them: 88% would go,
  // and every picture the owner was to judge would stay.
  const closed = {
    id: 'first',
    closedAt: '2026-11-22T03:14:00.000Z',
    claims: [
      claim('s1', { evidence: ['v3/s1/s1-26-RS-01.png'] }),
      // The claim's id is also a folder and a word of its own note: a word is not a folder.
      claim('steps', { note: 'the steps hold on v3' }),
      claim('film', { evidence: ['.sz/evidence/first/v3/film/walk.mp4'] }),
      claim('feel', { shownBy: { kind: 'owner', ref: '.sz/evidence/first/drawn/ (그린 그림 곁에 지은 화면)' }, status: 'unchecked', note: '나란히 놓은 그림은 v3/pairs/에 있어요. probe-result.txt도 보세요.' }),
    ],
    noticed: [{ text: '꼭 기준과 같으면 0일 넘었다고 해요 (v2/noticed/exact-*.txt)', evidence: ['v2/noticed/n1.png'] }],
  };
  const files = [
    'report.html',
    'v3/s1/s1-26-RS-01.png', // a claim's evidence
    'v3/s1/s1-25-tap.png', // a step of the same walk nobody names
    'v1/s1/s1-26-RS-01.png', // the same screen at an earlier look: the last look's picture does not keep it
    'drawn/CK-04-drawn-vs-built.png', // under a folder the owner's claim is shown by
    'v3/pairs/CK-04.png', // under a folder a note names, a Korean particle right after it
    'v2/noticed/exact-60.txt', // named by a pattern
    'v2/noticed/n1.png', // a notice's evidence
    'v1/standing/kinds/kinds-12.png', // named in the backlog, by its whole path
    'v1/standing/kinds/kinds-11.png',
    'scratch/probe-result.txt', // named alone, by a name long enough not to be a word
    'steps/steps-01-tap.png', // "steps" is a claim and a word, never written as a folder
    'v3/film/walk.mp4', // a film a claim names
    'v3/film/.gitignore',
    'v2/flows/answers.mp4', // a film nobody names
    'v2/flows/.gitignore',
  ];
  const { root, contract, has } = project(closed, files, { 'backlog.md': '- [ ] 간호 걸음이 느려요 (.sz/evidence/first/v1/standing/kinds/kinds-12.png)\n' });
  const gone = ['v3/s1/s1-25-tap.png', 'v1/s1/s1-26-RS-01.png', 'v1/standing/kinds/kinds-11.png', 'steps/steps-01-tap.png', 'v2/flows/answers.mp4'];
  try {
    const dry = pruneEvidence(root, contract, { dry: true });
    assert.deepEqual([...dry.removed].sort(), [...gone].sort());
    assert.equal(dry.bytes, gone.length * 1024);
    assert.ok(files.every(has), 'a dry run removes nothing');
    assert.match(prunedText(contract, dry, true), /^first: would remove 5 file\(s\), 0\.0 MB, that no verdict, notice or record names; 9 would stay/);

    const done = pruneEvidence(root, contract);
    assert.deepEqual([...done.removed].sort(), [...gone].sort());
    assert.equal(done.kept, 9, 'the page and eight files that are named');
    for (const path of files) assert.equal(has(path), !gone.includes(path) && path !== 'v2/flows/.gitignore', path);
    // A folder the removal emptied goes with it, and so does one left with only what kept its films out of git.
    for (const dir of ['steps', 'v1/s1', 'v2/flows']) assert.equal(has(dir), false, dir);
    assert.ok(has('v3/film/.gitignore'), 'the film that stays is still kept out of git');
    assert.deepEqual(pruneEvidence(root, contract).removed, [], 'run again, it finds nothing more');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an open milestone, or one with a claim shown false, keeps all of its evidence', () => {
  const files = ['report.html', 'v1/s1/s1-01-tap.png'];
  const open = project({ id: 'first', claims: [claim('s1')] }, files);
  const wrong = project({ id: 'mend', closedAt: '2026-11-22T03:14:00.000Z', claims: [claim('s1'), claim('server', { status: 'refuted' })] }, files);
  try {
    assert.equal(keepsAll(open.contract), 'it is still open');
    assert.equal(keepsAll(wrong.contract), 'it has a claim shown false (server)');
    for (const p of [open, wrong]) {
      assert.deepEqual(pruneEvidence(p.root, p.contract), { kept: 2, removed: [], bytes: 0 });
      assert.ok(files.every(p.has));
    }
  } finally {
    rmSync(open.root, { recursive: true, force: true });
    rmSync(wrong.root, { recursive: true, force: true });
  }
});

test('the room on a disk is said in whole gigabytes, rounded down, the number alone on the first line', () => {
  // 10.9 GB free of 460: what is asked is whether a thing fits, so it is 10.
  const blocks = (gb: number): number => Math.round((gb * 1024 ** 3) / 4096);
  const room = diskRoom('/anywhere', () => ({ bavail: blocks(10.9), blocks: BigInt(blocks(460)), bsize: 4096 }));
  assert.deepEqual(room, { freeGb: 10, totalGb: 460 });
  const [first, rest] = roomText(room).split('\n');
  assert.equal(first, '10');
  assert.match(rest!, new RegExp(`^10 GB are free on the disk this folder is on \\(of 460\\)\\. A milestone that builds an app for a phone has taken about ${TAKES.phone} GB[^.]*, one that does not about ${TAKES.other}\\.$`));
  assert.ok(diskRoom(tmpdir()).totalGb > 0, 'asked of the machine itself, it answers');
});

test('a folder a film is written into keeps films out of git, once', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sz-film-')));
  try {
    filmsStayOutOfGit(root);
    assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), '*.mp4\n');
    filmsStayOutOfGit(root);
    assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), '*.mp4\n');
    writeFileSync(join(root, '.gitignore'), 'shots/tmp');
    filmsStayOutOfGit(root);
    assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), 'shots/tmp\n*.mp4\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

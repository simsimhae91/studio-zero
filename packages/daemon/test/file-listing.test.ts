// What a planner is shown of a project's files: all of them while they fit, and the layout when they do not.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { foldListing } from '../src/harness/fileListing.ts';
import { findRepoRoot } from '../src/harness/SelfHosting.ts';

test('a listing that fits is every path, as given', () => {
  assert.deepEqual(foldListing(['src/b.ts', 'README.md', 'src/a.ts', '']), ['README.md', 'src/a.ts', 'src/b.ts']);
  assert.deepEqual(foldListing([]), []);
});

test('a listing that does not fit folds the deepest folders first, and keeps what is nearest the root', () => {
  const paths = [
    'package.json',
    'packages/protocol/src/rpc.ts',
    'packages/protocol/src/domain.ts',
    'packages/daemon/src/harness/engines/Engine.ts',
    'packages/daemon/src/harness/engines/NativeClaudeEngine.ts',
    'packages/daemon/src/harness/Harness.ts',
    'packages/daemon/test/e2e.test.ts',
    'apps/desktop/src/main.tsx',
  ];
  // One level is enough for seven lines: only the folder five deep goes.
  assert.deepEqual(foldListing(paths, 7), [
    'apps/desktop/src/main.tsx',
    'package.json',
    'packages/daemon/src/harness/Harness.ts',
    'packages/daemon/src/harness/engines/ (2 files)',
    'packages/daemon/test/e2e.test.ts',
    'packages/protocol/src/domain.ts',
    'packages/protocol/src/rpc.ts',
  ]);
  // Tighter, and every package is still named, with what it holds counted.
  assert.deepEqual(foldListing(paths, 4), ['apps/desktop/ (1 files)', 'package.json', 'packages/daemon/ (4 files)', 'packages/protocol/ (2 files)']);
  assert.deepEqual(foldListing(paths, 1), ['apps/ (1 files)', 'package.json', 'packages/ (6 files)'], 'it stops at the top level, however small the limit');
});

test('the studio\'s own repository is listed whole, the packages a plan needs among them', () => {
  const root = findRepoRoot()!;
  const tracked = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\n');
  const listed = foldListing(tracked);
  assert.ok(listed.length <= 600);
  for (const needed of ['packages/protocol/', 'packages/design/', 'packages/daemon/src/', 'apps/desktop/src/', 'package.json']) assert.ok(listed.some((line) => line.startsWith(needed)), `${needed} is in the listing`);
});

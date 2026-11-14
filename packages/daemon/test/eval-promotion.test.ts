// A command an engine ran becomes a standing check only when it can fail by what it checks, and is not a check
// the project already has. Found on the studio's own project: every check kept so far was `… | tail`.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { migrate } from '../src/db/schema.ts';
import { bareCommand, keepsItsVerdict } from '../src/harness/EvalRunner.ts';
import { sampleProject, testDaemon } from './helpers.ts';

test('a command whose exit code is a pager\'s, or is thrown away, is not its own verdict', () => {
  for (const command of ['pnpm test', 'cd /workspace && timeout 300 pnpm test 2>&1', 'node --test test/a.test.ts || exit 1', 'grep -q "a|b" src/app.ts', "test \"$(cat VERSION)\" = '1 | 2'"]) {
    assert.equal(keepsItsVerdict(command), true, command);
  }
  for (const command of ['cd /workspace && timeout 1500 pnpm test 2>&1 | tail -25', 'pnpm typecheck 2>&1 | tail -20', 'node --test a.test.ts|head', 'pnpm test || true', 'pnpm lint; true', '(pnpm test || :) && echo done']) {
    assert.equal(keepsItsVerdict(command), false, command);
  }
});

test('a command is compared without what an engine wraps round it', () => {
  assert.equal(bareCommand('cd /workspace && timeout 1500 pnpm test 2>&1'), 'pnpm test');
  assert.equal(bareCommand('  pnpm   test '), 'pnpm test');
  assert.equal(bareCommand('timeout --kill-after=5 300s npx expo export -p web'), 'npx expo export -p web');
  assert.equal(bareCommand('node --test test/a.test.ts'), 'node --test test/a.test.ts', 'a command of its own is left as it is');
});

test('promotion keeps a check that can fail and is new, and refuses the rest', async () => {
  const d = await testDaemon();
  try {
    const { evals, store } = d.daemon;
    const project = sampleProject();
    store.insertProject(project);
    const kept = (): string[] => store.listEvals(project.id).flatMap((e) => (e.spec.kind === 'command' ? [e.spec.command] : []));
    assert.equal(evals.addCommandEval(project.id, 'unit-tests', 'cd /workspace && pnpm test 2>&1 | tail -25', 60, 'tsk_1'), false, 'a pipeline passes whatever the tests did');
    assert.equal(evals.addCommandEval(project.id, 'typecheck', 'cd /workspace && pnpm typecheck', 60, 'tsk_1'), false, 'the compiler gate runs the type check first in every round');
    assert.equal(evals.addCommandEval(project.id, 'unit-tests', 'cd /workspace && pnpm test', 60, 'tsk_1'), true);
    assert.equal(evals.addCommandEval(project.id, 'tests-again', 'timeout 300 pnpm test 2>&1', 60, 'tsk_2'), false, 'the same check, typed another way');
    assert.equal(evals.addCommandEval(project.id, 'dates', 'node --test test/dates.test.ts', 60, 'tsk_2'), true);
    assert.deepEqual(kept().sort(), ['cd /workspace && pnpm test', 'node --test test/dates.test.ts']);
  } finally {
    await d.cleanup();
  }
});

test('checks that could not fail are removed from a database that kept them, and nothing else is', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`INSERT INTO projects (id, slug, name, template, created_at) VALUES ('prj_a', 'a', 'A', 'web-vite-react', 1)`);
  const add = db.prepare(`INSERT INTO evals (id, project_id, name, spec_json, enabled, origin_task_id, created_at) VALUES (:id, 'prj_a', :name, :spec, 1, :origin, 1)`);
  const rows: [string, string, string | null][] = [
    ['seeded-tests', '{"kind":"command","command":"pnpm test","timeoutSec":900}', null],
    ['piped', '{"kind":"command","command":"cd /workspace && pnpm test 2>&1 | tail -25","timeoutSec":106}', 'tsk_1'],
    ['honest', '{"kind":"command","command":"node --test test/a.test.ts || exit 1","timeoutSec":60}', 'tsk_1'],
    ['lint', '{"kind":"slop-lint","maxMajor":0}', null],
  ];
  for (const [name, spec, origin] of rows) add.run({ id: `evl_${name}`, name, spec, origin });
  // The removal is the last migration: run again on rows put in after it, as it ran on a database that had them.
  db.exec('PRAGMA user_version = 15');
  migrate(db);
  assert.deepEqual((db.prepare('SELECT name FROM evals ORDER BY name').all() as { name: string }[]).map((r) => r.name), ['honest', 'lint', 'seeded-tests']);
  db.close();
});

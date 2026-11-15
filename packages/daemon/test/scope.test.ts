// How much of a product a small edit is walked for: from the files it changed to the screens they are, to the
// scenarios that stand on those screens. One case a rule, and the program that reads imports run on a tree on disk.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { ScreenSpec, type Trails } from '@studio-zero/protocol';
import { renderScope, scopeLabel, scopeOf, type Reach, type Scope } from '../src/product/scope.ts';
import { changedFilesScript, reachScript } from '../src/sandbox/scripts.ts';
import { tempDir } from './helpers.ts';

const screen = (id: string) => ({ id, name: id, purpose: '.', entry: ['.'], elements: [], states: [], exceptions: [] });
const steps = (...at: string[]) => at.map((pair) => ({ id: pair.split('@')[0]!, screen: pair.split('@')[1]!, does: '.', saves: null, outcome: '.' }));
/** Six scenarios that all sign up and give a name, then each do their own thing. One goes on from another. */
const PLAN = ScreenSpec.parse({
  coreMoment: '.',
  screens: ['A-02', 'O-02', 'H-01', 'TP-02', 'SC-01', 'RK-01', 'J-01', 'M-02'].map(screen),
  tasks: [{ id: 'open', goal: '.', outcome: '.', screen: 'H-01' }],
  events: [],
  roles: [{ id: 'user', name: '쓰는 사람', does: '.' }],
  entry: null,
  noAccounts: '.',
  scenarios: [
    { id: 'tips', role: 'user', steps: steps('sign-up@A-02', 'name@O-02', 'open-tip@H-01', 'save-tip@TP-02') },
    { id: 'share', role: 'user', steps: steps('sign-up@A-02', 'name@O-02', 'share@SC-01') },
    { id: 'ranking', role: 'user', steps: steps('sign-up@A-02', 'name@O-02', 'see-rank@RK-01') },
    { id: 'profile', role: 'user', steps: steps('sign-up@A-02', 'name@O-02', 'rename@RK-01', 'back@H-01') },
    { id: 'invite', role: 'user', steps: steps('sign-up@A-02', 'name@O-02', 'invite@H-01') },
    { id: 'joininvite', role: 'user', after: 'invite', steps: steps('sign-up@A-02', 'name@O-02', 'join@J-01') },
  ],
  data: [],
});
const FILE: Record<string, string> = { 'A-02': 'app/sign-up.tsx', 'O-02': 'app/onboarding.tsx', 'H-01': 'app/index.tsx', 'TP-02': 'app/tips/[id].tsx', 'SC-01': 'app/share.tsx', 'RK-01': 'app/rank.tsx', 'J-01': 'app/join.tsx', 'M-02': 'app/meal-sheet.tsx' };
/** What changing `files` reaches when it reaches the files of `screens` (and itself). Ten files of the workspace name a screen. */
const reach = (files: string[], screens: string[], loose: string[] = []): Reach => ({
  affected: [...files, ...screens.map((id) => FILE[id]!)],
  named: Object.fromEntries(screens.map((id) => [FILE[id]!, [id]])),
  screenFiles: 10,
  loose,
});
const of = (changed: string[], screens: string[], opts: { trails?: Trails | null; loose?: string[] } = {}): Scope => scopeOf({ changed, spec: PLAN, reach: reach(changed, screens, opts.loose), trails: opts.trails ?? null });

test('a small edit is walked for the screens it changed, by the scenarios that stand on them', () => {
  // A screen's own file: that screen, and the one scenario with a step of its own there.
  const tip = of(['app/tips/[id].tsx'], ['TP-02']);
  assert.deepEqual(tip, { kind: 'some', screens: ['TP-02'], scenarios: ['tips'], why: 'app/tips/[id].tsx reaches screen TP-02' });
  assert.equal(scopeLabel(tip, 6), '화면 1개 · 시나리오 1/6개');
  assert.equal(renderScope(tip, 6), '1 of 6 scenarios walked (tips) and one screen measured (TP-02): app/tips/[id].tsx reaches screen TP-02.');
  // A component two screens' files import: both screens, both scenarios, in the plan's order.
  assert.deepEqual(of(['src/components/Dock.tsx'], ['SC-01', 'TP-02']), { kind: 'some', screens: ['SC-01', 'TP-02'], scenarios: ['tips', 'share'], why: 'src/components/Dock.tsx reaches screens SC-01, TP-02' });
  // A screen two scenarios work on: both.
  assert.deepEqual((of(['app/rank.tsx'], ['RK-01']) as { scenarios: string[] }).scenarios, ['ranking', 'profile']);
  // Documents changed alongside are no part of it.
  assert.deepEqual((of(['app/rank.tsx', 'docs/notes.md'], ['RK-01']) as { scenarios: string[] }).scenarios, ['ranking', 'profile']);
});

test('the way in is walked once: a screen only the steps every scenario carries stand on takes the shortest scenario', () => {
  const onboarding = of(['app/onboarding.tsx'], ['O-02']);
  assert.deepEqual([onboarding.kind, (onboarding as { scenarios: string[] }).scenarios], ['some', ['share']], 'six scenarios give their name there; one of the two shortest does it for all');
});

test('a scenario that goes on from another brings it along', () => {
  assert.deepEqual((of(['app/join.tsx'], ['J-01']) as { scenarios: string[] }).scenarios, ['invite', 'joininvite']);
});

test('a screen no step names is found where the last full walk went, and without one everything is walked', () => {
  const trails: Trails = { tips: [{ screen: 'A-02', step: 'sign-up' }, { screen: 'H-01', step: 'open-tip' }, { screen: 'M-02', step: 'open-tip' }], share: [{ screen: 'A-02', step: 'sign-up' }] };
  assert.deepEqual((of(['app/meal-sheet.tsx'], ['M-02'], { trails }) as { scenarios: string[] }).scenarios, ['tips']);
  const unknown = of(['app/meal-sheet.tsx'], ['M-02']);
  assert.deepEqual(unknown, { kind: 'all', why: 'no scenario is known to reach screen M-02 (the project has not been walked in full yet: a full check records where every scenario goes)' });
  assert.equal(scopeLabel(unknown, 6), '시나리오 전체 6개');
  // Walked in full, and still nobody passed it: said without the hint.
  assert.deepEqual(of(['app/meal-sheet.tsx'], ['M-02'], { trails: { tips: [] } }), { kind: 'all', why: 'no scenario is known to reach screen M-02' });
  // A screen passed on the way in by everyone, in the trails only: once, by the shortest.
  const way: Trails = Object.fromEntries(PLAN.scenarios.map((s) => [s.id, [{ screen: 'M-02', step: 'name' }]]));
  assert.deepEqual((of(['app/meal-sheet.tsx'], ['M-02'], { trails: way }) as { scenarios: string[] }).scenarios, ['share']);
});

test('what cannot be placed is walked for in full, and what is not the product is not walked for', () => {
  const all = (scope: Scope): string => (assert.equal(scope.kind, 'all'), (scope as { why: string }).why);
  // Not source and imported by nothing: a config, the lockfile.
  assert.equal(all(of(['package.json'], [], { loose: ['package.json'] })), 'package.json is not source that anything imports, so what it reaches is the whole product');
  assert.match(all(of(['tailwind.config.js', 'pnpm-lock.yaml'], [], { loose: ['pnpm-lock.yaml'] })), /^pnpm-lock\.yaml is not source/);
  // The plan itself.
  assert.equal(all(scopeOf({ changed: ['docs/screens.json'], spec: PLAN, reach: reach([], []), trails: null })), 'the screen plan (docs/screens.json) was changed');
  // Source that reaches no screen (a config in code, a script).
  assert.equal(all(of(['tailwind.config.js'], [])), 'tailwind.config.js reaches no file that names a screen of the plan');
  // Source that reaches most of the product: 7 of the 10 files that name a screen.
  const wide: Reach = { affected: ['src/components/Button.tsx', ...Array.from({ length: 7 }, (_, i) => `app/s${i}.tsx`)], named: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`app/s${i}.tsx`, ['TP-02']])), screenFiles: 10, loose: [] };
  assert.equal(all(scopeOf({ changed: ['src/components/Button.tsx'], spec: PLAN, reach: wide, trails: null })), 'the change reaches 7 of the 10 files that name a screen');
  assert.equal(scopeOf({ changed: ['src/components/Button.tsx'], spec: PLAN, reach: { ...wide, screenFiles: 12 }, trails: null }).kind, 'some', '7 of 12 is under the line');
  // The imports could not be read.
  assert.equal(all(scopeOf({ changed: ['app/rank.tsx'], spec: PLAN, reach: null, trails: null })), 'what the change reaches could not be read off the imports');
  // An id in the code that the plan does not have is not a screen.
  assert.equal(scopeOf({ changed: ['app/x.tsx'], spec: PLAN, reach: { affected: ['app/x.tsx'], named: { 'app/x.tsx': ['ZZ-99'] }, screenFiles: 10, loose: [] }, trails: null }).kind, 'all');
  // A screen every scenario works on.
  const everyone = ScreenSpec.parse({ ...PLAN, scenarios: PLAN.scenarios.map((s) => ({ ...s, steps: [...s.steps, { id: `end-${s.id}`, screen: 'H-01', does: '.', saves: null, outcome: '.' }] })) });
  assert.equal(all(scopeOf({ changed: ['app/index.tsx'], spec: everyone, reach: reach(['app/index.tsx'], ['H-01']), trails: null })), 'the screens it reaches (H-01) are stood on by every scenario');
  // A plan of one or two scenarios is walked whole: there is nothing to choose between.
  assert.equal(all(scopeOf({ changed: ['app/rank.tsx'], spec: ScreenSpec.parse({ ...PLAN, scenarios: PLAN.scenarios.slice(0, 2) }), reach: reach(['app/rank.tsx'], ['RK-01']), trails: null })), 'the plan has 2 scenarios');

  // Documents only, and nothing at all.
  assert.deepEqual(of(['docs/product.md', 'README.md'], []), { kind: 'none', why: 'only documents were changed (docs/product.md, README.md)' });
  assert.deepEqual(of([], []), { kind: 'none', why: 'nothing was changed' });
  assert.equal(renderScope(of(['README.md'], []), 6), 'Nothing is walked: only documents were changed (README.md).');
});

test('a small edit does not change the backend: migrations are refused, whatever else is in the change', () => {
  const refused = of(['app/rank.tsx', 'supabase/migrations/20261115_add_column.sql'], ['RK-01']);
  assert.equal(refused.kind, 'refused');
  assert.match((refused as { why: string }).why, /^it changes the backend \(supabase\/migrations\/20261115_add_column\.sql\)\. A small edit does not change the schema/);
  assert.equal(scopeLabel(refused, 6), '들어갈 수 없음');
  assert.match(renderScope(refused, 6), /^This change cannot land as a small edit: it changes the backend/);
});

// ------------------------------------------------------------------ reading a tree

test('what a change reaches is read off the imports: aliases, a layout over its routes, a cycle, a file nobody imports', () => {
  const tmp = tempDir('sz-reach-');
  const put = (file: string, text: string): void => {
    mkdirSync(dirname(join(tmp.dir, file)), { recursive: true });
    writeFileSync(join(tmp.dir, file), text);
  };
  const sh = (script: string, input = ''): string => execFileSync('bash', ['-c', script], { cwd: tmp.dir, input, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  try {
    put('tsconfig.json', '{\n  // paths, with a comment and a trailing comma\n  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"], } },\n}\n');
    put('package.json', '{}');
    put('global.css', 'body{}');
    put('.gitignore', 'node_modules/\n');
    put('node_modules/dep/index.js', "import '../../src/components/Button';");
    put('app/_layout.tsx', "import '../global.css';\nimport { Session } from '@/providers/Session';\nexport default Session;\n");
    put('app/tips/[id].tsx', "import { Dock } from '@/components/Dock';\nimport { tips } from '../../src/lib/tips';\nexport default () => <MobileShell screen=\"TP-02\">{tips}<Dock /></MobileShell>;\n");
    put('app/share.tsx', "import { Dock } from '@/components/Dock';\nconst Card = () => import('@/components/Card');\nexport default () => <MobileShell screen='SC-01'><Dock /></MobileShell>;\n");
    put('src/components/Dock.tsx', "import { Button } from './Button';\nexport const Dock = Button;\n");
    put('src/components/Button.tsx', 'export const Button = () => null;\n');
    put('src/components/Card.tsx', "export { Button as default } from './Button';\n");
    put('src/lib/tips.ts', "import { cycle } from './cycle';\nexport const tips = cycle;\n");
    put('src/lib/cycle.ts', "const { tips } = require('./tips');\nexport const cycle = tips;\n");
    put('src/providers/Session.tsx', 'export const Session = () => null;\n');
    put('src/unused.ts', "export const mention = 'TP-02 in a sentence is not a name';\n");
    sh('git init -q -b main && git add -A && git -c user.name=t -c user.email=t@t commit -q -m first');
    const read = (changed: string[]): Reach => JSON.parse(sh(reachScript({ workspace: tmp.dir }), JSON.stringify({ changed, screens: ['TP-02', 'SC-01', 'H-01'] }))) as Reach;

    // A leaf component: up through what imports it to the two screens' files. A re-export and a dynamic import count.
    assert.deepEqual(read(['src/components/Button.tsx']), {
      affected: ['app/share.tsx', 'app/tips/[id].tsx', 'src/components/Button.tsx', 'src/components/Card.tsx', 'src/components/Dock.tsx'],
      named: { 'app/share.tsx': ['SC-01'], 'app/tips/[id].tsx': ['TP-02'] },
      screenFiles: 2,
      loose: [],
    });
    // A cycle ends.
    assert.deepEqual(read(['src/lib/cycle.ts']).affected, ['app/tips/[id].tsx', 'src/lib/cycle.ts', 'src/lib/tips.ts']);
    // What the layout imports reaches every route under the layout, which import nothing of it themselves.
    assert.deepEqual(read(['src/providers/Session.tsx']).affected, ['app/_layout.tsx', 'app/share.tsx', 'app/tips/[id].tsx', 'src/providers/Session.tsx']);
    // A stylesheet the layout imports is placed the same way; a file nothing imports and that is not source is loose.
    assert.deepEqual([read(['global.css']).loose, Object.keys(read(['global.css']).named).sort()], [[], ['app/share.tsx', 'app/tips/[id].tsx']]);
    assert.deepEqual(read(['package.json']), { affected: ['package.json'], named: {}, screenFiles: 2, loose: ['package.json'] });
    // Source nobody imports reaches itself, and a screen's id inside a sentence names nothing.
    assert.deepEqual(read(['src/unused.ts']), { affected: ['src/unused.ts'], named: {}, screenFiles: 2, loose: [] });
    // A file that is gone reaches nothing by itself.
    assert.deepEqual(read(['src/gone.ts']).affected, []);

    // And the files a working tree changes: edited and new, not what git ignores.
    put('src/components/Button.tsx', 'export const Button = () => 1;\n');
    put('src/components/New.tsx', 'export const New = 1;\n');
    put('node_modules/dep/extra.js', '');
    assert.deepEqual(sh(changedFilesScript({ workspace: tmp.dir, base: 'main' })).trim().split('\n'), ['src/components/Button.tsx', 'src/components/New.tsx']);
    // Measured from where the work left the base: what the base has gained since is not the work's own change.
    sh('git checkout -q -b sz/edit && git add -A && git -c user.name=t -c user.email=t@t commit -q -m edit && git checkout -q main');
    put('src/lib/elsewhere.ts', 'export const elsewhere = 1;\n');
    sh('git add -A && git -c user.name=t -c user.email=t@t commit -q -m "main moves" && git checkout -q sz/edit');
    assert.deepEqual(sh(changedFilesScript({ workspace: tmp.dir, base: 'main' })).trim().split('\n'), ['src/components/Button.tsx', 'src/components/New.tsx']);
  } finally {
    tmp.cleanup();
  }
});

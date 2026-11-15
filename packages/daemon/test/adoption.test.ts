// Adoption, on real git: a checkout made in a temp folder, with its product one folder down, brought into a test
// daemon. What is read is what is committed; what is written into the checkout is one remote.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import type { Finding } from '@studio-zero/protocol';
import { ConflictError } from '../src/app/errors.ts';
import { ADOPT_BRIEF, DRAFT_BRIEF, adoptedSystemPrompt } from '../src/harness/prompts.ts';
import type { ScenarioOutcome, ScenarioRunnerLike } from '../src/qa/ScenarioRunner.ts';
import type { SmokeOutcome, SmokeRunner } from '../src/qa/SmokeTester.ts';
import { hasBlock } from '../src/repo/agentFile.ts';
import { readScreenSpec } from '../src/scratch/ScreenSpec.ts';
import { sleep } from '../src/util/core.ts';
import { detectStack, inspect, slugOf } from '../src/repo/Adoption.ts';
import { runCommand, type RunResult } from '../src/util/run.ts';
import { tempDir, testDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
const QUIET = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
const ME = ['-c', 'user.name=owner', '-c', 'user.email=owner@localhost'];

/** A checkout with a proposal at its root and an Expo app in `app/`, as the first repository brought in was. */
async function checkout(opts: { branch?: string; files?: Record<string, string> } = {}): Promise<{ dir: string; git: (...args: string[]) => Promise<RunResult>; cleanup: () => void }> {
  const where = tempDir('sz-checkout-');
  const dir = join(where.dir, 'CreDeal');
  mkdirSync(dir);
  const git = (...args: string[]): Promise<RunResult> => runCommand('git', ['-C', dir, ...ME, ...args], { env: { ...process.env, ...QUIET }, timeoutMs: 60_000 });
  const files: Record<string, string> = opts.files ?? {
    'package.json': JSON.stringify({ name: 'credeal-proposal', devDependencies: { pptxgenjs: '^4.0.1' } }),
    'docs/plan.md': '# plan\n',
    'app/package.json': JSON.stringify({ name: 'credeal-app', version: '1.0.0', dependencies: { expo: '~58.0.22', react: '19.3.0' } }),
    'app/src/home.tsx': 'export const title = "CreDeal";\n',
    'app/AGENTS.md': 'This is an Expo app.\n',
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  assert.equal((await git('init', '-q', '-b', opts.branch ?? 'main')).exitCode, 0);
  await git('add', '-A');
  assert.equal((await git('commit', '-q', '-m', 'the product as it is')).exitCode, 0);
  return { dir, git, cleanup: where.cleanup };
}

test('a stack is read off a package.json, and only the three the studio can walk', () => {
  assert.equal(detectStack({ dependencies: { expo: '~58', react: '19' } }), 'mobile-expo');
  assert.equal(detectStack({ dependencies: { next: '16', react: '19' } }), 'web-next');
  assert.equal(detectStack({ devDependencies: { vite: '7' }, dependencies: { react: '19' } }), 'web-vite-react');
  assert.equal(detectStack({ devDependencies: { vite: '7' }, dependencies: { vue: '3' } }), null);
  assert.equal(detectStack({ dependencies: { express: '5' } }), null);
  for (const not of [null, 'x', 3, [], { dependencies: 'expo' }]) assert.equal(detectStack(not), null);
  assert.equal(slugOf('CreDeal'), 'credeal');
  assert.equal(slugOf('my app (v2)'), 'my-app-v2');
  assert.equal(slugOf('42'), 'app-app');
  assert.match(slugOf('한글 이름'), /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/);
});

test('a checkout whose product is one folder down is found there, and what cannot be placed is refused with the reason', async () => {
  const one = await checkout();
  const two = await checkout({ files: { 'web/package.json': JSON.stringify({ dependencies: { next: '16', react: '19' } }), 'mobile/package.json': JSON.stringify({ dependencies: { expo: '58' } }) } });
  const none = await checkout({ files: { 'package.json': JSON.stringify({ dependencies: { express: '5' } }), 'README.md': 'x\n' } });
  const develop = await checkout({ branch: 'develop', files: { 'package.json': JSON.stringify({ dependencies: { next: '16' } }) } });
  try {
    writeFileSync(join(one.dir, 'scratch.txt'), 'not committed\n');
    const found = await inspect(runCommand, one.dir);
    assert.deepEqual({ root: found.root, template: found.template, base: found.base, name: found.name, uncommitted: found.uncommitted, commits: found.commits }, { root: 'app', template: 'mobile-expo', base: 'main', name: 'CreDeal', uncommitted: 1, commits: 1 });
    assert.equal(found.commit, (await one.git('rev-parse', 'main')).stdout.trim());
    // Named, it is taken as named; a name that is not a folder inside the repository is refused before git sees it.
    assert.equal((await inspect(runCommand, one.dir, { dir: 'app' })).root, 'app');
    for (const bad of ['my app', '../elsewhere', '-rf', 'app/../..']) await assert.rejects(inspect(runCommand, one.dir, { dir: bad }), ConflictError, bad);
    await assert.rejects(inspect(runCommand, one.dir, { dir: 'docs' }), /Expo, Next, Vite/);
    await assert.rejects(inspect(runCommand, join(one.dir, 'app')), /저장소의 루트가 아닙니다/);
    await assert.rejects(inspect(runCommand, join(one.dir, 'nowhere')), /그런 폴더가 없습니다/);
    await assert.rejects(inspect(runCommand, one.dir, { base: 'release' }), /브랜치 release/);
    await assert.rejects(inspect(runCommand, two.dir), /여럿입니다 \(mobile: mobile-expo, web: web-next\)/);
    assert.equal((await inspect(runCommand, two.dir, { dir: 'web' })).template, 'web-next');
    await assert.rejects(inspect(runCommand, none.dir), /찾지 못했습니다/);
    // No main: the branch the checkout stands on is the base.
    assert.deepEqual([(await inspect(runCommand, develop.dir)).base, (await inspect(runCommand, develop.dir)).root], ['develop', '']);
  } finally {
    for (const made of [one, two, none, develop]) made.cleanup();
  }
});

test('adoption takes the base branch as main, adds the remote, puts nothing of the house on it, and leaves the working tree alone', async () => {
  const d = await testDaemon();
  const mine = await checkout();
  try {
    await d.daemon.start();
    const { studio, sandboxes, store, gate } = d.daemon;
    writeFileSync(join(mine.dir, 'scratch.txt'), 'not committed\n');
    const before = (await mine.git('status', '--porcelain')).stdout;
    const head = (await mine.git('rev-parse', 'main')).stdout.trim();

    await assert.rejects(studio.adoptProject({ type: 'owner', via: 'telegram' }, { path: mine.dir }), /only from this Mac/);
    const adopted = await studio.adoptProject(OWNER, { path: mine.dir });
    const project = adopted.project;
    assert.deepEqual({ slug: project.slug, name: project.name, template: project.template, root: project.root, base: project.adopted?.base }, { slug: 'credeal', name: 'CreDeal', template: 'mobile-expo', root: 'app', base: 'main' });
    assert.equal(adopted.remote, 'added');
    assert.equal(adopted.uncommitted, 1);
    assert.match(adopted.lines.join('\n'), /sz fit credeal/);
    assert.deepEqual(store.getProject(project.id)?.adopted, project.adopted);

    // The gate and the sandbox both stand where the checkout's main does, commit for commit.
    assert.equal((await runCommand('git', ['-C', gate.pathOf(project), 'rev-parse', 'main'])).stdout.trim(), head);
    assert.equal((await sandboxes.exec(project, 'git rev-parse main', { cwd: '/workspace' })).stdout.trim(), head);
    assert.equal((await sandboxes.exec(project, 'git symbolic-ref --short HEAD', { cwd: '/workspace' })).stdout.trim(), 'main');
    assert.equal((await sandboxes.readFile(project, 'src/home.tsx')).content, 'export const title = "CreDeal";\n', 'a tool path is from the product folder');

    // The checkout: one remote more, and not a file touched.
    assert.equal((await mine.git('remote', 'get-url', 'studio')).stdout.trim(), gate.pathOf(project));
    assert.equal((await mine.git('status', '--porcelain')).stdout, before);
    assert.equal((await mine.git('rev-parse', 'main')).stdout.trim(), head);

    // Provisioned (this checkout has no lockfile to install by; where dependencies go is `depsScript`'s own
    // test), and nothing of the house's is in the repository.
    await studio.settle();
    const said = store.listEvents({ projectId: project.id }, 0, 200).map((e) => e.body);
    assert.equal(said.some((b) => b.type === 'notice' && b.level === 'warn'), false, 'provisioning went through');
    assert.ok(said.some((b) => b.type === 'notice' && /의존성 설치가 끝났습니다/.test(b.message)));
    assert.equal((await sandboxes.exec(project, 'git status --porcelain', { cwd: '/workspace' })).stdout.trim(), '', 'nothing was written into the repository');
    assert.equal((await sandboxes.exec(project, 'git rev-parse main', { cwd: '/workspace' })).stdout.trim(), head, 'and nothing committed to it');
    assert.equal(existsSync(join(d.workspace, 'app', '.studio-zero')), false);
    assert.equal(existsSync(join(d.workspace, '.studio-zero')), false);
    assert.deepEqual(store.listEvals(project.id).map((e) => e.name), ['visual-audit'], 'no slop lint: its design is its own');

    // The same checkout is not brought in twice.
    await assert.rejects(studio.adoptProject(OWNER, { path: mine.dir }), /이미 들여왔습니다: credeal/);

    // And the door works from the checkout it came from.
    writeFileSync(join(mine.dir, 'app', 'src', 'home.tsx'), 'export const title = "CreDeal 2";\n');
    await mine.git('add', 'app/src/home.tsx');
    await mine.git('commit', '-q', '-m', 'feat: a new title');
    const pushed = await runCommand('git', ['-C', mine.dir, ...ME, 'push', 'studio', 'main'], { env: { ...process.env, ...QUIET, SZ_URL: d.url(), SZ_TOKEN: d.daemon.clientToken.expose() }, timeoutMs: 60_000 });
    assert.equal(pushed.exitCode, 0, pushed.stderr);
    assert.equal((await sandboxes.readFile(project, 'src/home.tsx')).content, 'export const title = "CreDeal 2";\n');
    const status = await studio.repoStatus(project.id);
    assert.deepEqual({ open: status.open, root: status.root, planned: status.planned, adopted: status.adopted?.base }, { open: true, root: 'app', planned: false, adopted: 'main' });
  } finally {
    await d.cleanup();
    mine.cleanup();
  }
});

test('a build on an adopted project runs on the fast track, and what is the house\'s way of starting a product is refused', async () => {
  const d = await testDaemon();
  const mine = await checkout();
  try {
    // Not started: tasks are queued and nothing runs them.
    const { studio } = d.daemon;
    const { project } = await studio.adoptProject(OWNER, { path: mine.dir, name: 'Cre Deal', slug: 'cre-deal' });
    assert.deepEqual([project.slug, project.name], ['cre-deal', 'Cre Deal']);
    // Not fitted: nothing here can run it, so nothing but the fit is taken.
    for (const kind of ['build', 'inline_edit', 'check', 'refactor'] as const) await assert.rejects(studio.submitTask(OWNER, { projectId: project.id, kind, prompt: 'add a screen' }, 'desktop'), /걷기 계획이 없어/, kind);
    const fit = await studio.submitTask(OWNER, { projectId: project.id, kind: 'adopt', prompt: 'fit it' }, 'desktop');
    assert.deepEqual([fit.kind, fit.track], ['adopt', 'fast']);
    // Fitted (its main holds a plan): a build is taken, and runs on the fast track whatever was asked.
    await d.daemon.sandboxes.writeFile(project, 'docs/screens.json', JSON.stringify(FIT_PLAN));
    await d.daemon.sandboxes.commitAll(project, 'chore: the plan');
    const build = await studio.submitTask(OWNER, { projectId: project.id, kind: 'build', prompt: 'add a screen', track: 'full' }, 'desktop');
    assert.equal(build.track, 'fast', 'the full track is the house\'s design gates');
    assert.equal(build.reviewPlan, false);
    // A branch that has no plan is not something to start from.
    await d.daemon.sandboxes.exec(project, 'git branch -q bare HEAD~1', { cwd: '/workspace' });
    await assert.rejects(studio.submitTask(OWNER, { projectId: project.id, kind: 'build', prompt: 'x', baseBranch: 'bare' }, 'desktop'), /아직 bare에 걷기 계획이 없어/);
    await assert.rejects(studio.submitTask(OWNER, { projectId: project.id, kind: 'ideate', prompt: 'design it' }, 'desktop'), /들여온 제품에는/);
    await assert.rejects(studio.runRoadmap(OWNER, project.id), /로드맵을 두지 않습니다/);
    // And fitting is not something a product the studio built needs.
    const house = await studio.createProjectAndProvision(OWNER, { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' }).catch(() => null);
    if (house) await assert.rejects(studio.submitTask(OWNER, { projectId: house.id, kind: 'adopt', prompt: 'fit it' }, 'desktop'), /들여온 프로젝트의 작업/);
    await studio.settle();
  } finally {
    await d.cleanup();
    mine.cleanup();
  }
});

test('a checkout that cannot be brought in leaves nothing behind', async () => {
  const d = await testDaemon();
  const mine = await checkout();
  try {
    const { studio, store, gate } = d.daemon;
    // The sandbox cannot be filled: docker refuses the one command that would do it.
    const broken = await testDaemon({}, {}, (base) => async (file, args, opts) => (args.some((word) => typeof word === 'string' && word.includes('gate-in.bundle')) ? { exitCode: 1, stdout: '', stderr: 'no space left on device', truncated: false, timedOut: false, durationMs: 1 } : base(file, args, opts)));
    try {
      await assert.rejects(broken.daemon.studio.adoptProject(OWNER, { path: mine.dir }), /could not put the repository into the sandbox/);
      assert.equal(broken.daemon.store.listProjects().length, 0);
      assert.equal(existsSync(join(broken.config.reposDir, 'credeal.git')), false);
      assert.notEqual((await mine.git('remote', 'get-url', 'studio')).exitCode, 0, 'the checkout was not touched');
    } finally {
      await broken.cleanup();
    }
    // The same checkout then comes in on a daemon that works.
    const { project } = await studio.adoptProject(OWNER, { path: mine.dir });
    assert.equal(store.listProjects().some((p) => p.id === project.id), true);
    assert.equal(readFileSync(join(gate.pathOf(project), 'HEAD'), 'utf8').trim(), 'ref: refs/heads/main');
    await studio.settle();
  } finally {
    await d.cleanup();
    mine.cleanup();
  }
});

// ------------------------------------------------------------------ the fit

type Block = Anthropic.Beta.BetaContentBlock;
const use = (name: string, input: Record<string, unknown>): Block => ({ type: 'tool_use', id: `tu_${Math.random().toString(36).slice(2, 10)}`, name, input }) as Block;
const say = (text: string): Block => ({ type: 'text', text, citations: null }) as Block;

/** An engine that takes one scripted turn after another and keeps what it was sent. */
function engine(turns: Block[][]): { sdk: Anthropic; sent: Anthropic.Beta.MessageCreateParams[] } {
  const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const base = { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_details: null, stop_sequence: null, usage };
  const sent: Anthropic.Beta.MessageCreateParams[] = [];
  const sdk = {
    beta: {
      messages: {
        stream: (params: Anthropic.Beta.MessageCreateParams) => {
          sent.push(structuredClone(params));
          const content = turns[Math.min(params.messages.filter((m) => m.role === 'assistant').length, turns.length - 1)]!;
          return { finalMessage: async () => ({ ...base, content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }) };
        },
        parse: async () => assert.fail('no structured call is made on the fast track'),
      },
    },
  } as unknown as Anthropic;
  return { sdk, sent };
}

/** The plan of the fixture product as it is: nobody signs in, what is added is kept on the device. */
const FIT_PLAN = {
  coreMoment: '링크를 담아 두고 값이 내리면 안다.',
  screens: [
    { id: 'H-01', name: '홈', purpose: '담아 둔 상품을 본다', entry: ['앱을 연다'], elements: [], states: [], exceptions: [] },
    { id: 'A-01', name: '담기', purpose: '링크를 붙여 상품을 담는다', entry: ['H-01'], elements: [], states: [], exceptions: [] },
  ],
  tasks: [{ id: 'add', goal: '링크를 담는다', outcome: '담은 상품이 목록에 보인다', screen: 'A-01' }],
  events: [],
  roles: [{ id: 'shopper', name: '사는 사람', does: '링크를 담고 값을 본다' }],
  entry: null,
  noAccounts: '담은 것은 이 기기에만 둔다.',
  scenarios: [{ id: 'add-one', role: 'shopper', after: null, steps: [{ id: 'add', screen: 'A-01', does: '링크를 붙여 담는다', saves: null, outcome: '담은 상품이 목록에 보인다' }] }],
  data: [],
};

test('a fit is told what a fit is, its walk writes the project\'s first trails and ledger, and it ends on a branch with the note', async () => {
  assert.ok(readScreenSpec(FIT_PLAN, { works: true, draft: true }).ok, 'the fixture plan holds');
  const finding = { rule: 'type/broken-label', category: 'typography', severity: 'major', source: 'dom', viewport: 'iphone-15-pro', route: '/', message: 'the label "이미지로 저장" breaks over two lines', selector: null, bbox: null, fix: 'T7: keep it on one line.' } as unknown as Finding;
  const walks: { scenarios: string[]; look: unknown }[] = [];
  const scenarios: ScenarioRunnerLike = {
    run: async (_project, spec, opts): Promise<ScenarioOutcome> => {
      walks.push({ scenarios: spec.scenarios.map((s) => s.id), look: opts?.look ?? false });
      return { passed: true, scenarios: 1, walked: 1, problems: [], logins: [], detail: '1 walked', durationMs: 7, looks: [{ screen: 'H-01', scenario: 'add-one', findings: [finding], png: null }], trails: { 'add-one': [{ screen: 'H-01', step: 'add' }, { screen: 'A-01', step: 'add' }] } };
    },
  };
  const smoke: SmokeRunner = { run: async (): Promise<SmokeOutcome> => ({ passed: true, routes: ['/'], issues: [], detail: '1 route loaded without errors', durationMs: 5 }) };
  const model = engine([
    [use('write_file', { path: '.studio-zero/project.json', content: JSON.stringify({ dev: { command: 'npx expo start --web --port 8081', port: 8081 }, routes: ['/'], states: [] }) })],
    [use('write_file', { path: 'docs/screens.json', content: JSON.stringify(FIT_PLAN) })],
    [use('write_file', { path: 'src/home.tsx', content: 'export const title = "CreDeal";\nexport const screen = { screen: \'H-01\' };\n' })],
    [say('웹 타깃이 돌고, 시나리오 하나(add-one)를 걸을 수 있습니다.')],
  ]);
  const d = await testDaemon({}, { anthropic: model.sdk, smoke, scenarios });
  const mine = await checkout();
  try {
    await d.daemon.start();
    d.daemon.evals.measureDraft = async () => null;
    const { studio, sandboxes, store, gate, events } = d.daemon;
    const { project } = await studio.adoptProject(OWNER, { path: mine.dir });
    await studio.settle();
    const main = (await mine.git('rev-parse', 'main')).stdout.trim();

    const task = await studio.submitTask(OWNER, { projectId: project.id, kind: 'adopt', prompt: '결제 화면은 건드리지 않는다.' }, 'desktop');
    for (let i = 0; i < 1500 && !['succeeded', 'failed', 'cancelled'].includes(studio.getTask(task.id).state); i++) await sleep(20);
    const done = studio.getTask(task.id);
    const trace = events.history({ taskId: task.id }, 0, 2000).map((e) => e.body);
    assert.equal(done.state, 'succeeded', `${done.error}\n${trace.map((b) => JSON.stringify(b)).join('\n').slice(0, 4000)}`);

    // Told what a fit is, in the voice for a product that is not ours, and not how the house starts one.
    const first = model.sent[0]!;
    assert.equal(typeof first.system === 'string' ? first.system : (first.system ?? []).map((part) => ('text' in part ? part.text : '')).join(''), adoptedSystemPrompt('app'));
    const request = JSON.stringify(first.messages[0]!.content);
    assert.ok(request.includes(ADOPT_BRIEF.slice(0, 80)));
    assert.ok(!request.includes(DRAFT_BRIEF.slice(0, 60)));
    assert.ok(request.includes('결제 화면은 건드리지 않는다.'), 'the owner\'s notes go with it');

    // Walked whole and measured, and what was measured is the product as it came: recorded, said, held against nobody.
    assert.deepEqual(walks, [{ scenarios: ['add-one'], look: true }]);
    const gates = trace.flatMap((b) => (b.type === 'gate.result' ? [`${b.gate}:${b.passed}`] : []));
    assert.ok(gates.includes('scenarios:true') && gates.includes('looks:true') && gates.includes('smoke:true'), gates.join(' '));
    assert.ok(trace.some((b) => b.type === 'notice' && /들여온 그대로의 제품에 있던 결함 1건/.test(b.message)));
    const kept = store.getWalks(project.id)!;
    assert.deepEqual(kept.ledger['H-01']?.rules, ['type/broken-label']);
    assert.deepEqual(kept.trails['add-one'], [{ screen: 'H-01', step: 'add' }, { screen: 'A-01', step: 'add' }]);
    assert.equal(model.sent.length, 4, 'it was not sent back for what was measured');

    // On its branch: the plan beside the product, the note at the repository's root. Main is as the owner left it.
    const branch = done.branch!;
    const show = async (path: string): Promise<string> => (await sandboxes.exec(project, `git show ${branch}:${path}`, { cwd: '/workspace' })).stdout;
    assert.ok(readScreenSpec(JSON.parse(await show('app/docs/screens.json')), { works: true, draft: true }).ok);
    const agents = await show('AGENTS.md');
    assert.ok(hasBlock(agents));
    assert.match(agents, /In `app\/`/);
    assert.equal(await show('CLAUDE.md'), '@AGENTS.md\n');
    assert.equal(await show('app/AGENTS.md'), 'This is an Expo app.\n', 'the product\'s own note is not touched');
    assert.equal((await sandboxes.exec(project, 'git rev-parse main', { cwd: '/workspace' })).stdout.trim(), main);
    assert.equal(done.landedCommit ?? null, null, 'a fit does not put itself on main');

    // The branch is at the gate, so the owner reads it where they work.
    for (let i = 0; i < 100 && !(await gate.branches(project)).some((b) => b.name === branch); i++) await sleep(50);
    assert.equal((await mine.git('fetch', '-q', 'studio')).exitCode, 0);
    assert.equal((await mine.git('show', `studio/${branch}:CLAUDE.md`)).stdout, '@AGENTS.md\n');
    // Until the owner merges that branch, main is as it came: nothing to walk it by yet.
    assert.equal((await studio.repoStatus(project.id)).planned, false);
    await assert.rejects(studio.submitTask(OWNER, { projectId: project.id, kind: 'inline_edit', prompt: '버튼 글자' }, 'desktop'), /그 브랜치를 main에 합친 뒤에/);
    await studio.merge(OWNER, project.id, branch);
    assert.equal((await studio.repoStatus(project.id)).planned, true);
    // And the merge is at the gate for the owner to pull.
    const merged = (await sandboxes.exec(project, 'git rev-parse main', { cwd: '/workspace' })).stdout.trim();
    for (let i = 0; i < 100 && (await gate.branches(project)).find((b) => b.name === 'main')?.commit !== merged; i++) await sleep(50);
    assert.equal((await mine.git('pull', '-q', '--ff-only', 'studio', 'main')).exitCode, 0);
    assert.equal((await mine.git('rev-parse', 'HEAD')).stdout.trim(), merged);
  } finally {
    await d.cleanup();
    mine.cleanup();
  }
});

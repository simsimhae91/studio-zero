// Self-hosting: the studio's own repository as its pinned first project. The repository goes into the Core
// sandbox and comes back out as git objects only; the owner's merge is the one way the work reaches the files
// the daemon runs from. Git is real here (a throwaway repository stands in for the checkout); the container is
// the emulator, and the dependency install is stubbed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { lintSources } from '@studio-zero/design';
import { CORE_PROJECT_ID, RpcCallError, RpcClient, type ProposalCard } from '@studio-zero/protocol';
import { ConflictError } from '../src/app/errors.ts';
import { SelfHosting, featureBranch, findRepoRoot } from '../src/harness/SelfHosting.ts';
import { CORE_SYSTEM_PROMPT, codingSystemPrompt } from '../src/harness/prompts.ts';
import { sleep } from '../src/util/core.ts';
import { runCommand, type CommandRunner } from '../src/util/run.ts';
import { tempDir, testDaemon, type TestDaemon } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
type Block = Anthropic.Beta.BetaContentBlock;

/** A small repository shaped like this one: a pnpm workspace with a daemon package and a lockfile. */
function checkout(): { dir: string; git: (...args: string[]) => string; cleanup: () => void } {
  const { dir, cleanup } = tempDir('sz-core-repo-');
  const git = (...args: string[]): string => execFileSync('git', ['-C', dir, '-c', 'user.name=Owner', '-c', 'user.email=owner@example.invalid', ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).trim();
  const put = (rel: string, content: string): void => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  git('init', '-q', '-b', 'main');
  put('pnpm-workspace.yaml', 'packages:\n  - "packages/*"\n');
  put('pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
  put('package.json', '{ "name": "studio-zero", "private": true }\n');
  put('packages/daemon/package.json', '{ "name": "@studio-zero/daemon" }\n');
  put('packages/daemon/src/app.ts', 'export const version = 1;\n');
  put('.gitignore', 'node_modules/\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  return { dir, git, cleanup };
}

/** The emulated container, with host `git` passed through to the real one and the install replaced by its effect. */
const hostGit = (base: CommandRunner): CommandRunner => (file, args, opts) => {
  if (file === 'git') return runCommand(file, args, { ...opts, env: { ...opts?.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  const script = args.at(-1) ?? '';
  return base(file, script.includes(SelfHosting.INSTALL) ? [...args.slice(0, -1), script.replace(SelfHosting.INSTALL, 'mkdir -p node_modules')] : args, opts);
};

async function core(repo: string, anthropic?: Anthropic): Promise<TestDaemon> {
  const d = await testDaemon({ selfHosting: { enabled: true, repoPath: repo } }, anthropic ? { anthropic } : {}, hostGit);
  await d.daemon.start();
  return d;
}

test('the repository this daemon runs from is found, and a task\'s branch gets a readable, unique name', () => {
  const root = findRepoRoot();
  assert.ok(root && existsSync(join(root, 'packages', 'daemon', 'src', 'harness', 'SelfHosting.ts')), 'found from the module\'s own location');
  assert.equal(findRepoRoot('/usr/bin/env'), null);
  assert.equal(featureBranch({ id: 'tsk_01HZX9K2ABCDEF', prompt: 'Add a quota popover to the workbench\nwith a countdown' }), 'feature/add-a-quota-popover-to-the-workbench-abcdef');
  assert.equal(featureBranch({ id: 'tsk_01HZX9K2ABCDEF', prompt: '스튜디오 제로 워크벤치에 Quota 팝오버를 추가해줘' }), 'feature/quota-abcdef');
  assert.equal(featureBranch({ id: 'tsk_01HZX9K2ABCDEF', prompt: '장부 탭을 고쳐줘' }), 'feature/change-abcdef');
  assert.equal(codingSystemPrompt('studio-core'), CORE_SYSTEM_PROMPT);
  assert.match(CORE_SYSTEM_PROMPT, /^You are an engineer working on Studio Zero itself[\s\S]*only the owner's own merge moves the code the daemon runs from[\s\S]*Do not weaken, skip or special-case a test, a policy rule or a check/);
});

test('Studio Zero Core is pinned first, fixed, and its dry run says what a task would start from', async () => {
  const repo = checkout();
  const d = await core(repo.dir);
  const rpc = new RpcClient({ url: d.url(), token: d.daemon.clientToken.expose(), client: 'test' });
  try {
    await rpc.connect();
    await rpc.call('projects.create', { name: 'Ledger', slug: 'ledger', template: 'web-vite-react' });
    const listed = (await rpc.call('projects.list', {})).projects;
    assert.deepEqual(listed.map((p) => [p.id, p.name, p.template]), [[CORE_PROJECT_ID, 'Studio Zero Core', 'studio-core'], [listed[1]!.id, 'Ledger', 'web-vite-react']], 'ahead of every project, however old');
    assert.deepEqual((await rpc.call('evals.list', { projectId: CORE_PROJECT_ID })).evals.map((e) => [e.name, e.spec.kind === 'command' ? e.spec.command : e.spec.kind]).sort(), [['build', 'pnpm build'], ['slop-lint', 'slop-lint'], ['tests', 'pnpm test']], 'held to its own test suite and build, not to a visual audit');

    const fixed = (e: unknown): boolean => e instanceof RpcCallError && e.code === 'conflict';
    await assert.rejects(rpc.call('projects.rename', { projectId: CORE_PROJECT_ID, name: 'Mine' }), fixed);
    await assert.rejects(rpc.call('projects.delete', { projectId: CORE_PROJECT_ID, deleteWorkspace: true }), fixed);
    await assert.rejects(rpc.call('projects.create', { name: 'x', slug: 'another-core', template: 'studio-core' as never }), (e: unknown) => e instanceof RpcCallError && e.code === 'invalid_params', 'an owner cannot make a second one');

    const status = await rpc.call('selfhost.status', {});
    assert.deepEqual([status.available, status.repoPath?.endsWith(repo.dir.split('/').at(-1)!), status.baseBranch, status.head, status.clean, status.projectId, status.pending], [true, true, 'main', repo.git('rev-parse', 'HEAD'), true, CORE_PROJECT_ID, []]);
    writeFileSync(join(repo.dir, 'scratch.txt'), 'not committed\n');
    const dirty = await rpc.call('selfhost.status', {});
    assert.equal(dirty.clean, false);
    assert.match(dirty.detail, /uncommitted changes, which tasks do not see/);
  } finally {
    rpc.close();
    await d.cleanup();
    repo.cleanup();
  }
});

test('without a checkout to work on, self-hosting says why and mounts nothing', async () => {
  const elsewhere = tempDir('sz-not-a-repo-');
  const d = await testDaemon({ selfHosting: { enabled: true, repoPath: elsewhere.dir } }, {}, hostGit);
  await d.daemon.start();
  try {
    assert.deepEqual(d.daemon.studio.listProjects(), []);
    const status = await d.daemon.studio.selfHostStatus();
    assert.deepEqual([status.available, status.projectId], [false, null]);
    assert.match(status.detail, /is not the root of a git checkout/);
    const off = await testDaemon();
    assert.match((await off.daemon.studio.selfHostStatus()).detail, /self-hosting is switched off/);
    await off.cleanup();
  } finally {
    await d.cleanup();
    elsewhere.cleanup();
  }
});

test('in as a bundle, out as a feature branch: a Core task never touches the checkout, and only the owner\'s merge moves it', async () => {
  const repo = checkout();
  const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const base = { id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_details: null, stop_sequence: null, usage };
  const turns: Block[][] = [
    [{ type: 'tool_use', id: 'tu_1', name: 'bash', input: { command: 'cat packages/daemon/src/app.ts && git log --format=%s -n 1' } } as Block],
    [{ type: 'tool_use', id: 'tu_2', name: 'write_file', input: { path: 'packages/daemon/src/app.ts', content: 'export const version = 2;\n' } } as Block],
    [{ type: 'text', text: 'Bumped the version.', citations: null } as Block],
  ];
  const sent: Anthropic.Beta.MessageCreateParams[] = [];
  const anthropic = {
    beta: {
      messages: {
        stream: (params: Anthropic.Beta.MessageCreateParams) => {
          sent.push(structuredClone(params));
          const content = turns.shift() ?? assert.fail('the script ran out of turns');
          return { finalMessage: async () => ({ ...base, content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }) };
        },
        parse: async () => assert.fail('a draft makes no structured call'),
      },
    },
  } as unknown as Anthropic;
  const d = await core(repo.dir, anthropic);
  const { studio, events } = d.daemon;
  try {
    // The test suite and the build are this project's gates; here they would run pnpm on the host, so they are off.
    for (const ev of studio.listEvals(CORE_PROJECT_ID).filter((e) => e.spec.kind === 'command')) await studio.setEvalEnabled(OWNER, ev.id, false);
    // Something committed after the daemon started is what the task must see; something uncommitted is not.
    writeFileSync(join(repo.dir, 'README.md'), '# committed later\n');
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', 'docs: readme');
    writeFileSync(join(repo.dir, 'notes.local'), 'uncommitted\n');
    const before = repo.git('rev-parse', 'main');

    const submitted = await studio.submitTask(OWNER, { projectId: CORE_PROJECT_ID, kind: 'build', prompt: 'Bump the version', track: 'fast' }, 'desktop');
    for (let i = 0; i < 1500 && !['succeeded', 'failed', 'cancelled'].includes(studio.getTask(submitted.id).state); i++) await sleep(20);
    const task = studio.getTask(submitted.id);
    const trace = events.history({ taskId: task.id }, 0, 1000).map((e) => e.body);
    assert.equal(task.state, 'succeeded', `${task.error}\n${trace.map((b) => JSON.stringify(b)).join('\n').slice(0, 3000)}`);

    // --- in: the sandbox held the repository as committed, and its own system prompt
    assert.match(JSON.stringify(sent[0]!.system), /You are an engineer working on Studio Zero itself/);
    assert.ok(!JSON.stringify(sent[0]!.messages).includes('Draft 0 task'), 'a quick change to the studio is not briefed as the first draft of a product');
    const looked = trace.find((b) => b.type === 'tool.result');
    assert.ok(looked?.type === 'tool.result' && /export const version = 1;[\s\S]*docs: readme/.test(looked.preview), 'the task started from the latest commit on main');
    assert.ok(existsSync(join(d.workspace, 'README.md')) && !existsSync(join(d.workspace, 'notes.local')) && existsSync(join(d.workspace, 'node_modules', '.sz-lock')), 'committed files only, dependencies installed once');
    assert.ok(!existsSync(join(d.workspace, '.studio-zero', 'theme.css')), 'no product kit is written into the studio\'s own repository');

    // --- out: a new ref, and nothing else moved
    const exported = trace.find((b) => b.type === 'selfhost.exported');
    assert.ok(exported?.type === 'selfhost.exported');
    assert.deepEqual([exported.branch, exported.base, exported.files, exported.insertions, exported.deletions], [`feature/bump-the-version-${task.id.slice(-6).toLowerCase()}`, 'main', 1, 1, 1]);
    assert.equal(repo.git('rev-parse', 'main'), before, 'main did not move');
    assert.equal(readFileSync(join(repo.dir, 'packages/daemon/src/app.ts'), 'utf8'), 'export const version = 1;\n', 'no file in the working tree changed');
    assert.equal(repo.git('show', `${exported.branch}:packages/daemon/src/app.ts`), 'export const version = 2;');
    assert.equal(repo.git('rev-parse', `${exported.branch}~1`), before, 'the branch is one commit on top of what the task started from');
    assert.deepEqual((await studio.selfHostStatus()).pending, [{ taskId: task.id, branch: exported.branch, files: 1, insertions: 1, deletions: 1 }]);

    // --- merge: the desk only, a clean checkout only, and inside the sandbox there is nothing to merge into
    await assert.rejects(studio.merge(OWNER, CORE_PROJECT_ID, task.branch!), ConflictError);
    await assert.rejects(studio.selfHostMerge({ type: 'owner', via: 'telegram' }, task.id), /can only be merged into from an authenticated desktop client/);
    await assert.rejects(studio.selfHostMerge({ type: 'agent', taskId: task.id }, task.id), /denied by policy/);
    await assert.rejects(studio.selfHostMerge(OWNER, task.id), /uncommitted changes \(1 path\(s\)\)/, 'the untracked note blocks the merge; nothing is thrown away to make room');
    assert.equal(repo.git('rev-parse', 'main'), before);

    execFileSync('rm', [join(repo.dir, 'notes.local')]);
    repo.git('checkout', '-q', '-b', 'side');
    await assert.rejects(studio.selfHostMerge(OWNER, task.id), /the checkout is on "side", not "main"/);
    repo.git('checkout', '-q', 'main');

    // Had the work been a proposal's, that merge is what the proposal was waiting for.
    const { store } = d.daemon;
    store.insertIngest({ id: 'kig_core0002', projectId: CORE_PROJECT_ID, repoUrl: 'https://github.com/acme/widgets', createdAt: 1 });
    store.insertProposal({ id: 'prp_core0002', projectId: CORE_PROJECT_ID, ingestId: 'kig_core0002', sourceRepo: 'https://github.com/acme/widgets', sourceCommit: 'a'.repeat(40), practiceId: 'version', title: 'Bump the version', rationale: '', evidence: [], plannedChanges: [], risk: 'low', estimatedImpact: '', state: 'ready', branch: task.branch, taskId: task.id, diff: null, diffStat: null, measured: null, createdAt: 1 }, '');

    const merged = await studio.selfHostMerge(OWNER, task.id);
    assert.deepEqual([merged.branch, merged.into, merged.commit], [exported.branch, 'main', repo.git('rev-parse', exported.branch)]);
    assert.equal(studio.kirbyProposals(CORE_PROJECT_ID)[0]!.state, 'merged', 'a proposal built on that branch is merged with it');
    assert.equal(readFileSync(join(repo.dir, 'packages/daemon/src/app.ts'), 'utf8'), 'export const version = 2;\n');
    assert.deepEqual((await studio.selfHostStatus()).pending, []);
    await assert.rejects(studio.selfHostMerge(OWNER, task.id), /already merged/);
    assert.ok(events.history({ taskId: task.id }, 0, 1000).some((e) => e.body.type === 'selfhost.merged'));

    // An agent cannot export, and nothing but the Core project can be exported.
    await assert.rejects(d.daemon.policy.authorize({ type: 'agent', taskId: task.id }, { kind: 'selfhost.export', projectId: CORE_PROJECT_ID, branch: 'feature/x' }), /only the harness exports/);
    await assert.rejects(d.daemon.policy.authorize({ type: 'system' }, { kind: 'selfhost.export', projectId: CORE_PROJECT_ID, branch: 'main' }), /exports go to a new feature\/ branch/);
  } finally {
    await d.cleanup();
    repo.cleanup();
  }
});

test('a base branch that moved on is not overwritten: the merge is refused and the feature branch is kept', async () => {
  const repo = checkout();
  const d = await core(repo.dir);
  const { sandboxes, selfHosting, store } = d.daemon;
  try {
    const project = store.getProject(CORE_PROJECT_ID)!;
    await d.daemon.provisioner.ensure(project);
    assert.ok(existsSync(join(d.workspace, 'pnpm-workspace.yaml')), 'opening the project fills its workspace');
    // A task's work, done the way the harness does it.
    const task = store.insertTask({ id: 'tsk_moved0001', projectId: project.id, kind: 'build', prompt: 'Change the daemon', origin: 'desktop', budgetTokens: 1000, branch: 'sz/tsk_moved0001', createdAt: 1 });
    await sandboxes.startBranch(project, task.branch!, 'main');
    await sandboxes.writeFile(project, 'packages/daemon/src/app.ts', 'export const version = 3;\n');
    await sandboxes.commitAll(project, 'feat: change the daemon');
    const exported = await selfHosting.export(project, task);
    assert.ok(exported);
    assert.deepEqual(await selfHosting.export(project, task), exported, 'exporting twice adds nothing');

    // Meanwhile the owner committed to main themselves.
    writeFileSync(join(repo.dir, 'CHANGELOG.md'), 'mine\n');
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', 'docs: changelog');
    const mine = repo.git('rev-parse', 'main');
    await assert.rejects(selfHosting.merge(task.id), /main has moved since this task started, so feature\/change-the-daemon-ed0001 cannot be fast-forwarded/);
    assert.deepEqual([repo.git('rev-parse', 'main'), repo.git('rev-parse', '--verify', exported.branch).length], [mine, 40]);

    // The next task starts from the owner's commit, and a task that commits nothing has nothing to hand over.
    await selfHosting.sync(project);
    assert.equal(readFileSync(join(d.workspace, 'CHANGELOG.md'), 'utf8'), 'mine\n');
    const idle = store.insertTask({ id: 'tsk_idle00002', projectId: project.id, kind: 'build', prompt: 'Nothing', origin: 'desktop', budgetTokens: 1000, branch: 'sz/tsk_idle00002', createdAt: 2 });
    await sandboxes.startBranch(project, idle.branch!, 'main');
    assert.equal(await selfHosting.export(project, idle), null);
  } finally {
    await d.cleanup();
    repo.cleanup();
  }
});

test('what is taken from another repository is built into the studio as a planned change, not as a product draft', async () => {
  const repo = checkout();
  const d = await core(repo.dir);
  const { studio, store } = d.daemon;
  try {
    store.insertIngest({ id: 'kig_core0001', projectId: CORE_PROJECT_ID, repoUrl: 'https://github.com/acme/widgets', createdAt: 1 });
    const card: ProposalCard = { id: 'prp_core0001', projectId: CORE_PROJECT_ID, ingestId: 'kig_core0001', sourceRepo: 'https://github.com/acme/widgets', sourceCommit: 'a'.repeat(40), practiceId: 'schedules', title: 'Add owner-set schedules', rationale: 'It runs work on a timer.', evidence: [], plannedChanges: [], risk: 'medium', estimatedImpact: '', state: 'proposed', branch: null, taskId: null, diff: null, diffStat: null, measured: null, createdAt: 1 };
    store.insertProposal(card, 'Add the table, then the scheduler.');
    const task = await studio.kirbyMaterialize(OWNER, card.id, 'desktop');
    assert.deepEqual([task.kind, task.track], ['kirby_materialize', 'full'], 'a product takes a card as a draft; the studio\'s own code is planned first and held to all of its gates');
    assert.match(task.prompt, /^Add owner-set schedules\n\nBuild this into the project\. /, 'the card\'s title leads the request');
    assert.equal(featureBranch(task), `feature/add-owner-set-schedules-${task.id.slice(-6).toLowerCase()}`, 'so the branch that reaches the checkout is named by what was built');
    studio.cancelTask(task.id);
    for (let i = 0; i < 500 && !['succeeded', 'failed', 'cancelled'].includes(studio.getTask(task.id).state); i++) await sleep(20);
  } finally {
    await d.cleanup();
    repo.cleanup();
  }
});

test('the repository passes the slop lint its own tasks are held to', () => {
  // A Core task is failed by any serious finding in the files it starts from, whoever wrote them. Guide pages
  // committed with their own colours once did that to every task before it began.
  const root = findRepoRoot()!;
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter((path) => path !== '' && existsSync(join(root, path)));
  const serious = lintSources(tracked.filter((path) => /\.(tsx|jsx|html|vue|svelte|astro|mdx|css|scss|pcss)$/.test(path)).map((path) => ({ path, content: readFileSync(join(root, path), 'utf8') }))).filter((f) => f.severity !== 'minor');
  assert.deepEqual(serious.map((f) => `${f.file}:${f.line} ${f.rule} ${f.message}`), []);
});

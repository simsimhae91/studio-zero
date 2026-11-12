// What only a real container engine and the real network can show of the reference kit and of self-hosting:
// that a public page is opened and measured inside the QA browser container, and that this repository, bundled
// into a real sandbox, installs and type-checks there and comes back out as a feature branch.
//
// Opt-in: `SZ_TEST_ENGINE=1 node --test packages/daemon/test/phase3.integration.test.ts`. Needs OrbStack
// running and network access. It replaces the shared `sz-qa-browser` container, so run it while the daemon is
// idle. The checkout it merges into is a throwaway clone of this repository, never the repository itself.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CORE_PROJECT_ID, type Project } from '@studio-zero/protocol';
import { createDaemon } from '../src/app/compose.ts';
import { testConfig } from '../src/config.ts';
import { findRepoRoot } from '../src/harness/SelfHosting.ts';
import { fakeSecurity, freePort, quietLog, tempDir } from './helpers.ts';

const skip = process.env.SZ_TEST_ENGINE !== '1' && 'set SZ_TEST_ENGINE=1 to run (needs OrbStack running and network access)';

test('reference capture on a real engine: a public page is opened in the QA browser container and comes back as measurements', { skip }, async () => {
  const home = tempDir('sz-ref-');
  const config = testConfig(home.dir, { listen: { port: await freePort() }, gateway: { port: await freePort() }, engines: { claudeCode: { enabled: false } }, runtime: { memoryMb: 1024 }, selfHosting: { enabled: false } });
  const daemon = await createDaemon(config, quietLog, { securityRun: fakeSecurity().run });
  const { studio, sandboxes, refkit, events } = daemon;
  const project = studio.createProject({ type: 'owner', via: 'desktop' }, { name: 'Reference test', slug: `it-${randomBytes(4).toString('hex')}`, template: 'web-vite-react' });
  try {
    await studio.settle();
    assert.equal((await sandboxes.info(project)).state, 'running');
    const [page, local] = await refkit.capture(project, null, ['https://example.com/', 'https://localhost/']) as [Awaited<ReturnType<typeof refkit.capture>>[number], Awaited<ReturnType<typeof refkit.capture>>[number]];
    const [refused, opened] = page.ok ? [local, page] : [page, local];
    assert.deepEqual([refused.url, refused.ok, refused.error], ['https://localhost/', false, 'localhost is not a public host name']);
    assert.equal(opened.ok, true, opened.error ?? '');
    assert.equal(opened.title, 'Example Domain');
    assert.match(opened.summary, /^page: 1440x900 CSS px viewport/);
    // What the page says is its owner's business and changes; that each line of the summary was measured is what is checked.
    assert.match(opened.summary, /\nlargest text: \d+px, weight \d+, line-height \d\.\d\d, letter-spacing -?\d\.\d{3}em, set in [^:]+: "[^"]+"\nrunning text: /);
    assert.match(opened.summary, /\nfirst screenful: \d+ picture\(s\), \d+ control\(s\)/);
    assert.ok(opened.png && opened.png.length > 2000 && opened.png[1] === 0x50 && opened.png[2] === 0x4e, 'a PNG of the first screenful');
    assert.equal(events.history({ projectId: project.id }, 0, 100).filter((e) => e.body.type === 'reference.captured').length, 2);
  } finally {
    await sandboxes.destroy(project, { deleteWorkspace: true }).catch(() => undefined);
    await sandboxes.stopQaBrowser().catch(() => undefined);
    await daemon.stop().catch(() => undefined);
    home.cleanup();
  }
});

test('mock-ups on a real engine: pages in a sandbox are drawn in the QA browser container with scripts and the network off', { skip }, async () => {
  const home = tempDir('sz-mock-');
  const config = testConfig(home.dir, { listen: { port: await freePort() }, gateway: { port: await freePort() }, engines: { claudeCode: { enabled: false } }, runtime: { memoryMb: 1024 }, selfHosting: { enabled: false } });
  const daemon = await createDaemon(config, quietLog, { securityRun: fakeSecurity().run });
  const { studio, sandboxes, mockups, store } = daemon;
  const project = studio.createProject({ type: 'owner', via: 'desktop' }, { name: 'Mock-up test', slug: `it-${randomBytes(4).toString('hex')}`, template: 'web-vite-react' });
  try {
    await studio.settle();
    // The second page tries what a steered agent's page would: rename itself by script, and pull a picture from the network.
    const page = (title: string, body: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${title}이 먼저 보입니다."><style>body{margin:0;font:16px system-ui}h1{font-size:96px;margin:96px}</style></head><body>${body}</body></html>`;
    const write = async (name: string, html: string): Promise<void> => {
      const res = await sandboxes.exec(project, `mkdir -p docs/mockups && cat > docs/mockups/${name}`, { stdin: html, timeoutSec: 30 });
      assert.equal(res.exitCode, 0, res.stderr);
    };
    await write('a.html', page('흐름 한 줄', '<h1>₩184,000</h1>'));
    await write('b.html', page('이번 달 영수증', '<h1>영수증</h1><img src="https://example.com/x.png" alt=""><script>document.title = "SCRIPT RAN"</script>'));

    const options = await mockups.render(project);
    assert.deepEqual(options.map((o) => [o.file, o.title, o.idea, o.width, o.height]), [
      ['docs/mockups/a.html', '흐름 한 줄', '흐름 한 줄이 먼저 보입니다.', 1440, 900],
      ['docs/mockups/b.html', '이번 달 영수증', '이번 달 영수증이 먼저 보입니다.', 1440, 900],
    ]);
    for (const o of options) {
      const png = readFileSync(store.getArtifact(o.artifactId)!.file);
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1440, 900], 'a PNG of the first screen');
      assert.ok(png.length > 3000, 'and not a blank one');
    }
  } finally {
    await sandboxes.destroy(project, { deleteWorkspace: true }).catch(() => undefined);
    await sandboxes.stopQaBrowser().catch(() => undefined);
    await daemon.stop().catch(() => undefined);
    home.cleanup();
  }
});

test('self-hosting on a real engine: this repository installs and type-checks in its sandbox, and a change comes back as a feature branch', { skip }, async () => {
  const repo = findRepoRoot();
  assert.ok(repo, 'this test runs from a checkout of the repository');
  const home = tempDir('sz-core-');
  // A clone stands in for the checkout, so that nothing here can move a branch of the real one.
  const clone = tempDir('sz-core-clone-');
  const git = (...args: string[]): string => execFileSync('git', ['-C', clone.dir, ...args], { encoding: 'utf8' }).trim();
  execFileSync('git', ['clone', '-q', '--no-hardlinks', '--branch', 'main', repo, clone.dir]);
  const config = testConfig(home.dir, { listen: { port: await freePort() }, gateway: { port: await freePort() }, engines: { claudeCode: { enabled: false } }, selfHosting: { enabled: true, repoPath: clone.dir } });
  const daemon = await createDaemon(config, quietLog, { securityRun: fakeSecurity().run });
  const { store, sandboxes, selfHosting } = daemon;
  // The pinned project under a name of its own, so its container cannot collide with a mounted Core project's.
  const project: Project = { id: CORE_PROJECT_ID, slug: `it-core-${randomBytes(3).toString('hex')}`, name: 'Studio Zero Core', template: 'studio-core', createdAt: Date.now() };
  store.insertProject(project);
  const sh = async (script: string, timeoutSec = 600): Promise<{ code: number; out: string }> => {
    const res = await sandboxes.exec(project, script, { timeoutSec });
    return { code: res.exitCode, out: `${res.stdout}${res.stderr}`.trim() };
  };
  try {
    await sandboxes.ensure(project);
    await selfHosting.sync(project);
    assert.equal((await sh('git rev-parse HEAD')).out, git('rev-parse', 'main'), 'the workspace is the base branch as committed');
    assert.equal((await sh('test -d node_modules/.pnpm && cat node_modules/.sz-lock')).out, (await sh('git hash-object pnpm-lock.yaml')).out, 'dependencies were installed from the lockfile');

    const typed = await sh('npm run --silent typecheck');
    assert.equal(typed.code, 0, typed.out.slice(-2000));

    const task = store.insertTask({ id: `tsk_it${randomBytes(4).toString('hex')}`, projectId: project.id, kind: 'build', prompt: 'Add a note for the next engineer', origin: 'desktop', budgetTokens: 1000, branch: 'sz/it-core', createdAt: Date.now() });
    await sandboxes.startBranch(project, task.branch!, 'main');
    await sandboxes.writeFile(project, 'docs/NOTE.md', '# written in the Core sandbox\n');
    await sandboxes.commitAll(project, 'docs: a note');
    const exported = await selfHosting.export(project, task);
    assert.ok(exported && exported.files === 1, JSON.stringify(exported));
    assert.equal(git('show', `${exported.branch}:docs/NOTE.md`), '# written in the Core sandbox');
    assert.equal(git('status', '--porcelain'), '', 'the checkout\'s working tree was not touched');
    const merged = await selfHosting.merge(task.id);
    assert.deepEqual([merged.into, git('rev-parse', 'main')], ['main', merged.commit]);
  } finally {
    await sandboxes.destroy(project, { deleteWorkspace: true }).catch(() => undefined);
    await daemon.stop().catch(() => undefined);
    home.cleanup();
    clone.cleanup();
  }
});

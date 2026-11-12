import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { createTheme, renderThemeCss, seedFromName } from '@studio-zero/design';
import { createDaemon } from '../src/app/compose.ts';
import { testConfig } from '../src/config.ts';
import { Secret, sha256Hex, sleep } from '../src/util/core.ts';
import { fakeProvider, fakeSecurity, freePort, quietLog, tempDir } from './helpers.ts';

const OWNER = { type: 'owner', via: 'desktop' } as const;
const REAL_KEY = 'sk-ant-api03-integration-test-key';

const SERVER_JS = `const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
http.createServer((req, res) => {
  const file = path.join('/workspace', req.url === '/' ? 'index.html' : path.normalize(req.url.split('?')[0]));
  if (!file.startsWith('/workspace/') || !fs.existsSync(file)) return res.writeHead(404).end('not found');
  res.writeHead(200, { 'content-type': file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' }).end(fs.readFileSync(file));
}).listen(5173, '0.0.0.0');
`;

const PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/.studio-zero/theme.css">
<style>
  body { margin: 0; font-family: Geist, sans-serif; background: var(--sz-bg); color: var(--sz-fg); }
  main { padding: 24px; display: grid; gap: 24px; }
  h1 { font-size: 30px; line-height: 1.3; margin: 0; }
  p { font-size: 16px; line-height: 1.6; margin: 0; color: var(--sz-fg-muted); }
  a.action { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px; border-radius: 8px; background: var(--sz-accent); color: var(--sz-on-accent); font-size: 16px; text-decoration: none; }
</style>
</head>
<body><main><h1>미결제 청구서</h1><p>결제를 기다리는 청구서가 3건 있습니다.</p><a class="action" href="/invoices">청구서 보기</a></main></body>
</html>
`;

function fakeModel(): Anthropic {
  const usage = { input_tokens: 400, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const answer = (system: string): unknown => {
    if (system.startsWith('You are reviewing one screen')) return { rubric: { hierarchy: 9, whitespace: 9, typography: 9, color: 9, copy: 9, originality: 9 }, findings: [], summary: 'Clean.' };
    if (system.startsWith('You are a staff engineer reviewing')) {
      return { title: 'Validate request bodies with schemas', rationale: 'Inputs are trusted as they arrive.', plannedChanges: [{ path: 'server.js', action: 'modify', description: 'Parse inputs.' }], risk: 'low', estimatedImpact: 'Fewer malformed-input bugs.', implementationBrief: 'Add a schema at the request boundary.' };
    }
    throw new Error(`unexpected structured call: ${system.slice(0, 40)}`);
  };
  return {
    beta: { messages: { parse: async (params: Anthropic.Beta.MessageCreateParams) => ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: 'end_turn', stop_details: null, usage, parsed_output: answer(String(params.system)) }) } },
  } as unknown as Anthropic;
}

/**
 * The parts of the system that only a real container engine can prove: isolation flags as the kernel sees them,
 * the key-swapping gateway reached from inside a sandbox, previews, checkpoints on a real volume, the QA browser
 * container, and the throwaway clone container.
 *
 * Opt-in: `SZ_TEST_ENGINE=1 pnpm test`. Needs OrbStack (or another engine behind the `orbstack` Docker context)
 * running and network access; the first run pulls and builds images (a few minutes, about 3 GB).
 */
test('real container engine', { skip: process.env.SZ_TEST_ENGINE !== '1' && 'set SZ_TEST_ENGINE=1 to run (needs OrbStack running)' }, async (t) => {
  const upstream = await fakeProvider();
  const home = tempDir('sz-engine-');
  const security = fakeSecurity();
  const config = testConfig(home.dir, { listen: { port: await freePort() }, gateway: { port: await freePort() }, engines: { claudeCode: { enabled: false } }, runtime: { memoryMb: 1024 } });
  const daemon = await createDaemon(config, quietLog, { securityRun: security.run, anthropic: fakeModel(), gatewayUpstreams: { anthropic: upstream.url, openai: upstream.url } });
  await daemon.start();
  const { studio, sandboxes, events, store } = daemon;
  const project = studio.createProject(OWNER, { name: 'Engine test', slug: `it-${randomBytes(4).toString('hex')}`, template: 'web-vite-react' });
  const sh = async (script: string): Promise<string> => {
    const res = await sandboxes.exec(project, script, { timeoutSec: 60 });
    return `${res.stdout}${res.stderr}`.trim();
  };
  const waitFor = async <T>(read: () => T | undefined | false | null, what: string, seconds: number): Promise<T> => {
    for (let i = 0; i < seconds * 4; i++) {
      const value = read();
      if (value) return value;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${what}: ${events.history({}, 0, 500).slice(-6).map((e) => JSON.stringify(e.body)).join('\n')}`);
  };

  try {
    await waitFor(() => events.history({ projectId: project.id }, 0, 50).some((e) => e.body.type === 'sandbox.state' || e.body.type === 'notice') , 'provisioning', 1200);
    assert.equal((await sandboxes.info(project)).state, 'running', JSON.stringify(events.history({ projectId: project.id }, 0, 50).map((e) => e.body)));

    await t.test('the sandbox is confined as configured', async () => {
      assert.equal(await sh('id -u; id -g'), '1000\n1000');
      assert.match(await sh('grep CapEff /proc/self/status'), /CapEff:\s+0000000000000000/, 'no capabilities');
      assert.match(await sh('grep NoNewPrivs /proc/self/status'), /NoNewPrivs:\s+1/);
      assert.equal(await sh('cat /sys/fs/cgroup/memory.max; cat /sys/fs/cgroup/pids.max'), `${1024 * 1024 * 1024}\n512`);
      assert.match(await sh('ls /var/run/docker.sock 2>&1'), /No such file/, 'no engine socket inside');
      assert.equal(await sh('grep -c " /workspace " /proc/mounts'), '1');
      assert.match(await sh('node -v; pnpm -v; git --version'), /^v24\.\d+\.\d+\n\d+\.\d+\.\d+\ngit version/);
      assert.match(await sh('git log --format=%s'), /^chore: add Studio Zero theme, project file and AX kit\nchore: initialize workspace$/);
      assert.equal(await sh('cat .studio-zero/theme.css | head -c 200 | grep -c "Generated by @studio-zero/design"'), '1');
    });

    await t.test('provider keys stay on the host: the sandbox reaches models only through the gateway', async () => {
      await studio.vaultSet(OWNER, 'provider/anthropic/api-key', new Secret(REAL_KEY));
      const token = await sh('printf %s "$ANTHROPIC_API_KEY"');
      assert.match(token, /^szg_[\w-]{32}$/);
      assert.equal(store.getSandbox(project.id)?.gatewayTokenHash, sha256Hex(token));
      assert.equal(await sh('env | grep -c "sk-ant" || true'), '0', 'no provider key anywhere in the sandbox environment');

      const call = (key: string): Promise<string> =>
        sh(`curl -s -m 20 -o /tmp/out -w '%{http_code}' -X POST -H "x-api-key: ${key}" -H 'content-type: application/json' -H 'anthropic-version: 2023-06-01' -d '{"model":"claude-opus-5-5","max_tokens":1,"stream":true,"messages":[]}' "$ANTHROPIC_BASE_URL/v1/messages"; echo; cat /tmp/out`);
      const good = await call('$ANTHROPIC_API_KEY');
      assert.match(good, /^200\n[\s\S]*text_delta/, `gateway call from inside the sandbox: ${good.slice(0, 200)}`);
      assert.equal(upstream.requests.at(-1)?.headers['x-api-key'], REAL_KEY, 'the provider saw the real key');
      assert.ok(!JSON.stringify(upstream.requests).includes(token), 'and never the sandbox token');
      assert.match(await call('szg_not-the-right-token-aaaaaaaaaaaaaaaaaaa'), /^401\n/);
      assert.equal(store.projectTokensSince(project.id, 0), 195, 'metered into the ledger');
    });

    await t.test('the control socket is not open to sandboxes', async () => {
      const control = `http://host.docker.internal:${config.listen.port}`;
      assert.equal(await sh(`curl -s -m 10 -o /dev/null -w '%{http_code}' ${control}/healthz`), '403', 'unknown Host header');
      assert.equal(await sh(`curl -s -m 10 -o /dev/null -w '%{http_code}' -H 'Host: localhost' ${control}/v1/artifacts/art_x`), '401', 'a spoofed Host still needs the token');
      assert.equal(await sh(`curl -s -m 10 -o /dev/null -w '%{http_code}' -H 'Host: localhost' -H 'authorization: Bearer szb_guess' ${control}/v1/bridge/tools`), '401');
    });

    await t.test('dev server, preview URLs, stop', async () => {
      await sandboxes.writeFile(project, 'server.js', SERVER_JS);
      await sandboxes.writeFile(project, 'index.html', PAGE);
      await sandboxes.writeFile(project, '.studio-zero/project.json', JSON.stringify({ dev: { command: 'node server.js', port: 5173 }, routes: ['/'] }));
      await sandboxes.commitAll(project, 'page');
      await sandboxes.startProcess(project, 'dev', 'node server.js');
      assert.equal(await sandboxes.waitForHttp(project, 5173, '/', 20), true);

      const preview = (await sandboxes.info(project)).previewUrls.find((p) => p.containerPort === 5173)!;
      assert.match(preview.localhost, /^http:\/\/localhost:\d+$/);
      assert.match(await (await fetch(preview.localhost)).text(), /미결제 청구서/, 'published on the host loopback');
      const orbLocal = await fetch(preview.orbLocal, { signal: AbortSignal.timeout(5000) }).then((r) => r.text(), (e: unknown) => `unreachable: ${String(e)}`);
      t.diagnostic(`${preview.orbLocal} → ${orbLocal.includes('미결제') ? 'reachable' : orbLocal.slice(0, 80)}`);

      await sandboxes.stopProcess(project, 'dev');
      assert.equal(await sandboxes.waitForHttp(project, 5173, '/', 2), false, 'the whole process group is gone');
    });

    await t.test('checkpoint and rollback on a real volume', async () => {
      const before = await sh('git status --porcelain; git rev-parse HEAD');
      const started = Date.now();
      const checkpoint = await sandboxes.checkpoint(project, 'before experiment');
      const checkpointMs = Date.now() - started;
      await sandboxes.writeFile(project, 'index.html', '<p>broken</p>');
      await sandboxes.writeFile(project, 'extra.txt', 'x');
      await sandboxes.commitAll(project, 'experiment');
      const rollbackStarted = Date.now();
      await sandboxes.rollback(project, checkpoint.id);
      t.diagnostic(`checkpoint ${checkpointMs}ms, rollback ${Date.now() - rollbackStarted}ms`);
      assert.equal(await sh('git status --porcelain; git rev-parse HEAD'), before);
      assert.match(await sh('cat index.html'), /미결제 청구서/);
      assert.match(await sh('ls extra.txt 2>&1'), /No such file/);
    });

    await t.test('recreate resets the container, keeps the workspace, rotates the gateway token', async () => {
      const oldHash = store.getSandbox(project.id)!.gatewayTokenHash;
      await sh('touch /tmp/only-in-container');
      const started = Date.now();
      await sandboxes.recreate(project);
      t.diagnostic(`recreate ${Date.now() - started}ms`);
      assert.match(await sh('ls /tmp/only-in-container 2>&1'), /No such file/);
      assert.match(await sh('cat index.html'), /미결제 청구서/);
      assert.notEqual(store.getSandbox(project.id)!.gatewayTokenHash, oldHash);
    });

    await t.test('visual audit through the QA browser container', async () => {
      const report = await studio.runAudit(OWNER, project.id, ['/']);
      const domRules = [...new Set(report.findings.filter((f) => f.source === 'dom').map((f) => f.rule))];
      assert.deepEqual([...new Set(report.screenshots.map((s) => s.viewport))], ['iphone-15-pro', 'ipad-pro-11', 'desktop-1440']);
      assert.deepEqual(domRules, ['type/font-not-loaded'], JSON.stringify(report.findings.map((f) => `${f.rule}: ${f.message}`)));
      assert.equal(report.passed, true, `score ${report.score}`);
      const shot = store.getArtifact(report.screenshots.find((s) => s.viewport === 'iphone-15-pro')!.artifactId)!;
      assert.ok(existsSync(shot.file));
      t.diagnostic(`audit score ${report.score}; ${report.screenshots.length} screenshots`);

      // A page built from the generated theme, rendered in the container's Chromium, holds AAA in dark mode too.
      assert.ok(!report.findings.some((f) => f.rule.endsWith('@dark')));
      assert.match(renderThemeCss(createTheme(seedFromName(project.slug))), /--sz-accent/);
    });

    await t.test('kirby clones a real repository in a throwaway container', async () => {
      await studio.kirbyIngest(OWNER, project.id, 'https://github.com/n8n-io/nod', 1);
      const ingested = await waitFor(() => events.history({ projectId: project.id }, 0, 500).find((e) => e.body.type === 'kirby.ingested')?.body, 'kirby ingest', 180);
      assert.ok(ingested.type === 'kirby.ingested' && ingested.files > 1000, JSON.stringify(ingested));
      const [card] = await waitFor(() => {
        const cards = studio.kirbyProposals(project.id);
        return cards.length > 0 && cards;
      }, 'proposal', 30);
      assert.match(card!.sourceCommit, /^[0-9a-f]{40}$/);
      assert.ok(card!.evidence.length > 0 && card!.evidence.every((e) => e.line > 0), 'evidence comes from the cloned source');
      t.diagnostic(`ingested ${ingested.files} files; first gap: ${card!.practiceId} (${card!.evidence[0]!.file}:${card!.evidence[0]!.line})`);
      assert.equal((await sandboxes.exec(project, 'ls /tmp/src 2>&1')).exitCode !== 0, true, 'nothing from the foreign repository is in the project sandbox');
    });
  } finally {
    await sandboxes.stopQaBrowser().catch(() => undefined);
    await sandboxes.destroy(project, { deleteWorkspace: true }).catch(() => undefined);
    await daemon.stop().catch(() => undefined);
    await upstream.close();
    home.cleanup();
  }
});

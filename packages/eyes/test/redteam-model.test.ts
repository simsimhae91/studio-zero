import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const build = fileURLToPath(new URL('../../../plugin/bin/sz-codex-build', import.meta.url));

// The real runner spawns this executable. Capture the model passed to codex exec, after both the workflow
// and the Codex adapter have chosen it. Each labelled worker gets the response for its stage.
const codex = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'sandbox') {
  const cmd = args.slice(args.indexOf('--') + 1);
  process.exit(require('node:child_process').spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit' }).status ?? 1);
}
if (args[0] !== 'exec') process.exit(2);
fs.readFileSync(0);
const bridge = args.find((arg) => arg.startsWith('mcp_servers.sz.args='));
const [, , , , label] = JSON.parse(bridge.slice('mcp_servers.sz.args='.length));
const model = args[args.indexOf('--model') + 1];
fs.appendFileSync(path.join(__dirname, 'calls'), JSON.stringify([label, model]) + '\\n');
const answers = JSON.parse(fs.readFileSync(path.join(__dirname, 'answers.json')));
if (!Object.hasOwn(answers, label)) throw new Error('unexpected worker ' + label);
const result = answers[label];
fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], result === null ? '' : JSON.stringify(result));
`;

test('native Codex routes both red-team calls to the selected model and keeps the other workers on the build model', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sz-redteam-model-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const project = join(dir, 'project');
  mkdirSync(join(project, '.sz/contracts'), { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: project }).status, 0);
  const claim = { id: 'count', says: 'The count is shown', kind: 'command', ref: 'node count.mjs' };
  const launch = 'node count.mjs';
  const milestone = { id: 'counter', title: 'The counter', builds: 'Count the entries', state: 'built', contractId: 'counter', launch, claims: [claim], notReal: [] };
  writeFileSync(join(project, '.sz/contracts/counter.json'), JSON.stringify({
    id: milestone.id, built: { launch }, claims: [{ id: claim.id, says: claim.says, status: 'proven', shownBy: { kind: claim.kind, ref: claim.ref } }],
  }));
  const fatal = 'The longest allowed entry cannot be counted';
  writeFileSync(join(dir, 'answers.json'), JSON.stringify({
    facts: null, // A successful worker that returned no text. Planning still runs.
    plan: { mode: 'continue', summary: 'Resume the counter', milestones: [milestone] },
    'redteam:plan': { checks: [], fatal: [] },
    'start:counter': { launch },
    'verify:counter': { proven: [claim.id], refuted: [], unchecked: [] },
    'redteam:counter': { checks: [{ what: fatal, why: 'The counter stops at that length', weight: 'fatal', where: 'counter' }], fatal: [fatal] },
  }));
  writeFileSync(join(dir, 'codex'), codex, { mode: 0o755 });

  const result = spawnSync(build, {
    cwd: project, encoding: 'utf8', env: { ...process.env, PATH: dir + ':' + process.env.PATH },
    input: JSON.stringify({ request: 'Resume the counter', asked: 'away', model: 'build-model', redteam: 'both', redteamModel: 'review-model' }),
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /the fact check did not answer/);
  assert.ok(JSON.parse(result.stdout).stopped.includes(fatal), result.stdout);
  assert.deepEqual(readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)), [
    ['facts', 'build-model'],
    ['plan', 'build-model'],
    ['redteam:plan', 'review-model'],
    ['start:counter', 'build-model'],
    ['verify:counter', 'build-model'],
    ['redteam:counter', 'review-model'],
  ]);
});

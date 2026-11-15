// A vendor CLI's round as the studio runs it: one that is stopped at the studio's own time limit is gone on
// from, not failed with whatever the CLI last wrote to stderr; and a login of the owner's that the CLI says it
// could not renew is told to the owner, once.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { lapsedLogins, roundContinues } from '../src/harness/engines/CliBridgeEngine.ts';
import { codingSystemPrompt } from '../src/harness/prompts.ts';
import type { RunOptions, RunResult } from '../src/util/run.ts';
import { sampleProject, testDaemon } from './helpers.ts';

const NOTION = '2026-11-15T03:48:38.950400Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server notion: OAuth refresh token was rejected: Server returned error response: invalid_grant: OAuth grant revoked\n';

test('a login the CLI could not renew is read off its stderr, by server', () => {
  assert.deepEqual(lapsedLogins(NOTION), [{ server: 'notion', why: 'OAuth 승인이 취소됨' }]);
  assert.deepEqual(lapsedLogins(`${NOTION}${NOTION}`), [{ server: 'notion', why: 'OAuth 승인이 취소됨' }], 'said once however often the CLI says it');
  assert.deepEqual(lapsedLogins('ERROR x: failed to refresh OAuth tokens for server linear: invalid_grant\nINFO ok\n'), [{ server: 'linear', why: '갱신 토큰이 거절됨' }]);
  assert.deepEqual(lapsedLogins('failed to refresh OAuth tokens for server drive: connection reset\n'), [{ server: 'drive', why: '토큰을 갱신하지 못함' }]);
  // A name that is not a plain word is not put into a command line.
  assert.deepEqual(lapsedLogins('failed to refresh OAuth tokens for server $(rm -rf ~): x\n'), []);
  assert.deepEqual(lapsedLogins('warning: nothing of the kind\n'), []);
});

async function rig(script: (n: number, opts: RunOptions) => Partial<RunResult> & { say?: string }) {
  const install = realpathSync(mkdtempSync(join(tmpdir(), 'sz-codex-')));
  const bin = join(install, 'codex');
  writeFileSync(bin, '#!/bin/sh\n');
  chmodSync(bin, 0o755);
  const rounds: { stdin: string }[] = [];
  const d = await testDaemon({ engines: { codex: { enabled: true, bin } } }, {}, (docker) => async (file, args, opts: RunOptions = {}) => {
    if (file !== bin) return docker(file, args, opts);
    const done = (out: Partial<RunResult>): RunResult => ({ exitCode: 0, stdout: '', stderr: '', truncated: false, timedOut: false, durationMs: 1, ...out });
    if (args[0] !== 'exec') return done({ stdout: args.includes('--version') ? 'codex-cli 0.153.4\n' : '{"models":[]}' });
    rounds.push({ stdin: String(opts.stdin ?? '') });
    const { say, ...out } = script(rounds.length, opts);
    if (say !== undefined) writeFileSync(args[args.indexOf('--output-last-message') + 1]!, say);
    return done(out);
  });
  await d.daemon.start();
  const { router, store, events } = d.daemon;
  const project = sampleProject();
  store.insertProject(project);
  const task = store.insertTask({ id: 'tsk_long', projectId: project.id, kind: 'build', prompt: 'x', origin: 'desktop', budgetTokens: 5_000_000, branch: null, enginePref: 'codex', createdAt: 1 });
  const route = await router.route('build', { engine: 'codex' });
  const session = await route.engine.open({ project, task, route: route.candidate, system: codingSystemPrompt(project.template), signal: new AbortController().signal, onWaiting: () => undefined });
  const notices = (): { message: string; attention?: boolean }[] => events.history({ projectId: project.id }, 0, 500).flatMap((e) => (e.body.type === 'notice' ? [{ message: e.body.message, ...(e.body.attention ? { attention: true } : {}) }] : []));
  return { d, session, rounds, notices, cleanup: async () => { await session.close(); await d.cleanup(); } };
}

const TURN = '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":200,"output_tokens":90}}\n';
const stoppedAtTheLimit = { exitCode: 128, timedOut: true, stderr: NOTION };

test('a round stopped at the time limit is gone on from, and the lapsed login it mentioned is told once and is not the reason', async () => {
  const r = await rig((n) => (n === 1 ? stoppedAtTheLimit : { stdout: TURN, stderr: NOTION, say: 'MVP를 끝까지 지었습니다.' }));
  try {
    assert.deepEqual(await r.session.send('Build the MVP as the design documents say.'), { finalText: 'MVP를 끝까지 지었습니다.', stopped: 'completed' });
    assert.equal(r.rounds.length, 2);
    assert.ok(!r.rounds[0]!.stdin.includes('stopped by the studio'));
    assert.ok(r.rounds[1]!.stdin.includes(roundContinues(60)), 'told it was stopped and that its work is there');
    assert.ok(r.rounds[1]!.stdin.includes('Build the MVP as the design documents say.'), 'and what it was asked, again');
    const said = r.notices();
    assert.equal(said.filter((n) => /60분 제한에 닿아 멈췄습니다.*이어서 진행합니다 \(1\/2\)/s.test(n.message)).length, 1);
    const logins = said.filter((n) => n.attention);
    assert.equal(logins.length, 1, 'the CLI said it twice; the owner hears it once');
    assert.match(logins[0]!.message, /"notion"의 로그인이 만료됐습니다 \(OAuth 승인이 취소됨\)\. 스튜디오의 작업에는 지장이 없습니다\..*mcp login notion$/s);
    // The next round is an ordinary one.
    assert.equal((await r.session.send('Now the tests.')).stopped, 'completed');
    assert.ok(r.rounds[2]!.stdin.includes('Your previous round ended with:\nMVP를 끝까지 지었습니다.'));
    assert.equal(r.notices().filter((n) => n.attention).length, 1);
  } finally {
    await r.cleanup();
  }
});

test('a round stopped at the limit time after time fails as that, not as what the CLI wrote to stderr', async () => {
  const r = await rig(() => stoppedAtTheLimit);
  try {
    await assert.rejects(r.session.send('Build everything.'), (err: Error) => {
      assert.match(err.message, /codex was stopped 3 times running at the studio's limit of 60 minutes for one round/);
      assert.ok(!/notion|OAuth/i.test(err.message), err.message);
      return true;
    });
    assert.equal(r.rounds.length, 3);
  } finally {
    await r.cleanup();
  }
});

test('a CLI that exits on its own with an error still fails with what it said', async () => {
  const r = await rig(() => ({ exitCode: 2, stderr: 'error: unexpected argument\n' }));
  try {
    await assert.rejects(r.session.send('Build it.'), /codex exited 2: error: unexpected argument/);
    assert.equal(r.rounds.length, 1);
  } finally {
    await r.cleanup();
  }
});

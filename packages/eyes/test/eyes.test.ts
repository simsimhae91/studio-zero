// The parts of the eyes that need no browser and no simulator: a contract and what it still owes, the page the
// owner reads, and the copy of a flow that cannot write outside the folder it was given.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addToBacklog, doneInBacklog, leftBy, openBacklog } from '../src/backlog.ts';
import { freePort } from '../src/port.ts';
import { Contract, openContracts, owed, readContract, renderContract, writeContract, CONTRACTS_DIR } from '../src/contract.ts';
import { createServer } from 'node:http';
import { addSaid, newRound, noteSaid, readRound, renderRound, roundPage } from '../src/feedback.ts';
import { reviewWeb } from '../src/review.ts';
import { SandboxError, stoppedBySandbox, walkWeb } from '../src/web.ts';
import { brokenDuring, keptFor, recordShown, stampClosed, standing } from '../src/standing.ts';
import { evidencePage } from '../src/evidence.ts';
import { lookAt, quarantineFlow } from '../src/ios.ts';
import { lockPathOf, withFileLock, writeFileAtomic } from '../src/lock.ts';

const contract = (): Contract =>
  Contract.parse({
    id: 'tour-works',
    request: '탭 다섯 개를 둘러볼 수 있다',
    lane: 'M',
    targets: ['ios'],
    claims: [
      { id: 'add', says: '링크를 붙이면 지켜보기에 담긴다', shownBy: { kind: 'flow', ref: 'app/e2e/tour-tabs.yaml' } },
      { id: 'fun', says: '담는 순간이 기분 좋다', shownBy: { kind: 'owner', ref: '직접 눌러 본다' } },
    ],
    notDoing: ['결제'],
    createdAt: '2026-11-15T00:00:00.000Z',
  });

test('a contract owes every claim that is not shown, and nothing is built on one that can still move', () => {
  const c = contract();
  assert.deepEqual(owed(c).length, 3, 'not frozen, and two claims unshown');
  c.frozenAt = '2026-11-15T01:00:00.000Z';
  assert.match(owed(c).join('\n'), /add: not shown yet \(flow: app\/e2e\/tour-tabs\.yaml\)/);
  c.claims[0]!.status = 'proven';
  c.claims[1]!.status = 'unchecked';
  assert.deepEqual(owed(c), [], 'what could not be checked is said, and does not hold the work');
  c.claims[0]!.status = 'refuted';
  c.claims[0]!.note = '담기 버튼이 눌리지 않는다';
  assert.match(owed(c)[0]!, /shown to be false.*담기 버튼이 눌리지 않는다/);
  // A claim's id is a plain word and a contract has at least one claim.
  assert.throws(() => Contract.parse({ ...c, claims: [] }));
  assert.throws(() => Contract.parse({ ...c, claims: [{ ...c.claims[0], id: 'has space' }] }));
});

test('open contracts are found in the project, and a closed one is not among them', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-project-'));
  try {
    assert.deepEqual(openContracts(project), []);
    const open = contract();
    writeContract(join(project, CONTRACTS_DIR, 'tour-works.json'), open);
    writeContract(join(project, CONTRACTS_DIR, 'old-one.json'), { ...open, id: 'old-one', closedAt: '2026-11-14T00:00:00.000Z' });
    writeFileSync(join(project, CONTRACTS_DIR, 'broken.json'), '{ not json');
    assert.deepEqual(openContracts(project).map((c) => c.contract.id), ['tour-works']);
    const read = renderContract(open);
    assert.match(read, /# 계약 tour-works \(레인 M\)/);
    assert.match(read, /\[아직\] \*\*add\*\* 링크를 붙이면 지켜보기에 담긴다/);
    assert.match(read, /## 하지 않는 것\n\n- 결제/);
    assert.match(read, /아직 얼리지 않았습니다/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('the evidence page says what was shown, shows the picture inside itself, and lists what is left', () => {
  const folder = mkdtempSync(join(tmpdir(), 'eyes-evidence-'));
  try {
    mkdirSync(join(folder, 'ios'), { recursive: true });
    // The smallest PNG there is.
    writeFileSync(join(folder, 'ios', 'home.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
    const c = contract();
    c.claims[0] = { ...c.claims[0]!, status: 'proven', evidence: ['ios/home.png', 'ios/missing.png'], note: 'tour-tabs.yaml 44단계 통과 <1분 47초>' };
    c.claims[1]!.status = 'unchecked';
    const page = evidencePage(c, folder, { took: '1분 47초' });
    assert.match(page, /<title>증거 tour-works<\/title>/);
    assert.match(page, /보인 것은 전부 참이고, 확인하지 못한 것이 있습니다/);
    assert.match(page, /src="data:image\/png;base64,iVBOR/);
    assert.match(page, /<p class="file">ios\/missing\.png<\/p>/, 'a file that is not there is named, not drawn');
    assert.ok(page.includes('44단계 통과 &lt;1분 47초&gt;'), 'what a note says is text');
    assert.match(page, /<h2>남은 것<\/h2><ul><li>확인 못 함: 담는 순간이 기분 좋다/);
    assert.ok(!/[–—]/.test(page));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('a flow is run from a copy in which nothing it writes can land outside the folder it was given', () => {
  const root = mkdtempSync(join(tmpdir(), 'eyes-flows-'));
  try {
    const e2e = join(root, 'project', 'e2e');
    mkdirSync(join(e2e, 'sub'), { recursive: true });
    writeFileSync(join(e2e, 'tour.yaml'), 'appId: com.example.app\n---\n- launchApp\n- runFlow: tap.yaml\n- takeScreenshot: /Users/someone/project/.state/shots/tour-01-home\n- takeScreenshot: "/Users/someone/project/.state/shots/tour 02"\n- takeScreenshot: relative-name\n- startRecording: /Users/someone/project/rec\n- tapOn:\n    text: "/not/a/path/to/write"\n');
    writeFileSync(join(e2e, 'tap.yaml'), 'appId: com.example.app\n---\n- tapOn:\n    id: ${ID}\n');
    writeFileSync(join(e2e, 'sub', 'deep.yml'), '- takeScreenshot:\n    path: /abs/elsewhere/deep\n');
    writeFileSync(join(e2e, 'run-ios.sh'), '#!/bin/sh\nrm -rf /\n');
    const out = join(root, 'out');
    const copy = quarantineFlow(join(e2e, 'tour.yaml'), out);
    assert.equal(copy, join(out, 'flows', 'tour.yaml'));
    const text = readFileSync(copy, 'utf8');
    assert.ok(text.includes(`- takeScreenshot: ${join(out, 'shots', 'tour-01-home')}\n`));
    assert.ok(text.includes(`- takeScreenshot: "${join(out, 'shots', 'tour 02')}"\n`));
    assert.ok(text.includes('- takeScreenshot: relative-name\n'), 'a relative name already lands beside the copy');
    assert.ok(text.includes(`- startRecording: ${join(out, 'shots', 'rec')}\n`));
    assert.ok(text.includes('text: "/not/a/path/to/write"'), 'what a step looks for is not a place it writes');
    assert.ok(!text.includes('/Users/someone'));
    assert.equal(readFileSync(join(out, 'flows', 'tap.yaml'), 'utf8').includes('${ID}'), true, 'the flows it calls come along');
    assert.ok(readFileSync(join(out, 'flows', 'sub', 'deep.yml'), 'utf8').includes(`path: ${join(out, 'shots', 'deep')}`));
    assert.throws(() => readFileSync(join(out, 'flows', 'run-ios.sh')), 'scripts beside the flows are not copied');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a flow whose output folder lies inside its own folder is not copied into itself, run after run', () => {
  // 2026-11-21: a builder kept its flows in .cache/m and gave --out .cache/m/out-<name>. Each run copied every
  // earlier run's copy into the new one, the copies doubled, and 18GB later the disk was full: the container
  // runtime stopped, and with it the owner's own containers.
  const root = mkdtempSync(join(tmpdir(), 'eyes-flows-'));
  try {
    const flows = join(root, 'm');
    mkdirSync(flows, { recursive: true });
    writeFileSync(join(flows, 'ping.yaml'), 'appId: com.example.app\n---\n- launchApp\n');
    writeFileSync(join(flows, 'tap.yaml'), 'appId: com.example.app\n---\n- tapOn: "열기"\n');
    const filesUnder = (dir: string): string[] => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && !entry.name.startsWith('.')).map((entry) => relative(dir, join(entry.parentPath, entry.name))).sort();
    for (const name of ['out-ping', 'out-ping2', 'out-tap', 'out-tap2', 'out-ping3']) {
      const out = join(flows, name);
      quarantineFlow(join(flows, name.includes('tap') ? 'tap.yaml' : 'ping.yaml'), out);
      assert.deepEqual(filesUnder(join(out, 'flows')), ['ping.yaml', 'tap.yaml'], `${name} holds the two flows and no copy of a run's output`);
    }
    // The same when the output folder is the flow's own folder's child named like the copy itself.
    const nested = join(flows, 'flows');
    quarantineFlow(join(flows, 'ping.yaml'), flows);
    assert.deepEqual(filesUnder(nested), ['ping.yaml', 'tap.yaml']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ a product that lives

const proven = (id: string, files: string[], claims: { id: string; kind: 'flow' | 'test' | 'look' | 'owner'; ref: string; status?: string }[]): Contract =>
  Contract.parse({
    id,
    request: `${id}의 요청`,
    lane: 'M',
    claims: claims.map((c) => ({ id: c.id, says: `${c.id}가 참이다`, shownBy: { kind: c.kind, ref: c.ref }, status: c.status ?? 'proven' })),
    frozen: files,
    frozenAt: '2026-11-15T01:00:00.000Z',
    createdAt: `2026-11-15T00:00:00.000Z`,
    closedAt: '2026-11-15T02:00:00.000Z',
  });

test('what earlier work proved stands, a change to its check is seen, and only an agreed contract replaces it', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-standing-'));
  try {
    mkdirSync(join(project, 'flows'), { recursive: true });
    writeFileSync(join(project, 'flows/split.sh'), 'curl -s localhost | grep 40,000\n');
    const first = proven('m1-split', ['flows/split.sh'], [
      { id: 'split', kind: 'flow', ref: 'flows/split.sh' },
      { id: 'phone', kind: 'look', ref: '모임 화면, 지출 2건' },
      { id: 'feel', kind: 'owner', ref: '직접 본다', status: 'unchecked' },
    ]);
    writeContract(join(project, CONTRACTS_DIR, 'm1-split.json'), first);
    // Closed before stamps were kept: it stands, and whether its checks changed is not known.
    assert.deepEqual(standing(project).stands.map((s) => [s.key, s.changed]), [['m1-split/split', null], ['m1-split/phone', []]], 'a look is shown by no file');
    stampClosed(project, first, first.closedAt!);
    assert.deepEqual(standing(project).stands.map((s) => [s.key, s.last?.status, s.changed]), [['m1-split/split', 'holds', []], ['m1-split/phone', 'holds', []]]);

    // Someone bends the old check: it is seen, whoever did it and however.
    writeFileSync(join(project, 'flows/split.sh'), 'true\n');
    assert.deepEqual(standing(project).stands[0]!.changed, ['flows/split.sh']);

    // Later work, while open, finds an old promise broken: that is owed by the work, and said on its page.
    const next = Contract.parse({ ...proven('m2-shares', [], [{ id: 'shares', kind: 'test', ref: 'test/shares.test.mjs', status: 'unproven' }]), createdAt: '2026-11-16T00:00:00.000Z', closedAt: null, frozenAt: null });
    writeContract(join(project, CONTRACTS_DIR, 'm2-shares.json'), next);
    recordShown(project, 'm1-split/split', { status: 'broken', note: '40,000이 아니라 30,000이 나온다', during: 'm2-shares', at: '2026-11-16T03:00:00.000Z' });
    assert.deepEqual(brokenDuring(project, 'm2-shares').map((s) => s.key), ['m1-split/split']);
    assert.deepEqual(standing(project).stands[0]!.changed, ['flows/split.sh'], 'a broken look keeps the stamp of when it last held');
    const page = evidencePage(next, project, { kept: keptFor(project, next) });
    assert.match(page, /전부터 지키던 것이 깨졌습니다/);
    assert.match(page, /40,000이 아니라 30,000이 나온다/);
    assert.match(page, /바뀐 검사 파일: <code>flows\/split\.sh<\/code>/);

    // Shown to hold again: stamped with the files as they now are.
    recordShown(project, 'm1-split/split', { status: 'holds', note: '고친 뒤 다시 돌려 40,000', during: 'm2-shares', at: '2026-11-16T04:00:00.000Z' });
    assert.deepEqual(standing(project).stands[0]!.changed, []);
    assert.deepEqual(keptFor(project, next), { total: 2, holds: 1, unchecked: 0, notLooked: 1, broken: [], changed: [], retired: [] });

    // A draft that says it replaces a claim replaces nothing until it is agreed.
    const replacing = { ...next, supersedes: [{ contract: 'm1-split', claim: 'phone', why: '주인이 모임 화면을 탭 둘로 나누자고 했다', at: null }] };
    writeContract(join(project, CONTRACTS_DIR, 'm2-shares.json'), replacing);
    assert.equal(standing(project).stands.length, 2);
    writeContract(join(project, CONTRACTS_DIR, 'm2-shares.json'), { ...replacing, frozenAt: '2026-11-16T05:00:00.000Z' });
    assert.deepEqual(standing(project).stands.map((s) => s.key), ['m1-split/split']);
    assert.deepEqual(standing(project).retired.map((r) => [r.key, r.by]), [['m1-split/phone', 'm2-shares']]);
    assert.throws(() => recordShown(project, 'm1-split/phone', { status: 'holds', note: '다시 봤다', during: null, at: '2026-11-16T06:00:00.000Z' }), /no longer stands: contract m2-shares replaced it/);
    assert.match(evidencePage(replacing, project, { kept: keptFor(project, { ...replacing, frozenAt: 'x' }) }), /이 작업으로 물러난 약속.*탭 둘로 나누자고/s);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('what closing a contract leaves is written where the next work is picked from, once', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-backlog-'));
  try {
    const closed = { ...proven('m1-split', [], [{ id: 'split', kind: 'flow', ref: 'flows/split.sh' }, { id: 'feel', kind: 'owner', ref: '직접 본다', status: 'unchecked' }]), noticed: [{ text: '모임 이름이 20자면\n앱 바가 두 줄로 꺾인다', evidence: [] }] };
    assert.equal(addToBacklog(project, leftBy(closed)), 2);
    assert.equal(addToBacklog(project, leftBy(closed)), 0, 'the same words are not written twice');
    assert.deepEqual(openBacklog(project), ['모임 이름이 20자면 앱 바가 두 줄로 꺾인다 (계약 m1-split 검증 중 눈에 띔)', '주인이 볼 것: feel가 참이다 (계약 m1-split)']);
    // A short line is not mistaken for part of a longer one.
    assert.equal(addToBacklog(project, [{ text: '모임 이름이 20자면', from: '돌봄' }]), 1);
    assert.equal(openBacklog(project).length, 3);
    writeFileSync(join(project, '.sz/backlog.md'), readFileSync(join(project, '.sz/backlog.md'), 'utf8').replace('- [ ] 모임 이름이 20자면 (돌봄)\n', ''));
    // The owner ticks one by hand: it is no longer open, and their own line is kept as they wrote it.
    const file = join(project, '.sz/backlog.md');
    writeFileSync(file, `${readFileSync(file, 'utf8').replace('- [ ] 모임 이름이', '- [x] 모임 이름이')}- [ ] 카톡으로 바로 공유\n`);
    assert.deepEqual(openBacklog(project), ['주인이 볼 것: feel가 참이다 (계약 m1-split)', '카톡으로 바로 공유']);
    // Seen again after it was ticked: written again.
    assert.equal(addToBacklog(project, leftBy(closed)), 1);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

const HERE = fileURLToPath(new URL('.', import.meta.url));
const eyes = (project: string, ...args: string[]): { code: number | null; text: string } => {
  const run = spawnSync(process.execPath, [join(HERE, '../src/cli.ts'), ...args, '--dir', project], { encoding: 'utf8' });
  return { code: run.status, text: `${run.stdout}${run.stderr}` };
};
const guard = (project: string, file: string, agent?: string): { code: number | null; text: string } => {
  const run = spawnSync(process.execPath, [join(HERE, '../../../plugin/hooks/guard-frozen.mjs')], { encoding: 'utf8', input: JSON.stringify({ cwd: project, tool_input: { file_path: join(project, file) }, ...(agent ? { agent_type: agent } : {}) }) });
  return { code: run.status, text: run.stderr };
};

test('a frozen check may be corrected by whoever was started as the arbiter, under whatever name, and by nobody else', () => {
  // (2026-11-26: the arbiter was started as the teammate `arbiter-1`. The guard looked at the one field
  // `agent_type`, which held the name, refused three edits, and the correction was applied by a second agent 8.9
  // minutes later. What an agent was started as is in the record the harness keeps beside its transcript.)
  const root = mkdtempSync(join(tmpdir(), 'eyes-guard-'));
  const project = join(root, 'product');
  const session = join(root, 'projects', '-product', 'aaaa1111');
  try {
    mkdirSync(join(project, 'flows'), { recursive: true });
    mkdirSync(join(session, 'subagents'), { recursive: true });
    writeFileSync(join(project, 'flows/split.sh'), 'true\n');
    assert.equal(eyes(project, 'contract', 'new', 'm1-split', '--lane', 'M', '--request', '나눠 낸다', '--claim', 'split|셋이 12만원이면 4만원씩|flow:flows/split.sh').code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'm1-split', '--frozen', 'flows/split.sh').code, 0);
    const meta = (id: string, body: Record<string, unknown>) => writeFileSync(join(session, 'subagents', `agent-${id}.meta.json`), JSON.stringify(body));
    // As the harness wrote them on 2026-11-26: a teammate started as sz:arbiter, and one that was only named so.
    meta('aarbiter-1-e26127', { agentType: 'arbiter-1', name: 'arbiter-1', taskKind: 'in_process_teammate', customAgentType: 'sz:arbiter', spawnedAgentType: 'sz:arbiter' });
    meta('aarbiter-9-a6a806', { agentType: 'arbiter-9', name: 'arbiter-9', taskKind: 'in_process_teammate', spawnedAgentType: 'general-purpose' });
    meta('averify-1-443e6a', { agentType: 'verify-1', name: 'verify-1', taskKind: 'in_process_teammate', customAgentType: 'sz:verifier', spawnedAgentType: 'sz:verifier' });
    const at = (who: Record<string, string>): { code: number | null; text: string } => {
      const ran = spawnSync(process.execPath, [join(HERE, '../../../plugin/hooks/guard-frozen.mjs')], { encoding: 'utf8', input: JSON.stringify({ cwd: project, transcript_path: `${session}.jsonl`, tool_input: { file_path: join(project, 'flows/split.sh') }, ...who }) });
      return { code: ran.status, text: ran.stderr };
    };
    assert.equal(at({}).code, 2, 'open and frozen: not the session\'s own to change');
    assert.equal(at({ agent_id: 'a18eb936', agent_type: 'sz:verifier' }).code, 2);
    // Started through the Agent tool, named or not: the hook is handed its type (seen in a real session, 2026-11-26).
    assert.equal(at({ agent_id: 'a18eb936', agent_type: 'sz:arbiter' }).code, 0);
    // A teammate: the hook is handed its name, and the record beside the transcript says what it was started as.
    assert.equal(at({ agent_id: 'aarbiter-1-e26127', agent_type: 'arbiter-1' }).code, 0, 'found by its id');
    assert.equal(at({ agent_type: 'arbiter-1' }).code, 0, 'found by its name when no id is handed');
    assert.equal(at({ agent_id: 'aarbiter-1-e26127', agent_type: 'arbiter-1', transcript_path: join(session, 'subagents', 'agent-aarbiter-1-e26127.jsonl') }).code, 0, 'handed its own transcript');
    assert.equal(at({ agent_type: 'arbiter-1', custom_agent_type: 'sz:arbiter', transcript_path: '/nowhere/x.jsonl' }).code, 0, 'or handed the type outright, however the field is spelled');
    // A name is not a type: an agent only called arbiter has none of the arbiter's rules, and is told what to do.
    const named = at({ agent_id: 'aarbiter-9-a6a806', agent_type: 'arbiter-9' });
    assert.equal(named.code, 2);
    assert.match(named.text, /If you were asked to rule on this check: you were not started as the sz:arbiter agent/);
    assert.equal(at({ agent_type: 'arbiter-7' }).code, 2, 'no record of it at all');
    assert.equal(at({ agent_id: 'averify-1-443e6a', agent_type: 'verify-1' }).code, 2);
    assert.equal(at({ agent_id: '../../../../etc/x', agent_type: 'arbiter-1', transcript_path: '/nowhere/x.jsonl' }).code, 2, 'an id is not a path');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a corrected check is committed with the contract that records it, and nothing else goes along', () => {
  // (2026-11-26: a correction was recorded and left in the working folder; whoever verified worked from a copy of
  // what was committed, and three verifiers copied the flows into their copies by hand, nineteen times.)
  const project = mkdtempSync(join(tmpdir(), 'eyes-amend-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  const git = (...args: string[]): string => {
    const ran = spawnSync('git', args, { cwd: project, encoding: 'utf8', env });
    assert.equal(ran.status, 0, `git ${args.join(' ')}: ${ran.stderr}`);
    return ran.stdout.trim();
  };
  const amend = (...more: string[]): { code: number | null; text: string } => {
    const ran = spawnSync(process.execPath, [join(HERE, '../src/cli.ts'), 'contract', 'amend', 'm1-split', ...more, '--dir', project], { encoding: 'utf8', env });
    return { code: ran.status, text: `${ran.stdout}${ran.stderr}` };
  };
  try {
    git('init', '-q', '-b', 'main');
    mkdirSync(join(project, 'flows'), { recursive: true });
    writeFileSync(join(project, 'flows/split.sh'), 'grep 40,000\n');
    writeFileSync(join(project, 'flows/late.sh'), 'true\n');
    writeFileSync(join(project, 'kept.txt'), 'kept\n');
    writeFileSync(join(project, 'staged.txt'), 'old\n');
    writeFileSync(join(project, '.gitignore'), 'private/\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'first');
    mkdirSync(join(project, 'private'), { recursive: true });
    writeFileSync(join(project, 'private/own.sh'), 'true\n');
    assert.equal(eyes(project, 'contract', 'new', 'm1-split', '--lane', 'M', '--request', '나눠 낸다', '--claim', 'split|셋이 12만원이면 4만원씩|flow:flows/split.sh').code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'm1-split', '--frozen', 'flows/split.sh', '--frozen', 'flows/late.sh', '--frozen', 'private/own.sh').code, 0);
    git('add', '-A');
    git('commit', '-q', '-m', 'freeze');
    writeFileSync(join(project, 'flows/split.sh'), "grep '40,000'\n");
    writeFileSync(join(project, 'kept.txt'), 'being edited, not committed\n');
    writeFileSync(join(project, 'staged.txt'), 'staged by someone, for a commit of their own\n');
    git('add', 'staged.txt');
    const amended = amend('--file', 'flows/split.sh', '--why', '쉼표가 든 금액을 따옴표로 묶었다');
    assert.equal(amended.code, 0, amended.text);
    assert.match(amended.text, /amended: flows\/split\.sh\. committed [0-9a-f]{7,} \(flows\/split\.sh, \.sz\/contracts\/m1-split\.json\)/);
    assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean).sort(), ['.sz/contracts/m1-split.json', 'flows/split.sh']);
    assert.match(git('status', '--porcelain'), /^ M kept\.txt$/m, 'what else was being edited is not committed along');
    assert.match(git('status', '--porcelain'), /^M  staged\.txt$/m, 'nor what someone had staged, which stays staged');
    assert.match(readContract(join(project, '.sz/contracts/m1-split.json')).amendments[0]!.commit ?? '', /^[0-9a-f]{7,}$/);
    assert.match(eyes(project, 'contract', 'show', 'm1-split').text, /쉼표가 든 금액을 따옴표로 묶었다 \(커밋 [0-9a-f]{7,}\)/);
    // Recorded and not committed, on purpose: said, and the contract says which.
    writeFileSync(join(project, 'flows/late.sh'), 'sleep 1; true\n');
    const kept = amend('--file', 'flows/late.sh', '--why', '화면이 뜨기를 1초 기다린 뒤에 본다', '--no-commit');
    assert.equal(kept.code, 0, kept.text);
    assert.match(kept.text, /amended: flows\/late\.sh\. not committed \(--no-commit\)/);
    assert.equal(git('log', '--oneline').split('\n').length, 3, 'no commit was made');
    assert.match(eyes(project, 'contract', 'show', 'm1-split').text, /화면이 뜨기를 1초 기다린 뒤에 본다 \(커밋되지 않음\)/);
    // A check git keeps out of the repository is not forced in: said, and not a failure (a copy takes it from the folder).
    writeFileSync(join(project, 'private/own.sh'), 'true # corrected\n');
    const ignored = amend('--file', 'private/own.sh', '--why', '따옴표를 고쳤다 그뿐이다');
    assert.equal(ignored.code, 0, ignored.text);
    assert.match(ignored.text, /git keeps private\/own\.sh out \(it is ignored\): it is not committed/);
    assert.equal(git('ls-files', 'private').trim(), '');
    // A commit that cannot be made is not passed over: the record stays, and the command says so and ends 1.
    writeFileSync(join(project, 'flows/split.sh'), "grep -F '40,000'\n");
    writeFileSync(join(project, '.git/index.lock'), '');
    const stuck = amend('--file', 'flows/split.sh', '--why', '정규식이 아니라 글자 그대로 찾는다');
    rmSync(join(project, '.git/index.lock'));
    assert.equal(stuck.code, 1, stuck.text);
    assert.match(stuck.text, /the correction is recorded and is NOT committed/);
    assert.equal(readContract(join(project, '.sz/contracts/m1-split.json')).amendments.at(-1)!.commit, null);
    // An amendment recorded before commits were kept says nothing about one.
    const older = renderContract(Contract.parse({ ...readContract(join(project, '.sz/contracts/m1-split.json')), amendments: [{ file: 'flows/split.sh', why: '예전 기록이다 커밋 칸이 없다', at: '2026-11-20T00:00:00.000Z' }] }));
    assert.match(older, /예전 기록이다 커밋 칸이 없다$/m);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('a verdict remembers the commit the product was at when it was looked at', () => {
  // (2026-11-26: 21 looks after fixes each ran every claim of its verifier again, one claim's whole check command
  // three times, because nothing said what had changed since a claim was last shown.)
  const project = mkdtempSync(join(tmpdir(), 'eyes-commit-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  const git = (...args: string[]): string => `${spawnSync('git', args, { cwd: project, encoding: 'utf8', env }).stdout ?? ''}`.trim();
  const claimOf = (id: string) => readContract(join(project, '.sz/contracts/m1-seen.json')).claims.find((c) => c.id === id)!;
  try {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(project, 'a.txt'), 'a\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'first');
    const first = git('rev-parse', '--short', 'HEAD');
    assert.equal(eyes(project, 'contract', 'new', 'm1-seen', '--lane', 'M', '--request', '본다', '--claim', 'here|파일이 있다|command:true', '--claim', 'copy|사본에서 본다|command:true').code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'm1-seen').code, 0);
    writeFileSync(join(project, 'a.txt'), 'b\n');
    git('commit', '-q', '-am', 'a fix');
    const head = git('rev-parse', '--short', 'HEAD');
    assert.equal(eyes(project, 'contract', 'claim', 'm1-seen', 'here', '--status', 'proven', '--note', '돌려서 봤다').code, 0);
    assert.equal(claimOf('here').commit, head, 'the commit the project is at, unless told otherwise');
    // Shown on a copy made before the fix landed: the verdict is about that commit, and says so.
    assert.equal(eyes(project, 'contract', 'claim', 'm1-seen', 'copy', '--status', 'proven', '--note', '사본에서 돌려 봤다', '--at', first).code, 0);
    assert.equal(claimOf('copy').commit, first);
    assert.match(eyes(project, 'contract', 'claim', 'm1-seen', 'copy', '--status', 'proven', '--note', '사본에서 돌려 봤다', '--at', 'nope').text, /--at nope: no such commit/);
    assert.equal(claimOf('copy').commit, first, 'a verdict that was refused changes nothing');
    const shown = eyes(project, 'contract', 'show', 'm1-seen').text;
    assert.match(shown, new RegExp(`\\*\\*here\\*\\*[^\\n]*\\n[^\\n]*\\n[^\\n]*\\n  - 판정한 커밋: ${head}`));
    assert.match(shown, new RegExp(`판정한 커밋: ${first}`));
    // Outside a repository a verdict keeps no commit, and says so by having none.
    const lonely = mkdtempSync(join(tmpdir(), 'eyes-nocommit-'));
    try {
      assert.equal(eyes(lonely, 'contract', 'new', 'm1-seen', '--lane', 'M', '--request', '본다', '--claim', 'here|파일이 있다|command:true').code, 0);
      assert.equal(eyes(lonely, 'contract', 'freeze', 'm1-seen').code, 0);
      assert.equal(eyes(lonely, 'contract', 'claim', 'm1-seen', 'here', '--status', 'proven', '--note', '돌려서 봤다').code, 0);
      assert.equal(readContract(join(lonely, '.sz/contracts/m1-seen.json')).claims[0]!.commit, null);
      assert.doesNotMatch(eyes(lonely, 'contract', 'show', 'm1-seen').text, /판정한 커밋/);
    } finally {
      rmSync(lonely, { recursive: true, force: true });
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('the third look that shows a claim false says so, and a verdict recorded twice at one look is one', () => {
  // (2026-11-26: one claim was recorded false nineteen times over about ten looks, another seven times, by a
  // session that started every look itself; the workflow's stop at two fixes was never reached.)
  const project = mkdtempSync(join(tmpdir(), 'eyes-third-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
  const git = (...args: string[]): string => `${spawnSync('git', args, { cwd: project, encoding: 'utf8', env }).stdout ?? ''}`.trim();
  const fix = (n: number): void => {
    writeFileSync(join(project, 'a.txt'), `${n}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', `fix ${n}`);
  };
  const refute = (note: string) => eyes(project, 'contract', 'claim', 'm1-split', 'split', '--status', 'refuted', '--note', note);
  try {
    git('init', '-q', '-b', 'main');
    fix(0);
    assert.equal(eyes(project, 'contract', 'new', 'm1-split', '--lane', 'M', '--request', '나눠 낸다', '--claim', 'split|셋이 12만원이면 4만원씩|command:true').code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'm1-split').code, 0);
    assert.match(refute('80,000원이 나온다').text, /^split: refuted$/m, 'the first time is not counted aloud');
    assert.match(refute('80,000원이 나온다, 사진을 붙였다').text, /^split: refuted$/m, 'recorded again at the same look, with a better note: still once');
    assert.match(eyes(project, 'contract', 'show', 'm1-split').text, /  - 1번 반증됨/, 'the contract says it from the first: a later look does not carry a claim once shown false');
    fix(1);
    assert.match(refute('또 같은 자리').text, /^split: refuted \(2번 반증됨\)$/m);
    fix(2);
    const third = refute('이번에도 같은 자리');
    assert.match(third.text, /^split: refuted \(3번 반증됨\)$/m);
    assert.match(third.text, /shown false three times\. Say so in what you return/);
    assert.match(third.text, /mend it again, have its own words ruled wrong where that is what they are \(sz:arbiter, sz-eyes contract dispute\), or close it as it is on their own words \(sz-eyes contract close m1-split --accepted "<their words>"\)/);
    assert.doesNotMatch(third.text, /the rest goes on/);
    fix(3);
    assert.doesNotMatch(refute('넷째').text, /three times/, 'said once, at the third');
    assert.equal(readContract(join(project, '.sz/contracts/m1-split.json')).claims[0]!.refutedCount, 4);
    // Proven at last: the count stays, so that a later look knows this claim was shown false before.
    assert.equal(eyes(project, 'contract', 'claim', 'm1-split', 'split', '--status', 'proven', '--note', '4만원씩 나온다').code, 0);
    assert.match(eyes(project, 'contract', 'show', 'm1-split').text, /\[증명됨\] \*\*split\*\*[\s\S]*4번 반증됨/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('from the command line: closing makes claims stand, later work cannot close over a broken one, and an old check is not bent', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-cli-'));
  try {
    mkdirSync(join(project, 'flows'), { recursive: true });
    writeFileSync(join(project, 'flows/split.sh'), 'grep 40,000\n');
    writeFileSync(join(project, 'flows/all.sh'), 'sh flows/split.sh\n');
    assert.equal(eyes(project, 'contract', 'new', 'm1-split', '--lane', 'M', '--request', '나눠 낸다', '--claim', 'split|셋이 12만원이면 4만원씩|flow:flows/split.sh', '--claim', 'all|전부 통과|command:sh flows/all.sh', '--claim', 'feel|숫자가 크게 느껴진다|owner:폰 사진').code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'm1-split', '--frozen', 'flows/split.sh', '--frozen', 'flows/all.sh').code, 0);
    assert.equal(guard(project, 'flows/split.sh').code, 2, 'open and frozen: not the builder’s');
    assert.equal(guard(project, 'flows/split.sh', 'sz:arbiter').code, 0);
    // The guard stops an edit; a command can still change the file. That is seen, and owed, until the arbiter
    // has looked: its correction is what the contract is proven against from then on.
    writeFileSync(join(project, 'flows/split.sh'), 'true\n');
    assert.match(eyes(project, 'contract', 'status').text, /flows\/split\.sh: changed since the contract was frozen/);
    assert.match(eyes(project, 'contract', 'show', 'm1-split').text, /얼린 뒤 바뀐 파일.*flows\/split\.sh/);
    writeFileSync(join(project, 'flows/split.sh'), "grep '40,000'\n");
    assert.equal(eyes(project, 'contract', 'amend', 'm1-split', '--file', 'flows/split.sh', '--why', '쉼표가 든 금액을 따옴표로 묶었다').code, 0);
    assert.doesNotMatch(eyes(project, 'contract', 'status').text, /changed since the contract was frozen/);
    assert.match(eyes(project, 'contract', 'freeze', 'm1-split').text, /was frozen at/);
    for (const claim of ['split', 'all']) assert.equal(eyes(project, 'contract', 'claim', 'm1-split', claim, '--status', 'proven', '--note', '돌려서 통과를 봤다').code, 0);
    assert.equal(eyes(project, 'contract', 'claim', 'm1-split', 'feel', '--status', 'unchecked', '--note', '주인이 볼 것').code, 0);
    assert.equal(eyes(project, 'contract', 'notice', 'm1-split', '긴 이름이 잘린다').code, 0);
    const closed = eyes(project, 'contract', 'close', 'm1-split');
    assert.match(closed.text, /closed: m1-split \(2 line\(s\) added to \.sz\/backlog\.md\)/);
    assert.match(eyes(project, 'backlog').text, /2 open[\s\S]*1\. 긴 이름이 잘린다[\s\S]*2\. 주인이 볼 것: 숫자가 크게 느껴진다/);
    assert.match(eyes(project, 'standing').text, /2 claim\(s\) stand[\s\S]*m1-split\/split \[holds/);
    assert.match(eyes(project, 'standing', '--summary').text, /^2 claim\(s\) proven by earlier work stand/);

    // After closing: the flow a claim was proven by stays locked, the list of checks later work adds to does not.
    const locked = guard(project, 'flows/split.sh');
    assert.equal(locked.code, 2);
    assert.match(locked.text, /is how m1-split\/split was proven, and that still stands/);
    assert.equal(guard(project, 'flows/all.sh').code, 0);
    assert.equal(guard(project, '.sz/contracts/m1-split.json').code, 2);
    assert.equal(guard(project, '.sz/standing.json').code, 2);
    assert.equal(guard(project, 'server.mjs').code, 0);

    // Later work replaces a promise by saying so, with a reason; a claim that does not stand cannot be named.
    assert.match(eyes(project, 'contract', 'new', 'm2-shares', '--request', '빠지는 사람', '--claim', 'shares|빠진 사람은 안 낸다|test:test/shares.test.mjs', '--supersedes', 'm1-split/nope|주인이 바꾸자고 했다').text, /is not a standing claim/);
    assert.equal(eyes(project, 'contract', 'new', 'm2-shares', '--request', '빠지는 사람', '--claim', 'shares|빠진 사람은 안 낸다|test:test/shares.test.mjs', '--supersedes', 'm1-split/split|이제 지출마다 낸 사람끼리만 나눈다').code, 0);
    assert.equal(guard(project, 'flows/split.sh').code, 0, 'the one writing the new contract rewrites the check of the claim it replaces');
    assert.match(eyes(project, 'contract', 'freeze', 'm2-shares', '--frozen', 'flows/nope.sh').text, /not there to freeze: flows\/nope\.sh/);
    // Whoever built it says so, with how it is started: from then on the owner can be shown the product while it
    // is still being verified. (2026-11-17: a first pass stood at 21:07 and was closed at 00:39; the only signal a
    // session had was the close.)
    assert.equal(eyes(project, 'contract', 'built').code, 1);
    assert.match(eyes(project, 'contract', 'built').text, /nothing is built and waiting to be closed/);
    assert.match(eyes(project, 'contract', 'built', 'm2-shares', '--launch', 'PORT=$(sz-eyes port) node server.mjs').text, /is not frozen yet/);

    // Words it does not know stop the freeze. (2026-11-18: a builder handed every --frozen in one string its shell
    // did not split, the contract was frozen with no file, and no correction to its checks could be recorded.)
    const unsplit = spawnSync(process.execPath, [join(HERE, '../src/cli.ts'), 'contract', 'freeze', 'm2-shares', '--frozen flows/split.sh --frozen flows/all.sh'], { encoding: 'utf8', cwd: project });
    assert.equal(unsplit.status, 1);
    assert.match(`${unsplit.stdout}${unsplit.stderr}`, /not understood: "--frozen flows\/split\.sh --frozen flows\/all\.sh"[\s\S]*each file is its own `--frozen <path>`/);
    assert.match(eyes(project, 'contract', 'freeze', 'm2-shares', 'flows/split.sh').text, /not understood: "flows\/split\.sh"/);
    // Neither froze it: the freeze below is its first.
    assert.equal(eyes(project, 'contract', 'freeze', 'm2-shares', '--frozen', 'flows/split.sh').code, 0);
    assert.match(eyes(project, 'contract', 'built', 'm2-shares').text, /--launch "<the command that starts it, and where it is seen>"/);
    const said = eyes(project, 'contract', 'built', 'm2-shares', '--launch', 'PORT=$(sz-eyes port) node server.mjs, seen at http://127.0.0.1:$PORT/');
    assert.equal(said.code, 0, said.text);
    assert.match(said.text, /built: m2-shares/);
    const waiting = eyes(project, 'contract', 'built');
    assert.equal(waiting.code, 0);
    assert.equal(waiting.text.trim(), 'm2-shares\tPORT=$(sz-eyes port) node server.mjs, seen at http://127.0.0.1:$PORT/');
    assert.match(eyes(project, 'contract', 'show', 'm2-shares').text, /지은 때: 20\d\d-[^\n]* · 띄우는 법: PORT=\$\(sz-eyes port\) node server\.mjs/);
    assert.equal(guard(project, 'flows/split.sh').code, 2, 'and from the freeze it is the new contract’s');
    assert.match(eyes(project, 'standing').text, /1 claim\(s\) stand[\s\S]*no longer standing[\s\S]*m1-split\/split[\s\S]*replaced by contract m2-shares/);

    // What stood and was broken by this work is owed by it: it does not close over that.
    assert.equal(eyes(project, 'contract', 'claim', 'm2-shares', 'shares', '--status', 'proven', '--note', '검사를 돌려 통과').code, 0);
    assert.equal(eyes(project, 'standing', 'record', 'm1-split/all', '--status', 'broken', '--during', 'm2-shares', '--note', 'flows/all.sh가 1로 끝난다').code, 0);
    assert.equal(eyes(project, 'standing').code, 1);
    assert.match(eyes(project, 'contract', 'status').text, /m1-split\/all: stood before this work and is broken now/);
    assert.match(eyes(project, 'contract', 'close', 'm2-shares').text, /is not closed yet:[\s\S]*m1-split\/all: stood before this work and is broken now/);
    assert.equal(eyes(project, 'standing', 'record', 'm1-split/all', '--status', 'holds', '--during', 'm2-shares', '--note', '고친 뒤 0으로 끝난다').code, 0);
    assert.equal(eyes(project, 'contract', 'close', 'm2-shares').code, 0);
    assert.equal(eyes(project, 'contract', 'built').code, 1, 'closed, it no longer waits');
    assert.ok(existsSync(join(project, '.sz/standing.json')));
    assert.match(readFileSync(eyes(project, 'evidence', 'm2-shares').text.trim(), 'utf8'), /전부터 지키던 것[\s\S]*이번에 다시 보임 1[\s\S]*이 작업으로 물러난 약속/);

    // The ways round the refusal are shut: a closed contract is not closed again (which would stamp a broken
    // claim as holding), and its verdicts are not rewritten (which would take a promise off the list).
    assert.match(eyes(project, 'contract', 'close', 'm1-split').text, /was closed at/);
    assert.match(eyes(project, 'contract', 'claim', 'm1-split', 'all', '--status', 'unchecked', '--note', '이제는 모르겠다').text, /is closed: its verdicts are the record/);
    // A promise retired after the freeze is said to be so, where the owner reads it.
    assert.equal(eyes(project, 'contract', 'new', 'm3-late', '--request', '뒤늦게', '--claim', 'x|무언가 참이다|look:화면').code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'm3-late').code, 0);
    assert.equal(eyes(project, 'contract', 'supersede', 'm3-late', 'm1-split/all', '--why', '주인이 전체 검사를 나누자고 했다').code, 0);
    assert.match(eyes(project, 'contract', 'show', 'm3-late').text, /m1-split\/all`: 주인이 전체 검사를 나누자고 했다 \(얼린 뒤에 적힘\)/);

    // A record that cannot be read (two branches each closed a contract) stops the work loudly instead of
    // letting everything look fine, and can be mended by hand.
    writeFileSync(join(project, '.sz/standing.json'), '<<<<<<< ours\n{}\n=======\n{}\n>>>>>>> theirs\n');
    const status = eyes(project, 'contract', 'status');
    assert.equal(status.code, 1);
    assert.match(status.text, /standing\.json cannot be read[\s\S]*merge conflict/);
    assert.equal(eyes(project, 'standing').code, 1);
    assert.match(eyes(project, 'standing', '--summary').text, /cannot be read/);
    assert.match(eyes(project, 'standing', 'record', 'm1-split/feel', '--status', 'holds', '--note', '다시 보았다 괜찮다').text, /cannot be read/);
    assert.equal(guard(project, '.sz/standing.json').code, 0, 'unreadable: it may be repaired');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ the owner says what they think

test('a round keeps what the owner said, what was made of it and what came of it, and what is put off is written down', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-round-'));
  try {
    const folder = newRound(project, '2026-11-15T09:00:00.000Z');
    assert.match(folder, /\.sz\/feedback\/2026-11-15-1$/);
    assert.match(newRound(project, '2026-11-15T10:00:00.000Z'), /2026-11-15-2$/);
    addSaid(folder, { said: '숫자가 더 커야 함', at: '2026-11-15T09:01:00.000Z' });
    addSaid(folder, { said: '카톡으로 바로 보내고 싶음', at: '2026-11-15T09:02:00.000Z' });
    noteSaid(project, folder, 1, { understood: '모임 화면 히어로의 총액이 화면에서 가장 큰 글자가 아니다(28px, 제목은 32px)', opinion: '맞다. 48px로 올리고 제목을 20px로 내린다', status: 'done', did: '히어로 총액 48px, 제목 20px' });
    noteSaid(project, folder, 2, { understood: '정산 글을 카카오톡 공유로 바로 보낸다', opinion: '카카오 키가 필요하다. 지금은 복사가 있으니 뒤로', status: 'later' });
    assert.throws(() => noteSaid(project, folder, 9, { status: 'done' }), /has no item 9/);
    mkdirSync(join(folder, '1'), { recursive: true });
    writeFileSync(join(folder, '1/after-phone.png'), 'png');
    writeFileSync(join(folder, '1/before-phone.png'), 'png');
    const page = roundPage(folder);
    assert.match(page, /말씀하신 2가지와 그 뒤/);
    assert.match(page, /“숫자가 더 커야 함”[\s\S]*이렇게 이해했습니다[\s\S]*제 의견[\s\S]*한 것/);
    assert.ok(page.indexOf('1/before-phone.png') < page.indexOf('1/after-phone.png'), 'before comes first');
    // Before and after of the same name sit side by side and are labelled; step pictures come after the settled
    // ones, and what is not shown is counted.
    for (const name of ['before-me-01-tap.png', 'after-me-01-tap.png', 'before-wide.png', 'after-wide.png', 'before-x-02-tap.png', 'after-x-02-tap.png', 'after-only.png', 'note.png', 'zz.png']) writeFileSync(join(folder, '1', name), 'png');
    const paired = roundPage(folder);
    assert.match(paired, /<div class="pair"><div class="side"><span class="mark">전<\/span>[\s\S]*?1\/before-phone\.png[\s\S]*?<span class="mark">후<\/span>[\s\S]*?1\/after-phone\.png/);
    assert.ok(paired.indexOf('1/before-wide.png') < paired.indexOf('1/before-x-02-tap.png'), 'settled screens before step pictures');
    assert.doesNotMatch(paired, /before-me-01-tap/, 'a fourth pair is not shown');
    assert.match(paired, /사진 3장 더/);
    assert.match(renderRound(readRound(folder), folder), /2\. \[later\] "카톡으로 바로 보내고 싶음"/);
    assert.deepEqual(openBacklog(project), ['정산 글을 카카오톡 공유로 바로 보낸다 (주인이 말함 2026-11-15-1: "카톡으로 바로 보내고 싶음")']);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('on the running product the owner points at what they mean and says it, and the product does not act on that press', async (t) => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-review-'));
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>모임</title><body><h1>동창회</h1><p id="total">120,000원</p><button id="pay" onclick="document.title='pressed'">돈 쓴 거 적기</button><input id="name" onfocus="window.focused=true"><script>window.keys=[];window.downs=0;addEventListener('keydown',(e)=>{window.keys.push(e.key);if(e.key===' ')e.preventDefault()});addEventListener('pointerdown',()=>window.downs++);</script></body>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const folder = newRound(project, '2026-11-15T09:00:00.000Z');
    const address = server.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/g/abc`;
    let titleWhilePointing = '';
    const round = await reviewWeb(url, folder, {
      headless: true,
      drive: async (page) => {
        const bar = page.locator('#sz-review');
        await bar.locator('.say').click();
        assert.equal(await page.evaluate(() => (window as unknown as { downs: number }).downs), 0, 'the product does not learn that the bar was pressed');
        await page.locator('#name').click();
        assert.equal(await page.evaluate(() => (window as unknown as { focused?: boolean }).focused ?? false), false, 'a field pointed at does not take the cursor');
        await bar.locator('.note .cancel').click();
        await bar.locator('.say').click();
        await page.locator('#pay').dblclick();
        titleWhilePointing = await page.title();
        await bar.locator('textarea').pressSequentially('버튼이 너무 작아요');
        assert.equal(await bar.locator('textarea').inputValue(), '버튼이 너무 작아요', 'a space typed in the note is not eaten by the product');
        assert.deepEqual(await page.evaluate(() => (window as unknown as { keys: string[] }).keys), [], 'and the product sees none of the keys');
        // A framework that renders the whole document takes out what it did not put there: the bar comes back.
        await page.evaluate(() => document.getElementById('sz-review')!.remove());
        await bar.locator('textarea').waitFor();
        await bar.locator('.save').click();
        await bar.locator('.count', { hasText: '1' }).waitFor();
        await bar.locator('.say').click();
        await bar.locator('.whole').click();
        await bar.locator('textarea').fill('전체적으로 허전함');
        await bar.locator('.save').click();
        await bar.locator('.count', { hasText: '2' }).waitFor();
        // Not pointing: the product is used as usual.
        await page.locator('#pay').click();
        assert.equal(await page.title(), 'pressed');
        await bar.locator('.done').click();
      },
    }).catch((err: unknown) => {
      if (/Chromium distribution 'chrome' is not found|Executable doesn't exist/.test(String(err))) return null;
      throw err;
    });
    if (round === null) return t.skip('no Chrome on this machine');
    assert.equal(titleWhilePointing, '모임', 'a press made while pointing is not the product’s');
    assert.deepEqual(round.items.map((item) => [item.n, item.said, item.about?.words ?? null, item.about?.role ?? null]), [[1, '버튼이 너무 작아요', '돈 쓴 거 적기', 'button'], [2, '전체적으로 허전함', null, null]]);
    assert.equal(round.items[0]!.about!.selector, '#pay');
    assert.match(round.items[0]!.url, /\/g\/abc$/);
    assert.ok(existsSync(join(folder, '1.png')) && existsSync(join(folder, '2.png')));
  } finally {
    server.close();
    rmSync(project, { recursive: true, force: true });
  }
});

test('a folder frozen for one flow does not lock what later work adds beside it, and a fingerprint never fails', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-folder-'));
  try {
    mkdirSync(join(project, 'e2e/node_modules/x'), { recursive: true });
    writeFileSync(join(project, 'e2e/login.spec.ts'), 'login');
    writeFileSync(join(project, 'e2e/node_modules/x/big.js'), 'not hashed');
    symlinkSync('/nowhere/at/all', join(project, 'e2e/dangling'));
    const first = proven('aaa-login', ['e2e/'], [{ id: 'login', kind: 'flow', ref: 'e2e/login.spec.ts' }]);
    const whole = proven('bbb-all', ['unit/'], [{ id: 'unit', kind: 'test', ref: 'node --test unit/' }]);
    writeContract(join(project, CONTRACTS_DIR, 'aaa-login.json'), first);
    writeContract(join(project, CONTRACTS_DIR, 'bbb-all.json'), whole);
    stampClosed(project, first, first.closedAt!);
    assert.deepEqual(standing(project).stands[0]!.changed, []);
    writeFileSync(join(project, 'e2e/node_modules/x/big.js'), 'changed, and nobody minds');
    assert.deepEqual(standing(project).stands[0]!.changed, []);
    writeFileSync(join(project, 'e2e/helpers.ts'), 'a helper later work added');
    assert.deepEqual(standing(project).stands[0]!.changed, ['e2e/'], 'watched: seen, not locked');
    assert.equal(guard(project, 'e2e/login.spec.ts').code, 2);
    assert.equal(guard(project, 'e2e/checkout.spec.ts').code, 0);
    assert.equal(guard(project, 'e2e/helpers.ts').code, 0);
    assert.equal(guard(project, 'unit/money.test.ts').code, 2, 'a claim that names the folder as a whole keeps all of it');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('a line of the backlog is ticked by its words, with what ended it', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-backlog-done-'));
  try {
    addToBacklog(project, [{ text: '서버가 실패를 남기지 않는다 [S]', from: '돌봄 2026-11-15' }, { text: '데이터 백업이 없다', from: '돌봄 2026-11-15' }]);
    assert.equal(doneInBacklog(project, '백업이  없다', 'm6-care 51763ad'), '데이터 백업이 없다 (돌봄 2026-11-15)');
    assert.match(readFileSync(join(project, '.sz/backlog.md'), 'utf8'), /^- \[x\] 데이터 백업이 없다 \(돌봄 2026-11-15\) — 끝남: m6-care 51763ad$/m);
    assert.deepEqual(openBacklog(project), ['서버가 실패를 남기지 않는다 [S] (돌봄 2026-11-15)']);
    assert.throws(() => doneInBacklog(project, '백업이 없다', 'again'), /no open line/, 'a ticked line is not ticked twice');
    addToBacklog(project, [{ text: '서버가 느리다', from: '' }]);
    assert.throws(() => doneInBacklog(project, '서버가', 'x'), /2 open lines[\s\S]*실패를 남기지[\s\S]*느리다/, 'words that fit two lines tick neither');
    assert.throws(() => doneInBacklog(project, '느리다', '  '), /what ended it/);
    assert.equal(openBacklog(project).length, 2);
    // From the command line, as the one closing a piece of work uses it.
    assert.match(eyes(project, 'backlog', 'done', '서버가 느리다', '--by', 'a1b2c3d').text, /ticked: 서버가 느리다/);
    assert.equal(eyes(project, 'backlog', 'done', '없는 줄', '--by', 'x').code, 1);
    assert.equal(openBacklog(project).length, 1);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

const others = (command: string): { code: number | null; text: string } => {
  const run = spawnSync(process.execPath, [join(HERE, '../../../plugin/hooks/guard-others.mjs')], { encoding: 'utf8', input: JSON.stringify({ cwd: tmpdir(), tool_name: 'Bash', tool_input: { command } }) });
  return { code: run.status, text: run.stderr };
};

test('a command ends only what this work started: never whatever holds a port, or everything of a name', () => {
  // What the first long run did: its own server could not take the port, and it ended the one that had it.
  const incident = 'T=$(mktemp -d) && P=8817 && PORT=$P node server.mjs >$T/log 2>&1 & sleep 1; curl -s http://127.0.0.1:$P/healthz\nkill %1 2>/dev/null; pkill -f "PORT=8817" ; lsof -ti tcp:$P | xargs kill 2>/dev/null; rm -rf $T';
  const refused = others(incident);
  assert.equal(refused.code, 2);
  assert.match(refused.text, /did not start/);
  assert.match(refused.text, /sz-eyes port/);
  for (const command of [
    'lsof -ti:3000 | xargs kill -9',
    'lsof -t -i tcp:8080 | xargs -r kill',
    'kill -9 $(lsof -ti :5173)',
    'kill "$(lsof -t -i:8081)"',
    'kill `lsof -ti:8081`',
    'PID=$(lsof -ti:3000); kill $PID',
    'lsof -i :3000 | awk \'NR>1 {print $2}\' | xargs kill',
    'pkill -f vite',
    'sudo killall node',
    'killall Simulator',
    'npx kill-port 3000',
    'fuser -k 3000/tcp',
    'docker stop $(docker ps -q)',
    'docker rm -f `docker ps -aq`',
    'docker ps -q | xargs docker kill',
    'docker system prune -af',
    'xcrun simctl shutdown all',
    'xcrun simctl erase all',
    'bash -c "lsof -ti:3000 | xargs kill"',
    'sh <<EOF\npkill node\nEOF',
  ]) assert.equal(others(command).code, 2, command);
  for (const command of [
    'PORT=$(sz-eyes port) node server.mjs & pid=$!; sleep 1; curl -s localhost:$PORT/healthz; kill $pid',
    'kill %1; kill 4242; kill -TERM "$pid"',
    'lsof -nP -iTCP:8817 -sTCP:LISTEN',
    'lsof -ti:3000',
    'docker stop moim-db && docker rm moim-db',
    'docker compose down',
    'xcrun simctl shutdown 5F0C7A1E-0000-0000-0000-000000000000',
    'git commit -m "$(cat <<\'EOF\'\nEnd the server by its pid, not with pkill or lsof | xargs kill\nEOF\n)"',
    'git commit -m \'no more killall node\'',
    'echo "pkill 대신 PID로 끈다" >> notes.md',
    'grep -rn "pkill\\|killall" flows/',
    'cat > .sz/map.md <<EOF\n끌 때는 띄운 PID만 끈다(lsof -ti | xargs kill 금지).\nEOF',
    'npm run skill-check',
  ]) assert.equal(others(command).code, 0, command);
  // Not a shell command, or nothing to read: not this guard's business.
  assert.equal(spawnSync(process.execPath, [join(HERE, '../../../plugin/hooks/guard-others.mjs')], { encoding: 'utf8', input: 'not json' }).status, 0);
});

test('a port is taken from the machine, not chosen', async () => {
  const run = eyes(tmpdir(), 'port');
  assert.equal(run.code, 0);
  const port = Number(run.text.trim());
  assert.ok(Number.isInteger(port) && port > 1023 && port < 65536, run.text);
  assert.equal(await freePort() > 1023, true);
  const server = createServer(() => {});
  await new Promise<void>((done, fail) => server.once('error', fail).listen(port, '127.0.0.1', done));
  server.close();
});

test('every call to Maestro brings a driver port of its own, so the simulator named is the one that answers', async () => {
  const seen: string[][] = [];
  const run = async (command: string, args: string[]) => {
    if (command !== 'maestro') return { exitCode: command === 'xcrun' && args[0] === 'swift' ? 1 : 0, stdout: '', stderr: '', timedOut: false };
    seen.push([command, ...args]);
    return { exitCode: 0, stdout: 'noise before\n{ "attributes": { "text": "로그인" }, "children": [{ "attributes": { "accessibilityText": "코드 받기", "resource-id": "send" } }] }', stderr: '', timedOut: false };
  };
  const first = await lookAt('AAAA-1111', { run: run as never });
  await lookAt('BBBB-2222', { run: run as never });
  assert.deepEqual([first.screen.texts, first.screen.ids], [['로그인', '코드 받기'], ['send']], 'every word and id in the tree, as this look has always listed them');
  for (const [k, udid] of [[0, 'AAAA-1111'], [1, 'BBBB-2222']] as const) {
    const [command, flag, port, device, named, verb] = seen[k]!;
    assert.deepEqual([command, flag, device, named, verb], ['maestro', '--driver-host-port', '--device', udid, 'hierarchy']);
    assert.ok(Number(port) > 1024 && Number(port) !== 22087, `a port of its own, not Maestro's shared default: ${port}`);
  }
});

test('what verifiers notice is kept, however much of it there is', () => {
  // (2026-11-21: a contract held thirty notices after three looks, and the next one was refused.)
  const many = { ...contract(), noticed: Array.from({ length: 120 }, (_, k) => ({ text: `본 것 ${k + 1}`, evidence: [] })) };
  assert.equal(Contract.parse(many).noticed.length, 120);
});

test('a claim found false whose own words are wrong is set aside for the owner: it does not stand, and it does not stop the close', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-dispute-'));
  try {
    assert.equal(eyes(project, 'contract', 'new', 'first-pass', '--lane', 'M', '--request', '첫 판', '--claim', 'path|90cm 상자는 착한택배가 된다|command:true', '--claim', 'keeps|다시 와도 기록이 남는다|command:true').code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'first-pass').code, 0);
    assert.match(eyes(project, 'contract', 'dispute', 'first-pass', 'path', '--ruling', '약속은 100cm라고 하지만 세븐일레븐 공식 안내는 80cm 이하').text, /is unproven: a dispute is about a claim that was looked at and found false/);
    assert.equal(eyes(project, 'contract', 'claim', 'first-pass', 'path', '--status', 'refuted', '--note', '90cm에서 X로 나옴').code, 0);
    assert.equal(eyes(project, 'contract', 'claim', 'first-pass', 'keeps', '--status', 'proven', '--note', '돌려서 봤다').code, 0);
    assert.match(eyes(project, 'contract', 'close', 'first-pass').text, /still owes[\s\S]*path: shown to be false/);
    assert.match(eyes(project, 'contract', 'dispute', 'first-pass', 'path', '--ruling', '짧음').text, /sz-eyes contract dispute <id> <claim-id> --ruling/);
    assert.match(eyes(project, 'contract', 'dispute', 'first-pass', 'path', '--ruling', '약속은 100cm라고 하지만 세븐일레븐 공식 안내(https://example.com/guide)는 "세 변의 합 80cm 이하"').text, /first-pass\/path: disputed\. Its words are unchanged and it does not stand/);
    assert.match(eyes(project, 'contract', 'show', 'first-pass').text, /\[주인이 정할 것\] \*\*path\*\* 90cm 상자는 착한택배가 된다/);
    // Set aside for the owner, it is nobody else's to call proven: a ruling that both set it aside and gave it back
    // would leave it standing while the owner is told it waits for them.
    assert.match(eyes(project, 'contract', 'claim', 'first-pass', 'path', '--status', 'proven', '--note', '제 검사는 통과했다').text, /first-pass\/path is set aside for the owner[\s\S]*sz-eyes contract judged first-pass path/);
    assert.match(eyes(project, 'contract', 'show', 'first-pass').text, /\[주인이 정할 것\] \*\*path\*\*/);
    assert.match(eyes(project, 'contract', 'close', 'first-pass').text, /^closed: first-pass \(1 line\(s\) added/);
    assert.match(readFileSync(join(project, '.sz/backlog.md'), 'utf8'), /주인이 정할 것: 90cm 상자는 착한택배가 된다: 약속의 문구가 사실과 다름/);
    assert.match(eyes(project, 'standing', '--summary').text, /^1 claim\(s\)/, 'only what was proven stands');
    // The owner agrees: it is retired with their word, and its line in the list is ticked.
    assert.match(eyes(project, 'contract', 'judged', 'first-pass', 'path', '--verdict', 'yes', '--said', '맞아 80이 맞음').text, /the owner agrees the claim was wrong; it is retired \(its line in .*backlog\.md is ticked\)/);
    assert.match(eyes(project, 'standing', '--summary').text, /^1 claim\(s\)/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('a claim shown false is closed only on the owner\'s own words, and written down as a known limit', () => {
  // (2026-11-26: a session told its owner twice that a claim shown false could be left in the backlog and the
  // work go on. The owner said to do so; `close` refused with "still owes", and nothing could close it.)
  const project = mkdtempSync(join(tmpdir(), 'eyes-asitis-'));
  try {
    assert.equal(eyes(project, 'contract', 'new', 'first-pass', '--lane', 'M', '--request', '첫 판', '--claim', 'path|90cm 상자는 착한택배가 된다|command:true', '--claim', 'keeps|다시 와도 기록이 남는다|command:true').code, 0);
    // Not frozen: the owner's word closes nothing that was never agreed.
    assert.match(eyes(project, 'contract', 'close', 'first-pass', '--accepted', '그냥 닫아').text, /still owes[\s\S]*not frozen yet/);
    assert.equal(eyes(project, 'contract', 'freeze', 'first-pass').code, 0);
    // A note as long as a verifier's own, with more files than a notice holds: the close must not trip on either.
    // It says first what holds and last what was found instead, as a verifier's note does: the end is what is kept.
    const note = `${'계약의 경우는 통과하고 꼬리와 상한도 지켜진다. '.repeat(40)}`.slice(0, 1080) + ' 그러나 90cm에서 X로 나옴';
    assert.equal(eyes(project, 'contract', 'claim', 'first-pass', 'path', '--status', 'refuted', '--note', note).code, 0);
    // A claim nobody gave a verdict to is not closed for the owner either.
    const unshown = eyes(project, 'contract', 'close', 'first-pass', '--accepted', '그냥 닫아');
    assert.match(unshown.text, /still owes[\s\S]*keeps: not shown yet/);
    assert.match(unshown.text, /A claim nobody gave a verdict to is not closed on anyone's word/);
    assert.equal(eyes(project, 'contract', 'claim', 'first-pass', 'keeps', '--status', 'proven', '--note', '돌려서 봤다').code, 0);
    // A claim shown false: refused, with the ways on, and the backlog does not change that.
    assert.equal(eyes(project, 'backlog', 'add', 'path가 거짓인 채 남음').code, 0);
    const refused = eyes(project, 'contract', 'close', 'first-pass');
    assert.match(refused.text, /still owes[\s\S]*path: shown to be false/);
    assert.match(refused.text, /A claim shown false is not closed by a line of \.sz\/backlog\.md/);
    assert.match(refused.text, /sz-eyes contract close first-pass --accepted "<their words>"/);
    assert.match(refused.text, /Those words are the owner's alone: no agent writes them/);
    assert.match(eyes(project, 'contract', 'close', 'first-pass', '--accepted', '  ').text, /still owes/, 'empty words are no words');
    // The owner's words: closed, with the limit written where the next work is picked from.
    const closedOne = eyes(project, 'contract', 'close', 'first-pass', '--accepted', '이 한계는 알고 이대로 내보내겠어');
    assert.match(closedOne.text, /^closed: first-pass \(1 line\(s\) added/);
    const line = readFileSync(join(project, '.sz/backlog.md'), 'utf8').split('\n').find((l) => l.includes('알려진 한계'))!;
    assert.match(line, /^- \[ \] 알려진 한계\(거짓인 채 닫음, 주인의 말: "이 한계는 알고 이대로 내보내겠어"\): 90cm 상자는 착한택배가 된다: …/);
    assert.match(line, /그러나 90cm에서 X로 나옴 \(계약 first-pass 검증 중 눈에 띔\)$/, 'a note too long for a notice keeps its end, where what was found instead is');
    const kept = JSON.parse(readFileSync(join(project, '.sz/contracts/first-pass.json'), 'utf8')) as { noticed: { text: string }[]; claims: { id: string; note: string }[] };
    assert.equal(kept.noticed.at(-1)!.text.length, 600);
    assert.equal(kept.claims.find((c) => c.id === 'path')!.note, note, 'the claim keeps its whole note');
    assert.match(eyes(project, 'standing', '--summary').text, /^1 claim\(s\)/, 'only what was proven stands');
    const shown = eyes(project, 'contract', 'show', 'first-pass').text;
    assert.match(shown, /\[반증됨\] \*\*path\*\*/, 'the claim is still on record as false');
    assert.match(shown, /알려진 한계\(거짓인 채 닫음/);
    assert.match(eyes(project, 'contract', 'status').text, /nothing is owed/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('the owner\'s word does not close what it does not reach: a promise of earlier work broken, a release line shown false', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-asitis-not-'));
  try {
    assert.equal(eyes(project, 'contract', 'new', 'm1-keeps', '--lane', 'M', '--request', '첫 판', '--claim', 'keeps|다시 와도 기록이 남는다|command:true').code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'm1-keeps').code, 0);
    assert.equal(eyes(project, 'contract', 'claim', 'm1-keeps', 'keeps', '--status', 'proven', '--note', '돌려서 봤다').code, 0);
    assert.match(eyes(project, 'contract', 'close', 'm1-keeps').text, /^closed: m1-keeps/);
    // This work: one claim false, two nobody could look at (most of it), and it broke what stood before.
    assert.equal(eyes(project, 'contract', 'new', 'm2-more', '--lane', 'M', '--request', '둘째', '--claim', 'path|90cm 상자는 착한택배가 된다|command:true', '--claim', 'phone|폰에서 열린다|command:true', '--claim', 'push|알림이 온다|command:true').code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'm2-more').code, 0);
    assert.equal(eyes(project, 'contract', 'claim', 'm2-more', 'path', '--status', 'refuted', '--note', '90cm에서 X로 나옴').code, 0);
    for (const id of ['phone', 'push']) assert.equal(eyes(project, 'contract', 'claim', 'm2-more', id, '--status', 'unchecked', '--note', '시뮬레이터가 없다').code, 0);
    assert.equal(eyes(project, 'standing', 'record', 'm1-keeps/keeps', '--status', 'broken', '--during', 'm2-more', '--note', '다시 오면 기록이 없다').code, 0);
    const words = '알고 있고 이대로 내보낸다. '.repeat(50);
    const kept = eyes(project, 'contract', 'close', 'm2-more', '--accepted', words);
    assert.match(kept.text, /is not closed yet[\s\S]*m1-keeps\/keeps: stood before this work and is broken now/, 'what stood before and broke is mended, whoever says what');
    assert.equal(eyes(project, 'standing', 'record', 'm1-keeps/keeps', '--status', 'holds', '--during', 'm2-more', '--note', '고친 뒤 남는다').code, 0);
    // Their words may be long, and two records carry them (the claim false, the claims not looked at): each fits a notice.
    assert.match(eyes(project, 'contract', 'close', 'm2-more', '--accepted', words).text, /^closed: m2-more/);
    const saved = JSON.parse(readFileSync(join(project, '.sz/contracts/m2-more.json'), 'utf8')) as { noticed: { text: string }[] };
    assert.equal(saved.noticed.length, 2);
    assert.ok(saved.noticed.every((n) => n.text.length <= 600), saved.noticed.map((n) => n.text.length).join(', '));
    assert.match(saved.noticed[1]!.text, /^closed with 2 of 3 claims not looked at, on the owner's word: "알고 있고/);
    assert.match(eyes(project, 'standing', '--summary').text, /^1 claim\(s\)/, 'nothing of m2 stands');

    // A release is a gate, not a piece of work: a line of it shown false means it does not go out.
    assert.equal(eyes(project, 'contract', 'new', 'r1-out', '--lane', 'M', '--request', '내보내기', '--claim', 'rc-walk|후보에서 걸음이 끝까지 간다|command:true').code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'r1-out').code, 0);
    assert.equal(eyes(project, 'contract', 'claim', 'r1-out', 'rc-walk', '--status', 'refuted', '--note', '결제에서 멈춘다').code, 0);
    const file = join(project, '.sz/contracts/r1-out.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), release: { place: 'stage', url: 'https://example.com', candidate: 'https://rc.example.com', commit: 'abc1234' } }));
    const gate = eyes(project, 'contract', 'close', 'r1-out', '--accepted', '그냥 내보내');
    assert.match(gate.text, /still owes[\s\S]*rc-walk: shown to be false/);
    assert.match(gate.text, /A release does not go out over a line shown false, on anyone's word/);
    assert.doesNotMatch(gate.text, /--accepted "<their words>"/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('an agent a session or a workflow started passes none of the owner\'s words', () => {
  // (2026-11-26: `--accepted` came to close a contract over a claim shown false, and on Claude Code nothing but a
  // sentence kept a closer or a fixer from writing those words itself. Codex refuses them in its record tool.)
  const owner = (command: string, agent?: string): { code: number | null; text: string } => {
    const run = spawnSync(process.execPath, [join(HERE, '../../../plugin/hooks/guard-owner.mjs')], { encoding: 'utf8', input: JSON.stringify({ cwd: tmpdir(), tool_name: 'Bash', ...(agent ? { agent_id: agent } : {}), tool_input: { command } }) });
    return { code: run.status, text: run.stderr };
  };
  for (const command of [
    'sz-eyes contract close day-true --accepted "백로그로 두고 다음으로"',
    'cd /p && sz-eyes contract close day-true --dir /p --accepted "닫아" 2>&1 | tail -3',
    '/Users/x/plugin/bin/sz-eyes contract judged design feel --verdict yes --said "좋아요"',
    'bash -c "sz-eyes contract close m1 --accepted ok"',
  ]) {
    const refused = owner(command, 'a5391cdcd0d8ba7e6');
    assert.equal(refused.code, 2, command);
    assert.match(refused.text, /are the owner's, and you have not spoken with them/);
    assert.equal(owner(command).code, 0, `the session that talks with the owner runs it: ${command}`);
  }
  // Closing what nothing stands in the way of, and everything else an agent records, goes through.
  for (const command of ['sz-eyes contract close m1', 'sz-eyes contract claim m1 one --status proven --note "ran it"', 'git commit -m "not with --accepted: sz-eyes contract close refuses"', 'sz-eyes contract show m1 | grep accepted'])
    assert.equal(owner(command, 'a5391cdcd0d8ba7e6').code, 0, command);
  const hooks = JSON.parse(readFileSync(join(HERE, '../../../plugin/hooks/hooks.json'), 'utf8')) as { hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] } };
  assert.ok(hooks.hooks.PreToolUse.find((h) => h.matcher === 'Bash')!.hooks.some((h) => h.command.includes('guard-owner.mjs')), 'the guard is in the plugin\'s hook table');
});

test('a check written by whoever verified is held by the frozen contract from then on, and only ever added', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-addcheck-'));
  try {
    assert.equal(eyes(project, 'contract', 'new', 'first-pass', '--lane', 'M', '--request', '첫 판', '--claim', 'judge|크기를 넣으면 판정이 나온다|flow:flows/judge.sh', '--claim', 'rule|80cm는 된다|test:test/rule.test.mjs').code, 0);
    assert.match(eyes(project, 'contract', 'add-check', 'first-pass', '--frozen', 'flows/judge.sh').text, /is not frozen yet/);
    mkdirSync(join(project, 'test'), { recursive: true });
    writeFileSync(join(project, 'test/rule.test.mjs'), '// rule');
    assert.equal(eyes(project, 'contract', 'freeze', 'first-pass', '--frozen', 'test/rule.test.mjs').code, 0);
    assert.match(eyes(project, 'contract', 'add-check', 'first-pass', '--frozen', 'flows/judge.sh').text, /not there to hold: flows\/judge\.sh/);
    mkdirSync(join(project, 'flows'), { recursive: true });
    writeFileSync(join(project, 'flows/judge.sh'), '#!/bin/bash\nexit 0\n');
    assert.match(eyes(project, 'contract', 'add-check', 'first-pass', '--frozen', 'flows/judge.sh').text, /^held: flows\/judge\.sh \(contract first-pass now holds 2 file\(s\)\)/);
    assert.match(eyes(project, 'contract', 'add-check', 'first-pass', '--frozen', 'flows/judge.sh').text, /a file the contract does not hold yet/);
    const kept = JSON.parse(readFileSync(join(project, '.sz/contracts/first-pass.json'), 'utf8'));
    assert.deepEqual(kept.frozen, ['test/rule.test.mjs', 'flows/judge.sh']);
    assert.deepEqual(Object.keys(kept.frozenPrints).sort(), ['flows/judge.sh', 'test/rule.test.mjs']);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('the eyes say in one line that their copy has no dependencies, and the stop hook does not take that for claims owed', () => {
  // 2026-11-21: a copy of the plugin without node_modules ended every command with ERR_MODULE_NOT_FOUND and exit 1,
  // which the stop hook read as "claims are owed" and blocked a session with an empty list.
  const root = mkdtempSync(join(tmpdir(), 'eyes-bare-'));
  try {
    const wrapper = fileURLToPath(new URL('../../../plugin/bin/sz-eyes', import.meta.url));
    mkdirSync(join(root, 'plugin', 'bin'), { recursive: true });
    mkdirSync(join(root, 'plugin', 'hooks'), { recursive: true });
    mkdirSync(join(root, 'packages', 'eyes', 'src'), { recursive: true });
    writeFileSync(join(root, 'plugin', 'bin', 'sz-eyes'), readFileSync(wrapper, 'utf8'), { mode: 0o755 });
    writeFileSync(join(root, 'plugin', 'hooks', 'stop-owed.mjs'), readFileSync(fileURLToPath(new URL('../../../plugin/hooks/stop-owed.mjs', import.meta.url)), 'utf8'));
    writeFileSync(join(root, 'packages', 'eyes', 'src', 'cli.ts'), "console.log('ran'); process.exit(process.argv.includes('status') ? 1 : 0);\n");
    const bare = spawnSync(join(root, 'plugin', 'bin', 'sz-eyes'), ['port'], { encoding: 'utf8' });
    assert.equal(bare.status, 127);
    assert.match(bare.stderr, /^sz-eyes: this copy of the harness has no dependencies installed \(.*packages\/eyes has no node_modules\): run 'pnpm install' in /);
    assert.equal(bare.stdout, '');
    const stopped = spawnSync(process.execPath, [join(root, 'plugin', 'hooks', 'stop-owed.mjs')], { encoding: 'utf8', input: JSON.stringify({ cwd: root }) });
    assert.equal(stopped.status, 0, 'eyes that do not run owe nothing that a session could show');
    // Installed, the same wrapper runs the command line.
    mkdirSync(join(root, 'packages', 'eyes', 'node_modules'));
    const whole = spawnSync(join(root, 'plugin', 'bin', 'sz-eyes'), ['port'], { encoding: 'utf8' });
    assert.deepEqual([whole.status, whole.stdout.trim()], [0, 'ran']);
    // Exit 1 with nothing said is not a list of claims either.
    writeFileSync(join(root, 'packages', 'eyes', 'src', 'cli.ts'), 'process.exit(1);\n');
    const silent = spawnSync(process.execPath, [join(root, 'plugin', 'hooks', 'stop-owed.mjs')], { encoding: 'utf8', input: JSON.stringify({ cwd: root }) });
    assert.equal(silent.status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('what is owed is said once in a session, and again only when it has changed', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-owed-'));
  const hook = fileURLToPath(new URL('../../../plugin/hooks/stop-owed.mjs', import.meta.url));
  const session = `test-${process.pid}-${Date.now()}`;
  const stop = (id: string | undefined): { code: number | null; said: string } => {
    const run = spawnSync(process.execPath, [hook], { encoding: 'utf8', input: JSON.stringify({ cwd: project, ...(id ? { session_id: id } : {}) }) });
    return { code: run.status, said: run.stderr };
  };
  try {
    assert.equal(eyes(project, 'contract', 'new', 'm1-accounts', '--lane', 'M', '--request', '계정', '--claim', 'signup|가입하면 홈에 닉네임이 보인다|command:true', '--claim', 'stays|껐다 켜도 로그인돼 있다|command:true').code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'm1-accounts').code, 0);

    const first = stop(session);
    assert.equal(first.code, 2);
    assert.match(first.said, /Before you stop: contract m1-accounts[\s\S]*signup: not shown yet[\s\S]*stays: not shown yet/);
    assert.equal(stop(session).code, 0, 'the same list is not said a second time in the session');
    assert.equal(stop(`${session}-other`).code, 2, 'another session has not been told');

    assert.equal(eyes(project, 'contract', 'claim', 'm1-accounts', 'signup', '--status', 'proven', '--note', '돌려서 봤다').code, 0);
    const changed = stop(session);
    assert.equal(changed.code, 2, 'the list changed: it is said again');
    assert.doesNotMatch(changed.said, /signup: not shown yet/);
    assert.equal(stop(session).code, 0);

    assert.equal(stop(undefined).code, 2, 'with no session to remember it for, it is said every time, as before');
  } finally {
    rmSync(project, { recursive: true, force: true });
    for (const id of [session, `${session}-other`]) rmSync(join(tmpdir(), `sz-owed-${id}`), { force: true });
  }
});

test('a contract most of which nobody looked at does not close, unless the owner says to close it as it is', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-unlooked-'));
  try {
    assert.equal(eyes(project, 'contract', 'new', 'm1-accounts', '--lane', 'M', '--request', '계정', '--claim', 'private|남의 프로필은 못 읽는다|command:true', '--claim', 'signup|가입하면 홈에 닉네임이 보인다|flow:e2e/signup.yaml', '--claim', 'stays|껐다 켜도 로그인돼 있다|flow:e2e/stays.yaml', '--claim', 'feel|대결 앱으로 보인다|owner:첫 화면 사진').code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'm1-accounts').code, 0);
    assert.equal(eyes(project, 'contract', 'claim', 'm1-accounts', 'private', '--status', 'proven', '--note', 'DB 테스트 6/6').code, 0);
    for (const claim of ['signup', 'stays']) assert.equal(eyes(project, 'contract', 'claim', 'm1-accounts', claim, '--status', 'unchecked', '--note', '앱 빌드가 없어 돌리지 못함').code, 0);
    assert.equal(eyes(project, 'contract', 'claim', 'm1-accounts', 'feel', '--status', 'unchecked', '--note', '주인이 볼 것').code, 0);

    // Two of the three claims that could have been looked at were not: the owner's own claim is not counted.
    const refused = eyes(project, 'contract', 'close', 'm1-accounts');
    assert.notEqual(refused.code, 0);
    assert.match(refused.text, /was not looked at: 2 of its 3 claims are unchecked:[\s\S]*signup: 앱 빌드가 없어 돌리지 못함[\s\S]*does not close on claims nobody looked at/);
    assert.doesNotMatch(refused.text, /feel:/);

    // One of them shown: one of three is left, and it closes as before.
    assert.equal(eyes(project, 'contract', 'claim', 'm1-accounts', 'signup', '--status', 'proven', '--note', '흐름 통과').code, 0);
    assert.match(eyes(project, 'contract', 'close', 'm1-accounts').text, /^closed: m1-accounts/);

    // The owner may say to close one as it is; their words stay on the record.
    assert.equal(eyes(project, 'contract', 'new', 'm2-steps', '--lane', 'M', '--request', '걸음', '--claim', 'reads|걸음 수가 보인다|flow:e2e/steps.yaml').code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'm2-steps').code, 0);
    assert.equal(eyes(project, 'contract', 'claim', 'm2-steps', 'reads', '--status', 'unchecked', '--note', '실기기가 있어야 함').code, 0);
    assert.notEqual(eyes(project, 'contract', 'close', 'm2-steps').code, 0);
    assert.match(eyes(project, 'contract', 'close', 'm2-steps', '--accepted', '기기는 내가 나중에 볼게').text, /^closed: m2-steps/);
    assert.match(readFileSync(join(project, '.sz/contracts/m2-steps.json'), 'utf8'), /closed with 1 of 1 claims not looked at, on the owner's word: \\"기기는 내가 나중에 볼게\\"/);
    assert.match(readFileSync(join(project, '.sz/backlog.md'), 'utf8'), /closed with 1 of 1 claims not looked at/, 'it is also left where the next work is picked from');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('the owner’s verdict on what was left for them is taken in their words, after the work is closed', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-judged-'));
  try {
    assert.equal(eyes(project, 'contract', 'new', 'm1-feel', '--lane', 'M', '--request', '장부', '--claim', 'adds|합계가 맞다|command:true', '--claim', 'feel|차분하고 금액이 크다|owner:폰 사진', '--claim', 'fast|이어 적기가 빠르다|owner:영상').code, 0);
    assert.match(eyes(project, 'contract', 'judged', 'm1-feel', 'feel', '--verdict', 'yes', '--said', '좋음').text, /not agreed yet/);
    assert.equal(eyes(project, 'contract', 'freeze', 'm1-feel').code, 0);
    assert.equal(eyes(project, 'contract', 'claim', 'm1-feel', 'adds', '--status', 'proven', '--note', '돌려서 통과를 봤다').code, 0);
    for (const claim of ['feel', 'fast']) assert.equal(eyes(project, 'contract', 'claim', 'm1-feel', claim, '--status', 'unchecked', '--note', '사진을 주인이 볼 것').code, 0);
    assert.equal(eyes(project, 'contract', 'close', 'm1-feel').code, 0);
    assert.match(eyes(project, 'standing', '--summary').text, /^1 claim\(s\)/);
    assert.match(eyes(project, 'overview', project).text, /주인의 판단을 기다리는 것 2/);

    // Only the owner's claims, and only with a verdict and their words.
    assert.match(eyes(project, 'contract', 'judged', 'm1-feel', 'adds', '--verdict', 'yes', '--said', '좋음').text, /is shown by command, not left for the owner/);
    assert.match(eyes(project, 'contract', 'judged', 'm1-feel', 'feel', '--verdict', 'maybe', '--said', '글쎄').text, /--verdict yes\|no/);
    assert.match(eyes(project, 'contract', 'judged', 'm1-feel', 'feel', '--verdict', 'yes').text, /--verdict yes\|no/);

    // Yes: the claim is proven by their words, stands from here, and its line in the backlog is ticked.
    const yes = eyes(project, 'contract', 'judged', 'm1-feel', 'feel', '--verdict', 'yes', '--said', '차분하고 금액도 잘 보임');
    assert.match(yes.text, /m1-feel\/feel: proven by the owner \(its line in \.sz\/backlog\.md is ticked; it stands from here\)/);
    assert.match(eyes(project, 'contract', 'show', 'm1-feel').text, /주인이 봄 \(\d{4}-\d{2}-\d{2}\): "차분하고 금액도 잘 보임"/);
    assert.match(eyes(project, 'standing').text, /2 claim\(s\) stand[\s\S]*m1-feel\/feel \[holds/);
    assert.match(readFileSync(join(project, '.sz/backlog.md'), 'utf8'), /- \[x\] 주인이 볼 것: 차분하고 금액이 크다.* — 끝남: 주인의 판단 \d{4}-\d{2}-\d{2}: "차분하고 금액도 잘 보임"/);

    // No: refuted, not standing, and what they said is what is left to do.
    assert.match(eyes(project, 'contract', 'judged', 'm1-feel', 'fast', '--verdict', 'no', '--said', '칸이 너무 많음').text, /m1-feel\/fast: refuted by the owner/);
    assert.match(eyes(project, 'standing', '--summary').text, /^2 claim\(s\)/);
    assert.match(eyes(project, 'backlog').text, /1 open[\s\S]*주인이 보고 아니라고 함: 이어 적기가 빠르다: "칸이 너무 많음"/);
    assert.doesNotMatch(eyes(project, 'overview', project).text, /주인의 판단을 기다리는 것/);

    // Later work changed what they saw: the verifier does not judge it for them, and it waits for them again.
    assert.equal(eyes(project, 'standing', 'record', 'm1-feel/feel', '--status', 'unchecked', '--note', '홈 화면의 카드가 바뀜: look/home-after.png').code, 0);
    assert.match(eyes(project, 'overview', project).text, /주인의 판단을 기다리는 것 1:[\s\S]*다시 볼 것: 차분하고 금액이 크다: 홈 화면의 카드가 바뀜/);
    // And they say again what they think of it as it is now.
    assert.equal(eyes(project, 'contract', 'judged', 'm1-feel', 'feel', '--verdict', 'yes', '--said', '바뀐 것도 괜찮음').code, 0);
    assert.doesNotMatch(eyes(project, 'overview', project).text, /주인의 판단을 기다리는 것/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('a look straight after a press sees what the press did, with no picture kept and no wait written', async () => {
  // The screen changes a little after the press (a request, a message to another process): a step that reads
  // it must not read it as it was before.
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>물</title><p id="count">0잔</p><button onclick="setTimeout(()=>{document.querySelector('#count').textContent='1잔';window.n=1},600)">한 잔 더</button>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
    const seen = await walkWeb(url, ['tap:한 잔 더', 'see:1잔']);
    assert.equal(seen.passed, true, seen.steps.map((s) => s.why).join(' '));
    const expected = await walkWeb(url, ['tap:한 잔 더', 'expect:window.n === 1']);
    assert.equal(expected.passed, true, expected.steps.map((s) => s.why).join(' '));
    // What never comes is still said, after the moment given.
    const never = await walkWeb(url, ['see:2잔']);
    assert.equal(never.passed, false);
    assert.match(never.steps[0]!.why ?? '', /"2잔" is not on screen/);
  } finally {
    server.close();
  }
});

test('a choice drawn as a chip is pressed where a person presses it, though an invisible input lies over its words', async () => {
  // Two stand-ins reported that a product's chips could not be pressed. They could: the eyes refused to press
  // words that an unseen input covered, which is how such a choice is usually built.
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>자리</title><style>label{position:relative;display:inline-block;margin:8px}label input{position:absolute;inset:0;opacity:0;margin:0;width:100%;height:100%}label span{display:inline-block;padding:10px 16px;border:1px solid #999;border-radius:99px}</style>
<label><input type="radio" name="o" value="결혼식"><span>결혼식</span></label><label><input type="radio" name="o" value="장례식"><span>장례식</span></label><button disabled>만들기</button>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
    const walk = await walkWeb(url, ['tap:장례식', 'expect:document.querySelector("input[value=장례식]").checked === true', 'tap:결혼식', 'expect:document.querySelector("input[value=결혼식]").checked === true']);
    assert.equal(walk.passed, true, walk.steps.map((s) => s.why).join(' '));
    // What cannot be pressed for another reason is still said to be so.
    const dead = await walkWeb(url, ['tap:만들기'], { stepTimeoutMs: 1_500 });
    assert.equal(dead.passed, false);
  } finally {
    server.close();
  }
});

test('a browser the command sandbox stopped is said to be that, with what to do, and not a failure of the product', () => {
  // What Chrome, and Playwright's headless shell, wrote when started inside the session's sandbox (2026-11-16).
  const chrome = 'browserType.launch: Failed to create a ProcessSingleton for your profile directory. This usually means that the profile is already in use by another instance of Chromium.\nCall log:\n  - [pid=50117][err] [1116/115316.341144:ERROR:chrome/browser/process_singleton_posix.cc:1046] Failed to create socket directory.';
  const shell = '[1116/115411.150850:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.51335: Permission denied (1100)';
  const opened = 'browserType.launch: Target page, context or browser has been closed\n[pid=58984][err] [58984:51786177:1116/115843.805162:FATAL:base/mac/mac_util.mm:379] Check failed: . : Operation not permitted (1)';
  const simctl = 'could not list the simulators: }) because we are not connected to CoreSimulatorService. 2026-11-16 15:32:06.681 simctl[47880:52719603] Error Domain=NSPOSIXErrorDomain Code=61 "Connection refused" UserInfo={NSLocalizedDescription=CoreSimulatorService connection became invalid.';
  for (const text of [chrome, shell, opened, simctl]) {
    const said = stoppedBySandbox(new Error(text));
    assert.ok(said instanceof SandboxError, text.slice(0, 60));
    assert.match(said.message, /ran inside the session's command sandbox[\s\S]*Nothing is wrong with the product[\s\S]*dangerouslyDisableSandbox: true[\s\S]*from the first try[\s\S]*auto mode[\s\S]*\/sandbox[\s\S]*not a verdict on any claim/);
  }
  assert.match(stoppedBySandbox(new Error(shell), 'the app')!.message, /^the app could not start/);
  assert.match(stoppedBySandbox(new Error(simctl), 'the simulator')!.message, /^the simulator could not start because this command ran inside the session's command sandbox/);
  // Anything else that stops a browser is left as it is.
  for (const other of ['browserType.launch: Chromium distribution "chrome" is not found at /Applications/Google Chrome.app', 'page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:1/', 'Timeout 30000ms exceeded']) assert.equal(stoppedBySandbox(new Error(other)), null, other);
});

test('two lines of work that each looked at what stands are brought together without losing a look of either', () => {
  // Milestones built side by side each close a contract and each look again at earlier claims: git cannot merge
  // the record of that by itself, and "keep both sides by hand" is what a session left alone gets wrong.
  const project = mkdtempSync(join(tmpdir(), 'eyes-mend-'));
  const git = (...args: string[]): string => {
    const run = spawnSync('git', args, { cwd: project, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' } });
    return `${run.stdout}${run.stderr}`;
  };
  const ledger = (shown: Record<string, { status: string; at: string; note?: string }>): void => {
    mkdirSync(join(project, '.sz'), { recursive: true });
    writeFileSync(join(project, '.sz/standing.json'), `${JSON.stringify({ shown: Object.fromEntries(Object.entries(shown).map(([k, v]) => [k, { note: '', during: null, files: {}, ...v }])) }, null, 2)}\n`);
  };
  try {
    git('init', '-q', '-b', 'main');
    ledger({ 'm1/a': { status: 'holds', at: '2026-11-16T01:00:00.000Z' }, 'm1/b': { status: 'holds', at: '2026-11-16T01:00:00.000Z' } });
    git('add', '-A');
    git('commit', '-q', '-m', 'm1');
    git('checkout', '-q', '-b', 'sz/m2');
    ledger({ 'm1/a': { status: 'holds', at: '2026-11-16T02:00:00.000Z', note: 'm2 중에 다시 봄' }, 'm1/b': { status: 'holds', at: '2026-11-16T02:00:00.000Z' }, 'm2/x': { status: 'holds', at: '2026-11-16T02:10:00.000Z' } });
    git('commit', '-q', '-am', 'm2');
    git('checkout', '-q', 'main');
    git('checkout', '-q', '-b', 'sz/m3');
    ledger({ 'm1/a': { status: 'holds', at: '2026-11-16T02:05:00.000Z', note: 'm3 중에 다시 봄' }, 'm1/b': { status: 'broken', at: '2026-11-16T02:30:00.000Z', note: 'm3가 깼다' }, 'm3/y': { status: 'holds', at: '2026-11-16T02:20:00.000Z' } });
    git('commit', '-q', '-am', 'm3');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', 'sz/m2', '-m', 'm2');
    assert.match(eyes(project, 'standing', 'mend').text, /not in a merge with two sides to keep/);
    assert.match(git('merge', '--no-ff', 'sz/m3', '-m', 'm3'), /CONFLICT/);
    assert.match(eyes(project, 'standing', '--summary').text, /cannot be read/);
    const mended = eyes(project, 'standing', 'mend');
    assert.match(mended.text, /the looks of both sides kept, 4 claim\(s\)/);
    const shown = JSON.parse(readFileSync(join(project, '.sz/standing.json'), 'utf8')).shown as Record<string, { status: string; note: string }>;
    assert.deepEqual(Object.keys(shown), ['m1/a', 'm1/b', 'm2/x', 'm3/y']);
    assert.equal(shown['m1/a']!.note, 'm3 중에 다시 봄', 'where both looked, the later look');
    assert.equal(shown['m1/b']!.status, 'broken', 'a later look that found it broken is not lost to an earlier one that did not');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ several verifiers at once

/** The command line in a process of its own, not waited for: started beside others, as verifiers start it. */
const eyesLater = (project: string, ...args: string[]): Promise<{ code: number | null; text: string }> =>
  new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(HERE, '../src/cli.ts'), ...args, '--dir', project]);
    let text = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (text += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (text += chunk));
    child.on('error', fail);
    child.on('close', (code) => done({ code, text }));
  });

test('verifiers recording on one contract at the same moment lose no verdict, notice or look, and a reader never sees half a file', async () => {
  // Three verifiers look at a product at once and each records on the same contract. Each command read the whole
  // file, changed it and wrote it back: a verdict written first was overwritten by the next writer and read back
  // as unproven (16 at once lost 5, 8 and 6 of 16).
  const project = mkdtempSync(join(tmpdir(), 'eyes-race-'));
  const n = 16;
  const ids = Array.from({ length: n }, (_, i) => `c${i + 1}`);
  const file = join(project, CONTRACTS_DIR, 'race.json');
  try {
    assert.equal(eyes(project, 'contract', 'new', 'race', '--lane', 'M', '--request', '여럿이 한꺼번에 적는다', ...ids.flatMap((id) => ['--claim', `${id}|약속 ${id}이 참이다|command:true`])).code, 0);
    assert.equal(eyes(project, 'contract', 'freeze', 'race').code, 0);

    // While they write, someone reads the file as it is, with no lock: it is always a whole file.
    const reader = (async () => {
      const broken: string[] = [];
      for (let i = 0; i < 200; i++) {
        try {
          Contract.parse(JSON.parse(readFileSync(file, 'utf8')));
        } catch (err) {
          broken.push(String(err).split('\n')[0]!);
        }
        await new Promise((resolve) => setTimeout(resolve, 3));
      }
      return broken;
    })();
    const [claimed, broken] = await Promise.all([Promise.all(ids.map((id) => eyesLater(project, 'contract', 'claim', 'race', id, '--status', 'proven', '--note', `돌려서 봤다 ${id}`))), reader]);
    for (const run of claimed) assert.equal(run.code, 0, run.text);
    const after = Contract.parse(JSON.parse(readFileSync(file, 'utf8')));
    const lost = after.claims.filter((claim) => claim.status !== 'proven').map((claim) => claim.id);
    assert.deepEqual(lost, [], `${lost.length} of ${n} verdicts lost`);
    assert.deepEqual(after.claims.map((claim) => claim.note), ids.map((id) => `돌려서 봤다 ${id}`));
    assert.deepEqual(broken, [], `${broken.length} of 200 reads did not get a whole contract`);

    const noticed = await Promise.all(Array.from({ length: 6 }, (_, i) => eyesLater(project, 'contract', 'notice', 'race', `눈에 띈 것 ${i + 1}`)));
    for (const run of noticed) assert.equal(run.code, 0, run.text);
    const kept = Contract.parse(JSON.parse(readFileSync(file, 'utf8'))).noticed.map((entry) => entry.text).sort();
    assert.deepEqual(kept, Array.from({ length: 6 }, (_, i) => `눈에 띈 것 ${i + 1}`).sort(), `${6 - kept.length} of 6 notices lost`);
    assert.deepEqual(readdirSync(join(project, CONTRACTS_DIR)).filter((name) => !name.endsWith('.json')), [], 'no lock or half-written file is left beside the contracts');

    // The promises it proved stand once it is closed, and the looks at them are recorded at once too.
    assert.equal(eyes(project, 'contract', 'close', 'race').code, 0);
    const looked = await Promise.all(ids.map((id) => eyesLater(project, 'standing', 'record', `race/${id}`, '--status', 'holds', '--note', `다시 돌려 봤다 ${id}`, '--during', 'race')));
    for (const run of looked) assert.equal(run.code, 0, run.text);
    const shown = JSON.parse(readFileSync(join(project, '.sz/standing.json'), 'utf8')).shown as Record<string, { status: string; note: string }>;
    const forgotten = ids.filter((id) => shown[`race/${id}`]?.note !== `다시 돌려 봤다 ${id}`);
    assert.deepEqual(forgotten, [], `${forgotten.length} of ${n} looks lost`);
    assert.deepEqual(readdirSync(join(project, '.sz')).filter((name) => name.endsWith('.lock') || name.endsWith('.tmp')), [], 'no lock or half-written file is left beside the record');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

/** A folder for a lock test, with the lock's waits set for it and put back as they were afterwards. */
const lockTest = (name: string, env: Record<string, string>, body: (target: string, lock: string) => void): void => {
  test(name, () => {
    const folder = mkdtempSync(join(tmpdir(), 'eyes-lock-'));
    const before = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
    Object.assign(process.env, env);
    try {
      const target = join(folder, 'contracts', 'm1.json');
      body(target, lockPathOf(target));
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(folder, { recursive: true, force: true });
    }
  });
};
const someoneElse = (lock: string, pid: number): string => {
  mkdirSync(lock, { recursive: true });
  const token = join(lock, `${pid}.elsewhere.json`);
  writeFileSync(token, JSON.stringify({ pid, at: '2026-11-17T01:02:03.000Z' }));
  return token;
};

lockTest('a lock is a folder beside the file: the callback runs inside it, and nothing of it is left after', { SZ_LOCK_TIMEOUT_MS: '2000' }, (target, lock) => {
  assert.equal(lock, `${target}.lock`);
  assert.equal(withFileLock(target, () => {
    assert.ok(existsSync(lock), 'held while the callback runs');
    writeFileAtomic(target, '{"n":1}\n');
    return 'what it returned';
  }), 'what it returned');
  assert.equal(existsSync(lock), false);
  assert.throws(() => withFileLock(target, () => { throw new Error('failed inside'); }), /failed inside/);
  assert.equal(existsSync(lock), false, 'given back when the callback throws');
  assert.deepEqual(readdirSync(dirname(target)), ['m1.json'], 'no lock and no half-written file beside it');
  assert.equal(readFileSync(target, 'utf8'), '{"n":1}\n');
});

lockTest('a lock older than the stale time is taken as abandoned, whoever made it, and the call goes on', { SZ_LOCK_TIMEOUT_MS: '2000', SZ_LOCK_STALE_MS: '30000' }, (target, lock) => {
  // A process alive or not, its number reused or not: only the age of its lock says it was abandoned.
  someoneElse(lock, process.pid);
  const old = new Date(Date.now() - 60_000);
  utimesSync(lock, old, old);
  assert.equal(withFileLock(target, () => 'went on'), 'went on');
  assert.equal(existsSync(lock), false);
  assert.deepEqual(readdirSync(dirname(target)), [], 'what was reclaimed is gone, not set aside and left');
});

lockTest('a fresh lock held by someone else is waited for, then refused with the file, the wait and who holds it', { SZ_LOCK_TIMEOUT_MS: '200', SZ_LOCK_STALE_MS: '30000' }, (target, lock) => {
  const token = someoneElse(lock, 4242);
  const started = Date.now();
  let ran = false;
  assert.throws(
    () => withFileLock(target, () => (ran = true)),
    (err: Error) => err.message.includes(target) && /waited \d+ ms/.test(err.message) && /process 4242 since 2026-11-17T01:02:03\.000Z/.test(err.message),
  );
  assert.ok(Date.now() - started >= 200, 'it waited for the time it was given');
  assert.equal(ran, false);
  assert.ok(existsSync(token), 'the lock of whoever holds it is left as it is');
});

lockTest('taking the same lock again inside its callback is refused at once, not waited on forever', { SZ_LOCK_TIMEOUT_MS: '5000' }, (target, lock) => {
  const started = Date.now();
  assert.throws(() => withFileLock(target, () => withFileLock(target, () => 'never')), /already holds the lock/);
  assert.ok(Date.now() - started < 1000, `refused at once, not after the wait (${Date.now() - started} ms)`);
  assert.throws(() => withFileLock(target, () => withFileLock(`${dirname(target)}/./m1.json`, () => 'never')), /already holds the lock/, 'the same file by another spelling');
  assert.equal(existsSync(lock), false);
});

lockTest('a holder whose lock was taken from it while it was held up does not remove the next holder’s lock', { SZ_LOCK_TIMEOUT_MS: '2000' }, (target, lock) => {
  // While this holder was frozen past the stale time, its lock was reclaimed and someone else took it afresh.
  let next = '';
  withFileLock(target, () => {
    renameSync(lock, `${lock}-reclaimed`);
    rmSync(`${lock}-reclaimed`, { recursive: true });
    next = someoneElse(lock, 5151);
  });
  assert.ok(existsSync(next), 'the next holder still holds it');
  rmSync(lock, { recursive: true });
  // Nor when the next holder has made its folder and not yet put its token in it.
  withFileLock(target, () => {
    rmSync(lock, { recursive: true });
    mkdirSync(lock);
  });
  assert.ok(existsSync(lock));
});

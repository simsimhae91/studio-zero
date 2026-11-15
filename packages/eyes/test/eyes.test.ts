// The parts of the eyes that need no browser and no simulator: a contract and what it still owes, the page the
// owner reads, and the copy of a flow that cannot write outside the folder it was given.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addToBacklog, leftBy, openBacklog } from '../src/backlog.ts';
import { Contract, openContracts, owed, renderContract, writeContract, CONTRACTS_DIR } from '../src/contract.ts';
import { createServer } from 'node:http';
import { addSaid, newRound, noteSaid, readRound, renderRound, roundPage } from '../src/feedback.ts';
import { reviewWeb } from '../src/review.ts';
import { brokenDuring, keptFor, recordShown, stampClosed, standing } from '../src/standing.ts';
import { evidencePage } from '../src/evidence.ts';
import { quarantineFlow } from '../src/ios.ts';

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
    const replacing = { ...next, supersedes: [{ contract: 'm1-split', claim: 'phone', why: '주인이 모임 화면을 탭 둘로 나누자고 했다' }] };
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
    // The owner ticks one by hand: it is no longer open, and their own line is kept as they wrote it.
    const file = join(project, '.sz/backlog.md');
    writeFileSync(file, `${readFileSync(file, 'utf8').replace('- [ ] 모임 이름이', '- [x] 모임 이름이')}- [ ] 카톡으로 바로 공유\n`);
    assert.deepEqual(openBacklog(project), ['주인이 볼 것: feel가 참이다 (계약 m1-split)', '카톡으로 바로 공유']);
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
    assert.equal(eyes(project, 'contract', 'freeze', 'm2-shares', '--frozen', 'flows/split.sh').code, 0);
    assert.equal(guard(project, 'flows/split.sh').code, 2, 'and from the freeze it is the new contract’s');
    assert.match(eyes(project, 'standing').text, /1 claim\(s\) stand[\s\S]*no longer standing[\s\S]*m1-split\/split[\s\S]*replaced by contract m2-shares/);

    // What stood and was broken by this work is owed by it: it does not close over that.
    assert.equal(eyes(project, 'contract', 'claim', 'm2-shares', 'shares', '--status', 'proven', '--note', '검사를 돌려 통과').code, 0);
    assert.equal(eyes(project, 'standing', 'record', 'm1-split/all', '--status', 'broken', '--during', 'm2-shares', '--note', 'flows/all.sh가 1로 끝난다').code, 0);
    assert.equal(eyes(project, 'standing').code, 1);
    assert.match(eyes(project, 'contract', 'status').text, /m1-split\/all: stood before this work and is broken now/);
    assert.match(eyes(project, 'contract', 'close', 'm2-shares').text, /is not closed while what stood before it is broken/);
    assert.equal(eyes(project, 'standing', 'record', 'm1-split/all', '--status', 'holds', '--during', 'm2-shares', '--note', '고친 뒤 0으로 끝난다').code, 0);
    assert.equal(eyes(project, 'contract', 'close', 'm2-shares').code, 0);
    assert.ok(existsSync(join(project, '.sz/standing.json')));
    assert.match(readFileSync(eyes(project, 'evidence', 'm2-shares').text.trim(), 'utf8'), /전부터 지키던 것[\s\S]*이번에 다시 보임 1[\s\S]*이 작업으로 물러난 약속/);
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
    res.end('<!doctype html><title>모임</title><body><h1>동창회</h1><p id="total">120,000원</p><button id="pay" onclick="document.title=\'pressed\'">돈 쓴 거 적기</button></body>');
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
        await page.locator('#pay').click();
        titleWhilePointing = await page.title();
        await bar.locator('textarea').fill('버튼이 너무 작아요');
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

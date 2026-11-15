// The parts of the eyes that need no browser and no simulator: a contract and what it still owes, the page the
// owner reads, and the copy of a flow that cannot write outside the folder it was given.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Contract, openContracts, owed, renderContract, writeContract, CONTRACTS_DIR } from '../src/contract.ts';
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

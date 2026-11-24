import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { BRIEF_FILE, BRIEF_SECTIONS, addSaw, answersIn, closeDive, diveFolder, diveRoot, findHeard, heardSince, ideaPage, leftBefore, linesOf, newDive, progressLine, readDive, seeInFile, setDirection, setDiveLine, writeBrief, type DiveKind, type Heard } from '../src/dive.ts';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '../../..');
const CLI = join(ROOT, 'packages/eyes/src/cli.ts');
const AT = '2026-11-24T01:00:00.000Z';
const said = (...words: string[]): Heard[] => words.map((w, i) => ({ at: `2026-11-24T00:5${i}:00.000Z`, kind: 'typed', words: w }));

function project(): { dir: string; env: NodeJS.ProcessEnv; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'eyes-dive-'));
  return { dir, env: { ...process.env, SZ_DIVES_DIR: join(dir, 'dives-home') }, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a line is settled or left open only by words the owner said, and a proposal is the dive\'s own', () => {
  const p = project();
  try {
    const heard = said('/sz:dive 카톡 단톡방에서 정산하는 게 너무 귀찮아', '음 그냥 편하게?', '지난주 토요일에 동창 모임 끝나고 6명이 나눴는데 계좌 묻느라 20분 걸렸어요', '1번이요', '모르겠어요 만들면서 봐요');
    assert.throws(() => newDive(p.dir, 'settle', 'app', '정산 앱 만들고 싶다', heard, AT, p.env), /is not among what the owner said/);
    assert.throws(() => newDive(p.dir, 'settle', 'app', '카톡 단톡방에서 정산', [], AT, p.env), /nothing the owner said has been heard/);
    const folder = newDive(p.dir, 'settle', 'app', '카톡 단톡방에서 정산하는 게 너무 귀찮아', heard, AT, p.env);
    assert.equal(folder, join(p.dir, '.sz/dive/settle'));
    assert.throws(() => newDive(p.dir, 'settle', 'app', '카톡 단톡방에서 정산하는 게 너무 귀찮아', heard, AT, p.env), /already a dive "settle"/);
    assert.deepEqual(Object.keys(readDive(folder).lines), linesOf('app'));

    // Settled and waived take the owner's words; the dive's own sentence is refused as theirs.
    assert.throws(() => setDiveLine(folder, 'pain', { status: 'settled', says: '모임 뒤 계좌를 묻느라 20분' }, heard, AT), /settling pain takes the owner's own words/);
    assert.throws(() => setDiveLine(folder, 'pain', { status: 'settled', says: '모임 뒤 계좌를 묻느라 20분', said: '모임 끝나고 계좌 묻는 게 제일 귀찮다' }, heard, AT), /is not among what the owner said[\s\S]*지난주 토요일/);
    assert.throws(() => setDiveLine(folder, 'feel', { status: 'waived' }, heard, AT), /leaving feel open takes the owner's own words/);
    const pain = setDiveLine(folder, 'pain', { status: 'settled', says: '지난주 토요일 동창 모임 뒤 6명 정산, 계좌 묻느라 20분', said: '계좌 묻느라 20분 걸렸어요' }, heard, AT);
    assert.equal(pain.accepted, false);

    // A proposal is the dive's: no owner's words on it. Taken as it stood, it says so.
    assert.throws(() => setDiveLine(folder, 'core', { status: 'proposed', says: '모임이 끝나는 순간 각자 낼 돈이 단톡방에 뜬다', said: '1번이요' }, heard, AT), /a proposal is the dive's/);
    setDiveLine(folder, 'core', { status: 'proposed', says: '모임이 끝나는 순간 각자 낼 돈이 단톡방에 뜬다' }, heard, AT);
    assert.match(progressLine(readDive(folder)), /명확해진 줄 1\/10 · 열린 것: moment, now, home, first, back, not, feel, done · 답을 기다리는 안: core/);
    assert.equal(setDiveLine(folder, 'core', { status: 'settled', said: '1번이요' }, heard, AT).accepted, true);
    // A settled line changes only by their words again.
    assert.throws(() => setDiveLine(folder, 'core', { says: '다른 것' }, heard, AT), /changes only by their words again/);
    assert.equal(setDiveLine(folder, 'feel', { status: 'waived', said: '모르겠어요' }, heard, AT).status, 'waived');
    // Lines of another kind are not lines of this one.
    assert.throws(() => setDiveLine(folder, 'loop', { status: 'proposed', says: '30초마다 정산' }, heard, AT), /loop is not a line of a app dive/);
  } finally {
    p.done();
  }
});

test('a dive closes only when every line is the owner\'s, directions were shown and one taken, and they said what they make of the page', () => {
  const p = project();
  try {
    const heard = said('/sz:dive 인디게임 보고서 읽었는데 뭘 만들까', '2번이요', '네 좋아요', '1번 버려요 너무 흔해요', '좋아요 이걸로 해요');
    const folder = newDive(p.dir, 'roguelike', 'game', '인디게임 보고서 읽었는데 뭘 만들까', heard, AT, p.env);
    const left = leftBefore(readDive(folder));
    assert.equal(left.filter((line) => / is open /.test(line)).length, 12);
    assert.match(left.join('\n'), /0 direction\(s\) were shown: the first round shows three/);
    assert.throws(() => closeDive(folder, '좋아요 이걸로 해요', '30초 한 판 덱 빌딩', heard, AT), /is not clear yet:[\s\S]*moment is open/);

    assert.throws(() => setDirection(folder, { id: 'a', name: '로그라이크' }, heard, AT), /a new direction has a name and says what it is/);
    setDirection(folder, { id: 'a', name: '하루 한 판 덱빌딩', what: '출퇴근 지하철에서 한 판 5분, 카드로 싸운다' }, heard, AT);
    setDirection(folder, { id: 'b', name: '협동 요리', what: '친구 둘이 한 화면에서 주문을 쳐낸다' }, heard, AT);
    setDirection(folder, { id: 'c', name: '방치형 정원', what: '하루 두 번 열어 돌보는 느린 게임' }, heard, AT);
    assert.throws(() => setDirection(folder, { id: 'a', status: 'dropped', said: '흔하다고 했다' }, heard, AT), /is not among what the owner said/);
    setDirection(folder, { id: 'a', status: 'dropped', said: '너무 흔해요' }, heard, AT);
    for (const id of linesOf('game')) setDiveLine(folder, id, { status: 'proposed', says: `${id}에 대한 안` }, heard, AT);
    assert.match(leftBefore(readDive(folder)).join('\n'), /lens is only proposed, and the owner has not answered it[\s\S]*no direction was taken by the owner/);
    for (const id of linesOf('game')) setDiveLine(folder, id, { status: 'settled', said: '네 좋아요' }, heard, AT);
    assert.throws(() => closeDive(folder, '좋아요 이걸로 해요', '한 판', heard, AT), /is not clear yet:[\s\S]*no direction was taken/);
    setDirection(folder, { id: 'b', status: 'taken', said: '2번이요' }, heard, AT);
    assert.throws(() => setDirection(folder, { id: 'c', status: 'merged', said: '네 좋아요' }, heard, AT), /says which part of it the owner took/);
    setDirection(folder, { id: 'c', status: 'merged', said: '네 좋아요', note: '하루 두 번 여는 리듬만' }, heard, AT);

    assert.throws(() => closeDive(folder, '', '친구 둘이 한 화면에서 주문을 쳐내는 협동 요리 게임', heard, AT), /the close takes the owner's own words/);
    assert.throws(() => closeDive(folder, '이걸로 확정', '친구 둘이 한 화면에서 주문을 쳐내는 협동 요리 게임', heard, AT), /is not among what the owner said/);
    assert.throws(() => closeDive(folder, '좋아요 이걸로 해요', '', heard, AT), /say the idea in one line/);
    const page = closeDive(folder, '좋아요 이걸로 해요', '친구 둘이 한 화면에서 주문을 쳐내는 협동 요리 게임', heard, AT);
    assert.equal(page, join(folder, 'idea.md'));
    const idea = readFileSync(page, 'utf8');
    assert.match(idea, /^# 친구 둘이 한 화면에서 주문을 쳐내는 협동 요리 게임/);
    assert.match(idea, /씨앗 \(주인의 첫 말, 그대로\): "인디게임 보고서 읽었는데 뭘 만들까"/);
    assert.match(idea, /이 한 장을 보고 주인이 한 말: "좋아요 이걸로 해요"/);
    assert.match(idea, /### 보고서의 공통점 중 정면으로 노리는 것과 버리는 것, 각각의 이유\n\nlens에 대한 안\n\n> 주인: "네 좋아요" \(추천안을 받아들임\)/);
    assert.match(idea, /## 고른 방향\n\n- \*\*협동 요리\*\*: 친구 둘이 한 화면에서 주문을 쳐낸다 \(주인: "2번이요"\)/);
    assert.match(idea, /다른 방향에서 일부만 가져온 것:\n\n- 방치형 정원에서: 하루 두 번 여는 리듬만 \(주인: "네 좋아요"\)/);
    assert.doesNotMatch(idea, /하루 두 번 열어 돌보는 느린 게임/, 'the rest of a merged direction does not reach the page');
    assert.match(idea, /## 버린 방향\n\n- \*\*하루 한 판 덱빌딩\*\*: [^\n]*\(주인: "너무 흔해요"\)\n\n/);
    assert.match(idea, /`\/sz:worth`[\s\S]*`\/sz:build /);
    assert.doesNotMatch(idea, /cp -R/, 'kept with the product, so the next stages find it where they look');
    assert.throws(() => setDiveLine(folder, 'not', { status: 'open' }, heard, AT), /closed at[\s\S]*a closed dive is read, not changed/);
    assert.equal(diveFolder(p.dir, 'roguelike', p.env), folder);
  } finally {
    p.done();
  }
});

test('what the owner said is what the hook kept as typed and what they chose or wrote in a question box, and nothing the session wrote', () => {
  const p = project();
  try {
    const heardDir = join(p.env.SZ_DIVES_DIR!, '.heard');
    mkdirSync(heardDir, { recursive: true });
    const transcript = join(p.dir, 'session.jsonl');
    writeFileSync(
      transcript,
      [
        { type: 'assistant', timestamp: '2026-11-24T01:01:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: '주인님은 지하철 출근길에 정산한다고 하셨죠' }] } },
        { type: 'user', timestamp: '2026-11-24T01:02:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'Your questions have been answered' }] }, toolUseResult: { questions: [{ question: '어디에 붙일까요?', options: [{ label: '카카오톡 안 (Recommended)' }, { label: '따로 서는 앱' }] }, { question: '무엇을 버릴까요?', options: [{ label: '광고' }, { label: '포인트' }] }, { question: '닮고 싶은 것?', options: [{ label: '토스' }] }], answers: { '어디에 붙일까요?': '카카오톡 안 (Recommended)', '무엇을 버릴까요?': '광고, 포인트', '닮고 싶은 것?': '당근의 동네 느낌' }, annotations: { '어디에 붙일까요?': { notes: '근데 카카오가 막으면 따로' } } } },
        { type: 'user', timestamp: '2026-11-24T00:00:00.000Z', toolUseResult: { questions: [], answers: { '예전 질문': '오래전 답' } } },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n'),
    );
    writeFileSync(join(heardDir, 'abc.jsonl'), `${JSON.stringify({ at: '2026-11-24T00:59:00.000Z', session: 'abc', transcript, prompt: '/sz:dive 모임 정산이 귀찮아' })}\n`);
    const heard = heardSince('2026-11-24T00:30:00.000Z', p.env);
    assert.deepEqual(
      heard.map((h) => [h.kind, h.words]),
      [
        ['typed', '/sz:dive 모임 정산이 귀찮아'],
        ['chose', '카카오톡 안 (Recommended)'],
        ['chose', '광고, 포인트'],
        ['wrote', '당근의 동네 느낌'],
        ['note', '근데 카카오가 막으면 따로'],
      ],
    );
    assert.ok(findHeard(heard, '카카오톡 안'));
    assert.equal(findHeard(heard, '지하철 출근길에 정산'), null, 'what the session wrote is not the owner\'s');
    assert.equal(findHeard(heard, ''), null);
    assert.equal(answersIn(join(p.dir, 'none.jsonl')).length, 0);

    // The hook keeps a message only for a session that asked for a dive, or in a folder with a dive open.
    const hook = (prompt: string, session: string, cwd = p.dir): number => spawnSync(process.execPath, [join(ROOT, 'plugin/hooks/heard.mjs')], { input: JSON.stringify({ prompt, session_id: session, cwd, transcript_path: transcript }), env: p.env }).status ?? -1;
    assert.equal(hook('이 버그 고쳐 줘', 's1'), 0);
    assert.equal(existsSync(join(heardDir, 's1.jsonl')), false);
    hook('아이디어 하나 같이 파 보자: 모임 정산', 's2');
    hook('음 그냥 편하게?', 's2');
    assert.deepEqual(readFileSync(join(heardDir, 's2.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).prompt), ['아이디어 하나 같이 파 보자: 모임 정산', '음 그냥 편하게?']);
    hook('<task-notification>\n<task-id>a1</task-id>\n<result>주인은 출근길 정산을 원한다</result>\n</task-notification>', 's2');
    assert.equal(readFileSync(join(heardDir, 's2.jsonl'), 'utf8').trim().split('\n').length, 2, 'what a background agent reports comes in as a message and is not the owner\'s');
    hook('/sz:dive 게임 보고서', 's3');
    assert.ok(existsSync(join(heardDir, 's3.jsonl')));
    const open = mkdtempSync(join(tmpdir(), 'eyes-dive-open-'));
    try {
      newDive(open, 'x', 'plain', '모임 정산이 귀찮아', said('모임 정산이 귀찮아'), AT, p.env);
      hook('2번이요', 's4', open);
      assert.ok(existsSync(join(heardDir, 's4.jsonl')), 'a new session in a folder with a dive open keeps what is said');
    } finally {
      rmSync(open, { recursive: true, force: true });
    }
    assert.equal(spawnSync(process.execPath, [join(ROOT, 'plugin/hooks/heard.mjs')], { input: 'not json', env: p.env }).status, 0);
  } finally {
    p.done();
  }
});

test('a dive started where no product lives is kept under the dives folder, with the day in its name', () => {
  const p = project();
  try {
    assert.deepEqual(diveRoot(p.dir, p.env, '/nowhere'), { root: join(p.dir, '.sz/dive'), durable: false });
    assert.deepEqual(diveRoot(p.dir, p.env, p.dir), { root: p.env.SZ_DIVES_DIR!, durable: true });
    assert.equal(diveRoot(ROOT, p.env).durable, true, 'the harness\'s own repository');
    assert.equal(diveRoot(join(ROOT, 'packages/eyes'), p.env).durable, true);
    const folder = newDive(p.dir, 'from-home', 'plain', '모임 정산이 귀찮아', said('모임 정산이 귀찮아'), AT, p.env, p.dir);
    assert.equal(folder, join(p.env.SZ_DIVES_DIR!, '2026-11-24-from-home'));
    assert.equal(diveFolder(p.dir, 'from-home', p.env, p.dir), folder);
    assert.match(ideaPage({ ...readDive(folder), summary: '모임 정산' }, folder, p.env), /mkdir -p \.sz\/dive && cp -R/);
  } finally {
    p.done();
  }
});

test('words from a report are looked for in the file, and a quotation not there is kept as not seen', () => {
  const p = project();
  try {
    const folder = newDive(p.dir, 'report', 'game', '보고서 읽었어', said('보고서 읽었어'), AT, p.env);
    const report = join(p.dir, 'report.md');
    writeFileSync(report, '— 3쪽 —\n성공한 게임 40개를 골라\n공통점을 뽑았다.');
    const found = seeInFile(report, '성공한 게임 40개를 골라 공통점을', null, AT);
    assert.match(found.seen?.excerpt ?? '', /40개/);
    assert.equal(addSaw(folder, { line: 'lens', url: null, file: report, page: 3, quote: '성공한 게임 40개를 골라 공통점을', shows: '성공한 게임만 봤다: 생존자 편향', }, found).id, 's1');
    const missing = seeInFile(report, '실패한 게임과 비교했다', null, AT);
    assert.equal(missing.seen, null);
    assert.match(missing.why ?? '', /not in/);
    assert.equal(addSaw(folder, { line: null, url: null, file: report, page: null, quote: '실패한 게임과 비교했다', shows: '비교군' }, missing).failed, missing.why);
    assert.match(seeInFile(join(p.dir, 'none.pdf'), 'x', 1, AT).why ?? '', /there is no file/);
    assert.throws(() => addSaw(folder, { line: 'pain', url: null, file: report, page: null, quote: '성공한 게임', shows: '없음' }, found), /pain is not a line of a game dive/);
  } finally {
    p.done();
  }
});

test('the command line holds a dive to the same rules, with the owner\'s words from the hook', () => {
  const p = project();
  try {
    const heardDir = join(p.env.SZ_DIVES_DIR!, '.heard');
    mkdirSync(heardDir, { recursive: true });
    const now = new Date().toISOString();
    writeFileSync(join(heardDir, 'cli.jsonl'), ['/sz:dive 출근길에 할 게임', '네', '좋아요 이걸로'].map((prompt) => JSON.stringify({ at: now, session: 'cli', transcript: null, prompt })).join('\n'));
    const eyes = (...args: string[]) => spawnSync(process.execPath, [CLI, 'dive', ...args], { cwd: p.dir, env: p.env, encoding: 'utf8' });
    const made = eyes('new', 'commute', '--kind', 'plain', '--seed', '출근길에 할 게임');
    assert.equal(made.status, 0, made.stderr);
    assert.match(made.stdout, /\.sz\/dive\/commute\n명확해진 줄 0\/8/);
    const forged = eyes('line', 'commute', 'core', '--status', 'settled', '--says', '지하철 한 정거장에 한 판', '--said', '한 정거장에 한 판이면 좋겠다');
    assert.equal(forged.status, 1);
    assert.match(forged.stderr, /is not among what the owner said/);
    assert.equal(eyes('line', 'commute', 'core', '--status', 'proposed', '--says', '지하철 한 정거장에 한 판').status, 0);
    const settled = eyes('line', 'commute', 'core', '--status', 'settled', '--said', '네');
    assert.match(settled.stdout, /core: settled \(the proposal, taken as it stood\)\n명확해진 줄 1\/8/);
    const early = eyes('close', 'commute', '--summary', '출근길 한 정거장 게임', '--said', '좋아요 이걸로');
    assert.equal(early.status, 1);
    assert.match(early.stderr, /not clear yet/);
    assert.match(eyes('page', 'commute', '--summary', '출근길 한 정거장 게임').stdout, /^# 출근길 한 정거장 게임\n[\s\S]*### 그 한 가지[^\n]*\n\n지하철 한 정거장에 한 판\n\n> 주인: "네" \(추천안을 받아들임\)/);
    const show = eyes('show', 'commute');
    assert.match(show.stdout, /seed: "출근길에 할 게임"\n {2}명확해진 줄 1\/8/);
    assert.match(eyes('show').stdout, /commute: 명확해진 줄 1\/8/);
    assert.equal(eyes('line', 'commute', 'pain', '--status', 'proposed', '--says', '앱 줄').status, 1);
  } finally {
    p.done();
  }
});

const briefHeard = said('출근길에 한 판', '둘이서 해요', '지하철에서   해요', '좋아요 이걸로 해요', '네, 이대로');
const briefDraft = (kind: DiveKind) => BRIEF_SECTIONS[kind].join('\n결정한 내용\n\n') + '\n결정한 내용\n';

function closeForBrief(projectDir: string, kind: DiveKind): string {
  const folder = newDive(projectDir, 'commute', kind, '출근길에 한 판', briefHeard, AT);
  for (const id of ['a', 'b', 'c']) setDirection(folder, { id, name: id, what: '출근길 지하철에서 한 판' }, briefHeard, AT);
  setDirection(folder, { id: 'a', status: 'taken', said: '둘이서 해요' }, briefHeard, AT);
  for (const id of linesOf(kind)) setDiveLine(folder, id, { status: 'settled', says: '출근길에 함께 한 판', said: '지하철에서   해요' }, briefHeard, AT);
  closeDive(folder, '좋아요 이걸로 해요', '출근길에 함께 하는 한 판', briefHeard, AT);
  return folder;
}

test('a brief is written only after the owner closes the dive', (t) => {
  const p = project();
  t.after(p.done);
  const folder = newDive(p.dir, 'commute', 'plain', '출근길에 한 판', briefHeard, AT);
  assert.throws(() => writeBrief(folder, briefDraft('plain'), '네, 이대로', briefHeard, AT), /the brief is written after the dive closes: sz-eyes dive close commute/);
  assert.equal(existsSync(join(folder, 'brief.md')), false);
});

test('a brief names a missing or misplaced heading for this kind of dive', (t) => {
  const p = project();
  t.after(p.done);
  const folder = closeForBrief(p.dir, 'game');
  const draft = briefDraft('game');
  assert.throws(() => writeBrief(folder, draft.replace('## 비워 둘 것', '~~~\n## 비워 둘 것\n~~~'), '네, 이대로', briefHeard, AT), /missing.*## 비워 둘 것/);
  assert.throws(() => writeBrief(folder, draft.replace('## 코어 동사', '').concat('\n## 코어 동사\n'), '네, 이대로', briefHeard, AT), /order.*## 시간축 루프/);
  assert.throws(() => writeBrief(folder, briefDraft('app'), '네, 이대로', briefHeard, AT), /missing.*## 북극성과 손맛/);
});

test('putting the brief off keeps the draft for another day, even when those words were heard', (t) => {
  const p = project();
  t.after(p.done);
  const folder = closeForBrief(p.dir, 'plain');
  for (const defer of ['나중에', ' 아직 ', '보류', 'later', 'not now']) {
    assert.throws(() => writeBrief(folder, briefDraft('plain'), defer, said(defer), AT), /the brief is written on their yes to this page, not on their 'not now'/);
  }
  assert.equal(existsSync(join(folder, BRIEF_FILE)), false);
});

test('the confirmation must be heard, and every owner quotation must occur in one answer kept by this dive', (t) => {
  const p = project();
  t.after(p.done);
  const folder = closeForBrief(p.dir, 'app');
  const draft = briefDraft('app');
  assert.throws(() => writeBrief(folder, draft, '', briefHeard, AT), /the brief takes the owner's own words/);
  assert.throws(() => writeBrief(folder, draft, '완전 최고예요', briefHeard, AT), /is not among what the owner said/);
  for (const fake of ['주인: "출근길에 함께 한 판"', '> 주인: "네, 이대로"']) {
    assert.throws(() => writeBrief(folder, draft + fake, '네, 이대로', briefHeard, AT), /is quoted as the owner's, and they did not say it/);
  }
  const quotes = ['출근길에 한 판', '둘이서 해요', '지하철에서 해요'.normalize('NFD'), '좋아요 이걸로'].map((quote) => '> 주인: "' + quote + '"');
  const page = draft + quotes.join('\n');
  assert.equal(readFileSync(writeBrief(folder, page, '네, 이대로', briefHeard, AT), 'utf8'), page);
});

test('the command prints the brief beside idea.md and a second write needs --force', (t) => {
  const p = project();
  t.after(p.done);
  const folder = closeForBrief(p.dir, 'plain');
  const heardDir = join(p.env.SZ_DIVES_DIR!, '.heard');
  mkdirSync(heardDir, { recursive: true });
  writeFileSync(join(heardDir, 'cli.jsonl'), JSON.stringify({ at: AT, prompt: '네, 이대로' }));
  const eyes = (...args: string[]) => spawnSync(process.execPath, [CLI, 'dive', ...args, '--dir', p.dir], { env: p.env, encoding: 'utf8' });
  assert.match(eyes('brief', 'commute').stdout, /no brief/);
  const draft = briefDraft('plain');
  const source = join(p.dir, 'draft.md');
  writeFileSync(source, draft);
  const keep = (...flags: string[]) => eyes('brief', 'commute', '--file', source, '--said', '네, 이대로', ...flags);
  const first = keep();
  const path = join(folder, 'brief.md');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.trim(), path);
  assert.ok(existsSync(join(folder, 'idea.md')));
  assert.equal(readFileSync(path, 'utf8'), draft);
  assert.equal(eyes('brief', 'commute').stdout, draft);
  assert.ok(eyes('show', 'commute').stdout.includes('brief: ' + path));
  writeFileSync(source, draft + '수정\n');
  const refused = keep();
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /--force/);
  assert.equal(readFileSync(path, 'utf8'), draft);
  const replaced = keep('--force');
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(readFileSync(path, 'utf8'), draft + '수정\n');
});

test('the dive skill gives the complete brief for each kind and takes the owner through one approval question', () => {
  const skill = readFileSync(join(ROOT, 'plugin/skills/dive/SKILL.md'), 'utf8');
  const section = skill.slice(skill.indexOf('## 6.'), skill.indexOf('## Pausing and coming back'));
  for (const [kind, headings] of Object.entries(BRIEF_SECTIONS)) {
    const line = section.split('\n').find((line) => line.startsWith('- ' + kind + ':'));
    assert.deepEqual(line?.match(/## [^`]+/g), headings, kind);
  }
  assert.match(section, /네, 이대로[\s\S]*고칠 게 있어요[\s\S]*나중에/);
  assert.match(section, /나중에\*\*: keep only the draft and stop/);
  assert.match(section, /sz-eyes dive brief <id> --file "<folder printed by dive show>\/brief.draft.md" --said/);
});

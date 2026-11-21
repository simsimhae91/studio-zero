import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CiteError, findQuote, publicUrl } from '../src/cite.ts';
import { addAsk, addCite, addObjection, allCases, answerObjection, casePage, casesPage, depthOf, hearAsk, newCase, readCase, renderCase, setCall, removeOther, setLine, setOther, setRow, standingOf, unanswered, weighCite, withdrawCite } from '../src/worth.ts';

const AT = '2026-11-16T03:00:00.000Z';
const seen = (excerpt: string) => ({ seen: { at: AT, by: 'fetch' as const, excerpt, title: 'a page', shot: null }, why: null });
const lost = { seen: null, why: 'the page was read and these words are not on it' };

test('words are looked for on a page as a person would read it, and only pages out in the world are evidence', () => {
  // Spacing, tags, quotes and capitals are not held against a page; other words are.
  assert.match(findQuote('<p>가격 은 월\n 4,900 원 입니다</p>'.replace(/<[^>]+>/g, ' '), '가격은 월 4,900원') ?? '', /4,900/);
  assert.match(findQuote('Rated “Too Expensive” by 1,204 people', 'rated "too expensive" by 1,204 people') ?? '', /Too Expensive/);
  assert.equal(findQuote('리뷰 1,204개', '리뷰 9,999개'), null);
  assert.equal(findQuote('아무 글', ''), null);
  const long = `${'가'.repeat(400)} 구독료가 너무 비싸요 ${'나'.repeat(400)}`;
  const excerpt = findQuote(long, '구독료가 너무 비싸요')!;
  assert.ok(excerpt.length < 420 && excerpt.startsWith('… ') && excerpt.endsWith(' …'), 'what stands around the words, not the whole page');
  for (const bad of ['http://127.0.0.1:3000/x', 'http://localhost/x', 'http://192.168.0.4/', 'file:///etc/hosts', 'not an address', 'http://10.0.0.1/']) assert.throws(() => publicUrl(bad), CiteError, bad);
  assert.equal(publicUrl('https://apps.apple.com/kr/app/id1').hostname, 'apps.apple.com');
});

test('a line about the world is shown by quotations that were found on their pages, from more than one voice, and by nothing else', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-worth-'));
  try {
    const folder = newCase(project, 'ledger', '경조사를 챙기는 30대가 봉투를 낼 때 전에 받은 금액을 바로 본다', '주인이 준 생각', AT);
    assert.throws(() => newCase(project, 'ledger', '같은 이름으로 또 만든다고 한다', '', AT), /already a case/);
    assert.equal(standingOf(readCase(folder)), 'thin');

    // Said is not shown: with no quotation, with quotations that were not found, with one voice only.
    assert.throws(() => setLine(folder, 'gap', { says: '엑셀로 적다가 폰에서 못 찾는다', status: 'shown' }, AT), /gap is not shown yet: it needs five complaints by different people/);
    addCite(folder, { line: 'gap', url: 'https://a.example/1', quote: '엑셀이라 폰에서 못 찾아요', shows: '찾기 불편', against: false, by: 'scout' }, lost);
    addCite(folder, { line: 'gap', url: 'https://a.example/2', quote: '누가 얼마 냈는지 기억이 안 나요', shows: '기억 못 함', against: false, by: 'scout' }, lost);
    addCite(folder, { line: 'gap', url: 'https://a.example/3', quote: '결혼식마다 장부를 뒤져요', shows: '뒤짐', against: false, by: 'scout' }, lost);
    assert.throws(() => setLine(folder, 'gap', { status: 'shown' }, AT), /Counting so far: 0 quotation\(s\) from 0 site\(s\); 3 not found on their page do not count/);
    for (const n of [1, 2, 3]) addCite(folder, { line: 'gap', url: `https://a.example/${n}`, quote: ['엑셀이라 폰에서 못 찾아요', '누가 얼마 냈는지 기억이 안 나요', '결혼식마다 장부를 뒤져요'][n - 1]!, shows: '불편', against: false, by: 'scout' }, seen('…'));
    assert.equal(readCase(folder).cites.length, 3, 'the same words from the same page are one quotation, looked for again');
    assert.throws(() => setLine(folder, 'gap', { status: 'shown' }, AT), /3 quotation\(s\) from 1 site\(s\)/);
    addCite(folder, { line: 'gap', url: 'https://www.b.example/x', quote: '메모장에 적어둔 걸 잃어버렸어요', shows: '잃어버림', against: false, by: 'scout' }, seen('…'));
    assert.throws(() => setLine(folder, 'gap', { status: 'shown' }, AT), /4 quotation\(s\) from 2 site\(s\)/);
    const fifth = addCite(folder, { line: 'gap', url: 'https://b.example/y', quote: '작년 것은 다른 파일에 있어요', shows: '흩어짐', against: false, by: 'scout' }, seen('…'));
    assert.equal(setLine(folder, 'gap', { status: 'shown' }, AT).basis, 'world');
    // Found on the page is not the same as supporting the line: whoever did not file it reads it there.
    assert.match(unanswered(readCase(folder)).join('\n'), /gap: c1, c2, c3, c4, c5 were found on their pages and nobody but whoever filed them has read them there/);
    assert.throws(() => weighCite(folder, fifth.id, false, '', AT), /say why it does not support its line/);
    weighCite(folder, fifth.id, false, '가계부 이야기지 경조사 장부 이야기가 아니다', AT);
    assert.match(unanswered(readCase(folder)).join('\n'), /gap was called shown and its ground no longer carries it:[\s\S]*4 quotation\(s\) from 2 site\(s\); 1 were read and judged not to support it/);
    weighCite(folder, fifth.id, true, '', AT);
    // A quotation against a line does not count for it.
    addCite(folder, { line: 'pays', url: 'https://c.example/free', quote: '무료 앱으로 충분합니다', shows: '무료로 충분', against: true, by: 'skeptic' }, seen('…'));
    addCite(folder, { line: 'pays', url: 'https://c.example/paid', quote: '프리미엄 월 2,900원 · 리뷰 1.2만', shows: '유료, 리뷰 1.2만', against: false, by: 'scout' }, seen('…'));
    assert.throws(() => setLine(folder, 'pays', { says: '이미 돈을 낸다', status: 'shown' }, AT), /1 quotation\(s\) from 1 site\(s\)/);

    // Grounds are not passed off as one another.
    assert.throws(() => setLine(folder, 'paid', { says: '대역 셋이 낸다고 했다', status: 'shown', basis: 'stand-in', note: '대역 셋 모두 낸다고 함' }, AT), /paid is shown only by real money/);
    assert.throws(() => setLine(folder, 'pays', { status: 'shown', basis: 'stand-in', note: '대역이 낼 것 같다고 함' }, AT), /stand-ins find where a person is stopped; they do not show pays/);
    assert.equal(setLine(folder, 'does', { says: '셋 중 셋이 전에 받은 금액을 찾았다', status: 'shown', basis: 'stand-in', note: '써 보기 2026-11-16-1' }, AT).basis, 'stand-in');
    assert.throws(() => setLine(folder, 'reach', { says: '내 카페 회원 3만', status: 'shown', basis: 'owner' }, AT), /the owner's ground is their own words/);
    assert.equal(setLine(folder, 'reach', { status: 'shown', basis: 'owner', note: '주인: "결혼 준비 카페 운영진임, 공지 가능"' }, AT).status, 'shown');
    assert.throws(() => setLine(folder, 'who', { status: 'waived', note: '몰라' }, AT), /waived with a reason the owner reads/);
    assert.throws(() => setLine(folder, 'edge', { says: '이름을 치면 바로 나온다', status: 'shown' }, AT), /say what edge stands on/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('a quotation its filer takes back counts for nothing, for a line or against it, and stays where the owner reads it', () => {
  // 2026-11-21, a hunt: scouts filed a quotation under the wrong side or with a wrong count, saw it afterwards,
  // and could only file another beside it. The wrong one went on counting.
  const project = mkdtempSync(join(tmpdir(), 'eyes-worth-'));
  try {
    const folder = newCase(project, 'typing', '학원 강사가 시험지 사진을 수식이 살아 있는 한글 파일로 바꿀 때', '탐색', AT);
    for (const n of [1, 2, 3]) addCite(folder, { line: 'pays', url: `https://kmong.example/gig/${n}`, quote: `5,000원부터 | ${n}00건 판매`, shows: '판매 건수', against: false, by: 'scout' }, seen('…'));
    const slip = addCite(folder, { line: 'pays', url: 'https://tool.example/price', quote: '문제당 425원', shows: '손으로 치는 것보다 비싸다', against: true, by: 'scout' }, seen('…'));
    assert.throws(() => withdrawCite(folder, 'c99', '없는 것', AT), /no quotation c99/);
    assert.throws(() => withdrawCite(folder, slip.id, '', AT), /say what was wrong with it/);
    // An against quotation is ground enough to call a line refuted; one taken back is not.
    withdrawCite(folder, slip.id, '반대 증거가 아니다: 값을 보일 뿐이다', AT);
    assert.throws(() => setLine(folder, 'pays', { status: 'refuted' }, AT), /say what refutes it/);
    assert.equal(setLine(folder, 'pays', { says: '손으로 치는 일이 팔린다', status: 'shown' }, AT).status, 'shown');
    // One that counted for the line stops counting, and the line says so.
    withdrawCite(folder, 'c3', '다른 일을 파는 페이지였다', AT);
    assert.match(unanswered(readCase(folder)).join('\n'), /pays was called shown and its ground no longer carries it:[\s\S]*2 quotation\(s\) from 1 site\(s\); 1 taken back by whoever filed them/);
    assert.match(renderCase(readCase(folder), folder), /c3 seen TAKEN BACK \(다른 일을 파는 페이지였다\)/);
    assert.match(casePage(readCase(folder), folder), /낸 쪽이 거두어들임: 세지 않음<\/b> \(다른 일을 파는 페이지였다\)/);
    // Filed again as it should have been, it is a quotation again.
    addCite(folder, { line: 'pays', url: 'https://kmong.example/gig/3', quote: '5,000원부터 | 300건 판매', shows: '판매 건수', against: false, by: 'scout' }, seen('…'));
    assert.equal(readCase(folder).cites.find((c) => c.id === 'c3')!.withdrawn, null);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('a crowded job has more than twelve things people use instead, and one named by mistake can be taken out', () => {
  // 2026-11-21: twelve converters were named, the thirteenth was refused, and a scout wrote it over another's id.
  const project = mkdtempSync(join(tmpdir(), 'eyes-worth-'));
  try {
    const folder = newCase(project, 'typing', '학원 강사가 시험지 사진을 수식이 살아 있는 한글 파일로 바꿀 때', '탐색', AT);
    for (let n = 1; n <= 20; n++) setOther(folder, { id: `tool-${n}`, name: `변환기 ${n}`, url: '', kind: 'product', price: '문제당 200원', sign: '', cites: [] });
    assert.equal(readCase(folder).others.length, 20);
    setOther(folder, { id: 'by-hand', name: '조교가 직접 친다', url: '', kind: 'workaround', price: '', sign: '', cites: [] });
    setRow(folder, { id: 'equations', where: '하기', need: '수식이 한글 수식으로 들어간다', kind: 'stake', has: { 'tool-1': 'yes', 'tool-2': 'yes', 'by-hand': 'yes' } }, () => false);
    assert.throws(() => removeOther(folder, 'tool-99'), /no such thing in the reference class: "tool-99"/);
    removeOther(folder, 'tool-2');
    const after = readCase(folder);
    assert.equal(after.others.some((o) => o.id === 'tool-2'), false);
    assert.deepEqual(Object.keys(after.rows[0]!.has).sort(), ['by-hand', 'tool-1'], 'a row no longer names what was taken out');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('how deep a product has to be is read off what people already use, and "have" is shown, not said', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-worth-depth-'));
  try {
    const folder = newCase(project, 'ledger', '경조사를 챙기는 30대가 봉투를 낼 때 전에 받은 금액을 바로 본다', '', AT);
    const stands = (key: string): boolean => key === 'm1-ledger/lookup';
    assert.throws(() => setRow(folder, { id: 'search', where: '하기', need: '이름으로 찾기', kind: 'stake', has: { excel: 'yes' } }, stands), /no such thing in the reference class: "excel"/);
    setOther(folder, { id: 'excel', name: '엑셀 장부', url: '', kind: 'workaround', price: '무료', sign: '', cites: [] });
    setOther(folder, { id: 'app-a', name: '경조사 앱 A', url: 'https://apps.apple.com/kr/app/id1', kind: 'product', price: '광고 제거 3,300원', sign: '평가 4천 개', cites: [] });
    assert.throws(() => setRow(folder, { id: 'search', where: '하기', need: '이름으로 찾기', kind: 'stake', has: { excel: 'yes', 'app-a': 'no' } }, stands), /called a stake, and 1 of the things people use have it/);
    setRow(folder, { id: 'search', where: '하기', need: '이름으로 찾기', kind: 'stake', has: { excel: 'yes', 'app-a': 'yes' } }, stands);
    setRow(folder, { id: 'export', where: '믿음', need: '내 기록을 파일로 내려받기', kind: 'stake', has: { excel: 'yes', 'app-a': 'yes' } }, stands);
    setRow(folder, { id: 'suggest', where: '하기', need: '이번에 낼 금액을 알려 준다', kind: 'edge', has: { excel: 'no', 'app-a': 'no' } }, stands);
    assert.throws(() => setRow(folder, { id: 'search', ours: 'have' }, stands), /"have" is shown, not said/);
    assert.throws(() => setRow(folder, { id: 'search', ours: 'have', by: 'm9-nope/x' }, stands), /neither a claim that stands in this project nor a file/);
    assert.equal(setRow(folder, { id: 'search', ours: 'have', by: 'm1-ledger/lookup' }, stands).ours, 'have');
    mkdirSync(join(folder, 'looks'), { recursive: true });
    writeFileSync(join(folder, 'looks/suggest.png'), 'png');
    assert.equal(setRow(folder, { id: 'suggest', ours: 'have', by: 'looks/suggest.png' }, stands).ours, 'have');
    assert.throws(() => setRow(folder, { id: 'export', ours: 'not-doing', by: '귀찮음' }, stands), /"not-doing" carries the reason the owner reads/);
    setRow(folder, { id: 'export', ours: 'lack' }, stands);
    // What has to be there whoever else has it needs no count of the others; what is there on one screen and no further is thin.
    setRow(folder, { id: 'delete-account', where: '믿음', need: '계정과 내 기록을 앱 안에서 지운다', kind: 'must' }, stands);
    setRow(folder, { id: 'history', where: '다시 올 때', need: '사람마다 주고받은 내역이 쌓여 보인다', kind: 'stake', has: { excel: 'yes', 'app-a': 'yes' } }, stands);
    assert.throws(() => setRow(folder, { id: 'history', ours: 'thin' }, stands), /"thin" says what it lacks/);
    setRow(folder, { id: 'history', ours: 'thin', by: '목록만 있고 고치거나 지울 수 없다' }, stands);
    const depth = depthOf(readCase(folder));
    assert.deepEqual([depth.stakes, depth.have, depth.thin.map((r) => r.id), depth.lack.map((r) => r.id), depth.unknown.map((r) => r.id), depth.edge.map((r) => r.id)], [4, 1, ['history'], ['export'], ['delete-account'], ['suggest']]);
    assert.match(casePage(readCase(folder), folder), /기본기\) 4개 중:[\s\S]*있음 1[\s\S]*얕음 1 · 없음 1[\s\S]*<th>엑셀 장부<\/th><th>경조사 앱 A<\/th><th>우리 것<\/th>[\s\S]*어디에나 있어야 함/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('a case stands as "go" only when the world is shown, the design is said, someone tried to knock it down, and what only people can answer is written', () => {
  const project = mkdtempSync(join(tmpdir(), 'eyes-worth-go-'));
  try {
    const folder = newCase(project, 'ledger', '경조사를 챙기는 30대가 봉투를 낼 때 전에 받은 금액을 바로 본다', '', AT);
    const hosts = ['a.example', 'b.example', 'c.example'];
    for (const line of ['who', 'now', 'pays', 'gap', 'switch', 'reach', 'price'] as const) {
      for (const n of [0, 1]) hosts.forEach((host, i) => addCite(folder, { line, url: `https://${host}/${line}/${n}${i}`, quote: `${line}에 대한 진짜 문장 ${n}${i}`, shows: '보임', against: false, by: 'scout' }, seen('…')));
      setLine(folder, line, { says: `${line}에 대한 주장이다`, status: 'shown' }, AT);
    }
    assert.match(unanswered(readCase(folder)).join('\n'), /nobody but whoever filed them has read them there/);
    for (const cite of readCase(folder).cites) weighCite(folder, cite.id, true, '', AT);
    setLine(folder, 'edge', { says: '이름을 치면 이번에 낼 금액이 바로 나온다' }, AT);
    setLine(folder, 'runs', { says: '서버 월 5달러, 사람당 비용 0에 가깝다. 금융 인허가 없음' }, AT);
    assert.match(unanswered(readCase(folder)).join('\n'), /fewer than two things a person would use instead[\s\S]*no row says what a person assumes[\s\S]*no row is the edge[\s\S]*nobody has tried to knock the case down[\s\S]*only real people can answer/);
    setOther(folder, { id: 'excel', name: '엑셀', url: '', kind: 'workaround', price: '무료', sign: '', cites: [] });
    setOther(folder, { id: 'app-a', name: '앱 A', url: '', kind: 'product', price: '3,300원', sign: '평가 4천', cites: ['c1'] });
    const none = (): boolean => false;
    setRow(folder, { id: 'search', where: '하기', need: '이름으로 찾기', kind: 'stake', has: { excel: 'yes', 'app-a': 'yes' } }, none);
    setRow(folder, { id: 'suggest', where: '하기', need: '이번에 낼 금액', kind: 'edge', has: { excel: 'no', 'app-a': 'no' } }, none);
    assert.throws(() => addAsk(folder, '값을 보고도 연락처를 남기는가', '값을 적은 페이지', { sample: 300, goAt: 2, noAt: 3.8 }), /the share that means no is below the share that means go/);
    assert.equal(addAsk(folder, '값을 보고도 연락처를 남기는가', '월 2,900원을 적은 페이지, 찬 방문 300', { sample: 300, goAt: 3.8, noAt: 2 }), 1);
    assert.throws(() => setCall(folder, { call: 'go', why: '세상의 줄이 다 보였으므로 짓자', at: AT }), /not "go" yet:[\s\S]*nobody has tried to knock the case down/);

    // The skeptic's objections: a serious one must be answered; a fatal one that is granted refutes its line.
    assert.equal(addObjection(folder, { about: 'pays', text: '유료 결제의 표시가 리뷰 수뿐이다: 무료 사용자의 리뷰일 수 있다', weight: 'serious', cites: [], answer: null, conceded: false }), 1);
    assert.equal(standingOf(readCase(folder)), 'thin');
    assert.throws(() => answerObjection(folder, 1, '아님', AT), /an answer says what is wrong with the objection/);
    answerObjection(folder, 1, '앱 A의 인앱 결제 목록에 광고 제거 3,300원이 있고 매출 순위 재무 40위다 (c3)', AT);
    assert.equal(standingOf(readCase(folder)), 'case');
    setCall(folder, { call: 'go', why: '돈이 오가는 일이고 틈이 인용으로 보였다. 팔리는지는 사전 신청으로 묻는다', at: AT });
    assert.match(renderCase(readCase(folder), folder), /^case ledger \(.*\): case[\s\S]*call: go/);
    addObjection(folder, { about: 'reach', text: '카페는 홍보 글을 지운다: 만날 곳이 없다', weight: 'fatal', cites: [], answer: null, conceded: false });
    assert.equal(standingOf(readCase(folder)), 'thin');
    answerObjection(folder, 2, null, AT);
    const after = readCase(folder);
    assert.deepEqual([standingOf(after), after.lines.reach.status], ['no', 'refuted']);
    assert.match(after.lines.reach.note, /반박을 받아들임: 카페는 홍보 글을 지운다/);

    // Side by side: what there is ground to build first, what was dropped and why.
    newCase(project, 'water', '물을 덜 마시는 직장인이 하루 잔 수를 센다', '시험용', AT);
    const page = casesPage(allCases(project));
    assert.match(page, /지을 근거가 있는 것 0개, 버린 것 1개[\s\S]*근거가 모자란다[\s\S]*물을 덜 마시는[\s\S]*짓지 않는다[\s\S]*경조사를 챙기는/);
    assert.match(casePage(after, folder), /짓지 않는다[\s\S]*그 페이지에서 확인[\s\S]*쓴 쪽이 아닌 이가 읽음: 이 줄을 받친다[\s\S]*치명적[\s\S]*받아들임[\s\S]*가장 싸게 묻는 법[\s\S]*300명 이상에게 물어 3.8% 이상이면 간다/);
    // A dropped case shows what killed it and what was seen, whichever line that was: half of what a hunt is for.
    // (2026-11-21: 36 dropped cases side by side, most killed on a design line, each showing six times "아직".)
    const dead = newCase(project, 'baby', '두 부모가 서로 다른 휴대폰에서 수유를 같이 적는 앱', '앱스토어 터', AT);
    setLine(dead, 'edge', { status: 'refuted', note: '거의 공짜인 앱이 이미 다른 기종 사이 공유를 한다. 돈은 움직인다: 평생 28,000원' }, AT);
    setCall(dead, { call: 'no', why: '돈 내는 앱이 못 하는 것을 공짜 앱이 이미 한다', at: AT });
    const side = casesPage(allCases(project));
    assert.match(side, /두 부모가[\s\S]*돈 내는 앱이 못 하는 것을 공짜 앱이 이미 한다[\s\S]*<b>걸린 줄: 더 잘하는 한 가지<\/b> 거의 공짜인 앱이 이미 다른 기종 사이 공유를 한다. 돈은 움직인다: 평생 28,000원[\s\S]*앱스토어 터/);
    assert.match(side, /누가: 아직 · 지금 쓰는 것: 아직 · 돈: 아직 · 실망: 아직 · 갈아탐: 아직 · 만남: 아직/, 'each line by a short name of its own, none cut in the middle of a word');
    assert.match(side, /경조사를 챙기는[\s\S]*<b>걸린 줄: 만남<\/b> 반박을 받아들임: 카페는 홍보 글을 지운다/);

    // What real people did is read by what was written before they were asked, and by nothing kinder.
    const folder2 = newCase(project, 'asked', '값을 본 사람이 연락처를 남기는지 묻는 시험', '', AT);
    addAsk(folder2, '이 일로 돈을 낸 적이 있는가', '다섯 명과 통화');
    assert.throws(() => hearAsk(folder2, 1, 5, 3, '', AT), /asked without saying what answer would mean what/);
    addAsk(folder2, '값을 보고도 연락처를 남기는가', '값을 적은 페이지', { sample: 300, goAt: 3.8, noAt: 2 });
    assert.equal(hearAsk(folder2, 2, 74, 9, '방문이 모자람', AT).reading, 'cannot tell', 'too few were asked, whatever the share');
    assert.match(casePage(readCase(folder2), folder2), /74명 중 9명: 아직 알 수 없다/);
    assert.equal(hearAsk(folder2, 2, 320, 9, '', AT).reading, 'cannot tell', 'between the two bars');
    assert.equal(hearAsk(folder2, 2, 320, 14, '네이버 광고 유입만', AT).reading, 'go');
    assert.match(casePage(readCase(folder2), folder2), /320명 중 14명 \(4.4%\): 간다/);
    assert.equal(hearAsk(folder2, 2, 320, 5, '', AT).reading, 'no');
    assert.equal(standingOf(readCase(folder2)), 'no', 'people were asked and said no');
    assert.throws(() => hearAsk(folder2, 2, 3, 5, '', AT), /more did it than were asked/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

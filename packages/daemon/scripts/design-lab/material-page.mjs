// The design lab's page for the "material" round: the owner's references, and each direction drawn under every
// kind of guidance tried (the old one, the first handbook, the product as it now draws, and the experiment the
// owner chose from), all measured by refs.mjs.
//
//   node material-page.mjs <labDir>
//   reads  <labDir>/refs/material.json, <labDir>/refs/<name>.png, <labDir>/metrics/<arm>-<brief>-<row>-desktop.png
//   writes <labDir>/material/index.html, shots/*.png, files.json (what to publish beside the page)
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const lab = process.argv[2];
const out = join(lab, 'material');
mkdirSync(join(out, 'shots'), { recursive: true });
const m = JSON.parse(readFileSync(join(lab, 'refs', 'material.json'), 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const published = new Map();
const shot = (name) => { copyFileSync(join(lab, 'refs', `${name}.png`), join(out, 'shots', `${name}.png`)); published.set(`shots/${name}.png`, join(out, 'shots', `${name}.png`)); return `shots/${name}.png`; };
const desk = (arm, brief, row) => { const name = `web-${arm}-${brief}-${row}.png`; copyFileSync(join(lab, 'metrics', `${arm}-${brief}-${row}-desktop.png`), join(out, 'shots', name)); published.set(`shots/${name}`, join(out, 'shots', name)); return `shots/${name}`; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

const REFS = [['chzzk', '치지직'], ['naver-shopping', '네이버쇼핑'], ['daangn', '당근'], ['nintendo-kr', '닌텐도'], ['nintendo-store', '닌텐도 스토어']];
// The diet duel's direction c (a bathroom-scale dial as the whole screen) is left out: the owner called it a
// direction that did not fit from the start, so no drawing of it is a measure of the guidance.
const ROWS = [['dues', 'a', '모임 회비 장부 · 방향 a'], ['dues', 'b', '모임 회비 장부 · 방향 b'], ['duel', 'a', '다이어트 결투 · 방향 a'], ['duel', 'b', '다이어트 결투 · 방향 b']];
const WEB = [['quote', 'a', '견적 링크 (웹 페이지) · 방향 a'], ['quote', 'b', '견적 링크 (웹 페이지) · 방향 b'], ['orders', 'a', '출고 장부 (웹 앱) · 방향 a'], ['orders', 'b', '출고 장부 (웹 앱) · 방향 b']];
const webDone = WEB.every(([b, r]) => existsSync(join(lab, 'metrics', `handbook4-${b}-${r}-desktop.png`)));
const ARMS = {
  refs: REFS.map(([n]) => n),
  before: ROWS.map(([b, r]) => `ours-${b}-${r}-before`),
  after: ROWS.map(([b, r]) => `ours-${b}-${r}-after`),
  product: ROWS.map(([b, r]) => `hb4-${b}-${r}`),
  bolted: ROWS.map(([b, r]) => `material-${b}-${r}`),
};
const COLUMNS = [['refs', '레퍼런스 5곳'], ['before', '전 (옛 지침)'], ['after', '후 (첫 핸드북)'], ['bolted', '덧붙임 실험'], ['product', '지금의 제품']];

const MEASURES = [
  ['colourPct', '강한 색', '%', '채도가 높은 픽셀.'],
  ['greyPct', '무채색', '%', '흰색, 검정, 회색 픽셀.'],
  ['icons', '아이콘', '개', '12~56px 크기의 그림 수. 아바타도 여기에 든다.'],
  ['picturePct', '그림', '%', '사진, 영상, 64px 넘게 그린 그림이 덮은 면. 차트도 여기에 든다.'],
  ['textPct', '글자', '%', '글자 상자가 덮은 면.'],
];
const fmt = (v, unit) => `${Math.round(v)}${unit === '%' ? '%' : ''}`;
const range = (names, key) => { const v = names.map((n) => m[n][key]); return [Math.min(...v), median(v), Math.max(...v)]; };
const ruled = (names) => `${names.reduce((a, n) => a + m[n].borderedBoxes, 0)} / ${names.reduce((a, n) => a + m[n].boxes, 0)}`;

const summaryRows = MEASURES.map(([key, label, unit, how]) => `<tr><td class="rule">${label}<div class="how">${how}</div></td>${COLUMNS.map(([arm]) => { const [lo, mid, hi] = range(ARMS[arm], key); return `<td class="${arm === 'product' ? 'hit' : ''}"><b>${fmt(mid, unit)}</b><div class="range">${fmt(lo, unit)} ~ ${fmt(hi, unit)}</div></td>`; }).join('')}</tr>`).join('')
  + `<tr><td class="rule">헤어라인 그은 상자<div class="how">80×40px 넘는 상자 가운데 윗변에 헤어라인이 그어진 것 / 전체.</div></td>${COLUMNS.map(([arm]) => `<td class="${arm === 'product' ? 'hit' : ''}"><b>${ruled(ARMS[arm])}</b></td>`).join('')}</tr>`;

const caption = (n) => `강한 색 ${fmt(m[n].colourPct, '%')} · 아이콘 ${m[n].icons} · 그림 ${fmt(m[n].picturePct, '%')} · 글자 ${fmt(m[n].textPct, '%')}`;
const fig = (name, label, cls = '') => `<figure class="${cls}"><figcaption><b>${esc(label)}</b></figcaption><img src="${shot(name)}" alt="${esc(label)} 첫 화면" loading="lazy" width="786" height="1704"><div class="nums">${caption(name)}</div></figure>`;
const wide = (arm, brief, row, label, cls = '') => `<figure class="${cls}"><figcaption><b>${esc(label)}</b></figcaption><img src="${desk(arm, brief, row)}" alt="${esc(label)} 첫 화면, 책상 크기" loading="lazy" width="1440" height="900"></figure>`;

const refStrip = REFS.map(([n, label]) => fig(n, label)).join('');
const rows = ROWS.map(([b, r, label]) => `<section class="row"><h3>${esc(label)}</h3><div class="strip four">${fig(`ours-${b}-${r}-before`, '전')}${fig(`ours-${b}-${r}-after`, '후')}${fig(`material-${b}-${r}`, '덧붙임 실험 (고른 것)')}${fig(`hb4-${b}-${r}`, '지금의 제품', 'pick')}</div></section>`).join('');
const webRows = WEB.map(([b, r, label]) => `<section class="row"><h3>${esc(label)}</h3><div class="strip desk">${wide('baseline', b, r, '전')}${wide('treatment', b, r, '후')}${webDone ? wide('handbook4', b, r, '지금의 제품', 'pick') : wide('handbook2', b, r, '재료 규칙의 첫 판')}</div></section>`).join('');
const earlier = [['hb2', '재료 규칙의 첫 판: 상한과 조건으로 적었을 때'], ['hb3', '둘째 판: 하한을 넣었을 때']].map(([arm, label]) => `<h3>${label}</h3><div class="strip">${ROWS.map(([b, r, name]) => fig(`${arm}-${b}-${r}`, name.replace('모임 ', '').replace('다이어트 ', ''))).join('')}</div>`).join('');
const perPage = Object.entries(m).filter(([n]) => n !== 'toss-web').map(([n, v]) => `<tr><td class="rule">${esc(n)}</td><td>${fmt(v.colourPct, '%')}</td><td>${fmt(v.greyPct, '%')}</td><td>${v.icons}</td><td>${fmt(v.picturePct, '%')}</td><td>${fmt(v.textPct, '%')}</td><td>${v.borderedBoxes} / ${v.boxes}</td></tr>`).join('');

const html = `<title>화면의 재료 비교</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap">
<style>
/* Layout: one reading column for words and tables; screens in strips that scroll sideways inside their own box. */
:root { --bg: #f8f9fb; --surface: #ffffff; --ink: #14171c; --muted: #5a6270; --line: #dfe3e8; --accent: #1d5fd0; --accent-soft: #e8f0fd; --good: #0b7a4b; --bad: #b3261e;
  --sans: "Pretendard Variable", Pretendard, "Noto Sans KR", -apple-system, system-ui, sans-serif; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #101317; --surface: #171b21; --ink: #eef1f5; --muted: #a2abb8; --line: #2b323c; --accent: #7fb0ff; --accent-soft: #1b2a44; --good: #5fd39a; --bad: #ff8a80; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #101317; --surface: #171b21; --ink: #eef1f5; --muted: #a2abb8; --line: #2b323c; --accent: #7fb0ff; --accent-soft: #1b2a44; --good: #5fd39a; --bad: #ff8a80; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 16px; line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
.wrap { max-width: 1280px; margin: 0 auto; padding-block: 40px 96px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.col { max-width: 720px; }
h1 { font-size: 36px; line-height: 1.2; font-weight: 700; margin: 0 0 8px; text-wrap: balance; }
h2 { font-size: 24px; line-height: 1.3; font-weight: 700; margin: 72px 0 8px; padding-top: 24px; border-top: 1px solid var(--line); text-wrap: balance; }
h3 { font-size: 18px; line-height: 1.4; font-weight: 700; margin: 40px 0 12px; }
p { margin: 0 0 16px; } .lede { font-size: 18px; } .date, .how, .range, .nums { color: var(--muted); } .date { font-size: 14px; margin: 0 0 24px; }
ul { margin: 0 0 16px; padding-left: 20px; } li { margin: 0 0 8px; }
.scroll { overflow-x: auto; margin: 16px 0 24px; }
table { border-collapse: collapse; width: 100%; min-width: 760px; font-size: 15px; font-variant-numeric: tabular-nums; background: var(--surface); border: 1px solid var(--line); }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; } th { font-size: 13px; font-weight: 700; color: var(--muted); white-space: nowrap; }
td b { font-size: 18px; font-weight: 700; } td.hit { background: var(--accent-soft); } td.hit b { color: var(--accent); }
td.rule { font-weight: 700; } .how { font-size: 13px; font-weight: 400; line-height: 1.5; max-width: 240px; } .range { font-size: 13px; }
table.small { font-size: 13px; } table.small td.rule { font-weight: 500; white-space: nowrap; }
.strip { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(200px, 240px); gap: 12px; overflow-x: auto; padding-bottom: 8px; align-items: start; }
.strip.four { grid-auto-columns: minmax(220px, 300px); }
.strip.desk { grid-auto-columns: minmax(340px, 410px); }
figure { margin: 0; min-width: 0; } figcaption { font-size: 14px; margin: 0 0 6px; }
figure img { display: block; width: 100%; height: auto; border: 1px solid var(--line); border-radius: 12px; background: #fff; }
.strip.desk img { border-radius: 6px; }
figure.pick figcaption b { color: var(--accent); } figure.pick img { border-color: var(--accent); border-width: 2px; }
.nums { font-size: 12px; line-height: 1.5; margin-top: 6px; font-variant-numeric: tabular-nums; }
details { margin: 8px 0 24px; } summary { cursor: pointer; font-weight: 700; padding: 8px 0; }
a { color: var(--accent); } :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
<div class="wrap">
<header class="col">
<h1>화면의 재료</h1>
<p class="date">2026년 11월 13일 · 디자인 랩, 둘째 회차</p>
<p class="lede">전과 후가 둘 다 밋밋했던 까닭은 재료가 같았기 때문이다. 둘 다 회색 종이 위의 글자와 선으로 만든 화면이었다. 살아 있다고 꼽은 다섯 곳을 같은 자로 재고, 그 재료를 규칙으로 덧붙여 그려 봤고, 그 덧붙임 실험이 고른 것이 됐다. 지금의 제품은 덧붙이지 않고도 그 수준으로 그린다.</p>
</header>

<h2>잰 값</h2>
<div class="col"><p>폰 크기(393×852)의 첫 화면 하나를 잰 값이다. 굵은 숫자는 가운데 값, 아래는 가장 작은 값과 큰 값. 레퍼런스는 다섯 곳의 모바일 웹, 나머지는 같은 네 방향을 네 가지 지침으로 그린 것이다. 파란 칸이 지금 브랜치의 제품이 그리는 것이다.</p></div>
<div class="scroll"><table>
<thead><tr><th></th>${COLUMNS.map(([, label]) => `<th>${label}</th>`).join('')}</tr></thead>
<tbody>${summaryRows}</tbody></table></div>
<div class="col">
<ul>
<li><b>갈라놓는 것은 색과 아이콘과 헤어라인이다.</b> 레퍼런스는 화면의 4분의 1이 강한 색이고, 아이콘이 열 개를 넘고, 헤어라인을 그은 상자가 없다. 전과 후의 화면은 무채색이 열에 아홉이고 상자마다 선이 그어졌다.</li>
<li><b>첫 핸드북은 이 값을 하나도 움직이지 못했다.</b> 고친 것은 결함이었고 재료가 아니었다.</li>
<li><b>덧붙임 실험이 고른 것이다.</b> 재료 규칙 여덟 개와 위의 비교표를 프롬프트 맨 뒤에 붙인 것이다.</li>
<li><b>지금의 제품은 그 수준으로 그린다.</b> 덧붙였던 글이 핸드북의 마지막 절이 됐고, 방향을 그리는 엔진의 지시 맨 끝에 한 번 더 놓인다. 네 장 모두 감사를 메이저 0건으로 통과했다.</li>
<li>다이어트 결투의 방향 c(체중계 다이얼)는 뺐다. 처음부터 맞지 않는 방향이었다는 판정에 따랐다.</li>
</ul>
</div>

<h2>레퍼런스</h2>
<div class="col"><p>치지직, 네이버쇼핑, 당근, 닌텐도의 모바일 웹 첫 화면. 토스는 앱 화면이 웹에 없어 소개 페이지만 찍혔고 값에서 뺐다.</p></div>
<div class="strip">${refStrip}</div>

<h2>폰: 같은 브리프, 네 가지 지침</h2>
<div class="col"><p>브리프, 방향, 테마 색, 그리는 모델은 넷 다 같다. 그림은 모두 엔진이 SVG로 직접 그린 것이다. 옆으로 넘겨 본다.</p>
<ul>
<li><b>전</b>: 어제까지의 지침.</li>
<li><b>후</b>: 첫 핸드북. 강한 색은 10분의 1, 아이콘은 잉크색, 카드는 헤어라인.</li>
<li><b>덧붙임 실험</b>: 첫 핸드북 뒤에 재료 규칙을 붙인 것. 고른 것이다.</li>
<li><b>지금의 제품</b>: 브랜치의 프롬프트 그대로, 덧붙임 없이 그린 것. 덧붙임 실험과 같은 그림이 아니라 같은 수준인지를 본다. 한 방향에 한 장씩이라 그릴 때마다 구성은 달라진다.</li>
</ul></div>
${rows}

<h2>웹: 같은 브리프, 세 가지 지침</h2>
<div class="col"><p>책상 크기(1440×900)의 첫 화면이다. ${webDone ? '웹에도 같은 절을 웹의 말로 넣었다: 페이지는 브랜드 색 히어로로 열고 첫 화면의 5분의 1은 그린 것, 앱 화면은 머리의 수치 카드에 색을 두고 탐색과 수치와 구획마다 아이콘. 웹에는 덧붙임 실험이 없었으므로 이 칸이 처음 보는 세기다.' : '오른쪽 칸은 재료 규칙의 첫 판으로 그린 것이다. 지금의 제품으로는 그리는 중이다.'}</p></div>
${webRows}

<h2>아직 안 된 것</h2>
<div class="col">
<ul>
<li><b>깨진 곳이 여전하다.</b> 떠 있는 버튼이 목록의 줄 위에 얹히고(회비 a), 좁은 칸에서 "100"이 "10"으로 잘린다(결투 b). 재는 검사가 아직 없다. 다음에 할 일이다.</li>
<li><b>탭 바가 한 장에만 있다.</b> 랩의 브리프는 옛 지침으로 쓰인 것이라 도크를 지정한다. 새 핸드북은 최상위 화면에 탭 바를 두라고 하고, 브리프를 새로 쓰게 하면 달라지는지는 보지 못했다.</li>
<li><b>그림의 질.</b> 아바타와 물건은 엔진이 선과 면으로 그린 것이다. 레퍼런스의 사진이나 입체 아이콘에는 못 미친다. 이미지 생성기를 붙이면 달라지는 자리이고, 비용이 드는 일이라 쓰지 않았다.</li>
<li><b>시안만 봤다.</b> 빌드에서는 재지 않았다. 방향마다 한 장씩이다. 움직임은 아직 보지 않았다.</li>
</ul>
</div>

<details><summary>여기까지 오는 동안의 두 판 (폰 네 장씩)</summary>
<div class="col"><p>같은 규칙을 핸드북 안에 적기만 했을 때의 화면이다. 첫 판은 캔버스와 카드와 아바타만 생기고 색은 그대로였고, 둘째 판은 네 장 가운데 둘만 고른 수준에 닿았다. 규칙을 비교표 아래에, 지시의 맨 끝에 놓은 것이 지금의 제품이다.</p></div>
${earlier}
</details>

<details><summary>화면마다 잰 값</summary>
<div class="scroll"><table class="small">
<thead><tr><th>화면</th><th>강한 색</th><th>무채색</th><th>아이콘</th><th>그림</th><th>글자</th><th>헤어라인 상자</th></tr></thead>
<tbody>${perPage}</tbody></table></div>
</details>
</div>
`;
writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, 'files.json'), JSON.stringify(Object.fromEntries(published), null, 1));
console.log(`${join(out, 'index.html')} · ${published.size} pictures · web ${webDone ? 'final' : 'first version'}`);
for (const [arm] of COLUMNS) console.log(arm.padEnd(8), MEASURES.map(([k, l, u]) => `${l} ${range(ARMS[arm], k).map((v) => fmt(v, u)).join('/')}`).join('  '), ' 헤어라인', ruled(ARMS[arm]));
console.log(JSON.stringify([...published.keys()]));

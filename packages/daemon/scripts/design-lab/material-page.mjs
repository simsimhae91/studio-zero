// The design lab's page for the "material" round: the owner's references, and each direction drawn three ways
// (old guidance, handbook, handbook plus material rules), all measured by refs.mjs.
//
//   node material-page.mjs <labDir>
//   reads  <labDir>/refs/material.json and <labDir>/refs/<name>.png
//   writes <labDir>/material/index.html, shots/*.png, files.json (what to publish beside the page)
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const lab = process.argv[2];
const out = join(lab, 'material');
mkdirSync(join(out, 'shots'), { recursive: true });
const m = JSON.parse(readFileSync(join(lab, 'refs', 'material.json'), 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const shot = (name) => { copyFileSync(join(lab, 'refs', `${name}.png`), join(out, 'shots', `${name}.png`)); return `shots/${name}.png`; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

const REFS = [['chzzk', '치지직'], ['naver-shopping', '네이버쇼핑'], ['daangn', '당근'], ['nintendo-kr', '닌텐도'], ['nintendo-store', '닌텐도 스토어']];
const ROWS = [['dues', 'a', '모임 회비 장부 · 방향 a'], ['dues', 'b', '모임 회비 장부 · 방향 b'], ['duel', 'a', '다이어트 결투 · 방향 a'], ['duel', 'b', '다이어트 결투 · 방향 b'], ['duel', 'c', '다이어트 결투 · 방향 c']];
const ARMS = { before: ROWS.map(([b, r]) => `ours-${b}-${r}-before`), after: ROWS.map(([b, r]) => `ours-${b}-${r}-after`), material: ROWS.map(([b, r]) => `material-${b}-${r}`), refs: REFS.map(([n]) => n) };

const MEASURES = [
  ['picturePct', '그림', '%', '사진, 영상, 64px 넘게 그린 그림이 덮은 면. 차트도 여기에 든다.'],
  ['icons', '아이콘', '개', '12~56px 크기의 그림 수.'],
  ['textPct', '글자', '%', '글자 상자가 덮은 면.'],
  ['colourPct', '강한 색', '%', '채도가 높은 픽셀.'],
  ['greyPct', '무채색', '%', '흰색, 검정, 회색 픽셀.'],
];
const fmt = (v, unit) => `${Math.round(v)}${unit === '%' ? '%' : ''}`;
const range = (names, key) => { const v = names.map((n) => m[n][key]); return [Math.min(...v), median(v), Math.max(...v)]; };
const borders = (names) => `${names.reduce((a, n) => a + m[n].borderedBoxes, 0)} / ${names.reduce((a, n) => a + m[n].boxes, 0)}`;

const summaryRows = MEASURES.map(([key, label, unit, how]) => `<tr><td class="rule">${label}<div class="how">${how}</div></td>${['refs', 'before', 'after', 'material'].map((arm) => { const [lo, mid, hi] = range(ARMS[arm], key); return `<td class="${arm === 'material' ? 'hit' : ''}"><b>${fmt(mid, unit)}</b><div class="range">${fmt(lo, unit)} ~ ${fmt(hi, unit)}</div></td>`; }).join('')}</tr>`).join('')
  + `<tr><td class="rule">헤어라인 그은 상자<div class="how">80×40px 넘는 상자 가운데 윗변에 헤어라인이 그어진 것 / 전체.</div></td>${['refs', 'before', 'after', 'material'].map((arm) => `<td class="${arm === 'material' ? 'hit' : ''}"><b>${borders(ARMS[arm])}</b></td>`).join('')}</tr>`;

const caption = (n) => `그림 ${fmt(m[n].picturePct, '%')} · 아이콘 ${m[n].icons} · 글자 ${fmt(m[n].textPct, '%')} · 강한 색 ${fmt(m[n].colourPct, '%')}`;
const fig = (name, label, cls = '') => `<figure class="${cls}"><figcaption><b>${esc(label)}</b></figcaption><img src="${shot(name)}" alt="${esc(label)} 첫 화면" loading="lazy" width="786" height="1704"><div class="nums">${caption(name)}</div></figure>`;

const refStrip = REFS.map(([n, label]) => fig(n, label)).join('');
const rows = ROWS.map(([b, r, label]) => `<section class="row"><h3>${esc(label)}</h3><div class="strip three">${fig(`ours-${b}-${r}-before`, '전')}${fig(`ours-${b}-${r}-after`, '후')}${fig(`material-${b}-${r}`, '재료', 'pick')}</div></section>`).join('');
const perPage = Object.entries(m).filter(([n]) => n !== 'toss-web').map(([n, v]) => `<tr><td class="rule">${esc(n)}</td><td>${fmt(v.picturePct, '%')}</td><td>${v.icons}</td><td>${fmt(v.textPct, '%')}</td><td>${fmt(v.colourPct, '%')}</td><td>${fmt(v.greyPct, '%')}</td><td>${v.borderedBoxes} / ${v.boxes}</td></tr>`).join('');

const html = `<title>화면의 재료 비교</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap">
<style>
/* Layout: one reading column for words and tables; phone screens in strips that scroll sideways inside their own box. */
:root { --bg: #f8f9fb; --surface: #ffffff; --ink: #14171c; --muted: #5a6270; --line: #dfe3e8; --accent: #1d5fd0; --accent-soft: #e8f0fd; --good: #0b7a4b; --bad: #b3261e;
  --sans: "Pretendard Variable", Pretendard, "Noto Sans KR", -apple-system, system-ui, sans-serif; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #101317; --surface: #171b21; --ink: #eef1f5; --muted: #a2abb8; --line: #2b323c; --accent: #7fb0ff; --accent-soft: #1b2a44; --good: #5fd39a; --bad: #ff8a80; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #101317; --surface: #171b21; --ink: #eef1f5; --muted: #a2abb8; --line: #2b323c; --accent: #7fb0ff; --accent-soft: #1b2a44; --good: #5fd39a; --bad: #ff8a80; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 16px; line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
.wrap { max-width: 1120px; margin: 0 auto; padding-block: 40px 96px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.col { max-width: 720px; }
h1 { font-size: 36px; line-height: 1.2; font-weight: 700; margin: 0 0 8px; text-wrap: balance; }
h2 { font-size: 24px; line-height: 1.3; font-weight: 700; margin: 72px 0 8px; padding-top: 24px; border-top: 1px solid var(--line); text-wrap: balance; }
h3 { font-size: 18px; line-height: 1.4; font-weight: 700; margin: 40px 0 12px; }
p { margin: 0 0 16px; } .lede { font-size: 18px; } .date, .how, .range, .nums { color: var(--muted); } .date { font-size: 14px; margin: 0 0 24px; }
ul { margin: 0 0 16px; padding-left: 20px; } li { margin: 0 0 8px; }
.scroll { overflow-x: auto; margin: 16px 0 24px; }
table { border-collapse: collapse; width: 100%; min-width: 620px; font-size: 15px; font-variant-numeric: tabular-nums; background: var(--surface); border: 1px solid var(--line); }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; } th { font-size: 13px; font-weight: 700; color: var(--muted); white-space: nowrap; }
td b { font-size: 18px; font-weight: 700; } td.hit { background: var(--accent-soft); } td.hit b { color: var(--accent); }
td.rule { font-weight: 700; } .how { font-size: 13px; font-weight: 400; line-height: 1.5; max-width: 260px; } .range { font-size: 13px; }
table.small { font-size: 13px; } table.small td.rule { font-weight: 500; white-space: nowrap; }
.strip { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(200px, 240px); gap: 12px; overflow-x: auto; padding-bottom: 8px; align-items: start; }
.strip.three { grid-auto-columns: minmax(220px, 320px); }
figure { margin: 0; min-width: 0; } figcaption { font-size: 14px; margin: 0 0 6px; }
figure img { display: block; width: 100%; height: auto; border: 1px solid var(--line); border-radius: 12px; background: #fff; }
figure.pick figcaption b { color: var(--accent); } figure.pick img { border-color: var(--accent); border-width: 2px; }
.nums { font-size: 12px; line-height: 1.5; margin-top: 6px; font-variant-numeric: tabular-nums; }
details { margin: 8px 0 24px; } summary { cursor: pointer; font-weight: 700; padding: 8px 0; }
a { color: var(--accent); } :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
<div class="wrap">
<header class="col">
<h1>화면의 재료</h1>
<p class="date">2026년 11월 13일 · 디자인 랩, 세 번째 군</p>
<p class="lede">전과 후가 둘 다 밋밋했던 까닭은 재료가 같았기 때문이다. 둘 다 회색 종이 위의 글자와 선으로 만든 화면이었다. 살아 있다고 꼽은 다섯 곳의 첫 화면을 같은 자로 재고, 그 재료로 같은 브리프를 다시 그리게 했다.</p>
</header>

<h2>잰 값</h2>
<div class="col"><p>폰 크기(393×852)의 첫 화면 하나를 잰 값이다. 굵은 숫자는 가운데 값, 아래는 가장 작은 값과 큰 값. 레퍼런스는 다섯 곳의 모바일 웹, 나머지는 같은 다섯 방향을 세 가지 지침으로 그린 것이다.</p></div>
<div class="scroll"><table>
<thead><tr><th></th><th>레퍼런스 5곳</th><th>전 (옛 지침)</th><th>후 (핸드북)</th><th>재료</th></tr></thead>
<tbody>${summaryRows}</tbody></table></div>
<div class="col">
<ul>
<li><b>갈라놓는 것은 글자와 헤어라인과 색이다.</b> 레퍼런스는 글자가 화면의 5분의 1이고 헤어라인을 그은 상자가 없다. 우리 화면은 글자가 5분의 2를 넘고 상자마다 선이 그어졌다. 무채색 픽셀이 열에 아홉이었다.</li>
<li><b>핸드북은 이 값을 하나도 움직이지 못했다.</b> 전과 후의 열이 거의 같다. 핸드북이 고친 것은 결함이었고 재료가 아니었다.</li>
<li><b>재료 군은 색, 아이콘, 헤어라인에서 레퍼런스의 자리에 왔다.</b> 그림은 가운데 값 27%로 레퍼런스(42%)에 못 미치고, 글자는 35%로 아직 많다.</li>
<li>그림 칸은 차트도 그림으로 센다. 전과 후에서 그림이 잡힌 화면은 모두 차트나 도표였고, 사람이나 물건을 그린 것은 한 장도 없었다.</li>
</ul>
</div>

<h2>레퍼런스</h2>
<div class="col"><p>치지직, 네이버쇼핑, 당근, 닌텐도의 모바일 웹 첫 화면. 토스는 앱 화면이 웹에 없어 소개 페이지만 찍혔고 값에서 뺐다.</p></div>
<div class="strip">${refStrip}</div>

<h2>같은 브리프, 세 가지 지침</h2>
<div class="col"><p>브리프, 방향, 테마 색, 그리는 모델은 셋 다 같다. 재료 군은 핸드북에 규칙 여덟 개를 더한 것이다: 첫 화면의 4분의 1은 그림, 줄마다 색 타일의 아이콘과 아래 탭 바, 글자는 4분의 1까지, 테두리 없는 둥근 카드, 강한 색 5분의 1에서 3분의 1, 블록 종류 섞기, 그림 위의 배지, 문장으로 된 머리말. 그림은 엔진이 SVG로 직접 그렸다.</p></div>
${rows}

<h2>아직 안 된 것</h2>
<div class="col">
<ul>
<li><b>글자가 여전히 많다.</b> 목표는 4분의 1이었고 다섯 장 모두 34~38%다. 결투 a는 12px 이하 글자가 37%로 되돌아갔다.</li>
<li><b>떠 있는 주 버튼이 목록을 가린다.</b> 회비 a, 결투 b, 결투 c에서 버튼이 줄 위에 얹혔다. 지난 비교에서 가장 자주 지적된 깨짐과 같은 종류다.</li>
<li><b>그림의 질.</b> 아바타와 물건은 엔진이 선과 면으로 그린 것이다. 레퍼런스의 사진이나 입체 아이콘에는 못 미친다. 이미지 생성기를 붙이면 달라지는 자리이고, 이번에는 쓰지 않았다.</li>
<li><b>덧붙인 규칙이다.</b> 재료 규칙은 핸드북 뒤에 붙였고, 핸드북의 검사 셋(색 넘침, 조작 수, 겹친 카드)은 무시하라고 했다. 그 셋은 이 화면들을 결함으로 잡는다. 규칙과 검사를 함께 고쳐야 제품에 들어간다.</li>
<li><b>모바일 다섯 방향, 한 장씩.</b> 웹은 그리지 않았다. 움직임도 아직 보지 않았다.</li>
</ul>
</div>

<details><summary>화면마다 잰 값</summary>
<div class="scroll"><table class="small">
<thead><tr><th>화면</th><th>그림</th><th>아이콘</th><th>글자</th><th>강한 색</th><th>무채색</th><th>헤어라인 상자</th></tr></thead>
<tbody>${perPage}</tbody></table></div>
</details>
</div>
`;
writeFileSync(join(out, 'index.html'), html);
const names = [...new Set([...ARMS.refs, ...ARMS.before, ...ARMS.after, ...ARMS.material])];
writeFileSync(join(out, 'files.json'), JSON.stringify(Object.fromEntries(names.map((n) => [`shots/${n}.png`, join(out, 'shots', `${n}.png`)])), null, 1));
process.stdout.write(`${join(out, 'index.html')} · ${names.length} pictures\n`);
for (const arm of ['refs', 'before', 'after', 'material']) process.stdout.write(`${arm.padEnd(9)} ${MEASURES.map(([k, l, u]) => `${l} ${range(ARMS[arm], k).map((v) => fmt(v, u)).join('/')}`).join('  ')}  테두리 ${borders(ARMS[arm])}\n`);

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
const webDone = WEB.every(([b, r]) => existsSync(join(lab, 'metrics', `nav-${b}-${r}-desktop.png`)));
const ARMS = {
  refs: REFS.map(([n]) => n),
  before: ROWS.map(([b, r]) => `ours-${b}-${r}-before`),
  after: ROWS.map(([b, r]) => `ours-${b}-${r}-after`),
  product: ROWS.map(([b, r]) => `nav-${b}-${r}`),
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
const motion = existsSync(join(lab, 'motion', 'motion.json')) ? JSON.parse(readFileSync(join(lab, 'motion', 'motion.json'), 'utf8')) : {};
const film = (name, label) => { const file = `film-${name}.png`; copyFileSync(join(lab, 'motion', `${name}-film.png`), join(out, 'shots', file)); published.set(`shots/${file}`, join(out, 'shots', file)); const r = motion[name]; return `<figure><figcaption><b>${esc(label)}</b> · 누름에 답함 ${r.presses.filter((x) => x.answered).length}/${r.presses.length} · 정지 뒤에도 도는 것 ${r.running} · 전환 ${esc(r.transitionMs.slice(0, 3).join(', ') || '없음')}</figcaption><img src="shots/${file}" alt="${esc(label)}: 로드 뒤 0.15초에서 5초까지 여섯 장" loading="lazy" width="1242" height="470"></figure>`; };
const films = REFS.every(([n]) => motion[n]) && ROWS.every(([b, r]) => motion[`nav-${b}-${r}`]) ? `${REFS.map(([n, label]) => film(n, label)).join('')}${ROWS.map(([b, r, label]) => film(`nav-${b}-${r}`, `지금의 제품 · ${label}`)).join('')}` : '';
const rows = ROWS.map(([b, r, label]) => `<section class="row"><h3>${esc(label)}</h3><div class="strip four">${fig(`ours-${b}-${r}-before`, '전')}${fig(`ours-${b}-${r}-after`, '후')}${fig(`material-${b}-${r}`, '덧붙임 실험 (고른 것)')}${fig(`nav-${b}-${r}`, '지금의 제품', 'pick')}</div></section>`).join('');
const webRows = WEB.map(([b, r, label]) => `<section class="row"><h3>${esc(label)}</h3><div class="strip desk">${wide('baseline', b, r, '전')}${wide('treatment', b, r, '후')}${webDone ? wide('nav', b, r, '지금의 제품', 'pick') : wide('handbook2', b, r, '재료 규칙의 첫 판')}</div></section>`).join('');
const earlier = [['hb2', '재료 규칙의 첫 판: 상한과 조건으로 적었을 때'], ['hb3', '둘째 판: 하한을 넣었을 때'], ['hb4', '셋째 판: 고른 글을 지시의 끝에 놓았을 때 (탭 바는 한 장뿐)']].map(([arm, label]) => `<h3>${label}</h3><div class="strip">${ROWS.map(([b, r, name]) => fig(`${arm}-${b}-${r}`, name.replace('모임 ', '').replace('다이어트 ', ''))).join('')}</div>`).join('');
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
.films { display: grid; gap: 20px; } .films img { border-radius: 6px; } .films figure { overflow-x: auto; } .films img { min-width: 760px; }
figure.pick figcaption b { color: var(--accent); } figure.pick img { border-color: var(--accent); border-width: 2px; }
.nums { font-size: 12px; line-height: 1.5; margin-top: 6px; font-variant-numeric: tabular-nums; }
details { margin: 8px 0 24px; } summary { cursor: pointer; font-weight: 700; padding: 8px 0; }
a { color: var(--accent); } :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
<div class="wrap">
<header class="col">
<h1>화면의 재료</h1>
<p class="date">2026년 11월 13일 · 디자인 랩, 둘째 회차</p>
<p class="lede">전과 후가 둘 다 밋밋했던 까닭은 재료가 같았기 때문이다. 둘 다 회색 종이 위의 글자와 선으로 만든 화면이었다. 살아 있다고 꼽은 다섯 곳을 같은 자로 재고, 그 재료를 규칙으로 덧붙여 그려 봤고, 그 덧붙임 실험이 고른 것이 됐다. 지금의 제품은 덧붙이지 않고도 그 수준으로 그리고, 화면마다 내비게이션을 둔다.</p>
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
<li><b>지금의 제품은 그 수준으로 그린다.</b> 덧붙였던 글이 핸드북의 마지막 절이 됐고, 방향을 그리는 엔진의 지시 맨 끝에 한 번 더 놓인다. 네 장 모두 감사를 메이저 0건으로 통과했다.</li>\n<li><b>내비게이션.</b> 폰 화면은 위에 바, 아래에 고정 탭 바(탭 셋에서 다섯, 아이콘과 이름), 그 위에 떠 있는 주 버튼. 네이버쇼핑과 치지직의 아래 탭 바, 고른 덧붙임 화면의 탭 바와 같은 틀이다. 감사가 첫 화면의 탭 바를 찾는다. 웹은 위에 로고와 아이콘 붙은 구획이 있는 바.</li>
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
<li><b>지금의 제품</b>: 지금의 프롬프트 그대로, 덧붙임 없이 그린 것. 덧붙임 실험과 같은 그림이 아니라 같은 수준인지를 본다. 한 방향에 한 장씩이라 그릴 때마다 구성은 달라진다. 탭 바가 네 장 모두에 있다.</li>
</ul></div>
${rows}

<h2>웹: 같은 브리프, 세 가지 지침</h2>
<div class="col"><p>책상 크기(1440×900)의 첫 화면이다. ${webDone ? '출고 장부 a의 앞선 그림(빨간 띠로 연 것)이 좋다는 판정에 따라 웹도 그 수준으로 올렸다: 페이지와 앱 화면 모두 브랜드 색 히어로로 열고, 위에는 로고와 아이콘 붙은 구획이 있는 내비게이션 바를 두며, 감사가 책상 크기의 첫 화면에서 색을 잰다. 네 장 모두 색 있는 히어로로 열렸다(폰 크기에서 잰 강한 색 21~32%, 전에는 한 장만).' : '오른쪽 칸은 재료 규칙의 첫 판으로 그린 것이다. 지금의 제품으로는 그리는 중이다.'}</p></div>
${webRows}

${m['build-dues-draft'] ? `<h2>실제 빌드</h2>
<div class="col"><p>시안이 아니라 지은 앱이다. 배포된 스튜디오에서 새 Expo 프로젝트에 초안 트랙으로 한 번 돌렸다(구독의 Claude Code, 11분, 한 회차). 요청은 "러닝 모임 '망원 새벽런'의 회비 장부 앱" 한 문단이었고 시안은 없었다. 컴파일과 스모크(경로 넷)를 통과했고, 초안 측정에서 걸린 것은 말줄임으로 잘린 긴 제목 둘뿐이다. 서체는 테마가 고른 SUITE가 로드됐다.</p>
<ul>
<li>강한 색 ${fmt(m['build-dues-draft'].colourPct, '%')}, 아이콘 ${m['build-dues-draft'].icons}개, 글자 ${fmt(m['build-dues-draft'].textPct, '%')}, 헤어라인 상자 ${m['build-dues-draft'].borderedBoxes} / ${m['build-dues-draft'].boxes}. 위 바, 아래 탭 바 셋, 떠 있는 주 버튼.</li>
<li>누름 여섯 모두에 답하고 한 번 들어온다. 가만히 있을 때 도는 것은 없다: 움직임 규칙의 그 줄은 지켜지지 않았고 재는 검사도 없다.</li>
<li>떠 있는 버튼이 뒤의 줄을 가린다. React Native의 배치 방식이라 지금의 검사는 잡지 못한다.</li>
<li>이 빌드가 알려 준 것: Expo의 웹 서버는 테마가 가리키던 자리의 서체 파일을 내주지 않아, 엔진이 파일을 옮기고 선언을 다시 썼다. 이제 스튜디오가 Expo 프로젝트에는 처음부터 그 자리에 넣는다.</li>
</ul></div>
<div class="strip four">${fig('build-dues-draft', '실제 초안 빌드 · Expo', 'pick')}${fig('material-dues-a', '덧붙임 실험 (시안) · 회비 a')}${fig('nav-dues-a', '지금의 제품 (시안) · 회비 a')}</div>

` : ''}<h2>움직임</h2>
<div class="col"><p>같은 자로 처음 5초를 찍고, 첫 화면의 누를 것 여섯 개를 눌러 봤다. 레퍼런스는 누름에 답하는 것이 다섯에 넷쯤이고, 전환은 150~300ms(시트나 넘김은 500ms), 절반은 가만히 있을 때에도 무언가가 돈다(넘어가는 배너, 라이브 표시). 우리 화면은 누름에 모두 답하고 속도도 같은 범위인데, 로드된 뒤에는 아무것도 움직이지 않았다. 그래서 규칙에 넣은 것: 첫 화면에 하나는 가만히 있을 때에도 살아 있고, 히어로는 한 번 들어오며, 주된 동작의 결과는 움직임으로 내려앉는다. 이 규칙으로 그린 화면은 아직 없다(아래의 우리 화면은 규칙을 넣기 전의 것이다).</p></div>
<div class="films">${films}</div>

<h2>아직 안 된 것</h2>
<div class="col">
<ul>
<li><b>깨진 곳을 재는 검사를 넣었다.</b> 두 줄로 갈라진 숫자, 겹쳐 그려진 글자, 떠 있는 버튼 아래의 글자, 스크롤 끝에서 바에 가려지는 내용. 앞선 그림들에서 결투 b의 "100" 갈라짐을 네 번 모두 잡았고, 지금의 네 장에는 한 건도 없다. 다만 떠 있는 버튼이 줄을 가리는 것은 버튼이 고정 배치일 때만 잡는다.</li>
<li><b>그림의 질.</b> 아바타와 물건은 엔진이 선과 면으로 그린 것이다. 레퍼런스의 사진이나 입체 아이콘에는 못 미친다. 이미지 생성기를 붙이면 달라지는 자리이고, 비용이 드는 일이라 쓰지 않았다.</li>
<li><b>움직임 규칙은 그려 보지 않았다.</b> 재서 넣기만 했다.</li>
<li><b>표본이 작다.</b> 시안은 방향마다 한 장씩, 실제 빌드는 Expo 초안 한 번이다. 전체 트랙의 빌드와 웹 빌드는 돌리지 않았다.</li>
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

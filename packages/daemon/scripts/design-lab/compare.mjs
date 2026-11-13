// The design lab's report: every direction as it was drawn before and after, side by side, with the numbers
// each rule is judged by. One HTML page and the pictures it shows, written to <labDir>/compare.
//
//   node compare.mjs <labDir>
//   reads  metrics/<arm>-<brief>-<row>.json (+ screenshots), runs/…/checks/*.json, review/{key,results}.json,
//          compare/notes.json (the conclusions, written by hand once the numbers are in)
//   writes compare/index.html, compare/shots/*.png, compare/files.json (what to publish beside the page)
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const lab = process.argv[2];
const out = join(lab, 'compare');
mkdirSync(join(out, 'shots'), { recursive: true });
const json = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const BRIEFS = [
  { id: 'duel', name: '다이어트 결투', kind: '모바일 앱 · 오늘의 실제 프로젝트', rows: ['a', 'b', 'c'] },
  { id: 'dues', name: '러닝 모임 회비 장부', kind: '모바일 앱 · 목록과 입력', rows: ['a', 'b'] },
  { id: 'quote', name: '견적서 서비스 소개', kind: '웹 페이지', rows: ['a', 'b'] },
  { id: 'orders', name: '쇼핑몰 주문 관리', kind: '웹 앱 · 표', rows: ['a', 'b'] },
];
const ARM_LABEL = { baseline: '전', production: '전 · 실제 엔진', treatment: '후', treatment2: '후 · 두 번째', draft: '후 · 첫 초안' };
const template = (brief) => readFileSync(join(lab, 'briefs', brief, 'template.txt'), 'utf8').trim();
const concept = (brief, row) => JSON.parse(readFileSync(join(lab, 'briefs', brief, 'docs', 'mockups', 'directions.json'), 'utf8')).directions.find((d) => d.id === row)?.concept ?? '';
const page = (arm, brief, row) => {
  const prefix = join(lab, 'metrics', `${arm}-${brief}-${row}`);
  const data = json(`${prefix}.json`, null);
  return data ? { arm, brief, row, prefix, data, view: data.phone, desktop: data.desktop ?? null } : null;
};
const runDir = (arm, brief, row) => (arm === 'baseline' ? join(lab, 'runs', 'baseline', brief, row) : arm === 'treatment' ? join(lab, 'runs', 'treatment', brief, row) : arm === 'treatment2' ? join(lab, 'runs', 'treatment', `${brief}-s2`, row) : null);
const checksOf = (arm, brief, row) => {
  const dir = runDir(arm, brief, row);
  if (!dir || !existsSync(join(dir, 'checks'))) return [];
  return readdirSync(join(dir, 'checks')).filter((n) => n.endsWith('.json')).sort((a, b) => parseInt(a) - parseInt(b)).map((n) => json(join(dir, 'checks', n), {}));
};
const shot = (p, kind) => {
  const from = `${p.prefix}-${kind}.png`;
  if (!existsSync(from)) return null;
  const name = `${p.arm}-${p.brief}-${p.row}-${kind}.png`;
  copyFileSync(from, join(out, 'shots', name));
  return `shots/${name}`;
};

// What each rule is judged by, read off a measured page. `phone` rules read the phone view; `web` the desktop view.
const NUM = [
  { rule: 'C2', label: '첫 화면의 강한 색', unit: '%', of: (v) => v.colour.saturatedPct },
  { rule: 'C3', label: '첫 화면의 검정', unit: '%', of: (v) => v.colour.darkPct },
  { rule: 'T3', label: '12px 이하로 놓인 글자', unit: '%', of: (v) => v.type.microSharePctFirstScreen },
  { rule: 'T3', label: '작은 글자로 쓴 문장', unit: '개', of: (v) => v.type.sentencesAtMicro.length },
  { rule: 'T1', label: '서체 수', unit: '개', of: (v) => v.type.families.filter(([f]) => !/mono/i.test(f)).length + (v.type.monoOutsideCode.length > 0 ? 1 : 0) },
  { rule: 'T2', label: '글자 크기 종류', unit: '종', of: (v) => v.type.distinctSizesFirstScreen },
  { rule: 'T5', label: '돌아가거나 쌓인 글자', unit: '개', of: (v) => v.type.turnedText.length + v.type.stackedText.length },
  { rule: 'T6', label: '끝 쪽으로 정렬한 글', unit: '개', of: (v) => v.type.endAlignedText.length },
  { rule: 'M3', label: '가장 큰 크기로 놓인 것', unit: '개', of: (v) => v.type.figuresAtLargest.length },
  { rule: 'M4', label: '두 번 말한 숫자', unit: '개', of: (v) => v.layout.figuresTwice.length },
  { rule: 'M5', label: '반쯤 빈 카드', unit: '개', of: (v) => v.layout.halfEmptyCards.length },
  { rule: 'M7', label: '첫 화면의 컨트롤', unit: '개', of: (v) => v.layout.controlsFirstScreen },
];
// What a web page's first screen is judged by, on the desktop view.
const WEB_NUM = [
  { rule: 'P3', label: '헤드라인 크기', unit: 'px', of: (v) => v.headline?.px ?? 0 },
  { rule: 'P3', label: '헤드라인 줄 수', unit: '줄', of: (v) => v.headline?.lines ?? 0 },
  { rule: 'P4', label: '왼쪽 절반의 빈 종이', unit: '%', of: (v) => v.colour.blankLeftPct },
  { rule: 'P4', label: '오른쪽 절반의 빈 종이', unit: '%', of: (v) => v.colour.blankRightPct },
];
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const fmt = (x) => (x === null || x === undefined ? '–' : Number.isInteger(x) ? String(x) : x.toFixed(1));
const spread = (xs, unit) => (xs.length === 0 ? '–' : `<b>${fmt(median(xs))}${unit}</b> <span class="range">${fmt(Math.min(...xs))}–${fmt(Math.max(...xs))}</span>`);

const all = [];
for (const b of BRIEFS) for (const row of b.rows) for (const arm of ['baseline', 'production', 'draft', 'treatment', 'treatment2']) {
  const p = page(arm, b.id, row);
  if (p) all.push(p);
}
const isMobile = (p) => template(p.brief) === 'mobile-expo';
const group = (arms, mobile) => all.filter((p) => arms.includes(p.arm) && isMobile(p) === mobile);
const viewOf = (p) => (isMobile(p) ? p.view : p.desktop ?? p.view);

const notes = json(join(out, 'notes.json'), { title: '디자인 랩', summary: '', tiles: [], verdicts: {}, untested: [], reading: '' });
const review = json(join(lab, 'review', 'results.json'), null);
const key = json(join(lab, 'review', 'key.json'), null);

function numbersTable(mobile) {
  const before = group(['baseline', 'production'], mobile);
  const draft = group(['draft'], mobile);
  const after = group(['treatment', 'treatment2'], mobile);
  if (before.length === 0) return '';
  const rows = (mobile ? NUM : [...NUM.filter((n) => !n.rule.startsWith('M')), ...WEB_NUM]).map((n) => {
    const b = before.map((p) => n.of(viewOf(p)));
    const d = draft.map((p) => n.of(viewOf(p)));
    const a = after.map((p) => n.of(viewOf(p)));
    const v = notes.verdicts[`${mobile ? 'mobile' : 'web'}:${n.rule}:${n.label}`] ?? notes.verdicts[`${n.rule}:${n.label}`] ?? notes.verdicts[n.rule] ?? '';
    return `<tr><td class="rule">${n.rule}</td><td>${esc(n.label)}</td><td>${spread(b, n.unit)}</td><td>${spread(d, n.unit)}</td><td>${spread(a, n.unit)}</td><td class="verdict">${esc(v)}</td></tr>`;
  });
  return `<div class="scroll"><table><thead><tr><th>규칙</th><th>재는 것</th><th>전 <span class="n">${before.length}장</span></th><th>후, 첫 초안 <span class="n">${draft.length}장</span></th><th>후, 최종 <span class="n">${after.length}장</span></th><th>판정</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function reviewBlock() {
  if (!review || !key) return '<p class="muted">눈가림 리뷰 결과가 아직 없다.</p>';
  const armOf = (id) => key.items[id]?.arm;
  const side = (arm) => (['baseline', 'production'].includes(arm) ? 'before' : ['treatment', 'treatment2'].includes(arm) ? 'after' : null);
  const AXES = ['hierarchy', 'whitespace', 'typography', 'color', 'copy', 'originality', 'tactility', 'slop'];
  const KO = { hierarchy: '위계', whitespace: '여백', typography: '타이포', color: '색', copy: '문구', originality: '독창성', tactility: '촉감', slop: '슬롭 (낮을수록 좋음)' };
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const scores = { before: {}, after: {} };
  for (const reviewer of review.rubric ?? []) for (const r of reviewer) {
    const s = side(armOf(r.id));
    if (!s) continue;
    for (const axis of AXES) (scores[s][axis] ??= []).push(r[axis]);
  }
  const axisRows = AXES.map((axis) => {
    const [b, a] = [mean(scores.before[axis] ?? []), mean(scores.after[axis] ?? [])];
    const delta = b === null || a === null ? null : a - b;
    const good = delta === null ? '' : (axis === 'slop' ? delta < -0.5 : delta > 0.15) ? 'up' : (axis === 'slop' ? delta > 0.5 : delta < -0.15) ? 'down' : '';
    return `<tr><td>${KO[axis]}</td><td>${fmt(b)}</td><td>${fmt(a)}</td><td class="${good}">${delta === null ? '–' : (delta > 0 ? '+' : '') + delta.toFixed(1)}</td></tr>`;
  }).join('');
  const reviewers = (review.rubric ?? []).length;

  // Pairs: how many judges chose the page drawn after, direction by direction.
  const pairRows = Object.entries(key.pairs).map(([id, k]) => {
    const votes = (review.pairs ?? []).map((judge) => judge.find((v) => v.id === id)).filter(Boolean);
    const forAfter = votes.filter((v) => side(k[v.ship]) === 'after').length;
    const clear = votes.filter((v) => v.margin === 'clear').length;
    const why = votes.map((v) => `${side(k[v.ship]) === 'after' ? '후' : '전'}: ${v.why}`);
    return { id, k, votes: votes.length, forAfter, clear, why };
  }).sort((x, y) => (x.k.brief + x.k.row).localeCompare(y.k.brief + y.k.row));
  const totalVotes = pairRows.reduce((n, r) => n + r.votes, 0);
  const totalAfter = pairRows.reduce((n, r) => n + r.forAfter, 0);
  const pairTable = pairRows.map((r) => `<tr><td>${esc(BRIEFS.find((b) => b.id === r.k.brief).name)} ${r.k.row.toUpperCase()}${[r.k.A, r.k.B].includes('production') ? ' <span class="n">실제 엔진 대 두 번째</span>' : ''}</td><td><b>${r.forAfter}</b> / ${r.votes}</td><td class="why">${r.why.map(esc).join('<br>')}</td></tr>`).join('');

  // Rules by judgment: on how many pages each rule was called broken, before and after.
  const broken = { before: new Map(), after: new Map() };
  const pagesSeen = { before: new Set(), after: new Set() };
  for (const checker of review.rules ?? []) for (const r of checker) {
    const s = side(armOf(r.id));
    if (!s) continue;
    pagesSeen[s].add(r.id);
    for (const rule of new Set(r.broken ?? [])) broken[s].set(rule, (broken[s].get(rule) ?? 0) + 1);
  }
  const checkers = Math.max(1, (review.rules ?? []).length);
  const ruleIds = [...new Set([...broken.before.keys(), ...broken.after.keys()])].sort((x, y) => (broken.before.get(y) ?? 0) + (broken.after.get(y) ?? 0) - (broken.before.get(x) ?? 0) - (broken.after.get(x) ?? 0)).slice(0, 24);
  const per = (s, rule) => ((broken[s].get(rule) ?? 0) / checkers / Math.max(1, pagesSeen[s].size)) * 100;
  const ruleRows = ruleIds.map((rule) => `<tr><td class="rule">${rule}</td><td>${per('before', rule).toFixed(0)}%</td><td>${per('after', rule).toFixed(0)}%</td><td class="verdict">${esc(notes.verdicts[`judged:${rule}`] ?? '')}</td></tr>`).join('');

  return `<h3>일곱 축의 점수 <span class="n">리뷰어 ${reviewers}명의 평균, 0~10</span></h3>
<div class="scroll"><table class="narrow"><thead><tr><th>축</th><th>전</th><th>후</th><th>차이</th></tr></thead><tbody>${axisRows}</tbody></table></div>
<h3>둘 중 무엇을 내보내겠는가 <span class="n">심사 ${totalVotes}표 가운데 ${totalAfter}표가 후</span></h3>
<div class="scroll"><table><thead><tr><th>방향</th><th>후를 고른 표</th><th>이유</th></tr></thead><tbody>${pairTable}</tbody></table></div>
<h3>리뷰어가 어겼다고 본 규칙 <span class="n">그 규칙을 어겼다고 적힌 화면의 비율</span></h3>
<div class="scroll"><table class="narrow"><thead><tr><th>규칙</th><th>전</th><th>후</th><th></th></tr></thead><tbody>${ruleRows}</tbody></table></div>`;
}

const AX7 = ['hierarchy', 'whitespace', 'typography', 'color', 'copy', 'originality', 'tactility'];
/** A page's blind score: the mean of the seven axes over every reviewer. Null before the review exists. */
function blindScore(p) {
  if (!review || !key) return null;
  const id = Object.entries(key.items).find(([, k]) => k.arm === p.arm && k.brief === p.brief && k.row === p.row)?.[0];
  const rs = (review.rubric ?? []).map((rv) => rv.find((r) => r.id === id)).filter(Boolean);
  return rs.length === 0 ? null : rs.reduce((n, r) => n + AX7.reduce((m, a) => m + r[a], 0) / 7, 0) / rs.length;
}
/** How the judges chose between a direction's two pages. */
function pairLine(brief, row, arms) {
  if (!review || !key) return '';
  const entry = Object.entries(key.pairs).find(([, k]) => k.brief === brief && k.row === row && arms.includes(k.A) && arms.includes(k.B));
  if (!entry) return '';
  const [id, k] = entry;
  const votes = (review.pairs ?? []).map((j) => j.find((v) => v.id === id)).filter(Boolean);
  const after = votes.filter((v) => ['treatment', 'treatment2'].includes(k[v.ship])).length;
  return `<p class="votes">둘 중 하나를 고르라 했을 때: <b>후 ${after}표</b>, 전 ${votes.length - after}표</p>`;
}

function caption(p) {
  const v = p.view;
  const fams = v.type.families.map(([f]) => f.replace(' Variable', '')).join(' + ');
  const said = checksOf(p.arm, p.brief, p.row);
  const count = (c) => (c?.findings ? `${c.findings.filter((f) => f.severity !== 'minor').length}건` : null);
  const checkLine = said.length === 0 ? '' : `<li>스튜디오의 검사: ${said.length}번${count(said[0]) !== null ? `, 처음 ${count(said[0])} → 마지막 ${count(said[said.length - 1])} (메이저 이상)` : ''}</li>`;
  const blind = blindScore(p);
  return `<ul class="facts">${blind === null ? '' : `<li>눈가림 점수 <b>${blind.toFixed(1)}</b> / 10</li>`}<li>강한 색 <b>${fmt(v.colour.saturatedPct)}%</b> · 검정 <b>${fmt(v.colour.darkPct)}%</b></li><li>12px 이하 글자 <b>${fmt(v.type.microSharePctFirstScreen)}%</b> · 크기 ${v.type.distinctSizesFirstScreen}종</li><li>${esc(fams)}</li>${checkLine}</ul>`;
}

function figure(p) {
  if (!p) return '<div class="empty">없음</div>';
  const mobile = isMobile(p);
  const first = shot(p, mobile ? 'phone' : 'desktop');
  const full = shot(p, mobile ? 'phone-full' : 'desktop-full');
  const phone = mobile ? null : shot(p, 'phone');
  return `<figure class="${mobile ? 'phone' : 'desktop'}"><figcaption><span class="arm arm-${p.arm}">${ARM_LABEL[p.arm]}</span></figcaption>
<img src="${first}" alt="${esc(ARM_LABEL[p.arm])}: ${esc(p.view.title ?? '')}" loading="lazy">
${caption(p)}
${phone ? `<details><summary>폰에서</summary><img class="inner-phone" src="${phone}" alt="" loading="lazy"></details>` : ''}
${full ? `<details><summary>페이지 전체</summary><img src="${full}" alt="" loading="lazy"></details>` : ''}</figure>`;
}

const sections = BRIEFS.map((b) => {
  const rows = b.rows.map((row) => {
    const mobile = template(b.id) === 'mobile-expo';
    const cells = [page('baseline', b.id, row), page('treatment', b.id, row)];
    const extra = [page('production', b.id, row), page('treatment2', b.id, row)].filter(Boolean);
    return `<article class="row"><h3>${esc(b.name)} · ${row.toUpperCase()}</h3><p class="concept">${esc(concept(b.id, row))}</p>
${pairLine(b.id, row, ['baseline', 'treatment'])}
<div class="pair ${mobile ? 'phones' : 'desktops'}">${cells.map(figure).join('')}</div>
${extra.length ? `<details class="more" open><summary>표본 하나 더: 오늘 실제 엔진이 그린 것과, 후의 두 번째</summary>${pairLine(b.id, row, ['production', 'treatment2'])}<div class="pair phones">${extra.map(figure).join('')}</div></details>` : ''}</article>`;
  }).join('');
  return `<section id="${b.id}"><h2>${esc(b.name)} <span class="n">${esc(b.kind)}</span></h2>${rows}</section>`;
}).join('');

const checks = json(join(out, 'checks.json'), null);
const checksTable = !checks ? '' : `<div class="scroll"><table><thead><tr><th>새 검사</th><th>옛 지침의 화면 <span class="n">${checks.oldPages}장 중</span></th><th>새 지침, 첫 초안 <span class="n">${checks.newPages}장 중</span></th><th>새 지침, 최종</th><th>판정</th></tr></thead><tbody>${checks.rows.map((r) => `<tr><td class="rule">${esc(r.rule)}</td><td>${r.old}</td><td>${r.first}</td><td>${r.last}</td><td class="verdict">${esc(notes.verdicts[`check:${r.rule}`] ?? '')}</td></tr>`).join('')}</tbody></table></div>`;
const list = (items) => `<ul class="plain">${(items ?? []).map((u) => `<li>${esc(u)}</li>`).join('')}</ul>`;

const tiles = (notes.tiles ?? []).map((t) => `<div class="tile"><div class="tile-label">${esc(t.label)}</div><div class="tile-value">${t.value ? `<b>${esc(t.value)}</b>` : `${esc(t.before)} <span class="to">→</span> <b>${esc(t.after)}</b>`}</div><div class="tile-note">${esc(t.note ?? '')}</div></div>`).join('');

const html = `<title>${esc(notes.title)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap">
<style>
/* Layout: one reading column for words and tables; pictures in pairs that break wider than the column. */
:root { --bg: #f8f9fb; --surface: #ffffff; --ink: #14171c; --muted: #5a6270; --line: #dfe3e8; --accent: #1d5fd0; --good: #0b7a4b; --bad: #b3261e; --plate: #eef0f3;
  --sans: "Pretendard Variable", Pretendard, "Noto Sans KR", -apple-system, system-ui, sans-serif; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #101317; --surface: #171b21; --ink: #eef1f5; --muted: #a2abb8; --line: #2b323c; --accent: #7fb0ff; --good: #5fd39a; --bad: #ff8a80; --plate: #1d222a; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #101317; --surface: #171b21; --ink: #eef1f5; --muted: #a2abb8; --line: #2b323c; --accent: #7fb0ff; --good: #5fd39a; --bad: #ff8a80; --plate: #1d222a; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 16px; line-height: 1.6; word-break: keep-all; overflow-wrap: anywhere; }
.wrap { max-width: 1120px; margin: 0 auto; padding-block: 40px 96px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.col { max-width: 720px; }
h1 { font-size: 36px; line-height: 1.2; font-weight: 700; margin: 0 0 8px; text-wrap: balance; }
h2 { font-size: 24px; line-height: 1.3; font-weight: 700; margin: 72px 0 8px; padding-top: 24px; border-top: 1px solid var(--line); }
h3 { font-size: 18px; line-height: 1.4; font-weight: 700; margin: 40px 0 8px; }
p { margin: 0 0 16px; } .muted, .n, .range, .concept { color: var(--muted); } .n { font-size: 14px; font-weight: 400; margin-left: 6px; } .range { font-size: 13px; }
.lede { font-size: 18px; } .date { color: var(--muted); font-size: 14px; margin: 0 0 24px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 32px 0 8px; }
.tile { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
.tile-label { font-size: 14px; color: var(--muted); } .tile-value { font-size: 24px; font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1.3; margin: 4px 0; } .tile-value b { font-weight: 700; color: var(--accent); } .to { color: var(--muted); font-weight: 400; } .tile-note { font-size: 13px; color: var(--muted); line-height: 1.5; }
.scroll { overflow-x: auto; margin: 8px 0 24px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; font-variant-numeric: tabular-nums; background: var(--surface); border: 1px solid var(--line); }
table.narrow { width: auto; min-width: 360px; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; } th { font-size: 13px; font-weight: 700; color: var(--muted); white-space: nowrap; }
td.rule { font-weight: 700; white-space: nowrap; } td.verdict { min-width: 180px; } td.why { font-size: 13px; color: var(--muted); min-width: 260px; } td.up { color: var(--good); font-weight: 700; } td.down { color: var(--bad); font-weight: 700; }
.row { margin-top: 40px; } .concept { font-size: 14px; max-width: 720px; }
.pair { display: grid; gap: 16px; align-items: start; } .pair.phones { grid-template-columns: repeat(2, minmax(0, 340px)); } .pair.desktops { grid-template-columns: 1fr; }
figure { margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 12px; min-width: 0; }
figure img { display: block; width: 100%; height: auto; border: 1px solid var(--line); background: #fff; }
figure.phone img { max-width: 320px; } .inner-phone { max-width: 320px; }
figcaption { margin-bottom: 8px; } .arm { display: inline-block; font-size: 13px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--plate); }
.arm-treatment, .arm-treatment2 { background: var(--accent); color: var(--surface); }
.facts { list-style: none; padding: 0; margin: 10px 0 0; font-size: 13px; color: var(--muted); line-height: 1.7; font-variant-numeric: tabular-nums; } .facts b { color: var(--ink); }
.votes { font-size: 14px; margin: 0 0 12px; } .votes b { color: var(--accent); }
details { margin-top: 8px; font-size: 14px; } summary { cursor: pointer; color: var(--accent); } details.more { margin-top: 16px; }
.empty { border: 1px dashed var(--line); border-radius: 8px; padding: 24px; color: var(--muted); font-size: 14px; }
ul.plain { padding-left: 20px; margin: 0 0 16px; } ul.plain li { margin-bottom: 6px; }
nav.toc { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 14px; margin: 24px 0 0; } nav.toc a { color: var(--accent); }
@media (max-width: 560px) { h1 { font-size: 28px; } .pair.phones { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } figure { padding: 8px; } }
</style>
<div class="wrap">
<div class="col">
<h1>${esc(notes.title)}</h1>
<p class="date">${esc(notes.date ?? '')}</p>
<p class="lede">${esc(notes.summary)}</p>
</div>
<div class="tiles">${tiles}</div>
<nav class="toc"><a href="#verdict">판정</a><a href="#numbers">규칙별 숫자</a><a href="#checks">새 검사</a><a href="#review">눈가림 리뷰</a><a href="#ceiling">남은 천장</a>${BRIEFS.map((b) => `<a href="#${b.id}">${esc(b.name)}</a>`).join('')}<a href="#limits">검증하지 못한 것</a></nav>

<section id="verdict"><h2>판정</h2>
<div class="col"><h3>남긴다</h3>${list(notes.keep)}<h3>고쳐서 다시 본다</h3>${list(notes.rework)}<h3>버린다</h3>${list(notes.drop)}</div>
</section>

<section id="numbers"><h2>규칙별 숫자</h2>
<div class="col"><p>${esc(notes.reading ?? '')}</p></div>
<h3>모바일 화면</h3>${numbersTable(true)}
<h3>웹 화면 <span class="n">데스크톱 첫 화면</span></h3>${numbersTable(false)}
</section>

<section id="checks"><h2>새 검사가 가르는 것</h2>
<div class="col"><p>${esc(notes.checksReading ?? '')}</p></div>
${checksTable}
</section>

<section id="review"><h2>눈가림 리뷰</h2>
<div class="col"><p>${esc(notes.reviewReading ?? '')}</p></div>
${reviewBlock()}
</section>

<section id="ceiling"><h2>남은 천장: 깨진 화면</h2>
<div class="col"><p>${esc(notes.ceilingReading ?? '')}</p>${list(notes.breakage)}<p>${esc(notes.next ?? '')}</p></div>
</section>

${sections}

<section id="limits"><h2>검증하지 못한 것</h2><div class="col"><ul class="plain">${(notes.untested ?? []).map((u) => `<li>${esc(u)}</li>`).join('')}</ul></div></section>
</div>
`;
writeFileSync(join(out, 'index.html'), html);
const files = Object.fromEntries(readdirSync(join(out, 'shots')).map((n) => [`shots/${n}`, join(out, 'shots', n)]));
writeFileSync(join(out, 'files.json'), JSON.stringify(files, null, 1));
process.stdout.write(`${join(out, 'index.html')} (${html.length} bytes), ${Object.keys(files).length} pictures\n`);

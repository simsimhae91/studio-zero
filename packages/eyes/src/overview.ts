import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { openBacklog } from './backlog.ts';
import { EVIDENCE_DIR, SZ_DIR, allContracts, owed, type Contract } from './contract.ts';
import { PAGE_STYLE, esc } from './evidence.ts';
import { lastRelease, releases } from './release.ts';
import { ledgerProblem, standing } from './standing.ts';

/**
 * One person looks after many products. What each of them needs to know first is not in any one project: what
 * is waiting for their judgement, what is broken, what is live where. This reads the `.sz/` folders of several
 * projects and puts that on one page, most urgent first. It changes nothing.
 */
export interface ProductView {
  dir: string;
  name: string;
  /** What it is, in the words of its own spec or map. */
  says: string;
  stands: number;
  broken: { key: string; says: string }[];
  /** Why its record of promises cannot be read, when it cannot. */
  problem: string | null;
  /** Work that is open, with how many things it still owes. */
  open: { id: string; request: string; owes: number }[];
  /** What should be answering at each place it was released to, and when it was last looked at there. */
  live: { place: string; url: string; commit: string; releasedAt: string; release: string; checked: { at: string; id: string; verdict: string } | null; wayBack: string }[];
  /** What only the owner can judge and has not yet: each with the evidence page that shows it, when there is one. */
  waiting: { text: string; page: string | null }[];
  /** The rest of what is written down as known and not done. */
  left: string[];
  /** The last line of its progress record. */
  last: string;
  /** Its most recent evidence pages, newest first. */
  pages: { id: string; title: string; file: string }[];
}

const read = (file: string): string => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const firstHeading = (text: string): string => /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? '';
/** The first lines of plain words under a heading (or at the top), without the markup. */
const firstWords = (text: string): string =>
  (text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && !line.startsWith('#') && !/^\d{4}-\d{2}-\d{2}/.test(line)) ?? '')
    .replace(/[*`]/g, '')
    .slice(0, 220);

const verdictOf = (contract: Contract): string => {
  const count = (status: string): number => contract.claims.filter((claim) => claim.status === status).length;
  if (contract.release?.takenBack) return '되돌림';
  if (count('refuted') > 0) return `반증 ${count('refuted')}`;
  if (contract.closedAt === null) return `진행 중(아직 ${count('unproven')})`;
  return `증명 ${count('proven')}${count('unchecked') > 0 ? ` · 확인 못 함 ${count('unchecked')}` : ''}`;
};

/** What a project's `.sz/` folder says of it, or null when the folder has none. */
export function viewOf(dir: string): ProductView | null {
  const sz = join(dir, SZ_DIR);
  if (!existsSync(sz) || !statSync(sz).isDirectory()) return null;
  const spec = read(join(sz, 'spec.md'));
  const map = read(join(sz, 'map.md'));
  const name = (firstHeading(map).replace(/^지도\s*[:：]\s*|\s+지도$/g, '') || firstHeading(spec).replace(/\s*[—–-]\s*명세$/, '') || basename(dir)).trim();
  const contracts = allContracts(dir).map((entry) => entry.contract);
  const { stands } = standing(dir);
  const page = (id: string): string | null => {
    const file = join(dir, EVIDENCE_DIR, id, 'report.html');
    return existsSync(file) ? file : null;
  };
  const lines = openBacklog(dir);
  const OWNER = /^주인이 볼 것\s*[:：]\s*/;
  const places = [...new Set(releases(dir).map((contract) => contract.release!.place))];
  return {
    dir,
    name,
    says: firstWords(spec.split(/^##[^\n]*\n/m)[1] ?? '') || firstWords(map.split(/^##[^\n]*\n/m)[1] ?? ''),
    stands: stands.length,
    broken: stands.filter((s) => s.last?.status === 'broken').map((s) => ({ key: s.key, says: s.claim.says })),
    problem: ledgerProblem(dir),
    open: contracts.filter((contract) => contract.closedAt === null).map((contract) => ({ id: contract.id, request: contract.request, owes: owed(contract).length })),
    live: places.flatMap((place) => {
      const out = lastRelease(dir, place);
      if (!out) return [];
      const looks = releases(dir).filter((contract) => contract.release!.place === place && contract.release!.candidate === null && contract.createdAt > out.createdAt);
      const look = looks.at(-1) ?? null;
      return [{ place, url: out.release!.url, commit: out.release!.commit, releasedAt: out.closedAt!, release: out.id, checked: look ? { at: look.createdAt, id: look.id, verdict: verdictOf(look) } : null, wayBack: out.release!.wayBack }];
    }),
    // What they judged once and later work changed: theirs to look at again. Then what they have never judged.
    waiting: [
      ...stands.filter((s) => s.claim.shownBy.kind === 'owner' && s.last?.status === 'unchecked').map((s) => ({ text: `다시 볼 것: ${s.claim.says}${s.last!.note ? `: ${s.last!.note}` : ''}`, page: page(s.last!.during ?? s.contract) })),
      ...lines.filter((line) => OWNER.test(line)).map((line) => ({ text: line.replace(OWNER, '').replace(/\s*\(계약 [a-z0-9-]+\)\s*$/, ''), page: page(/\(계약 ([a-z0-9-]+)\)\s*$/.exec(line)?.[1] ?? '') })),
    ],
    left: lines.filter((line) => !OWNER.test(line)),
    last: read(join(sz, 'progress.md')).trim().split('\n').filter((line) => line.trim() !== '').at(-1)?.replace(/^-\s*/, '').slice(0, 260) ?? '',
    pages: contracts
      .filter((contract) => page(contract.id) !== null)
      .slice(-3)
      .reverse()
      .map((contract) => ({ id: contract.id, title: `${contract.request.slice(0, 60)} (${verdictOf(contract)})`, file: page(contract.id)! })),
  };
}

/** The projects under these folders: a folder that has a `.sz/` itself, or else its children that do. */
export function findProducts(roots: readonly string[]): string[] {
  const found: string[] = [];
  for (const root of roots.map((path) => resolve(path))) {
    if (existsSync(join(root, SZ_DIR))) found.push(root);
    else if (existsSync(root) && statSync(root).isDirectory())
      for (const entry of readdirSync(root, { withFileTypes: true })) if (entry.isDirectory() && !entry.name.startsWith('.') && existsSync(join(root, entry.name, SZ_DIR))) found.push(join(root, entry.name));
  }
  return [...new Set(found)].sort();
}

const day = (iso: string): string => iso.slice(0, 10);

/** What needs the owner, most urgent first: what is broken, what waits for their eye, then each product. */
export function renderOverview(products: readonly ProductView[]): string {
  if (products.length === 0) return 'no project with a .sz/ folder here';
  const lines: string[] = [];
  const broken = products.flatMap((p) => p.broken.map((b) => `  - ${p.name}: ${b.says} (${b.key})`));
  const waiting = products.flatMap((p) => p.waiting.map((w) => `  - ${p.name}: ${w.text.slice(0, 160)}${w.page ? `\n      ${w.page}` : ''}`));
  if (broken.length > 0) lines.push(`깨진 약속 ${broken.length}:`, ...broken, '');
  if (waiting.length > 0) lines.push(`주인의 판단을 기다리는 것 ${waiting.length}:`, ...waiting, '');
  for (const p of products) {
    lines.push(`${p.name}  (${p.dir})`, `  ${p.says}`);
    lines.push(`  약속 ${p.stands}개${p.broken.length > 0 ? `, 깨짐 ${p.broken.length}` : ''} · 남은 일 ${p.left.length} · 기다리는 것 ${p.waiting.length}${p.open.length > 0 ? ` · 열린 일: ${p.open.map((o) => `${o.id}(${o.owes})`).join(', ')}` : ''}`);
    if (p.problem) lines.push(`  ${p.problem}`);
    for (const l of p.live) lines.push(`  살아 있는 곳 ${l.place}: ${l.url} · ${l.commit.slice(0, 7)} (${day(l.releasedAt)} ${l.release})${l.checked ? ` · 마지막 점검 ${day(l.checked.at)} ${l.checked.verdict}` : ' · 내보낸 뒤 점검한 적 없음'}`);
    if (p.live.length === 0) lines.push('  아직 어디에도 내놓지 않음');
    if (p.last) lines.push(`  최근: ${p.last}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** The same as one page the owner opens: links go to each evidence page on this machine. */
export function overviewPage(products: readonly ProductView[], at: string): string {
  const link = (file: string, text: string): string => `<a href="file://${esc(encodeURI(file))}">${esc(text)}</a>`;
  const broken = products.flatMap((p) => p.broken.map((b) => `<div class="claim refuted"><header><span class="mark">깨진 약속 · ${esc(p.name)}</span><h2>${esc(b.says)}</h2></header><p class="how"><code>${esc(b.key)}</code></p></div>`));
  // A line reads "<what is claimed>: <what whoever verified says to look at>".
  const waiting = products.flatMap((p) =>
    p.waiting.map((w) => {
      const at = w.text.search(/[:：]\s/);
      const [claim, look] = at < 0 ? [w.text, ''] : [w.text.slice(0, at), w.text.slice(at + 1).trim()];
      return `<div class="claim"><header><span class="mark">${esc(p.name)}</span><h2>${esc(claim.slice(0, 200))}</h2></header>${look ? `<p class="note">${esc(look.slice(0, 600))}</p>` : ''}${w.page ? `<p class="how">${link(w.page, '증거 페이지 열기')}</p>` : ''}</div>`;
    }),
  );
  const cards = products
    .map(
      (p) => `<section class="claim ${p.broken.length > 0 ? 'refuted' : p.live.length > 0 ? 'proven' : ''}">
  <header><span class="mark">${p.live.length > 0 ? p.live.map((l) => `${esc(l.place)} · ${esc(l.commit.slice(0, 7))}`).join(' / ') : '아직 내놓지 않음'}</span><h2>${esc(p.name)}</h2></header>
  <p class="note">${esc(p.says)}</p>
  <p class="counts"><span>약속 ${p.stands}</span><span>깨짐 ${p.broken.length}</span><span>기다리는 것 ${p.waiting.length}</span><span>남은 일 ${p.left.length}</span>${p.open.length > 0 ? `<span>열린 일 ${p.open.map((o) => esc(o.id)).join(', ')}</span>` : ''}</p>
  ${p.problem ? `<p class="note">${esc(p.problem)}</p>` : ''}
  ${p.live.map((l) => `<p class="how"><a href="${esc(l.url)}">${esc(l.url)}</a> · ${esc(day(l.releasedAt))}에 내보냄(${esc(l.release)}) · ${l.checked ? `마지막 점검 ${esc(day(l.checked.at))}: ${esc(l.checked.verdict)}` : '내보낸 뒤 점검한 적 없음'}${l.wayBack ? ` · 되돌리기 <code>${esc(l.wayBack)}</code>` : ''}</p>`).join('')}
  ${p.left.length > 0 ? `<ul>${p.left.slice(0, 3).map((line) => `<li>${esc(line.slice(0, 200))}</li>`).join('')}${p.left.length > 3 ? `<li class="how">그 밖에 ${p.left.length - 3}줄 (<code>.sz/backlog.md</code>)</li>` : ''}</ul>` : ''}
  ${p.pages.length > 0 ? `<p class="how">${p.pages.map((page) => link(page.file, page.title)).join(' · ')}</p>` : ''}
  ${p.last ? `<p class="how">최근: ${esc(p.last)}</p>` : ''}
  <p class="file">${esc(p.dir)}</p>
</section>`,
    )
    .join('\n');
  const count = (pick: (p: ProductView) => number): number => products.reduce((sum, p) => sum + pick(p), 0);
  return `<title>작업실</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="claude:viewport-fit-sides" content="cover">
<style>${PAGE_STYLE} a { color: inherit }</style>
<main>
  <p class="meta">${esc(day(at))} · 제품 ${products.length}개</p>
  <h1>작업실</h1>
  <p class="counts"><span>내놓은 것 ${count((p) => (p.live.length > 0 ? 1 : 0))}</span><span>깨진 약속 ${count((p) => p.broken.length)}</span><span>판단을 기다리는 것 ${count((p) => p.waiting.length)}</span><span>서 있는 약속 ${count((p) => p.stands)}</span></p>
  ${broken.length > 0 ? `<section><h2>먼저 볼 것: 깨진 약속</h2>${broken.join('')}</section>` : ''}
  ${waiting.length > 0 ? `<section><h2>주인의 판단을 기다리는 것</h2>${waiting.join('')}</section>` : ''}
  <section><h2>제품</h2>${cards}</section>
</main>
`;
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import type { Claim, Contract } from './contract.ts';
import type { Kept } from './standing.ts';

export const esc = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** A picture put inside the page, so the page is whole wherever it is opened; a file that is no picture is named. */
export function inlinePicture(folder: string, path: string): string {
  const file = join(folder, path);
  const type = TYPES[extname(path).toLowerCase()];
  if (!type || !existsSync(file)) return `<p class="file">${esc(path)}</p>`;
  return `<figure><img alt="${esc(path)}" src="data:${type};base64,${readFileSync(file).toString('base64')}"><figcaption>${esc(path)}</figcaption></figure>`;
}

/** How a page the owner reads looks: evidence of a contract, and what came of a round of their feedback. */
export const PAGE_STYLE = `
:root { --bg: #f7f6f3; --fg: #1c1b18; --muted: #6b6860; --line: #dedbd3; --card: #ffffff; --ok: #0b6b4f; --bad: #b3261e; --wait: #8a6100; --code: #efede8 }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #171613; --fg: #eceae4; --muted: #a09c92; --line: #34322c; --card: #1f1e1a; --ok: #6fd3ae; --bad: #ff8a80; --wait: #e6bd5c; --code: #2a2823; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #171613; --fg: #eceae4; --muted: #a09c92; --line: #34322c; --card: #1f1e1a; --ok: #6fd3ae; --bad: #ff8a80; --wait: #e6bd5c; --code: #2a2823; color-scheme: dark }
body { background: var(--bg); color: var(--fg); font: 16px/1.6 -apple-system, "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif; padding-block: 32px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)) }
main { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px }
h1 { font-size: 26px; line-height: 1.3; margin: 0; text-wrap: balance }
h2 { font-size: 18px; line-height: 1.4; margin: 0; text-wrap: balance }
p { margin: 0 }
.meta { color: var(--muted); font-size: 14px }
.verdict { font-size: 18px; font-weight: 600 }
.counts { display: flex; flex-wrap: wrap; gap: 8px 20px; color: var(--muted); font-size: 14px }
.claim { background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--wait); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 8px; min-width: 0 }
.claim.proven { border-left-color: var(--ok) } .claim.refuted { border-left-color: var(--bad) }
.claim header { display: flex; flex-direction: column; gap: 4px }
.mark { font-size: 13px; font-weight: 700; color: var(--wait) } .proven .mark { color: var(--ok) } .refuted .mark { color: var(--bad) }
.how, .file { color: var(--muted); font-size: 14px; overflow-wrap: anywhere }
code { background: var(--code); border-radius: 4px; padding: 1px 5px; font: 13px/1.5 ui-monospace, "SF Mono", Menlo, monospace; overflow-wrap: anywhere }
.note { font-size: 15px; white-space: pre-wrap; overflow-wrap: anywhere }
.shots { display: flex; flex-wrap: wrap; gap: 12px }
figure { margin: 0; display: flex; flex-direction: column; gap: 4px; max-width: 100% }
img { max-width: 100%; max-height: 520px; border: 1px solid var(--line); border-radius: 8px; background: var(--code) }
figcaption { color: var(--muted); font-size: 12px; overflow-wrap: anywhere }
ul { margin: 0; padding-left: 20px }
main > section:not(.claim) { display: flex; flex-direction: column; gap: 12px }
`;

const LABEL: Record<Claim['status'], string> = { proven: '증명됨', refuted: '반증됨', unproven: '아직 안 보임', unchecked: '확인 못 함' };

/**
 * The one page the owner reads: what was asked, each thing that was claimed with whether it was shown and the
 * picture that shows it, and what could not be checked. Pictures are put inside the page, so the page is whole
 * wherever it is opened. `folder` is the contract's evidence folder; a claim's evidence paths are relative to it.
 */
export function evidencePage(contract: Contract, folder: string, extra: { summary?: string; took?: string; kept?: Kept } = {}): string {
  const picture = (path: string): string => inlinePicture(folder, path);
  const count = (status: Claim['status']): number => contract.claims.filter((claim) => claim.status === status).length;
  const left = contract.claims.filter((claim) => claim.status !== 'proven');
  const kept = extra.kept ?? null;
  const verdict = count('refuted') > 0 ? '반증된 것이 있습니다' : kept && kept.broken.length > 0 ? '전부터 지키던 것이 깨졌습니다' : count('unproven') > 0 ? '아직 보이지 않은 것이 있습니다' : count('unchecked') > 0 ? '보인 것은 전부 참이고, 확인하지 못한 것이 있습니다' : '전부 증명됐습니다';
  // What needs the owner first: what was shown false, then what nobody showed, then what could not be checked.
  const order: Record<Claim['status'], number> = { refuted: 0, unproven: 1, unchecked: 2, proven: 3 };
  const claims = [...contract.claims]
    .sort((a, b) => order[a.status] - order[b.status])
    .map(
      (claim) => `<section class="claim ${claim.status}">
  <header><span class="mark">${LABEL[claim.status]}</span><h2>${esc(claim.says)}</h2></header>
  <p class="how">${esc(claim.shownBy.kind)} · <code>${esc(claim.shownBy.ref)}</code></p>
  ${claim.note ? `<p class="note">${esc(claim.note)}</p>` : ''}
  ${claim.evidence.length > 0 ? `<div class="shots">${claim.evidence.map(picture).join('')}</div>` : ''}
</section>`,
    )
    .join('\n');
  return `<title>증거 ${esc(contract.id)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${PAGE_STYLE}</style>
<main>
  <p class="meta">계약 ${esc(contract.id)} · 레인 ${esc(contract.lane)}${contract.targets.length > 0 ? ` · ${esc(contract.targets.join(', '))}` : ''}${extra.took ? ` · ${esc(extra.took)}` : ''}</p>
  <h1>${esc(contract.request)}</h1>
  <p class="verdict">${verdict}</p>
  <p class="counts"><span>증명 ${count('proven')}</span><span>반증 ${count('refuted')}</span><span>아직 ${count('unproven')}</span><span>확인 못 함 ${count('unchecked')}</span></p>
  ${extra.summary ? `<p class="note">${esc(extra.summary)}</p>` : ''}
  ${claims}
  ${
    kept && kept.total > 0
      ? `<section><h2>전부터 지키던 것</h2>
  <p class="counts"><span>전체 ${kept.total}</span><span>이번에 다시 보임 ${kept.holds}</span><span>깨짐 ${kept.broken.length}</span><span>확인 못 함 ${kept.unchecked}</span><span>다시 안 봄 ${kept.notLooked}</span></p>
  ${kept.broken.map((item) => `<div class="claim refuted"><header><span class="mark">깨짐</span><h2>${esc(item.says)}</h2></header><p class="how"><code>${esc(item.key)}</code></p>${item.note ? `<p class="note">${esc(item.note)}</p>` : ''}</div>`).join('')}
  ${kept.changed.length > 0 ? `<p class="how">마지막으로 참이라고 보인 뒤 바뀐 검사 파일: ${kept.changed.map((path) => `<code>${esc(path)}</code>`).join(' ')}</p>` : ''}
</section>`
      : ''
  }
  ${kept && kept.retired.length > 0 ? `<section><h2>이 작업으로 물러난 약속</h2><ul>${kept.retired.map((item) => `<li>${esc(item.says)} <code>${esc(item.key)}</code>${item.late ? ' <b>(계약을 얼린 뒤에 적힘)</b>' : ''}<br>${esc(item.why)}</li>`).join('')}</ul></section>` : ''}
  ${contract.noticed.length > 0 ? `<section><h2>계약에 없지만 눈에 띈 것</h2>${contract.noticed.map((item) => `<div class="claim"><p class="note">${esc(item.text)}</p>${item.evidence.length > 0 ? `<div class="shots">${item.evidence.map(picture).join('')}</div>` : ''}</div>`).join('')}</section>` : ''}
  ${contract.amendments.length > 0 ? `<section><h2>얼린 뒤 고친 검사</h2><ul>${contract.amendments.map((a) => `<li><code>${esc(a.file)}</code> ${esc(a.why)}</li>`).join('')}</ul></section>` : ''}
  ${left.length > 0 ? `<section><h2>남은 것</h2><ul>${left.map((claim) => `<li>${LABEL[claim.status]}: ${esc(claim.says)}${claim.note ? ` (${esc(claim.note)})` : ''}</li>`).join('')}</ul></section>` : ''}
  ${contract.notDoing.length > 0 ? `<section><h2>하지 않은 것</h2><ul>${contract.notDoing.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></section>` : ''}
</main>
`;
}

export function writeEvidencePage(contract: Contract, folder: string, file: string, extra: { summary?: string; took?: string; kept?: Kept } = {}): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, evidencePage(contract, folder, extra));
  return file;
}

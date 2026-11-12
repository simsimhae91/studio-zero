import { lintInterfaceText, textSlopScore, type CardBox, type DesignContract, type InterfaceText, type TextSlopHit } from '@studio-zero/design';
import type { AuditReport, Finding, ViewportId } from '@studio-zero/protocol';
import type { DigestElement, PageDigest } from '../qa/collector.ts';

export type ScreenText = NonNullable<AuditReport['copy']>['texts'][number];

const MAX_TEXTS_PER_ROUTE = 150;
const HEADING_TAGS = new Set(['h1', 'h2', 'h3']);
const CTA_TAGS = new Set(['button', 'a', 'summary']);
const CTA_ROLES = new Set(['button', 'link', 'tab', 'menuitem']);

function roleOf(e: DigestElement): InterfaceText['role'] {
  if (e.interactive && (CTA_TAGS.has(e.tag) || CTA_ROLES.has(e.role))) return 'cta';
  if (HEADING_TAGS.has(e.tag) || (e.fontSize >= 24 && e.textLength <= 80)) return 'title';
  return e.textLength >= 15 || e.tag === 'p' || e.tag === 'li' ? 'body' : 'label';
}

export interface CopyAudit {
  /** The screen's words in reading order, with what each is. Nothing of how they were rendered. */
  texts: ScreenText[];
  findings: Finding[];
  hits: TextSlopHit[];
}

/**
 * Reads a screen's copy apart from its rendering. A design reviewer looking at a screenshot judges a page as a
 * picture, and well-set type makes generated prose look considered; so the words are lifted out of the DOM,
 * put in reading order, and judged as words. This is the deterministic half: the Korean copy lint, whose hits
 * go back to the builder as findings with the exact wording, the element and the rule. The same text block is
 * what the acceptance reviewer is shown (`copyBlock`), with no picture beside it.
 *
 * Code and terminal output are not copy: text set in the monospace face is left out.
 */
export function auditCopy(digest: PageDigest, at: { viewport: ViewportId; route: string }, c: DesignContract): CopyAudit {
  const written = digest.elements
    .filter((e) => e.text.trim() !== '' && e.fontSize > 0 && !c.fonts.mono.includes(e.fontFamily))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, MAX_TEXTS_PER_ROUTE);
  const items = written.map((e): InterfaceText => ({ role: roleOf(e), text: e.text.trim() }));
  const boxes = digest.elements.filter((e) => e.text === '' && !e.interactive && e.siblingKey !== '');
  const cards = boxes.map((e): CardBox => ({ group: e.siblingKey, x: e.x, y: e.y, w: e.w, h: e.h }));
  const hits = lintInterfaceText(items, cards);

  const findings = hits.map((hit): Finding => {
    const el = hit.pattern === 'uniform-card-grid' ? boxes[hit.index] : written[hit.index];
    return {
      rule: `copy/${hit.pattern}`,
      category: hit.pattern === 'uniform-card-grid' ? 'hierarchy' : 'copy',
      severity: hit.severity,
      source: 'dom',
      viewport: at.viewport,
      route: at.route,
      message: hit.message,
      selector: el?.selector ?? null,
      bbox: el ? { x: el.x, y: el.y, w: el.w, h: el.h } : null,
      fix: hit.fix,
      file: null,
      line: null,
    };
  });
  return { texts: items.map((item) => ({ route: at.route, ...item })), findings, hits };
}

/** Folds the copy of every audited screen into what the report keeps: each route's fullest text, and one score. */
export function summariseCopy(audits: readonly CopyAudit[]): NonNullable<AuditReport['copy']> {
  // A route is rendered at several sizes and a narrow one hides some of its text: keep the rendering that shows most.
  const byRoute = new Map<string, ScreenText[]>();
  for (const audit of audits) {
    const route = audit.texts[0]?.route;
    if (route !== undefined && audit.texts.length > (byRoute.get(route)?.length ?? 0)) byRoute.set(route, audit.texts);
  }
  // The same habit in the same words at three viewports is one habit.
  const distinct = new Map<string, TextSlopHit>();
  for (const audit of audits) for (const hit of audit.hits) distinct.set(`${audit.texts[0]?.route ?? ''}|${hit.pattern}|${hit.quote}`, hit);
  const hits = [...distinct.values()];
  return { texts: [...byRoute.values()].flat(), slopScore: textSlopScore(hits), habits: hits.length };
}

const ROLE_MARK: Record<ScreenText['role'], string> = { title: '#', body: ' ', cta: '>', label: '·' };

/**
 * The pure text block: every word on the audited screens, route by route, and nothing else. `#` marks a title,
 * `>` a control's label, `·` a short label. It is page content, so a caller fences it as data.
 */
export function copyBlock(texts: readonly ScreenText[], maxChars = 12_000): string {
  const lines: string[] = [];
  let route: string | null = null;
  for (const t of texts) {
    if (t.route !== route) lines.push(`[${(route = t.route)}]`);
    lines.push(`${ROLE_MARK[t.role]} ${t.text}`);
  }
  const block = lines.join('\n');
  return block.length > maxChars ? `${block.slice(0, maxChars)}\n(cut)` : block;
}

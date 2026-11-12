import { blend, contractFamilies, contrastRatio, hueSaturation, isAllowedRadius, isDisplayInProportion, isLargeText, isOnTypeScale, type DesignContract, type Rgb } from '@studio-zero/design';
import { UNREVIEWED_SCORE_CAP, type DesignGrade, type Finding, type FindingCategory, type Severity, type ViewportId } from '@studio-zero/protocol';
import type { DigestElement, PageDigest } from './collector.ts';

export interface CheckContext {
  viewport: ViewportId;
  /** CSS-pixel width of the emulated device. */
  viewportWidth: number;
  route: string;
  /** Touch viewports get target-size checks. */
  touch: boolean;
  /** 'full' on the primary (light) pass; the dark pass re-checks only what a colour scheme can change. */
  scope: 'full' | 'color-only';
}

const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'cursive', 'fantasy', '-apple-system', 'blinkmacsystemfont']);
const EMOJI = /[\p{Extended_Pictographic}](?<![©®™])/u;

const near = (a: number, b: number, tolerance = 0.5): boolean => Math.abs(a - b) <= tolerance;
const rgbOf = (c: readonly [number, number, number, number]): Rgb => [c[0], c[1], c[2]];
const round = (n: number, digits = 1): number => Number(n.toFixed(digits));

/**
 * The measured half of the Slop Audit. Everything here is arithmetic on what the browser rendered, so it is
 * repeatable, costs no tokens and cannot be argued with. The vision model is only asked about what cannot be
 * measured (hierarchy, cadence, tone), and is told which defects were already found here.
 */
export function runDomChecks(digest: PageDigest, ctx: CheckContext, c: DesignContract): Finding[] {
  const findings: Finding[] = [];
  const add = (rule: string, category: FindingCategory, severity: Severity, message: string, fix: string, el?: DigestElement): void => {
    findings.push({
      rule,
      category,
      severity,
      source: 'dom',
      viewport: ctx.viewport,
      route: ctx.route,
      message,
      selector: el?.selector ?? null,
      bbox: el ? { x: round(el.x), y: round(el.y), w: round(el.w), h: round(el.h) } : null,
      fix,
      file: null,
      line: null,
    });
  };
  /** Reports the worst offenders of one rule and folds the rest into a count, so one mistake repeated 40× stays readable. */
  const addTop = <T>(items: T[], limit: number, emit: (item: T, rest: number) => void): void => {
    items.slice(0, limit).forEach((item, i) => emit(item, i === limit - 1 ? Math.max(0, items.length - limit) : 0));
  };

  const texts = digest.elements.filter((e) => e.text !== '' && e.fontSize > 0);
  // Code and terminal output are set in the monospace face and judged as such: the reading-size, measure and
  // leading rules below are about prose.
  const prose = texts.filter((e) => !c.fonts.mono.includes(e.fontFamily));

  // 1. Contrast (WCAG 1.4.3 AA / 1.4.6 AAA) -------------------------------------------------------------
  const lowContrast = texts
    .filter((e) => !e.backgroundIndeterminate)
    .map((e) => {
      const ratio = contrastRatio(blend(rgbOf(e.color), e.color[3], rgbOf(e.background)), rgbOf(e.background));
      const large = isLargeText(e.fontSize, e.fontWeight);
      return { e, ratio, required: large ? c.contrast.largeText : c.contrast.text, aa: large ? 3 : 4.5 };
    })
    .filter((x) => x.ratio < x.required - 0.05)
    .sort((a, b) => a.ratio / a.required - b.ratio / b.required);
  const seenPairs = new Set<string>();
  const distinctLowContrast = lowContrast.filter((x) => {
    const key = `${x.e.color.map((v) => v.toFixed(2)).join()}|${x.e.background.map((v) => v.toFixed(2)).join()}|${x.required}`;
    return seenPairs.has(key) ? false : (seenPairs.add(key), true);
  });
  addTop(distinctLowContrast, 6, ({ e, ratio, required, aa }, rest) =>
    add(
      'contrast/text',
      'contrast',
      ratio < aa ? 'blocker' : 'major',
      `"${e.text.slice(0, 40)}" has contrast ${ratio.toFixed(2)}:1; ${required}:1 is required (WCAG AAA${ratio < aa ? `, and it fails AA ${aa}:1` : ''})${rest ? `. ${rest} more colour pairs fail.` : ''}`,
      'Use text-fg or text-fg-muted on bg-bg / bg-surface / bg-sunken, and text-on-accent on bg-accent. Those pairs are solved to AAA; do not lighten text with opacity.',
      e,
    ),
  );

  if (ctx.scope === 'color-only') return findings;

  // 2. Rendered at all? ---------------------------------------------------------------------------------
  if (texts.length === 0 || digest.scrollHeight < 80) {
    add('render/blank', 'responsive', 'blocker', 'The page rendered no visible text.', 'Check the dev server log and the browser console for a build or runtime error on this route.');
    return findings;
  }

  // 3. Responsive breakage ------------------------------------------------------------------------------
  if (digest.width > ctx.viewportWidth + 1) {
    add(
      'responsive/missing-viewport-meta',
      'responsive',
      'blocker',
      `The page lays out at ${Math.round(digest.width)}px on a ${ctx.viewportWidth}px device, so phones show it zoomed out.`,
      'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the document head.',
    );
  }
  if (digest.scrollWidth > digest.width + 1) {
    const offenders = digest.elements.filter((e) => e.x + e.w > digest.width + 1 && e.w <= digest.scrollWidth).sort((a, b) => b.x + b.w - (a.x + a.w));
    add(
      'responsive/horizontal-overflow',
      'responsive',
      'blocker',
      `The page is ${Math.round(digest.scrollWidth)}px wide in a ${digest.width}px viewport and scrolls sideways.`,
      'Find the element with a fixed width or unwrapped row and give it max-w-full / min-w-0 / flex-wrap; never fix this with overflow-x-hidden on the body.',
      offenders[0],
    );
  }
  addTop(
    texts.filter((e) => e.clipped),
    3,
    (e, rest) => add('responsive/clipped-text', 'responsive', 'major', `"${e.text.slice(0, 40)}" is cut off inside its box${rest ? ` (${rest} more)` : ''}.`, 'Let the text wrap (remove truncate / fixed height) or shorten the copy.', e),
  );

  // 4. Touch targets (WCAG 2.5.5 AAA, 2.5.8 AA) ---------------------------------------------------------
  if (ctx.touch) {
    const small = digest.elements
      // Links inside a sentence are exempt, as in the WCAG target-size exceptions.
      .filter((e) => e.interactive && !(e.inline && e.tag === 'a') && (e.w < c.touchTargetPx - 0.5 || e.h < c.touchTargetPx - 0.5))
      .sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h));
    addTop(small, 6, (e, rest) =>
      add(
        'touch/target-size',
        'touch-target',
        Math.min(e.w, e.h) < 24 ? 'blocker' : 'major',
        `${e.tag}${e.text ? ` "${e.text.slice(0, 30)}"` : ''} is ${Math.round(e.w)}×${Math.round(e.h)}px; touch targets need ${c.touchTargetPx}×${c.touchTargetPx}px${rest ? `. ${rest} more are too small.` : ''}`,
        `Give the control min-h-11 min-w-11 (44px), or padding that reaches it; keep the icon size and grow the hit area.`,
        e,
      ),
    );
  }

  // 5. Typography ---------------------------------------------------------------------------------------
  const sizes = [...new Set(texts.map((e) => round(e.fontSize)))].sort((a, b) => a - b);
  const offScale = sizes.filter((s) => !isOnTypeScale(s, c));
  if (offScale.length > 0) {
    const example = texts.find((e) => near(e.fontSize, offScale[0]!, 0.06));
    add('type/off-scale', 'typography', 'major', `Font sizes outside the type scale: ${offScale.map((s) => `${s}px`).join(', ')}.`, `Use text-xs … text-10xl (${c.typeScalePx.join(', ')}px). Above ${c.display.fromPx}px a headline may be fluid, up to ${c.display.maxPx}px.`, example);
  }
  // Display type is allowed, in proportion: a headline that dwarfs its body is a shout, one barely above it is not a headline.
  const largest = sizes.at(-1) ?? 0;
  if (largest > c.display.fromPx) {
    const running = prose.filter((e) => e.textLength >= 40);
    const body = running.length > 0 ? Math.min(...running.map((e) => e.fontSize)) : c.minBodyPx;
    if (!isDisplayInProportion(largest, body, c)) {
      add(
        'type/display-ratio',
        'typography',
        'major',
        `The headline is ${largest}px over ${round(body)}px body text (${round(largest / body)} times). Display type holds between ${c.display.ratioToBody[0]} and ${c.display.ratioToBody[1]} times the body, and stops at ${c.display.maxPx}px.`,
        'Bring the two toward each other: raise the body size, or lower the headline, until the ratio is inside the range.',
        texts.find((e) => near(e.fontSize, largest, 0.06)),
      );
    }
  }
  if (sizes.length > c.maxFontSizesPerView) {
    add('type/too-many-sizes', 'typography', 'minor', `${sizes.length} font sizes on one view (${sizes.join(', ')}px); more than ${c.maxFontSizesPerView} flattens the hierarchy.`, 'Merge neighbouring sizes and separate levels with weight, colour (text-fg vs text-fg-muted) and space instead.');
  }
  addTop(
    prose.filter((e) => e.textLength >= 60 && e.fontSize < c.minBodyPx - 0.5),
    2,
    (e) => add('type/small-body', 'typography', 'major', `Running text is set at ${round(e.fontSize)}px; the minimum is ${c.minBodyPx}px.`, 'Set paragraphs in text-base or larger. text-sm and text-xs are for labels and metadata only.', e),
  );
  addTop(
    // charsPerLine > 0 means the text wraps: leading only matters for multi-line text.
    prose.filter((e) => e.textLength >= 120 && e.charsPerLine > 0 && (e.lineHeight < c.lineHeight.body[0] - 0.02 || e.lineHeight > c.lineHeight.body[1] + 0.02)),
    2,
    (e) => add('type/line-height', 'typography', 'minor', `Paragraph line-height is ${e.lineHeight.toFixed(2)}; body text reads best between ${c.lineHeight.body[0]} and ${c.lineHeight.body[1]}.`, 'Use the line-height that ships with the text-* step (do not add leading-none / leading-tight to paragraphs).', e),
  );
  addTop(
    prose.filter((e) => e.charsPerLine > c.maxLineLengthCh * 1.15),
    2,
    (e) => add('type/line-length', 'typography', 'minor', `Lines run to about ${Math.round(e.charsPerLine)} characters; keep running text under ${c.maxLineLengthCh}.`, `Constrain the text column (max-w-prose or max-inline-size: ${c.maxLineLengthCh}ch).`, e),
  );
  const families = [...new Set(texts.map((e) => e.fontFamily))];
  const allowed = contractFamilies(c);
  const foreign = families.filter((f) => f !== '' && !GENERIC_FAMILIES.has(f.toLowerCase()) && !allowed.includes(f));
  if (foreign.length > 0) {
    add('type/foreign-font', 'typography', 'major', `Text is set in ${foreign.join(', ')}, which is not a theme font.`, 'Use font-sans, font-display or font-mono from the theme.', texts.find((e) => e.fontFamily === foreign[0]));
  }
  const intended = families.filter((f) => [c.fonts.sans[0], c.fonts.sans[1], c.fonts.mono[0]].includes(f));
  const missing = intended.filter((f) => !digest.loadedFonts.includes(f));
  if (missing.length > 0 && !intended.some((f) => digest.loadedFonts.includes(f))) {
    add('type/font-not-loaded', 'typography', 'major', `${missing.join(', ')} is requested but no theme font was loaded, so a system fallback is what users see.`, 'Self-host the font files (e.g. the geist and pretendard packages) and load them with @font-face / next/font; do not rely on them being installed.');
  }

  // 6. Spacing rhythm -----------------------------------------------------------------------------------
  const spacings = digest.elements.flatMap((e) => [...e.padding, ...e.margin.filter((m) => m > 0), e.gap].filter((v) => v >= 1).map((v) => ({ e, v })));
  const offGrid = spacings.filter(({ v }) => !near(v % c.spacingUnitPx, 0) && !near(v % c.spacingUnitPx, c.spacingUnitPx));
  if (offGrid.length >= 3 && offGrid.length / spacings.length > 0.1) {
    const values = [...new Set(offGrid.map(({ v }) => round(v)))].slice(0, 6);
    add(
      'spacing/off-grid',
      'spacing',
      offGrid.length / spacings.length > 0.3 ? 'major' : 'minor',
      `${Math.round((offGrid.length / spacings.length) * 100)}% of paddings, margins and gaps are off the ${c.spacingUnitPx}px grid (e.g. ${values.join(', ')}px).`,
      `Use spacing utilities (multiples of ${c.spacingUnitPx}px). Uneven values are what make a layout feel assembled rather than designed.`,
      offGrid[0]!.e,
    );
  }

  // 7. Corner radii -------------------------------------------------------------------------------------
  const cornered = digest.elements.filter((e) => e.radius > 0 && e.radius < Math.min(e.w, e.h) / 2 - 0.5 && e.radius < 999);
  const radii = [...new Set(cornered.map((e) => round(e.radius)))].sort((a, b) => a - b);
  // Radii are a range, not a set: only a curve past the ceiling that is not a capsule is off contract.
  const offRadii = radii.filter((r) => !isAllowedRadius(r, c));
  if (offRadii.length > 0) {
    add('shape/off-scale-radius', 'originality', 'minor', `Corner radii past ${c.radius.maxPx}px that are not full pills: ${offRadii.map((r) => `${r}px`).join(', ')}.`, 'Use rounded-sm to rounded-xl for containers; rounded-full for avatars and pill controls.', cornered.find((e) => near(e.radius, offRadii[0]!, 0.06)));
  }
  if (radii.length > c.maxDistinctRadiiPerView) {
    add('shape/too-many-radii', 'originality', 'minor', `${radii.length} different corner radii on one view (${radii.join(', ')}px).`, 'Tie radius to hierarchy: one for controls, one for containers.');
  }

  // 8. Signatures of generated interfaces ---------------------------------------------------------------
  for (const e of digest.elements) {
    if (!e.backgroundImage.includes('gradient(')) continue;
    const stops = [...e.backgroundImage.matchAll(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/g)].map((m) => hueSaturation([Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255]));
    const cliche = stops.filter((s) => s.saturation > 0.35 && s.lightness > 0.2 && s.lightness < 0.85 && s.hue >= c.clicheGradientHues.from && s.hue <= c.clicheGradientHues.to);
    if (cliche.length >= 2) {
      add('slop/cliche-gradient', 'color', 'major', 'A blue-to-purple gradient fills this element: the most recognisable mark of a generated page.', 'Replace it with a flat token colour and let type and spacing carry the emphasis.', e);
      break;
    }
  }
  addTop(
    texts.filter((e) => e.uppercase && e.letterSpacingEm > 0.04 && e.fontSize <= 14 && e.textLength <= 40),
    1,
    (e, rest) => add('slop/caps-eyebrow', 'typography', 'minor', `Tracked-out all-caps label "${e.text.slice(0, 30)}"${rest ? ` and ${rest} more` : ''}.`, 'Sentence case, text-sm, text-fg-muted; or delete the label if the heading already says it.', e),
  );
  addTop(
    texts.filter((e) => EMOJI.test(e.text)),
    1,
    (e) => add('slop/emoji-as-icon', 'originality', 'major', `Emoji used as interface decoration in "${e.text.slice(0, 30)}".`, 'Use an icon from the icon set or no icon.', e),
  );
  const groups = new Map<string, DigestElement[]>();
  for (const e of digest.elements) {
    if (e.text !== '' || e.interactive || e.w < 120 || e.h < 80 || e.siblingKey === '') continue;
    const key = `${e.siblingKey}|${Math.round(e.w)}x${Math.round(e.h)}|${round(e.radius)}|${e.shadow}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const cardGrid = [...groups.values()].find((g) => g.length >= 3 && g[0]!.shadow !== 'none' && g[0]!.radius >= 8);
  if (cardGrid) {
    add('slop/identical-cards', 'originality', 'minor', `${cardGrid.length} identical rounded, shadowed cards in a row: the stock feature-grid layout.`, 'Ask whether these items are really equal. Lead with the one that matters, or use a plain list or table; drop the shadow and let a border or surface colour group them.', cardGrid[0]);
  }

  return findings;
}

/** What a ledger's pass rates are counted from: the same elements the contrast and target-size checks above read. */
export interface AccessMeasures {
  contrast: { passed: number; total: number };
  touchTargets: { passed: number; total: number };
}

export function measureAccess(digest: PageDigest, ctx: Pick<CheckContext, 'touch'>, c: DesignContract): AccessMeasures {
  const texts = digest.elements.filter((e) => e.text !== '' && e.fontSize > 0 && !e.backgroundIndeterminate);
  const clear = texts.filter((e) => contrastRatio(blend(rgbOf(e.color), e.color[3], rgbOf(e.background)), rgbOf(e.background)) >= (isLargeText(e.fontSize, e.fontWeight) ? c.contrast.largeText : c.contrast.text) - 0.05);
  const targets = ctx.touch ? digest.elements.filter((e) => e.interactive && !(e.inline && e.tag === 'a')) : [];
  const sized = targets.filter((e) => e.w >= c.touchTargetPx - 0.5 && e.h >= c.touchTargetPx - 0.5);
  return { contrast: { passed: clear.length, total: texts.length }, touchTargets: { passed: sized.length, total: targets.length } };
}

const PENALTY: Record<Severity, number> = { blocker: 14, major: 5, minor: 1.5 };
/** One noisy rule cannot zero the score by itself. */
const PER_RULE_CAP = 20;

const RANK: Record<Severity, number> = { blocker: 2, major: 1, minor: 0 };

/**
 * Collapses findings to distinct defects. The same rule on the same element of the same route is one thing to
 * fix however many viewports it shows up at, so it is scored once, at its worst severity. The report keeps
 * every occurrence; only scoring and counts use this view.
 */
export function distinctDefects(findings: readonly Finding[]): Finding[] {
  const defects = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.rule}|${f.route ?? ''}|${f.selector ?? ''}|${f.file ?? ''}:${f.line ?? ''}`;
    const seen = defects.get(key);
    if (!seen || RANK[f.severity] > RANK[seen.severity]) defects.set(key, f);
  }
  return [...defects.values()];
}

/** How much of a reviewed audit's score is measurement. The rest is the design reviewer's judgement. */
export const MEASURED_WEIGHT = 0.4;
/** Findings of the copy lint (`harness/TextSlopAuditor.ts`). */
export const COPY_RULE_PREFIX = 'copy/';

/** Above this slop score a screen reads as generated, and the audit does not pass whatever else it scored. */
export const SLOP_PASS_MAX = 30;
/** From this slop score up the grade is F. */
export const SLOP_FAIL = 60;
export { UNREVIEWED_SCORE_CAP };

export interface AuditScore {
  score: number;
  passed: boolean;
  blockers: number;
  majors: number;
  minors: number;
}

/**
 * The arithmetic. `rubric` and `slopScore` are a reviewer's judgement; with neither, the score is the measured
 * one. A caller that reports a design verdict wants `gradeAudit`, which knows the difference between "no
 * judgement was asked for" and "no judgement could be had".
 */
export function scoreAudit(all: readonly Finding[], rubric: Record<string, number> | null, threshold: number, slopScore: number | null = null): AuditScore {
  const findings = distinctDefects(all);
  const perRule = new Map<string, number>();
  for (const f of findings) perRule.set(f.rule, Math.min(PER_RULE_CAP, (perRule.get(f.rule) ?? 0) + PENALTY[f.severity]));
  const measured = Math.max(0, 100 - [...perRule.values()].reduce((a, b) => a + b, 0));
  const taste = rubric && Object.keys(rubric).length > 0 ? (Object.values(rubric).reduce((a, b) => a + b, 0) / Object.keys(rubric).length) * 10 : null;
  // Half of the judged part is how little the screen reads as generated, when the reviewer said.
  const judged = taste === null ? null : slopScore === null ? taste : (taste + (100 - slopScore)) / 2;
  // Judgement outweighs tidiness. Measured on tidiness alone, the plainer a screen the higher it scores: a
  // sparse mock-up beats the best sites in the field. So the measured part is the smaller share of the number.
  // What measurement keeps is its veto: a blocker fails the audit whatever the reviewer thought of the rest.
  const score = round(judged === null ? measured : measured * MEASURED_WEIGHT + judged * (1 - MEASURED_WEIGHT));
  const count = (s: Severity): number => findings.filter((f) => f.severity === s).length;
  const blockers = count('blocker');
  // Generated-sounding copy is held to zero, as source slop is: a habit the copy lint names is not averaged away.
  const copyHabits = findings.filter((f) => f.rule.startsWith(COPY_RULE_PREFIX) && f.severity !== 'minor').length;
  return { score, passed: blockers === 0 && copyHabits === 0 && score >= threshold && (slopScore === null || slopScore <= SLOP_PASS_MAX), blockers, majors: count('major'), minors: count('minor') };
}

export interface AuditVerdict extends AuditScore {
  /** Null when no reviewer saw every screen: an unreviewed design has no grade. */
  grade: DesignGrade | null;
}

/**
 * The verdict an audit reports. `judgement` is null when a design reviewer did not see every captured screen,
 * for whatever reason (switched off, nobody to ask, refused, failed). Then the audit does not pass and its
 * score is capped: a page can be measured clean and still be something no designer would ship, and a number
 * nobody's eye confirmed must not look like one somebody's did.
 */
export function gradeAudit(findings: readonly Finding[], judgement: { rubric: Record<string, number>; slopScore: number } | null, threshold: number): AuditVerdict {
  if (!judgement) {
    const measured = scoreAudit(findings, null, threshold);
    return { ...measured, score: Math.min(measured.score, UNREVIEWED_SCORE_CAP), passed: false, grade: null };
  }
  const result = scoreAudit(findings, judgement.rubric, threshold, judgement.slopScore);
  return { ...result, grade: gradeOf(result, judgement.slopScore) };
}

function gradeOf(result: AuditScore, slopScore: number): DesignGrade {
  if (slopScore >= SLOP_FAIL) return 'F';
  if (!result.passed) return result.blockers === 0 && result.score >= 70 ? 'C' : result.score >= 50 ? 'D' : 'F';
  if (result.score >= 95 && slopScore <= 10 && result.majors === 0) return 'S';
  return result.score >= 90 ? 'A' : 'B';
}

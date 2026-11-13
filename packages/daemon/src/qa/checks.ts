import { blend, contractFamilies, contrastRatio, hostedFamilies, hueSaturation, isAllowedRadius, isDisplayInProportion, isLargeText, isOnTypeScale, typeStepNames, type DesignContract, type Rgb } from '@studio-zero/design';
import { UNREVIEWED_SCORE_CAP, type DesignGrade, type Finding, type FindingCategory, type Severity, type Template, type ViewportId } from '@studio-zero/protocol';
import type { DigestElement, PageDigest } from './collector.ts';
import type { ProbedControl, Touchability } from './InteractionProbe.ts';

export interface CheckContext {
  viewport: ViewportId;
  /** CSS-pixel width of the emulated device. */
  viewportWidth: number;
  route: string;
  /** Touch viewports get target-size checks. */
  touch: boolean;
  /** 'full' on the primary (light) pass; the dark pass re-checks only what a colour scheme can change. */
  scope: 'full' | 'color-only';
  /** What the product is built as, when the caller knows: some rules hold for a phone app and not for a web page. */
  template?: Template;
}

const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'cursive', 'fantasy', '-apple-system', 'blinkmacsystemfont']);
const EMOJI = /[\p{Extended_Pictographic}](?<![©®™])/u;

const near = (a: number, b: number, tolerance = 0.5): boolean => Math.abs(a - b) <= tolerance;
const rgbOf = (c: readonly [number, number, number, number]): Rgb => [c[0], c[1], c[2]];
const round = (n: number, digits = 1): number => Number(n.toFixed(digits));

type Add = (rule: string, category: FindingCategory, severity: Severity, message: string, fix: string, el?: DigestElement) => void;

/** How every measured finding is made: where it was seen, what was measured, the fix, and the element when there is one to point at. */
function adder(findings: Finding[], ctx: Pick<CheckContext, 'viewport' | 'route'>): Add {
  return (rule, category, severity, message, fix, el) => {
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
}

/**
 * The measured half of the Slop Audit. Everything here is arithmetic on what the browser rendered, so it is
 * repeatable, costs no tokens and cannot be argued with. The vision model is only asked about what cannot be
 * measured (hierarchy, cadence, tone), and is told which defects were already found here.
 */
export function runDomChecks(digest: PageDigest, ctx: CheckContext, c: DesignContract): Finding[] {
  const findings: Finding[] = [];
  const add = adder(findings, ctx);
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
    add('type/off-scale', 'typography', 'major', `Font sizes outside the type scale: ${offScale.map((s) => `${s}px`).join(', ')}.`, `Use text-${typeStepNames[0]} … text-${typeStepNames[typeStepNames.length - 1]} (${c.typeScalePx.join(', ')}px). Above ${c.display.fromPx}px a headline may be fluid, up to ${c.display.maxPx}px.`, example);
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
  // A theme face the page asks for first has to have been loaded by the page, or what shows is the device's own.
  const hosted = hostedFamilies(c);
  const intended = families.filter((f) => hosted.includes(f));
  const missing = intended.filter((f) => !digest.loadedFonts.includes(f));
  if (missing.length > 0 && !intended.some((f) => digest.loadedFonts.includes(f))) {
    add('type/font-not-loaded', 'typography', 'major', `${missing.join(', ')} is requested but no theme font was loaded, so a system fallback is what users see.`, 'Self-host the font files (the pretendard package for the body face, the geist and fontsource packages for the others) and load them with @font-face / next/font; do not rely on them being installed.');
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

  // 9. How the first screen is put together -----------------------------------------------------------
  findings.push(...compositionFindings(digest, ctx));

  return findings;
}

/**
 * Where a number read of a screen's composition becomes a finding. In one object so that the design lab can
 * set them from what it measures; these are first values, taken from the screens a real engine drew on
 * 2026-11-13. The sizes that define small text (12px and under) and a figure (28px and up) are the
 * collector's: it runs in the page and can read nothing from here.
 */
export const COMPOSITION_LIMITS = {
  /** Share of the first screen's characters set at 12px or under. Above it, small text is carrying the screen. */
  microShare: 0.4,
  /** Small text of this many characters or more is a sentence, not a label. */
  sentenceChars: 24,
  /** Text turned further than this many degrees has to be read with a tilted head. */
  turnDegrees: 15,
  /** This many things at the largest size compete. Two are a comparison. */
  figuresAtLargest: 3,
  /** A card at least this tall, */
  cardMinHeightPx: 140,
  /** whose content reaches under this share of its height, was stretched past what it holds. */
  cardReach: 0.6,
  /** More than this many controls on the first screen of a touch device is a panel, not a screen. */
  controls: 9,
} as const;

/**
 * The handbook's rules of type and layout that can be counted, on what the collector read of the first
 * screenful. Each fix opens with the id of the handbook rule it enforces, so that what the engine was told to
 * do and what it is told it did not do are the same sentence. A digest read before composition was collected
 * says nothing here.
 */
export function compositionFindings(digest: PageDigest, ctx: CheckContext): Finding[] {
  const read = digest.composition;
  if (!read || ctx.scope !== 'full') return [];
  const findings: Finding[] = [];
  const add = adder(findings, ctx);
  const limits = COMPOSITION_LIMITS;
  /** The element a piece of text read by the collector is, when the digest kept it. */
  const at = (text: string): DigestElement | undefined => digest.elements.find((e) => e.text !== '' && e.text.slice(0, 60) === text);
  const more = (list: readonly unknown[]): string => (list.length > 1 ? ` (${list.length - 1} more)` : '');
  const quoted = (list: readonly string[], limit = 4): string => `${list.slice(0, limit).map((text) => `"${text}"`).join(', ')}${list.length > limit ? ` and ${list.length - limit} more` : ''}`;

  // T1: one face ------------------------------------------------------------------------------------------
  const faces = read.families.filter((family) => !GENERIC_FAMILIES.has(family.toLowerCase()));
  if (faces.length >= 2) {
    add(
      'type/second-family',
      'typography',
      'major',
      `Text on the first screen is set in ${faces.length} faces: ${faces.join(', ')}. A product has one.`,
      `T1: Set all of it in font-sans, which is ${faces[0]} on most of this screen. A title is the same face at weight 700 or 800, not another family: no second sans, no serif, no italics.`,
      digest.elements.find((e) => e.text !== '' && e.fontFamily === faces[1]),
    );
  }
  if (read.monoOutsideCode.length > 0) {
    add(
      'type/mono-outside-code',
      'typography',
      'major',
      `"${read.monoOutsideCode[0]}" is set in a monospace face outside a code block${more(read.monoOutsideCode)}.`,
      'T1: Monospace is for code, pre, kbd and samp. Set dates and figures in font-sans with tabular-nums (font-variant-numeric: tabular-nums), which lines the digits up without changing the face.',
      at(read.monoOutsideCode[0]!),
    );
  }

  // T3: the budget of small text --------------------------------------------------------------------------
  if (read.microShare > limits.microShare) {
    add(
      'type/micro-overuse',
      'typography',
      'major',
      `${Math.round(read.microShare * 100)}% of the characters on the first screen are set at 12px or under. About a third is the budget, and ${Math.round(limits.microShare * 100)}% the limit.`,
      'T3: text-xs and text-2xs are for a time, a unit, a badge, a stat label and a table head. Set what the screen is there to say at text-base (16px) and what supports it at text-sm (14px), and leave only those labels small.',
    );
  }
  const sentences = read.microSentences.filter((text) => [...text].length >= limits.sentenceChars);
  if (sentences.length > 0) {
    add(
      'type/micro-sentence',
      'typography',
      'minor',
      `A sentence is set at the size of a label (12px or under): "${sentences[0]}"${more(sentences)}.`,
      'T3: A sentence is read, so set it at text-sm (14px) or larger; or cut it down to the label it is standing in for.',
      at(sentences[0]!),
    );
  }

  // T5: text stands level and runs across -----------------------------------------------------------------
  const turned = read.turnedText.flatMap((entry) => {
    const [, text, degrees] = /^(.*) \((\d+)deg\)$/s.exec(entry) ?? [];
    return text !== undefined && Number(degrees) > limits.turnDegrees ? [{ text, degrees: Number(degrees) }] : [];
  });
  if (turned.length > 0) {
    add(
      'type/turned-text',
      'typography',
      'major',
      `"${turned[0]!.text}" is turned ${turned[0]!.degrees} degrees${more(turned)}.`,
      'T5: Text stands level. Take the rotation off the label and set it across; if it does not fit there, shorten it or put it above what it names.',
      at(turned[0]!.text),
    );
  }
  if (read.stackedText.length > 0) {
    add(
      'type/stacked-text',
      'typography',
      'major',
      `"${read.stackedText[0]}" is stacked one character to a line${more(read.stackedText)}.`,
      'T5: Text runs across. Give the label the width of its words (above or beside the column it names), and use neither a vertical writing-mode nor a box one character wide.',
      at(read.stackedText[0]!),
    );
  }

  // T6: words start at the start side ---------------------------------------------------------------------
  if (read.endAlignedText.length > 0) {
    add(
      'type/end-aligned-block',
      'typography',
      'minor',
      `"${read.endAlignedText[0]}" is aligned to the end side${more(read.endAlignedText)}.`,
      'T6: Words start at the start side (text-start). The end side is for figures in a column, and the centre for one figure or an empty state.',
      at(read.endAlignedText[0]!),
    );
  }

  // M3: one figure ----------------------------------------------------------------------------------------
  if (read.figuresAtLargest.length >= limits.figuresAtLargest) {
    add(
      'layout/competing-figures',
      'hierarchy',
      'major',
      `${read.figuresAtLargest.length} things are set at the largest size on the first screen: ${quoted(read.figuresAtLargest)}. With that many, none of them is the figure.`,
      'M3: One thing per screen is set at figure size. Keep the one the screen is about and bring the others down a step or more. Two values being compared sit in one comparison block at the same size, and the difference is said once.',
      at(read.figuresAtLargest[0]!),
    );
  }

  // M5: what holds things ---------------------------------------------------------------------------------
  const stretched = read.halfEmptyCards.filter((card) => card.h >= limits.cardMinHeightPx && card.reach < limits.cardReach).sort((a, b) => a.reach - b.reach);
  if (stretched.length > 0) {
    const card = stretched[0]!;
    add(
      'layout/half-empty-card',
      'spacing',
      'minor',
      `A ${card.w}×${card.h}px card is filled to ${Math.round(card.reach * 100)}% of its height: it was stretched past what it holds${more(stretched)}.`,
      'M5: A container is as tall as its content. Remove the fixed height or the stretch that matches it to a neighbour (items-start on the row); twins of one height belong on one surface with a divider between them.',
      digest.elements.find((e) => e.selector === card.selector),
    );
  }
  if (read.nestedCards > 0) {
    add(
      'layout/nested-cards',
      'hierarchy',
      'minor',
      `${read.nestedCards} card${read.nestedCards === 1 ? ' sits' : 's sit'} inside another card on the first screen.`,
      'M5: No card inside a card. Keep one surface: set what is inside as sections on it (a title and its content, a hairline between them), or drop the outer card and let the page hold the inner ones.',
    );
  }

  // M7: density, where a thumb does the pressing ----------------------------------------------------------
  if (ctx.touch && read.controls > limits.controls) {
    add(
      'layout/too-many-controls',
      'hierarchy',
      'major',
      `${read.controls} controls can be pressed on the first screen; ${limits.controls} is the limit.`,
      'M7: A first screen offers up to 7 controls beside its rows and app bar. Keep the main action in the dock, move the rest into a sheet or onto the screen a row opens, and let a row be pressed whole in place of carrying buttons.',
    );
  }

  // M4: said once -----------------------------------------------------------------------------------------
  if (read.figuresTwice.length > 0) {
    add(
      'copy/figure-twice',
      'copy',
      'minor',
      `The same figure is stated more than once on the first screen: ${read.figuresTwice.slice(0, 4).join(', ')}${read.figuresTwice.length > 4 ? ` and ${read.figuresTwice.length - 4} more` : ''}.`,
      'M4: Say it once. A date, a round, a gap, a name and a score each appear in one place: keep the one where it is read and delete the other (a badge and a sentence that give the same number are one too many).',
    );
  }

  return findings;
}

/** What a ledger's pass rates are counted from: the same elements the contrast and target-size checks above read. */
export interface AccessMeasures {
  contrast: { passed: number; total: number };
  touchTargets: { passed: number; total: number };
  /** Filled in by the interaction probe, on the routes it tried. */
  pressAnswer: { passed: number; total: number };
  focusVisible: { passed: number; total: number };
  /** The largest layout shift a route had while loading; null when none was measured. */
  layoutShift: number | null;
}

export function measureAccess(digest: PageDigest, ctx: Pick<CheckContext, 'touch'>, c: DesignContract): Pick<AccessMeasures, 'contrast' | 'touchTargets'> {
  const texts = digest.elements.filter((e) => e.text !== '' && e.fontSize > 0 && !e.backgroundIndeterminate);
  const clear = texts.filter((e) => contrastRatio(blend(rgbOf(e.color), e.color[3], rgbOf(e.background)), rgbOf(e.background)) >= (isLargeText(e.fontSize, e.fontWeight) ? c.contrast.largeText : c.contrast.text) - 0.05);
  const targets = ctx.touch ? digest.elements.filter((e) => e.interactive && !(e.inline && e.tag === 'a')) : [];
  const sized = targets.filter((e) => e.w >= c.touchTargetPx - 0.5 && e.h >= c.touchTargetPx - 0.5);
  return { contrast: { passed: clear.length, total: texts.length }, touchTargets: { passed: sized.length, total: targets.length } };
}

/** A page that shifts more than this as it loads is past what the web-vitals scale calls good. */
export const LAYOUT_SHIFT_GOOD = 0.1;

/**
 * What trying a screen found, as findings. A control that gives nothing back while it is held, and a keyboard
 * focus that cannot be seen, are each named with where they are. Like the rest of this file they are
 * arithmetic on what the browser did: nobody judged them.
 *
 * `loadShift` is how far the page jumped while loading. It is reported and kept small in weight: the audit
 * looks at a dev server, which may put its styles in a moment after the first paint, and that jump is the
 * dev server's and not the product's.
 */
export function interactionFindings(probe: Touchability | null, loadShift: number | null, ctx: Pick<CheckContext, 'viewport' | 'route' | 'touch'>): Finding[] {
  const findings: Finding[] = [];
  const at = (rule: string, category: FindingCategory, severity: Severity, message: string, fix: string, control?: ProbedControl): void => {
    findings.push({ rule, category, severity, source: 'dom', viewport: ctx.viewport, route: ctx.route, message, selector: control?.selector ?? null, bbox: control ? { x: round(control.x - control.w / 2), y: round(control.y - control.h / 2), w: round(control.w), h: round(control.h) } : null, fix, file: null, line: null });
  };
  const named = (control: ProbedControl): string => (control.text ? `"${control.text.slice(0, 30)}"` : 'A control');
  if (probe) {
    probe.press.silent.slice(0, 4).forEach((control, i) => {
      const rest = i === Math.min(4, probe.press.silent.length) - 1 ? probe.press.silent.length - (i + 1) : 0;
      at(
        'touch/no-press-answer',
        'tactility',
        'major',
        `${named(control)} gives nothing back while it is held: the screen around it looks the same pressed as at rest${rest > 0 ? `. ${rest} more control(s) on this screen are the same.` : '.'} (${probe.press.answered} of ${probe.press.probed} controls tried answered.)`,
        'Give it a pressed state that can be seen: on the web an :active style on the control or on its row (a shift, a press-in, a change of surface) at --duration-fast; in a mobile project build it on Tactile or TactileButton instead of a bare Pressable.',
        control,
      );
    });
    probe.focus.hidden.slice(0, 4).forEach((control, i) => {
      const rest = i === Math.min(4, probe.focus.hidden.length) - 1 ? probe.focus.hidden.length - (i + 1) : 0;
      at(
        'focus/not-visible',
        'tactility',
        // A phone is rarely driven by a keyboard; a desk is. Where a keyboard is the way in, an invisible focus locks its user out (WCAG 2.4.7).
        ctx.touch ? 'minor' : 'major',
        `${named(control)} takes the keyboard's focus without showing it: focused and unfocused look the same${rest > 0 ? `. ${rest} more stop(s) are the same.` : '.'} (${probe.focus.visible} of ${probe.focus.probed} stops showed their focus.)`,
        'Leave the theme\'s :focus-visible ring on, or give the control one of its own: an outline of at least 2px in a colour that holds 3:1 against what is behind it. Do not set outline: none without a replacement.',
        control,
      );
    });
  }
  if (loadShift !== null && loadShift > LAYOUT_SHIFT_GOOD) {
    at('motion/layout-shift', 'responsive', 'minor', `The page jumps as it loads: cumulative layout shift ${loadShift.toFixed(2)} (${LAYOUT_SHIFT_GOOD} or less reads as steady).`, 'Reserve room for what arrives late: give pictures and embeds their width and height, keep a skeleton the size of the content it stands for, and load the fonts the theme names before first paint.');
  }
  return findings;
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

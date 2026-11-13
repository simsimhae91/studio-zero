import { z } from 'zod';

const Rgba = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const Box4 = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const DigestElement = z.object({
  id: z.string().max(8),
  tag: z.string().max(20),
  role: z.string().max(30),
  selector: z.string().max(300),
  /** The element's own text (not its descendants'), trimmed and capped. Page content: untrusted. */
  text: z.string().max(120),
  textLength: z.number(),
  interactive: z.boolean(),
  inline: z.boolean(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  color: Rgba,
  /** Background the text actually sits on: ancestors composited until opaque. */
  background: Rgba,
  /** True when an image or gradient lies behind the text, so contrast cannot be computed from styles. */
  backgroundIndeterminate: z.boolean(),
  ownBackground: Rgba,
  backgroundImage: z.string().max(400),
  fontSize: z.number(),
  fontWeight: z.number(),
  fontFamily: z.string().max(80),
  lineHeight: z.number(),
  letterSpacingEm: z.number(),
  uppercase: z.boolean(),
  radius: z.number(),
  padding: Box4,
  margin: Box4,
  gap: z.number(),
  shadow: z.string().max(200),
  hasBorder: z.boolean(),
  clipped: z.boolean(),
  charsPerLine: z.number(),
  siblingKey: z.string().max(120),
});
export type DigestElement = z.infer<typeof DigestElement>;

const Lines = z.array(z.string().max(80)).max(40);

/**
 * How the first screenful is put together: what the handbook's rules of type and layout are counted from.
 * Read off everything drawn there, text inside drawings included, where `elements` keeps only what a finding
 * can point at. The sizes that define small text (12px and under) and a figure (28px and up) are fixed where
 * this is read, in the page; how much of anything is too much is the checks' to say.
 */
export const Composition = z.object({
  /** Share, 0 to 1, of the characters written on the first screenful that are set at 12px or under. Text inside an svg is left out: the numerals of a chart are a drawing's labels. */
  microShare: z.number().min(0).max(1),
  /** Text at 12px or under long enough to be a phrase (12 characters or more), svg text left out. */
  microSentences: Lines,
  /** The first-named family of each piece of text, the one most is set in first. Monospace faces are left out: they are `monoOutsideCode`'s. */
  families: z.array(z.string().max(80)).max(12),
  /** Text in a monospace face that is not inside `code`, `pre`, `kbd` or `samp`. */
  monoOutsideCode: Lines,
  /** What is set at, or within 85% of, the largest size on the screen when that size is 28px or more. One entry for each block: a headline broken over three spans is one thing. */
  figuresAtLargest: Lines,
  /** Text turned more than 5 degrees by the transforms above it, each as `text (Ndeg)`. */
  turnedText: Lines,
  /** Hangul set one character to a line down a narrow box, and text in a vertical writing mode. */
  stackedText: Lines,
  /** Words (not figures) of 8 characters or more aligned to the end side. */
  endAlignedText: Lines,
  /** What can be pressed. A label and the box it sets are one control. */
  controls: z.number(),
  /** Cards 96px or taller whose content reaches under 0.8 of their inner height; `reach` is that share. */
  halfEmptyCards: z.array(z.object({ selector: z.string().max(300), w: z.number(), h: z.number(), reach: z.number() })).max(40),
  /** Cards that sit inside another card. */
  nestedCards: z.number(),
  /** A figure of two digits or more that is stated in more than one place, each as `63 x2`. Rows of one list that hold the same value are one place. */
  figuresTwice: Lines,
  /** Where pictures are (img, video, canvas, iframe, CSS background images), as x, y, width, height in CSS pixels of the viewport: what a count of the screen's colours leaves out. */
  mediaBoxes: z.array(Box4).max(80),
  /** The colour the screen is laid on: the canvas with every box that covers the whole viewport painted over it. */
  paper: z.tuple([z.number(), z.number(), z.number()]),
});
export type Composition = z.infer<typeof Composition>;

export const PageDigest = z.object({
  title: z.string().max(200),
  lang: z.string().max(20),
  width: z.number(),
  height: z.number(),
  scrollWidth: z.number(),
  scrollHeight: z.number(),
  /** Families the browser actually has loaded, e.g. to tell "Geist" from its fallback. */
  loadedFonts: z.array(z.string().max(80)).max(40),
  elements: z.array(DigestElement).max(700),
  /** Absent in digests stored before it was read, and when the page gave something that does not hold: the rest of the digest stands without it. */
  composition: Composition.optional().catch(undefined),
});
export type PageDigest = z.infer<typeof PageDigest>;

/**
 * Runs inside the audited page (serialised by Playwright, so it must not reference anything outside itself).
 * Measures what the browser actually rendered: boxes, resolved colours, computed type and spacing.
 * Its return value comes from an untrusted page and is validated against `PageDigest` before use.
 */
export function collectDigest(maxElements: number): unknown {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const colorCache = new Map<string, [number, number, number, number]>();
  // Resolve any CSS colour syntax (rgb, oklch, color-mix, …) to sRGB by letting the browser paint it.
  const rgba = (css: string): [number, number, number, number] => {
    const hit = colorCache.get(css);
    if (hit) return hit;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const out: [number, number, number, number] = [d[0]! / 255, d[1]! / 255, d[2]! / 255, d[3]! / 255];
    colorCache.set(css, out);
    return out;
  };
  const px = (v: string): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const selectorOf = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node !== document.body && parts.length < 4) {
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
        parts.unshift(`#${node.id}`);
        break;
      }
      let part = node.tagName.toLowerCase();
      const cls = [...node.classList].filter((c) => /^[A-Za-z][\w-]*$/.test(c)).slice(0, 2);
      if (cls.length) part += `.${cls.join('.')}`;
      const parent: Element | null = node.parentElement;
      if (parent) {
        const tag = node.tagName;
        const same = [...parent.children].filter((c) => c.tagName === tag);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ').slice(0, 300);
  };
  const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
  const INTERACTIVE_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'switch', 'option', 'combobox', 'slider']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'BR', 'WBR']);
  // Pictures have no text and no fill, but they take up the screen: a reviewer has to be able to point at one.
  const MEDIA = new Set(['IMG', 'VIDEO', 'CANVAS']);

  const interactive: unknown[] = [];
  const textual: unknown[] = [];
  const containers: unknown[] = [];
  let seq = 0;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode() as Element | null; node; node = walker.nextNode() as Element | null) {
    if (SKIP.has(node.tagName) || node.closest('svg') !== (node.tagName === 'svg' ? node : null)) continue;
    const rect = node.getBoundingClientRect();
    // Nothing to measure, or a label hidden for sighted users on purpose (the 1×1px screen-reader-only pattern).
    if (rect.width < 1 || rect.height < 1 || (rect.width <= 1 && rect.height <= 1)) continue;
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility !== 'visible' || parseFloat(cs.opacity) === 0) continue;

    let ownText = '';
    for (const child of node.childNodes) if (child.nodeType === Node.TEXT_NODE) ownText += child.textContent ?? '';
    ownText = ownText.replace(/\s+/g, ' ').trim();
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) ownText = (node.value || node.placeholder || '').trim();

    const role = node.getAttribute('role') ?? '';
    const isInteractive =
      (INTERACTIVE_TAGS.has(node.tagName) && !(node instanceof HTMLInputElement && node.type === 'hidden') && !(node.tagName === 'A' && !node.hasAttribute('href'))) ||
      INTERACTIVE_ROLES.has(role) ||
      (node.hasAttribute('tabindex') && node.getAttribute('tabindex') !== '-1');
    const own = rgba(cs.backgroundColor);
    const hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some((side) => px(cs.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && cs.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none');
    const radius = Math.max(px(cs.borderTopLeftRadius), px(cs.borderTopRightRadius), px(cs.borderBottomLeftRadius), px(cs.borderBottomRightRadius));
    const isContainer = rect.width >= 40 && rect.height >= 24 && (own[3] > 0.02 || hasBorder || cs.boxShadow !== 'none' || cs.backgroundImage !== 'none');
    // An inline drawing counts once it is the size of an illustration; smaller ones are icons, part of their control.
    const isMedia = rect.width >= 40 && rect.height >= 24 && (MEDIA.has(node.tagName) || (node.tagName === 'svg' && rect.width >= 96 && rect.height >= 96));
    if (!ownText && !isInteractive && !isContainer && !isMedia) continue;

    // Composite backgrounds from the element outwards until something opaque is reached.
    let bg: [number, number, number, number] = [0, 0, 0, 0];
    let indeterminate = false;
    for (let anc: Element | null = node; anc; anc = anc.parentElement) {
      const acs = anc === node ? cs : getComputedStyle(anc);
      if (acs.backgroundImage !== 'none') {
        indeterminate = true;
        break;
      }
      const c = rgba(acs.backgroundColor);
      if (c[3] > 0) {
        const a = bg[3] + c[3] * (1 - bg[3]);
        bg = a === 0 ? [0, 0, 0, 0] : [(bg[0] * bg[3] + c[0] * c[3] * (1 - bg[3])) / a, (bg[1] * bg[3] + c[1] * c[3] * (1 - bg[3])) / a, (bg[2] * bg[3] + c[2] * c[3] * (1 - bg[3])) / a, a];
      }
      if (bg[3] >= 0.999) break;
    }
    if (bg[3] < 0.999) {
      // Whatever is still transparent shows the canvas, which is white unless the UA is in a dark scheme.
      const canvasWhite = matchMedia('(prefers-color-scheme: dark)').matches && getComputedStyle(document.documentElement).colorScheme.includes('dark') ? 0.07 : 1;
      bg = [bg[0] * bg[3] + canvasWhite * (1 - bg[3]), bg[1] * bg[3] + canvasWhite * (1 - bg[3]), bg[2] * bg[3] + canvasWhite * (1 - bg[3]), 1];
    }

    const fontSize = px(cs.fontSize);
    const lineHeightPx = cs.lineHeight === 'normal' ? fontSize * 1.2 : px(cs.lineHeight);
    const lines = Math.max(1, Math.round(rect.height / Math.max(1, lineHeightPx)));
    const fullText = ownText ? ((node as HTMLElement).innerText ?? ownText) : '';
    // A box that scrolls is not cutting anything off; only hidden/clipped overflow and ellipsis lose text.
    const hidesOverflow = cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis';
    const parent = node.parentElement;
    const record = {
      id: `e${++seq}`,
      tag: node.tagName.toLowerCase(),
      role,
      selector: selectorOf(node),
      text: ownText.slice(0, 120),
      textLength: fullText.length,
      interactive: isInteractive,
      inline: cs.display === 'inline',
      x: rect.left + scrollX,
      y: rect.top + scrollY,
      w: rect.width,
      h: rect.height,
      color: rgba(cs.color),
      background: bg,
      backgroundIndeterminate: indeterminate,
      ownBackground: own,
      backgroundImage: cs.backgroundImage.slice(0, 400),
      fontSize,
      fontWeight: Number(cs.fontWeight) || 400,
      fontFamily: (cs.fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim().slice(0, 80),
      lineHeight: fontSize > 0 ? lineHeightPx / fontSize : 0,
      letterSpacingEm: cs.letterSpacing === 'normal' || fontSize === 0 ? 0 : px(cs.letterSpacing) / fontSize,
      uppercase: cs.textTransform === 'uppercase',
      radius,
      padding: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
      margin: [px(cs.marginTop), px(cs.marginRight), px(cs.marginBottom), px(cs.marginLeft)],
      gap: cs.display.includes('flex') || cs.display.includes('grid') ? px(cs.rowGap) || px(cs.columnGap) : 0,
      shadow: cs.boxShadow.slice(0, 200),
      hasBorder,
      clipped: Boolean(ownText) && hidesOverflow && node.scrollWidth > node.clientWidth + 1,
      charsPerLine: lines >= 2 && fullText.length > 0 ? fullText.length / lines : 0,
      siblingKey: parent ? `${selectorOf(parent)}|${node.tagName}`.slice(0, 120) : '',
    };
    if (isInteractive) interactive.push(record);
    else if (ownText) textual.push(record);
    else containers.push(record);
  }

  // Composition: how the first screenful is put together. Read apart from the elements above because it asks
  // other questions (what share of the text is small, what is turned, what is a card) of everything drawn,
  // text inside an svg included.
  const compose = (): unknown => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const styles = new Map<Element, CSSStyleDeclaration>();
    const rects = new Map<Element, DOMRect>();
    const styleOf = (el: Element): CSSStyleDeclaration => styles.get(el) ?? (styles.set(el, getComputedStyle(el)), styles.get(el)!);
    const rectOf = (el: Element): DOMRect => rects.get(el) ?? (rects.set(el, el.getBoundingClientRect()), rects.get(el)!);
    const shown = (el: Element): boolean => {
      const r = rectOf(el);
      const s = styleOf(el);
      if (r.width < 1 || r.height < 1 || (r.width <= 1 && r.height <= 1)) return false;
      if (s.display === 'none' || s.visibility !== 'visible' || parseFloat(s.opacity) <= 0.05) return false;
      // A box faded to nothing hides what is inside it, and the styles of what is inside do not say so.
      return typeof el.checkVisibility !== 'function' || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    };
    const inFirst = (r: DOMRect): boolean => r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
    const over = (top: readonly number[], under: readonly number[]): [number, number, number] => [0, 1, 2].map((i) => top[i]! * top[3]! + under[i]! * (1 - top[3]!)) as [number, number, number];
    const differs = (a: readonly number[], b: readonly number[]): boolean => [0, 1, 2].some((i) => Math.abs(a[i]! - b[i]!) > 0.01);
    const all = [...document.body.querySelectorAll('*')];

    // The paper: the canvas, the root and the body, then every box that covers the whole viewport, in order.
    // A product that is dark all over is usually dark on a wrapper and not on the body.
    const darkCanvas = matchMedia('(prefers-color-scheme: dark)').matches && getComputedStyle(document.documentElement).colorScheme.includes('dark');
    let paper: [number, number, number] = darkCanvas ? [0.07, 0.07, 0.07] : [1, 1, 1];
    for (const el of [document.documentElement, document.body, ...all.filter((e) => !(e instanceof SVGElement))]) {
      const r = rectOf(el);
      const covers = el === document.documentElement || el === document.body || (r.left <= 1 && r.top <= 1 && r.right >= vw - 1 && r.bottom >= vh - 1 && shown(el));
      if (covers) paper = over(rgba(styleOf(el).backgroundColor), paper);
    }

    /** How far a piece of text ends up turned, in degrees, by every transform above it. */
    const turnOf = (el: Element): number => {
      if (el instanceof SVGGraphicsElement) {
        const m = el.getScreenCTM();
        return m ? Math.abs((Math.atan2(m.b, m.a) * 180) / Math.PI) : 0;
      }
      let deg = 0;
      for (let a: Element | null = el; a && a !== document.documentElement; a = a.parentElement) {
        const s = styleOf(a);
        const m = /^matrix\(([^)]+)\)/.exec(s.transform);
        if (m) {
          const [p, q] = m[1]!.split(',').map(Number);
          deg += (Math.atan2(q ?? 0, p ?? 1) * 180) / Math.PI;
        }
        if (s.rotate && s.rotate !== 'none') deg += parseFloat(s.rotate) || 0;
      }
      const turn = ((deg % 360) + 360) % 360;
      return turn > 180 ? 360 - turn : turn;
    };
    /** The block a piece of text belongs to: its heading if it is in one, or the nearest box that is not part of a line. */
    const blockOf = (el: Element): Element => {
      const heading = el.closest('h1, h2, h3, h4, h5, h6');
      if (heading) return heading;
      let a = el;
      while (a.parentElement && a !== document.body && styleOf(a).display === 'inline') a = a.parentElement;
      return a;
    };
    const lineage = (el: Element): Element[] => {
      const up: Element[] = [];
      for (let a: Element | null = el; a && up.length < 8; a = a.parentElement) up.push(a);
      return up;
    };
    /**
     * Two pieces at the same place in a repeated structure (rows of a list, cells of a table) hold a column of
     * values, not one value twice: the same kind of element, the same way down from what they share.
     */
    const peers = (a: Element, b: Element): boolean => {
      if (a.getAttribute('class') !== b.getAttribute('class')) return false;
      const ua = lineage(a);
      const ub = lineage(b);
      for (let i = 1; i < ua.length; i++) {
        const j = ub.indexOf(ua[i]!);
        if (j >= 0) return i === j && ua.slice(0, i).every((node, k) => node.tagName === ub[k]!.tagName);
      }
      return false;
    };

    const NOT_TEXT = new Set(['SCRIPT', 'STYLE', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE']);
    const MONO = /mono|menlo|courier|consolas/i;
    // A figure with its unit, a time, a ratio: what may be aligned to the end side as a column of numbers.
    const FIGURE = /^[\d\s.,:+\-−%₩$kgKG점원회번일차/·]+$/;
    const pieces: { el: Element; text: string; chars: number; size: number; family: string; mono: boolean; inCode: boolean; svg: boolean; turn: number; stacked: boolean; endAligned: boolean }[] = [];
    for (const el of all) {
      if (NOT_TEXT.has(el.tagName)) continue;
      let own = '';
      for (const child of el.childNodes) if (child.nodeType === Node.TEXT_NODE) own += child.textContent ?? '';
      own = own.replace(/\s+/g, ' ').trim();
      if (!own || !shown(el) || !inFirst(rectOf(el))) continue;
      const r = rectOf(el);
      const s = styleOf(el);
      const svg = el.closest('svg') !== null;
      // Inside a drawing a font size is in the drawing's own units: what is seen is that size through its scale.
      const scale = svg && el instanceof SVGGraphicsElement ? el.getScreenCTM() : null;
      const size = px(s.fontSize) * (scale ? Math.hypot(scale.a, scale.b) : 1);
      const chars = [...own].length;
      const family = (s.fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim().slice(0, 80);
      const turn = Math.round(turnOf(el));
      pieces.push({
        el,
        text: own.slice(0, 60),
        chars,
        size,
        family,
        mono: MONO.test(family),
        inCode: el.closest('code, pre, kbd, samp') !== null,
        svg,
        turn,
        // One character to a line. The box of turned text is tall and narrow too, and is not this.
        stacked: s.writingMode !== 'horizontal-tb' || (!svg && turn <= 15 && /[가-힣]/.test(own) && chars >= 2 && r.width < size * 1.6 && r.height > size * 2.4),
        endAligned: !svg && (s.direction === 'rtl' ? ['left', 'end'] : ['right', 'end']).includes(s.textAlign) && chars >= 8 && !FIGURE.test(own),
      });
    }

    const written = pieces.filter((p) => !p.svg);
    const total = written.reduce((n, p) => n + p.chars, 0);
    const micro = written.filter((p) => p.size <= 12.5);
    const byFamily = new Map<string, number>();
    for (const p of pieces) if (!p.mono && p.family) byFamily.set(p.family, (byFamily.get(p.family) ?? 0) + p.chars);
    const largest = Math.max(0, ...pieces.map((p) => p.size));
    const atLargest = new Map<Element, string>();
    if (largest >= 28) {
      for (const p of pieces.filter((x) => x.size >= largest * 0.85)) {
        const block = blockOf(p.el);
        atLargest.set(block, `${atLargest.get(block) ?? ''} ${p.text}`.trim().slice(0, 60));
      }
    }
    // The same figure in two places (a gap as a badge and again as a sentence), among text large enough to be a statement.
    const places = new Map<string, Element[]>();
    for (const p of written) {
      if (p.size < 13.5) continue;
      for (const figure of new Set(p.text.match(/\d[\d,.]*\d|\d{2,}/g) ?? [])) {
        const at = places.get(figure) ?? [];
        if (!at.some((other) => peers(other, p.el))) places.set(figure, [...at, p.el]);
      }
    }

    // What can be pressed. An input that cannot be seen is pressed through the label around it.
    const pressed = new Set<Element>();
    for (const el of document.body.querySelectorAll('button, a[href], summary, select, textarea, input:not([type=hidden]), label[for], [role=button], [role=tab], [role=switch], [role=radio], [role=checkbox], [popovertarget]')) {
      let target: Element | null = el;
      if (el instanceof HTMLInputElement) {
        if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) continue;
        const r = rectOf(el);
        if (r.width < 4 || r.height < 4 || parseFloat(styleOf(el).opacity) < 0.05) target = el.closest('label');
      }
      if (target && shown(target) && inFirst(rectOf(target))) pressed.add(target);
    }

    // Boxes that read as a card: a surface of their own or an edge all the way round, large enough to hold
    // something. A hairline on one side is a divider, and a picture or a field is not a card.
    const NOT_CARD = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'INPUT', 'TEXTAREA', 'SELECT']);
    const INK = new Set(['IMG', 'svg', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'CANVAS', 'VIDEO', 'IFRAME', 'PROGRESS', 'METER']);
    const fillOf = (el: Element): [number, number, number, number] => rgba(styleOf(el).backgroundColor);
    const backdropOf = (el: Element): readonly number[] => {
      for (let a = el.parentElement; a; a = a.parentElement) if (fillOf(a)[3] > 0.5) return fillOf(a);
      return paper;
    };
    const cards = new Set<Element>();
    const short: { selector: string; w: number; h: number; reach: number }[] = [];
    let nestedCards = 0;
    for (const el of all) {
      if (el instanceof SVGElement || NOT_CARD.has(el.tagName)) continue;
      const r = rectOf(el);
      if (r.width < 120 || r.height < 72 || (r.width > vw * 0.999 && r.height > vh * 0.9) || !shown(el)) continue;
      const s = styleOf(el);
      if (s.backgroundImage.includes('url(')) continue;
      const edged = s.boxShadow.split(/,(?![^(]*\))/).some((shadow) => shadow.trim() !== 'none' && !shadow.includes('inset')) || ['top', 'right', 'bottom', 'left'].every((side) => px(s.getPropertyValue(`border-${side}-width`)) > 0 && s.getPropertyValue(`border-${side}-style`) !== 'none');
      const fill = fillOf(el);
      const backdrop = backdropOf(el);
      if (!edged && !(fill[3] > 0.02 && differs(over(fill, backdrop), backdrop))) continue;
      let nested = false;
      for (let a = el.parentElement; a && !nested; a = a.parentElement) nested = cards.has(a);
      cards.add(el);
      if (!inFirst(r)) continue;
      if (nested) nestedCards += 1;
      if (r.height < 96) continue;
      // How much of the box's height its own content reaches.
      let top = Infinity;
      let bottom = -Infinity;
      for (const kid of el.querySelectorAll('*')) {
        const kr = rectOf(kid);
        if (kr.width < 1 || kr.height < 1 || styleOf(kid).visibility !== 'visible') continue;
        const ink = INK.has(kid.tagName) || [...kid.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '') || (fillOf(kid)[3] > 0.02 && kr.height < r.height * 0.9);
        if (!ink) continue;
        top = Math.min(top, kr.top);
        bottom = Math.max(bottom, kr.bottom);
      }
      const inner = Math.max(1, r.height - px(s.paddingTop) - px(s.paddingBottom));
      // A box in which nothing was counted (a drawing, a picture, a pattern of its own) is not a card with too little in it.
      if (bottom < top) continue;
      const reach = Math.min(1, (bottom - top) / inner);
      if (reach < 0.8) short.push({ selector: selectorOf(el), w: Math.round(r.width), h: Math.round(r.height), reach: Math.round(reach * 100) / 100 });
    }

    // Pictures, as the boxes they fill of the first screenful.
    const MEDIA_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME']);
    const mediaBoxes: [number, number, number, number][] = [];
    for (const el of all) {
      const r = rectOf(el);
      if (r.width < 2 || r.height < 2 || !inFirst(r)) continue;
      if (!(MEDIA_TAGS.has(el.tagName) || styleOf(el).backgroundImage.includes('url(')) || !shown(el)) continue;
      const [x0, y0, x1, y1] = [Math.max(0, r.left), Math.max(0, r.top), Math.min(vw, r.right), Math.min(vh, r.bottom)];
      mediaBoxes.push([Math.round(x0), Math.round(y0), Math.round(x1 - x0), Math.round(y1 - y0)]);
    }

    const lines = (list: readonly string[]): string[] => list.slice(0, 40);
    return {
      microShare: total === 0 ? 0 : Math.round((micro.reduce((n, p) => n + p.chars, 0) / total) * 1000) / 1000,
      microSentences: lines(micro.filter((p) => p.chars >= 12).map((p) => p.text)),
      families: [...byFamily].sort((a, b) => b[1] - a[1]).map(([family]) => family).slice(0, 12),
      monoOutsideCode: lines(pieces.filter((p) => p.mono && !p.inCode).map((p) => p.text)),
      figuresAtLargest: lines([...atLargest.values()]),
      turnedText: lines(pieces.filter((p) => p.turn > 5).map((p) => `${p.text} (${p.turn}deg)`)),
      stackedText: lines(pieces.filter((p) => p.stacked).map((p) => p.text)),
      endAlignedText: lines(pieces.filter((p) => p.endAligned).map((p) => p.text)),
      controls: pressed.size,
      halfEmptyCards: short.slice(0, 40),
      nestedCards,
      figuresTwice: lines([...places].filter(([, at]) => at.length >= 2).map(([figure, at]) => `${figure} x${at.length}`)),
      mediaBoxes: mediaBoxes.sort((a, b) => b[2] * b[3] - a[2] * a[3]).slice(0, 80),
      paper,
    };
  };
  // A page this cannot be read off (a browser without one of the calls, a document built strangely) is still
  // measured by everything above.
  let composition: unknown;
  try {
    composition = compose();
  } catch {
    composition = undefined;
  }

  // When the page is huge, keep what matters most for the checks: controls, then text, then surfaces.
  const elements = [...interactive, ...textual, ...containers].slice(0, maxElements);
  return {
    title: document.title.slice(0, 200),
    lang: (document.documentElement.lang || '').slice(0, 20),
    // The layout viewport, not innerWidth/innerHeight: on a phone those describe the visual viewport, which
    // grows when the browser zooms out to fit overflowing content and would hide the very overflow being measured.
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    loadedFonts: [...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '').slice(0, 80)))].slice(0, 40),
    elements,
    composition,
  };
}

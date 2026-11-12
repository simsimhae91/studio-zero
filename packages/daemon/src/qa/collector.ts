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
    if (!ownText && !isInteractive && !isContainer) continue;

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
  };
}

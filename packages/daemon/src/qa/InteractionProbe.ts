import type { Page } from 'playwright-core';
import { z } from 'zod';

/**
 * Whether a screen answers the hand, measured.
 *
 * A reviewer shown a picture can only guess at this from cues: a still image has no pressed state and no focus
 * ring in it. So the screen is tried. Each control in the first screenful is pressed and held, and the screen
 * around it is compared with how it looked at rest: a press that changes nothing visible was not answered,
 * whatever the stylesheet intends. Then the keyboard walks the focus through the screen, and each stop is
 * compared with the same element unfocused: focus a person cannot see is focus a keyboard user does not have.
 *
 * Nothing is clicked. The press is a real pointer press, so `:active` (on the control and on what contains it)
 * and script handlers both show; it is then let go onto a sheet of glass put under the pointer, so that no
 * click is made of it. No model is asked anything.
 */
export interface Touchability {
  press: { answered: number; probed: number; silent: ProbedControl[] };
  focus: { visible: number; probed: number; hidden: ProbedControl[] };
}

/** A control the probe found wanting: where it is, as the audit's findings point at things. */
export interface ProbedControl {
  selector: string;
  /** The control's own words, capped. Page content: shown to the builder as data. */
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How long a press is held before the screen is looked at: long enough for a fast transition to show. */
const HOLD_MS = 150;
/** How far around a control the screen is compared: a press is often answered by the row the control sits in. */
const AROUND_PX = 32;
const MAX_PRESSED = 14;
const MAX_TAB_STOPS = 10;
/** Controls of one kind in one container (the rows of a list) are alike: this many of them stand for the rest. */
const PER_GROUP = 2;

const Control = z.object({ selector: z.string().max(300), text: z.string().max(60), x: z.number(), y: z.number(), w: z.number().min(0).max(100_000), h: z.number().min(0).max(100_000) });
const Controls = z.array(Control).max(60);
const FocusStop = Control.extend({ index: z.number().int().min(0).max(100_000) }).nullable();

/**
 * Runs in the page: the controls of the first screenful that a press should mean something on. Text fields are
 * left out (what answers a press on a field is its focus, which the second pass looks at), as are controls that
 * are switched off. Self-contained and synchronous; its answer is validated before use.
 */
function listControls(arg: { perGroup: number; max: number }): unknown {
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
  const ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'switch', 'option']);
  const found: unknown[] = [];
  const perGroup = new Map<string, number>();
  for (const el of Array.from(document.querySelectorAll('a[href], button, summary, label[for], input[type="checkbox"], input[type="radio"], input[type="button"], input[type="submit"], [role], [tabindex]'))) {
    if (found.length >= arg.max) break;
    const role = el.getAttribute('role') ?? '';
    if (el.hasAttribute('role') && !ROLES.has(role)) continue;
    if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') continue;
    // The innermost control is the one a person presses: a row that is a link holding a button is tried by its button.
    if (el.querySelector('a[href], button, [role="button"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.bottom > window.innerHeight || r.top < 0 || r.right > window.innerWidth || r.left < 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible' || parseFloat(cs.opacity) === 0 || cs.pointerEvents === 'none') continue;
    // A link in running text is read, not thumbed: the target-size check leaves it out for the same reason.
    if (el.tagName === 'A' && cs.display === 'inline') continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    // Something lies over it: there is no pressing it, and saying so is another check's job.
    if (!top || !(top === el || el.contains(top) || top.contains(el))) continue;
    // Alike means the same control in the same place of sibling containers: the button of every row of one list.
    // Controls that are siblings of each other are each their own: three buttons side by side are three things.
    const selector = selectorOf(el);
    const steps = selector.split(' > ');
    const group = [...steps.slice(0, -1).map((step) => step.replace(/:nth-of-type\(\d+\)/g, '')), steps.at(-1)].join(' > ');
    const seen = perGroup.get(group) ?? 0;
    if (seen >= arg.perGroup) continue;
    perGroup.set(group, seen + 1);
    found.push({ selector, text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), x: cx, y: cy, w: r.width, h: r.height });
  }
  return found;
}

/** Runs in the page: what holds the focus now, and which element it is among everything, so it can be found again. */
function focusedNow(): unknown {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > window.innerHeight) return null;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.body && parts.length < 4) {
    if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
      parts.unshift(`#${node.id}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    const tag = node.tagName;
    const same = parent ? [...parent.children].filter((c) => c.tagName === tag) : [node];
    parts.unshift(`${tag.toLowerCase()}${same.length > 1 ? `:nth-of-type(${same.indexOf(node) + 1})` : ''}`);
    node = parent;
  }
  return { index: Array.from(document.querySelectorAll('*')).indexOf(el), selector: parts.join(' > ').slice(0, 300), text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

/**
 * Tries the first screenful of a page that is open and settled. Leaves the page as pressed and tabbed through:
 * the caller is done with it afterwards.
 */
export async function probeInteraction(page: Page, opts: { touch: boolean }): Promise<Touchability> {
  const view = page.viewportSize() ?? { width: 1280, height: 800 };
  const around = (c: { x: number; y: number; w: number; h: number }, by: number): Promise<Buffer | null> => {
    const left = Math.max(0, Math.floor(c.x - c.w / 2 - by));
    const top = Math.max(0, Math.floor(c.y - c.h / 2 - by));
    const clip = { x: left, y: top, width: Math.max(1, Math.min(view.width - left, Math.ceil(c.w + by * 2))), height: Math.max(1, Math.min(view.height - top, Math.ceil(c.h + by * 2))) };
    return page.screenshot({ type: 'png', clip }).catch(() => null);
  };
  const differs = (a: Buffer | null, b: Buffer | null): boolean => a !== null && b !== null && !a.equals(b);
  const result: Touchability = { press: { answered: 0, probed: 0, silent: [] }, focus: { visible: 0, probed: 0, hidden: [] } };

  // ---- pressed
  const controls = Controls.catch([]).parse(await page.evaluate(listControls, { perGroup: PER_GROUP, max: MAX_PRESSED }).catch(() => []));
  for (const control of controls) {
    const rest = await around(control, AROUND_PX);
    await page.mouse.move(control.x, control.y);
    const hovered = await around(control, AROUND_PX);
    await page.mouse.down();
    await page.waitForTimeout(HOLD_MS);
    const held = await around(control, AROUND_PX);
    // Let go without clicking. A sheet of glass is slid under the pointer first, so the release lands on something
    // other than what was pressed and no click is made of the two; on a page whose scripts run, a click that a
    // container might still get is taken before the page hears it. The pointer is not moved while it is down:
    // dragging a link or a label starts a drag of the browser's own, and the page stops taking input.
    await page
      .evaluate(() => {
        window.addEventListener('click', (e) => (e.stopImmediatePropagation(), e.preventDefault()), { capture: true, once: true });
        const glass = document.createElement('div');
        glass.setAttribute('data-sz-glass', '');
        glass.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent';
        document.body.appendChild(glass);
      })
      .catch(() => undefined);
    await page.mouse.up();
    await page.evaluate(() => document.querySelector('[data-sz-glass]')?.remove()).catch(() => undefined);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(60);
    result.press.probed += 1;
    // Under a finger there is no hovering: only what the press itself changes counts. Under a mouse, a control
    // that answers the pointer before it is pressed has answered.
    if (differs(opts.touch ? (hovered ?? rest) : rest, held)) result.press.answered += 1;
    else result.press.silent.push(control);
  }

  // ---- focused, by the keyboard: that is the focus a person has to be able to see
  // The presses left the focus on whatever was pressed last. The walk starts where a person's would: at the top.
  await page
    .evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    })
    .catch(() => undefined);
  const seen = new Set<number>();
  for (let i = 0; i < MAX_TAB_STOPS; i++) {
    await page.keyboard.press('Tab');
    const stop = FocusStop.catch(null).parse(await page.evaluate(focusedNow).catch(() => null));
    if (!stop || seen.has(stop.index)) break;
    seen.add(stop.index);
    const focused = await around(stop, 12);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()).catch(() => undefined);
    const rest = await around(stop, 12);
    // Back where it was, so the next Tab goes on from here.
    await page.evaluate((index) => (document.querySelectorAll('*')[index] as HTMLElement | undefined)?.focus(), stop.index).catch(() => undefined);
    result.focus.probed += 1;
    if (differs(rest, focused)) result.focus.visible += 1;
    else result.focus.hidden.push({ selector: stop.selector, text: stop.text, x: stop.x, y: stop.y, w: stop.w, h: stop.h });
  }
  return result;
}

/** Runs in the page: how much of the screen jumped as it loaded, as the browser added it up (cumulative layout shift). */
export function layoutShift(): Promise<number> {
  return new Promise((resolve) => {
    let sum = 0;
    const add = (entries: PerformanceEntryList): void => {
      for (const entry of entries) {
        const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
        if (!shift.hadRecentInput && typeof shift.value === 'number') sum += shift.value;
      }
    };
    try {
      const observer = new PerformanceObserver((list) => add(list.getEntries()));
      observer.observe({ type: 'layout-shift', buffered: true });
      setTimeout(() => {
        add(observer.takeRecords());
        observer.disconnect();
        resolve(sum);
      }, 150);
    } catch {
      resolve(0);
    }
  });
}

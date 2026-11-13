import type { Page } from 'playwright-core';
import { z } from 'zod';
import { contract } from '@studio-zero/design';
import type { FlowTaskWalk, FlowTotals } from '@studio-zero/protocol';
import type { FlowTask } from '../scratch/ScreenSpec.ts';

/**
 * How a page says where its core flow is. The control that carries out step `k` of task `t` has
 * `data-step="t:k"`; whatever is on screen only once the task's outcome is true has `data-done="t"`.
 * Two attributes are the whole contract, so the same walk reads a script-less mock-up and a running build.
 */
export const STEP_ATTR = 'data-step';
export const DONE_ATTR = 'data-done';
/** A text field among the steps says what a person would type into it. */
export const SAMPLE_ATTR = 'data-sample';

/** A task id as the screen spec allows it: the only thing of the spec's that is put into a selector. */
const TASK_ID = /^[a-z][a-z0-9-]{0,23}$/;
/** No task of a core flow is this many presses long; past it the page is looping. */
const MAX_STEPS = 8;
const MAX_SAMPLE = 40;
/** How long a press is held before the control is looked at again: long enough for a fast transition to show. */
const HOLD_MS = 140;
/** The longest the walk waits for what a press set off to finish. */
const SETTLE_CAP_MS = 1500;

/** One picture of a walk: the screen at rest (`task` null), or as it stood after a press. */
export interface WalkFrame {
  /** Which task of the flow, counted from 0, and which of its steps, counted from 1. */
  task: number | null;
  step: number | null;
  jpeg: Buffer;
}

/** What a browser found when it carried the core flow out on one page. */
export interface Walk {
  tasks: FlowTaskWalk[];
  /** The screen at rest, then after each press. */
  frames: WalkFrame[];
}

/**
 * Runs in the page under test: is the task's outcome showing, and where is the control for its next step.
 * Self-contained, and synchronous on purpose: it is called on pages where the page's own scripts are switched
 * off, and nothing here waits on the page to run a callback. Its answer is validated before use.
 */
function look(q: { step: string; done: string }): unknown {
  const shown = (el: Element): boolean => {
    let r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const check = (el as Element & { checkVisibility?: (o: Record<string, boolean>) => boolean }).checkVisibility;
    // Both spellings of the options: the names changed between browser versions.
    if (typeof check === 'function' && !check.call(el, { opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true })) return false;
    let fixed = false;
    for (let a: Element | null = el; a; a = a.parentElement) {
      if (getComputedStyle(a).position === 'fixed') {
        fixed = true;
        break;
      }
    }
    r = el.getBoundingClientRect();
    // Parked off the screen (a sheet waiting below it, a toast above it) is not showing.
    if (r.right <= 0 || r.left >= window.innerWidth) return false;
    if (fixed && (r.bottom <= 0 || r.top >= window.innerHeight)) return false;
    return r.bottom + window.scrollY > 0;
  };
  const done = Array.from(document.querySelectorAll(q.done)).some(shown);
  const all = Array.from(document.querySelectorAll(q.step));
  const index = all.findIndex(shown);
  if (index < 0) return { done, target: null };
  const el = all[index]!;
  let r = el.getBoundingClientRect();
  let scrolled = false;
  if (r.top < 0 || r.bottom > window.innerHeight) {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
    scrolled = true;
    r = el.getBoundingClientRect();
  }
  const cx = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1);
  const cy = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1);
  const top = document.elementFromPoint(cx, cy);
  // The thing under the pointer is the control, part of it, or something it sits in (a label around its box).
  const covered = top === null || !(top === el || el.contains(top) || top.contains(el));
  const tag = el.tagName;
  const type = (el.getAttribute('type') ?? 'text').toLowerCase();
  const field = tag === 'TEXTAREA' || (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden'].includes(type));
  return { done, target: { index, x: cx, y: cy, w: r.width, h: r.height, scrolled, covered, field, sample: (el.getAttribute('data-sample') ?? '').slice(0, 80) } };
}

const Look = z.object({
  done: z.boolean(),
  target: z
    .object({ index: z.number().int().min(0).max(10_000), x: z.number(), y: z.number(), w: z.number().min(0).max(100_000), h: z.number().min(0).max(100_000), scrolled: z.boolean(), covered: z.boolean(), field: z.boolean(), sample: z.string().max(80) })
    .nullable(),
});

/** Runs on the control: how it is painted right now, as one string to compare with another moment's. */
function painted(el: Element): string {
  const parts: string[] = [];
  const nodes = [el, ...Array.from(el.children).slice(0, 6)];
  for (const node of nodes) {
    const cs = getComputedStyle(node);
    parts.push([cs.transform, cs.scale, cs.translate, cs.backgroundColor, cs.backgroundImage, cs.boxShadow, cs.opacity, cs.color, cs.borderTopColor, cs.borderTopWidth, cs.outlineColor, cs.outlineWidth, cs.filter].join('|'));
  }
  return parts.join('\n');
}

/** Runs in the page: what is moving because of the last press, and for how long. Loops are not a response. */
function moving(): number {
  const list = typeof document.getAnimations === 'function' ? document.getAnimations() : [];
  let longest = 0;
  for (let i = 0; i < list.length && i < 400; i++) {
    const a = list[i]!;
    if (a.playState !== 'running' || !a.effect) continue;
    const t = a.effect.getComputedTiming();
    if (t.iterations === Infinity) continue;
    const once = typeof t.duration === 'number' ? t.duration : 0;
    longest = Math.max(longest, (t.delay ?? 0) + once * (t.iterations ?? 1));
  }
  return longest;
}

/**
 * Carries a core flow out on a page that is already open: for each task, presses the control marked for each
 * step in turn and then looks for the outcome, the way a person would have to.
 *
 * This is how the way a screen works gets a number. A reviewer looking at a picture can say whether a screen
 * reads well; it cannot say that the thing the product exists for takes four presses in one direction and one
 * in another, that the button for it sits under a toast, or that a control gives nothing back while it is held.
 * Those are counted here, on the page itself, with no model in the loop.
 *
 * `touch` says the page is being looked at as a phone: there, how a control looks under a hovering pointer is
 * not an answer to anything. `patienceMs` is how long the walk waits for the next thing to appear after a
 * press: nothing on a mock-up, whose states are CSS and change at once; a couple of seconds on a running app,
 * where a press may go through a render or a request first.
 */
export async function walkFlow(page: Page, tasks: readonly FlowTask[], opts: { touch: boolean; patienceMs?: number }): Promise<Walk> {
  const patience = opts.patienceMs ?? 0;
  /** Looks, and keeps looking until `ready` or patience runs out. Null when the page gave nothing readable. */
  const seek = async (q: { step: string; done: string }, ready: (seen: z.infer<typeof Look>) => boolean): Promise<z.infer<typeof Look> | null> => {
    const until = Date.now() + patience;
    for (;;) {
      const seen = Look.safeParse(await page.evaluate(look, q).catch(() => null));
      if (seen.success && ready(seen.data)) return seen.data;
      if (Date.now() >= until) return seen.success ? seen.data : null;
      await page.waitForTimeout(100);
    }
  };
  const frames: WalkFrame[] = [];
  const shoot = async (task: number | null, step: number | null): Promise<void> => void frames.push({ task, step, jpeg: await page.screenshot({ type: 'jpeg', quality: 72 }) });
  await shoot(null, null);

  const walked: FlowTaskWalk[] = [];
  for (const [taskIndex, task] of tasks.entries()) {
    // The id goes into a selector. A spec that passed its check has only such ids; anything else is not walked.
    if (!TASK_ID.test(task.id)) break;
    const selectors = (step: number): { step: string; done: string } => ({ step: `[${STEP_ATTR}="${task.id}:${step}"]`, done: `[${DONE_ATTR}="${task.id}"]` });
    const result: FlowTaskWalk = { id: task.id, reached: false, stopped: null, stoppedAtStep: null, presses: 0, typed: 0, scrolls: 0, smallestTargetPx: null, answered: 0, responseMs: null };
    walked.push(result);

    for (let step = 1; step <= MAX_STEPS; step++) {
      // After the first step, the outcome showing means the steps are over: no need to wait for one more.
      const seen = await seek(selectors(step), (s) => s.target !== null || s.done);
      if (seen === null) {
        Object.assign(result, { stopped: 'step-missing', stoppedAtStep: step });
        break;
      }
      // The page has to open before the person acts. One that shows the outcome already has nothing to carry out.
      if (step === 1 && seen.done) {
        Object.assign(result, { stopped: 'already-done', stoppedAtStep: 1 });
        break;
      }
      const target = seen.target;
      if (!target) {
        // Out of marked steps: the task is over, and whether it worked is what the outcome says.
        if (step === 1) Object.assign(result, { stopped: 'step-missing', stoppedAtStep: 1 });
        break;
      }
      if (target.scrolled) result.scrolls += 1;
      if (target.covered) {
        Object.assign(result, { stopped: 'covered', stoppedAtStep: step });
        break;
      }
      const control = page.locator(selectors(step).step).nth(target.index);
      const look1 = await control.evaluate(painted).catch(() => '');
      await page.mouse.move(target.x, target.y);
      const hovered = opts.touch ? look1 : await control.evaluate(painted).catch(() => look1);
      await page.mouse.down();
      await page.waitForTimeout(HOLD_MS);
      const held = await control.evaluate(painted).catch(() => look1);
      await page.mouse.up();
      if (target.field) {
        const sample = (target.sample.trim() || '1').slice(0, MAX_SAMPLE);
        await page.keyboard.type(sample);
        result.typed += [...sample].length;
      }
      result.presses += 1;
      if (held !== look1 || hovered !== look1) result.answered += 1;
      result.smallestTargetPx = Math.round(Math.min(result.smallestTargetPx ?? Infinity, target.w, target.h));

      await page.waitForTimeout(40);
      const longest = z.number().min(0).max(600_000).catch(0).parse(await page.evaluate(moving).catch(() => 0));
      if (longest > 0) result.responseMs = Math.round(Math.max(result.responseMs ?? 0, longest));
      await page.waitForTimeout(Math.min(SETTLE_CAP_MS, longest + 60));
      // Take the pointer off what it pressed, so the next look is at the screen and not at a hover.
      await page.mouse.move(0, 0);
      await shoot(taskIndex, step);
    }

    if (result.stopped === null) {
      const after = await seek(selectors(MAX_STEPS + 1), (s) => s.done);
      if (after?.done) result.reached = true;
      else Object.assign(result, { stopped: 'outcome-not-shown', stoppedAtStep: null });
    }
    // A flow is a sequence: what comes after a task that did not finish would be walked from the wrong state.
    if (!result.reached) break;
  }
  return { tasks: walked, frames };
}

const STOPPED: Record<NonNullable<FlowTaskWalk['stopped']>, (t: FlowTaskWalk) => string> = {
  'already-done': (t) => `the page opens with [${DONE_ATTR}="${t.id}"] already showing. It has to open in the state before the person acts, with the outcome hidden until the steps are carried out.`,
  'step-missing': (t) => `no visible control carries ${STEP_ATTR}="${t.id}:${t.stoppedAtStep ?? 1}"${(t.stoppedAtStep ?? 1) > 1 ? ' after the step before it was pressed' : ''}. Mark the control a person presses for that step, and make sure it is on screen at that point.`,
  covered: (t) => `the control for step ${t.stoppedAtStep} (${STEP_ATTR}="${t.id}:${t.stoppedAtStep}") lies under another element at its centre, so it cannot be pressed. Move what covers it, or the control.`,
  'outcome-not-shown': (t) => `all ${t.presses} marked step(s) were pressed and nothing carrying ${DONE_ATTR}="${t.id}" became visible. Wire the last press to the state that shows the outcome, and mark what shows it.`,
};

/**
 * What a walk found wrong, as sentences the page's author can act on. Empty when the flow can be carried out
 * and every control in it is one a thumb can press and that answers the press.
 */
export function walkProblems(walk: Pick<Walk, 'tasks'>, tasks: readonly FlowTask[], opts: { touch: boolean }): string[] {
  const problems: string[] = [];
  for (const task of tasks) {
    const walked = walk.tasks.find((t) => t.id === task.id);
    if (!walked) {
      problems.push(`task "${task.id}" (${task.goal}) was not reached: the task before it could not be finished.`);
      continue;
    }
    if (walked.stopped) problems.push(`task "${task.id}" (${task.goal}): ${STOPPED[walked.stopped](walked)}`);
    if (opts.touch && walked.smallestTargetPx !== null && walked.smallestTargetPx < contract.touchTargetPx) problems.push(`task "${task.id}": a control in it is ${walked.smallestTargetPx}px on its shorter side; a thumb needs ${contract.touchTargetPx}px.`);
    if (walked.presses > 0 && walked.answered < walked.presses) problems.push(`task "${task.id}": ${walked.presses - walked.answered} of its ${walked.presses} control(s) look the same while held down as at rest. Give each an :active state (a shift, a press-in, a change of surface).`);
  }
  return problems;
}

/** A walk added up over the flow's tasks: the one line a receipt keeps. `expected` is how many tasks the spec has. */
export function flowTotals(walked: readonly FlowTaskWalk[], expected: number): FlowTotals {
  const sum = (pick: (t: FlowTaskWalk) => number): number => walked.reduce((n, t) => n + pick(t), 0);
  const sizes = walked.flatMap((t) => (t.smallestTargetPx === null ? [] : [t.smallestTargetPx]));
  return { tasks: expected, reached: walked.filter((t) => t.reached).length, presses: sum((t) => t.presses), scrolls: sum((t) => t.scrolls), smallestTargetPx: sizes.length > 0 ? Math.min(...sizes) : null, answered: sum((t) => t.answered) };
}

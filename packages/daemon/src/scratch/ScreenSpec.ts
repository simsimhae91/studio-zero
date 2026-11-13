import { ScreenSpec as ScreenSpecShape, type ScreenSpec } from '@studio-zero/protocol';

/** Where a design task leaves its screen spec. A document like the others in `docs/`, and the one a browser can check a page against. */
export const SCREEN_SPEC_FILE = 'docs/screens.json';

/** One task of the core flow, as the walker needs it. */
export type FlowTask = Pick<ScreenSpec['tasks'][number], 'id' | 'goal' | 'outcome'>;

const SCREEN_ID = /^[A-Z]{1,3}-\d{2}$/;
const TASK_ID = /^[a-z][a-z0-9-]{0,23}$/;
const EVENT_NAME = /^[a-z][a-z0-9_]{1,39}$/;
const EMPTY = /^(?:없음|해당 ?없음|미정|n\/?a|none|tbd|todo|-+|\.+)?$/i;
const MAX_SCREENS = 40;
const MAX_TASKS = 5;

const blank = (value: string): boolean => EMPTY.test(value.trim());

/**
 * What is wrong with a screen spec, each as a sentence its author can act on. Empty means it holds.
 *
 * A screen plan in the usual sense: an inventory of screens, and for each one how a person arrives, what every
 * thing on it does and under which rule, what it shows when the usual case does not hold, and the exceptions.
 * It says nothing about how a screen looks; three mock-ups that look nothing alike are drawn from the same one.
 *
 * As with the anchor table, this checks only what needs no judge: that the parts are there and filled in, that
 * the references between them resolve, and that the core flow is stated as things a person gets done, each
 * with an outcome a browser could look for. Whether the flow is a good one is the owner's question.
 */
export function checkScreenSpec(spec: ScreenSpec): string[] {
  const problems: string[] = [];

  if (blank(spec.coreMoment)) problems.push('coreMoment is empty: state, in one sentence, the one thing the product exists for a person to do.');
  else if (spec.coreMoment.trim().length > 240 || /\n/.test(spec.coreMoment.trim())) problems.push('coreMoment must be one sentence (240 characters at most, one line).');

  if (spec.screens.length === 0) problems.push('screens is empty: list every screen of the first version, each with an id such as "H-01".');
  if (spec.screens.length > MAX_SCREENS) problems.push(`screens has ${spec.screens.length} entries; ${MAX_SCREENS} is the most a first version is planned at. Mark what comes after it with "later": true, or leave it out.`);
  const ids = new Set<string>();
  for (const screen of spec.screens) {
    const at = `screen ${screen.id || '(no id)'}`;
    if (!SCREEN_ID.test(screen.id)) problems.push(`${at}: the id must be one to three capital letters, a hyphen and two digits ("H-01", "R-02").`);
    else if (ids.has(screen.id)) problems.push(`${at}: this id is used twice.`);
    ids.add(screen.id);
    if (blank(screen.name)) problems.push(`${at}: name is empty.`);
    if (blank(screen.purpose)) problems.push(`${at}: purpose is empty: say in one line what a person does here.`);
  }
  for (const screen of spec.screens) {
    const at = `screen ${screen.id || '(no id)'}`;
    const entry = screen.entry.filter((e) => !blank(e));
    if (entry.length === 0) problems.push(`${at}: entry is empty: say where a person arrives from (another screen's id, or opening the app, a notification, a shared link).`);
    for (const from of entry) if (SCREEN_ID.test(from.trim()) && !ids.has(from.trim())) problems.push(`${at}: entry names ${from.trim()}, which is not a screen in this spec.`);
    if (screen.elements.length === 0) problems.push(`${at}: elements is empty: list what is on the screen, and for each what it does and under which rule.`);
    screen.elements.forEach((element, i) => {
      const row = `${at}, element ${i + 1}${blank(element.name) ? '' : ` (${element.name.trim().slice(0, 30)})`}`;
      if (blank(element.name)) problems.push(`${row}: name is empty.`);
      if (blank(element.rule) || element.rule.trim().length < 8) problems.push(`${row}: rule is empty or a label. Say what it does when used, what it shows, and any limit that applies.`);
      const to = element.goesTo?.trim();
      if (to !== undefined && to !== '' && !ids.has(to)) problems.push(`${row}: goesTo names ${to}, which is not a screen in this spec.`);
    });
    for (const state of screen.states) if (blank(state.name) || blank(state.shows)) problems.push(`${at}: a state needs a name and what the screen shows in it.`);
  }
  // Every id that is an entry is also a screen, so "from outside" is whatever is not one.
  if (spec.screens.length > 0 && !spec.screens.some((screen) => screen.entry.some((from) => !blank(from) && !ids.has(from.trim())))) {
    problems.push('no screen can be reached from outside the product: at least one screen needs an entry that is not another screen (opening the app, a notification, a link).');
  }

  if (spec.tasks.length === 0) problems.push('tasks is empty: state the core flow as one to five things a person gets done, in order, each with the outcome that is true afterwards.');
  if (spec.tasks.length > MAX_TASKS) problems.push(`tasks has ${spec.tasks.length} entries; give at most ${MAX_TASKS}: the core flow, not every feature.`);
  const taskIds = new Set<string>();
  for (const task of spec.tasks) {
    const at = `task ${task.id || '(no id)'}`;
    if (!TASK_ID.test(task.id)) problems.push(`${at}: the id must be a short lowercase word ("log", "undo", "pick-date"): it is what a mock-up's controls are marked with.`);
    else if (taskIds.has(task.id)) problems.push(`${at}: this id is used twice.`);
    taskIds.add(task.id);
    if (blank(task.goal)) problems.push(`${at}: goal is empty: say what the person gets done.`);
    if (blank(task.outcome)) problems.push(`${at}: outcome is empty: say what is true on the screen once it is done, so that it can be looked for.`);
    const screen = spec.screens.find((s) => s.id === task.screen);
    if (!screen) problems.push(`${at}: screen names ${task.screen || '(nothing)'}, which is not a screen in this spec.`);
    else if (screen.later) problems.push(`${at}: it happens on ${screen.id}, which is marked "later". The core flow belongs to the first version.`);
    // The screens where the product's reason for existing happens are the ones whose other states get forgotten.
    else if (screen.states.filter((s) => !blank(s.name) && !blank(s.shows)).length === 0) problems.push(`screen ${screen.id}: the core flow happens here, so say what it shows when the usual case does not hold (nothing yet, a failure, a limit reached): states is empty.`);
  }

  if (spec.events.length === 0) problems.push('events is empty: name what the product records so its use can be measured (at least the completion of each core task), each with when it fires and what it measures.');
  const eventNames = new Set<string>();
  for (const event of spec.events) {
    const at = `event ${event.name || '(no name)'}`;
    if (!EVENT_NAME.test(event.name)) problems.push(`${at}: the name must be snake_case ("chore_logged").`);
    else if (eventNames.has(event.name)) problems.push(`${at}: this name is used twice.`);
    eventNames.add(event.name);
    if (blank(event.when) || blank(event.measures)) problems.push(`${at}: say when it fires and which measure it feeds.`);
  }
  return problems.slice(0, 24);
}

export type ScreenSpecRead = { ok: true; spec: ScreenSpec } | { ok: false; problems: string[] };

/** Reads a screen spec from what a workspace holds. Nothing about the input is assumed. */
export function readScreenSpec(input: unknown): ScreenSpecRead {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, problems: [`${SCREEN_SPEC_FILE} is not valid JSON.`] };
    }
  }
  const parsed = ScreenSpecShape.safeParse(value);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.slice(0, 10).map((issue) => `${issue.path.join('.') || 'the spec'}: ${issue.message}`) };
  const problems = checkScreenSpec(parsed.data);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, spec: parsed.data };
}

/** The spec as text for a prompt. A model wrote its cells: callers fence it as data. */
export function renderScreenSpec(spec: ScreenSpec, maxChars = 14_000): string {
  const lines: string[] = [`Core moment: ${spec.coreMoment.trim()}`, '', 'Core flow:'];
  spec.tasks.forEach((task, i) => lines.push(`  ${i + 1}. [${task.id}] on ${task.screen}: ${task.goal.trim()} → ${task.outcome.trim()}`));
  for (const screen of spec.screens) {
    lines.push('', `${screen.id} ${screen.name.trim()}${screen.later ? ' (later)' : ''}: ${screen.purpose.trim()}`, `  entry: ${screen.entry.map((e) => e.trim()).join(' · ')}`);
    screen.elements.forEach((element, i) => lines.push(`  ${i + 1}. ${element.name.trim()}: ${element.rule.trim()}${element.goesTo ? ` → ${element.goesTo}` : ''}`));
    for (const state of screen.states) lines.push(`  state "${state.name.trim()}": ${state.shows.trim()}`);
    for (const exception of screen.exceptions) lines.push(`  exception: ${exception.trim()}`);
  }
  if (spec.events.length > 0) lines.push('', 'Events:', ...spec.events.map((event) => `  ${event.name}: ${event.when.trim()} (measures ${event.measures.trim()})`));
  const text = lines.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n(cut)` : text;
}

/** A state of a screen, named as the audit and the project file name it. */
export interface NamedState {
  screen: string;
  name: string;
}
export const stateLabel = (state: NamedState): string => `${state.screen} ${state.name}`;

/**
 * The states a build owes a way to look at: every state the spec lists on a screen its core flow happens on.
 * Those are the screens the product exists for, and their other states (nothing yet, a failure, a limit) are
 * the ones a user will meet first when something is off.
 */
export function coreStates(spec: ScreenSpec): NamedState[] {
  const core = new Set(spec.tasks.map((task) => task.screen));
  return spec.screens.filter((screen) => core.has(screen.id) && !screen.later).flatMap((screen) => screen.states.map((state) => ({ screen: screen.id, name: state.name.trim() }))).slice(0, 12);
}

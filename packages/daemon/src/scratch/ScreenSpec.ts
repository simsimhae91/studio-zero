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
const MAX_SCENARIOS = 6;
/** In a product built to a map there is a scenario for each feature, and a map has many. */
const MAX_SCENARIOS_WIDE = 30;
const MAX_SCREENS_WIDE = 90;

/**
 * Whether this is the plan of a product built to a product map: its scenarios say which feature each walks
 * (see `product/coverage.ts`). Such a plan is as wide as the map, for whoever reads it: the task that builds a
 * milestone, and every later task that changes the product and is held to what it already walks.
 */
const mapped = (spec: ScreenSpec): boolean => spec.scenarios.some((scenario) => (scenario.feature ?? '').trim() !== '');
const MAX_SCENARIO_STEPS = 12;
const TABLE_NAME = /^[a-z][a-z0-9_]{0,62}$/;
/** Who may read a table, as the spec may say it. The first two are checked against a stranger: see `ScenarioRunner`. */
export const READERS = ['owner', 'members', 'signed-in', 'anyone'] as const;
/**
 * The two ways in. They are walked like any step (`data-step="sign-up:1"`, `data-done="sign-up"`), and their
 * ids are fixed because the runner carries them out itself, with a person it makes up for the run.
 */
export const SIGN_UP = 'sign-up';
export const SIGN_IN = 'sign-in';

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
export function checkScreenSpec(spec: ScreenSpec, opts: { draft?: boolean; wide?: boolean } = {}): string[] {
  const problems: string[] = [];
  // A draft's plan is the short one: which screens there are and what a person does, not every element and state.
  const full = opts.draft !== true;

  if (blank(spec.coreMoment)) problems.push('coreMoment is empty: state, in one sentence, the one thing the product exists for a person to do.');
  else if (spec.coreMoment.trim().length > 240 || /\n/.test(spec.coreMoment.trim())) problems.push('coreMoment must be one sentence (240 characters at most, one line).');

  if (spec.screens.length === 0) problems.push('screens is empty: list every screen of the first version, each with an id such as "H-01".');
  const wide = opts.wide === true || mapped(spec);
  if (wide ? spec.screens.length > MAX_SCREENS_WIDE : spec.screens.length > MAX_SCREENS) {
    problems.push(wide ? `screens has ${spec.screens.length} entries; ${MAX_SCREENS_WIDE} is the most. Fold screens that are states of one screen into it.` : `screens has ${spec.screens.length} entries; ${MAX_SCREENS} is the most a first version is planned at. Mark what comes after it with "later": true, or leave it out.`);
  }
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
    if (full && screen.elements.length === 0) problems.push(`${at}: elements is empty: list what is on the screen, and for each what it does and under which rule.`);
    // A draft's plan does not owe its elements; what it gives of them anyway is not held against it.
    (full ? screen.elements : []).forEach((element, i) => {
      const row = `${at}, element ${i + 1}${blank(element.name) ? '' : ` (${element.name.trim().slice(0, 30)})`}`;
      if (blank(element.name)) problems.push(`${row}: name is empty.`);
      if (blank(element.rule) || element.rule.trim().length < 8) problems.push(`${row}: rule is empty or a label. Say what it does when used, what it shows, and any limit that applies.`);
      const to = element.goesTo?.trim();
      if (to !== undefined && to !== '' && !ids.has(to)) problems.push(`${row}: goesTo names ${to}, which is not a screen in this spec.`);
    });
    for (const state of full ? screen.states : []) if (blank(state.name) || blank(state.shows)) problems.push(`${at}: a state needs a name and what the screen shows in it.`);
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
    else if (full && screen.states.filter((s) => !blank(s.name) && !blank(s.shows)).length === 0) problems.push(`screen ${screen.id}: the core flow happens here, so say what it shows when the usual case does not hold (nothing yet, a failure, a limit reached): states is empty.`);
  }

  if (full && spec.events.length === 0) problems.push('events is empty: name what the product records so its use can be measured (at least the completion of each core task), each with when it fires and what it measures.');
  const eventNames = new Set<string>();
  for (const event of full ? spec.events : []) {
    const at = `event ${event.name || '(no name)'}`;
    if (!EVENT_NAME.test(event.name)) problems.push(`${at}: the name must be snake_case ("chore_logged").`);
    else if (eventNames.has(event.name)) problems.push(`${at}: this name is used twice.`);
    eventNames.add(event.name);
    if (blank(event.when) || blank(event.measures)) problems.push(`${at}: say when it fires and which measure it feeds.`);
  }
  if (saysHowItWorks(spec)) problems.push(...checkWorkingParts(spec, wide));
  return problems.slice(0, 24);
}

/** Whether the spec says anything of who uses the product, how they get in, what they do and what is kept. */
const saysHowItWorks = (spec: ScreenSpec): boolean => spec.roles.length > 0 || spec.entry !== null || !blank(spec.noAccounts ?? '') || spec.scenarios.length > 0 || spec.data.length > 0;

/**
 * The parts that make a plan one for a product that works: roles, the way in, the scenarios and the data.
 *
 * As above, only what needs no judge. The references resolve; every role has a scenario and every scenario a
 * role; a product people sign in to starts each scenario with a person signing up, says what it keeps, and
 * says for each table who may read it in one of four words a check can act on.
 */
function checkWorkingParts(spec: ScreenSpec, wide: boolean): string[] {
  const problems: string[] = [];
  const inFirstVersion = (id: string): boolean => spec.screens.some((screen) => screen.id === id && !screen.later);

  if (spec.roles.length === 0) problems.push('roles is empty: say who uses the product, each { "id": a short lowercase word ("treasurer"), "name", "does": what they see and do }. One role is fine when everyone uses it the same way.');
  const roleIds = new Set<string>();
  for (const role of spec.roles) {
    const at = `role ${role.id || '(no id)'}`;
    if (!TASK_ID.test(role.id)) problems.push(`${at}: the id must be a short lowercase word ("treasurer", "member").`);
    else if (roleIds.has(role.id)) problems.push(`${at}: this id is used twice.`);
    roleIds.add(role.id);
    if (blank(role.name) || blank(role.does)) problems.push(`${at}: give its name and, in a line, what this person sees and does.`);
  }

  const entry = spec.entry;
  if (entry === null) {
    if (blank(spec.noAccounts ?? '')) problems.push('entry is missing: say how a person gets in, { "signUp": the id of the screen they sign up on, "signIn": the id of the screen they sign in on, "signOut", "sessionEnded", "forgot", "leave": a sentence each on what happens }. Only a product that keeps nothing a person entered and shows no one what another did has no accounts; that one says why in "noAccounts" instead.');
    if (spec.data.length > 0) problems.push('data lists tables and nobody signs in: rows that belong to no one cannot be kept apart. Give the product an entry, or keep nothing.');
  } else {
    if (!blank(spec.noAccounts ?? '')) problems.push('entry and noAccounts are both given: a product has accounts or it does not.');
    for (const [field, id] of [['signUp', entry.signUp], ['signIn', entry.signIn]] as const) {
      if (!inFirstVersion(id.trim())) problems.push(`entry.${field} names ${id.trim() || '(nothing)'}, which is not a screen of the first version. It is the id of the screen where it happens.`);
    }
    for (const field of ['signOut', 'sessionEnded', 'forgot', 'leave'] as const) {
      if (blank(entry[field]) || entry[field].trim().length < 8) problems.push(`entry.${field} is empty: say in a sentence what happens (where the control is and where the person lands; or that the first version does not have it, and what the person is told instead).`);
    }
    if (spec.data.length === 0) problems.push('data is empty: a product people sign in to keeps something. List each table, { "table": its name in the database, "holds": what a row is, "readers": who may read it }.');
  }

  if (spec.scenarios.length === 0) problems.push('scenarios is empty: for each role, give what that person does from arriving for the first time to having done what they came for, as numbered steps.');
  if (wide ? spec.scenarios.length > MAX_SCENARIOS_WIDE : spec.scenarios.length > MAX_SCENARIOS) {
    problems.push(wide ? `scenarios has ${spec.scenarios.length} entries; ${MAX_SCENARIOS_WIDE} is the most. One a feature: fold a feature's variations into its one scenario.` : `scenarios has ${spec.scenarios.length} entries; give at most ${MAX_SCENARIOS}: one a role, and a second only where a person's way through truly differs.`);
  }
  const scenarioIds: string[] = [];
  for (const scenario of spec.scenarios) {
    const at = `scenario ${scenario.id || '(no id)'}`;
    if (!TASK_ID.test(scenario.id)) problems.push(`${at}: the id must be a short lowercase word ("treasurer-posts").`);
    else if (scenarioIds.includes(scenario.id)) problems.push(`${at}: this id is used twice.`);
    if (!roleIds.has(scenario.role)) problems.push(`${at}: role names ${scenario.role || '(nothing)'}, which is not a role in this spec.`);
    const after = scenario.after?.trim();
    if (after && !scenarioIds.includes(after)) problems.push(`${at}: after names ${after}, which is not a scenario listed before this one. A scenario that depends on what another person did comes after theirs.`);
    scenarioIds.push(scenario.id);

    if (scenario.steps.length === 0) problems.push(`${at}: steps is empty: number what the person does, each { "id", "screen", "does", "saves", "outcome" }.`);
    if (scenario.steps.length > MAX_SCENARIO_STEPS) problems.push(`${at}: ${scenario.steps.length} steps; ${MAX_SCENARIO_STEPS} is the most. A step is something the person gets done (sign up, open a club, post a receipt), not each press.`);
    const stepIds = new Set<string>();
    scenario.steps.forEach((step, i) => {
      const row = `${at}, step ${i + 1}${step.id ? ` (${step.id})` : ''}`;
      if (!TASK_ID.test(step.id)) problems.push(`${row}: the id must be a short lowercase word: it is what the step's controls are marked with (data-step="${step.id || 'id'}:1").`);
      else if (stepIds.has(step.id)) problems.push(`${row}: this id is used twice in the scenario.`);
      stepIds.add(step.id);
      if (step.id === SIGN_IN) problems.push(`${row}: "${SIGN_IN}" is not a step of a scenario. A scenario starts with a new person; signing in again is checked by the studio after it, on the screen entry.signIn names.`);
      if (step.id === SIGN_UP && (i !== 0 || entry === null)) problems.push(`${row}: "${SIGN_UP}" is the first step of a scenario in a product that has accounts, and appears nowhere else.`);
      if (!inFirstVersion(step.screen)) problems.push(`${row}: screen names ${step.screen || '(nothing)'}, which is not a screen of the first version.`);
      else if (step.id === SIGN_UP && entry !== null && step.screen !== entry.signUp.trim()) problems.push(`${row}: signing up happens on ${entry.signUp.trim()} (entry.signUp), and this step says ${step.screen}.`);
      if (blank(step.does)) problems.push(`${row}: does is empty: say what the person does.`);
      if (blank(step.outcome)) problems.push(`${row}: outcome is empty: say what is on the screen once it is done and stays there after a reload (the row, the figure; not a message that fades).`);
    });
    if (entry !== null && scenario.steps.length > 0 && scenario.steps[0]!.id !== SIGN_UP) problems.push(`${at}: the first step must be "${SIGN_UP}": every scenario starts with a person who has never been here.`);
  }
  for (const role of spec.roles) {
    if (roleIds.has(role.id) && spec.scenarios.length > 0 && !spec.scenarios.some((scenario) => scenario.role === role.id)) problems.push(`role ${role.id}: no scenario is theirs. A role nobody walks through is a role nobody checked.`);
  }

  const tables = new Set<string>();
  for (const row of spec.data) {
    const at = `data ${row.table || '(no table)'}`;
    if (!TABLE_NAME.test(row.table)) problems.push(`${at}: table is the table's name in the database, lowercase with underscores ("receipts", "club_members").`);
    else if (tables.has(row.table)) problems.push(`${at}: this table is listed twice.`);
    tables.add(row.table);
    if (blank(row.holds)) problems.push(`${at}: holds is empty: say what one row is.`);
    if (!(READERS as readonly string[]).includes(row.readers)) problems.push(`${at}: readers must be one of "owner" (only the person whose row it is), "members" (the people who share what it belongs to), "signed-in" (anyone with an account) or "anyone" (visitors too).`);
  }
  return problems;
}

/**
 * What a spec still owes before a build can be held to it as a working product: the parts above, present. A
 * spec written before they existed holds as a screen plan and is read as one everywhere it only has to be
 * read; a build is not accepted on it.
 */
export function checkWorks(spec: ScreenSpec): string[] {
  return saysHowItWorks(spec)
    ? []
    : ['The spec says what the screens are and not how the product works. Add "roles" (who uses it), "entry" (how a person signs up, signs in and leaves; or "noAccounts" with the reason, for a product that keeps nothing), "scenarios" (what each role does from arriving to done, as steps a browser can carry out) and "data" (each table and who may read it).'];
}

export type ScreenSpecRead = { ok: true; spec: ScreenSpec } | { ok: false; problems: string[] };

/**
 * Reads a screen spec from what a workspace holds. Nothing about the input is assumed. With `works`, the spec
 * must also say how the product works (roles, entry, scenarios, data): what a build is held to. With `draft`,
 * the screens may be listed without their elements and states.
 */
export function readScreenSpec(input: unknown, opts: { works?: boolean; draft?: boolean; wide?: boolean } = {}): ScreenSpecRead {
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
  const problems = [...checkScreenSpec(parsed.data, opts), ...(opts.works ? checkWorks(parsed.data) : [])];
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
  if (spec.roles.length > 0) lines.push('', 'Roles:', ...spec.roles.map((role) => `  ${role.id} (${role.name.trim()}): ${role.does.trim()}`));
  if (spec.entry) lines.push('', 'Getting in and out:', `  sign up on ${spec.entry.signUp}, sign in on ${spec.entry.signIn}`, `  sign out: ${spec.entry.signOut.trim()}`, `  session ended: ${spec.entry.sessionEnded.trim()}`, `  forgot: ${spec.entry.forgot.trim()}`, `  leave: ${spec.entry.leave.trim()}`);
  else if (!blank(spec.noAccounts ?? '')) lines.push('', `No accounts: ${spec.noAccounts!.trim()}`);
  for (const scenario of spec.scenarios) {
    lines.push('', `Scenario ${scenario.id} (${scenario.role}${scenario.after ? `, after ${scenario.after}` : ''}):`);
    scenario.steps.forEach((step, i) => lines.push(`  ${i + 1}. [${step.id}] on ${step.screen}: ${step.does.trim()} → ${step.outcome.trim()}${step.saves && !blank(step.saves) ? ` (saves ${step.saves.trim()})` : ''}`));
  }
  if (spec.data.length > 0) lines.push('', 'Data:', ...spec.data.map((row) => `  ${row.table}: ${row.holds.trim()} (read by ${row.readers})`));
  const text = lines.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n(cut)` : text;
}

/** A state of a screen, named as the audit and the project file name it. */
export interface NamedState {
  screen: string;
  name: string;
}
export const stateLabel = (state: NamedState): string => `${state.screen} ${state.name}`;

/** How many states of one screen a build is asked to make showable. A real planner lists five or so for the screen that matters. */
const MAX_OWED_STATES = 6;

/**
 * The states a build owes a way to look at: those of the one screen the core flow starts on. That is the
 * screen the product exists for, and its other states (nothing yet, a failure, a limit) are what a user meets
 * first when something is off.
 *
 * Only that screen, on purpose. A real planner, asked for a spec, listed eleven states over three screens;
 * a route and a fixture for each would be most of the engine's work on screens that matter least. The rest
 * stay in the spec as what the build has to do, and are the accepting model's to hold it to.
 */
export function coreStates(spec: ScreenSpec): NamedState[] {
  const first = spec.screens.find((screen) => screen.id === spec.tasks[0]?.screen && !screen.later);
  return first ? first.states.map((state) => ({ screen: first.id, name: state.name.trim() })).slice(0, MAX_OWED_STATES) : [];
}

/** Where the screen plan is written out for a person to read. Generated from the spec, so the two cannot differ. */
export const SCREEN_DOC_FILE = 'docs/screens.md';

const LABELS = {
  ko: { title: '화면설계서', made: '이 문서는 docs/screens.json에서 만들어진다. 고칠 것은 그 파일에서 고친다.', core: '핵심 순간', roles: '역할', role: '역할', name: '이름', does: '보고 하는 일', entry: '들어오고 나가기', signUp: '가입', signIn: '로그인', signOut: '로그아웃', sessionEnded: '세션이 끊겼을 때', forgot: '비밀번호를 잊었을 때', leave: '탈퇴', noAccounts: '계정 없음', scenarios: '시나리오', after: '앞선 시나리오', step: '걸음', screen: '화면', outcome: '끝난 뒤 화면에 있는 것', saves: '저장되는 것', data: '데이터', table: '테이블', holds: '한 행은', readers: '읽을 수 있는 사람', flow: '핵심 흐름', goal: '하는 일', screens: '화면', arrives: '들어오는 길', elements: '요소', rule: '규칙', goesTo: '이동', states: '상태', shows: '보이는 것', exceptions: '예외', later: '나중', events: '이벤트', when: '언제', measures: '재는 것', who: { owner: '그 행의 주인만', members: '같이 쓰는 사람들', 'signed-in': '로그인한 누구나', anyone: '누구나' } },
  en: { title: 'Screen plan', made: 'This document is generated from docs/screens.json. Change that file, not this one.', core: 'Core moment', roles: 'Roles', role: 'Role', name: 'Name', does: 'Sees and does', entry: 'Getting in and out', signUp: 'Sign up', signIn: 'Sign in', signOut: 'Sign out', sessionEnded: 'When the session ends', forgot: 'Forgotten password', leave: 'Leaving', noAccounts: 'No accounts', scenarios: 'Scenarios', after: 'follows', step: 'Step', screen: 'Screen', outcome: 'On screen afterwards', saves: 'Saved', data: 'Data', table: 'Table', holds: 'A row is', readers: 'Who may read it', flow: 'Core flow', goal: 'What gets done', screens: 'Screens', arrives: 'Arrives from', elements: 'Elements', rule: 'Rule', goesTo: 'Leads to', states: 'States', shows: 'Shows', exceptions: 'Exceptions', later: 'later', events: 'Events', when: 'When', measures: 'Measures', who: { owner: 'only the row\'s owner', members: 'the people who share it', 'signed-in': 'anyone signed in', anyone: 'anyone' } },
} as const;

/** A cell of a Markdown table: one line, and no bar that would end the cell. */
const cell = (text: string | null | undefined): string => (text ?? '').trim().replace(/\s*\n\s*/g, ' ').replaceAll('|', '\\|');
const table = (head: readonly string[], rows: readonly (readonly string[])[]): string[] => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)];

/**
 * The spec as a document a person reads: who uses the product, how they get in, what each does step by step,
 * what is kept, and then every screen. Its headings are in the language the spec is written in.
 */
export function screenSpecMarkdown(spec: ScreenSpec): string {
  const t = /[\uac00-\ud7a3]/.test(`${spec.coreMoment}${spec.screens.map((screen) => screen.name).join('')}`) ? LABELS.ko : LABELS.en;
  const screenName = (id: string): string => {
    const found = spec.screens.find((screen) => screen.id === id.trim());
    return found ? `${found.id} ${cell(found.name)}` : cell(id);
  };
  const out: string[] = [`# ${t.title}`, '', `> ${t.made}`, '', `## ${t.core}`, '', spec.coreMoment.trim()];
  if (spec.roles.length > 0) out.push('', `## ${t.roles}`, '', ...table([t.role, t.name, t.does], spec.roles.map((role) => [`\`${role.id}\``, cell(role.name), cell(role.does)])));
  if (spec.entry) {
    out.push('', `## ${t.entry}`, '', ...table(['', ''], [[t.signUp, screenName(spec.entry.signUp)], [t.signIn, screenName(spec.entry.signIn)], [t.signOut, cell(spec.entry.signOut)], [t.sessionEnded, cell(spec.entry.sessionEnded)], [t.forgot, cell(spec.entry.forgot)], [t.leave, cell(spec.entry.leave)]]));
  } else if (!blank(spec.noAccounts ?? '')) out.push('', `## ${t.noAccounts}`, '', spec.noAccounts!.trim());
  if (spec.scenarios.length > 0) {
    out.push('', `## ${t.scenarios}`);
    for (const scenario of spec.scenarios) {
      const role = spec.roles.find((r) => r.id === scenario.role);
      out.push('', `### ${cell(role?.name ?? scenario.role)}: \`${scenario.id}\`${scenario.after ? ` (${t.after} \`${scenario.after}\`)` : ''}`, '', ...table(['#', t.screen, t.does, t.outcome, t.saves], scenario.steps.map((step, i) => [`${i + 1} \`${step.id}\``, screenName(step.screen), cell(step.does), cell(step.outcome), cell(step.saves)])));
    }
  }
  if (spec.data.length > 0) out.push('', `## ${t.data}`, '', ...table([t.table, t.holds, t.readers], spec.data.map((row) => [`\`${row.table}\``, cell(row.holds), (t.who as Record<string, string>)[row.readers] ?? cell(row.readers)])));
  if (spec.tasks.length > 0) out.push('', `## ${t.flow}`, '', ...table(['#', t.screen, t.goal, t.outcome], spec.tasks.map((task, i) => [`${i + 1} \`${task.id}\``, screenName(task.screen), cell(task.goal), cell(task.outcome)])));
  out.push('', `## ${t.screens}`);
  for (const screen of spec.screens) {
    out.push('', `### ${screen.id} ${cell(screen.name)}${screen.later ? ` (${t.later})` : ''}`, '', screen.purpose.trim(), '', `${t.arrives}: ${screen.entry.map((from) => screenName(from)).join(' · ')}`);
    if (screen.elements.length > 0) out.push('', ...table([t.elements, t.rule, t.goesTo], screen.elements.map((element) => [cell(element.name), cell(element.rule), element.goesTo ? screenName(element.goesTo) : ''])));
    if (screen.states.length > 0) out.push('', ...table([t.states, t.shows], screen.states.map((state) => [cell(state.name), cell(state.shows)])));
    if (screen.exceptions.length > 0) out.push('', `${t.exceptions}:`, '', ...screen.exceptions.map((exception) => `- ${cell(exception)}`));
  }
  if (spec.events.length > 0) out.push('', `## ${t.events}`, '', ...table([t.events, t.when, t.measures], spec.events.map((event) => [`\`${event.name}\``, cell(event.when), cell(event.measures)])));
  return `${out.join('\n')}\n`;
}

import { randomBytes } from 'node:crypto';
import type { Browser, BrowserContextOptions, Page } from 'playwright-core';
import { contract } from '@studio-zero/design';
import type { Finding, Project, ScreenSpec, Template, Trails, ViewportId } from '@studio-zero/protocol';
import type { ProjectArms } from '../arms/ProjectArms.ts';
import type { StackInfo } from '../arms/SupabaseStack.ts';
import type { Config } from '../config.ts';
import { ensureDevServer } from '../harness/devServer.ts';
import { readProjectFile } from '../harness/projectFile.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { MAX_STEP_PRESSES, SIGN_IN, SIGN_UP } from '../scratch/ScreenSpec.ts';
import { KeyedMutex, excerpt } from '../util/core.ts';
import { runDomChecks } from './checks.ts';
import { PageDigest, collectDigest } from './collector.ts';
import { colourShares } from './pixels.ts';
import { DONE_ATTR, STEP_ATTR, walkFlow } from './FlowWalker.ts';
import { LOGIN_ATTR, walkLogins } from './LoginWalk.ts';
import type { QaBrowser } from './QaBrowser.ts';
import { samplePhoto } from './samplePhoto.ts';

/**
 * The gate that tells a product that works from a picture of one.
 *
 * The first real build looked like the design the owner chose and ran on fixtures. Nothing the studio checked
 * could tell: the compiler compiled it, the smoke gate loaded it, the audit measured how it looked. This walks
 * the scenarios of the screen plan on the running build, as people the studio makes up for the run, and holds
 * the build to the five things the owner said a working prototype is:
 *
 * 1. a person signs up and signs in: each scenario starts with a new person signing up on the screen, the
 *    backend is asked whether that person now exists, and one of them signs in again on a browser that has
 *    never seen them;
 * 2. what was entered is still there after a reload and after the backend restarts;
 * 3. a stranger with an account, and a visitor without one, read none of what those people made in a table the
 *    plan says is its owner's or its members', and no key that passes the policies is in the workspace;
 * 4. in a product people share, a scenario that follows another's ends with what the other person made on its
 *    screen;
 * 5. every scenario is walked to its last step.
 *
 * And where the product offers signing in with Kakao or Google, each button is pressed as far as the provider's
 * door (`LoginWalk.ts`): the rest of that sign-in is the provider's and a person's.
 *
 * Nothing here is a judgement. Every finding is something that was done, what was looked for, and what was there.
 */

export interface ScenarioOutcome {
  passed: boolean;
  /** How many scenarios the plan has, and how many were walked to their end. */
  scenarios: number;
  walked: number;
  /** What was found, each as a sentence the builder can act on. Empty when the product works. */
  problems: string[];
  /** The providers whose sign-in button was pressed. */
  logins: string[];
  /** One line for the receipt. */
  detail: string;
  durationMs: number;
  /** Each screen the scenarios stood on, measured once, when the caller asked for it (`look`). */
  looks?: ScreenLook[];
  /** Where each scenario went, when the caller asked for looks: the screens its person was on, and the step they were carrying out. */
  trails?: Trails;
}

/**
 * What a walk measures as it goes: nothing (absent or false), every screen it stands on (true), or of those only
 * the ones named (a small edit is measured on the screens it changed and no others).
 */
export type Look = boolean | { only: readonly string[] };

export interface ScenarioRunnerLike {
  /**
   * Walks the plan's scenarios. With `look`, each screen walked over is measured. With `brief`, only the walks
   * themselves are made (each to its end and through a reload): not the restart of the backend, the second
   * sign-in, the provider buttons or the stranger's read, which are checks of the whole product.
   */
  run(project: Project, spec: ScreenSpec, opts?: { signal?: AbortSignal; look?: Look; brief?: boolean }): Promise<ScenarioOutcome>;
}

/**
 * A screen as it was when a scenario's person stood on it: signed in, with what they had entered on it. The
 * audit opens a product's routes as a visitor, so in a product people sign in to it measures the door and
 * nothing behind it; this is the same measurement taken where the walk already is.
 */
/**
 * A screen as a walk measured it. One for each screen as it was first seen, and one more for each later state
 * of it (something new to press, after a press) that showed what the earlier ones had not: that one holds only
 * what was new, and the picture of that state.
 */
export interface ScreenLook {
  /** The screen's id in the plan, as the step that stood on it names it. */
  screen: string;
  scenario: string;
  findings: Finding[];
  png: Buffer | null;
}

/** How long a press on a running app is waited on: a sign-up wakes a service that was asleep. */
const PATIENCE_MS = 8000;
const TABLE_NAME = /^[a-z][a-z0-9_]{0,62}$/;
/** A value worth looking for on another person's screen: something a person typed, not an id, a time or a number. */
const TELLING = /^(?![0-9a-f]{8}-[0-9a-f]{4}-)(?!\d{4}-\d{2}-\d{2})(?!https?:\/\/)(?=.*[^\d\s.,:+-]).{2,60}$/s;

type Row = Record<string, unknown>;
type Tables = Map<string, Row[]>;

const canonical = (row: Row): string => JSON.stringify(Object.keys(row).sort().map((key) => [key, row[key]]));
const keyOf = (row: Row): string => (row.id !== undefined && row.id !== null ? `id:${String(row.id)}` : canonical(row));
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The rows that are in `after` and were not in `before`, table by table: what was made or changed in between. */
function madeBetween(before: Tables, after: Tables): Tables {
  const made: Tables = new Map();
  for (const [table, rows] of after) {
    const had = new Set((before.get(table) ?? []).map(canonical));
    const fresh = rows.filter((row) => !had.has(canonical(row)));
    if (fresh.length > 0) made.set(table, fresh);
  }
  return made;
}

/** What a person typed into the rows they made, as it would read on a screen. */
function tellingValues(made: Tables, not: readonly string[]): string[] {
  const values = new Set<string>();
  for (const rows of made.values()) {
    for (const row of rows) {
      for (const value of Object.values(row)) if (typeof value === 'string' && TELLING.test(value.trim()) && !not.some((own) => value.includes(own))) values.add(value.trim());
    }
  }
  return [...values].slice(0, 12);
}

/** The backend as the runner uses it: past every policy through the database, and as anyone at all through the API. */
export class Backend {
  readonly #info: StackInfo;
  readonly #sql: (script: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

  constructor(info: StackInfo, sql: (script: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>) {
    this.#info = info;
    this.#sql = sql;
  }

  async #lines(script: string): Promise<string[]> {
    const res = await this.#sql(script);
    if (res.exitCode !== 0) throw new Error(`the project's database did not answer: ${res.stderr.trim().slice(0, 300)}`);
    return res.stdout.split('\n').filter((line) => line.trim() !== '');
  }

  /** Every table of `public` with all its rows (a prototype's worth: the first two thousand of each). */
  async tables(): Promise<Tables> {
    const names = (await this.#lines("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1;\n")).filter((name) => TABLE_NAME.test(name));
    const tables: Tables = new Map(names.map((name) => [name, []]));
    if (names.length === 0) return tables;
    const lines = await this.#lines(names.map((name) => `select '${name}' || E'\\t' || coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from (select * from public."${name}" limit 2000) t;`).join('\n'));
    for (const line of lines) {
      const tab = line.indexOf('\t');
      const name = line.slice(0, tab);
      try {
        const rows: unknown = JSON.parse(line.slice(tab + 1));
        if (tables.has(name) && Array.isArray(rows)) tables.set(name, rows as Row[]);
      } catch {
        // A row that is not JSON is not compared.
      }
    }
    return tables;
  }

  /** Whether signing up made a person in the backend. The address is the runner's own and holds nothing to quote. */
  async hasUser(email: string): Promise<boolean> {
    return (await this.#lines(`select count(*) from auth.users where email = '${email}';\n`))[0]?.trim() === '1';
  }

  async #auth(path: string, email: string, password: string): Promise<string | null> {
    const res = await fetch(`${this.#info.apiUrl}${path}`, { method: 'POST', headers: { apikey: this.#info.publishableKey, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(20_000) }).catch(() => null);
    const body = res && res.ok ? ((await res.json().catch(() => null)) as { access_token?: unknown } | null) : null;
    return typeof body?.access_token === 'string' ? body.access_token : null;
  }

  /** A person nobody has been: an account made through the API, as any stranger could make one. */
  stranger(email: string, password: string): Promise<string | null> {
    return this.#auth('/auth/v1/signup', email, password);
  }

  signIn(email: string, password: string): Promise<string | null> {
    return this.#auth('/auth/v1/token?grant_type=password', email, password);
  }

  /** The rows of a table as someone reads them through the API: with a person's token, or as a visitor with none. A refusal reads as nothing. */
  async readAs(table: string, token: string | null): Promise<Row[]> {
    const res = await fetch(`${this.#info.apiUrl}/rest/v1/${table}?select=*&limit=2000`, { headers: { apikey: this.#info.publishableKey, ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    const rows: unknown = res && res.ok ? await res.json().catch(() => null) : null;
    return Array.isArray(rows) ? (rows as Row[]) : [];
  }

  /**
   * Takes the people made for one walk out again, with whatever hangs on them, and returns what the backend said
   * if it would not let them go (null when it did). A product's own trigger can refuse (one that recomputes a
   * score for the person being deleted did, all through the first long run, and 353 made-up people stayed in
   * that project's database): that is a defect of the product, since deleting an account fails the same way,
   * and it is not left as the owner's clutter either. They are then taken out with the product's triggers held
   * off for the length of the delete.
   */
  async forget(run: string): Promise<string | null> {
    const mine = `delete from auth.users where email like 'sz-%-${run}@example.com';\n`;
    const plain = await this.#sql(mine).catch((err: unknown) => ({ exitCode: 1, stdout: '', stderr: String(err) }));
    if (plain.exitCode === 0) return null;
    const tables = `select c.oid::regclass as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and exists (select 1 from pg_trigger g where g.tgrelid = c.oid and not g.tgisinternal)`;
    await this.#sql(
      `do $forget$ declare t record; begin\n  for t in ${tables} loop execute format('alter table %s disable trigger user', t.rel); end loop;\n  ${mine}  for t in ${tables} loop execute format('alter table %s enable trigger user', t.rel); end loop;\nend $forget$;\n`,
    ).catch(() => undefined);
    return excerpt(plain.stderr.replace(/\s+/g, ' ').trim(), 600);
  }

  get adminKeys(): readonly string[] {
    return this.#info.adminKeys;
  }

  get apiOrigin(): string {
    return new URL(this.#info.apiUrl).origin;
  }

  /** The providers this backend signs people in with besides email. */
  get logins(): readonly string[] {
    return this.#info.logins;
  }
}

/** Why a step stopped, in the words the flow walk uses, addressed to whoever marked the page. */
const stoppedBecause = (id: string, stopped: string | null, atStep: number | null, presses: number): string =>
  stopped === 'step-missing'
    ? `no visible control carries ${STEP_ATTR}="${id}:${atStep ?? 1}"${(atStep ?? 1) > 1 ? ' after the press before it' : ''}`
    : stopped === 'covered'
      ? `the control marked ${STEP_ATTR}="${id}:${atStep}" lies under another element and cannot be pressed`
      : stopped === 'already-done'
        ? `[${DONE_ATTR}="${id}"] was on screen before anything was pressed, so there was nothing to carry out`
        : presses >= MAX_STEP_PRESSES
          ? `${presses} marked controls were pressed, which is as far as the studio goes in one step, and nothing carrying ${DONE_ATTR}="${id}" had come on screen. Split it: a step is one thing a person gets done, with its own id, its own marks counted from 1 and its own outcome on screen`
          : `${presses === 0 ? 'nothing was pressed' : `${plural(presses, 'marked control')} ${presses === 1 ? 'was' : 'were'} pressed`} and nothing carrying ${DONE_ATTR}="${id}" came on screen`;

/** A person made up for one walk. The address says which walk, so its people can be found and taken out again. */
const person = (name: string, run: string): { email: string; password: string } => ({ email: `sz-${name}-${run}@example.com`, password: `Sz-${randomBytes(9).toString('base64url')}` });

export interface ScenarioWalk {
  /** How many scenarios were walked to their end, reload included. */
  walked: number;
  problems: string[];
  /** The providers the product offers a sign-in with, each pressed as far as the provider. */
  logins: string[];
  /** Each screen a step stood on, measured the first time one did. Empty unless `look` was given. */
  looks: ScreenLook[];
  /** Where each scenario went (see `ScenarioOutcome.trails`). Empty unless `look` was given. */
  trails: Trails;
}

/** How long a screen is left to come to rest before it is measured: what a step leaves may still be arriving. */
const REST_MS = 700;

/** The mark a screen's root carries with its id in the plan, so that what is measured is said of the right screen. */
export const SCREEN_ATTR = 'data-screen';
/** How many states of one screen a walk measures: the one it is first seen in, and the next few a press puts it in. */
const MAX_STATES = 4;

/**
 * What can be pressed on the page, as a word for the state its screen is in. A screen that has grown a button,
 * opened a sheet or swapped its action is in another state; one whose figures moved is not, so digits are
 * levelled. Runs in the page.
 */
const pressableNow = (): string =>
  [...document.querySelectorAll<HTMLElement>('button, a[href], summary, [role=button], [role=link], [role=tab], [role=menuitem], [tabindex]:not([tabindex="-1"])')]
    .filter((el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    })
    .map((el) => (el.innerText || el.getAttribute('aria-label') || '').replace(/\d+/g, '0').replace(/\s+/g, ' ').trim())
    .filter((label) => label !== '')
    .sort()
    .join('|');

/**
 * Which screen the page is showing, by its own word: the marked root that holds the middle of the window (a
 * stack keeps the screens under the top one mounted), or failing that the last marked root that can be seen.
 * Null when nothing is marked. Runs in the page.
 */
const shownScreen = (attr: string): string | null => {
  const seen = (el: Element): boolean => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const middle = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.closest(`[${attr}]`);
  const root = middle ?? [...document.querySelectorAll(`[${attr}]`)].filter(seen).at(-1) ?? null;
  return root?.getAttribute(attr)?.trim() || null;
};

/**
 * Measures the page as it stands, against the design contract, at the size it is being walked at. `first` marks
 * the two screens a person meets the product on: the one it exists for (`core`, the core flow's) and the one a
 * visitor sees before signing in (`door`). What a screen is made of and its colour are asked of those, as the
 * audit asks them of a first screen; the tab bar is asked of the first and not of the door.
 */
async function lookAt(browser: Browser, page: Page, at: { screen: string; scenario: string; viewport: ViewportId; width: number; scale: number; touch: boolean; template: Template; first: 'core' | 'door' | null }): Promise<ScreenLook> {
  const digest = PageDigest.safeParse(await page.evaluate(collectDigest, 600).catch(() => null));
  const png = await page.screenshot({ type: 'png' }).catch(() => null);
  const shares = at.first !== null && png && digest.success && digest.data.composition ? await colourShares(browser, png, { mask: digest.data.composition.mediaBoxes, scale: at.scale }).catch(() => null) : null;
  const findings = digest.success
    ? runDomChecks(digest.data, { viewport: at.viewport, viewportWidth: at.width, route: at.screen, touch: at.touch, scope: 'full', template: at.template, ...(at.first !== null ? { firstScreen: true, door: at.first === 'door' } : {}), ...(shares ? { shares } : {}) }, contract)
    : [];
  return { screen: at.screen, scenario: at.scenario, findings, png };
}

/**
 * Walks a plan's scenarios on a product that is already being served at `base`, in a browser that is already
 * open, and then puts what the scenarios' people made to the rest of the contract. Apart from the class below
 * so that it can be run against a real browser and a real backend without a sandbox.
 *
 * `backend` is null for a product nobody signs in to: its scenarios are walked as a visitor and that is all.
 * `restart` takes the backend down and brings it back. `run` names the walk (see `walkFlow`).
 */
export async function walkScenarios(deps: { browser: Browser; base: string; phone: BrowserContextOptions | null; spec: ScreenSpec; backend: Backend | null; restart: () => Promise<void>; run: string; signal?: AbortSignal; look?: { template: Template; only?: readonly string[] }; brief?: boolean }): Promise<ScenarioWalk> {
  const { browser, base, spec, backend, run } = deps;
  const touch = deps.phone !== null;
  const problems: string[] = [];
  const people = new Map<string, { email: string; password: string }>();
  const made = new Map<string, Tables>();
  let walked = 0;
  const looks: ScreenLook[] = [];
  const looked = new Set<string>();
  /** The states each screen has been measured in (`pressableNow`), and the rules it has been found breaking. */
  const states = new Map<string, Set<string>>();
  const broken = new Map<string, Set<string>>();
  const trails: Trails = {};
  const size = { viewport: (touch ? 'iphone-15-pro' : 'desktop-1440') as ViewportId, width: deps.phone?.viewport?.width ?? 1440, scale: deps.phone?.deviceScaleFactor ?? 1 };
  const planned = new Set(spec.screens.map((screen) => screen.id));
  const core = spec.tasks[0]?.screen ?? null;

  const stranger = person('stranger', run);
  const strangerToken = backend ? await backend.stranger(stranger.email, stranger.password) : null;
  if (backend && strangerToken === null) return { walked: 0, logins: [], looks, trails, problems: ['The studio could not make an account through the backend\'s own sign-up (email and password). The scenarios are walked as people who sign up that way: leave it switched on.'] };

  const open = async (): Promise<{ page: Page; refused: string[]; close: () => Promise<void> }> => {
    const context = await browser.newContext({ ...(deps.phone ?? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }), serviceWorkers: 'block' });
    const page = await context.newPage();
    // A step that has the person choose a photo: there is nobody to choose one, so the chooser is answered with
    // the studio's sample (a product whose feature starts from a photo is walked like any other).
    page.on('filechooser', (chooser) => void chooser.setFiles({ name: 'sample-photo.png', mimeType: 'image/png', buffer: samplePhoto() }).catch(() => undefined));
    // What the backend refused is the most useful thing a builder can be told about a step that did not finish.
    const refused: string[] = [];
    page.on('response', (res) => {
      if (res.status() < 400 || !backend || !res.url().startsWith(backend.apiOrigin)) return;
      void res.text().then((body) => refused.push(`${res.status()} ${res.request().method()} ${new URL(res.url()).pathname}: ${excerpt(body.replace(/\s+/g, ' '), 240)}`), () => undefined);
    });
    await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => undefined);
    return { page, refused, close: () => context.close().catch(() => undefined) };
  };
  const showing = async (page: Page, id: string, forMs: number): Promise<boolean> => page.locator(`[${DONE_ATTR}="${id}"]`).first().waitFor({ state: 'visible', timeout: forMs }).then(() => true, () => false);
  const onScreen = async (page: Page): Promise<string> => page.evaluate(() => document.body.innerText).then((text) => String(text), () => '');
  const said = (text: string, refused: readonly string[]): string => `${text.trim() === '' ? ' The screen was empty.' : ` The screen said: "${excerpt(text.replace(/\s+/g, ' ').trim(), 300)}"`}${refused.length > 0 ? ` The backend refused: ${refused.slice(-3).join(' | ')}` : ''}`;

  let before: Tables = backend ? await backend.tables() : new Map();
  /**
   * What the scenario's person had made in the backend when a step stopped, for whoever has to find out why: a
   * builder cannot reach the backend from its sandbox, and "the screen said" is not what was saved. A few rows a
   * table, cut short.
   */
  const madeSoFar = async (): Promise<string> => {
    if (!backend) return '';
    const made = madeBetween(before, await backend.tables().catch(() => before));
    if (made.size === 0) return ' No row of any table had been made or changed by then.';
    return ` Rows made or changed by then: ${[...made].map(([table, rows]) => `${table} (${rows.length}) ${excerpt(JSON.stringify(rows.slice(0, 3)), 600)}`).join('; ').slice(0, 2400)}`;
  };
  for (const scenario of spec.scenarios) {
    if (deps.signal?.aborted) throw deps.signal.reason;
    const who = person(scenario.id, run);
    /** The step this scenario's person is carrying out, for the record of where they went. */
    let carrying = scenario.steps[0]?.id ?? '';
    const role = spec.roles.find((r) => r.id === scenario.role)?.name ?? scenario.role;
    const at = `Scenario "${scenario.id}" (${role})`;
    const { page, refused, close } = await open();
    /**
     * Measures the screen the page is on, if no walk has measured it as it now stands. A screen says which it is
     * where its root is marked; where it is not, `planSays` (the plan's word for where a step happens) is the
     * best there is, and with neither nothing is measured. Asked after every press, so a screen passed through
     * on the way to an outcome (a form, a sheet) is measured too, and at the start, for the door.
     *
     * A screen is not one picture. A press can leave a person on the same screen with something new to press
     * (a second button that comes with saving, a sheet), and what is wrong may only be there then: the first
     * long run passed a dock whose second button, shown once a tip was saved, broke its label in two. So a
     * screen already measured is measured again in each new state a press puts it in, up to `MAX_STATES`, and
     * of a later state only what is above minor and new to the screen is kept, with a picture of that state.
     */
    const see = async (planSays: string | null, door = false): Promise<void> => {
      if (!deps.look) return;
      const which = async (): Promise<string> => {
        const shown = await page.evaluate(shownScreen, SCREEN_ATTR).catch(() => null);
        return shown !== null && planned.has(shown) ? shown : (planSays ?? '');
      };
      const stateOf = (): Promise<string | null> => page.evaluate(pressableNow).catch(() => null);
      /** Whether the screen, already measured, stands in a state that was not, and may still be measured in one more. */
      const another = (screen: string, state: string | null): boolean => state !== null && !states.get(screen)!.has(state) && states.get(screen)!.size < MAX_STATES;
      const now = await which();
      if (now !== '') {
        // Where this person is, whatever is measured of it: a later, smaller walk is chosen by who passes a screen.
        const trail = (trails[scenario.id] ??= []);
        if (trail.at(-1)?.screen !== now || trail.at(-1)?.step !== carrying) trail.push({ screen: now, step: carrying });
      }
      if (now === '' || (deps.look.only && !deps.look.only.includes(now)) || (looked.has(now) && !another(now, await stateOf()))) return;
      // What a press leaves may still be arriving (a figure counting up, a sheet sliding in): measured once it is still.
      await page.waitForTimeout(REST_MS).catch(() => undefined);
      const screen = await which();
      if (screen === '' || (deps.look.only && !deps.look.only.includes(screen))) return;
      const state = await stateOf();
      const again = looked.has(screen);
      if (again && !another(screen, state)) return;
      looked.add(screen);
      states.set(screen, (states.get(screen) ?? new Set<string>()).add(state ?? ''));
      const look = await lookAt(browser, page, { screen, scenario: scenario.id, ...size, touch, template: deps.look.template, first: again ? null : screen === core ? 'core' : door ? 'door' : null });
      const had = broken.get(screen) ?? new Set<string>();
      broken.set(screen, had);
      const fresh = again ? look.findings.filter((finding) => finding.severity !== 'minor' && !had.has(finding.rule)) : look.findings;
      for (const finding of look.findings) had.add(finding.rule);
      if (!again || fresh.length > 0) looks.push({ ...look, findings: fresh });
    };
    try {
      await see(null, backend !== null);
      let through = true;
      for (const [i, step] of scenario.steps.entries()) {
        carrying = step.id;
        // Where the step begins is part of where it went: its first press is made on this screen.
        if (i > 0) await see(null);
        const walk = (await walkFlow(page, [{ id: step.id, goal: step.does, outcome: step.outcome }], { touch, patienceMs: PATIENCE_MS, identity: who, run, maxPresses: MAX_STEP_PRESSES, afterPress: () => see(null), lean: true })).tasks[0];
        // A step may be something the person only sees. Signing up is never that.
        const reached = walk?.reached === true || (i > 0 && walk?.stopped === 'already-done');
        if (!reached) {
          problems.push(`${at}, step ${i + 1} "${step.id}" (${step.does.trim()}): ${stoppedBecause(step.id, walk?.stopped ?? 'step-missing', walk?.stoppedAtStep ?? null, walk?.presses ?? 0)}. Expected afterwards: ${step.outcome.trim()}.${said(await onScreen(page), refused)}` + (await madeSoFar()));
          through = false;
          break;
        }
        if (step.id === SIGN_UP && backend && !(await backend.hasUser(who.email))) {
          problems.push(`${at}, step 1 "${SIGN_UP}": the screen showed its outcome, and the backend has no user with the address the studio typed into the email field (${who.email}). Signing up has to make the person in the backend (supabase.auth.signUp), with the field's own value.${said(await onScreen(page), refused)}`);
          through = false;
          break;
        }
        await see(step.screen.trim());
      }
      if (!through) continue;
      const last = scenario.steps.at(-1)!;
      await page.reload({ waitUntil: 'networkidle', timeout: 45_000 }).catch(() => undefined);
      if (!(await showing(page, last.id, PATIENCE_MS))) {
        problems.push(`${at}: after a reload, nothing carrying ${DONE_ATTR}="${last.id}" is on screen (${last.outcome.trim()}). What a step leaves has to be read back from the backend, and the session has to survive a reload.${said(await onScreen(page), refused)}` + (await madeSoFar()));
        continue;
      }
      const text = await onScreen(page);
      const now = backend ? await backend.tables() : before;
      const madeHere = madeBetween(before, now);
      made.set(scenario.id, madeHere);
      before = now;
      const saves = scenario.steps.filter((step) => step.id !== SIGN_UP && step.saves && step.saves.trim() !== '');
      if (backend && saves.length > 0 && madeHere.size === 0) {
        problems.push(`${at}: its steps say they save (${saves.map((step) => `"${step.id}": ${step.saves!.trim()}`).join('; ')}), and no row of any table in the backend was made or changed while it was walked. What the screen showed did not come from the backend.`);
        continue;
      }
      const follows = scenario.after ? made.get(scenario.after) : undefined;
      if (scenario.after && follows) {
        const looked = tellingValues(follows, [...people.values()].map((p) => p.email));
        if (looked.length > 0 && !looked.some((value) => text.includes(value))) {
          problems.push(`${at} follows "${scenario.after}", and its last screen shows none of what that person saved (looked for ${looked.slice(0, 4).map((value) => `"${value}"`).join(', ')}). What one person adds has to reach the other's screen.${said(text, refused)}`);
          continue;
        }
      }
      people.set(scenario.id, who);
      walked += 1;
    } finally {
      await close();
    }
  }
  if (!backend || deps.brief) return { walked, problems, logins: [], looks, trails };
  // Whatever became of the scenarios, the provider buttons are pressed: a builder is told everything in one go.
  const pressed = await walkLogins({ browser, base, phone: deps.phone, apiOrigin: backend.apiOrigin, on: backend.logins });
  if (problems.length > 0 || walked === 0) return { walked, problems: [...problems, ...pressed.problems], logins: pressed.offered, looks, trails };

  // The backend goes down and comes back: every row is still there, and a person can sign in again on a browser that has never seen them.
  const kept = await backend.tables();
  await deps.restart();
  const back = await backend.tables();
  for (const [table, rows] of kept) {
    const now = back.get(table)?.length ?? 0;
    if (now !== rows.length) problems.push(`After the backend was stopped and started again, table ${table} has ${plural(now, 'row')} where it had ${rows.length}.`);
  }
  const [firstId, first] = [...people.entries()][0]!;
  const again = await open();
  try {
    const walk = (await walkFlow(again.page, [{ id: SIGN_IN, goal: 'sign in again', outcome: 'signed in' }], { touch, patienceMs: PATIENCE_MS, identity: first, run, maxPresses: MAX_STEP_PRESSES, lean: true })).tasks[0];
    if (walk?.reached !== true) {
      problems.push(`Signing in again: the person who signed up in scenario "${firstId}" opened the product on a fresh browser, and ${stoppedBecause(SIGN_IN, walk?.stopped ?? 'step-missing', walk?.stoppedAtStep ?? null, walk?.presses ?? 0)}. From the signed-out screen the sign-in controls are marked ${STEP_ATTR}="${SIGN_IN}:1", ":2", ... (a link to the sign-in screen may be the first), and ${DONE_ATTR}="${SIGN_IN}" is on something only a signed-in person sees.${said(await onScreen(again.page), again.refused)}`);
    }
  } finally {
    await again.close();
  }

  // As a stranger with an account, and as a visitor without one: what the scenarios' people made is not theirs to read.
  const all: Tables = new Map();
  for (const tables of made.values()) for (const [table, rows] of tables) all.set(table, [...(all.get(table) ?? []), ...rows]);
  for (const table of back.keys()) {
    const declared = spec.data.find((row) => row.table === table)?.readers;
    if (declared === undefined) problems.push(`Table ${table} is in the database and not in the plan's "data". Say what a row of it is and who may read it; until then it is checked as its owner's alone.`);
    const mine = new Set((all.get(table) ?? []).map(keyOf));
    if (mine.size === 0) continue;
    const leaked = async (token: string | null): Promise<number> => (await backend.readAs(table, token)).filter((row) => mine.has(keyOf(row))).length;
    const policy = declared === undefined ? 'not in the plan, so its owner\'s alone' : `"${declared}" may read it`;
    if (declared !== 'signed-in' && declared !== 'anyone') {
      const n = await leaked(strangerToken);
      if (n > 0) problems.push(`Table ${table} (${policy}): a stranger who had only signed up read ${plural(n, 'row')} that the scenarios' people made. Its select policy lets any signed-in person through; write it against who the row belongs to.`);
    }
    if (declared !== 'anyone') {
      const n = await leaked(null);
      if (n > 0) problems.push(`Table ${table} (${policy}): a visitor who was not signed in read ${plural(n, 'row')} that the scenarios' people made. Take the grant or the policy for "anon" off it.`);
    }
  }
  return { walked, problems: [...problems, ...pressed.problems], logins: pressed.offered, looks, trails };
}

export class ScenarioRunner implements ScenarioRunnerLike {
  readonly #config: Config;
  readonly #sandboxes: OrbStackManager;
  readonly #browser: QaBrowser;
  readonly #arms: Pick<ProjectArms, 'has' | 'ensure' | 'rest' | 'sql'>;
  readonly #walking = new KeyedMutex();

  constructor(deps: { config: Config; sandboxes: OrbStackManager; browser: QaBrowser; arms: Pick<ProjectArms, 'has' | 'ensure' | 'rest' | 'sql'> }) {
    this.#config = deps.config;
    this.#sandboxes = deps.sandboxes;
    this.#browser = deps.browser;
    this.#arms = deps.arms;
  }

  run(project: Project, spec: ScreenSpec, opts: { signal?: AbortSignal; look?: Look; brief?: boolean } = {}): Promise<ScenarioOutcome> {
    // One walk a project at a time. The walkers of two walks would be people of one backend (a second person
    // matched with a stranger from the other walk), and a full walk takes that backend down and up again in the
    // middle of whatever else is being walked. Slots made this possible: a small edit, a full check and a
    // milestone can each want a walk of the same project at once.
    return this.#walking.run(project.id, () => this.#run(project, spec, opts));
  }

  async #run(project: Project, spec: ScreenSpec, opts: { signal?: AbortSignal; look?: Look; brief?: boolean }): Promise<ScenarioOutcome> {
    const started = Date.now();
    const total = spec.scenarios.length;
    const finish = (walked: number, problems: string[], logins: string[] = [], looks: ScreenLook[] = [], trails: Trails = {}): ScenarioOutcome => ({
      passed: problems.length === 0,
      scenarios: total,
      walked,
      problems,
      logins,
      detail:
        problems.length === 0
          ? `${plural(total, 'scenario')} walked to the end as new people${spec.entry !== null && !opts.brief ? '; their data outlived a reload and a restart and was closed to a stranger' : ''}${logins.length > 0 ? `; signing in with ${logins.join(' and ')} leaves for the provider from its button` : ''}`
          : `${walked} of ${plural(total, 'scenario')} walked to the end; ${plural(problems.length, 'finding')}`,
      durationMs: Date.now() - started,
      looks,
      trails,
    });
    if (spec.entry !== null && !this.#arms.has(project)) {
      return finish(0, ['The plan says people sign in, and the project has no backend: apply_schema was never called. Write the schema in supabase/migrations, apply it, and sign people up through the client in .studio-zero/arms-kit.']);
    }
    const backend = spec.entry !== null ? new Backend((await this.#arms.ensure(project))!.info, (script) => this.#arms.sql(project, script)) : null;

    const file = await readProjectFile(this.#sandboxes, project, this.#config);
    const server = await ensureDevServer(this.#sandboxes, project, file, { reuse: true });
    if (!server.ready) return finish(0, [`The dev server (\`${file.dev.command}\`) did not answer on port ${file.dev.port}. Its log:\n${excerpt(server.log, 2000)}`]);

    const run = randomBytes(4).toString('hex');
    let forgotten = false;
    const restart = async (): Promise<void> => {
      await this.#arms.rest(project);
      await this.#arms.ensure(project);
    };
    try {
      const result = await this.#browser.use(project, opts.signal, ({ browser, host, devices }) =>
        walkScenarios({ browser, base: `http://${host}:${file.dev.port}`, phone: project.template === 'mobile-expo' ? devices['iPhone 15 Pro']! : null, spec, backend, restart, run, ...(opts.signal ? { signal: opts.signal } : {}), ...(opts.look ? { look: { template: project.template === 'studio-core' ? 'web-vite-react' : project.template, ...(typeof opts.look === 'object' ? { only: opts.look.only } : {}) } } : {}), ...(opts.brief ? { brief: true } : {}) }),
      );
      const problems = [...result.problems];
      if (backend && !opts.brief) {
        // A key that passes every policy has no way into the sandbox. This looks anyway: one would undo all of the above.
        const found = await this.#sandboxes.exec(project, `grep -rIlF ${backend.adminKeys.map((key) => `-e '${key.replaceAll("'", '')}'`).join(' ')} --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null | head -5; true`, { timeoutSec: 60 });
        const files = found.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
        if (files.length > 0) problems.push(`A key that passes every policy is in the workspace (${files.join(', ')}). Remove it: nothing the product ships may hold it, and the product never needs it.`);
        if (result.logins.length === 0) {
          // A provider sign-in that carries no mark was not pressed, and would pass unlooked at.
          const calls = await this.#sandboxes.exec(project, "grep -rIl --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' -e 'signInWithOAuth' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.studio-zero --exclude-dir=dist --exclude-dir=.next --exclude-dir=.expo . 2>/dev/null | head -3; true", { timeoutSec: 60 });
          const where = calls.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
          if (where.length > 0) problems.push(`The product signs people in with a provider (signInWithOAuth in ${where.join(', ')}), and no button marked ${LOGIN_ATTR} was found on the signed-out screen or one press of the sign-in or sign-up marks from it. Mark each provider's button with the provider's name (${LOGIN_ATTR}="kakao"; React Native: dataSet={{ login: 'kakao' }}) so that the studio can press it.`);
        }
      }
      // The project's database is the owner's to look at, and is not left filling with one walk's people after another.
      forgotten = true;
      const held = backend ? await backend.forget(run) : null;
      if (held !== null && !opts.brief) problems.push(`The people the studio signed up for this walk could not be deleted from the backend (delete from auth.users). The backend said: ${held} Deleting an account has to work, and it fails the same way for a real person: find what refuses (a trigger or a function that writes for the person while their rows are going) and make it let them go. The studio has taken its own people out with the product's triggers held off.`);
      return finish(result.walked, problems, result.logins, result.looks, result.trails);
    } finally {
      if (!forgotten) await backend?.forget(run);
    }
  }
}

/** The findings as they go back to the engine. */
export function renderScenarioFeedback(outcome: Pick<ScenarioOutcome, 'problems' | 'scenarios' | 'walked'>): string {
  return [`The studio walked the plan's scenarios on the running build as new people: ${outcome.walked} of ${outcome.scenarios} reached the end.`, ...outcome.problems.map((problem) => `- ${problem}`)].join('\n');
}

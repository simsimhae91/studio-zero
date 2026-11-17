import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as http from 'node:http';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VAULT_ID, hide, type SecretStore } from './secrets.ts';

/**
 * The arms: services a product's server calls with a key of the owner's, for a job a product cannot do on its own
 * (a public body's published figures, a model reading a picture into fields, signing in with a provider). Each is
 * a file of the catalogue (`plugin/skills/backend/arms/<name>.md`), read by whoever builds a product and by this
 * module: its front matter names the keys (the vault id, the name a product's server gets it under, what it is,
 * whether the arm works without it, what it costs the owner), and a section in Korean gives the owner's steps to
 * get each key and the one line that stores it.
 *
 * `need` is the step that guides the owner when a key is missing; `check` proves a key works with the smallest
 * real call the service allows. A key's value is read from the vault only to make that call: it is in no argument,
 * no file and nothing printed, and what a service answers is printed with every form of the key taken out.
 */

export class ArmError extends Error {}

/** Without this key: the arm does not work; it works when another key of the arm is there; it works anyway. */
export const WITHOUT = ['stops', 'another', 'works'] as const;
export type Without = (typeof WITHOUT)[number];

export interface ArmKey {
  /** Where the vault keeps it. */
  id: string;
  /** The name a product's server gets it under in its environment. */
  env: string;
  what: string;
  without: Without;
  /** What it costs the owner: free by application, billed per call, a business registration. */
  costs: string;
}

export interface Arm {
  name: string;
  /** One line: what it does for a product. */
  does: string;
  /** The call `sz-eyes arm check` makes, in a line; or `none: <how the arm is shown to work instead>`. */
  check: string;
  keys: ArmKey[];
  file: string;
  /** The owner's steps, a part of the file for one or more keys: the `###` heading that names them and what follows. */
  steps: { ids: string[]; text: string }[];
}

/** The heading of the owner's part of an arm's file. */
export const OWNER_HEADING = '## 주인이 할 일';
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const KEY_FIELDS = ['id', 'env', 'what', 'without', 'costs'];

/** The catalogue beside this checkout. */
export const ARMS_DIR = fileURLToPath(new URL('../../../plugin/skills/backend/arms', import.meta.url));
export const armsDir = (env: NodeJS.ProcessEnv = process.env): string => (env.SZ_ARMS_DIR ? resolve(env.SZ_ARMS_DIR) : ARMS_DIR);

/** The line the owner runs at the prompt of a session, with the key on the clipboard. */
export const storeLine = (id: string): string => `! pbpaste | sz-eyes secret set ${id}`;

const unquote = (value: string): string => {
  const v = value.trim();
  return v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) ? v.slice(1, -1) : v;
};

/** One arm's file, read and held to its shape. What is wrong is said with the file's name. */
export function parseArm(file: string, text: string): Arm {
  const where = basename(file);
  const fail = (why: string): never => {
    throw new ArmError(`${where}: ${why}`);
  };
  const whole = text.replace(/\r\n/g, '\n');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(whole);
  if (!front) return fail('no front matter: the file starts with a line ---, then the fields, then a line ---');
  const head = new Map<string, string>();
  const keys: Map<string, string>[] = [];
  let inKeys = false;
  for (const [n, line] of front[1]!.split('\n').entries()) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const top = /^([a-z]+):\s*(.*)$/.exec(line);
    const item = /^\s+-\s+([a-z]+):\s*(.*)$/.exec(line);
    const field = /^\s+([a-z]+):\s*(.*)$/.exec(line);
    if (top) {
      const [, name, value] = top as unknown as [string, string, string];
      if (head.has(name) || (name === 'keys' && inKeys)) fail(`${name} is given twice`);
      inKeys = name === 'keys';
      if (inKeys) {
        if (value.trim() !== '') fail('keys: is followed by its keys on the lines below, each starting "  - id: "');
        head.set('keys', '');
      } else head.set(name, unquote(value));
    } else if (item && inKeys) keys.push(new Map([[item[1]!, unquote(item[2]!)]]));
    else if (field && inKeys && keys.length > 0) {
      const key = keys.at(-1)!;
      if (key.has(field[1]!)) fail(`a key gives ${field[1]} twice`);
      key.set(field[1]!, unquote(field[2]!));
    } else fail(`line ${n + 2} is not "field: value" or a key of "keys:": ${line.trim()}`);
  }
  for (const name of head.keys()) if (!['name', 'does', 'check', 'keys'].includes(name)) fail(`"${name}" is not a field of an arm (name, does, check, keys)`);
  const name = head.get('name') ?? '';
  if (!NAME.test(name)) fail('name: is lower-case words joined by dashes, like public-data');
  if (`${name}.md` !== where) fail(`its name is "${name}" and its file is ${where}: an arm's file is named <name>.md`);
  const does = head.get('does') ?? '';
  const check = head.get('check') ?? '';
  if (does.length < 8) fail('does: says in one line what the arm does for a product');
  if (check.length < 4) fail('check: says the call `sz-eyes arm check` makes, or "none: <how the arm is shown to work instead>"');
  if (keys.length === 0) fail('keys: names the keys of the owner\'s the arm runs on');
  const parsed = keys.map((key, i): ArmKey => {
    const id = key.get('id') ?? '';
    if (id === '') fail(`key ${i + 1} has no vault id (id: <where the vault keeps it>, like model/anthropic/api-key)`);
    if (!VAULT_ID.test(id)) fail(`"${id}" is not a vault id: lower-case words joined by slashes, like model/anthropic/api-key`);
    for (const field of key.keys()) if (!KEY_FIELDS.includes(field)) fail(`${id}: "${field}" is not a field of a key (${KEY_FIELDS.join(', ')})`);
    const env = key.get('env') ?? '';
    if (!ENV_NAME.test(env)) fail(`${id}: env "${env}" is not the name of an environment variable (upper-case, like ANTHROPIC_API_KEY)`);
    const without = key.get('without') ?? '';
    if (!(WITHOUT as readonly string[]).includes(without)) fail(`${id}: without is ${WITHOUT.join(', ')} (the arm stops without it, works when another of its keys is there, or works anyway)`);
    for (const field of ['what', 'costs']) if ((key.get(field) ?? '').length < 4) fail(`${id}: ${field} is missing`);
    return { id, env, what: key.get('what')!, without: without as Without, costs: key.get('costs')! };
  });
  const ids = parsed.map((k) => k.id);
  for (const id of ids) if (ids.indexOf(id) !== ids.lastIndexOf(id)) fail(`${id} is named twice`);
  if (parsed.filter((k) => k.without === 'another').length === 1) fail(`${parsed.find((k) => k.without === 'another')!.id} is "without: another", and the arm has no other key to stand in for it`);

  // The owner's part: from its heading to the next heading of the same level.
  const body = whole.slice(front[0].length);
  const at = body.indexOf(`\n${OWNER_HEADING}\n`);
  const owner = at < 0 ? '' : body.slice(at + OWNER_HEADING.length + 2).split(/\n## /)[0]!;
  const steps = owner
    .split(/\n(?=### )/)
    .map((part) => part.trim())
    .filter((part) => part.startsWith('### '))
    .map((part) => ({ ids: ids.filter((id) => part.split('\n')[0]!.includes(id)), text: part }));
  for (const id of ids) {
    const mine = steps.filter((s) => s.ids.includes(id));
    if (mine.length === 0) fail(`${id} has no steps for the owner: a "### " heading under "${OWNER_HEADING}" that names it, and the steps below it`);
    if (mine.length > 1) fail(`${id} is named by ${mine.length} headings of the owner's steps: one`);
    if (!mine[0]!.text.includes(storeLine(id))) fail(`the owner's steps for ${id} do not give the line that stores it: ${storeLine(id)}`);
  }
  return { name, does, check, keys: parsed, file, steps };
}

/** Every arm of the catalogue, by name. */
export function readCatalogue(dir: string): Arm[] {
  if (!existsSync(dir)) throw new ArmError(`there is no catalogue of arms at ${dir}`);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => parseArm(join(dir, file), readFileSync(join(dir, file), 'utf8')));
}

/** Which of the arms' keys the vault holds: by asking it for each, and keeping only whether it answered. */
async function heldBy(store: SecretStore, arms: readonly Arm[]): Promise<Map<string, boolean>> {
  const held = new Map<string, boolean>();
  for (const id of new Set(arms.flatMap((a) => a.keys.map((k) => k.id)))) {
    try {
      held.set(id, (await store.get(id)) !== null);
    } catch (err) {
      throw new ArmError(`the vault could not be read (${id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return held;
}

/** What an arm still needs: each key it stops without, and, when none of its stand-in keys is there, those. */
export function missingOf(arm: Arm, held: ReadonlyMap<string, boolean>): { stops: ArmKey[]; oneOf: ArmKey[] } {
  const others = arm.keys.filter((k) => k.without === 'another');
  return { stops: arm.keys.filter((k) => k.without === 'stops' && !held.get(k.id)), oneOf: others.some((k) => held.get(k.id)) ? [] : others };
}
const ready = (missing: { stops: ArmKey[]; oneOf: ArmKey[] }): boolean => missing.stops.length === 0 && missing.oneOf.length === 0;
const noCheck = (arm: Arm): string | null => (/^none\b/i.test(arm.check) ? arm.check.replace(/^none:?\s*/i, '') : null);
const names = (list: readonly string[]): string => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

/** The arms asked for, every one of them in the catalogue. */
function asked(arms: readonly Arm[], words: readonly string[], dir: string): Arm[] {
  const unknown = words.filter((word) => !arms.some((a) => a.name === word));
  if (unknown.length > 0) throw new ArmError(`no arm named ${unknown.map((w) => `"${w}"`).join(', ')} in the catalogue (${dir}). The arms: ${arms.map((a) => a.name).join(', ') || '(none)'}`);
  return words.map((word) => arms.find((a) => a.name === word)!);
}

export interface ArmDeps {
  /** The owner's vault. */
  store: SecretStore;
  /** Where the catalogue is (SZ_ARMS_DIR), and the addresses the checks call (SZ_ARM_<NAME>_URL). */
  env: NodeJS.ProcessEnv;
}

const USAGE = 'sz-eyes arm list [--json]   |   sz-eyes arm need <name>... [--json]   |   sz-eyes arm check <name> [--json]';

/** `sz-eyes arm <command>`: what to print and the exit code. A refusal is thrown as an ArmError. */
export async function armCommand(command: string | undefined, words: readonly string[], deps: ArmDeps): Promise<{ text: string; code: number }> {
  const json = words.includes('--json');
  const flags = words.filter((word) => word.startsWith('-') && word !== '--json');
  if (flags.length > 0) throw new ArmError(`${flags.join(', ')}: not a flag of sz-eyes arm. ${USAGE}`);
  const given = words.filter((word) => !word.startsWith('-'));
  const dir = armsDir(deps.env);
  if (command === 'list') {
    if (given.length > 0) throw new ArmError(`sz-eyes arm list takes no name. ${USAGE}`);
    const arms = readCatalogue(dir);
    const held = await heldBy(deps.store, arms);
    const rows = arms.map((a) => ({ name: a.name, does: a.does, ready: ready(missingOf(a, held)), keys: a.keys.map((k) => ({ id: k.id, env: k.env, held: held.get(k.id) === true, without: k.without, costs: k.costs })) }));
    if (json) return { text: JSON.stringify({ dir, arms: rows }, null, 2), code: 0 };
    const width = Math.max(0, ...arms.map((a) => a.name.length));
    const lines = rows.map((r) => {
      const keys = r.keys.map((k) => `${k.id} ${k.held ? 'held' : 'missing'}`).join(', ');
      const either = r.keys.filter((k) => k.without === 'another').length > 1 ? ' (one of them is enough)' : '';
      return `  ${r.name.padEnd(width)}  ${(r.ready ? 'ready' : 'needs a key').padEnd(11)}  ${r.does}  [${keys}${either}]`;
    });
    return { text: arms.length === 0 ? `no arm in ${dir}` : `${arms.length} arm${arms.length === 1 ? '' : 's'} (${dir}); a key named is in the vault or not, never shown:\n${lines.join('\n')}`, code: 0 };
  }
  if (command === 'need') {
    if (given.length === 0) throw new ArmError(`which arms: sz-eyes arm need <name>... (the arms a product's plan names). ${USAGE}`);
    const all = readCatalogue(dir);
    const arms = asked(all, [...new Set(given)], dir);
    const held = await heldBy(deps.store, arms);
    const wanting = arms.map((arm) => ({ arm, missing: missingOf(arm, held) })).filter((w) => !ready(w.missing));
    if (json) return { text: JSON.stringify({ ready: wanting.length === 0, arms: wanting.map(({ arm, missing }) => ({ name: arm.name, missing: [...missing.stops, ...missing.oneOf].map((k) => k.id), oneOf: missing.oneOf.length > 0, store: [...missing.stops, ...missing.oneOf].map((k) => storeLine(k.id)), steps: stepsFor(arm, [...missing.stops, ...missing.oneOf]), then: thenOf(arm) })) }, null, 2), code: wanting.length === 0 ? 0 : 1 };
    if (wanting.length === 0) return { text: `every key is in the vault for ${names(arms.map((a) => a.name))}`, code: 0 };
    const blocks = wanting.map(({ arm, missing }) => {
      const keys = [...missing.stops, ...missing.oneOf];
      const why = [
        missing.stops.length > 0 ? `not in the vault: ${missing.stops.map((k) => k.id).join(', ')}` : '',
        missing.oneOf.length > 0 ? `none of these is in the vault, and one is enough (the first is used when more are there): ${missing.oneOf.map((k) => k.id).join(', ')}` : '',
      ].filter(Boolean);
      return [
        `── ${arm.name} · ${why.join('; ')}`,
        ...keys.map((k) => `${k.id}: ${k.what}; the server gets it as ${k.env}. Costs: ${k.costs}.`),
        '',
        ...stepsFor(arm, keys).flatMap((text) => [text, '']),
        `Store ${keys.length === 1 ? 'it' : missing.oneOf.length > 0 && missing.stops.length === 0 ? 'the one that was made' : 'each'}, right after copying it, as one line at the prompt of this session:`,
        ...keys.map((k) => `  ${storeLine(k.id)}`),
        `Then: ${thenOf(arm)}`,
      ].join('\n');
    });
    const list = wanting.map((w) => w.arm.name);
    return {
      text: `${names(list)} ${list.length === 1 ? 'waits' : 'wait'} for ${wanting.length === 1 && [...wanting[0]!.missing.stops, ...wanting[0]!.missing.oneOf].length === 1 ? 'a key' : 'keys'} of the owner's. Put what follows to the owner as it stands, and build nothing that needs ${list.length === 1 ? 'it' : 'them'} until \`sz-eyes arm need ${arms.map((a) => a.name).join(' ')}\` exits 0: a missing key is never worked around with an example.\n\n${blocks.join('\n\n')}`,
      code: 1,
    };
  }
  if (command === 'check') {
    if (given.length !== 1) throw new ArmError(`which arm: sz-eyes arm check <name> (one). ${USAGE}`);
    const [arm] = asked(readCatalogue(dir), given, dir);
    const done = await checkArm(arm!, deps);
    return { text: json ? JSON.stringify({ name: arm!.name, works: done.code === 0, key: done.key, said: done.text, cost: done.cost ?? null }, null, 2) : done.text, code: done.code };
  }
  throw new ArmError(USAGE);
}

/** The owner's steps for these keys, each part of the file once, in the file's order. */
const stepsFor = (arm: Arm, keys: readonly ArmKey[]): string[] => arm.steps.filter((s) => s.ids.some((id) => keys.some((k) => k.id === id))).map((s) => s.text);
const thenOf = (arm: Arm): string => noCheck(arm) ?? `sz-eyes arm check ${arm.name}. It makes ${arm.check.replace(/\.$/, '')}.`;

// ——— check ———

interface Checked {
  text: string;
  code: number;
  key: string | null;
  cost?: string;
}

/** The address a check calls: the service's own, or the one a test gives in SZ_ARM_<NAME>_URL. */
export const armUrlEnv = (name: string): string => `SZ_ARM_${name.toUpperCase().replace(/-/g, '_')}_URL`;
const baseOf = (deps: ArmDeps, name: string, own: string): string => (deps.env[armUrlEnv(name)] || own).replace(/\/+$/, '');

async function secretOf(store: SecretStore, id: string): Promise<string | null> {
  try {
    return (await store.get(id))?.expose() ?? null;
  } catch (err) {
    throw new ArmError(`the vault could not be read (${id}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Text with every form of these keys taken out: as kept, as encoded in an address, and any word holding an end of one. */
export function scrub(text: string, keys: readonly string[]): string {
  const forms = keys.flatMap((key) => [key, encodeURIComponent(key), new URLSearchParams({ k: key }).toString().slice(2)]);
  let shown = hide(text, [...new Set(forms)].map((value) => ({ env: 'the key', value })));
  // A service that echoes a key masked (its first and last characters) still gives some of it away.
  for (const key of keys.filter((k) => k.length >= 16)) {
    const ends = [key.slice(0, 8), key.slice(-4)];
    shown = shown
      .split(/(\s+)/)
      .map((word) => (ends.some((end) => word.includes(end)) ? '[part of the key: hidden]' : word))
      .join('');
  }
  return shown;
}

/** One call to a service, with the network reached as the session's sandbox allows. Never throws. */
async function call(url: string, init: RequestInit): Promise<{ status: number; body: string } | { failed: string }> {
  const target = new URL(url);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname);
  // Inside a session's command sandbox the network is reached only through the proxy its environment names, and
  // fetch does not use one unless told. A service on this machine (a test's) is reached directly.
  const proxyFromEnv = (http as unknown as { setGlobalProxyFromEnv?: () => unknown }).setGlobalProxyFromEnv;
  if (!local && (process.env.HTTPS_PROXY || process.env.https_proxy) && typeof proxyFromEnv === 'function') proxyFromEnv();
  try {
    const res = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    return { status: res.status, body: await res.text() };
  } catch (err) {
    const cause = (err as { cause?: { message?: string } }).cause?.message;
    return { failed: `${target.host} could not be reached: ${cause ?? (err instanceof Error ? err.message : String(err))}` };
  }
}

async function checkArm(arm: Arm, deps: ArmDeps): Promise<Checked> {
  const instead = noCheck(arm);
  if (instead !== null) return { text: `${arm.name} has no check by a call here: ${instead}`, code: 1, key: null };
  const check = CHECKS[arm.name];
  if (!check) return { text: `${arm.name} has no check written in the tool yet (packages/eyes/src/arms.ts): its file says "${arm.check}"`, code: 1, key: null };
  return check(arm, deps);
}

const notInVault = (arm: Arm, ids: readonly string[]): Checked => ({ text: `${arm.name} cannot be checked: not in the vault: ${ids.join(ids.length > 1 ? ' or ' : '')}. \`sz-eyes arm need ${arm.name}\` says how the owner puts ${ids.length > 1 ? 'one' : 'it'} there.`, code: 1, key: null });

const dollars = (amount: number): string => (amount < 0.000001 ? 'less than $0.000001' : `$${Number(amount.toFixed(6))}`);

/**
 * public-data: one call to HIRA's non-covered price service on data.go.kr, the operation that needs nothing but
 * the key (the item codes, one row). Read on the portal's page of the service on 2026-11-17:
 * https://www.data.go.kr/data/15001700/openapi.do (its operations, and its table of the gateway's errors).
 */
const HIRA = '/B551182/nonPaymentDamtInfoService';
const HIRA_PAGE = 'https://www.data.go.kr/data/15001700/openapi.do';
const PORTAL_ERRORS: Record<string, string> = {
  APPLICATION_ERROR: "the portal's own server failed; call again later",
  HTTP_ERROR: "the provider's server failed, or the request was not one it takes",
  SERVICETIMEOUT_ERROR: "the provider's server did not answer in time; call again later",
  INVALID_REQUEST_PARAMETER_ERROR: 'a parameter of the call is wrong',
  NO_OPENAPI_SERVICE_ERROR: 'the API does not exist or was retired',
  SERVICE_KEY_IS_NULL: 'the call carried no key',
  PERMISSION_DENIED: `this API was not applied for with this key, or its application is not approved: apply at ${HIRA_PAGE} (활용신청)`,
  SERVICE_ACCESS_DENIED_ERROR: `this API was not applied for with this key, or its application is not approved or is paused: apply at ${HIRA_PAGE} (활용신청)`,
  LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR: "the day's calls are used up; they start again at midnight",
  LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR: 'too many calls in a second; call again in a moment',
  BLACKLIST_IP_ACCESS_ERROR: 'calls from this address are blocked',
  SERVICE_KEY_IS_NOT_REGISTERED_ERROR: `the key is not one the portal knows for this API: it was copied wrong, or the application for it at ${HIRA_PAGE} (활용신청) is not complete. A key issued less than an hour ago can be refused this way`,
  DEADLINE_HAS_EXPIRED_ERROR: "the key's period of use for this API has ended: extend it on the portal",
  UNREGISTERED_IP_ERROR: 'the key was issued for calls from other addresses',
};
const tag = (xml: string, name: string): string | undefined => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1]?.trim();

async function checkPublicData(arm: Arm, deps: ArmDeps): Promise<Checked> {
  const key = arm.keys[0]!;
  const kept = await secretOf(deps.store, key.id);
  if (kept === null) return notInVault(arm, [key.id]);
  // The portal shows the key in two forms; whichever the vault holds, it is decoded once here and encoded once
  // in the address, as the arm's file tells a product's server to do.
  let value = kept;
  if (kept.includes('%')) {
    try {
      value = decodeURIComponent(kept);
    } catch {
      value = kept;
    }
  }
  const keys = [kept, value];
  const url = `${baseOf(deps, arm.name, 'https://apis.data.go.kr')}${HIRA}/getNonPaymentItemCodeList2?${new URLSearchParams({ ServiceKey: value, pageNo: '1', numOfRows: '1' })}`;
  const got = await call(url, { headers: { accept: 'application/xml, text/xml' } });
  if ('failed' in got) return { text: scrub(`${arm.name} was not checked: ${got.failed}`, keys), code: 1, key: key.id };
  const code = tag(got.body, 'resultCode');
  if (got.status === 200 && code === '00') {
    const total = tag(got.body, 'totalCount');
    const form = kept !== value ? ' The vault holds the key in its encoded form; it was decoded once before the call, as the arm\'s file says.' : '';
    return { text: scrub(`${arm.name} works: the portal took ${key.id} for HIRA's 비급여진료비정보조회서비스 (getNonPaymentItemCodeList2 answered ${code}, ${tag(got.body, 'resultMsg') ?? tag(got.body, 'ResultMsg') ?? ''}${total ? `; ${total} item codes` : ''}). Free: the call is one of the day's calls (10,000 on a development account).${form}`, keys), code: 0, key: key.id, cost: 'free' };
  }
  const auth = tag(got.body, 'returnAuthMsg');
  const reason = tag(got.body, 'returnReasonCode');
  const message = auth ?? tag(got.body, 'errMsg');
  let said: string;
  if (message) said = `the portal answered ${message}${reason ? ` (${reason})` : ''}${auth && tag(got.body, 'errMsg') ? `, ${tag(got.body, 'errMsg')}` : ''}${PORTAL_ERRORS[message] ? `: ${PORTAL_ERRORS[message]}` : ''}`;
  else if (code) said = `the service answered ${code}: ${tag(got.body, 'resultMsg') ?? tag(got.body, 'ResultMsg') ?? '(no message)'}`;
  else said = `the portal answered ${got.status}: ${got.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || '(nothing)'}`;
  return { text: scrub(`${arm.name} does not work with ${key.id}: ${said}`, keys), code: 1, key: key.id };
}

/**
 * read: one text-only call of a few tokens to the first provider whose key the vault holds, on the model the arm's
 * file names. Prices per million tokens, as read on 2026-11-17: Anthropic's on
 * https://platform.claude.com/docs/en/about-claude/pricing (Claude Sonnet 5.5: $2 in, $10 out), OpenAI's on
 * https://developers.openai.com/api/docs/pricing (gpt-6.1-terra: $1 in, $5 out).
 */
const PROVIDERS: Record<string, { name: string; model: string; base: string; price: [number, number]; ask: (base: string, key: string, model: string) => [string, RequestInit] }> = {
  'model/anthropic/api-key': {
    name: 'Anthropic',
    model: 'claude-sonnet-5-5',
    base: 'https://api.anthropic.com',
    price: [2, 10],
    ask: (base, key, model) => [`${base}/v1/messages`, { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21', 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 16, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Reply with the word ok.' }] }) }],
  },
  'model/openai/api-key': {
    name: 'OpenAI',
    model: 'gpt-6.1-terra',
    base: 'https://api.openai.com',
    price: [1, 5],
    ask: (base, key, model) => [`${base}/v1/responses`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, input: 'Reply with the word ok.', max_output_tokens: 16 }) }],
  },
};

async function checkRead(arm: Arm, deps: ArmDeps): Promise<Checked> {
  for (const key of arm.keys) {
    const value = await secretOf(deps.store, key.id);
    if (value === null) continue;
    const provider = PROVIDERS[key.id];
    if (!provider) return { text: `${arm.name}: the tool has no call written for ${key.id}`, code: 1, key: key.id };
    const [url, init] = provider.ask(baseOf(deps, arm.name, provider.base), value, provider.model);
    const got = await call(url, init);
    if ('failed' in got) return { text: scrub(`${arm.name} was not checked: ${got.failed}`, [value]), code: 1, key: key.id };
    let body: { model?: string; usage?: { input_tokens?: number; output_tokens?: number }; error?: { type?: string; message?: string; code?: string } } = {};
    try {
      body = JSON.parse(got.body) as typeof body;
    } catch {
      // Not JSON: said as it came, below.
    }
    if (got.status === 200 && body.usage) {
      const [tokensIn, tokensOut] = [body.usage.input_tokens ?? 0, body.usage.output_tokens ?? 0];
      const cost = dollars((tokensIn * provider.price[0] + tokensOut * provider.price[1]) / 1_000_000);
      return { text: scrub(`${arm.name} works with ${key.id}: ${provider.name}'s ${body.model ?? provider.model} answered (${tokensIn} tokens in, ${tokensOut} out: about ${cost} at $${provider.price[0]} and $${provider.price[1]} a million tokens).`, [value]), code: 0, key: key.id, cost };
    }
    const error = body.error;
    const said = error ? `${got.status} ${error.type ?? ''}${error.code ? ` (${error.code})` : ''}: ${error.message ?? ''}` : `${got.status}: ${got.body.replace(/\s+/g, ' ').trim().slice(0, 300) || '(nothing)'}`;
    const hint = got.status === 401 ? ' The key is wrong or was revoked: make another and store it again.' : got.status === 402 || /credit|quota|billing/i.test(said) ? ' The account has no credit to bill: the owner adds it on the provider\'s billing page.' : '';
    return { text: scrub(`${arm.name} does not work with ${key.id}: ${provider.name} answered ${said.replace(/\s+/g, ' ').trim()}.${hint}`, [value]), code: 1, key: key.id };
  }
  return notInVault(arm, arm.keys.map((k) => k.id));
}

const CHECKS: Record<string, (arm: Arm, deps: ArmDeps) => Promise<Checked>> = { 'public-data': checkPublicData, read: checkRead };

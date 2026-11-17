import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFileLock, writeFileAtomic } from './lock.ts';
import type { SecretStore } from './secrets.ts';

/**
 * Signing in with Kakao and Google on a product built on this machine.
 *
 * The owner keeps one developer app with each provider for everything the harness builds, and its keys in the
 * vault. A provider sends a person back to an address that has to be registered with it exactly, and every
 * product's backend listens on a port of its own, so no product's address can be registered. One address is: the
 * relay's (`sz-eyes login relay`, on a fixed port of this machine). Every product's stack names that address as
 * where the provider sends people back, and the relay passes each returning person on to the backend that sent
 * them out (`login-relay.ts`). Carried over from the old daemon (`packages/daemon/src/arms/logins.ts`), where the
 * owner signed in with both providers on a built product on 2026-11-14.
 *
 * A key's secret half never reaches a file: the stack's configuration names an environment variable, and the
 * value is handed to Supabase's command line when it runs.
 */

export const OAUTH_CALLBACK_PATH = '/oauth/callback';
export const PROVIDERS = ['kakao', 'google'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** A provider's key, as the vault holds it. */
export interface LoginKey {
  clientId: string;
  secret: string;
}
export type LoginKeys = Partial<Record<Provider, LoginKey>>;

/** Where the owner keeps each half of each key (the names the old daemon read, and the guide tells the owner to use). */
export const LOGIN_VAULT_IDS: Record<Provider, { clientId: string; secret: string }> = {
  kakao: { clientId: 'login/kakao/client-id', secret: 'login/kakao/client-secret' },
  google: { clientId: 'login/google/client-id', secret: 'login/google/client-secret' },
};

/**
 * Where a session may have put the same keys in the environment, by `sz-eyes secret run KAKAO_CLIENT_ID=login/kakao/client-id
 * ... -- sz-eyes supabase start` (the form sessions used before this). Read only for a key the vault did not give.
 */
const ENV_NAMES: Record<Provider, { clientId: string[]; secret: string[] }> = {
  kakao: { clientId: ['KAKAO_CLIENT_ID', 'SUPABASE_AUTH_EXTERNAL_KAKAO_CLIENT_ID'], secret: ['SZ_LOGIN_KAKAO_SECRET', 'KAKAO_CLIENT_SECRET', 'SUPABASE_AUTH_EXTERNAL_KAKAO_SECRET'] },
  google: { clientId: ['GOOGLE_CLIENT_ID', 'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID'], secret: ['SZ_LOGIN_GOOGLE_SECRET', 'GOOGLE_CLIENT_SECRET', 'SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET'] },
};

/** The variable a provider's secret travels in. */
export const secretEnv = (provider: Provider): string => `SZ_LOGIN_${provider.toUpperCase()}_SECRET`;

const OPEN = '# >>> Studio Zero logins. Rewritten by the studio: do not edit between these lines.';
const CLOSE = '# <<< Studio Zero logins';
/** A client id goes into a TOML string. One that could end the string is not a client id. */
const CLIENT_ID = /^[A-Za-z0-9._-]{4,200}$/;
/** What the block says of a provider itself; anything else a product said of it is carried into the block. */
const OURS = new Set(['enabled', 'client_id', 'secret', 'redirect_uri']);

/**
 * Where a person may land after signing in: the product's own addresses on this machine, whatever port it is
 * served on (`sz-eyes port` gives a new one each run, so no list of ports would stay true). Both spellings of the
 * host, and the bare origin as well as any path under it, since a product passes `window.location.origin`.
 */
export const LOCAL_LANDINGS = ['http://localhost:*', 'http://localhost:*/**', 'http://127.0.0.1:*', 'http://127.0.0.1:*/**'] as const;

/** The providers that can be switched on: those whose key is whole and whose id is one a configuration file can hold. */
export const usable = (keys: LoginKeys): Provider[] => PROVIDERS.filter((provider) => keys[provider] !== undefined && CLIENT_ID.test(keys[provider]!.clientId) && keys[provider]!.secret !== '');

/** True when a configuration holds the relay's block. */
export const hasLoginBlock = (toml: string): boolean => toml.includes(OPEN);

/** A table of a TOML file: from its header line to the line before the next header. */
function tableAt(toml: string, name: string): { from: number; to: number; body: string[] } | null {
  const header = new RegExp(`^\\[${name.replace(/\./g, '\\.')}\\][ \\t]*(#.*)?$`, 'm').exec(toml);
  if (!header) return null;
  const start = header.index + header[0].length;
  const next = /^[ \t]*\[/m.exec(toml.slice(start));
  const to = next ? start + next.index : toml.length;
  return { from: header.index, to, body: toml.slice(start, to).split('\n') };
}

/** The lines a product wrote in a provider's table besides what the block itself sets, by key. */
function extrasOf(body: readonly string[]): Map<string, string> {
  const kept = new Map<string, string>();
  for (const line of body) {
    const key = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line)?.[1];
    if (key && !OURS.has(key)) kept.set(key, line.trim());
  }
  return kept;
}

/** The strings of `additional_redirect_urls`, written on one line or several. */
const REDIRECTS = /^additional_redirect_urls[ \t]*=[ \t]*\[((?:\s*"(?:[^"\\\n]|\\.)*"\s*,?)*\s*)\]/m;

/**
 * A stack's configuration with the relay's logins in it: each usable provider switched on with the one address it
 * sends people back to, and the product's own addresses allowed as where a person lands afterwards. Everything
 * else in the file is left as the product had it. A table the product wrote itself for a provider that is switched
 * on here is taken into the block (a table named twice is a file the command line cannot read), with whatever
 * else it said of that provider. With no usable provider the block is taken out.
 */
export function withLogins(toml: string, keys: LoginKeys, callback: string, landings: readonly string[]): string {
  const from = toml.indexOf(OPEN);
  const to = toml.indexOf(CLOSE, from === -1 ? 0 : from);
  const inBlock = from !== -1 && to !== -1 ? toml.slice(from, to) : '';
  let base = (from !== -1 && to !== -1 ? `${toml.slice(0, from).trimEnd()}\n${toml.slice(to + CLOSE.length)}` : toml).trimEnd();
  const on = usable(keys);
  if (on.length === 0) return `${base}\n`;

  const blocks = on.map((provider) => {
    const name = `auth.external.${provider}`;
    const extras = new Map(tableAt(inBlock, name) ? extrasOf(tableAt(inBlock, name)!.body) : []);
    const own = tableAt(base, name);
    if (own) {
      for (const [key, line] of extrasOf(own.body)) extras.set(key, line);
      base = `${base.slice(0, own.from).trimEnd()}\n\n${base.slice(own.to).trimStart()}`.trimEnd();
    }
    return [`[${name}]`, 'enabled = true', `client_id = ${JSON.stringify(keys[provider]!.clientId)}`, `secret = "env(${secretEnv(provider)})"`, `redirect_uri = ${JSON.stringify(callback)}`, ...extras.values()].join('\n');
  });

  // The one line of the product's own that has to change: where a person may be sent after signing in.
  const found = REDIRECTS.exec(base);
  if (found) {
    const had = [...found[1]!.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
    const all = [...had, ...landings.filter((url) => !had.includes(url))];
    base = `${base.slice(0, found.index)}additional_redirect_urls = [${all.map((url) => JSON.stringify(url)).join(', ')}]${base.slice(found.index + found[0].length)}`;
  } else if (!/^additional_redirect_urls[ \t]*=/m.test(base) && /^\[auth\][ \t]*$/m.test(base)) {
    // Only where the product names none: a list written in a shape not read here is left as it is, not named twice.
    base = base.replace(/^\[auth\][ \t]*$/m, `[auth]\nadditional_redirect_urls = [${landings.map((url) => JSON.stringify(url)).join(', ')}]`);
  }
  return `${base}\n\n${[OPEN, ...blocks, CLOSE].join('\n\n')}\n`;
}

/** What the command line is run with so that the configuration's `env(...)` can be filled. */
export function loginEnv(keys: LoginKeys): Record<string, string> {
  return Object.fromEntries(usable(keys).map((provider) => [secretEnv(provider), keys[provider]!.secret]));
}

/**
 * The owner's keys: read from the vault itself, so that nobody has to spell four names. A key the vault does not
 * give is looked for in the environment a session handed down (`sz-eyes secret run ... -- sz-eyes supabase
 * start`), which is how it reaches a command where the vault cannot be read. `missing` names, by their vault ids,
 * the halves found in neither.
 */
export async function loginKeysOf(store: SecretStore | null, env: NodeJS.ProcessEnv): Promise<{ keys: LoginKeys; missing: string[]; vaultError: string | null }> {
  let vaultError: string | null = null;
  const read = async (id: string, names: readonly string[]): Promise<string | null> => {
    if (store) {
      try {
        const found = await store.get(id);
        const value = found?.expose().trim();
        if (value) return value;
      } catch (err) {
        vaultError ??= err instanceof Error ? err.message : String(err);
      }
    }
    for (const name of names) if (env[name]?.trim()) return env[name]!.trim();
    return null;
  };
  const keys: LoginKeys = {};
  const missing: string[] = [];
  for (const provider of PROVIDERS) {
    const ids = LOGIN_VAULT_IDS[provider];
    const clientId = await read(ids.clientId, ENV_NAMES[provider].clientId);
    const secret = await read(ids.secret, ENV_NAMES[provider].secret);
    if (clientId === null) missing.push(ids.clientId);
    if (secret === null) missing.push(ids.secret);
    if (clientId !== null && secret !== null) keys[provider] = { clientId, secret };
  }
  return { keys, missing, vaultError };
}

/**
 * Which backend a returning person belongs to is in what they carry back: `state`. The auth service makes it when
 * it sends a person out, either as the id of the sign-in it started or as a signed token that holds that id. Only
 * the id is read here, to look it up; whether the token is genuine is the auth service's to decide when the
 * person arrives.
 */
export function flowIdOf(state: string): string | null {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (UUID.test(state)) return state;
  const payload = state.split('.')[1];
  if (payload === undefined || state.length > 4096) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const id = claims !== null && typeof claims === 'object' ? (claims as Record<string, unknown>).flow_state_id : undefined;
    return typeof id === 'string' && UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ the relay's address and its folder

/** 49200 is the old daemon's, which still runs on the owner's machine. */
export const DEFAULT_RELAY_PORT = 49210;

export function relayPort(env: NodeJS.ProcessEnv = process.env): number {
  const given = env.SZ_LOGIN_RELAY_PORT?.trim();
  const port = given ? Number(given) : DEFAULT_RELAY_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`SZ_LOGIN_RELAY_PORT=${given} is not a port`);
  return port;
}

/**
 * The one address registered with each provider. `localhost`, as the old daemon spelled it: a provider compares
 * the address letter for letter, and Kakao and Google both take a `localhost` address over plain http.
 */
export const relayCallback = (port: number): string => `http://localhost:${port}${OAUTH_CALLBACK_PATH}`;

/** `$SZ_LOGINS_DIR`, or `~/.studio-zero/logins`: the registry of backends, the relay's pid file and its log. */
export function loginsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SZ_LOGINS_DIR ? resolve(env.SZ_LOGINS_DIR) : join(homedir(), '.studio-zero', 'logins');
}

// ------------------------------------------------------------------ the registry of backends

/** A product's backend the relay may pass people to. */
export interface Backend {
  /** The product's folder, where its `supabase/config.toml` is. */
  project: string;
  /** Where its API answers on this machine, e.g. `http://127.0.0.1:21459`. */
  api: string;
  /** When it was registered. */
  added: string;
}

export const BACKENDS_FILE = 'backends.json';
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/;

/** The backends registered, as the file holds them; anything it holds that is not one is passed over. */
export function readBackends(dir: string): Backend[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dir, BACKENDS_FILE), 'utf8'));
  } catch {
    return [];
  }
  const list = parsed && typeof parsed === 'object' && Array.isArray((parsed as { backends?: unknown }).backends) ? (parsed as { backends: unknown[] }).backends : [];
  return list.filter((entry): entry is Backend => {
    const e = entry as Partial<Backend> | null;
    return !!e && typeof e.project === 'string' && typeof e.api === 'string' && LOOPBACK.test(e.api) && typeof e.added === 'string';
  });
}

/** Changes the registry inside its lock, and writes it whole. */
function changeBackends(dir: string, change: (now: Backend[]) => Backend[]): Backend[] {
  const file = join(dir, BACKENDS_FILE);
  return withFileLock(file, () => {
    const next = change(readBackends(dir));
    writeFileAtomic(file, `${JSON.stringify({ backends: next }, null, 2)}\n`);
    return next;
  });
}

/**
 * Registers a product's backend. The target of a person passed on is always a backend on this machine: an address
 * that is not this machine's is refused. A product keeps one entry, at its address now; an entry of another folder
 * at the same address is dropped (the port was given to this one after that one stopped).
 */
export function registerBackend(dir: string, entry: { project: string; api: string }, now: Date): Backend {
  const api = entry.api.replace(/\/+$/, '');
  if (!LOOPBACK.test(api)) throw new Error(`${entry.api} is not an address on this machine: only a backend on this machine is passed a person`);
  const backend: Backend = { project: resolve(entry.project), api, added: now.toISOString() };
  changeBackends(dir, (list) => [...list.filter((b) => b.project !== backend.project && b.api !== backend.api), backend]);
  return backend;
}

/** Takes these entries out (each as it was read: an entry registered again since is kept). */
export function dropBackends(dir: string, gone: readonly Backend[]): void {
  if (gone.length === 0) return;
  changeBackends(dir, (list) => list.filter((b) => !gone.some((g) => g.project === b.project && g.api === b.api && g.added === b.added)));
}

/**
 * The names the Supabase command line gives a stack's containers (`supabase-<name>-<service>-<id>`): the
 * project_id of its configuration, as the command line cleans it, and the folder's own name where that differs.
 */
export function stackNames(project: string): string[] {
  const clean = (name: string): string => name.replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 40);
  let id: string | undefined;
  try {
    id = /^project_id\s*=\s*"([^"]*)"/m.exec(readFileSync(join(project, 'supabase', 'config.toml'), 'utf8'))?.[1];
  } catch {
    // No configuration to read: the folder's name is what `supabase init` would have given it.
  }
  return [...new Set([id, basename(project)].filter((name): name is string => !!name && name.trim() !== '').map(clean))];
}

/**
 * The address of a stack's API on this machine, from what `supabase start` or `supabase status` printed: its JSON
 * (`{ env: { API_URL } }` or `{ API_URL }`, among the notices the command line prints around it) or its table
 * (`API URL: http://...`). Null when none is there, or when the address is not this machine's.
 */
export function apiUrlOf(text: string): string | null {
  const local = (url: unknown): string | null => (typeof url === 'string' && LOOPBACK.test(url.replace(/\/+$/, '')) ? url.replace(/\/+$/, '') : null);
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from !== -1 && to > from) {
    try {
      const parsed = JSON.parse(text.slice(from, to + 1)) as { API_URL?: unknown; env?: { API_URL?: unknown } };
      const url = parsed.env?.API_URL ?? parsed.API_URL;
      if (url !== undefined) return local(url);
    } catch {
      // Not JSON: perhaps the table.
    }
  }
  return local(/API[ _]URL\s*[:=│|]\s*(\S+)/.exec(text)?.[1]);
}

/** The relay's guide for the owner, beside this checkout. */
export const GUIDE = fileURLToPath(new URL('../../../docs/guides/studio-zero/shared-login-apps.html', import.meta.url));
export const guidePath = (): string => (existsSync(GUIDE) ? GUIDE : 'docs/guides/studio-zero/shared-login-apps.html');

/**
 * Signing in with Kakao and Google on a prototype.
 *
 * The owner keeps one developer app with each provider for everything the studio builds, and its keys in the
 * vault. A provider sends a person back to an address that has to be registered with it exactly, and every
 * project's backend listens on a port of its own, so no project's address can be registered. One address is:
 * the daemon's. Every project's backend names that address as where the provider should send people back, and
 * the daemon passes each returning person on to the backend that sent them out (`ProjectArms.relay`).
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

/** The variable a provider's secret travels in. */
export const secretEnv = (provider: Provider): string => `SZ_LOGIN_${provider.toUpperCase()}_SECRET`;

const OPEN = '# >>> Studio Zero logins. Rewritten by the studio: do not edit between these lines.';
const CLOSE = '# <<< Studio Zero logins';
/** A client id goes into a TOML string. One that could end the string is not a client id. */
const CLIENT_ID = /^[A-Za-z0-9._-]{4,200}$/;

/** The providers that can be switched on: those whose key is whole and whose id is one a configuration file can hold. */
export const usable = (keys: LoginKeys): Provider[] => PROVIDERS.filter((provider) => keys[provider] !== undefined && CLIENT_ID.test(keys[provider]!.clientId) && keys[provider]!.secret !== '');

/**
 * A stack's configuration with the studio's logins in it: each usable provider switched on with the one
 * address it sends people back to, and the product's own addresses allowed as where a person lands afterwards.
 * Everything else in the file is left as the command line wrote it.
 */
export function withLogins(toml: string, keys: LoginKeys, callback: string, landings: readonly string[]): string {
  const from = toml.indexOf(OPEN);
  const to = toml.indexOf(CLOSE, from === -1 ? 0 : from);
  const base = (from !== -1 && to !== -1 ? `${toml.slice(0, from)}${toml.slice(to + CLOSE.length)}` : toml).trimEnd();
  const allowed = `additional_redirect_urls = [${landings.map((url) => JSON.stringify(url)).join(', ')}]`;
  // The one line of the command line's own that has to change: where a person may be sent after signing in.
  const withLandings = /^additional_redirect_urls\s*=.*$/m.test(base) ? base.replace(/^additional_redirect_urls\s*=.*$/m, allowed) : base;
  const blocks = usable(keys).map((provider) => [`[auth.external.${provider}]`, 'enabled = true', `client_id = ${JSON.stringify(keys[provider]!.clientId)}`, `secret = "env(${secretEnv(provider)})"`, `redirect_uri = ${JSON.stringify(callback)}`].join('\n'));
  return `${withLandings}\n\n${[OPEN, ...blocks, CLOSE].join('\n\n')}\n`;
}

/** What the command line is run with so that the configuration's `env(...)` can be filled. */
export function loginEnv(keys: LoginKeys): Record<string, string> {
  return Object.fromEntries(usable(keys).map((provider) => [secretEnv(provider), keys[provider]!.secret]));
}

/**
 * Which backend a returning person belongs to is in what they carry back: `state`. The auth service makes it
 * when it sends a person out, either as the id of the sign-in it started or as a signed token that holds that
 * id. Only the id is read here, to look it up; whether the token is genuine is the auth service's to decide
 * when the person arrives.
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

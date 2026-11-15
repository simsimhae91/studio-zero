import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Browser } from 'playwright-core';
import { closeBrowser, openBrowser, quiet } from './web.ts';

/**
 * What a browser downloads is public: anyone can read every byte of it. A key that passes every guard (a
 * database's admin key, a payment provider's secret key) inside a script is the same as no guard at all, and it
 * is the commonest way a product made by an agent gives away what people stored in it. This looks, in what is
 * actually served or in a built folder, for the values that must stay on the server and for the shapes such keys
 * have, and says where. A value it finds is never printed.
 */

/** A value that must stay on the server. Known to a reader by its name only. */
export interface Secret {
  name: string;
  value: string;
}

/** One thing a browser was given, or one built file. */
export interface Download {
  url: string;
  body: string;
}

export interface Leak {
  /** The name of the variable whose value was found, or of the shape. */
  what: string;
  kind: 'value' | 'shape' | 'file';
  where: string;
  /** What stands before it and its first characters, so that it can be found; never the whole of it. */
  around: string;
}

/** Names a build tool puts into the browser on purpose: their values are public by design. */
const PUBLIC_NAME = /^(NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|PUBLIC_|NUXT_PUBLIC_|REACT_APP_|GATSBY_)|(^|_)(PUBLISHABLE|ANON)(_|$)/;
/** Names that say the value opens something. */
const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|SERVICE_ROLE|ADMIN|API_KEY|ACCESS_KEY|SIGNING|_KEY$|^KEY$|_PW$|DSN$|DATABASE_URL|DB_URL|POSTGRES_URL|REDIS_URL)/i;
/** Shorter than this, a value is found by chance in any script. */
const SHORTEST = 8;

/**
 * The secrets a dotenv file holds: every variable whose name says it opens something, or whose value is an
 * address with a password in it, unless its name says the build puts it in the browser on purpose. `tooShort`
 * names the ones that cannot be looked for because the value is too short to tell from ordinary text.
 */
export function secretsFromEnv(text: string): { secrets: Secret[]; tooShort: string[] } {
  const secrets: Secret[] = [];
  const tooShort: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^export\s+/, '');
    const eq = line.indexOf('=');
    if (line.startsWith('#') || eq < 1) continue;
    const name = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted = /^(["'])(.*)\1$/.exec(value);
    value = quoted ? quoted[2]! : value.replace(/\s+#.*$/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || value === '' || PUBLIC_NAME.test(name)) continue;
    const opens = SECRET_NAME.test(name) || /^[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i.test(value);
    if (!opens) continue;
    if (value.length < SHORTEST) tooShort.push(name);
    else secrets.push({ name, value });
  }
  return { secrets, tooShort };
}

const jwtRole = (token: string): string | null => {
  try {
    const payload: unknown = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' && 'role' in payload && typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
};

/** Shapes of keys that open something whoever holds them: found whatever the variable was called. */
const SHAPES: { what: string; pattern: RegExp; only?: (match: string) => boolean }[] = [
  { what: 'a Supabase key with the service role (it passes every row guard)', pattern: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, only: (token) => ['service_role', 'supabase_admin'].includes(jwtRole(token) ?? '') },
  { what: 'a Supabase secret key', pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}/g },
  { what: 'a Toss Payments secret key', pattern: /\b(?:live|test)_g?sk_[A-Za-z0-9]{16,}/g },
  { what: 'a Stripe secret key', pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { what: 'a private key', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g },
  { what: 'a database address with its password', pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?):\/\/[^\s"'`:@/]+:[^\s"'`@/]{3,}@[^\s"'`]+/g, only: (address) => !/:\/\/[^:]+:(?:password|\*+|<[^>]+>|\$\{[^}]+\}|xxx+)@/i.test(address) },
  { what: 'an Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { what: 'an OpenAI API key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{20}[A-Za-z0-9_-]{12,}/g },
  { what: 'a GitHub token', pattern: /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}/g },
  { what: 'an AWS access key id', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { what: 'a Google service account file', pattern: /"type"\s*:\s*"service_account"/g },
  { what: 'a Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{16,}/g },
];

const around = (body: string, at: number, length: number): string => {
  const before = body.slice(Math.max(0, at - 24), at).replace(/\s+/g, ' ');
  return `${before}${body.slice(at, at + Math.min(4, length))}…`;
};

/** Every place a secret's value, or the shape of a key, stands in what was downloaded. One line per secret and file. */
export function findLeaks(files: readonly Download[], secrets: readonly Secret[]): Leak[] {
  const leaks: Leak[] = [];
  for (const file of files) {
    for (const secret of secrets) {
      const at = file.body.indexOf(secret.value);
      if (at >= 0) leaks.push({ what: secret.name, kind: 'value', where: file.url, around: around(file.body, at, secret.value.length) });
    }
    for (const shape of SHAPES) {
      for (const match of file.body.matchAll(shape.pattern)) {
        if (shape.only && !shape.only(match[0])) continue;
        // A value already reported by its name is not reported again by its shape.
        if (secrets.some((secret) => secret.value.includes(match[0]) || match[0].includes(secret.value))) continue;
        leaks.push({ what: shape.what, kind: 'shape', where: file.url, around: around(file.body, match.index, match[0].length) });
        break;
      }
    }
  }
  return leaks;
}

/** Files that are sometimes served by mistake, each with what the real thing looks like (a page sent for every address is not it). */
const STRAYS: { path: string; what: string; looksReal: (body: string) => boolean }[] = [
  { path: '/.env', what: 'the environment file is served', looksReal: (body) => /^[A-Za-z_][A-Za-z0-9_]*=/m.test(body) && !/<html/i.test(body) },
  { path: '/.env.local', what: 'the local environment file is served', looksReal: (body) => /^[A-Za-z_][A-Za-z0-9_]*=/m.test(body) && !/<html/i.test(body) },
  { path: '/.env.production', what: 'the production environment file is served', looksReal: (body) => /^[A-Za-z_][A-Za-z0-9_]*=/m.test(body) && !/<html/i.test(body) },
  { path: '/.git/config', what: 'the repository is served (its whole history can be fetched)', looksReal: (body) => /^\[core\]/m.test(body) },
];

const TEXTUAL = /(text\/|javascript|json|xml|svg|x-www-form-urlencoded)/i;
const BIGGEST = 12 * 1024 * 1024;

export interface Served {
  files: Download[];
  /** Served by mistake: each is a leak whatever is in it. */
  strays: Leak[];
  /** Source maps that are public: not a leak by themselves, and the owner should know. */
  maps: string[];
}

/**
 * Everything a browser is given when a person opens these addresses of a service: the pages, every script and
 * style and answer of an API, and the source maps the scripts point at. A fresh browser of the eyes' own.
 */
export async function downloadsOf(origin: string, paths: readonly string[] = ['/'], opts: { browser?: Browser; settleMs?: number } = {}): Promise<Served> {
  const base = new URL(origin);
  const browser = opts.browser ?? (await openBrowser());
  const files = new Map<string, string>();
  const pending: Promise<void>[] = [];
  try {
    const context = await browser.newContext();
    context.on('response', (response) => {
      const type = response.headers()['content-type'] ?? '';
      if (!TEXTUAL.test(type) || files.has(response.url())) return;
      pending.push(
        response
          .body()
          .then((body) => {
            if (body.length <= BIGGEST) files.set(response.url(), body.toString('utf8'));
          })
          .catch(() => undefined),
      );
    });
    const page = await context.newPage();
    for (const path of paths.length > 0 ? paths : ['/']) {
      await page.goto(new URL(path, base).href, { waitUntil: 'load', timeout: 30_000 }).catch(() => undefined);
      await quiet(page);
      await page.waitForTimeout(opts.settleMs ?? 400);
    }
    await Promise.all(pending);
    await context.close();
  } finally {
    if (!opts.browser) await closeBrowser(browser);
  }
  const get = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
      return res.ok ? (await res.text()).slice(0, BIGGEST) : null;
    } catch {
      return null;
    }
  };
  const maps: string[] = [];
  for (const [url, body] of [...files]) {
    const named = /\/[/*]# sourceMappingURL=(\S+?)(?:\s*\*\/)?\s*$/m.exec(body.slice(-600));
    if (!named || named[1]!.startsWith('data:')) continue;
    const mapUrl = new URL(named[1]!, url).href;
    if (files.has(mapUrl)) continue;
    const map = await get(mapUrl);
    if (map && /"mappings"\s*:/.test(map)) {
      files.set(mapUrl, map);
      maps.push(mapUrl);
    }
  }
  const strays: Leak[] = [];
  for (const stray of STRAYS) {
    const url = new URL(stray.path, base).href;
    const body = await get(url);
    if (body !== null && stray.looksReal(body)) {
      strays.push({ what: stray.what, kind: 'file', where: url, around: '' });
      files.set(url, body);
    }
  }
  return { files: [...files].map(([url, body]) => ({ url, body })), strays, maps };
}

const SKIPPED_DIRS = new Set(['node_modules', '.git']);

/** Every text file of a built folder, as what would be served from it. */
export function filesOf(dir: string): Download[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder`);
  const found: Download[] = [];
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(path);
      } else if (entry.isFile() && statSync(path).size <= BIGGEST) {
        const bytes = readFileSync(path);
        // A file with a zero byte near its start is a picture or a font, not text.
        if (!bytes.subarray(0, 4096).includes(0)) found.push({ url: relative(dir, path), body: bytes.toString('utf8') });
      }
    }
  };
  walk(dir);
  return found;
}

export interface LeakReport {
  /** How many files were read and how big they were together. */
  read: number;
  bytes: number;
  /** The names of the secrets that were looked for, never their values. */
  lookedFor: string[];
  tooShort: string[];
  leaks: Leak[];
  maps: string[];
}

export function renderLeaks(report: LeakReport, where: string): string {
  const size = report.bytes > 1024 * 1024 ? `${(report.bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(report.bytes / 1024))} KB`;
  const lines = [
    `${where}: ${report.read} file(s) a browser is given were read (${size})`,
    `looked for: ${report.lookedFor.length > 0 ? `the values of ${report.lookedFor.join(', ')}; and ` : ''}the shapes of keys that open something (database admin keys, payment secret keys, private keys, tokens)`,
  ];
  if (report.lookedFor.length === 0) lines.push('no secret was named: give the file that holds the server\'s secrets (--env <file>) so that their exact values are looked for too');
  if (report.tooShort.length > 0) lines.push(`not looked for, too short to tell from ordinary text (under ${SHORTEST} characters): ${report.tooShort.join(', ')}`);
  if (report.maps.length > 0) lines.push(`source maps are public (${report.maps.length}): the code as it was written can be read by anyone. First: ${report.maps[0]}`);
  if (report.leaks.length === 0) lines.push('nothing secret in them');
  else lines.push(`${report.leaks.length} LEAK(S): anyone who opens the service can read these`, ...report.leaks.map((leak) => `  - ${leak.what}\n      in ${leak.where}${leak.around ? `\n      at: ${leak.around}` : ''}`));
  return lines.join('\n');
}

/** Reads the secrets from the given dotenv files and looks for them, and for the shapes of keys, in the files. */
export function leakReport(files: readonly Download[], envFiles: readonly string[], extra: { strays?: Leak[]; maps?: string[]; named?: Secret[] } = {}): LeakReport {
  const secrets: Secret[] = [...(extra.named ?? [])];
  const tooShort: string[] = [];
  for (const file of envFiles) {
    if (!existsSync(file)) throw new Error(`${file}: no such file`);
    const read = secretsFromEnv(readFileSync(file, 'utf8'));
    secrets.push(...read.secrets);
    tooShort.push(...read.tooShort);
  }
  const unique = [...new Map(secrets.map((secret) => [secret.value, secret])).values()];
  return {
    read: files.length,
    bytes: files.reduce((sum, file) => sum + Buffer.byteLength(file.body), 0),
    lookedFor: unique.map((secret) => secret.name),
    tooShort,
    leaks: [...(extra.strays ?? []), ...findLeaks(files, unique)],
    maps: extra.maps ?? [],
  };
}

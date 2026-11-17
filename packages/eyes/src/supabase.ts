import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { engineEnv } from './engine.ts';
import { writeFileAtomic } from './lock.ts';
import { LOCAL_LANDINGS, PROVIDERS, apiUrlOf, guidePath, hasLoginBlock, loginEnv, loginKeysOf, loginsDir, registerBackend, relayCallback, usable, withLogins, type Provider } from './login.ts';
import { RelayError, ensureRelay, findDatabase } from './login-relay.ts';
import type { SecretStore } from './secrets.ts';

/**
 * `sz-eyes supabase <args>`: the Supabase command line, on the stack that runs on this machine for this product.
 *
 * `start` also wires the stack to the login relay when the owner's keys for Kakao or Google are in the vault: the
 * stack's configuration switches each provider on with the relay's address as where the provider sends people
 * back, the product's own addresses are allowed as where they land afterwards, the secrets are handed to the
 * command line by environment variable (the configuration names them, never holds them), the backend is
 * registered with the relay, and the relay is started if it is not up. Every other call on a stack wired so is
 * handed the secrets too, since the configuration names them.
 */

export interface SupabaseDeps {
  /** The command line. */
  tool: string;
  /** The caller's environment. */
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** The owner's vault. */
  store: SecretStore | null;
  out: (text: string) => void;
  err: (text: string) => void;
  now?: () => Date;
}

/** Flags of the command line that take a value, so that the value is not read as the command. */
const VALUE_FLAGS = new Set(['--workdir', '-o', '--output', '--output-format', '--profile', '--network-id', '--dns-resolver', '-x', '--exclude', '--runtime']);

/** The command asked (`start`, `stop`, ...) and the product's folder (`--workdir`, or where it is run). */
function readArgs(args: readonly string[], cwd: string): { verb: string | null; folder: string } {
  let verb: string | null = null;
  let workdir: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--workdir') workdir = args[++i] ?? null;
    else if (arg.startsWith('--workdir=')) workdir = arg.slice('--workdir='.length);
    else if (arg.startsWith('-')) {
      if (VALUE_FLAGS.has(arg)) i++;
    } else verb ??= arg;
  }
  return { verb, folder: resolve(cwd, workdir ?? '.') };
}

const names = (providers: readonly string[]): string => (providers.length <= 1 ? providers.join('') : `${providers.slice(0, -1).join(', ')} and ${providers.at(-1)}`);
const TITLE: Record<Provider, string> = { kakao: 'Kakao', google: 'Google' };

export async function supabaseCommand(args: string[], deps: SupabaseDeps): Promise<number> {
  const { verb, folder } = readArgs(args, deps.cwd);
  const config = join(folder, 'supabase', 'config.toml');
  const held = existsSync(config) ? readFileSync(config, 'utf8') : null;
  const call = (argv: readonly string[], secrets: Record<string, string>, opts: { capture: 'none' | 'out' | 'all'; cwd?: string }) =>
    spawnSync(deps.tool, argv, {
      cwd: opts.cwd ?? deps.cwd,
      env: { ...engineEnv(deps.env), ...secrets },
      // The studio's own calls around a start (stop, status) are never left waiting on a question.
      stdio: opts.capture === 'none' ? 'inherit' : opts.capture === 'all' ? ['ignore', 'pipe', 'pipe'] : ['inherit', 'pipe', 'inherit'],
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

  const help = args.includes('--help') || args.includes('-h');
  if (verb !== 'start' || held === null || help) {
    // A stack wired to the relay names its secrets in its configuration: every call on it is handed them.
    const secrets = held !== null && hasLoginBlock(held) ? loginEnv((await loginKeysOf(deps.store, deps.env)).keys) : {};
    return call(args, secrets, { capture: 'none' }).status ?? 1;
  }

  const { keys, missing, vaultError } = await loginKeysOf(deps.store, deps.env);
  const on = usable(keys);
  const guide = guidePath();
  const said: string[] = [];
  let wired: { callback: string } | null = null;
  if (on.length === 0) {
    said.push(`sign-in: email only. Not in the vault: ${missing.join(', ')}.${vaultError ? ` (The vault could not be read: ${vaultError}.)` : ''} The owner puts each there once (pbpaste | sz-eyes secret set <id>), and the stack is started again. The guide: ${guide}`);
    // A key taken out of the vault takes its provider out: a block written before is taken out, and the stack
    // that read it is taken down so that it starts with email only.
    if (hasLoginBlock(held)) {
      writeFileAtomic(config, withLogins(held, {}, '', []));
      call(['stop'], {}, { capture: 'all', cwd: folder });
    }
  } else {
    try {
      const relay = await ensureRelay(deps.env);
      const callback = relayCallback(relay.port);
      const wanted = withLogins(held, keys, callback, LOCAL_LANDINGS);
      if (wanted !== held) {
        writeFileAtomic(config, wanted);
        // A stack that is up read its configuration when it started. It is taken down so that the start reads this one.
        call(['stop'], loginEnv(keys), { capture: 'all', cwd: folder });
      }
      wired = { callback };
    } catch (err) {
      if (!(err instanceof RelayError)) throw err;
      said.push(`sign-in: ${names(on)} could not be wired to the relay: ${err.message}`);
    }
  }

  // Whatever the configuration names now, the command line is handed.
  const started = call(args, hasLoginBlock(readFileSync(config, 'utf8')) ? loginEnv(keys) : {}, { capture: 'out' });
  const code = started.status ?? 1;
  if (wired) {
    const off = PROVIDERS.filter((provider) => !on.includes(provider));
    said.unshift(`sign-in: ${names(on)} ${on.length === 1 ? 'goes' : 'go'} through the relay. Register ${wired.callback} once with ${on.length === 1 ? TITLE[on[0]!] : 'each provider'} (once for every product, not per product).${off.length > 0 ? ` ${names(off)} ${off.length === 1 ? 'is' : 'are'} off: not in the vault: ${missing.join(', ')}.` : ''} The guide: ${guide}`);
    if (code === 0) {
      const api = apiUrlOf(started.stdout ?? '') ?? apiUrlOf(call(['status', '--output-format', 'json'], loginEnv(keys), { capture: 'all', cwd: folder }).stdout ?? '');
      if (api === null) said.push('sign-in: the stack started, but its address on this machine could not be read from what the command line printed, so it is not registered with the relay and a person who signs in is not passed back to it. Start it again with --output-format json');
      else {
        registerBackend(loginsDir(deps.env), { project: folder, api }, deps.now?.() ?? new Date());
        const db = await findDatabase(folder, deps.env);
        if (!db.container) said.push(`sign-in: the relay could not find this stack's database (${db.problem}), and that is where it looks up whose sign-in a returning person is. A person who signs in will be told the sign-in was not started here`);
      }
    }
  }
  for (const line of said) deps.err(`${line}\n`);
  // The command line's own answer is printed last, as it was: sessions read it with `tail -1`.
  if (started.stdout) deps.out(started.stdout);
  return code;
}

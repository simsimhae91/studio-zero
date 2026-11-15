import { spawn } from 'node:child_process';
import { Secret } from '@studio-zero/daemon/src/util/core.ts';
import { KeychainVault } from '@studio-zero/daemon/src/vault/KeychainVault.ts';

/**
 * A release needs the owner's keys: the token that deploys, the secret of a sign-in provider. They live in the
 * owner's vault (the macOS Keychain, the one the studio has always used) and are put there by the owner. An
 * agent uses one by its name: the command that needs it is run with it in its environment, and it is in no
 * argument list, no file, and no line of the session. If the command prints it, what reaches the session has
 * the value taken out.
 */

/** What is needed of a vault here. */
export interface SecretStore {
  get(id: string): Promise<{ expose(): string } | null>;
  set(id: string, secret: Secret): Promise<void>;
}

export const ownersVault = (): SecretStore => new KeychainVault();

/** A name in the environment of a command, and the vault id whose value it gets. */
export interface Binding {
  env: string;
  id: string;
}

const ID = /^[a-z0-9]+(\/[a-z0-9-]+){1,3}$/;

/** `NAME=vault/id ... -- command args...`: which secrets a command gets under which names, and the command. */
export function parseRun(words: readonly string[]): { bindings: Binding[]; command: string[] } {
  const at = words.indexOf('--');
  if (at < 1 || at === words.length - 1) throw new Error('sz-eyes secret run <NAME>=<vault id>... -- <command>...');
  const bindings = words.slice(0, at).map((word) => {
    const eq = word.indexOf('=');
    const [env, id] = [word.slice(0, Math.max(0, eq)), word.slice(eq + 1)];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(env) || !ID.test(id)) throw new Error(`"${word}" is not <NAME>=<vault id> (an id looks like host/cloudflare/api-token)`);
    return { env, id };
  });
  return { bindings, command: words.slice(at + 1) };
}

/** Text with every secret's value taken out, wherever it stands. */
export function hide(text: string, secrets: readonly { env: string; value: string }[]): string {
  let shown = text;
  for (const secret of secrets) if (secret.value.length >= 4) shown = shown.split(secret.value).join(`[${secret.env}: hidden]`);
  return shown;
}

/**
 * Runs a command with the named secrets in its environment and passes on what it prints, line by line, with
 * their values taken out. Answers with the command's exit code.
 */
export async function runWithSecrets(store: SecretStore, bindings: readonly Binding[], command: readonly string[], io: { out: (text: string) => void; err: (text: string) => void; env?: NodeJS.ProcessEnv; cwd?: string } = { out: (t) => void process.stdout.write(t), err: (t) => void process.stderr.write(t) }): Promise<number> {
  const secrets: { env: string; value: string }[] = [];
  const missing: string[] = [];
  for (const binding of bindings) {
    const found = await store.get(binding.id);
    if (found === null) missing.push(binding.id);
    else secrets.push({ env: binding.env, value: found.expose() });
  }
  if (missing.length > 0) throw new Error(`not in the vault: ${missing.join(', ')}. The owner puts a key there themselves, from the clipboard, so that it is never typed into a session: pbpaste | sz-eyes secret set ${missing[0]}`);
  const child = spawn(command[0]!, command.slice(1), { stdio: ['inherit', 'pipe', 'pipe'], env: { ...(io.env ?? process.env), ...Object.fromEntries(secrets.map((s) => [s.env, s.value])) }, ...(io.cwd ? { cwd: io.cwd } : {}) });
  // Whole lines are passed on, so that a value cut in two by the pipe is still found.
  const pass = (stream: NodeJS.ReadableStream, write: (text: string) => void): Promise<void> =>
    new Promise((done) => {
      let held = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        held += chunk;
        const cut = held.lastIndexOf('\n');
        if (cut >= 0) {
          write(hide(held.slice(0, cut + 1), secrets));
          held = held.slice(cut + 1);
        }
      });
      stream.on('end', () => {
        if (held !== '') write(hide(held, secrets));
        done();
      });
    });
  const [code] = await Promise.all([
    new Promise<number>((done, fail) => {
      child.once('error', (err) => fail(new Error(`${command[0]} could not be started: ${err.message}`)));
      child.once('close', (status) => done(status ?? 1));
    }),
    pass(child.stdout!, io.out),
    pass(child.stderr!, io.err),
  ]);
  return code;
}

/** Puts a key in the vault. The value comes on stdin, never as an argument. */
export async function setSecret(store: SecretStore, id: string, value: string): Promise<void> {
  if (!ID.test(id)) throw new Error(`"${id}" is not a vault id: lower-case words joined by slashes, like host/cloudflare/api-token`);
  const trimmed = value.replace(/\r?\n$/, '');
  if (trimmed.trim() === '') throw new Error('nothing came on stdin: pbpaste | sz-eyes secret set <id>');
  await store.set(id, new Secret(trimmed));
}

/** Which of these ids the vault holds: their names only. */
export async function heldSecrets(store: SecretStore, ids: readonly string[]): Promise<{ id: string; held: boolean }[]> {
  const found: { id: string; held: boolean }[] = [];
  for (const id of ids) {
    if (!ID.test(id)) throw new Error(`"${id}" is not a vault id`);
    found.push({ id, held: (await store.get(id)) !== null });
  }
  return found;
}

import { Secret } from '../util/core.ts';
import { runCommand, type CommandRunner } from '../util/run.ts';

const ID_PATTERN = /^[a-z0-9]+(\/[a-z0-9-]+){1,3}$/;
const ENVELOPE = 'sz1:';
/** `security` exits with 44 for errSecItemNotFound. */
const EXIT_NOT_FOUND = 44;

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

/** Well-known credential ids. Any id matching the pattern is accepted; these are the ones the daemon reads. */
export const CredentialIds = {
  anthropicApiKey: 'provider/anthropic/api-key',
  openaiApiKey: 'provider/openai/api-key',
  telegramBotToken: 'relay/telegram/bot-token',
  slackAppToken: 'relay/slack/app-token',
  slackBotToken: 'relay/slack/bot-token',
  ntfyToken: 'relay/ntfy/token',
  ntfySigningKey: 'relay/ntfy/signing-key',
  clientToken: 'daemon/client-token',
  /**
   * The one Kakao and the one Google developer app the studio's prototypes share for sign-in (the owner's
   * choice, 2026-11-14). The ids are public by nature (they travel in every login address) and are kept here
   * beside their secrets so that both come from one place; the secrets go to a project's auth service and
   * never into its sandbox.
   */
  kakaoLoginClientId: 'login/kakao/client-id',
  kakaoLoginClientSecret: 'login/kakao/client-secret',
  googleLoginClientId: 'login/google/client-id',
  googleLoginClientSecret: 'login/google/client-secret',
} as const;

export interface KeychainVaultOptions {
  /** Keychain "service" attribute. One service groups every Studio Zero item. */
  service?: string;
  /** Path to a specific keychain file. Defaults to the user's default (login) keychain. */
  keychain?: string;
  run?: CommandRunner;
}

/**
 * BYOK credential store backed by the macOS Keychain through `/usr/bin/security`.
 *
 * - Encryption at rest is the Keychain's own (AES-256-GCM, keys wrapped by the login password / Secure Enclave).
 *   Wrapping items in a second, self-managed AES layer would put its key in the same Keychain and add nothing.
 * - The secret never appears in a process argument list. Writes go through `security -i`, which reads its
 *   command from stdin, and the payload is hex (`-X`) so no quoting rule can be subverted by a secret's content.
 * - Items store `sz1:<base64>` so `find-generic-password -w` always prints one printable line, whatever bytes
 *   the secret contains (it switches to hex output for non-printable data, which would be ambiguous).
 *
 * Limitation, stated plainly: items created through the `security` CLI are readable by any process running as
 * this macOS user that invokes `security`. That protects against disk theft and other users, not against
 * malware in the same login session. Per-application ACLs need a code-signed helper and are a hardening step.
 * Sandboxes are unaffected either way: nothing inside a container can execute host binaries.
 */
export class KeychainVault {
  readonly #service: string;
  readonly #keychain: string | undefined;
  readonly #run: CommandRunner;

  constructor(opts: KeychainVaultOptions = {}) {
    this.#service = opts.service ?? 'studio-zero';
    this.#keychain = opts.keychain;
    this.#run = opts.run ?? runCommand;
    if (!/^[A-Za-z0-9._-]+$/.test(this.#service)) throw new VaultError('invalid keychain service name');
    if (this.#keychain !== undefined && !/^[A-Za-z0-9._\/ -]+$/.test(this.#keychain)) throw new VaultError('invalid keychain path');
  }

  async get(id: string): Promise<Secret | null> {
    assertId(id);
    const res = await this.#run('/usr/bin/security', ['find-generic-password', '-s', this.#service, '-a', id, '-w', ...this.#keychainArg()], { timeoutMs: 15_000 });
    if (res.exitCode === EXIT_NOT_FOUND) return null;
    if (res.exitCode !== 0) throw new VaultError(`keychain read failed for ${id} (exit ${res.exitCode}): ${res.stderr.trim()}`);
    const line = res.stdout.trimEnd();
    if (!line.startsWith(ENVELOPE)) throw new VaultError(`keychain item ${id} was not written by Studio Zero`);
    return new Secret(Buffer.from(line.slice(ENVELOPE.length), 'base64').toString('utf8'));
  }

  async set(id: string, secret: Secret): Promise<void> {
    assertId(id);
    const stored = ENVELOPE + Buffer.from(secret.expose(), 'utf8').toString('base64');
    const hex = Buffer.from(stored, 'ascii').toString('hex');
    // Every token below is [A-Za-z0-9._/:-] by construction, so the `security -i` line parser sees plain words.
    const command = [
      'add-generic-password',
      '-U', // update in place if the item exists
      '-s', this.#service,
      '-a', id,
      '-l', `studio-zero:${id}`,
      '-T', '/usr/bin/security',
      '-X', hex,
      ...this.#keychainArg().map(quoteWord),
    ].join(' ');
    const res = await this.#run('/usr/bin/security', ['-i'], { stdin: `${command}\n`, timeoutMs: 15_000 });
    if (res.exitCode !== 0) throw new VaultError(`keychain write failed for ${id} (exit ${res.exitCode}): ${res.stderr.trim()}`);
    // `security -i` reports per-command failures loosely, so the write is confirmed by reading it back.
    const readBack = await this.get(id);
    if (readBack === null || readBack.expose() !== secret.expose()) throw new VaultError(`keychain write for ${id} could not be verified`);
  }

  async delete(id: string): Promise<boolean> {
    assertId(id);
    const res = await this.#run('/usr/bin/security', ['delete-generic-password', '-s', this.#service, '-a', id, ...this.#keychainArg()], { timeoutMs: 15_000 });
    if (res.exitCode === EXIT_NOT_FOUND) return false;
    if (res.exitCode !== 0) throw new VaultError(`keychain delete failed for ${id} (exit ${res.exitCode}): ${res.stderr.trim()}`);
    return true;
  }

  #keychainArg(): string[] {
    return this.#keychain === undefined ? [] : [this.#keychain];
  }
}

function assertId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new VaultError(`invalid credential id: ${JSON.stringify(id)}`);
}

function quoteWord(word: string): string {
  return /^[A-Za-z0-9._\/-]+$/.test(word) ? word : `"${word}"`;
}

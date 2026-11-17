// `sz-eyes arm ...` as cli.ts runs it, in a process of its own, with a vault of made-up keys given in
// SZ_TEST_VAULT (JSON) in place of the owner's Keychain: what it prints is what a person would see.
import { ArmError, armCommand } from '../../src/arms.ts';
import type { SecretStore } from '../../src/secrets.ts';

const kept = JSON.parse(process.env.SZ_TEST_VAULT ?? '{}') as Record<string, string>;
const store: SecretStore = { get: async (id) => (id in kept ? { expose: () => kept[id]! } : null), set: async () => undefined };
const [command, ...rest] = process.argv.slice(2);
armCommand(command, rest, { store, env: process.env }).then(
  (done) => {
    process.stdout.write(`${done.text}\n`);
    process.exit(done.code);
  },
  (err: unknown) => {
    process.stderr.write(`sz-eyes: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(err instanceof ArmError ? 1 : 2);
  },
);

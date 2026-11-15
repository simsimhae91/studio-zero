#!/usr/bin/env node
// When a session is about to stop: if a frozen contract still has a claim that nobody has shown, or one shown
// false, the session is told what is owed, once. It may then stop, saying plainly what stands; it is not held
// in a loop. A stop that follows this reminder goes through.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let event = {};
try {
  event = JSON.parse(input);
} catch {
  process.exit(0);
}
if (event.stop_hook_active) process.exit(0);
const eyes = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'sz-eyes');
const status = spawnSync(eyes, ['contract', 'status', '--dir', event.cwd ?? process.cwd()], { encoding: 'utf8', timeout: 20_000 });
if (status.status !== 1) process.exit(0);
process.stderr.write(`Before you stop: ${status.stdout.trim()}\n\nEither have each of these shown on the running product (the sz:verifier agent records the verdict), or stop and tell the owner exactly which claims are not proven and why. Do not call the work done.\n`);
process.exit(2);

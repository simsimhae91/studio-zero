#!/usr/bin/env node
// When a session is about to stop: if a frozen contract still has a claim that nobody has shown, or one shown
// false, the session is told what is owed, once. It may then stop, saying plainly what stands; it is not held
// in a loop. A stop that follows this reminder goes through.
//
// The same list is said once in a session. After the owner has been told what is not proven, an answer to
// something else does not need it again: a session with a contract open for three hours ended six answers in a
// row with the same block. When the list changes (a claim shown, another found false), it is said again.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const owes = status.stdout.trim();
const session = typeof event.session_id === 'string' ? event.session_id.replace(/[^A-Za-z0-9_-]/g, '') : '';
if (session !== '') {
  const told = join(tmpdir(), `sz-owed-${session}`);
  try {
    if (readFileSync(told, 'utf8') === owes) process.exit(0);
  } catch {
    // nothing was said in this session yet
  }
  try {
    writeFileSync(told, owes);
  } catch {
    // a reminder that cannot be remembered is repeated: that is the lesser fault
  }
}
process.stderr.write(`Before you stop: ${owes}\n\nEither have each of these shown on the running product (the sz:verifier agent records the verdict), or stop and tell the owner exactly which claims are not proven and why. Do not call the work done.\n`);
process.exit(2);

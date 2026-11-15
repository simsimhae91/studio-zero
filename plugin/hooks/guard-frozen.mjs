#!/usr/bin/env node
// Before a file is edited: a contract that is frozen, and the flows and tests it points at, are not the
// builder's to change. They are the oracle the work is proven against. Exit 2 refuses the edit and tells why.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let call;
try {
  call = JSON.parse(input);
} catch {
  process.exit(0);
}
// The arbiter is the one who may correct a frozen check: it built nothing and judges nothing.
if (call.agent_type === 'sz:arbiter') process.exit(0);
const project = resolve(call.cwd ?? process.cwd());
const file = call.tool_input?.file_path ?? call.tool_input?.notebook_path;
const dir = join(project, '.sz', 'contracts');
if (typeof file !== 'string' || !existsSync(dir)) process.exit(0);
const target = relative(project, resolve(project, file));
if (target.startsWith('..')) process.exit(0);

for (const name of readdirSync(dir).filter((entry) => entry.endsWith('.json'))) {
  let contract;
  try {
    contract = JSON.parse(readFileSync(join(dir, name), 'utf8'));
  } catch {
    continue;
  }
  if (contract.closedAt || !contract.frozenAt) continue;
  if (target === join('.sz', 'contracts', name)) {
    process.stderr.write(`Contract ${contract.id} is frozen: it is not edited by hand. A verdict is recorded with \`sz-eyes contract claim\`, by whoever verified it. If a check it names is wrong about how it checks, the sz:arbiter agent settles that; if a claim is wrong about what was asked, stop and tell the owner.\n`);
    process.exit(2);
  }
  if ((contract.frozen ?? []).some((path) => target === path || target.startsWith(`${path.replace(/\/$/, '')}/`))) {
    process.stderr.write(`${target} is frozen by contract ${contract.id}: it is what the work is proven against, so whoever builds does not change it. Make the product pass it. If the check itself is wrong (not the product), do not work around it: have the sz:arbiter agent look at it, with the file and exactly what is wrong.\n`);
    process.exit(2);
  }
}
process.exit(0);

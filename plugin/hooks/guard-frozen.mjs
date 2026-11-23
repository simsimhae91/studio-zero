#!/usr/bin/env node
// Before a file is edited: a contract that is frozen, and the flows and tests it points at, are not the
// builder's to change. They are the oracle the work is proven against. And after the work is closed, a flow or
// test that a claim was proven by stays the product's promise: the product is changed so that it keeps passing,
// until a later contract says that claim is replaced. Exit 2 refuses the edit and tells why.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { standingClaims, supersededClaims } from './frozen.mjs';

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

const refuse = (why) => {
  process.stderr.write(`${why}\n`);
  process.exit(2);
};
if (target === join('.sz', 'standing.json')) {
  // By hand only to repair it: a file that cannot be read (a merge conflict) has to be mended somehow.
  let readable = true;
  try {
    JSON.parse(readFileSync(join(project, target), 'utf8'));
  } catch {
    readable = existsSync(join(project, target)) ? false : true;
  }
  if (readable) refuse('.sz/standing.json is the record of when each standing claim was last shown to hold: it is written by `sz-eyes standing record`, by whoever looked, not by hand.');
  process.exit(0);
}

const contracts = readdirSync(dir)
  .filter((entry) => entry.endsWith('.json'))
  .flatMap((name) => {
    try {
      return [{ name, contract: JSON.parse(readFileSync(join(dir, name), 'utf8')) }];
    } catch {
      return [];
    }
  });
const replaced = supersededClaims(contracts.map(({ contract }) => contract));
const under = (path) => target === path || target.startsWith(`${path.replace(/\/$/, '')}/`);

for (const { name, contract } of contracts) {
  if (!contract.frozenAt) continue;
  if (target === join('.sz', 'contracts', name)) {
    refuse(
      contract.closedAt
        ? `Contract ${contract.id} is closed: it is the record of what was agreed and shown, and is not edited. A claim of it that should no longer be true is replaced by a new contract (\`sz-eyes contract new ... --supersedes "${contract.id}/<claim>|<why>"\`).`
        : `Contract ${contract.id} is frozen: it is not edited by hand. A verdict is recorded with \`sz-eyes contract claim\`, by whoever verified it. If a check it names is wrong about how it checks, the sz:arbiter agent settles that. If a claim states a fact about the world that its source gives otherwise, the sz:arbiter agent sets it aside for the owner and the rest of the work goes on; a claim wrong about what was asked in any other way is the owner's: stop and tell them.`,
    );
  }
  const frozen = (contract.frozen ?? []).filter(under);
  if (frozen.length === 0) continue;
  if (!contract.closedAt) {
    refuse(`${target} is frozen by contract ${contract.id}: it is what the work is proven against, so whoever builds does not change it. Make the product pass it. If the check itself is wrong (not the product), do not work around it: have the sz:arbiter agent look at it, with the file and exactly what is wrong.`);
  }
  // Closed: only what a flow or test claim names is kept from the builder, and only while that claim stands.
  // Helpers and lists of checks that later work has to add to are watched (sz-eyes standing says when they
  // change), not locked. A claim names this file when its words hold the file's own path, or hold a frozen
  // folder as a whole (not a file inside it): a contract that froze `e2e/` for one flow in it does not lock
  // the flows later work adds beside it.
  const keeps = standingClaims(contract, target, frozen, replaced);
  if (keeps.length > 0) {
    const keys = keeps.map((claim) => `${contract.id}/${claim.id}`).join(', ');
    refuse(
      `${target} is how ${keys} was proven, and that still stands ("${keeps[0].says}"). Change the product so that it keeps passing; the check is not changed to fit the product. If the check is wrong about how it checks (it names something that a deliberate change renamed), the sz:arbiter agent corrects it. If what the owner now asks means the claim should no longer be true, say so in the new contract before it is frozen (\`--supersedes "${contract.id}/${keeps[0].id}|<why>"\`): then this file is yours to rewrite.`,
    );
  }
}
process.exit(0);

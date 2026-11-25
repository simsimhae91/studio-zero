import { execFileSync, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { mobbinOptions } from './mobbin.mjs';

const plugin = dirname(dirname(fileURLToPath(import.meta.url)));
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

// Responses structured output needs closed objects with every property required.
// A null optional field travels as an omitted field to the shared workflow.
export function outputSchema(schema) {
  if (schema.items) return { ...schema, items: outputSchema(schema.items) };
  if (!schema.properties) return schema;
  const properties = Object.fromEntries(
    Object.entries(schema.properties).map(([name, field]) => [
      name,
      schema.required?.includes(name) ? outputSchema(field) : { anyOf: [outputSchema(field), { type: 'null' }] },
    ]),
  );
  return { ...schema, properties, required: Object.keys(properties), additionalProperties: false };
}

function readGit(cwd, args) {
  return execFileSync(
    'codex',
    [
      'sandbox',
      '--include-managed-config',
      '-P',
      ':read-only',
      '--',
      'git',
      '-c',
      'core.fsmonitor=false',
      '--no-optional-locks',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  );
}

// Existing local work belongs to the owner. Check only product changes this
// worker leaves behind, including new files; .sz is committed at close.
function uncommittedProduct(cwd) {
  const changes = new Map();
  if (!existsSync(join(cwd, '.git'))) return changes;
  const status = readGit(cwd, [
    'status',
    '--porcelain=v1',
    '-z',
    '--no-renames',
    '--untracked-files=all',
    '--',
    '.',
    ':(exclude).sz',
  ]);
  for (const entry of status.split('\0').filter(Boolean)) {
    const file = entry.slice(3);
    const stat = lstatSync(join(cwd, file), { throwIfNoEntry: false });
    changes.set(file, entry.slice(0, 2) + '/' + stat?.size + '/' + stat?.mtimeMs);
  }
  return changes;
}

const leftSince = (cwd, before) => [...uncommittedProduct(cwd)].filter(([file, state]) => before.get(file) !== state).map(([file]) => file);

// A worker that leaves product files uncommitted is handed them back once, by a short worker of the same role:
// commit what belongs to the work, remove what running something left. (2026-11-23: a fixer left one helper
// flow uncommitted, and the whole build of 76 minutes ended on it.)
const LEFT = {
  type: 'object',
  properties: {
    committed: { type: 'array', items: { type: 'string' }, description: 'the paths committed, as part of the work' },
    removed: { type: 'array', items: { type: 'string' }, description: 'the paths removed, as leftovers of running something' },
  },
  required: ['committed', 'removed'],
};
const leftPrompt = (label, files) =>
  `The worker before you (${label}) finished and left these files of the product changed and not committed: ${files.join(', ')}. Look at each (\`git status\`, \`git diff\`, the file itself). Commit, by exact path, each one that is part of that work (a check it wrote, a file it changed), in one commit whose message says what they are. Remove each that is only a leftover of running something (an output, a log, a copy). Change nothing else, and run nothing else: the work itself is done. Return the paths under "committed" and "removed".`;

const MAX_HAND_BACK = 2;

// `--ignore-user-config` runs every worker on Codex's own defaults, where web search is `cached` (an index, not the
// page). The roles whose word rests on what a publisher says now read the page itself: the fact reader, the red
// team, and the arbiter, who opens a claim's source before it sets the claim aside. Their shell stays local.
const WEB_SEARCH = new Set(['facts', 'redteam', 'arbiter']);

function contractOf(cwd, id) {
  if (!id) return null;
  try {
    return json(join(cwd, '.sz/contracts', id + '.json'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// A verifier owes only its share. Open claims are a fixer's and an arbiter's normal state.
function owesNow(cwd, role, contract, assigned) {
  if (!contract || !['build', 'start', 'verifier', 'sweep'].includes(role)) return '';
  const current = contractOf(cwd, contract);
  if (!current) {
    if (role === 'sweep') return "the design contract `design` was not recorded: record it, freeze it, and record the screens' verdict";
    if (role === 'build') return `record and freeze the contract ${contract} and finish its work`;
    return '';
  }
  if (current.closedAt) return '';
  if (role === 'build' || role === 'start')
    return current.built ? '' : `the contract ${contract} still needs \`sz-eyes contract built ${contract} --launch "<how it starts>"\``;
  if (role === 'sweep' && !current.frozenAt) return `freeze the design contract and record the screens' verdict`;
  return current.claims
    .filter((claim) => claim.status === 'unproven' && claim.shownBy.kind !== 'owner' && (!assigned || assigned.includes(claim.id)))
    .map((claim) => `${claim.id}: no verdict yet (${claim.shownBy.kind}: ${claim.shownBy.ref}): ${claim.says}`)
    .join('\n');
}

// A fresh verifier may return just what it did on its latest attempt. The ledger settles
// the claims across all attempts, including when the model reports a verdict it never recorded.
function withEarlierVerdicts(earlier, latest, current, assigned) {
  if (!current) throw new Error("the verifier's contract disappeared after hand-back");
  const revisited = new Set([...(latest.held || []), ...(latest.broken || []).map((b) => b.key)]);
  const result = {
    ...earlier,
    ...latest,
    proven: [], refuted: [], unchecked: [],
    held: [...(earlier.held || []).filter((key) => !revisited.has(key)), ...(latest.held || [])],
    broken: [...(earlier.broken || []).filter((b) => !revisited.has(b.key)), ...(latest.broken || [])],
    noticed: [...new Set([...(earlier.noticed || []), ...(latest.noticed || [])])],
  };
  for (const { id, status, note, shownBy } of current.claims) {
    if (assigned && !assigned.includes(id)) continue;
    if (status === 'proven') result.proven.push(id);
    if (status === 'refuted') {
      const fact = note || latest.refuted.find((r) => r.id === id)?.fact || earlier.refuted.find((r) => r.id === id)?.fact;
      result.refuted.push({ id, fact: fact || 'recorded as refuted' });
    }
    if (status === 'unchecked') {
      const why = note || latest.unchecked.find((u) => u.id === id)?.why || earlier.unchecked.find((u) => u.id === id)?.why;
      result.unchecked.push({ id, why: why || 'recorded as unchecked' });
    }
    if (status === 'unproven' && shownBy.kind !== 'owner') result.unchecked.push({ id, why: 'no verdict was recorded' });
  }
  return result;
}

// One stage of the build: a fresh `codex exec` in the project, with the sz tools of its role.
export function codexWorker({ root, model, z, log, active, holdProject, interrupted }) {
  const worker = async (where, contract, prompt, options) => {
    if (interrupted()) throw new Error('build interrupted');
    const cwd = where ? realpathSync(resolve(root, where)) : root;
    if (where && !cwd.startsWith(join(root, '.sz/trees') + '/')) throw new Error('invalid milestone worktree: ' + cwd);
    const { label, agentType, schema } = options;
    const workerModel = options.codexModel ?? model;
    const effort = options.effort ?? (agentType ? 'xhigh' : 'high');
    const role = agentType?.split(':')[1] ?? label.split(':')[0];
    contract ??= options.contractId;
    const cleanup = label.endsWith(':left');
    if (contract && !/^[a-z0-9][a-z0-9-]{2,60}$/.test(contract)) throw new Error('invalid contract id: ' + contract);
    const runToken = holdProject();
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'sz-worker-')));
    const schemaFile = join(scratch, 'output.schema.json');
    try {
      const before = ['build', 'fix', 'mend', 'start'].includes(role) ? uncommittedProduct(cwd) : null;
      const strict = outputSchema(schema);
      writeFileSync(schemaFile, JSON.stringify(strict));
      const roleText = agentType
        ? readFileSync(join(plugin, 'agents', role + '.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '')
        : '';
      const directions = `You are a fresh Codex worker for ${label}. Your actual project is ${cwd}. Use the sz MCP shell for project commands and file edits. For a built Electron app use the sz electron tool for its first window, interaction and project Node GUI flows. Pass look/do flags from the project map and use returned project-relative PNG paths when recording evidence. Use the sz record tool for every contract or standing mutation, passing an argv array without sz-eyes. For close, use record for sz-eyes evidence <contract> and sz-eyes evidence prune <contract> as well. Shell writes to the ledger are denied. The native sandbox and this tool's boundaries are final. When a browser or other device cannot start, report it as unchecked or blocked. In place of Claude's Skill tool, read the full ${plugin}/skills/<name>/SKILL.md and its relative references with the sz shell. Use $TMPDIR for disposable copies and build outputs. ${WEB_SEARCH.has(role) ? "You read a publisher's page with web search, not with the shell: the shell reaches this machine only (localhost). Where what you return rests on a published page, give its address and the day you read it. " : ''}Do not spawn other workers. In JSON use null for optional fields that don't apply.\n`;
      log(`[${label}] ${workerModel} / ${effort}`);
      const mobbin = mobbinOptions(options.phase, label, scratch);
      const searchInstructions = mobbin.length
        ? 'For real design references, use the Mobbin MCP search tools. For app screens specify ios or web, for a user journey search flows, and for marketing sites search sections. Search for the screen purpose and inspect the returned examples. If the service reports a limit or login error, report it and use the reference library.\n'
        : '';
      const cli = [
        'exec',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--cd',
        scratch,
        '--model',
        workerModel,
        '-c',
        'model_reasoning_effort=' + JSON.stringify(effort),
        ...[
          'plugins',
          'apps',
          'multi_agent',
          'multi_agent_v2',
          'hooks',
          'shell_tool',
          'unified_exec',
          'image_generation',
          'computer_use',
        ].flatMap((f) => ['--disable', f]),
        '-c',
        'mcp_servers.sz.command=' + JSON.stringify(process.execPath),
        '-c',
        'mcp_servers.sz.args=' + JSON.stringify([join(plugin, 'codex/tools.mjs'), cwd, role, contract || '', label, runToken]),
        '-c',
        'mcp_servers.sz.required=true',
        '-c',
        'mcp_servers.sz.tool_timeout_sec=1800',
        ...(WEB_SEARCH.has(role) ? ['-c', 'web_search="live"'] : []),
        ...mobbin,
        '-c',
        'mcp_servers.sz.default_tools_approval_mode="approve"',
        '--output-schema',
        schemaFile,
      ];
      let result;
      let stopped;
      const sweepBefore = role === 'sweep' ? contractOf(cwd, contract)?.claims.find((claim) => claim.id === 'screens') : null;
      let lastOwed = '';
      let reminder = '';
      for (let attempt = 0; ; attempt++) {
        if (interrupted()) throw new Error('build interrupted');
        const output = join(scratch, `result-${attempt}.json`);
        await new Promise((ok, fail) => {
          const child = spawn('codex', [...cli, '--output-last-message', output, '-'], { cwd: scratch, stdio: ['pipe', 'ignore', 'pipe'] });
          active.add(child);
          let tail = '';
          child.stderr.on('data', (data) => {
            tail = (tail + data).slice(-6000);
          });
          child.stdin.on('error', () => {});
          child.once('error', fail);
          child.once('close', (code, signal) => {
            active.delete(child);
            if (code === 0) ok();
            else fail(new Error(`${label}: codex exited ${signal || code}. ${tail.slice(-1800)}`));
          });
          child.stdin.end(directions + searchInstructions + roleText + '\n' + prompt + reminder);
        });
        // A successful fact check can finish without an answer; actual process or schema failures still surface.
        const reviewOrFacts = role === 'redteam' || role === 'facts';
        if (reviewOrFacts && !existsSync(output)) return null;
        const answer = readFileSync(output, 'utf8');
        if (reviewOrFacts && !answer.trim()) return null;
        const latest = JSON.parse(answer, (_key, v) => (v === null ? undefined : v));
        z.fromJSONSchema(schema).parse(latest);
        result = role === 'verifier' && result?.proven && latest.proven ? withEarlierVerdicts(result, latest, contractOf(cwd, contract), options.claims) : latest;
        stopped = result.blocked?.trim() || result.sandbox?.trim() || result.notReal?.some((entry) => entry.what.trim());
        if (stopped || interrupted() || cleanup) break;
        let owed = owesNow(cwd, role, contract, options.claims);
        if (!owed && sweepBefore && contractOf(cwd, contract)?.claims.find((claim) => claim.id === 'screens')?.at === sweepBefore.at)
          owed = 'record the verdict for screens from this sweep';
        if (!owed || owed === lastOwed || attempt >= MAX_HAND_BACK) break;
        lastOwed = owed;
        reminder = `\n\nYou stopped before this work was done. Still owed on contract \`${contract}\`:\n${owed}\n\n` +
          'Take it up from where you stopped: finish each of these, or say plainly which one cannot be done and why. ' +
          'What you already did stands. Return the complete result for your assignment.';
        log(`[${label}] stopped with ${owed.split('\n').length} still owed: handed back (${attempt + 1}/${MAX_HAND_BACK})`);
      }
      if (before && !stopped) {
        let left = leftSince(cwd, before);
        if (left.length && !cleanup) {
          log(`[${label}] left ${left.join(', ')} uncommitted: requesting one cleanup`);
          await worker(where, contract, leftPrompt(label, left), { label: label + ':left', schema: LEFT, effort: 'low', phase: options.phase });
          left = leftSince(cwd, before);
        }
        if (left.length)
          throw new Error(label + ': product changes still need a commit after cleanup: ' + left.join(', '));
      }
      if (role === 'build' && !cleanup && !stopped) {
        if (result.contractId !== contract || !json(join(cwd, '.sz/contracts', contract + '.json')).built)
          throw new Error(label + ': no matching built contract');
      }
      if (role === 'close' && result.closed) {
        const report = join(cwd, '.sz/evidence', contract, 'report.html');
        if (!json(join(cwd, '.sz/contracts', contract + '.json')).closedAt || !existsSync(report))
          throw new Error(label + ': no closed contract and evidence page');
        const evidence = [`.sz/contracts/${contract}.json`, `.sz/evidence/${contract}/report.html`];
        readGit(cwd, ['ls-files', '--error-unmatch', '--', ...evidence]);
        readGit(cwd, ['diff', '--quiet', 'HEAD', '--', ...evidence]);
        result.report = report;
      }
      return result;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };
  return worker;
}

// A stop is resumable: the run keeps its hold, with the reason visible to the next session.
export function closeRun(runs, project, token, result) {
  if (token === null) return;
  const why = result && (result.error || result.stopped);
  if (why) runs.stopBuildRun(project, String(why));
  else runs.endBuildRun(project);
}

export async function runBuild(args, project = process.cwd()) {
  const source = readFileSync(join(plugin, 'workflows/build.js'), 'utf8').replace('export const meta', 'const meta');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const workflow = new AsyncFunction('args', 'agent', 'milestoneAgent', 'phase', 'log', 'hostSandbox', source);
  const root = realpathSync(project);
  if (!args || typeof args !== 'object' || Array.isArray(args))
    throw new Error('Expected one build request JSON object.');
  const model = args.model ?? 'gpt-6.2-astra';
  if (typeof model !== 'string' || !model.trim()) throw new Error('model must be a Codex model ID');
  const z = createRequire(resolve(plugin, '../packages/eyes/package.json'))('zod');
  const runs = await import(pathToFileURL(resolve(plugin, '../packages/eyes/src/build-run.ts')).href);
  // The run holds the project from its first worker on: a request turned away before any model works holds nothing.
  let token = null;
  const holdProject = () => (token ??= runs.startBuildRun(root, typeof args.request === 'string' ? args.request : ''));
  const active = new Set();
  let interrupted = false;
  const abort = () => {
    interrupted = true;
    for (const child of active) child.kill('SIGTERM');
  };
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  const log = (message) => console.error(message);
  const worker = codexWorker({ root, model, z, log, active, holdProject, interrupted: () => interrupted });
  // Both the root plan review and worktree milestone reviews go through this adapter.
  const id = args.redteamModel;
  const redteamModel = typeof id === 'string' && /^[A-Za-z0-9._-]{2,60}$/.test(id) && !['sonnet', 'opus'].includes(id) ? id : model;
  const runWorker = (where, contract, prompt, options) => worker(where, contract, prompt,
    options.agentType === 'sz:redteam' ? { ...options, codexModel: redteamModel } : options);
  try {
    // Claude model aliases belong to its adapter. The Codex model was resolved above.
    const result = await workflow({ ...args, model: undefined }, (p, o) => runWorker(null, o.contractId ?? null, p, o), runWorker, log, log, {
      redteamModel,
      instructions:
        ' Use the Codex project shell and the sz electron tool for Electron observations. If their permissions stop a required observation, return the actual refusal under sandbox. Keep that observation unchecked.',
      stop: 'Resume from the same project when that observation can run with the required permissions.',
    });
    closeRun(runs, root, token, result);
    return result;
  } catch (error) {
    // The record stays, saying why: the ledger takes nothing more until a run starts again and resumes.
    if (token !== null) runs.stopBuildRun(root, error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    process.off('SIGINT', abort);
    process.off('SIGTERM', abort);
  }
}

export async function main() {
  if (process.argv.includes('--help') || process.stdin.isTTY) {
    console.log(
      'sz-codex-build < request.json   (run in the target project)\nJSON: { "request": "...", "asked": "owner", "answers": "..." }',
    );
    return;
  }
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let result;
  try {
    result = await runBuild(JSON.parse(input));
  } catch (error) {
    const runs = await import(pathToFileURL(resolve(plugin, '../packages/eyes/src/build-run.ts')).href);
    if (runs.readBuildRun(process.cwd())?.stoppedAt)
      error.message += `\n\nThe build stopped there. Nothing is lost: run sz-codex-build again from this project with the same JSON, and it resumes from .sz (contracts, verdicts and commits stay). Do not carry the build on by hand or with agents you start: sz-eyes records nothing of its contracts until it runs again, because every verdict comes from a worker of the run that did not build.`;
    throw error;
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.error || result.stopped) process.exitCode = 1;
}

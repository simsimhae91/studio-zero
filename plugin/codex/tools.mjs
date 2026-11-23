// One MCP server per worker. Recompute filesystem permissions on every call so a
// check frozen by one command is already read-only when the next command starts.
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { standingClaims, supersededClaims } from '../hooks/frozen.mjs';
import { electronTool, observeElectron } from './electron-vm.mjs';

const plugin = dirname(dirname(fileURLToPath(import.meta.url)));
const harness = dirname(plugin);
const validId = /^[a-z0-9][a-z0-9-]{2,60}$/;

function inside(root, name) {
  const path = resolve(root, name);
  if (path === root || !path.startsWith(root + '/') || isAbsolute(name) || name.split('/').includes('..'))
    throw new Error('invalid project path: ' + name);
  for (let dir = path; dir !== root; dir = dirname(dir)) {
    if (lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('linked project path: ' + name);
  }
  return path;
}

const operations = {
  build: ['contract new', 'contract freeze', 'contract built'],
  start: ['contract built'],
  verifier: ['contract claim', 'contract add-check', 'contract notice', 'standing record'],
  arbiter: ['contract amend', 'contract dispute', 'contract supersede'],
  close: ['contract close'],
  sweep: ['contract new', 'contract freeze', 'contract claim'],
  join: ['standing mend'],
  resolve: ['standing mend'],
};

export function authorizeRecord(role, contract, label, args) {
  if (
    !Array.isArray(args) ||
    args.some((v) => typeof v !== 'string') ||
    args.includes('--dir') ||
    args.includes('--accepted')
  )
    throw new Error('invalid record arguments');
  const [area, op, id] = args;
  if (!operations[role]?.includes(area + ' ' + op)) throw new Error('this worker cannot record ' + area + ' ' + op);
  if (area === 'contract') {
    if (
      typeof id !== 'string' ||
      !validId.test(id) ||
      (id !== contract && !(role === 'arbiter' && op === 'amend') && !(label === 'sweep:design' && id === 'design'))
    )
      throw new Error('contract outside this worker');
    if (label === 'sweep:design' && op === 'claim' && args[3] !== 'screens')
      throw new Error('the prototype verdict belongs to the owner');
  }
}

function contractsAt(cwd) {
  const folder = inside(cwd, '.sz/contracts');
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(inside(cwd, '.sz/contracts/' + f), 'utf8')));
}

function frozenPaths(contracts, cwd) {
  const protectedPaths = new Set();
  const replaced = supersededClaims(contracts);
  for (const contract of contracts.filter((c) => c.frozenAt)) {
    for (const frozen of contract.frozen) {
      const path = inside(cwd, frozen);
      if (!contract.closedAt) {
        protectedPaths.add(path);
        continue;
      }
      const visit = (file, name) => {
        if (lstatSync(file, { throwIfNoEntry: false })?.isDirectory()) {
          for (const child of readdirSync(file)) visit(join(file, child), name + '/' + child);
        } else if (standingClaims(contract, name, [frozen], replaced).length) {
          protectedPaths.add(file);
        }
      };
      visit(path, frozen.replace(/\/$/, ''));
    }
  }
  return protectedPaths;
}

// A linked worktree's index lives in the main repository. Give committers
// just its index directory, shared objects, and its own branch reference.
function gitAccess(cwd, fs, writable) {
  const dot = inside(cwd, '.git');
  if (!lstatSync(dot, { throwIfNoEntry: false })?.isFile()) {
    fs.set(dot, writable ? 'write' : 'read');
    return;
  }
  const match = /^gitdir: (.+)$/m.exec(readFileSync(dot, 'utf8'));
  if (!match) throw new Error('invalid worktree .git file');
  const index = realpathSync(resolve(cwd, match[1]));
  if (realpathSync(resolve(index, readFileSync(join(index, 'gitdir'), 'utf8').trim())) !== dot)
    throw new Error('invalid worktree backlink');
  const common = realpathSync(resolve(index, readFileSync(join(index, 'commondir'), 'utf8').trim()));
  if (dirname(index) !== join(common, 'worktrees')) throw new Error('invalid worktree metadata');
  const branch = /^ref: (refs\/heads\/[\w./-]+)$/.exec(readFileSync(join(index, 'HEAD'), 'utf8').trim())?.[1];
  fs.set(common, 'read');
  if (!writable) return;
  fs.set(index, 'write');
  fs.set(join(common, 'objects'), 'write');
  if (branch) {
    for (const name of [branch, 'logs/' + branch]) {
      const file = inside(common, name);
      fs.set(file, 'write');
      fs.set(file + '.lock', 'write');
    }
  }
}

function sandbox(cwd, scratch, role, contract, command, record, newFlows) {
  const contracts = contractsAt(cwd);
  const fs = new Map([
    [':minimal', 'read'],
    [harness, 'read'],
    [dirname(dirname(realpathSync(process.execPath))), 'read'],
    [scratch, 'write'],
  ]);
  // For verification, source is readable and evidence is writable. A previously
  // missing named flow can be authored until add-check freezes it.
  // Homebrew executables dynamically load sibling formulae through opt/.
  for (const prefix of [
    '/opt/homebrew',
    '/usr/local',
    '/System/Library/OpenSSL',
    '/private/etc/ssl',
    '/Applications/Google Chrome.app',
    join(homedir(), '.gitconfig'),
    join(homedir(), '.config/git'),
  ])
    if (existsSync(prefix)) fs.set(prefix, 'read');
  const reviewing = role === 'verifier' || role === 'arbiter';
  fs.set(cwd, reviewing || record || role === 'close' ? 'read' : 'write');
  const allow = (name) => fs.set(inside(cwd, name), 'write');
  gitAccess(cwd, fs, !record && !reviewing);
  if (record) {
    for (let i = 0; i < command.length; i++) if (command[i] === '--frozen') inside(cwd, command[i + 1]);
    allow('.sz');
  } else if (role === 'close') {
    allow('.sz');
  } else if (reviewing) {
    allow('.sz/evidence');
    const current = contracts.find((c) => c.id === contract);
    if (role === 'verifier')
      for (const claim of current?.claims || []) {
        const ref = claim.shownBy?.ref;
        if (
          claim.shownBy?.kind === 'flow' &&
          /^[\w./-]+\.(ya?ml|[cm]?[jt]s|sh)$/.test(ref) &&
          (!ref.startsWith('.') || ref.startsWith('.sz/flows/')) &&
          (newFlows.has(ref) || !existsSync(inside(cwd, ref)))
        ) {
          // Only this named new file is writable. Create its parent before entering the sandbox.
          newFlows.add(ref);
          mkdirSync(dirname(inside(cwd, ref)), { recursive: true });
          allow(ref);
        }
      }
    if (role === 'arbiter')
      for (const c of contracts)
        for (const f of c.frozen || []) {
          if (lstatSync(inside(cwd, f), { throwIfNoEntry: false })?.isFile()) allow(f);
        }
  }
  if (!record) {
    if (!['stage', 'join', 'resolve'].includes(role)) fs.set(inside(cwd, '.sz/trees'), 'read');
    // Joining branches has to merge their ledgers. Verification follows the join.
    if (!['join', 'resolve'].includes(role)) {
      fs.set(inside(cwd, '.sz/contracts'), 'read');
      fs.set(inside(cwd, '.sz/standing.json'), 'read');
    }
    if (role !== 'arbiter') for (const path of frozenPaths(contracts, cwd)) fs.set(path, 'read');
  }
  for (const file of [
    '.codex',
    '.agents',
    ...(lstatSync(join(cwd, '.git'), { throwIfNoEntry: false })?.isDirectory() ? ['.git/hooks', '.git/config'] : []),
  ])
    fs.set(inside(cwd, file), 'read');
  if (cwd === harness || harness.startsWith(cwd + '/')) {
    fs.set(plugin, 'read');
    fs.set(join(harness, 'packages'), 'read');
  }
  const toml = [...fs].map(([k, v]) => JSON.stringify(k) + '=' + JSON.stringify(v)).join(',');
  const config = [
    'sandbox',
    '--include-managed-config',
    '-P',
    'sz-worker',
    '-c',
    'permissions.sz-worker.filesystem={' + toml + '}',
    '-c',
    'permissions.sz-worker.network.enabled=true',
    '-c',
    'permissions.sz-worker.network.allow_local_binding=true',
    '-c',
    'permissions.sz-worker.network.domains={"localhost"="allow","127.0.0.1"="allow","[::1]"="allow"}',
  ];
  const env = {
    PATH: join(plugin, 'bin') + ':' + dirname(process.execPath) + ':' + process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: scratch,
    LANG: process.env.LANG || 'en_US.UTF-8',
  };
  const invoke = record
    ? [process.execPath, join(harness, 'packages/eyes/src/cli.ts'), ...command]
    : Array.isArray(command) ? command : ['/bin/sh', '-c', command];
  return new Promise((ok, fail) => {
    const p = spawn('codex', [...config, '--', ...invoke], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let stdout = '';
    const append = (chunk) => {
      output = (output + chunk).slice(-64000);
    };
    p.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-64000);
      append(chunk);
    });
    p.stderr.on('data', append);
    p.once('error', fail);
    p.once('close', (code) => {
      // Fixed staging and publication programs return machine-readable stdout.
      const body = code === 0 && !record && Array.isArray(command) ? stdout : output;
      ok({ content: [{ type: 'text', text: body || 'exit ' + code }], isError: code !== 0 });
    });
  });
}

const defs = [
  {
    name: 'shell',
    description:
      'Run a shell command in your project with the permissions of your workflow role. sz-eyes and git are on PATH. Use shell redirection for edits.',
    inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  },
  {
    name: 'record',
    description:
      'Run a permitted sz-eyes contract or standing mutation. Supply individual argv strings, without sz-eyes.',
    inputSchema: {
      type: 'object',
      properties: { args: { type: 'array', items: { type: 'string' } } },
      required: ['args'],
    },
  },
];

async function serve() {
  const [cwd, role, contract, label] = process.argv.slice(2);
  const gui = typeof contract === 'string' && validId.test(contract) && ['build', 'start', 'verifier', 'arbiter', 'fix', 'mend'].includes(role);
  const newFlows = new Set();
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'sz-command-')));
  try {
    for await (const line of createInterface({ input: process.stdin })) {
      const q = JSON.parse(line);
      if (q.id === undefined) continue;
      const answer = { jsonrpc: '2.0', id: q.id };
      try {
        if (q.method === 'initialize')
          answer.result = {
            protocolVersion: q.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'sz', version: '1' },
          };
        else if (q.method === 'tools/list') answer.result = { tools: gui ? [...defs, electronTool] : defs };
        else if (q.method === 'ping') answer.result = {};
        else if (q.method === 'tools/call') {
          const { name, arguments: a } = q.params;
          if (name === 'record') {
            authorizeRecord(role, contract, label, a.args);
            answer.result = await sandbox(cwd, scratch, role, contract, a.args, true, newFlows);
          } else if (name === 'electron' && gui) {
            answer.result = await observeElectron(cwd, contract, a, (dir, argv) =>
              sandbox(cwd, dir, role, contract, argv, false, newFlows));
          } else if (name === 'shell' && typeof a.command === 'string') {
            for (const guard of ['guard-others', 'guard-live']) {
              const r = spawnSync(process.execPath, [join(plugin, 'hooks', guard + '.mjs')], {
                input: JSON.stringify({ tool_input: { command: a.command } }),
                encoding: 'utf8',
              });
              if (r.status !== 0) throw new Error(r.stderr || 'shell guard failed');
            }
            answer.result = await sandbox(cwd, scratch, role, contract, a.command, false, newFlows);
          } else throw new Error('unknown tool or invalid arguments');
        } else answer.error = { code: -32601, message: 'unknown method' };
      } catch (e) {
        answer.result = { content: [{ type: 'text', text: e.message }], isError: true };
      }
      process.stdout.write(JSON.stringify(answer) + '\n');
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await serve();

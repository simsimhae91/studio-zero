// Host control for the worker's Electron tool. Only snapshot and publication
// touch the project, both through the same managed worker sandbox as shell.
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(dirname(here));
const require = createRequire(join(root, 'package.json'));
const guestOut = '/tmp/sz-evidence';
export const electronTool = {
  name: 'electron',
  description: 'Observe the built project in an offline local macOS VM. Pass ["look", "<app>", ...] or ["do", "<app>", "--step", ...] using sz-eyes electron flags. Pictures are returned automatically. For an existing project flow use ["node", "relative/flow.ts", ...] and direct its pictures to /tmp/sz-evidence. Use one call for a flow that needs the same profile across launches.',
  inputSchema: {
    type: 'object',
    properties: {
      args: { type: 'array', items: { type: 'string' } },
      env: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Literal values for the guest command. Its project root is /private/tmp/sz-input/project.',
      },
    },
    required: ['args'],
  },
};

async function guest(home, job, args, signal) {
  signal.throwIfAborted();
  return new Promise((ok, fail) => {
    const p = spawn('/usr/bin/python3', [join(here, 'electron-guest.py'), home, job, ...args], {
      cwd: here,
      env: { HOME: homedir(), PATH: '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin', PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let tail = '';
    const append = (data) => {
      tail = (tail + data).slice(-64000);
    };
    p.stdout.on('data', append);
    p.stderr.on('data', append);
    const stop = () => p.kill('SIGTERM');
    signal.addEventListener('abort', stop, { once: true });
    p.once('error', fail);
    p.once('close', (code) => {
      signal.removeEventListener('abort', stop);
      ok({ content: [{ type: 'text', text: tail }], isError: code !== 0 });
    });
  });
}

export async function observeElectron(cwd, contract, { args, env = {} }, sandbox) {
  if (
    !Array.isArray(args) || args.length < 2 ||
    args.some((arg) => typeof arg !== 'string' || arg.includes('\0')) ||
    !['look', 'do', 'node'].includes(args[0])
  ) throw new Error('expected look/do <app> or node <project flow>');
  if (!args[1] || args[1].startsWith('/') || args[1].startsWith('-') || args[1].split('/').includes('..'))
    throw new Error('supply a project-relative app or flow');
  if (env === null || typeof env !== 'object' || Array.isArray(env) || Object.entries(env).some(([key, value]) =>
    !/^[a-z_][a-z0-9_]*$/i.test(key) || typeof value !== 'string' || value.includes('\0')))
    throw new Error('invalid guest environment');
  const configured = join(homedir(), '.config/sz/electron-vm');
  if (!existsSync(join(configured, 'vms/sz-electron-base/config.json')))
    throw new Error('Local Electron VM unavailable. Prepare sz-electron-base as described in plugin/README.md.');
  const home = realpathSync(configured);
  if ([homedir(), configured, home].some(path => path === cwd || path.startsWith(cwd + sep)) || cwd.startsWith(home + sep))
    throw new Error('choose a project outside the VM store that does not contain the user home or VM configuration');
  const job = mkdtempSync(join(home, 'observation-'));
  const controller = new AbortController();
  const interrupt = () => {
    controller.abort();
    process.stdin.destroy();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const project = join(job, 'project');
    mkdirSync(project);
    const exclude = ['.git', '.env', '.env.*', '.npmrc', '.aws', '.ssh', '.gnupg', '.codex', '.claude', '.agents',
      '.war-room-state', '.openchrome', '.playwright-mcp', '/.sz/trees', '/.sz/evidence'];
    const staged = await sandbox(job, [
      '/usr/bin/rsync', '-rlpt', '--safe-links', ...exclude.map((name) => '--exclude=' + name), './', project + '/',
    ]);
    if (staged.isError) return staged;
    controller.signal.throwIfAborted();

    const runtime = join(job, 'runtime');
    mkdirSync(runtime);
    copyFileSync(process.execPath, join(runtime, 'node'));
    if (args[0] !== 'node') {
      const eyes = join(root, 'packages/eyes');
      await require('esbuild').build({
        entryPoints: [join(eyes, 'src/cli.ts')],
        outfile: join(runtime, 'eyes.mjs'),
        platform: 'node',
        target: 'node24',
        format: 'esm',
        bundle: true,
        external: ['playwright-core'],
      });
      const playwright = dirname(createRequire(join(eyes, 'package.json')).resolve('playwright-core/package.json'));
      cpSync(playwright, join(runtime, 'node_modules/playwright-core'), { recursive: true, verbatimSymlinks: true });
    }
    const resultDir = join(job, 'pictures');
    mkdirSync(resultDir);
    const guestArgs = args[0] === 'node' ? args.slice(1) : ['../runtime/eyes.mjs', 'electron', ...args, '--out', guestOut];
    const values = Object.entries(env).map(([key, value]) => key + '=' + value);
    const result = await guest(home, job, [...values, '/private/tmp/sz-input/runtime/node', ...guestArgs], controller.signal);
    controller.signal.throwIfAborted();
    if (readdirSync(resultDir).length) {
      const published = await sandbox(job, ['/usr/bin/python3', join(here, 'electron-publish.py'), contract, resultDir]);
      if (published.isError) throw new Error('Could not publish VM evidence: ' + published.content[0].text);
      result.content.push(...published.content);
    }
    return result;
  } finally {
    process.off('SIGTERM', interrupt);
    process.off('SIGINT', interrupt);
    rmSync(job, { recursive: true, force: true });
  }
}

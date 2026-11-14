import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import type { Project } from '@studio-zero/protocol';
import { createDaemon, type Daemon, type DaemonOverrides } from '../src/app/compose.ts';
import { testConfig, type Config, type ConfigSchema } from '../src/config.ts';
import { runCommand, type CommandRunner, type RunOptions, type RunResult } from '../src/util/run.ts';
import type { z } from 'zod';

export const quietLog = pino({ level: 'silent' });

export function tempDir(prefix = 'sz-test-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const ok = (stdout = ''): RunResult => ({ exitCode: 0, stdout, stderr: '', truncated: false, timedOut: false, durationMs: 1 });
const fail = (exitCode: number, stderr: string): RunResult => ({ exitCode, stdout: '', stderr, truncated: false, timedOut: false, durationMs: 1 });

export interface Call {
  file: string;
  args: string[];
  stdin: string;
  env: NodeJS.ProcessEnv | undefined;
}

/** In-memory stand-in for `/usr/bin/security` that speaks the same argv/stdin/exit-code protocol. */
export function fakeSecurity(): { run: CommandRunner; items: Map<string, string>; calls: Call[] } {
  const items = new Map<string, string>();
  const calls: Call[] = [];
  const arg = (args: readonly string[], flag: string): string => args[args.indexOf(flag) + 1] ?? '';
  const run: CommandRunner = async (file, args, opts = {}) => {
    const stdin = typeof opts.stdin === 'string' ? opts.stdin : '';
    calls.push({ file, args: [...args], stdin, env: opts.env });
    if (args[0] === '-i') {
      const words = stdin.trim().split(/\s+/);
      if (words[0] !== 'add-generic-password') return fail(1, 'unknown command');
      items.set(`${arg(words, '-s')}|${arg(words, '-a')}`, Buffer.from(arg(words, '-X'), 'hex').toString('ascii'));
      return ok();
    }
    const key = `${arg(args, '-s')}|${arg(args, '-a')}`;
    if (args[0] === 'find-generic-password') return items.has(key) ? ok(`${items.get(key)}\n`) : fail(44, 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.');
    if (args[0] === 'delete-generic-password') return items.delete(key) ? ok() : fail(44, 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.');
    return fail(1, 'unsupported');
  };
  return { run, items, calls };
}

/**
 * Emulates the Docker CLI well enough to run the real OrbStackManager, scripts and harness without a container
 * engine: `docker exec … bash -c <script>` runs the same script on the host with /workspace mapped to a temp
 * directory. Everything else (run, network, volume, port) is bookkeeping.
 */
export function localDocker(workspace: string): { run: CommandRunner; calls: Call[]; containers: Set<string> } {
  const calls: Call[] = [];
  const containers = new Set<string>();
  const volumes = new Set<string>();
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  // /workspace is the temp workspace; the sandbox's own /tmp/sz* scratch paths go to a sibling directory, so an
  // emulated script can never touch a real /tmp/sz on this machine.
  const map = (text: string): string => text.replaceAll('/workspace', workspace).replaceAll('/tmp/sz', `${workspace}-scratch/sz`);

  const run: CommandRunner = async (file, allArgs, opts: RunOptions = {}) => {
    const stdin = typeof opts.stdin === 'string' ? opts.stdin : '';
    calls.push({ file, args: [...allArgs], stdin, env: opts.env });
    if (file !== 'docker') return fail(127, `${file}: not found`);
    const args = dockerArgs(allArgs);
    const [command, sub] = args;
    if (command === 'context') return ok('unix:///emulated/docker.sock\n');
    const nameAfter = (flag: string): string => args[args.indexOf(flag) + 1] ?? '';

    if (command === 'version') return ok('27.0.0 linux/arm64\n');
    if (command === 'image' || command === 'pull' || command === 'build') return ok('sha256:emulated\n');
    if (command === 'container' && sub === 'inspect') return containers.has(args.at(-1)!) ? ok('true\n') : fail(1, `Error response from daemon: No such container: ${args.at(-1)}`);
    if (command === 'network') return ok();
    if (command === 'volume' && sub === 'inspect') return volumes.has(args.at(-1)!) ? ok('[]') : fail(1, 'no such volume');
    if (command === 'volume' && sub === 'create') {
      volumes.add(args.at(-1)!);
      return ok();
    }
    if (command === 'port') return ok('5173/tcp -> 127.0.0.1:55173\n3000/tcp -> 127.0.0.1:55300\n');
    if (command === 'ps') return ok([...containers].map((name) => `${name}\trunning\n`).join(''));
    if (command === 'rm') {
      containers.delete(args.at(-1)!);
      return ok();
    }
    if (command === 'stop' || command === 'start') return ok();
    if (command === 'run') {
      if (args.includes('--detach')) containers.add(nameAfter('--name'));
      return ok('deadbeef\n');
    }
    if (command === 'exec') {
      if (args.includes('--detach')) return ok();
      const script = args.at(-1)!;
      const cwd = args.includes('--workdir') ? map(nameAfter('--workdir')) : workspace;
      return runCommand('bash', ['-c', map(script)], { cwd, stdin: opts.stdin, env, maxOutputBytes: opts.maxOutputBytes, signal: opts.signal, onStdout: opts.onStdout, timeoutMs: 60_000 });
    }
    return fail(1, `unsupported docker command: ${args.join(' ')}`);
  };
  return { run, calls, containers };
}

/** A docker command line without the client's global flags (`--config <dir> --host <endpoint>`). */
export function dockerArgs(all: readonly string[]): string[] {
  let i = 0;
  while (all[i] === '--config' || all[i] === '--host' || all[i] === '--context') i += 2;
  return all.slice(i);
}

export interface TestDaemon {
  daemon: Daemon;
  config: Config;
  workspace: string;
  security: ReturnType<typeof fakeSecurity>;
  docker: ReturnType<typeof localDocker>;
  /** `ws://127.0.0.1:<port>/v1/ws` once started. */
  url: () => string;
  port: () => number;
  cleanup: () => Promise<void>;
}

/** A complete daemon wired to the fakes above, on ephemeral ports, with its state in a temp directory. */
export async function testDaemon(configOverrides: z.input<typeof ConfigSchema> = {}, overrides: DaemonOverrides = {}, wrapDocker: (base: CommandRunner) => CommandRunner = (base) => base): Promise<TestDaemon> {
  const home = tempDir('sz-home-');
  const ws = tempDir('sz-ws-');
  const security = fakeSecurity();
  const docker = localDocker(ws.dir);
  // The studio's own repository is not mounted unless a test asks for it: a test daemon is not a place to work on it.
  const config = testConfig(home.dir, { listen: { port: 0 }, gateway: { port: 0 }, engines: { claudeCode: { enabled: false } }, selfHosting: { enabled: false }, ...configOverrides });
  // Tests never ask a real provider whether a key is good. And a test's scripted build has no backend to be walked
  // on: the walk of the plan's scenarios is off unless a test hands one in.
  const daemon = await createDaemon(config, quietLog, { run: wrapDocker(docker.run), securityRun: security.run, checkKey: async () => 'accepted', scenarios: null, ...overrides });
  const port = (): number => (daemon.server.app.server.address() as { port: number }).port;
  return {
    daemon,
    config,
    workspace: ws.dir,
    security,
    docker,
    port,
    url: () => `ws://127.0.0.1:${port()}/v1/ws`,
    cleanup: async () => {
      await daemon.stop().catch(() => undefined);
      home.cleanup();
      ws.cleanup();
      rmSync(`${ws.dir}-scratch`, { recursive: true, force: true });
    },
  };
}

export function sampleProject(slug = 'ledger'): Project {
  return { id: `prj_${slug}`, slug, name: 'Ledger', template: 'web-vite-react', createdAt: 1 };
}

export interface Upstream {
  url: string;
  port: number;
  requests: { method: string; path: string; headers: IncomingHttpHeaders; body: string }[];
  close: () => Promise<void>;
}

/** A stand-in LLM provider: records what it was sent and answers with a small SSE stream that reports usage. */
export async function fakeProvider(host = '127.0.0.1'): Promise<Upstream> {
  const requests: Upstream['requests'] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      requests.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_123' });
      res.write('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":120,"cache_read_input_tokens":30,"output_tokens":1}}}\n\n');
      res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n');
      res.end('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":45}}\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, port, requests, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

/** A TCP port that was free a moment ago. For config values that must be known before a server starts. */
export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** An anchor table that holds: what a scripted planner hands back for a design task. */
export const sampleAnchor = {
  idea: '밀린 돈이 며칠째인지가 금액보다 먼저 보인다.',
  directions: ['입금이 쌓이는 타임라인 한 줄을 화면 가운데 두는 구성', '청구서 한 장을 펼쳐 놓고 그 위에 입금 도장이 찍히는 구성'],
  firstScreen: { primaryElement: '가장 오래 밀린 청구서 한 건', interactiveAction: '청구서를 눌러 바로 독촉 문자를 보낸다', livingVisual: '고객 12곳의 실제 미결제 기록으로 채운 목록' },
  anchors: [
    { category: 'layout' as const, referenceObserved: '왼쪽 목록과 오른쪽 상세 패널', derivedPrinciple: '가장 급한 것이 가장 크다', ourValueAndSource: '연체 일수 순으로 한 줄씩: 독촉은 오래된 것부터 하니까' },
    { category: 'typography' as const, referenceObserved: '모든 금액이 같은 크기', derivedPrinciple: '숫자에 위계를 준다', ourValueAndSource: '연체 일수를 금액보다 한 단계 크게' },
    { category: 'color' as const, referenceObserved: '상태마다 다른 색 배지', derivedPrinciple: '색은 한 가지 뜻만 가진다', ourValueAndSource: '강조색은 연체에만' },
  ],
  retainedPrinciples: ['급한 것이 크다', '색은 연체에만', '한 화면에 한 가지 일'],
  discardedDefaults: ['왼쪽 목록-오른쪽 카드'],
  strictlyExcluded: [],
};

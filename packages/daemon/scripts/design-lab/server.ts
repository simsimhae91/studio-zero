// The design lab's check_mockup: the studio's own measurement of one mock-up page (MockupRenderer.check, the
// real walk, the real audit checks, a local Chrome), answered over a loopback URL so that an agent standing in
// for a direction engine can call it the way the engine calls the tool. Every call is kept: the page as it
// stood, what it was told, and the findings, so a run shows the first draft and each correction after it.
//
//   node server.ts <port>
//   GET /check?ws=<workspace dir>&file=docs/mockups/a.html
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, normalize } from 'node:path';
import { chromium, devices } from 'playwright-core';
import type { Project, Template } from '@studio-zero/protocol';
import { MockupRenderer, renderMockupCheck } from '../../src/qa/MockupRenderer.ts';
import type { QaBrowser, QaSession } from '../../src/qa/QaBrowser.ts';
import type { QaVisionBridge } from '../../src/qa/QaVisionBridge.ts';
import { VisualAuditor } from '../../src/qa/VisualAuditor.ts';
import type { OrbStackManager } from '../../src/sandbox/OrbStackManager.ts';
import { quietLog, testDaemon } from '../../test/helpers.ts';

const port = Number(process.argv[2] ?? 47811);
const browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 30_000 });
const d = await testDaemon();
const { store, events, studio } = d.daemon;
const localBrowser = { use: async <T>(_project: Project, _signal: AbortSignal | undefined, fn: (session: QaSession) => Promise<T>) => fn({ browser, host: '127.0.0.1', devices } as unknown as QaSession) } as unknown as QaBrowser;
const vision = { availability: async () => ({ status: 'off', paths: [], reason: 'the lab asks no reviewer' }), review: async () => Promise.reject(new Error('no reviewer is asked by a check')) } as unknown as QaVisionBridge;
const auditor = new VisualAuditor({ config: d.config, store, events, browser: localBrowser, vision, clock: () => Date.now(), log: quietLog });
const projects = new Map<string, Project>();
const projectFor = (template: Template): Project => {
  let project = projects.get(template);
  if (!project) {
    project = studio.createProject({ type: 'owner', via: 'desktop' }, { name: `Lab ${template}`, slug: `lab-${template}`, template });
    projects.set(template, project);
  }
  return project;
};

/** A workspace on disk, behind the two calls the renderer makes of a sandbox. */
function sandboxOver(ws: string): OrbStackManager {
  const inside = (path: string): string | null => {
    const full = normalize(join(ws, path));
    return full.startsWith(`${normalize(ws)}/`) && existsSync(full) && statSync(full).isFile() ? full : null;
  };
  return {
    exec: async (_project: Project, script: string) => {
      const file = /\[ -f (\S+) \]/.exec(script)?.[1];
      const full = file ? inside(file) : null;
      if (!full) return { exitCode: 1, stdout: '', stderr: '', timedOut: false, durationMs: 1 };
      const stdout = script.includes('base64') ? readFileSync(full).toString('base64') : readFileSync(full, 'utf8');
      return { exitCode: 0, stdout, stderr: '', timedOut: false, durationMs: 1 };
    },
    readFile: async (_project: Project, path: string) => {
      const full = inside(path);
      if (!full) throw new Error(`no such file: ${path}`);
      return { content: readFileSync(full, 'utf8'), truncated: false };
    },
  } as unknown as OrbStackManager;
}

// A few pages at a time: each check opens several contexts in the one browser.
let running = 0;
const waiting: (() => void)[] = [];
const slot = async (): Promise<void> => {
  if (running >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
};
const release = (): void => {
  running -= 1;
  waiting.shift()?.();
};

async function check(ws: string, file: string): Promise<string> {
  const template = readFileSync(join(ws, '.lab-template'), 'utf8').trim() as Template;
  const renderer = new MockupRenderer({ config: d.config, store, clock: Date.now, log: quietLog, browser: localBrowser, sandboxes: sandboxOver(ws), auditor });
  const started = Date.now();
  const result = await renderer.check(projectFor(template), file);
  // What the check_mockup tool says in each case (harness/Toolbox.ts).
  const text = result.status === 'missing' ? `${file} does not exist, or is empty.` : result.status === 'not-drawn' ? 'The studio could not open the page this time (its browser did not answer). That says nothing about the page; carry on, it is measured when you stop.' : renderMockupCheck(file, result);
  const log = join(dirname(ws), 'checks');
  mkdirSync(log, { recursive: true });
  const n = readdirSync(log).filter((name) => name.endsWith('.txt')).length + 1;
  const page = join(ws, file);
  if (existsSync(page)) writeFileSync(join(log, `${n}.html`), readFileSync(page));
  writeFileSync(join(log, `${n}.txt`), text);
  writeFileSync(join(log, `${n}.json`), JSON.stringify({ at: new Date().toISOString(), tookMs: Date.now() - started, status: result.status, ...(result.status === 'measured' ? { findings: result.findings, flowProblems: result.flowProblems, specProblems: result.specProblems, flow: result.option.flow, measures: result.option.measures } : {}) }, null, 1));
  return text;
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/health') return void res.writeHead(200).end('ok\n');
  if (url.pathname !== '/check') return void res.writeHead(404).end('not found\n');
  const ws = url.searchParams.get('ws') ?? '';
  const file = url.searchParams.get('file') ?? '';
  if (!ws || !existsSync(join(ws, '.lab-template')) || !/^docs\/mockups\/[abc]\.html$/.test(file)) return void res.writeHead(400).end('give ws (a lab workspace) and file (docs/mockups/a.html, b.html or c.html)\n');
  void slot()
    .then(() => check(ws, file))
    .then((text) => res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(`${text}\n`), (err: unknown) => res.writeHead(500).end(`the check failed in the lab itself, not in the page: ${err instanceof Error ? err.message : String(err)}\n`))
    .finally(release);
}).listen(port, '127.0.0.1', () => process.stdout.write(`design lab check server on http://127.0.0.1:${port}\n`));

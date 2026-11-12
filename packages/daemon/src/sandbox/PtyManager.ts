import { request, type ClientRequest, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import type { Project } from '@studio-zero/protocol';
import { ConflictError, NotFoundError } from '../app/errors.ts';
import { WORKSPACE_DIR } from '../policy/PolicyEngine.ts';
import { errorMessage, newId, type Logger } from '../util/core.ts';
import { SandboxError, sandboxNames, type OrbStackManager } from './OrbStackManager.ts';
import { stopTerminalScript, terminalShellScript } from './scripts.ts';

/** uid:gid a terminal's shell runs as: the same unprivileged user as everything else in the sandbox. */
const TERMINAL_USER = '1000:1000';
const MAX_TERMINALS_PER_OWNER = 8;
const CONGESTION_POLL_MS = 40;

export interface PtyRequest {
  container: string;
  cols: number;
  rows: number;
  /** argv of the process to run on the pseudo-terminal. */
  command: string[];
}

/** One process on a pseudo-terminal inside a container: a byte stream both ways, and a way to tell it its size. */
export interface PtyTransport {
  stream: Duplex;
  resize(cols: number, rows: number): Promise<void>;
  /** The process's exit code, once the stream has ended. null when it cannot be known. */
  exitCode(): Promise<number | null>;
}

export type PtyOpen = (endpoint: string, req: PtyRequest) => Promise<PtyTransport>;

/** Where terminal output goes. Implemented by the control socket of the client that opened the terminal. */
export interface TerminalSink {
  output(terminalId: string, data: string): void;
  exit(terminalId: string, exitCode: number | null, reason: string): void;
  /** True while the client is not keeping up. The terminal stops reading from the shell until it is false again. */
  congested(): boolean;
}

interface Terminal {
  id: string;
  owner: string;
  project: Project;
  /** The pid-file name inside the sandbox (see `terminalShellScript`). */
  name: string;
  transport: PtyTransport;
  sink: TerminalSink;
  poll: NodeJS.Timeout | null;
  ended: boolean;
}

/**
 * Interactive terminals: a login shell per terminal, on a real pseudo-terminal inside the project's sandbox,
 * wired to the control socket of the client that opened it.
 *
 * The shell runs where every agent command runs: in the container, as the unprivileged sandbox user, with no
 * host mount and no provider key. What the owner types here can do exactly what an agent's `bash` tool can do,
 * and nothing on the host.
 *
 * A terminal belongs to one `owner` (one client connection). Only that owner can write to it, resize it or
 * kill it, and all of an owner's terminals die with the connection.
 */
export class PtyManager {
  readonly #sandboxes: OrbStackManager;
  readonly #open: PtyOpen;
  readonly #log: Logger;
  readonly #terminals = new Map<string, Terminal>();

  constructor(deps: { sandboxes: OrbStackManager; log: Logger; open?: PtyOpen }) {
    this.#sandboxes = deps.sandboxes;
    this.#open = deps.open ?? dockerExecPty;
    this.#log = deps.log;
  }

  /** Starts a shell in the project's sandbox. The sandbox must already be running. */
  async spawn(project: Project, size: { cols: number; rows: number }, owner: string, sink: TerminalSink): Promise<string> {
    if ([...this.#terminals.values()].filter((t) => t.owner === owner).length >= MAX_TERMINALS_PER_OWNER) {
      throw new ConflictError(`this client already has ${MAX_TERMINALS_PER_OWNER} terminals open`);
    }
    const id = newId('trm');
    const name = `term-${id.slice(-12)}`;
    let transport: PtyTransport;
    try {
      transport = await this.#open(await this.#sandboxes.engineEndpoint(), {
        container: sandboxNames(project.slug).container,
        cols: size.cols,
        rows: size.rows,
        command: ['sh', '-c', terminalShellScript(name)],
      });
    } catch (err) {
      throw err instanceof SandboxError ? err : new SandboxError('could not open a terminal in the sandbox', errorMessage(err));
    }

    const terminal: Terminal = { id, owner, project, name, transport, sink, poll: null, ended: false };
    this.#terminals.set(id, terminal);
    // A multi-byte character can straddle two chunks; the decoder holds the first half until the rest arrives.
    const decoder = new StringDecoder('utf8');
    transport.stream.on('data', (chunk: Buffer) => {
      const text = decoder.write(chunk);
      if (text !== '') sink.output(id, text);
      if (terminal.poll === null && sink.congested()) {
        transport.stream.pause();
        terminal.poll = setInterval(() => {
          if (sink.congested()) return;
          clearInterval(terminal.poll!);
          terminal.poll = null;
          transport.stream.resume();
        }, CONGESTION_POLL_MS);
      }
    });
    transport.stream.on('error', (err: Error) => this.#log.debug({ terminalId: id, err: errorMessage(err) }, 'terminal stream error'));
    transport.stream.on('close', () => {
      const rest = decoder.end();
      if (rest !== '' && !terminal.ended) sink.output(id, rest);
      void transport
        .exitCode()
        .catch(() => null)
        .then((code) => this.#end(terminal, code, 'exited'));
    });
    return id;
  }

  /** Keystrokes from the client. Silently dropped for a terminal that is gone or that belongs to someone else. */
  write(owner: string, terminalId: string, data: string): void {
    const terminal = this.#terminals.get(terminalId);
    if (!terminal || terminal.owner !== owner || terminal.ended) return;
    terminal.transport.stream.write(data, 'utf8');
  }

  async resize(owner: string, terminalId: string, cols: number, rows: number): Promise<void> {
    await this.#owned(owner, terminalId).transport.resize(cols, rows);
  }

  async kill(owner: string, terminalId: string): Promise<boolean> {
    const terminal = this.#terminals.get(terminalId);
    if (!terminal || terminal.owner !== owner) return false;
    await this.#kill(terminal, 'killed');
    return true;
  }

  /** The client went away: nothing is left to read these terminals, so they end. */
  async closeOwner(owner: string): Promise<void> {
    await Promise.all([...this.#terminals.values()].filter((t) => t.owner === owner).map((t) => this.#kill(t, 'client disconnected')));
  }

  /** Before a sandbox is stopped, recreated or deleted. */
  async closeProject(projectId: string): Promise<void> {
    await Promise.all([...this.#terminals.values()].filter((t) => t.project.id === projectId).map((t) => this.#kill(t, 'sandbox is going away')));
  }

  async stop(): Promise<void> {
    await Promise.all([...this.#terminals.values()].map((t) => this.#kill(t, 'daemon shutting down')));
  }

  count(): number {
    return this.#terminals.size;
  }

  #owned(owner: string, terminalId: string): Terminal {
    const terminal = this.#terminals.get(terminalId);
    if (!terminal || terminal.owner !== owner) throw new NotFoundError(`terminal ${terminalId}`);
    return terminal;
  }

  async #kill(terminal: Terminal, reason: string): Promise<void> {
    if (terminal.ended) return;
    this.#end(terminal, null, reason);
    terminal.transport.stream.destroy();
    // Closing the stream does not end the shell: the engine keeps an exec'd process alive when its client goes.
    // The shell recorded its pid when it started, so it (and its jobs) can be ended from inside the container.
    await this.#sandboxes.exec(terminal.project, stopTerminalScript(terminal.name), { timeoutSec: 10 }).catch((err: unknown) => {
      this.#log.debug({ terminalId: terminal.id, err: errorMessage(err) }, 'could not stop the terminal shell (the sandbox may be gone)');
    });
  }

  #end(terminal: Terminal, exitCode: number | null, reason: string): void {
    if (terminal.ended) return;
    terminal.ended = true;
    if (terminal.poll) clearInterval(terminal.poll);
    this.#terminals.delete(terminal.id);
    try {
      terminal.sink.exit(terminal.id, exitCode, reason);
    } catch {
      // A closed socket must not turn a terminal's end into an unhandled error.
    }
  }
}

// ------------------------------------------------------------- engine API

interface EngineAddress {
  socketPath?: string;
  host?: string;
  port?: number;
}

function engineAddress(endpoint: string): EngineAddress {
  if (endpoint.startsWith('unix://')) return { socketPath: endpoint.slice('unix://'.length) };
  const url = new URL(endpoint.replace(/^tcp:/, 'http:'));
  if (url.protocol !== 'http:') throw new SandboxError(`unsupported container engine endpoint: ${endpoint}`);
  return { host: url.hostname, port: Number(url.port || 2375) };
}

/** One JSON request to the engine API. */
function engineCall(address: EngineAddress, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request({ ...address, method, path, headers: payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }, timeout: 15_000 }, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown = null;
        try {
          json = text === '' ? null : JSON.parse(text);
        } catch {
          json = { message: text.slice(0, 300) };
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('the container engine did not answer')));
    req.on('error', reject);
    req.end(payload);
  });
}

const engineMessage = (json: unknown): string => (typeof json === 'object' && json !== null && typeof (json as { message?: unknown }).message === 'string' ? (json as { message: string }).message : 'no detail');

/**
 * `docker exec -it`, without the `docker` program: the same three calls it makes to the engine API.
 *
 *   POST /containers/{name}/exec   create an exec with a TTY
 *   POST /exec/{id}/start          upgrade the connection to a raw byte stream, the terminal itself
 *   POST /exec/{id}/resize         tell the TTY its size
 *
 * The command line cannot do this from a daemon: with `-t` it insists on a terminal on its own side, and
 * without it the shell has none (no prompt, no job control, no full-screen programs).
 */
export const dockerExecPty: PtyOpen = async (endpoint, req) => {
  const address = engineAddress(endpoint);
  const created = await engineCall(address, 'POST', `/containers/${encodeURIComponent(req.container)}/exec`, {
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    User: TERMINAL_USER,
    WorkingDir: WORKSPACE_DIR,
    Env: ['TERM=xterm-256color', 'COLORTERM=truecolor', 'LANG=C.UTF-8'],
    Cmd: req.command,
  });
  const execId = typeof created.json === 'object' && created.json !== null ? (created.json as { Id?: unknown }).Id : undefined;
  if (created.status !== 201 || typeof execId !== 'string') {
    throw new SandboxError(created.status === 404 || created.status === 409 ? `sandbox ${req.container} is not running` : 'the container engine refused to create a terminal', engineMessage(created.json));
  }

  const stream = await new Promise<Duplex>((resolve, reject) => {
    const payload = JSON.stringify({ Detach: false, Tty: true });
    const start: ClientRequest = request({
      ...address,
      method: 'POST',
      path: `/exec/${execId}/start`,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), connection: 'Upgrade', upgrade: 'tcp' },
    });
    // An engine that accepts the connection and then says nothing must not leave the caller waiting forever.
    start.setTimeout(15_000, () => start.destroy(new Error('the container engine did not open a terminal stream in time')));
    start.on('upgrade', (_res, socket, head) => {
      socket.setTimeout(0); // from here on silence is normal: it is a terminal nobody is typing into
      if (head.length > 0) socket.unshift(head);
      resolve(socket);
    });
    start.on('response', (res) => {
      res.resume();
      reject(new SandboxError('the container engine did not open a terminal stream', `HTTP ${res.statusCode}`));
    });
    start.on('error', reject);
    start.end(payload);
  });

  const resize = async (cols: number, rows: number): Promise<void> => {
    const res = await engineCall(address, 'POST', `/exec/${execId}/resize?h=${rows}&w=${cols}`);
    // An exec that has already ended cannot be resized; that is not worth an error on the client.
    if (res.status >= 400 && res.status !== 404 && res.status !== 409) throw new SandboxError('could not resize the terminal', engineMessage(res.json));
  };
  // The size is set once the stream is open: older engines ignore a size given at creation.
  await resize(req.cols, req.rows).catch(() => undefined);

  return {
    stream,
    resize,
    exitCode: async () => {
      const res = await engineCall(address, 'GET', `/exec/${execId}/json`);
      const code = typeof res.json === 'object' && res.json !== null ? (res.json as { ExitCode?: unknown }).ExitCode : null;
      return typeof code === 'number' ? code : null;
    },
  };
};

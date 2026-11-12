import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';

export interface AcpRequest {
  file: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** MCP servers for this session only. Nothing is written to the agent's saved configuration. */
  mcpServers: { name: string; command: string; args: string[]; env: Record<string, string> }[];
  prompt: string;
  /** Pictures sent with the prompt, as image content blocks. Only for an agent whose `promptCapabilities.image` is true. */
  images?: { mimeType: string; data: string }[];
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface AcpResult {
  text: string;
  stopReason: string;
}

export class AcpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcpError';
  }
}

const Message = z.object({ id: z.union([z.number(), z.string()]).optional(), method: z.string().optional(), params: z.unknown().optional(), result: z.unknown().optional(), error: z.object({ message: z.string() }).optional() });
const Chunk = z.object({ update: z.object({ sessionUpdate: z.literal('agent_message_chunk'), content: z.object({ type: z.literal('text'), text: z.string() }) }) });
const Permission = z.object({ options: z.array(z.object({ optionId: z.string(), kind: z.string() })) });

/**
 * One prompt to an agent CLI over the Agent Client Protocol (JSON-RPC, one message per line, on stdio):
 * initialize → session/new (with this session's MCP servers) → session/prompt → collect the reply → stop the process.
 *
 * This client offers the agent nothing of its own: no file system and no terminal capability. When the agent asks
 * for permission to use a tool it is granted, because what a tool can reach is not decided here; it is decided
 * by the jail the process runs in and by the daemon behind the MCP server.
 * Checked against `agy acp` 1.5.6 and `cursor-agent acp` 2026.11.11.
 */
export function acpPrompt(req: AcpRequest): Promise<AcpResult> {
  return new Promise<AcpResult>((resolve, reject) => {
    const child = spawn(req.file, [...req.args], { cwd: req.cwd, env: req.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
    let nextId = 0;
    let text = '';
    let stderr = '';
    let settled = false;

    const finish = (err: Error | null, result?: AcpResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
      child.kill('SIGTERM');
      if (err) reject(err);
      else resolve(result!);
    };
    const onAbort = (): void => finish(new AcpError('cancelled'));
    const timer = setTimeout(() => finish(new AcpError(`the agent did not finish within ${Math.round(req.timeoutMs / 1000)}s`)), req.timeoutMs);
    req.signal?.addEventListener('abort', onAbort, { once: true });

    const write = (message: object): void => void child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    const call = (method: string, params: unknown): Promise<unknown> =>
      new Promise((ok, fail) => {
        const id = ++nextId;
        pending.set(id, { resolve: ok, reject: fail });
        write({ id, method, params });
      });

    createInterface({ input: child.stdout }).on('line', (line) => {
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        return; // not protocol: a log line some agents print on stdout
      }
      const message = Message.safeParse(json);
      if (!message.success) return;
      const m = message.data;
      if (m.method === undefined) {
        const waiter = typeof m.id === 'number' ? pending.get(m.id) : undefined;
        if (!waiter) return;
        pending.delete(m.id as number);
        if (m.error) waiter.reject(new AcpError(m.error.message));
        else waiter.resolve(m.result);
        return;
      }
      if (m.method === 'session/update') {
        const chunk = Chunk.safeParse(m.params);
        if (chunk.success) text += chunk.data.update.content.text;
        return;
      }
      if (m.id === undefined) return; // other notifications
      if (m.method === 'session/request_permission') {
        const asked = Permission.safeParse(m.params);
        const allow = asked.success ? (asked.data.options.find((o) => o.kind === 'allow_once') ?? asked.data.options.find((o) => o.kind.startsWith('allow'))) : undefined;
        write({ id: m.id, result: { outcome: allow ? { outcome: 'selected', optionId: allow.optionId } : { outcome: 'cancelled' } } });
        return;
      }
      // File system and terminal requests: this client declared neither capability.
      write({ id: m.id, error: { code: -32601, message: `${m.method} is not offered by this client` } });
    });
    child.stderr.on('data', (chunk: Buffer) => void (stderr = (stderr + chunk.toString()).slice(-2000)));
    child.on('error', (err) => finish(new AcpError(`could not start the agent: ${err.message}`)));
    child.on('exit', (code) => finish(new AcpError(`the agent exited (${code ?? 'signal'}) before answering. ${stderr.trim().slice(-400)}`)));

    void (async () => {
      await call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'studio-zero', version: '0.1.0' } });
      const session = z.object({ sessionId: z.string() }).parse(await call('session/new', { cwd: req.cwd, mcpServers: req.mcpServers.map((s) => ({ name: s.name, command: s.command, args: s.args, env: Object.entries(s.env).map(([name, value]) => ({ name, value })) })) }));
      const done = z.object({ stopReason: z.string() }).parse(await call('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: req.prompt }, ...(req.images ?? []).map((image) => ({ type: 'image', mimeType: image.mimeType, data: image.data }))] }));
      finish(null, { text: text.trim(), stopReason: done.stopReason });
    })().catch((err: unknown) => finish(err instanceof Error ? err : new AcpError(String(err))));
  });
}

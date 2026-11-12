#!/usr/bin/env node
/**
 * Stdio MCP server that a bridged vendor CLI (Claude Code, Codex) launches as its only tool provider.
 * It holds no logic and no authority: `tools/list` and `tools/call` are forwarded to the daemon over loopback
 * with a task-scoped bearer token, and the daemon's Toolbox runs them through the PolicyEngine in the sandbox.
 *
 * Standalone by design (Node built-ins only) because the vendor CLI starts it as `node mcpShim.ts`.
 * Transport: MCP stdio, one JSON-RPC 2.0 message per line.
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const bridgeUrl = process.env.SZ_BRIDGE_URL;
const tokenFile = process.env.SZ_BRIDGE_TOKEN_FILE;
if (!bridgeUrl || !tokenFile) {
  process.stderr.write('studio-zero mcp shim: SZ_BRIDGE_URL and SZ_BRIDGE_TOKEN_FILE are required\n');
  process.exit(2);
}
const token = readFileSync(tokenFile, 'utf8').trim();

type Id = string | number;
interface Request {
  jsonrpc: '2.0';
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}

function reply(id: Id, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function fail(id: Id, code: number, message: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

async function daemon(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`daemon answered ${res.status}`);
  return res.json();
}

async function handle(req: Request): Promise<void> {
  if (req.id === undefined) return; // notifications (e.g. notifications/initialized) get no response
  try {
    switch (req.method) {
      case 'initialize':
        return reply(req.id, {
          protocolVersion: typeof req.params?.protocolVersion === 'string' ? req.params.protocolVersion : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'studio-zero', version: '0.1.0' },
        });
      case 'ping':
        return reply(req.id, {});
      case 'tools/list':
        return reply(req.id, await daemon('/tools'));
      case 'tools/call':
        return reply(req.id, await daemon('/call', { name: req.params?.name, arguments: req.params?.arguments ?? {} }));
      default:
        return fail(req.id, -32601, `method not found: ${req.method}`);
    }
  } catch (err) {
    fail(req.id, -32603, err instanceof Error ? err.message : 'internal error');
  }
}

let chain: Promise<void> = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return;
  let req: Request;
  try {
    req = JSON.parse(line) as Request;
  } catch {
    return;
  }
  // Tool calls act on one working tree, so they are answered strictly in arrival order.
  chain = chain.then(() => handle(req));
});

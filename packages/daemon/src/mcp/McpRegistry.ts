import type { McpServerInfo } from '@studio-zero/protocol';
import { ConflictError, NotFoundError } from '../app/errors.ts';
import type { McpServerRow, Store } from '../db/Store.ts';
import type { Actor } from '../policy/actions.ts';
import type { AuthorizeContext, PolicyEngine } from '../policy/PolicyEngine.ts';
import type { KeychainVault } from '../vault/KeychainVault.ts';
import { errorMessage, excerpt, type Clock, type Secret } from '../util/core.ts';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** One connection to a tool server. Implemented with the MCP SDK in production and by a fake in unit tests. */
export interface McpSession {
  listTools(signal?: AbortSignal): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; isError: boolean }>;
  close(): Promise<void>;
}
export type McpConnect = (server: { id: string; url: string }, token: Secret | null) => Promise<McpSession>;

/**
 * Tool servers the daemon knows without being told. Addresses are the vendors' own hosted endpoints (checked
 * against their documentation on 2026-11-12); a token stored for one of these is only ever sent to that address.
 * Servers that sign in with OAuth are listed so discovery can say why they cannot be used yet.
 */
export const CATALOG: readonly Omit<McpServerRow, 'builtin' | 'addedAt'>[] = [
  { id: 'github', name: 'GitHub', url: 'https://api.githubcopilot.com/mcp/', auth: 'bearer', about: 'Repositories, issues, pull requests, code search and Actions. Token: a GitHub personal access token.' },
  { id: 'stripe', name: 'Stripe', url: 'https://mcp.stripe.com', auth: 'bearer', about: 'Customers, products, prices, invoices, payment links and Stripe documentation search. Token: a restricted Stripe API key.' },
  { id: 'notion', name: 'Notion', url: 'https://mcp.notion.com/mcp', auth: 'oauth', about: 'Pages, databases and comments.' },
  { id: 'figma', name: 'Figma', url: 'https://mcp.figma.com/mcp', auth: 'oauth', about: 'Design files, components and variables.' },
];

export const credentialIdFor = (serverId: string): string => `mcp/${serverId}/token`;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A tool server address the owner typed. TLS is required, except for a server on this machine. */
export function parseServerUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) return { ok: false, reason: 'the address must be https:// (http:// only for a server on this machine)' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'addresses with embedded credentials are rejected; store the token in the vault' };
  if (url.hash !== '') return { ok: false, reason: 'the address must not carry a fragment' };
  return { ok: true, url: url.toString() };
}

const TOOLS_TTL_MS = 10 * 60 * 1000;
const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9가-힣]+/).filter((w) => w.length > 1);

/**
 * Just-in-time tooling. The daemon is the MCP client: an agent asks it what tools exist for a need
 * (`search`) and asks it to make a call (`call`). The call happens here, on the host, with a credential from
 * the Keychain, so neither the token nor a connection to the outside ever belongs to the sandbox or the model.
 *
 * What an agent may reach is decided by the PolicyEngine: each tool, per project, needs the owner's approval
 * the first time, and that approval is a row in the database from then on.
 */
export class McpRegistry {
  readonly #store: Store;
  readonly #vault: KeychainVault;
  readonly #policy: PolicyEngine;
  readonly #clock: Clock;
  readonly #connect: McpConnect;
  readonly #tools = new Map<string, { at: number; tools: McpTool[] }>();

  constructor(deps: { store: Store; vault: KeychainVault; policy: PolicyEngine; clock: Clock; connect?: McpConnect }) {
    this.#store = deps.store;
    this.#vault = deps.vault;
    this.#policy = deps.policy;
    this.#clock = deps.clock;
    this.#connect = deps.connect ?? sdkConnect;
  }

  /** Writes the catalog into the database, where the policy rules read it. Owner-added servers are left alone. */
  seed(): void {
    for (const entry of CATALOG) this.#store.upsertBuiltinMcpServer(entry, this.#clock());
  }

  list(): McpServerInfo[] {
    return this.#store.listMcpServers().map((server) => this.#info(server));
  }

  async add(actor: Actor, p: { id: string; name: string; url: string; auth: 'bearer' | 'none'; about: string }): Promise<McpServerInfo> {
    await this.#policy.authorize(actor, { kind: 'mcp.configure', serverId: p.id, op: 'add' });
    if (this.#store.getMcpServer(p.id)) throw new ConflictError(`a tool server with id "${p.id}" already exists`);
    const parsed = parseServerUrl(p.url);
    if (!parsed.ok) throw new ConflictError(parsed.reason);
    this.#store.insertMcpServer({ ...p, url: parsed.url, builtin: false, addedAt: this.#clock() });
    return this.#info(this.#store.getMcpServer(p.id)!);
  }

  /** Removes an owner-added server together with everything that was allowed on it. */
  async remove(actor: Actor, serverId: string): Promise<void> {
    await this.#policy.authorize(actor, { kind: 'mcp.configure', serverId, op: 'remove' });
    const server = this.#store.getMcpServer(serverId);
    if (!server) throw new NotFoundError(`tool server ${serverId}`);
    if (server.builtin) throw new ConflictError('a catalog server cannot be removed; delete its token to switch it off');
    this.#store.deleteMcpServer(serverId);
    this.#tools.delete(serverId);
  }

  /** Takes back what was allowed on a server for one project. The next use asks again. */
  async revoke(actor: Actor, serverId: string, projectId: string): Promise<number> {
    await this.#policy.authorize(actor, { kind: 'mcp.configure', serverId, op: 'revoke' });
    return this.#store.revokeMcpGrants(serverId, projectId);
  }

  /**
   * Discovery, as text for an agent. Matching is by words against server and tool descriptions. Only servers
   * that can be used right now are contacted, and what they say about their tools is third-party text: the
   * caller hands it to the model as data.
   */
  async search(query: string, signal?: AbortSignal): Promise<string> {
    const wanted = words(query);
    const score = (text: string): number => {
      const have = new Set(words(text));
      return wanted.filter((w) => have.has(w) || [...have].some((h) => h.startsWith(w) || w.startsWith(h))).length;
    };
    const lines: string[] = [];
    for (const server of this.#store.listMcpServers()) {
      const info = this.#info(server);
      const head = `${server.id} (${server.name}): ${server.about}`;
      if (info.state !== 'ready') {
        lines.push(`${head}\n  not usable now: ${info.state === 'unsupported' ? 'it signs in with OAuth, which this daemon does not do yet' : `no token stored; the owner can add one in Settings (credential ${info.credentialId})`}`);
        continue;
      }
      let tools: McpTool[];
      try {
        tools = await this.#toolsOf(server, signal);
      } catch (err) {
        lines.push(`${head}\n  could not be reached: ${errorMessage(err).slice(0, 200)}`);
        continue;
      }
      const serverHit = score(`${server.id} ${server.name} ${server.about}`) > 0;
      const ranked = tools.map((tool) => ({ tool, hits: score(`${tool.name.replaceAll('_', ' ')} ${tool.description}`) })).sort((a, b) => b.hits - a.hits);
      const shown = ranked.filter((r) => r.hits > 0).slice(0, 8);
      if (shown.length === 0 && !serverHit) {
        lines.push(`${head}\n  ready, ${tools.length} tools, none matching this query`);
        continue;
      }
      const listed = shown.length > 0 ? shown.map((r) => r.tool) : tools.slice(0, 8);
      lines.push(`${head}\n  ready. Tools${shown.length > 0 ? ' matching the query' : ''} (${listed.length} of ${tools.length}):\n${listed.map((t) => `  - ${t.name}: ${t.description.replace(/\s+/g, ' ').slice(0, 300)}\n    input: ${JSON.stringify(t.inputSchema).slice(0, 1200)}`).join('\n')}`);
    }
    return lines.length > 0 ? lines.join('\n\n') : 'No tool servers are configured.';
  }

  /**
   * One tool call on behalf of `actor`. Everything that can be checked without the owner is checked first, so an
   * approval prompt is only ever for a tool that exists on a server that can be reached.
   */
  async call(actor: Actor, ctx: AuthorizeContext & { projectId: string }, serverId: string, tool: string, args: Record<string, unknown>): Promise<{ text: string; ok: boolean }> {
    const server = this.#store.getMcpServer(serverId);
    if (!server) return { ok: false, text: `There is no tool server "${serverId}". Use find_tools to see what exists.` };
    const info = this.#info(server);
    if (info.state === 'unsupported') return { ok: false, text: `${server.name} signs in with OAuth, which this daemon does not do yet.` };
    if (info.state === 'needs-token') return { ok: false, text: `${server.name} has no token stored. Tell the owner to add one in Settings (credential ${info.credentialId}).` };
    let tools: McpTool[];
    try {
      tools = await this.#toolsOf(server, ctx.signal);
    } catch (err) {
      return { ok: false, text: `${server.name} could not be reached: ${errorMessage(err).slice(0, 300)}` };
    }
    if (!tools.some((t) => t.name === tool)) return { ok: false, text: `${server.name} has no tool named "${tool}". Use find_tools to see its tools.` };

    await this.#policy.authorize(actor, { kind: 'mcp.call', projectId: ctx.projectId, serverId, host: new URL(server.url).host, tool }, ctx);
    this.#store.grantMcpTool(ctx.projectId, serverId, tool, this.#clock());

    const session = await this.#open(server);
    try {
      const result = await session.callTool(tool, args, ctx.signal);
      return { ok: !result.isError, text: excerpt(result.text || '(the tool returned nothing)', 30_000) };
    } catch (err) {
      return { ok: false, text: `${server.name}.${tool} failed: ${errorMessage(err).slice(0, 500)}` };
    } finally {
      await session.close().catch(() => undefined);
    }
  }

  #info(server: McpServerRow): McpServerInfo {
    const credentialId = credentialIdFor(server.id);
    const stored = this.#store.hasCredential(credentialId);
    return {
      id: server.id,
      name: server.name,
      url: server.url,
      auth: server.auth,
      about: server.about,
      builtin: server.builtin,
      credentialId,
      state: server.auth === 'oauth' ? 'unsupported' : server.auth === 'bearer' && !stored ? 'needs-token' : 'ready',
      grants: this.#store.listMcpGrants(server.id),
    };
  }

  async #open(server: McpServerRow): Promise<McpSession> {
    const token = server.auth === 'bearer' ? await this.#vault.get(credentialIdFor(server.id)) : null;
    if (server.auth === 'bearer' && !token) throw new Error('the stored token could not be read from the Keychain');
    return this.#connect(server, token);
  }

  async #toolsOf(server: McpServerRow, signal?: AbortSignal): Promise<McpTool[]> {
    const cached = this.#tools.get(server.id);
    if (cached && this.#clock() - cached.at < TOOLS_TTL_MS) return cached.tools;
    const session = await this.#open(server);
    try {
      const tools = await session.listTools(signal);
      this.#tools.set(server.id, { at: this.#clock(), tools });
      return tools;
    } finally {
      await session.close().catch(() => undefined);
    }
  }
}

/** The real client: MCP over streamable HTTP. Loaded on first use, so a daemon that never calls a tool never pays for it. */
export const sdkConnect: McpConnect = async (server, token) => {
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([import('@modelcontextprotocol/sdk/client/index.js'), import('@modelcontextprotocol/sdk/client/streamableHttp.js')]);
  // The SDK follows redirects only within the server's own origin, so the token cannot be forwarded elsewhere.
  const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: token ? { authorization: `Bearer ${token.expose()}` } : {} } });
  const client = new Client({ name: 'studio-zero', version: '0.1.0' });
  await client.connect(transport, { timeout: 20_000 });
  return {
    listTools: async (signal) => {
      const tools: McpTool[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const res = await client.listTools(cursor ? { cursor } : undefined, { signal, timeout: 20_000 });
        tools.push(...res.tools.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema })));
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      return tools;
    },
    callTool: async (name, args, signal) => {
      const res = await client.callTool({ name, arguments: args }, undefined, { signal, timeout: 120_000 });
      const parts = Array.isArray(res.content) ? (res.content as { type: string; text?: string }[]) : [];
      const text = parts.map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : `[${part.type} content omitted]`)).join('\n');
      return { text: text || (res.structuredContent ? JSON.stringify(res.structuredContent) : ''), isError: res.isError === true };
    },
    close: () => client.close(),
  };
};

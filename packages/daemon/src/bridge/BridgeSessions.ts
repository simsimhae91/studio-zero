import { randomBytes } from 'node:crypto';
import { sha256Hex, type Clock } from '../util/core.ts';

/** What one bridged CLI process may call: a fixed set of tools, implemented in the daemon. */
export interface BridgeTools {
  definitions(): { name: string; description: string; inputSchema: Record<string, unknown> }[];
  call(name: string, args: unknown): Promise<{ content: string; isError: boolean }>;
}

/**
 * Short-lived bearer tokens for the MCP shim. A token maps to exactly one set of tools (a task's Toolbox, or the
 * tools of one scratchpad or research turn), lives only while the vendor CLI process runs, and grants nothing else.
 */
export class BridgeSessions {
  readonly #clock: Clock;
  readonly #sessions = new Map<string, { tools: BridgeTools; expiresAt: number }>();

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  create(tools: BridgeTools, ttlMs: number): string {
    const token = `szb_${randomBytes(24).toString('base64url')}`;
    this.#sessions.set(sha256Hex(token), { tools, expiresAt: this.#clock() + ttlMs });
    return token;
  }

  resolve(token: string): BridgeTools | null {
    const key = sha256Hex(token);
    const session = this.#sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= this.#clock()) {
      this.#sessions.delete(key);
      return null;
    }
    return session.tools;
  }

  revoke(token: string): void {
    this.#sessions.delete(sha256Hex(token));
  }
}

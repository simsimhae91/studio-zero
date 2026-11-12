import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The MCP shim next to this module: a sibling chunk in the production bundle, a source file in development. */
function locateShim(): string {
  const bundled = fileURLToPath(new URL('./mcpShim.mjs', import.meta.url));
  return existsSync(bundled) ? bundled : fileURLToPath(new URL('./mcpShim.ts', import.meta.url));
}
export const SHIM_PATH = locateShim();

/** The name vendor CLIs know the daemon's tools by. A tool `x` appears to a Claude-style CLI as `mcp__studio__x`. */
export const MCP_SERVER = 'studio';

/** The MCP server entry that points a vendor CLI at the daemon's shim for one bridge session. */
export function shimServer(bridgeUrl: string, tokenFile: string): { command: string; args: string[]; env: Record<string, string> } {
  return { command: process.execPath, args: [SHIM_PATH], env: { SZ_BRIDGE_URL: bridgeUrl, SZ_BRIDGE_TOKEN_FILE: tokenFile } };
}

/** Writes the session token and an `mcpServers` config naming only the shim. Returns the config path. */
export async function writeShimConfig(scratch: string, bridgeUrl: string, token: string): Promise<{ mcpConfig: string; tokenFile: string }> {
  const tokenFile = join(scratch, 'token');
  const mcpConfig = join(scratch, 'mcp.json');
  await writeFile(tokenFile, token, { mode: 0o600 });
  await writeFile(mcpConfig, JSON.stringify({ mcpServers: { [MCP_SERVER]: shimServer(bridgeUrl, tokenFile) } }), { mode: 0o600 });
  return { mcpConfig, tokenFile };
}

/** A vendor CLI gets a minimal environment: enough to find its own login, and no provider keys from ours. */
export function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', 'TERM']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return env;
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

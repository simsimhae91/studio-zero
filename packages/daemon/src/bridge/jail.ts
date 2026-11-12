import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { SHIM_PATH } from './cli.ts';

/** What one vendor CLI needs beyond the common set: its own state and its own binaries. Absolute paths. */
export interface JailRules {
  /** Folders it may read and write (its own configuration and session store). */
  own: string[];
  /** Folders or files it may execute from (its own install). */
  exec: string[];
  /** Files inside `own` that stay unreadable: the owner's saved MCP servers, which can carry tokens for other services. */
  hide?: string[];
}

export const JAIL_BIN = '/usr/bin/sandbox-exec';
export const jailAvailable = (): boolean => process.platform === 'darwin' && existsSync(JAIL_BIN);

const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};
const q = (path: string): string => JSON.stringify(path);
const subpaths = (paths: readonly string[]): string => paths.map((p) => `(subpath ${q(real(p))})`).join(' ');

/**
 * A macOS sandbox profile for a vendor CLI whose built-in tools cannot be switched off (Cursor, Antigravity).
 * Such a CLI keeps a shell tool and file tools; inside this profile they have nothing to work with:
 *
 * - **Reading.** The home directories, other volumes and temp folders are invisible, except the CLI's own
 *   state, the scratch folder, Node and the daemon's MCP shim. The Keychain files stay readable because that is
 *   where these CLIs keep their own login; they are encrypted, and every item is still guarded by its own ACL.
 * - **Writing.** Only the scratch folder and the CLI's own state.
 * - **Executing.** Only the CLI's own binaries, Node (for the shim) and `/usr/bin/security` (how these CLIs
 *   read their login). No shell can start, so a command an agent asks its terminal tool to run fails before it
 *   begins. Checked with real runs: the shell spawn fails with EPERM and a read of `~/.zshrc` is denied.
 *
 * What is left for the agent to act with is the one MCP server it is given, which is the daemon.
 * Residual risk, stated plainly: the CLI process itself may run `/usr/bin/security`, so a CLI that executed an
 * agent's command without a shell could read Keychain items that the `security` tool can read without a prompt.
 */
export function jailProfile(scratch: string, rules: JailRules): string {
  const node = process.execPath;
  const nodeRoot = dirname(dirname(real(node)));
  const common = [scratch, nodeRoot, dirname(SHIM_PATH)];
  // Node decides how to load a script from the package.json files above it, so the shim needs to see those.
  const packageFiles: string[] = [];
  for (let dir = dirname(SHIM_PATH); dir !== dirname(dir); dir = dirname(dir)) packageFiles.push(join(dir, 'package.json'));
  return [
    '(version 1)',
    '(allow default)',
    `(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/var/folders") (subpath "/private/tmp"))`,
    '(allow file-read-metadata)',
    `(allow file-read* ${subpaths([...common, join(homedir(), 'Library/Keychains'), ...rules.own, ...rules.exec])} ${packageFiles.map((file) => `(literal ${q(file)})`).join(' ')})`,
    '(deny file-write*)',
    `(allow file-write* ${subpaths([scratch, ...rules.own])} (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper") (subpath "/dev/fd"))`,
    '(deny process-exec*)',
    `(allow process-exec* (literal ${q(real(node))}) (literal "/usr/bin/security") ${subpaths(rules.exec)})`,
    // Last, so it wins over the allowances above.
    ...((rules.hide ?? []).length > 0 ? [`(deny file-read* ${rules.hide!.map((p) => `(literal ${q(real(p))})`).join(' ')})`] : []),
  ].join('\n');
}

/** The command line that runs `file` inside `profile`. */
export function jailed(profile: string, file: string, args: readonly string[]): { file: string; args: string[] } {
  return { file: JAIL_BIN, args: ['-p', profile, file, ...args] };
}

/** Finds an executable the way a shell would, without a shell. Returns its real path, or null. */
export function which(bin: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = bin.includes('/') ? [bin] : (env.PATH ?? '').split(':').filter(Boolean).map((dir) => join(dir, bin));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return realpathSync(candidate);
    } catch {
      // not here
    }
  }
  return null;
}

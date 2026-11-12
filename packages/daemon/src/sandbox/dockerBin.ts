import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile(); // follows symlinks, so a dangling link does not count
  } catch {
    return false;
  }
}

/**
 * Finds the docker CLI. A launchd job starts with a minimal PATH, and OrbStack ships its own docker client
 * inside the app bundle, so "docker" on PATH is tried first and the places OrbStack installs it are the fallback.
 * A configured value containing a slash is taken as an explicit path and used as is.
 */
export function resolveDockerBin(configured: string, env: NodeJS.ProcessEnv = process.env): string {
  if (configured.includes('/')) return configured;
  const onPath = (env.PATH ?? '').split(':').filter(Boolean).map((dir) => join(dir, configured));
  const known = [join(homedir(), '.orbstack/bin/docker'), '/Applications/OrbStack.app/Contents/MacOS/xbin/docker', '/usr/local/bin/docker', '/opt/homebrew/bin/docker'];
  return [...onPath, ...known].find(isExecutableFile) ?? configured;
}

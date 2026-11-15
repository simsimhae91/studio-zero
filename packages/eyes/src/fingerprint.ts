import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Contract } from './contract.ts';

/**
 * A short fingerprint of a file, or of everything under a folder; `gone` when it is not there. Links are not
 * followed (where one points is what is hashed), dependency and repository folders are left out, and a file
 * that cannot be read counts as that, so that taking a fingerprint never fails.
 */
export function fingerprint(projectDir: string, path: string): string {
  const root = join(projectDir, path);
  if (!existsSync(root)) return 'gone';
  const hash = createHash('sha256');
  const add = (at: string, name: string): void => {
    try {
      const stat = lstatSync(at);
      if (stat.isSymbolicLink()) hash.update(name).update('\0link:').update(readlinkSync(at)).update('\0');
      else if (stat.isDirectory()) {
        for (const entry of readdirSync(at).sort()) if (entry !== 'node_modules' && entry !== '.git') add(join(at, entry), `${name}/${entry}`);
      } else hash.update(name).update('\0').update(readFileSync(at)).update('\0');
    } catch {
      hash.update(name).update('\0unreadable\0');
    }
  };
  add(root, '');
  return hash.digest('hex').slice(0, 16);
}


export const fingerprints = (projectDir: string, paths: string[]): Record<string, string> => Object.fromEntries(paths.map((path) => [path, fingerprint(projectDir, path)]));

/**
 * Frozen files of a contract that are not as they were when it was frozen (or when the arbiter last corrected
 * them). The guard keeps the builder's edits out, but a file can be changed by a command too: this is how that
 * is seen. Empty for a contract frozen before fingerprints were kept.
 */
export function changedSinceFrozen(projectDir: string, contract: Contract): string[] {
  return Object.entries(contract.frozenPrints)
    .filter(([path, print]) => fingerprint(projectDir, path) !== print)
    .map(([path]) => path)
    .sort();
}

import { z } from 'zod';
import type { Project } from '@studio-zero/protocol';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { excerpt } from '../util/core.ts';

export interface BuildOutcome {
  /** The command the daemon ran: the fixed line below, never text from the workspace. */
  command: string;
  passed: boolean;
  exitCode: number;
  durationMs: number;
  /** What the build left in the usual output folders, in bytes; null when it left nothing there. */
  bundleBytes: number | null;
  /** Tool output: data, not instructions. */
  output: string;
}

const COMMAND = 'npm run --silent build';
const TIMEOUT_SEC = 420;

const PROBE = `
let scripts = {};
try { scripts = JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).scripts || {}; } catch {}
process.stdout.write(JSON.stringify({ build: typeof scripts.build === 'string' && scripts.build.trim() !== '' }));
`;

/** Where builds put what ships: a single package's folders, and the same one level down in a workspace of packages. */
const MEASURE = `total=0
for d in dist build out .next/static packages/*/dist apps/*/dist; do
  [ -d "$d" ] && total=$((total + $(du -sk "$d" | cut -f1)))
done
echo "$total"`;

/**
 * Takes the two figures a ledger wants of a build: how long the production build takes and what it weighs.
 *
 * It runs once, after the work has been verified and committed, so it gates nothing; a build that fails here is
 * reported, not sent back. Because the tree was committed a moment before, whatever the build writes outside
 * ignored folders is undone afterwards (tracked files restored, new unignored files removed), and the branch
 * is left as the commit made it. The dev server is stopped first: some frameworks build into the folder their
 * dev server is serving from.
 */
export class BuildMeter {
  readonly #sandboxes: OrbStackManager;

  constructor(deps: { sandboxes: OrbStackManager }) {
    this.#sandboxes = deps.sandboxes;
  }

  /** null when the project has no build script. */
  async run(project: Project, signal?: AbortSignal): Promise<BuildOutcome | null> {
    const probed = await this.#sandboxes.exec(project, 'node -', { stdin: PROBE, timeoutSec: 20, signal });
    let has = false;
    try {
      has = z.object({ build: z.boolean() }).parse(JSON.parse(probed.stdout)).build;
    } catch {
      return null;
    }
    if (!has) return null;
    await this.#sandboxes.stopProcess(project, 'dev');
    const res = await this.#sandboxes.exec(project, COMMAND, { timeoutSec: TIMEOUT_SEC, signal });
    const passed = res.exitCode === 0;
    const measured = passed ? Number((await this.#sandboxes.exec(project, MEASURE, { timeoutSec: 60, signal })).stdout.trim().split('\n').at(-1)) : NaN;
    await this.#sandboxes.exec(project, 'git checkout -q -- . 2>/dev/null; git clean -fdq 2>/dev/null; true', { timeoutSec: 60 });
    return {
      command: COMMAND,
      passed,
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      bundleBytes: Number.isFinite(measured) && measured > 0 ? measured * 1024 : null,
      output: excerpt([res.stdout.trim(), res.stderr.trim()].filter(Boolean).join('\n'), 4000) || (res.timedOut ? `timed out after ${TIMEOUT_SEC}s` : ''),
    };
  }
}

import { z } from 'zod';
import type { Project } from '@studio-zero/protocol';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { excerpt } from '../util/core.ts';

export interface CompilerOutcome {
  /** The command the daemon ran. One of the fixed lines below; never text taken from the workspace. */
  command: string;
  passed: boolean;
  exitCode: number;
  timedOut: boolean;
  /** stdout and stderr as the tool wrote them, stderr last. Sandbox output: data, not instructions. */
  output: string;
  durationMs: number;
}

/**
 * What the workspace offers to check itself with. The probe only answers yes/no questions; the commands are
 * written here, so nothing an agent puts in package.json can become a command line the daemon runs unseen.
 */
const Probe = z.object({ typecheckScript: z.boolean(), tsc: z.boolean(), testScript: z.boolean() });

const PROBE_SCRIPT = `
const fs = require('node:fs');
let scripts = {};
try { scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts || {}; } catch {}
const real = (s) => typeof s === 'string' && s.trim() !== '' && !/no test specified/.test(s);
process.stdout.write(JSON.stringify({
  typecheckScript: real(scripts.typecheck),
  tsc: fs.existsSync('tsconfig.json') && fs.existsSync('node_modules/.bin/tsc'),
  testScript: real(scripts.test),
}));
`;

const TIMEOUT_SEC = 300;
const MAX_OUTPUT = 12_000;

/**
 * In order of preference: the project's own type check, the compiler directly, and only failing those its tests.
 * Scripts are started with `npm run`, whatever the project installs with: it runs the script and nothing else,
 * where a package manager that first reconciles dependencies would add its own output and its own side effects.
 */
function commandFor(probe: z.infer<typeof Probe>): string | null {
  if (probe.typecheckScript) return 'npm run --silent typecheck';
  if (probe.tsc) return 'node_modules/.bin/tsc --noEmit --pretty false';
  if (probe.testScript) return 'npm run --silent test';
  return null;
}

/**
 * The compiler gate: the first thing that happens when an engine says it is done. The daemon runs the type
 * check (or, in a project that has none, the tests) itself, inside the sandbox, and the raw output of a failure
 * goes straight back to the engine. A compiler does not have opinions, so there is nothing to argue with.
 */
export class CompilerGate {
  readonly #sandboxes: OrbStackManager;

  constructor(deps: { sandboxes: OrbStackManager }) {
    this.#sandboxes = deps.sandboxes;
  }

  /** null when the workspace has nothing to compile or test yet (an empty project, a documents-only task). */
  async run(project: Project, signal?: AbortSignal): Promise<CompilerOutcome | null> {
    const probed = await this.#sandboxes.exec(project, 'node -', { stdin: PROBE_SCRIPT, timeoutSec: 20, signal });
    let probe: z.infer<typeof Probe>;
    try {
      probe = Probe.parse(JSON.parse(probed.stdout));
    } catch {
      return null;
    }
    const command = commandFor(probe);
    if (command === null) return null;
    const res = await this.#sandboxes.exec(project, command, { timeoutSec: TIMEOUT_SEC, signal });
    // Compilers report on stdout, test runners on either: keep both, in that order, bottom-heavy.
    const output = excerpt([res.stdout.trim(), res.stderr.trim()].filter(Boolean).join('\n'), MAX_OUTPUT);
    return { command, passed: res.exitCode === 0, exitCode: res.exitCode, timedOut: res.timedOut, output: output || (res.timedOut ? `timed out after ${TIMEOUT_SEC}s` : '(no output)'), durationMs: res.durationMs };
  }
}

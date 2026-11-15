import type { Project } from '@studio-zero/protocol';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { shq } from '../util/run.ts';
import type { ProjectFile } from './projectFile.ts';

const READY_TIMEOUT_SEC = 90;
/** Where a sandbox keeps the stamp of the workspace its dev server was started on. */
const STAMP_FILE = '/tmp/sz/dev.stamp';
/**
 * A workspace as one hash: every file git tracks or would track, by its content. Run in the workspace. Empty
 * output means it could not be taken, which is never "the same as before".
 */
const STAMP_SCRIPT = `git ls-files -co --exclude-standard -z 2>/dev/null | xargs -0 git hash-object 2>/dev/null | git hash-object --stdin 2>/dev/null || true`;

type Sandboxes = Pick<OrbStackManager, 'exec' | 'waitForHttp' | 'startProcess' | 'processLog'>;

/**
 * Makes the project's dev server answer on its port. With `reuse`, a server that is already answering is left
 * alone (the preview, or a check that follows another in the same round); without it the server is restarted,
 * so that what is verified is the code as it is now.
 *
 * `current` is for whoever is about to judge the product by what the server serves: a server that is answering
 * is reused only if the workspace is as it was when that server was started, and restarted otherwise. It has to
 * be asked, because a dev server cannot be trusted to follow its files: every sandbox sets CI=1, and under it
 * Metro says "reloads are disabled" and serves the bundle it first built for as long as it runs. The first
 * quick fixes on a real product (2026-11-15) were walked on a slot whose server had been up since before they
 * were made: the walk passed the old code, and five edits went onto main checked against what they had replaced.
 */
export async function ensureDevServer(sandboxes: Sandboxes, project: Project, file: ProjectFile, opts: { reuse: boolean; current?: boolean }): Promise<{ ready: boolean; log: string }> {
  const stamp = (await sandboxes.exec(project, STAMP_SCRIPT, { timeoutSec: 60 }).catch(() => null))?.stdout.trim() ?? '';
  if (opts.reuse && (await sandboxes.waitForHttp(project, file.dev.port, '/', 1))) {
    if (!opts.current) return { ready: true, log: '' };
    const startedOn = (await sandboxes.exec(project, `cat ${STAMP_FILE} 2>/dev/null || true`, { timeoutSec: 10 }).catch(() => null))?.stdout.trim() ?? '';
    if (stamp !== '' && startedOn === stamp) return { ready: true, log: '' };
  }
  await sandboxes.startProcess(project, 'dev', file.dev.command);
  const ready = await sandboxes.waitForHttp(project, file.dev.port, '/', READY_TIMEOUT_SEC);
  if (ready) await sandboxes.exec(project, `mkdir -p /tmp/sz && printf %s ${shq(stamp)} > ${STAMP_FILE}`, { timeoutSec: 10 }).catch(() => undefined);
  return { ready, log: ready ? '' : await sandboxes.processLog(project, 'dev') };
}

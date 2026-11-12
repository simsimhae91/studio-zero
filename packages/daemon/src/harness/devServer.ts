import type { Project } from '@studio-zero/protocol';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import type { ProjectFile } from './projectFile.ts';

const READY_TIMEOUT_SEC = 90;

/**
 * Makes the project's dev server answer on its port. With `reuse`, a server that is already answering is left
 * alone (the preview, or a check that follows another in the same round); without it the server is restarted,
 * so that what is verified is the code as it is now.
 */
export async function ensureDevServer(sandboxes: OrbStackManager, project: Project, file: ProjectFile, opts: { reuse: boolean }): Promise<{ ready: boolean; log: string }> {
  if (opts.reuse && (await sandboxes.waitForHttp(project, file.dev.port, '/', 1))) return { ready: true, log: '' };
  await sandboxes.startProcess(project, 'dev', file.dev.command);
  const ready = await sandboxes.waitForHttp(project, file.dev.port, '/', READY_TIMEOUT_SEC);
  return { ready, log: ready ? '' : await sandboxes.processLog(project, 'dev') };
}

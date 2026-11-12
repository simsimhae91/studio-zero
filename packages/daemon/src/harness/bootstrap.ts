import { createTheme, renderThemeCss, seedFromName } from '@studio-zero/design';
import type { Project, SandboxInfo } from '@studio-zero/protocol';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { KeyedMutex } from '../util/core.ts';
import { AX_DIR, AX_ENTRY, kitFiles } from './axKit.ts';
import { PROJECT_FILE, defaultProjectFile } from './projectFile.ts';
import { THEME_FILE } from './prompts.ts';

/**
 * Brings a project to the state every task assumes: sandbox running, /workspace a git repository, and the
 * Studio Zero files committed: the project's own theme (seeded from its slug so no two projects start from the
 * same palette), the runtime description the harness reads, and the AX kit, so an AI feature the project grows
 * gets the same interaction model the studio has instead of a chat box.
 *
 * Project creation provisions in the background and a task submitted right away provisions too, so calls for
 * one project are serialised here; the second caller waits and finds the work done.
 */
export class WorkspaceProvisioner {
  readonly #sandboxes: OrbStackManager;
  readonly #locks = new KeyedMutex();

  constructor(sandboxes: OrbStackManager) {
    this.#sandboxes = sandboxes;
  }

  ensure(project: Project): Promise<SandboxInfo> {
    return this.#locks.run(project.id, async () => {
      const info = await this.#sandboxes.ensure(project);
      // One round trip answers both questions; each file set is written only when it is missing.
      const present = await this.#sandboxes.exec(project, `test -f ${THEME_FILE} && echo theme; test -f ${AX_ENTRY} && echo kit; true`, { timeoutSec: 15 });
      const has = new Set(present.stdout.split('\n').map((line) => line.trim()));
      if (!has.has('theme')) {
        // An existing theme is never overwritten: after the first commit it belongs to the project.
        await this.#sandboxes.writeFile(project, THEME_FILE, renderThemeCss(createTheme(seedFromName(project.slug))));
        await this.#sandboxes.writeFile(project, PROJECT_FILE, `${JSON.stringify(defaultProjectFile(project.template), null, 2)}\n`);
      }
      if (!has.has('kit')) {
        // The same holds for the kit: once it is in the repository the project may change it.
        for (const file of await kitFiles()) await this.#sandboxes.writeFile(project, `${AX_DIR}/${file.path}`, file.content);
      }
      if (!has.has('theme') || !has.has('kit')) await this.#sandboxes.commitAll(project, has.has('theme') ? 'chore: add the Studio Zero AX kit' : 'chore: add Studio Zero theme, project file and AX kit');
      return info;
    });
  }
}

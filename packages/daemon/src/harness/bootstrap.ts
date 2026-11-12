import { createTheme, renderThemeCss, seedFromName } from '@studio-zero/design';
import type { Project, SandboxInfo } from '@studio-zero/protocol';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { KeyedMutex } from '../util/core.ts';
import { AX_DIR, AX_ENTRY, kitFiles } from './axKit.ts';
import { MOBILE_KIT_DIR, MOBILE_KIT_ENTRY, mobileKitFiles } from './mobileKit.ts';
import { PROJECT_FILE, defaultProjectFile } from './projectFile.ts';
import { THEME_FILE } from './prompts.ts';

/**
 * Brings a project to the state every task assumes: sandbox running, /workspace a git repository, and the
 * Studio Zero files committed: the project's own theme (seeded from its slug so no two projects start from the
 * same palette), the runtime description the harness reads, and the AX kit, so an AI feature the project grows
 * gets the same interaction model the studio has instead of a chat box. A mobile project also gets the mobile
 * kit: the frame, the entry point and the controls a phone screen is made of, so its first screen is composed
 * from an app's parts and not improvised from bare views.
 *
 * Each file set is checked on the branch that is checked out. The harness calls this again once a task's branch
 * exists, so a kit introduced after a project was created reaches the branch the engine is about to work on.
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
      const present = await this.#sandboxes.exec(project, `test -f ${THEME_FILE} && echo theme; test -f ${AX_ENTRY} && echo kit; test -f ${MOBILE_KIT_ENTRY} && echo mobile; true`, { timeoutSec: 15 });
      const has = new Set(present.stdout.split('\n').map((line) => line.trim()));
      const added: string[] = [];
      if (!has.has('theme')) {
        // An existing theme is never overwritten: after the first commit it belongs to the project.
        await this.#sandboxes.writeFile(project, THEME_FILE, renderThemeCss(createTheme(seedFromName(project.slug))));
        await this.#sandboxes.writeFile(project, PROJECT_FILE, `${JSON.stringify(defaultProjectFile(project.template), null, 2)}\n`);
        added.push('theme', 'project file');
      }
      if (!has.has('kit')) {
        // The same holds for the kits: once one is in the repository the project may change it.
        for (const file of await kitFiles()) await this.#sandboxes.writeFile(project, `${AX_DIR}/${file.path}`, file.content);
        added.push('AX kit');
      }
      if (project.template === 'mobile-expo' && !has.has('mobile')) {
        for (const file of await mobileKitFiles()) await this.#sandboxes.writeFile(project, `${MOBILE_KIT_DIR}/${file.path}`, file.content);
        added.push('mobile kit');
      }
      if (added.length > 0) {
        const list = added.length === 1 ? added[0] : `${added.slice(0, -1).join(', ')} and ${added.at(-1)}`;
        await this.#sandboxes.commitAll(project, has.has('theme') ? `chore: add the Studio Zero ${list}` : `chore: add Studio Zero ${list}`);
      }
      return info;
    });
  }
}

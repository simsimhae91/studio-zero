import { THEME_GENERATOR, themeGeneratorOf } from '@studio-zero/design';
import { THEME_SEED_FILE, faceHome, placeholderTheme, regeneratedTheme, writeProjectTheme } from './themeSeed.ts';
import type { Project, SandboxInfo } from '@studio-zero/protocol';
import { EXTERNAL_ENV_FILE, type ExternalApis } from '../app/ExternalApis.ts';
import type { ProjectArms } from '../arms/ProjectArms.ts';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { KeyedMutex } from '../util/core.ts';
import { AX_DIR, AX_ENTRY, kitFiles } from './axKit.ts';
import { MOBILE_KIT_DIR, MOBILE_KIT_ENTRY, mobileKitFiles } from './mobileKit.ts';
import { PROJECT_FILE, defaultProjectFile } from './projectFile.ts';
import { THEME_FILE } from './prompts.ts';
import type { SelfHosting } from './SelfHosting.ts';

/** Where everything the studio writes into a project lives, but for a phone project's face, which its web target serves from elsewhere. */
const STUDIO_DIR = '.studio-zero';

/**
 * Brings a project to the state every task assumes: sandbox running, /workspace a git repository, and the
 * Studio Zero files committed: the project's own theme (seeded from its slug so no two projects start from the
 * same palette), the runtime description the harness reads, and the AX kit, so an AI feature the project grows
 * gets the same interaction model the studio has instead of a chat box. A mobile project also gets the mobile
 * kit: the frame, the entry point and the controls a phone screen is made of, so its first screen is composed
 * from an app's parts and not improvised from bare views. A project that has a backend of its own (`ProjectArms`)
 * has it started here, with its address in the workspace.
 *
 * Each file set is checked on the branch that is checked out. The harness calls this again once a task's branch
 * exists, so a kit introduced after a project was created reaches the branch the engine is about to work on.
 *
 * The theme's stylesheet is the one file that is brought up to date: it is generated, never edited, and says
 * which generator wrote it. A sheet from an older generator is written again from the seed the project stores, so
 * a project made before the faces were fixed is not audited against a sheet that names faces it may no longer use.
 *
 * The studio's own repository (the Core project) is the exception: its workspace is a clone of that repository,
 * filled by `SelfHosting`, and none of these files are written into it.
 *
 * Project creation provisions in the background and a task submitted right away provisions too, so calls for
 * one project are serialised here; the second caller waits and finds the work done.
 */
export class WorkspaceProvisioner {
  readonly #sandboxes: OrbStackManager;
  readonly #locks = new KeyedMutex();
  readonly #core: Pick<SelfHosting, 'sync'> | null;
  readonly #external: Pick<ExternalApis, 'envFile'> | null;
  readonly #arms: Pick<ProjectArms, 'ensure'> | null;

  constructor(sandboxes: OrbStackManager, core: Pick<SelfHosting, 'sync'> | null = null, external: Pick<ExternalApis, 'envFile'> | null = null, arms: Pick<ProjectArms, 'ensure'> | null = null) {
    this.#sandboxes = sandboxes;
    this.#core = core;
    this.#external = external;
    this.#arms = arms;
  }

  ensure(project: Project): Promise<SandboxInfo> {
    return this.#locks.run(project.id, async () => {
      const info = await this.#sandboxes.ensure(project);
      if (project.template === 'studio-core') {
        // Filled once, here; a task brings it up to date itself before it branches.
        await this.#core?.sync(project, { onlyIfEmpty: true });
        return info;
      }
      // One round trip answers every question; each file set is written only when it is missing. The sheet's
      // second line says which generator wrote it.
      const present = await this.#sandboxes.exec(project, `test -f ${THEME_FILE} && echo theme; test -f ${AX_ENTRY} && echo kit; test -f ${MOBILE_KIT_ENTRY} && echo mobile; sed -n '2p' ${THEME_FILE} 2>/dev/null; true`, { timeoutSec: 15 });
      const has = new Set(present.stdout.split('\n').map((line) => line.trim()));
      const added: string[] = [];
      if (!has.has('theme')) {
        // An existing theme's choices are never overwritten: after the first commit they belong to the project.
        // A placeholder, and it says so: the first design task replaces it with a choice made from the subject.
        await writeProjectTheme(this.#sandboxes, project, placeholderTheme(project.slug));
        await this.#sandboxes.writeFile(project, PROJECT_FILE, `${JSON.stringify(defaultProjectFile(project.template), null, 2)}\n`);
        added.push('theme', 'project file');
      } else if (themeGeneratorOf(present.stdout) < THEME_GENERATOR) {
        // The same choices, written by this generator. A project with no seed beside its sheet, or one this
        // generator cannot render, keeps the sheet it has.
        const stored = await this.#sandboxes.exec(project, `cat ${THEME_SEED_FILE} 2>/dev/null`, { timeoutSec: 15 });
        const theme = regeneratedTheme(stored.stdout);
        if (theme) {
          await writeProjectTheme(this.#sandboxes, project, theme);
          added.push('theme (regenerated)');
        }
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
      // Unlike the kits, this file is the daemon's to keep right: it is rewritten whenever what the owner has
      // connected differs from what the branch holds, so a new connection reaches a branch made before it.
      if (this.#external) {
        const wanted = this.#external.envFile(project.id);
        const held = (await this.#sandboxes.exec(project, `cat ${EXTERNAL_ENV_FILE} 2>/dev/null`, { timeoutSec: 15 })).stdout;
        if (wanted !== null && held !== wanted) {
          await this.#sandboxes.writeFile(project, EXTERNAL_ENV_FILE, wanted);
          added.push('outside API stand-ins');
        } else if (wanted === null && held !== '') {
          // Nothing is connected any more: a list of stand-ins that no longer work would send an engine down a dead end.
          await this.#sandboxes.exec(project, `rm -f ${EXTERNAL_ENV_FILE}`, { timeoutSec: 15 });
          added.push('outside API stand-ins (now none)');
        }
      }
      // A project that has a backend gets it running whenever its sandbox is: a task or a preview that finds
      // sign-in dead is looking at a broken product, not at the code. A branch made before the backend's kit
      // gets the kit here.
      const backend = await this.#arms?.ensure(project);
      if (backend) added.push(...backend.added);
      if (added.length > 0) {
        const list = added.length === 1 ? added[0] : `${added.slice(0, -1).join(', ')} and ${added.at(-1)}`;
        // Only what was written here. The branch that is checked out may be one the product was never built
        // on: after a task fails the workspace is back on the integration branch, where the engine's
        // .gitignore does not exist and its node_modules still lie. A commit of everything took 89,960 of
        // those files into a project's main branch (2026-11-14).
        await this.#sandboxes.commitAll(project, has.has('theme') ? `chore: add the Studio Zero ${list}` : `chore: add Studio Zero ${list}`, [STUDIO_DIR, faceHome(project.template).dir]);
      }
      return info;
    });
  }
}

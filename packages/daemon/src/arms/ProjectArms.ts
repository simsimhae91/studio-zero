import type { Project } from '@studio-zero/protocol';
import type { OrbStackManager } from '../sandbox/OrbStackManager.ts';
import { KeyedMutex } from '../util/core.ts';
import { ARMS_KIT_DIR, ARMS_KIT_ENTRY, ENV_FILE, armsKitFiles, envBlock, envNames, variantOf, withEnvBlock } from './kit.ts';
import { MAX_MIGRATIONS, MAX_SQL_BYTES, MIGRATIONS_DIR, MIGRATION_NAME, SEED_FILE, appliedScript, applyScript, plan, readApplied, readOutcome, type SqlFile } from './schema.ts';
import { StackError, type StackInfo, type SupabaseStack } from './SupabaseStack.ts';

/**
 * A project's arms: what it reaches the world with besides its own screens. There is one so far, the backend
 * (`SupabaseStack`), and this is what joins it to the project: starts it when the project is worked on or
 * looked at, puts its address and its client into the workspace, applies the schema the workspace declares,
 * and takes it down and away with the project.
 *
 * A project has a backend from the first time its schema is applied. Nothing is declared anywhere else: the
 * stack exists on this machine or it does not, and that is the one fact everything here asks.
 */

export interface ArmsReady {
  info: StackInfo;
  /** What was put into the workspace this time and belongs in a commit. */
  added: string[];
}

export interface SchemaResult {
  ok: boolean;
  /** What happened, in words for the engine that asked. */
  text: string;
}

type Sandboxes = Pick<OrbStackManager, 'exec' | 'readFile' | 'writeFile'>;
type Stack = Pick<SupabaseStack, 'has' | 'start' | 'stop' | 'destroy' | 'sql'>;

const NO_BACKEND = 'This kind of project has no backend of its own.';

export class ProjectArms {
  readonly #stack: Stack;
  readonly #sandboxes: Sandboxes;
  readonly #locks = new KeyedMutex();
  /** Stacks this daemon has started, so that asking where one is does not start it again. */
  readonly #up = new Map<string, StackInfo>();

  constructor(deps: { stack: Stack; sandboxes: Sandboxes }) {
    this.#stack = deps.stack;
    this.#sandboxes = deps.sandboxes;
  }

  has(project: Pick<Project, 'id'>): boolean {
    return this.#stack.has(project);
  }

  /**
   * Brings the project's backend up and makes the workspace able to use it: the address and the publishable
   * key in `.env.local`, and the client kit if the branch does not have it. With `create` unset, a project that
   * has no backend is left without one and the answer is `null`.
   */
  ensure(project: Project, opts: { create: boolean } = { create: false }): Promise<ArmsReady | null> {
    return this.#locks.run(project.id, () => this.#ensure(project, opts.create));
  }

  async #ensure(project: Project, create: boolean): Promise<ArmsReady | null> {
    if (!variantOf(project.template) || (!create && !this.#stack.has(project))) return null;
    const info = await this.#stack.start(project);
    this.#up.set(project.id, info);
    const added: string[] = [];

    // The file is this machine's and never the repository's: the ports are this stack's. `.git/info/exclude`
    // keeps it out of every commit without touching the project's own ignore file.
    const held = await this.#sandboxes.exec(project, `grep -qxF ${ENV_FILE} .git/info/exclude 2>/dev/null || echo ${ENV_FILE} >> .git/info/exclude; test -f ${ARMS_KIT_ENTRY} && echo SZ_KIT_PRESENT; cat ${ENV_FILE} 2>/dev/null; true`, { timeoutSec: 15 });
    const hasKit = held.stdout.startsWith('SZ_KIT_PRESENT');
    const existing = hasKit ? held.stdout.slice(held.stdout.indexOf('\n') + 1) : held.stdout;
    const wanted = withEnvBlock(existing, envBlock(project.template, info)!);
    if (wanted !== existing) await this.#sandboxes.writeFile(project, ENV_FILE, wanted);
    if (!hasKit) {
      // Like the other kits: once it is in the repository it is the project's to change.
      for (const file of await armsKitFiles(project.template)) await this.#sandboxes.writeFile(project, `${ARMS_KIT_DIR}/${file.path}`, file.content);
      added.push('backend kit');
    }
    return { info, added };
  }

  /**
   * The ports on this machine that a page of this project calls: its backend's. A browser that is not on this
   * machine (the audit's, in its container) has to be given a way to them. A project without a backend has none.
   */
  async hostPorts(project: Project): Promise<number[]> {
    if (!this.#stack.has(project)) return [];
    const info = this.#up.get(project.id) ?? (await this.ensure(project))?.info;
    const port = info ? Number(new URL(info.apiUrl).port) : NaN;
    return Number.isInteger(port) && port > 0 ? [port] : [];
  }

  /**
   * Brings the database up to date from the workspace's `supabase/migrations/*.sql` and `supabase/seed.sql`
   * (see `schema.ts`). The first call is what gives a project its backend.
   */
  applySchema(project: Project): Promise<SchemaResult> {
    return this.#locks.run(`${project.id}:schema`, async () => {
      const names = envNames(project.template);
      const variant = variantOf(project.template);
      if (!names || !variant) return { ok: false, text: NO_BACKEND };

      const listed = await this.#sandboxes.exec(project, `ls -1 ${MIGRATIONS_DIR} 2>/dev/null; true`, { timeoutSec: 15 });
      const found = listed.stdout.split('\n').map((name) => name.trim()).filter((name) => name.endsWith('.sql'));
      const unusable = found.filter((name) => !MIGRATION_NAME.test(name));
      if (unusable.length > 0) return { ok: false, text: `Nothing was applied. A migration's name begins with its number and uses letters, digits, "_", "-" and "." only (0001_ledger.sql). Rename: ${unusable.join(', ')}` };
      if (found.length === 0) return { ok: false, text: `Nothing was applied: ${MIGRATIONS_DIR}/ holds no .sql file. Write the schema there first (0001_<what>.sql), with row level security and policies on every table.` };
      if (found.length > MAX_MIGRATIONS) return { ok: false, text: `Nothing was applied: ${found.length} migrations is more than the ${MAX_MIGRATIONS} the studio applies.` };

      const read = async (path: string): Promise<string | null> => {
        const file = await this.#sandboxes.readFile(project, path, MAX_SQL_BYTES);
        return file.truncated ? null : file.content;
      };
      const migrations: SqlFile[] = [];
      for (const name of found) {
        const sql = await read(`${MIGRATIONS_DIR}/${name}`);
        if (sql === null) return { ok: false, text: `Nothing was applied: ${name} is larger than ${MAX_SQL_BYTES / 1024} KB.` };
        migrations.push({ name, sql });
      }
      const hasSeed = (await this.#sandboxes.exec(project, `test -f ${SEED_FILE} && echo yes; true`, { timeoutSec: 15 })).stdout.trim() === 'yes';
      const seed = hasSeed ? await read(SEED_FILE) : null;
      if (hasSeed && seed === null) return { ok: false, text: `Nothing was applied: ${SEED_FILE} is larger than ${MAX_SQL_BYTES / 1024} KB.` };

      let ready: ArmsReady | null;
      try {
        ready = await this.ensure(project, { create: true });
      } catch (err) {
        if (!(err instanceof StackError)) throw err;
        return { ok: false, text: `Nothing was applied: ${err.message}.${err.detail ? `\n${err.detail}` : ''}\nThis is the studio's to fix, not the project's. Say so in your report and go on with what does not need the backend.` };
      }
      if (!ready) return { ok: false, text: NO_BACKEND };
      const where = `The backend is this project's own Supabase (sign-in, database, storage, realtime). Its client is in ${ARMS_KIT_DIR} (read its README.md), and needs: pnpm add ${variant.packages.join(' ')}. Its address and publishable key are in ${ENV_FILE} as ${names.url} and ${names.key}${names.internalUrl ? ` (server code: ${names.internalUrl})` : ''}; restart the dev server so it reads them.`;

      const before = await this.#stack.sql(project, appliedScript());
      if (before.exitCode !== 0) return { ok: false, text: `Nothing was applied: the database did not answer (${before.stderr.trim().slice(0, 300)}).` };
      const todo = plan(migrations, seed, readApplied(before.stdout));
      if (todo.edited.length > 0) {
        return { ok: false, text: `Nothing was applied. ${todo.edited.join(', ')} ${todo.edited.length === 1 ? 'is in the database already and its file has' : 'are in the database already and their files have'} changed since. A migration that is in is not edited: put the file back as it was (git has it), and make the change in a new file numbered after the last, which alters what the earlier one made.` };
      }
      if (todo.pending.length === 0 && todo.seed === null) return { ok: true, text: `Nothing new to apply: the ${found.length === 1 ? 'migration is' : `${found.length} migrations are`} in${hasSeed ? ' and the seed has not changed' : ''}.\n${where}` };

      const outcome = readOutcome(await this.#stack.sql(project, applyScript(todo)));
      if (outcome.ok) {
        const did = [todo.pending.length > 0 ? `${todo.pending.length === 1 ? 'one migration' : `${todo.pending.length} migrations`} (${todo.pending.map((file) => file.name).join(', ')})` : '', todo.seed !== null ? 'the seed' : ''].filter(Boolean).join(' and ');
        return { ok: true, text: `Applied ${did}. public now has ${outcome.tables === 1 ? 'one table' : `${outcome.tables} tables`}, each with row level security and a policy.\n${where}` };
      }
      if (outcome.kind === 'guard') {
        return { ok: false, text: `Nothing was applied, and the database is as it was. The schema leaves these open to anyone with the publishable key, which is everyone:\n${outcome.holes.map((hole) => `- ${hole}`).join('\n')}\nFix them in the migrations that have not been applied yet (${todo.pending.map((file) => file.name).join(', ') || 'a new one'}) and call apply_schema again.` };
      }
      return { ok: false, text: `Nothing was applied, and the database is as it was. ${outcome.file} failed:\n${outcome.error}` };
    });
  }

  /** Runs a script of the studio's own in the project's database (see `SupabaseStack.sql`). For checks that have to see past every policy. */
  sql(project: Project, script: string): ReturnType<Stack['sql']> {
    return this.#stack.sql(project, script);
  }

  /** Takes the backend down with its data kept, as when the project's sandbox is stopped. */
  async rest(project: Project): Promise<void> {
    await this.#locks.run(project.id, async () => {
      this.#up.delete(project.id);
      await this.#stack.stop(project);
    });
  }

  /** Deletes the backend and everything in it, as when the project is deleted. */
  async forget(project: Project): Promise<void> {
    await this.#locks.run(project.id, async () => {
      this.#up.delete(project.id);
      await this.#stack.destroy(project);
    });
  }
}

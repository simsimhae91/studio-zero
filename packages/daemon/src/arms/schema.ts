import { createHash, randomBytes } from 'node:crypto';
import type { RunResult } from '../util/run.ts';

/**
 * Bringing a project's database up to date from the files in its workspace.
 *
 * A project writes its schema as SQL files in `supabase/migrations/` and its demo rows in `supabase/seed.sql`,
 * where Supabase's own tools look for them. The studio applies them, because the engine has neither the
 * database's address nor a key that could change it. A migration is applied once and then left alone, as
 * everywhere else: a change to what is already in goes in a new file. The seed is applied again whenever it
 * changes, so it is written to be run twice.
 *
 * Everything pending goes in as one transaction, and the last thing in that transaction is a check: every
 * table in `public` has row level security on and at least one policy, and every view there reads as the one
 * who asks. The publishable key is in what a browser downloads, so those policies are all that stands between
 * one user's rows and another's. If a statement fails or the check finds a hole, nothing is applied and the
 * database is as it was. That transaction is the way back; no copy of the database is taken first.
 */

export const MIGRATIONS_DIR = 'supabase/migrations';
export const SEED_FILE = 'supabase/seed.sql';
/** How the seed is entered in the record of what has been applied. No migration can have this name: theirs begin with a digit. */
const SEED_RECORD = 'seed.sql';
/** A migration's file name. It goes into SQL as a literal and into the script as a marker, so it is held to plain characters. */
export const MIGRATION_NAME = /^[0-9][A-Za-z0-9_.-]{0,100}\.sql$/;
export const MAX_MIGRATIONS = 80;
export const MAX_SQL_BYTES = 400 * 1024;

export interface SqlFile {
  name: string;
  sql: string;
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The studio's record of what has been applied. Making it is harmless and happens once. */
const RECORD = `create schema if not exists studio_zero;
create table if not exists studio_zero.applied (name text primary key, sha256 text not null, applied_at timestamptz not null default now());
`;

/** Asks what has been applied: one `name<TAB>sha256` line each. */
export const appliedScript = (): string => `${RECORD}select name || E'\\t' || sha256 from studio_zero.applied order by name;\n`;

export function readApplied(stdout: string): Map<string, string> {
  const applied = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const [name, hash] = line.split('\t');
    if (name && hash) applied.set(name, hash.trim());
  }
  return applied;
}

export interface Plan {
  /** Migrations not yet in, in the order they will run. */
  pending: SqlFile[];
  /** The seed, when it is new or has changed since it was last applied. */
  seed: string | null;
  /** Migrations that are in and whose file has changed since: a mistake in the workspace, and nothing is applied until it is put right. */
  edited: string[];
}

export function plan(migrations: readonly SqlFile[], seed: string | null, applied: ReadonlyMap<string, string>): Plan {
  const sorted = [...migrations].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    pending: sorted.filter((file) => !applied.has(file.name)),
    edited: sorted.filter((file) => applied.has(file.name) && applied.get(file.name) !== sha256(file.sql)).map((file) => file.name),
    seed: seed !== null && seed.trim() !== '' && applied.get(SEED_RECORD) !== sha256(seed) ? seed : null,
  };
}

/** Every hole the check looks for, as one line each. Run last, inside the transaction, and raised as one error. */
const GUARD = `do $sz_guard$
declare problems text;
begin
  select string_agg(line, E'\\n' order by line) into problems from (
    select format('table %s: row level security is off (alter table %I enable row level security, then a policy)', c.relname, c.relname) as line
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
    union all
    select format('table %s: row level security is on and there is no policy, so no user can read or write it (create policy ...)', c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
    union all
    select format('view %s: it reads as its owner and so past every policy (create view %I with (security_invoker = true) as ...)', c.relname, c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions @> array['security_invoker=true'], false)
  ) found;
  if problems is not null then raise exception using message = 'SZ_GUARD', detail = problems; end if;
end
$sz_guard$;
`;

const MARK = 'SZ_FILE ';
const DONE = 'SZ_TABLES ';

/**
 * The script that applies a plan. Each file runs through `execute` as a string between dollar quotes whose tag
 * is random: `psql` then reads the file's text as data and never as its own backslash commands (`\!` runs a
 * shell in the database's container, where the keys are), and the file cannot close the quote it does not know.
 * A marker is printed before each file, so a failure can be laid at the right one.
 */
export function applyScript(todo: Pick<Plan, 'pending' | 'seed'>, tag = randomBytes(12).toString('hex')): string {
  const quote = `$sz_${tag}$`;
  const run = (name: string, sql: string): string => {
    if (sql.includes(quote)) throw new Error('a schema file contains the quoting tag chosen for it');
    return `\\echo ${MARK}${name}\ndo $sz_run$ begin execute ${quote}\n${sql}\n${quote}; end $sz_run$;\n`;
  };
  const record = (name: string, sql: string): string => `insert into studio_zero.applied (name, sha256) values ('${name}', '${sha256(sql)}') on conflict (name) do update set sha256 = excluded.sha256, applied_at = now();\n`;
  const parts = [RECORD];
  for (const file of todo.pending) parts.push(run(file.name, file.sql), record(file.name, file.sql));
  if (todo.seed !== null) parts.push(run(SEED_FILE, todo.seed), record(SEED_RECORD, todo.seed));
  parts.push('\\echo SZ_FILE (the check)\n', GUARD);
  // Tells the API to read the schema again once this commits; without it a new table answers 404 for a while.
  parts.push(`notify pgrst, 'reload schema';\n`);
  parts.push(`select '${DONE}' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p');\n`);
  return parts.join('');
}

export type ApplyOutcome =
  | { ok: true; tables: number }
  /** A table or view was left open. `holes` says which, one line each. */
  | { ok: false; kind: 'guard'; holes: string[] }
  /** A statement failed. `file` is the one it was in; `error` is the database's own words. */
  | { ok: false; kind: 'sql'; file: string; error: string };

export function readOutcome(res: Pick<RunResult, 'exitCode' | 'stdout' | 'stderr' | 'timedOut'>): ApplyOutcome {
  const lines = res.stdout.split('\n').map((line) => line.trim());
  if (res.exitCode === 0) {
    const done = lines.find((line) => line.startsWith(DONE));
    return { ok: true, tables: done ? Number(done.slice(DONE.length)) : 0 };
  }
  // Notices come first (the record exists already, a table a file drops was not there); the answer is the error.
  const said = res.stderr.search(/^(ERROR|FATAL|PANIC):/m);
  const stderr = (said === -1 ? res.stderr : res.stderr.slice(said)).trim();
  if (/^ERROR:\s+SZ_GUARD\s*$/m.test(stderr)) {
    const detail = stderr.slice(stderr.indexOf('DETAIL:') + 'DETAIL:'.length).split(/\n(?:CONTEXT|HINT):/)[0] ?? '';
    return { ok: false, kind: 'guard', holes: detail.split('\n').map((line) => line.trim()).filter(Boolean) };
  }
  const file = lines.filter((line) => line.startsWith(MARK)).at(-1)?.slice(MARK.length) ?? '(before any file)';
  // What `execute` adds around the error is the studio's scaffolding, not the project's file.
  const error = (res.timedOut ? 'the database did not answer in time' : stderr.split(/\nCONTEXT:\s+PL\/pgSQL function inline_code_block/)[0]!.replace(/\nQUERY:[\s\S]*$/, '')).trim();
  return { ok: false, kind: 'sql', file, error: error.slice(0, 3000) };
}

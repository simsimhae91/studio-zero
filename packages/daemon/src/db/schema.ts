import type { DatabaseSync } from 'node:sqlite';

/**
 * Forward-only migrations. Index N is applied when `PRAGMA user_version` is N. Never edit a shipped entry: append.
 *
 * Conventions: timestamps are epoch milliseconds; `*_json` columns hold a protocol object that was validated on
 * write; secrets are never stored here (the `credentials` table is an index of Keychain item names only).
 */
const migrations: string[] = [
  /* 0 → 1 */ `
  CREATE TABLE projects (
    id          TEXT PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    template    TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE sandboxes (
    project_id          TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    container           TEXT NOT NULL UNIQUE,
    volume              TEXT NOT NULL,
    network             TEXT NOT NULL,
    image               TEXT NOT NULL,
    -- sha256 of the sandbox-scoped gateway token. The token itself lives only inside that sandbox.
    gateway_token_hash  TEXT NOT NULL UNIQUE,
    created_at          INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE tasks (
    id                  TEXT PRIMARY KEY,
    project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind                TEXT NOT NULL,
    prompt              TEXT NOT NULL,
    origin              TEXT NOT NULL,
    state               TEXT NOT NULL,
    phase               TEXT,
    engine              TEXT,
    model               TEXT,
    branch              TEXT,
    attempt             INTEGER NOT NULL DEFAULT 0,
    cancel_requested    INTEGER NOT NULL DEFAULT 0,
    budget_tokens       INTEGER NOT NULL,
    spent_tokens        INTEGER NOT NULL DEFAULT 0,
    spent_usd_micros    INTEGER NOT NULL DEFAULT 0,
    base_checkpoint_id  TEXT,
    summary             TEXT,
    error               TEXT,
    created_at          INTEGER NOT NULL,
    started_at          INTEGER,
    finished_at         INTEGER
  ) STRICT;
  CREATE INDEX tasks_by_state ON tasks(state, created_at);
  CREATE INDEX tasks_by_project ON tasks(project_id, created_at);

  -- Append-only trace. Source of truth for client streaming and for the reflection agent.
  CREATE TABLE events (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    at          INTEGER NOT NULL,
    project_id  TEXT,
    task_id     TEXT,
    type        TEXT NOT NULL,
    body_json   TEXT NOT NULL
  ) STRICT;
  CREATE INDEX events_by_task ON events(task_id, seq);
  CREATE INDEX events_by_project ON events(project_id, seq);

  CREATE TABLE approvals (
    id            TEXT PRIMARY KEY,
    project_id    TEXT,
    task_id       TEXT,
    action_kind   TEXT NOT NULL,
    action_hash   TEXT NOT NULL,
    action_json   TEXT NOT NULL,
    summary       TEXT NOT NULL,
    state         TEXT NOT NULL,
    requested_at  INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    resolved_at   INTEGER,
    resolved_via  TEXT
  ) STRICT;
  CREATE INDEX approvals_by_state ON approvals(state, requested_at);
  CREATE INDEX approvals_by_hash ON approvals(action_hash, state);

  -- Every policy evaluation, allowed or not. This is the audit trail behind "shows what it did".
  CREATE TABLE policy_decisions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    at           INTEGER NOT NULL,
    actor        TEXT NOT NULL,
    action_kind  TEXT NOT NULL,
    action_hash  TEXT NOT NULL,
    project_id   TEXT,
    task_id      TEXT,
    effect       TEXT NOT NULL,
    rule         TEXT NOT NULL,
    reason       TEXT NOT NULL
  ) STRICT;

  CREATE TABLE usage_ledger (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    at             INTEGER NOT NULL,
    project_id     TEXT NOT NULL,
    task_id        TEXT,
    source         TEXT NOT NULL,
    model          TEXT NOT NULL,
    input_tokens   INTEGER NOT NULL,
    output_tokens  INTEGER NOT NULL,
    usd_micros     INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX usage_by_project ON usage_ledger(project_id, at);

  CREATE TABLE checkpoints (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id     TEXT,
    label       TEXT NOT NULL,
    commit_sha  TEXT NOT NULL,
    head_sha    TEXT NOT NULL,   -- 'none' for an unborn branch
    branch      TEXT NOT NULL,   -- 'DETACHED' when HEAD was detached
    created_at  INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX checkpoints_by_project ON checkpoints(project_id, created_at);

  CREATE TABLE audits (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id      TEXT,
    score        REAL NOT NULL,
    passed       INTEGER NOT NULL,
    report_json  TEXT NOT NULL,
    created_at   INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX audits_by_project ON audits(project_id, created_at);

  CREATE TABLE artifacts (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    mime        TEXT NOT NULL,
    file        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE lessons (
    id              TEXT PRIMARY KEY,
    scope           TEXT NOT NULL,
    project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    title           TEXT NOT NULL,
    trigger         TEXT NOT NULL,
    guidance        TEXT NOT NULL,
    state           TEXT NOT NULL,
    confirmations   INTEGER NOT NULL DEFAULT 0,
    harms           INTEGER NOT NULL DEFAULT 0,
    origin_task_id  TEXT,
    evidence_json   TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX lessons_by_scope ON lessons(scope, project_id, state);

  CREATE TABLE evals (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    spec_json       TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    origin_task_id  TEXT,
    created_at      INTEGER NOT NULL,
    UNIQUE (project_id, name)
  ) STRICT;

  CREATE TABLE eval_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    eval_id      TEXT NOT NULL REFERENCES evals(id) ON DELETE CASCADE,
    task_id      TEXT,
    passed       INTEGER NOT NULL,
    duration_ms  INTEGER NOT NULL,
    detail       TEXT NOT NULL,
    created_at   INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE kirby_ingests (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    repo_url      TEXT NOT NULL,
    commit_sha    TEXT,
    state         TEXT NOT NULL,   -- running | done | failed
    profile_json  TEXT,
    error         TEXT,
    created_at    INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE kirby_proposals (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ingest_id   TEXT NOT NULL REFERENCES kirby_ingests(id) ON DELETE CASCADE,
    state       TEXT NOT NULL,
    card_json   TEXT NOT NULL,
    brief       TEXT NOT NULL,     -- implementation brief handed to the coding engine
    created_at  INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX proposals_by_project ON kirby_proposals(project_id, created_at);

  -- Index of Keychain item names. Never contains secret material.
  CREATE TABLE credentials (
    id          TEXT PRIMARY KEY,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE relay_chats (
    channel            TEXT NOT NULL,
    chat_id            TEXT NOT NULL,
    active_project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
    -- Set when the owner tapped "refine": the next text message becomes a follow-up to this task.
    refine_task_id     TEXT,
    PRIMARY KEY (channel, chat_id)
  ) STRICT;

  CREATE TABLE kv (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  ) STRICT;
  `,
  /* 1 → 2: scratchpads, decisions, knowledge jobs, calibration, forks */ `
  ALTER TABLE tasks ADD COLUMN base_branch TEXT;

  -- Tier 1 of the lifecycle. No sandbox, no repository: rows here are the whole scratchpad.
  CREATE TABLE scratchpads (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    mode        TEXT NOT NULL,
    state       TEXT NOT NULL,
    project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE scratch_entries (
    seq            INTEGER PRIMARY KEY AUTOINCREMENT,
    scratch_id     TEXT NOT NULL REFERENCES scratchpads(id) ON DELETE CASCADE,
    at             INTEGER NOT NULL,
    author         TEXT NOT NULL,   -- owner | agent | system
    text           TEXT,
    response_json  TEXT,
    blocks_json    TEXT NOT NULL
  ) STRICT;
  CREATE INDEX scratch_entries_by_pad ON scratch_entries(scratch_id, seq);

  -- spec.md is compiled from these sections; nothing free-form is stored as "the spec".
  CREATE TABLE scratch_spec (
    scratch_id  TEXT NOT NULL REFERENCES scratchpads(id) ON DELETE CASCADE,
    section     TEXT NOT NULL,
    content     TEXT NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (scratch_id, section)
  ) STRICT;

  -- decision_log.md is compiled from these rows: what was chosen, and what was rejected and why.
  CREATE TABLE decisions (
    id             TEXT PRIMARY KEY,
    scratch_id     TEXT NOT NULL REFERENCES scratchpads(id) ON DELETE CASCADE,
    question       TEXT NOT NULL,
    chosen         TEXT NOT NULL,
    why            TEXT NOT NULL,
    rejected_json  TEXT NOT NULL,
    confidence     TEXT NOT NULL,
    decided_by     TEXT NOT NULL,   -- owner | agent
    created_at     INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX decisions_by_pad ON decisions(scratch_id, created_at);

  -- One row each time the owner answered a question the agent had a recommendation for.
  CREATE TABLE ax_outcomes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    at          INTEGER NOT NULL,
    confidence  TEXT NOT NULL,
    agreed      INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE knowledge_jobs (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,   -- research | document
    title         TEXT NOT NULL,
    state         TEXT NOT NULL,
    origin        TEXT NOT NULL,
    scratch_id    TEXT REFERENCES scratchpads(id) ON DELETE SET NULL,
    input_json    TEXT NOT NULL,
    markdown      TEXT NOT NULL DEFAULT '',
    report_json   TEXT,
    lint_json     TEXT NOT NULL DEFAULT '[]',
    error         TEXT,
    spent_tokens  INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    finished_at   INTEGER
  ) STRICT;
  CREATE INDEX knowledge_by_created ON knowledge_jobs(created_at);
  `,

  // 3: external tool servers (MCP) and what the owner has allowed on them, per project and per tool.
  `
  CREATE TABLE mcp_servers (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    url       TEXT NOT NULL,
    auth      TEXT NOT NULL CHECK (auth IN ('bearer', 'none', 'oauth')),
    about     TEXT NOT NULL,
    builtin   INTEGER NOT NULL DEFAULT 0,
    added_at  INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE mcp_grants (
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    server_id   TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    tool        TEXT NOT NULL,
    granted_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, server_id, tool)
  ) STRICT;
  `,

  // 4: an engine the owner picked for a task; tool servers that are a program on this machine (stdio).
  `
  ALTER TABLE tasks ADD COLUMN engine_pref TEXT;
  ALTER TABLE mcp_servers ADD COLUMN transport TEXT NOT NULL DEFAULT 'http';
  ALTER TABLE mcp_servers ADD COLUMN command TEXT;
  ALTER TABLE mcp_servers ADD COLUMN args_json TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE mcp_servers ADD COLUMN token_env TEXT;
  `,

  // 5: sessions (named task streams inside a project), and how much of the loop a task runs.
  `
  CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX sessions_by_project ON sessions(project_id, created_at);
  -- A deleted session leaves its tasks behind, in the project's default stream.
  ALTER TABLE tasks ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
  ALTER TABLE tasks ADD COLUMN track TEXT NOT NULL DEFAULT 'full';
  `,

  // 6: the ledger (one receipt per finished task), the owner's choice of cross-checker, and reference pages.
  `
  CREATE TABLE ledger_entries (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id     TEXT NOT NULL UNIQUE,
    outcome     TEXT NOT NULL,
    entry_json  TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX ledger_by_project ON ledger_entries(project_id, created_at);
  ALTER TABLE tasks ADD COLUMN reviewer_pref TEXT;
  ALTER TABLE tasks ADD COLUMN references_json TEXT NOT NULL DEFAULT '[]';
  `,

  // 7: publishing a document used to close its note, which left no way to build from the plan just written up.
  // Notes closed that way (promoted, with no project) are open again; they were ready when they were published.
  `
  UPDATE scratchpads SET state = 'ready' WHERE state = 'promoted' AND project_id IS NULL;
  `,

  // 8: outside APIs a project's code may call through the gateway. The keys are in the Keychain; what is here
  // is where each API lives and the stand-in a sandbox holds for each of its variables. A stand-in is not a secret.
  `
  CREATE TABLE external_apis (
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    origin      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, name)
  ) STRICT;
  CREATE TABLE external_api_vars (
    placeholder  TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL,
    name         TEXT NOT NULL,
    variable     TEXT NOT NULL,
    UNIQUE (project_id, name, variable),
    FOREIGN KEY (project_id, name) REFERENCES external_apis(project_id, name) ON DELETE CASCADE
  ) STRICT;
  `,
  // 9: how much of a call's input was a re-read from the prompt cache. Budgets charge that part at a tenth.
  // Rows from before this are counted as they were then: in full.
  `
  ALTER TABLE usage_ledger ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0;
  `,
  // 10: a model the owner picked for a task, on the engine they picked.
  `
  ALTER TABLE tasks ADD COLUMN model_pref TEXT;
  `,
  // 11: the effort the owner picked for a task, and the effort it was run at.
  `
  ALTER TABLE tasks ADD COLUMN effort_pref TEXT;
  ALTER TABLE tasks ADD COLUMN effort TEXT;
  `,
  // 12: a task parked on a subscription's usage limit, until the reset time the vendor named; and how often it was.
  `
  ALTER TABLE tasks ADD COLUMN parked_until INTEGER;
  ALTER TABLE tasks ADD COLUMN park_count INTEGER NOT NULL DEFAULT 0;
  `,
  // 13: the owner's schedules. A run moves next_due_at on before its task is submitted: a crash loses a run, never doubles one.
  `
  CREATE TABLE schedules (
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL,
    prompt            TEXT NOT NULL,
    engine            TEXT,
    model             TEXT,
    mode              TEXT NOT NULL CHECK (mode IN ('at', 'every')),
    run_at            INTEGER,
    interval_minutes  INTEGER,
    enabled           INTEGER NOT NULL DEFAULT 1,
    next_due_at       INTEGER,
    last_fired_at     INTEGER,
    last_task_id      TEXT,
    created_at        INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX schedules_due ON schedules(enabled, next_due_at);
  `,
  // 14: a task's plan as the owner was shown it, one row per version, when they asked to see it before code.
  // plan_json is the planner's structured plan, plan_markdown is what daemon code rendered from it and sha256 is
  // that text's hash; reviewer_notes is the cross-reviewer's critique as JSON. verdict is null while it waits.
  `
  ALTER TABLE tasks ADD COLUMN review_plan INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE plan_versions (
    task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    version         INTEGER NOT NULL,
    plan_json       TEXT NOT NULL,
    plan_markdown   TEXT NOT NULL,
    sha256          TEXT NOT NULL,
    reviewer_notes  TEXT,
    verdict         TEXT CHECK (verdict IN ('approve', 'changes')),
    feedback_json   TEXT NOT NULL DEFAULT '[]',
    created_at      INTEGER NOT NULL,
    resolved_at     INTEGER,
    PRIMARY KEY (task_id, version)
  ) STRICT;
  `,
];

export function migrate(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < migrations.length; v++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migrations[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

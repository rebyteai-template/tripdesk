-- TripDesk schema (D1). Three tables mirror the turn model (see server/store.ts):
--   tasks   — one booking conversation (rebyte relay task id lives here)
--   prompts — one agent turn within a task
--   frames  — one stream-json line of agent output, ordered by seq
-- Plain SQLite DDL — D1 runs it verbatim. relay_task_id is present from the start
-- (the old sqlite driver had to ALTER it in; a fresh D1 schema includes it).

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running',
  session_id    TEXT,
  relay_task_id TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prompts (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL,
  prompt       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'running',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_prompts_task ON prompts(task_id);

CREATE TABLE IF NOT EXISTS frames (
  prompt_id    TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  data         TEXT NOT NULL,
  PRIMARY KEY (prompt_id, seq)
);

-- Small key/value config the runtime reads at request time. Holds the cached,
-- already-seeded rebyte agent-computer (key 'agent_computer', value = JSON) written
-- once by scripts/bootstrap-rebyte.ts. The Durable Object reads it to get the
-- workspaceId for POST /tasks — it never provisions/seeds itself.
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

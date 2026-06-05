-- Multi-tenant: scope conversations to the authenticated user (email = tenant key),
-- and give each user their own seeded rebyte sandbox.
--
--   tasks.user_email   — owner of the conversation/session (from Cloudflare Access)
--   agent_computers    — one row per user: their pre-seeded sandbox (replaces the single
--                        kv.agent_computer; the DO still falls back to kv if a row is absent)

ALTER TABLE tasks ADD COLUMN user_email TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_email);

CREATE TABLE IF NOT EXISTS agent_computers (
  user_email TEXT PRIMARY KEY,
  ac_id      TEXT NOT NULL,
  sandbox_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

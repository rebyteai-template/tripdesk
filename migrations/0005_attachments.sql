-- Image/file attachment display channel (separate from the relay file-staging path).
-- `attachments`: one row per uploaded file id (= the relay temp-file id). Keeps two WebP
--   renditions as BLOBs — a small inline thumbnail + a larger lightbox image. Kept in D1
--   on purpose: both renditions are < ~250KB (screenshots), the size band where reading a
--   BLOB from SQLite beats the filesystem (sqlite.org/fasterthanfs). Non-image files keep
--   metadata only (thumb/large NULL) and render as a filename chip.
-- `prompt_files`: ordered association of a prompt → the file ids it carries (for the bubble).
-- The bytes are served by an authed Worker route (GET /api/app/files/:id?size=thumb|large),
-- scoped to attachments.user_email (= the embed tenant `org:uid`) — never a public/CDN URL.

CREATE TABLE IF NOT EXISTS attachments (
  file_id      TEXT PRIMARY KEY,
  user_email   TEXT NOT NULL,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  thumb        BLOB,
  large        BLOB,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_email);

CREATE TABLE IF NOT EXISTS prompt_files (
  prompt_id TEXT    NOT NULL,
  idx       INTEGER NOT NULL,
  file_id   TEXT    NOT NULL,
  PRIMARY KEY (prompt_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_prompt_files_prompt ON prompt_files(prompt_id);

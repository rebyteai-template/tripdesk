/**
 * Local dev storage driver: better-sqlite3 (zero-setup — a file under DATA_DIR).
 * Synchronous under the hood, wrapped to satisfy the async Store interface. The
 * SQL here is plain SQLite with `?` placeholders, which Cloudflare D1 runs
 * verbatim — so a D1 driver (server/store-d1.ts) is a near-mechanical port. pg /
 * mysql need their own dialect (datetime()/AUTOINCREMENT/placeholders differ).
 *
 * ⚠️ This driver needs a native addon + a real filesystem + a long-lived process,
 * so it does NOT run on Cloudflare Workers — it's the local / container driver
 * only. See CLAUDE.md «存储».
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { env } from './env.ts'
import type { Store, Task, Prompt } from './store.ts'

export function createSqliteStore(): Store {
  mkdirSync(env.DATA_DIR, { recursive: true })
  const db = new Database(join(env.DATA_DIR, 'tripdesk.db'))
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id           TEXT PRIMARY KEY,
      project_id   TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'running',
      session_id   TEXT,
      relay_task_id TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
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
  `)

  // Backfill relay_task_id on DBs created before the rebyte backend (CREATE TABLE
  // IF NOT EXISTS won't add a column to an existing table).
  const taskCols = db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[]
  if (!taskCols.some((c) => c.name === 'relay_task_id')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN relay_task_id TEXT`)
  }

  return {
    async createTask(id, projectId) {
      db.prepare(`INSERT INTO tasks (id, project_id) VALUES (?, ?)`).run(id, projectId)
    },
    async getTask(id) {
      return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Task | undefined
    },
    async setTaskSession(id, sessionId) {
      db.prepare(`UPDATE tasks SET session_id = ? WHERE id = ? AND session_id IS NULL`).run(sessionId, id)
    },
    async setTaskStatus(id, status) {
      db.prepare(`UPDATE tasks SET status = ? WHERE id = ?`).run(status, id)
    },
    async setTaskRelayId(id, relayTaskId) {
      db.prepare(`UPDATE tasks SET relay_task_id = ? WHERE id = ?`).run(relayTaskId, id)
    },

    async createPrompt(id, taskId, prompt) {
      db.prepare(`INSERT INTO prompts (id, task_id, prompt) VALUES (?, ?, ?)`).run(id, taskId, prompt)
    },
    async getPrompt(id) {
      return db.prepare(`SELECT * FROM prompts WHERE id = ?`).get(id) as Prompt | undefined
    },
    async listPrompts(taskId) {
      return db.prepare(`SELECT * FROM prompts WHERE task_id = ? ORDER BY created_at`).all(taskId) as Prompt[]
    },
    async finishPrompt(id, status) {
      db.prepare(
        `UPDATE prompts SET status = ?, completed_at = datetime('now') WHERE id = ? AND status = 'running'`,
      ).run(status, id)
    },

    async appendFrame(promptId, seq, data) {
      db.prepare(`INSERT INTO frames (prompt_id, seq, data) VALUES (?, ?, ?)`).run(promptId, seq, JSON.stringify(data))
    },
    async framesSince(promptId, fromSeq) {
      const rows = db
        .prepare(`SELECT seq, data FROM frames WHERE prompt_id = ? AND seq > ? ORDER BY seq`)
        .all(promptId, fromSeq) as { seq: number; data: string }[]
      return rows.map((r) => ({ seq: r.seq, data: JSON.parse(r.data) }))
    },
  }
}

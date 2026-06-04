/**
 * SQLite persistence. Three tables, mirroring adits' turn model:
 *   tasks   — one booking conversation (holds the claude session id)
 *   prompts — one agent turn within a task
 *   frames  — one stream-json line of agent output, ordered by seq
 *
 * better-sqlite3 is synchronous; that's fine for a single-user local server.
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { env } from './env.ts'

mkdirSync(env.DATA_DIR, { recursive: true })
const db = new Database(join(env.DATA_DIR, 'tripdesk.db'))
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'running',
    session_id   TEXT,
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

export interface Task {
  id: string
  project_id: string
  status: string
  session_id: string | null
  created_at: string
}
export interface Prompt {
  id: string
  task_id: string
  prompt: string
  status: string
  created_at: string
  completed_at: string | null
}
export interface Frame {
  seq: number
  data: unknown
}

export const store = {
  createTask(id: string, projectId: string): void {
    db.prepare(`INSERT INTO tasks (id, project_id) VALUES (?, ?)`).run(id, projectId)
  },
  getTask(id: string): Task | undefined {
    return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Task | undefined
  },
  setTaskSession(id: string, sessionId: string): void {
    db.prepare(`UPDATE tasks SET session_id = ? WHERE id = ? AND session_id IS NULL`).run(sessionId, id)
  },
  setTaskStatus(id: string, status: string): void {
    db.prepare(`UPDATE tasks SET status = ? WHERE id = ?`).run(status, id)
  },

  createPrompt(id: string, taskId: string, prompt: string): void {
    db.prepare(`INSERT INTO prompts (id, task_id, prompt) VALUES (?, ?, ?)`).run(id, taskId, prompt)
  },
  getPrompt(id: string): Prompt | undefined {
    return db.prepare(`SELECT * FROM prompts WHERE id = ?`).get(id) as Prompt | undefined
  },
  listPrompts(taskId: string): Prompt[] {
    return db.prepare(`SELECT * FROM prompts WHERE task_id = ? ORDER BY created_at`).all(taskId) as Prompt[]
  },
  finishPrompt(id: string, status: string): void {
    db.prepare(
      `UPDATE prompts SET status = ?, completed_at = datetime('now') WHERE id = ? AND status = 'running'`,
    ).run(status, id)
  },

  appendFrame(promptId: string, seq: number, data: unknown): void {
    db.prepare(`INSERT INTO frames (prompt_id, seq, data) VALUES (?, ?, ?)`).run(
      promptId,
      seq,
      JSON.stringify(data),
    )
  },
  framesSince(promptId: string, fromSeq: number): Frame[] {
    const rows = db
      .prepare(`SELECT seq, data FROM frames WHERE prompt_id = ? AND seq > ? ORDER BY seq`)
      .all(promptId, fromSeq) as { seq: number; data: string }[]
    return rows.map((r) => ({ seq: r.seq, data: JSON.parse(r.data) }))
  },
}

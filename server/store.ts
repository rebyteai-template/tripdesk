/**
 * Storage contract. The whole app talks to this async `Store` interface and never
 * to a concrete database — so the driver swaps freely (the template's "switch the
 * DB whenever" goal; mirrors adits). It is ASYNC because the production targets are
 * async: Cloudflare D1 (primary deploy), Postgres (AWS RDS), MySQL (GCP Cloud SQL).
 * The local dev driver (better-sqlite3) is synchronous under the hood but presents
 * the same async surface, so call sites don't change when the DB does.
 *
 * Three tables mirror adits' turn model:
 *   tasks   — one booking conversation (claude session id / rebyte relay task id)
 *   prompts — one agent turn within a task
 *   frames  — one stream-json line of agent output, ordered by seq
 */
export interface Task {
  id: string
  project_id: string
  status: string
  session_id: string | null
  relay_task_id: string | null
  user_email: string | null
  created_at: string
}

/** Lightweight conversation row for the per-user session list (sidebar). */
export interface TaskSummary {
  id: string
  status: string
  created_at: string
  title: string
}

/** A user's pre-seeded sandbox (agent_computers row). */
export interface AgentComputerRow {
  id: string
  sandboxId: string | null
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

export interface Store {
  createTask(id: string, projectId: string, userEmail: string): Promise<void>
  getTask(id: string): Promise<Task | undefined>
  listTasksByUser(userEmail: string): Promise<TaskSummary[]>
  setTaskSession(id: string, sessionId: string): Promise<void>
  setTaskStatus(id: string, status: string): Promise<void>
  setTaskRelayId(id: string, relayTaskId: string): Promise<void>

  getAgentComputer(userEmail: string): Promise<AgentComputerRow | undefined>
  /** Idempotent (INSERT OR IGNORE): first writer per email wins, losers no-op. */
  saveAgentComputer(userEmail: string, acId: string, sandboxId: string | null): Promise<void>

  createPrompt(id: string, taskId: string, prompt: string): Promise<void>
  getPrompt(id: string): Promise<Prompt | undefined>
  listPrompts(taskId: string): Promise<Prompt[]>
  finishPrompt(id: string, status: string): Promise<void>

  appendFrame(promptId: string, seq: number, data: unknown): Promise<void>
  framesSince(promptId: string, fromSeq: number): Promise<Frame[]>
}

/** Which driver server/db.ts instantiates. The SQLite family (sqlite/d1) shares
 *  SQL verbatim; pg/mysql need a dialect driver. */
export type DbDriver = 'sqlite' | 'd1' | 'pg' | 'mysql'

const BASE = '/api/app'

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, init)
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${r.status}`)
  return r.json() as Promise<T>
}
const postJson = <T>(path: string, body: unknown): Promise<T> =>
  json<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export interface PromptContent {
  id: string
  prompt: string
  status?: string
  frames: { seq: number; data: unknown }[]
}

/** One conversation in the per-user session list. */
export interface SessionSummary {
  id: string
  status: string
  created_at: string
  title: string
}

/** The signed-in user (from Cloudflare Access). 401 → not authenticated. */
export const getMe = (): Promise<{ email: string }> => json('/me')

/** The caller's sessions (newest first). */
export async function listSessions(): Promise<SessionSummary[]> {
  return (await json<{ tasks: SessionSummary[] }>('/tasks')).tasks
}

export const createTask = (prompt: string): Promise<{ taskId: string; promptId: string }> =>
  postJson('/tasks', { prompt })

export const followup = (taskId: string, prompt: string): Promise<{ promptId: string }> =>
  postJson(`/tasks/${taskId}/prompts`, { prompt })

export async function loadContent(
  taskId: string,
): Promise<{ task: { id: string; status: string }; prompts: PromptContent[] } | null> {
  const r = await fetch(`${BASE}/tasks/${taskId}/content`)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`loadContent failed: ${r.status}`)
  return r.json()
}

/** Streams frames for a prompt. Calls onFrame per frame, onDone when the turn
 *  ends. Returns a stop() to close early. */
export function streamPrompt(
  promptId: string,
  onFrame: (seq: number, data: unknown) => void,
  onDone: (status: string) => void,
): () => void {
  const es = new EventSource(`${BASE}/prompts/${promptId}/stream`)
  es.onmessage = (e) => {
    const seq = Number(e.lastEventId) || 0
    try { onFrame(seq, JSON.parse(e.data)) } catch { /* ignore malformed */ }
  }
  es.addEventListener('done', (e) => {
    es.close()
    try { onDone(JSON.parse((e as MessageEvent).data).status) } catch { onDone('completed') }
  })
  es.onerror = () => { /* EventSource auto-reconnects with Last-Event-ID */ }
  return () => es.close()
}

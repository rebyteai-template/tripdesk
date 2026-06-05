const BASE = '/api/app'

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
export async function getMe(): Promise<{ email: string }> {
  const r = await fetch(`${BASE}/me`)
  if (!r.ok) throw new Error(`me failed: ${r.status}`)
  return r.json()
}

/** The caller's sessions (newest first). */
export async function listSessions(): Promise<SessionSummary[]> {
  const r = await fetch(`${BASE}/tasks`)
  if (!r.ok) throw new Error(`listSessions failed: ${r.status}`)
  const d = (await r.json()) as { tasks: SessionSummary[] }
  return d.tasks
}

export async function createTask(prompt: string): Promise<{ taskId: string; promptId: string }> {
  const r = await fetch(`${BASE}/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  if (!r.ok) throw new Error(`createTask failed: ${r.status}`)
  return r.json()
}

export async function followup(taskId: string, prompt: string): Promise<{ promptId: string }> {
  const r = await fetch(`${BASE}/tasks/${taskId}/prompts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  if (!r.ok) throw new Error(`followup failed: ${r.status}`)
  return r.json()
}

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

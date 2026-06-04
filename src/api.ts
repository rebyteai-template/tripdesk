const BASE = '/api/app'

export interface PromptContent {
  id: string
  prompt: string
  status?: string
  frames: { seq: number; data: unknown }[]
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

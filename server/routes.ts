/**
 * HTTP API, mounted at /api/app. Single-user, no auth (M1 local).
 *
 *   POST /tasks                 → create task + first turn
 *   POST /tasks/:id/prompts     → follow-up turn (same session)
 *   GET  /tasks/:id/content     → prompts + their frames (for reload)
 *   GET  /prompts/:id/stream    → SSE of frames until the turn ends
 *   POST /prompts/:id/cancel    → SIGTERM the running turn
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { randomUUID } from 'node:crypto'
import { store } from './db.ts'
import { DEFAULT_PROJECT_ID, ensureProject } from './project.ts'
import { runTurn, cancelTurn } from './task-runner.ts'

export const app = new Hono()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

app.post('/tasks', async (c) => {
  const { prompt } = await c.req.json<{ prompt?: string }>()
  if (!prompt?.trim()) return c.json({ error: 'prompt is required' }, 400)

  ensureProject(DEFAULT_PROJECT_ID)
  const taskId = randomUUID()
  const promptId = randomUUID()
  store.createTask(taskId, DEFAULT_PROJECT_ID)
  store.createPrompt(promptId, taskId, prompt)
  runTurn(taskId, DEFAULT_PROJECT_ID, promptId, prompt)

  return c.json({ taskId, promptId })
})

app.post('/tasks/:id/prompts', async (c) => {
  const taskId = c.req.param('id')
  const task = store.getTask(taskId)
  if (!task) return c.json({ error: 'task not found' }, 404)

  const { prompt } = await c.req.json<{ prompt?: string }>()
  if (!prompt?.trim()) return c.json({ error: 'prompt is required' }, 400)

  const promptId = randomUUID()
  store.createPrompt(promptId, taskId, prompt)
  store.setTaskStatus(taskId, 'running')
  runTurn(taskId, task.project_id, promptId, prompt)

  return c.json({ promptId })
})

app.get('/tasks/:id/content', (c) => {
  const taskId = c.req.param('id')
  const task = store.getTask(taskId)
  if (!task) return c.json({ error: 'task not found' }, 404)

  const prompts = store.listPrompts(taskId).map((p) => ({
    id: p.id,
    prompt: p.prompt,
    status: p.status,
    frames: store.framesSince(p.id, 0),
  }))
  return c.json({ task: { id: task.id, status: task.status }, prompts })
})

app.get('/prompts/:id/stream', (c) => {
  const promptId = c.req.param('id')
  const fromSeq = Number(c.req.query('fromSeq') ?? c.req.header('Last-Event-ID') ?? 0) || 0

  return streamSSE(c, async (stream) => {
    let aborted = false
    stream.onAbort(() => { aborted = true })

    let lastSeq = fromSeq
    while (!aborted) {
      const frames = store.framesSince(promptId, lastSeq)
      for (const f of frames) {
        await stream.write(`id: ${f.seq}\ndata: ${JSON.stringify(f.data)}\n\n`)
        lastSeq = f.seq
      }
      const p = store.getPrompt(promptId)
      if (p && p.status !== 'running') {
        // drain any frames written between the query and the status read
        const tail = store.framesSince(promptId, lastSeq)
        for (const f of tail) {
          await stream.write(`id: ${f.seq}\ndata: ${JSON.stringify(f.data)}\n\n`)
          lastSeq = f.seq
        }
        await stream.write(`event: done\ndata: ${JSON.stringify({ status: p.status })}\n\n`)
        return
      }
      await sleep(150)
    }
  })
})

app.post('/prompts/:id/cancel', (c) => {
  const ok = cancelTurn(c.req.param('id'))
  return c.json({ ok })
})

/**
 * Connectivity spike: prove the rebyte relay runs an agent that reaches
 * TravelKit, end-to-end, and learn the live-event contract.
 *
 *   ensureDefaultAgentComputer()  → provision/boot a sandbox VM
 *   seedTravelkit(ac)             → write .mcp.json + skill into /code
 *   POST /tasks {prompt,wsId,executor,model} → relay starts the agent
 *   GET  /tasks/:id/events (Accept: text/event-stream) → live relay events
 *
 * Relay event envelope: {seq,timestamp,promptId,eventType,payload}. Events are
 * ONLY on the live stream — /content?include=events is empty post-run — so the
 * real task-runner must mirror them into our own frames table as they arrive.
 *
 * Run: node --env-file=.env.local --import tsx server/rebyte/spike.ts ["prompt"]
 */
import { ensureDefaultAgentComputer } from './provision.ts'
import { seedTravelkit } from './seed.ts'
import { rebyteJSON, rebyteFetch } from './client.ts'

const PROMPT = process.argv.slice(2).join(' ')
  || '请使用 travelkit 搜索 2026-06-05 北京到上海的机票，1 名成人，直飞，给我看几个选项。'
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

const seenTypes = new Set<string>()
const finalText: string[] = []

function summarize(ev: Record<string, unknown>, toolNames: Map<string, string>): boolean {
  const type = String(ev.eventType ?? '?')
  seenTypes.add(type)
  const p = isObj(ev.payload) ? ev.payload : {}
  switch (type) {
    case 'init': console.log(`  · init model=${p.model} cwd=${p.cwd}`); return false
    case 'thinking': console.log(`  🤔 ${String(p.content ?? p.thinking ?? '').slice(0, 100)}`); return false
    case 'text': case 'assistant': case 'message': case 'response': {
      const t = String(p.content ?? p.text ?? '')
      if (t.trim()) { finalText.push(t); console.log(`  💬 ${t.slice(0, 160)}`) }
      return false
    }
    case 'tool_use': {
      const name = String(p.name ?? p.tool_name ?? '?'); const id = String(p.id ?? p.tool_id ?? '')
      if (id) toolNames.set(id, name)
      console.log(`  🔧 tool_use ${name} ${JSON.stringify(p.input ?? p.params ?? {}).slice(0, 140)}`)
      return name.includes('flight_search') || name.includes('flight_verify')
    }
    case 'tool_result': {
      const id = String(p.id ?? p.tool_id ?? ''); const name = toolNames.get(id) ?? '?'
      const out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '')
      console.log(`  📦 tool_result ← ${name} (${out.length} chars)`)
      if (name.includes('flight_search')) console.log(`  ──── output head ────\n${out.slice(0, 500)}\n  ────`)
      return false
    }
    case 'result': console.log(`  · result ${JSON.stringify(p).slice(0, 2500)}`); return false
    default: console.log(`  · ${type} ${JSON.stringify(p).slice(0, 2000)}`); return false
  }
}

async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader(); const dec = new TextDecoder('utf-8')
  let buf = '', event = 'message', dataLines: string[] = []
  const flush = () => {
    if (!dataLines.length && event === 'message') return null
    const s = dataLines.join('\n'); let data: unknown = s
    if (s) { try { data = JSON.parse(s) } catch { /* keep string */ } }
    const ev = { event, data }; event = 'message'; dataLines = []; return ev
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 1)
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      if (line === '') { const ev = flush(); if (ev) yield ev; continue }
      if (line.startsWith(':')) continue
      const c = line.indexOf(':')
      const field = c === -1 ? line : line.slice(0, c)
      const val = c === -1 ? '' : line.slice(c + 1).replace(/^ /, '')
      if (field === 'event') event = val
      else if (field === 'data') dataLines.push(val)
    }
  }
  const ev = flush(); if (ev) yield ev
}

async function main() {
  console.log('[spike] 1/4 ensure agent-computer (VM)…')
  const ac = await ensureDefaultAgentComputer()
  console.log(`[spike]     VM id=${ac.id} sandboxId=${ac.sandboxId}`)

  console.log('[spike] 2/4 seeding travelkit config into /code…')
  const files = await seedTravelkit(ac)
  console.log(`[spike]     seeded ${files.length} files`)

  console.log(`[spike] 3/4 POST /tasks (executor=claude)…`)
  const task = await rebyteJSON<{ id: string; status?: string; url?: string }>('/tasks', {
    method: 'POST',
    body: JSON.stringify({ prompt: PROMPT, workspaceId: ac.id, executor: 'claude', model: 'claude-sonnet-4.6' }),
  })
  console.log(`[spike]     task=${task.id}  ${task.url ?? ''}`)

  console.log('[spike] 4/4 streaming /events (reconnect on empty-done race)…')
  const toolNames = new Map<string, string>()
  let sawSearch = false, n = 0
  const timer = setTimeout(() => { console.error('[spike] timeout'); process.exit(2) }, 240_000)

  // The relay returns an immediate done (lastSeq:-1) if we connect before it has
  // emitted anything; once the agent starts, /events replays from seq 0. So
  // reconnect on empty-done until we get events or the task is truly terminal.
  for (let attempt = 0; attempt < 90; attempt++) {
    const res = await rebyteFetch(`/tasks/${task.id}/events`, { headers: { Accept: 'text/event-stream' } })
    if (!res.ok || !res.body) { console.error('open failed', res.status, await res.text()); process.exit(1) }
    let got = 0
    for await (const ev of parseSSE(res.body)) {
      if (ev.event === 'done') {
        if (got > 0) { console.log(`[spike] event:done ${JSON.stringify(ev.data)}`) }
        break
      }
      got++; n++
      if (isObj(ev.data) && summarize(ev.data, toolNames)) sawSearch = true
    }
    if (got > 0) break // got the (replayed-from-0) stream; done
    const st = await rebyteJSON<{ status?: string }>(`/tasks/${task.id}`).catch(() => ({ status: '?' }))
    if (['completed', 'failed', 'canceled'].includes(st.status ?? '') && attempt >= 3) {
      console.log(`[spike] task ${st.status} with no streamed events (attempt ${attempt})`); break
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  clearTimeout(timer)
  console.log(`\n[spike] stream ended. events=${n} eventTypes=${JSON.stringify([...seenTypes])}`)
  if (finalText.length) console.log(`[spike] final agent text:\n${finalText.join('').slice(0, 800)}`)
  console.log(sawSearch
    ? '\n✅ SPIKE PASS: agent 在 rebyte VM 调到 travelkit flight_search，事件契约已捕获。'
    : '\n⚠️ 未见 flight_search —— 见上方事件。')
  process.exit(0)
}
main().catch((e) => { console.error('[spike] ERROR:', e?.stack || e?.message || e); process.exit(1) })

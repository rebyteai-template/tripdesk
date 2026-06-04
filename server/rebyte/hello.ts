/** Dead-simple rebyte round-trip: POST /v1/tasks {prompt} with the org key,
 *  stream /events, print what comes back. No agent-computer, no seed, no
 *  workspaceId. Just prove the key reaches rebyte and the agent replies.
 *  Run: node --env-file=.env.local --import tsx server/rebyte/hello.ts ["prompt"]
 */
import { rebyteJSON, rebyteFetch } from './client.ts'

const PROMPT = process.argv.slice(2).join(' ') || '请用一句话介绍你自己。'
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

async function* parseSSE(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader(); const dec = new TextDecoder()
  let buf = '', event = 'message', data: string[] = []
  const flush = () => { if (!data.length && event === 'message') return null; const s = data.join('\n'); let d: unknown = s; if (s) { try { d = JSON.parse(s) } catch { /* */ } } const e = { event, data: d }; event = 'message'; data = []; return e }
  for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true })
    let i: number; while ((i = buf.indexOf('\n')) >= 0) { const raw = buf.slice(0, i); buf = buf.slice(i + 1); const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      if (line === '') { const e = flush(); if (e) yield e; continue }
      if (line.startsWith(':')) continue
      const c = line.indexOf(':'); const f = c === -1 ? line : line.slice(0, c); const v = c === -1 ? '' : line.slice(c + 1).replace(/^ /, '')
      if (f === 'event') event = v; else if (f === 'data') data.push(v) } }
  const e = flush(); if (e) yield e
}

async function main() {
  console.log(`POST /v1/tasks  prompt="${PROMPT}"`)
  const task = await rebyteJSON<{ id: string; url?: string; status?: string }>('/tasks', {
    method: 'POST', body: JSON.stringify({ prompt: PROMPT }),
  })
  console.log(`→ task ${task.id}  status=${task.status}  ${task.url ?? ''}`)

  console.log('streaming /events …')
  for (let attempt = 0; attempt < 90; attempt++) {
    const res = await rebyteFetch(`/tasks/${task.id}/events`, { headers: { Accept: 'text/event-stream' } })
    if (!res.ok || !res.body) { console.error('open failed', res.status, await res.text()); process.exit(1) }
    let got = 0
    for await (const ev of parseSSE(res.body)) {
      if (ev.event === 'done') { if (got) { console.log(`\nDONE ${JSON.stringify(ev.data)}`) } break }
      got++
      if (isObj(ev.data)) {
        const t = ev.data.eventType; const p = isObj(ev.data.payload) ? ev.data.payload : {}
        console.log(`  [${t}] ${JSON.stringify(p).slice(0, 400)}`)
      }
    }
    if (got > 0) { console.log('\n✅ rebyte 通了：agent 有产出（见上）。'); process.exit(0) }
    const st = await rebyteJSON<{ status?: string }>(`/tasks/${task.id}`).catch(() => ({ status: '?' }))
    if (['completed', 'failed', 'canceled'].includes(st.status ?? '') && attempt >= 3) {
      console.log(`task ${st.status}, still 0 events after ${attempt} retries`); break
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  console.log('\n⚠️ 没拿到事件 — 见上面状态。')
  process.exit(0)
}
main().catch((e) => { console.error('ERROR', e?.stack || e?.message || e); process.exit(1) })

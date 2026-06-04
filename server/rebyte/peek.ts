/**
 * Fetch a relay task's recorded events via /tasks/:id/content?include=events
 * and dump them, decoding the relay envelope {seq, eventType, payload}.
 * Run: node --env-file=.env.local --import tsx server/rebyte/peek.ts <taskId>
 */
import { rebyteJSON } from './client.ts'

const taskId = process.argv[2]
if (!taskId) { console.error('usage: peek.ts <taskId>'); process.exit(1) }
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

interface RelayEvent { seq?: number; eventType?: string; payload?: Record<string, unknown> }
interface RelayContent {
  id: string; status: string
  prompts: Array<{ id: string; status: string; userPrompt: string; events?: RelayEvent[] }>
}

function dumpEvent(ev: RelayEvent, toolNames: Map<string, string>): boolean {
  const p = isObj(ev.payload) ? ev.payload : {}
  switch (ev.eventType) {
    case 'init': console.log(`  · init model=${p.model} cwd=${p.cwd}`); return false
    case 'thinking': console.log(`  🤔 ${String(p.content ?? p.thinking ?? '').slice(0, 120)}`); return false
    case 'text': case 'assistant': case 'message':
      console.log(`  💬 ${String(p.content ?? p.text ?? '').slice(0, 200)}`); return false
    case 'tool_use': {
      const name = String(p.name ?? p.tool_name ?? '?'); const id = String(p.id ?? p.tool_id ?? '')
      if (id) toolNames.set(id, name)
      console.log(`  🔧 tool_use ${name} ${JSON.stringify(p.input ?? p.params ?? {}).slice(0, 160)}`)
      return name.includes('flight_search') || name.includes('flight_verify')
    }
    case 'tool_result': {
      const id = String(p.id ?? p.tool_id ?? ''); const name = toolNames.get(id) ?? '?'
      const out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output)
      console.log(`  📦 tool_result ← ${name}  (${out?.length ?? 0} chars)`)
      return false
    }
    default: console.log(`  · ${ev.eventType ?? '?'} keys=[${Object.keys(p).join(',')}]`); return false
  }
}

async function main() {
  const rc = await rebyteJSON<RelayContent>(`/tasks/${taskId}/content?include=events`)
  console.log(`task ${rc.id} status=${rc.status} prompts=${rc.prompts.length}`)
  const toolNames = new Map<string, string>()
  let sawSearch = false
  for (const pr of rc.prompts) {
    const evs = pr.events ?? []
    const counts: Record<string, number> = {}
    for (const e of evs) counts[e.eventType ?? '?'] = (counts[e.eventType ?? '?'] ?? 0) + 1
    console.log(`\n── prompt status=${pr.status} events=${evs.length}  types=${JSON.stringify(counts)}`)
    for (const e of evs) if (dumpEvent(e, toolNames)) sawSearch = true
  }
  console.log(sawSearch ? '\n✅ flight_search/verify reached on rebyte' : '\n⚠️ no flight tool calls found')
}
main().catch((e) => { console.error('ERROR', e?.stack || e?.message || e); process.exit(1) })

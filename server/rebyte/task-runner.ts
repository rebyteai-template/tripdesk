/**
 * Rebyte backend task-runner: the drop-in twin of the local server/task-runner.ts,
 * but the agent runs on the Rebyte relay (a sandbox VM) instead of a local
 * `spawn claude`. It keeps the SAME contract — runTurn() fires and returns, frames
 * land in the `frames` table as relay events arrive; cancelTurn() stops the turn —
 * so the backend selector (server/backend.ts) swaps the two with zero route changes.
 *
 *   runTurn() → ensure VM → seed travelkit → POST /tasks → stream /events
 *             → translate {seq,eventType,payload} into stream-json frames → finish
 *
 * Frame fidelity: the bench (src/frames.ts) only understands claude stream-json
 * (assistant/user tool_use + tool_result blocks). The relay speaks a different
 * envelope, so we TRANSLATE each event into that shape — tool_use → assistant
 * tool_use block, text → assistant text block, tool_result → user tool_result
 * block — and the frontend cards render unchanged.
 *
 * ⚠️ Known gap (agent-loop nesting): on the relay's agent-loop architecture the
 * manager DELEGATES to a sandbox coding sub-agent, and travelkit flight_search /
 * flight_verify_solution run NESTED inside that sub-agent. The public /events
 * stream is filtered to the parent task, so it surfaces the `coding_agent__…`
 * delegation + final text but NOT the flight_search tool_result. Net: chat renders,
 * but the search/verify bench cards won't light up from a delegated turn until
 * those nested tool_results are surfaced (open decision — see STATUS / memory).
 * The translator below already maps flight_search/verify tool_results straight to
 * the cards the moment they appear at the parent level (direct-call path, or once
 * the relay stops filtering sub-agent events).
 */
import { randomUUID } from 'node:crypto'
import { store } from '../db.ts'
import { isObj, parseSSE } from './sse.ts'
import type { AgentComputer } from './provision.ts'

// executor/model are ignored by the relay (agent-loop is hardwired); sent only to
// mirror the proven spike call exactly.
const MODEL = 'claude-sonnet-4.6'
const STREAM_TIMEOUT_MS = 240_000

/** Prepended to the relay prompt so the hosted agent uses the travelkit skill + MCP
 *  (NOT web search / fabrication) and follows the booking red-lines. The local
 *  backend injects this via --append-system-prompt; the relay's POST /tasks has no
 *  system-prompt field, so (like server/rebyte/spike.ts) we put it in the prompt.
 *  The UI still shows only the user's original prompt — that's stored separately. */
const REBYTE_INSTRUCTION = [
  '你是 TripDesk 的机票预订助手。对所有机票相关请求，必须使用沙箱 /code 里的 travelkit skill 与 travelkit MCP 工具',
  '（flight_search / flight_verify_solution / flight_create_order / flight_pay_order 等）来完成；',
  '严禁用网页搜索或凭记忆编造航班、价格、时刻——只认 travelkit 工具返回的真实数据。',
  '红线：先搜索→实时验价→验价通过后再收乘客证件；下单/支付/退改等写操作必须经用户明确确认；',
  '绝不向用户暴露 solutionId / orderKey / PNR / 票号等内部字段。默认用简体中文回复。',
  '沙箱/演示模式：可搜索、验价、下单、发起支付（发起支付会返回第三方支付链接给用户自行完成）；',
  '绝不替用户在第三方平台完成付款，也绝不谎称已支付。',
].join('')

interface Turn {
  abort: AbortController
  relayTaskId?: string
}
const running = new Map<string, Turn>()
const seqCounters = new Map<string, number>()
/** Sandboxes seeded this process — seeding is idempotent but slow, so do it once. */
const seededSandboxes = new Set<string>()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function nextSeq(promptId: string): number {
  const n = (seqCounters.get(promptId) ?? 0) + 1
  seqCounters.set(promptId, n)
  return n
}
// Frames are emitted sequentially from the awaited SSE loop, so awaiting each
// store write in place preserves order without a separate write queue.
function emit(promptId: string, data: unknown): Promise<void> {
  return store.appendFrame(promptId, nextSeq(promptId), data)
}

// ── relay event → claude stream-json frame translation ──────────────────
async function emitAssistantText(promptId: string, text: string): Promise<void> {
  if (!text.trim()) return
  await emit(promptId, { type: 'assistant', message: { content: [{ type: 'text', text }] } })
}
async function emitToolUse(promptId: string, id: string, name: string, input: unknown): Promise<void> {
  await emit(promptId, { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: input ?? {} }] } })
}
async function emitToolResult(promptId: string, toolUseId: string, output: unknown): Promise<void> {
  // src/frames.ts feeds tool_result `content` through textFromContent → JSON.parse,
  // so the raw JSON string is exactly what it wants.
  const content = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  await emit(promptId, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] } })
}

/** Translate one relay event into stream-json frame(s). Returns any assistant text
 *  it produced, so the caller can tell whether the final answer already streamed. */
async function translate(promptId: string, ev: Record<string, unknown>): Promise<string> {
  const type = String(ev.eventType ?? '')
  const p = isObj(ev.payload) ? ev.payload : {}
  switch (type) {
    case 'text': case 'assistant': case 'message': case 'response': {
      const t = String(p.content ?? p.text ?? '')
      await emitAssistantText(promptId, t)
      return t
    }
    case 'tool_use': {
      const name = String(p.name ?? p.tool_name ?? '')
      const id = String(p.id ?? p.tool_id ?? '') || randomUUID()
      await emitToolUse(promptId, id, name, p.input ?? p.params ?? {})
      return ''
    }
    case 'tool_result': {
      const id = String(p.id ?? p.tool_id ?? '')
      await emitToolResult(promptId, id, p.output)
      return ''
    }
    default:
      // thinking / init / result / anything else: a debug-only passthrough frame,
      // ignored by the bench deriver but visible in the raw replayed stream.
      await emit(promptId, { __relay: type || 'unknown', payload: p })
      return ''
  }
}

/** Relay terminal status → our prompt/task status vocabulary. */
function mapStatus(relayStatus: string): string {
  if (relayStatus === 'succeeded' || relayStatus === 'completed') return 'completed'
  if (relayStatus === 'canceled' || relayStatus === 'cancelled') return 'canceled'
  return 'failed'
}

async function finish(taskId: string, promptId: string, status: string): Promise<void> {
  if (!running.has(promptId)) return // already finalized (cancel/error race)
  running.delete(promptId)
  seqCounters.delete(promptId)
  await store.finishPrompt(promptId, status)
  await store.setTaskStatus(taskId, status)
}

/** Fire-and-forget, mirroring the local runner: returns immediately, frames land
 *  as relay events arrive, status flips when the relay task ends. */
export function runTurn(taskId: string, _projectId: string, promptId: string, prompt: string): void {
  const abort = new AbortController()
  running.set(promptId, { abort })
  void drive(taskId, promptId, prompt, abort).catch(async (e: unknown) => {
    if (!abort.signal.aborted) await emit(promptId, { __error: e instanceof Error ? e.message : String(e) })
    await finish(taskId, promptId, abort.signal.aborted ? 'canceled' : 'failed')
  })
}

async function drive(taskId: string, promptId: string, prompt: string, abort: AbortController): Promise<void> {
  // Lazy-load the rebyte SDK surface (sandbox SDK is heavy) so local-mode boot
  // never touches it — the selector still statically imports this module.
  const { ensureDefaultAgentComputer } = await import('./provision.ts')
  const { seedTravelkit } = await import('./seed.ts')
  const { rebyteJSON, rebyteFetch } = await import('./client.ts')

  const ac: AgentComputer = await ensureDefaultAgentComputer()
  if (!seededSandboxes.has(ac.sandboxId)) {
    await seedTravelkit(ac)
    seededSandboxes.add(ac.sandboxId)
  }
  if (abort.signal.aborted) return finish(taskId, promptId, 'canceled')

  // Prepend the travelkit instruction so the relay agent uses the skill, not web
  // search. UI still shows the bare user prompt (stored separately in routes).
  const relayPrompt = `${REBYTE_INSTRUCTION}\n\n用户需求：\n${prompt}`
  const task = await rebyteJSON<{ id: string }>('/tasks', {
    method: 'POST',
    body: JSON.stringify({ prompt: relayPrompt, workspaceId: ac.id, executor: 'claude', model: MODEL }),
  })
  const relayTaskId = task.id
  const turn = running.get(promptId)
  if (turn) turn.relayTaskId = relayTaskId
  await store.setTaskRelayId(taskId, relayTaskId)

  // Stream /events. The relay returns an immediate done (lastSeq -1) when we
  // connect before it has emitted anything; once the agent starts, /events replays
  // from seq 0. So reconnect on empty-done until we get events or the task is
  // terminal (ported from server/rebyte/spike.ts, which proved this path).
  let sawText = false
  let doneStatus = ''
  let finalResult = ''
  const deadline = Date.now() + STREAM_TIMEOUT_MS

  for (let attempt = 0; attempt < 120 && !abort.signal.aborted && Date.now() < deadline; attempt++) {
    const res = await rebyteFetch(`/tasks/${relayTaskId}/events`, {
      headers: { Accept: 'text/event-stream' },
      signal: abort.signal,
    })
    if (res.status === 401 || res.status === 403) {
      await emit(promptId, { __error: `rebyte 鉴权失败 (${res.status})；检查 REBYTE_API_KEY / 模型授权。` })
      break
    }
    if (!res.ok || !res.body) { await sleep(1000); continue }

    let got = 0
    for await (const msg of parseSSE(res.body)) {
      if (msg.event === 'done') {
        if (got > 0 && isObj(msg.data)) {
          doneStatus = String(msg.data.status ?? '')
          if (typeof msg.data.finalResult === 'string') finalResult = msg.data.finalResult
        }
        break
      }
      got++
      if (isObj(msg.data) && (await translate(promptId, msg.data)).trim()) sawText = true
    }
    if (got > 0) break

    const st = await rebyteJSON<{ status?: string }>(`/tasks/${relayTaskId}`).catch(() => ({}) as { status?: string })
    if (attempt >= 3 && ['completed', 'failed', 'canceled', 'succeeded'].includes(String(st.status ?? ''))) {
      doneStatus = String(st.status)
      break
    }
    await sleep(1000)
  }

  if (abort.signal.aborted) return finish(taskId, promptId, 'canceled')
  // If the answer only came back in done.finalResult (no streamed text events), surface it.
  if (!sawText && finalResult.trim()) await emitAssistantText(promptId, finalResult)
  await finish(taskId, promptId, mapStatus(doneStatus))
}

export function cancelTurn(promptId: string): boolean {
  const turn = running.get(promptId)
  if (!turn) return false
  turn.abort.abort() // stops our /events consumption; drive() finalizes as canceled
  // Best-effort relay-side cancel (endpoint unconfirmed; local abort already stops
  // our side, so swallow any failure).
  if (turn.relayTaskId) {
    const id = turn.relayTaskId
    void import('./client.ts')
      .then(({ rebyteFetch }) => rebyteFetch(`/tasks/${id}/cancel`, { method: 'POST' }))
      .catch(() => {})
  }
  return true
}

/**
 * TaskDO — the per-task agent runner, as an ALARM-DRIVEN Durable Object (one per taskId).
 *
 * Why alarms: a turn streams the rebyte relay for up to minutes, but `ctx.waitUntil`
 * does NOT keep a DO alive after the triggering request returns — the work gets evicted
 * mid-turn and the task orphans at 'running'. The runtime DOES guarantee `alarm()` runs
 * (and keeps the DO alive while it executes), so the turn lives in alarm() and advances in
 * short, safe windows. Progress (relayTaskId, lastRelaySeq) is persisted in DO storage, so a
 * retried/resumed alarm continues idempotently rather than re-POSTing the relay task.
 *
 *   runTurn() → persist intent + setAlarm(now)
 *   alarm()   → ensure relay task → stream a bounded /events window → translate → frames(D1)
 *             → finalize when the relay task is terminal (or on timeout)
 *
 * Pure fetch: never imports the rebyte-sandbox SDK. Per-user sandbox is looked up by email
 * (agent_computers table), falling back to the legacy single kv.agent_computer. Frame fidelity
 * matches src/frames.ts (assistant tool_use/text, user tool_result). Note REBYTE-ISSUE.md:
 * through the agent-loop only the manager's text summary reaches the parent — bench cards
 * won't populate — so in practice we deliver delegation + summary text, reliably finalized.
 */
import { DurableObject } from 'cloudflare:workers'
import { createD1Store } from '../server/db.ts'
import type { Store } from '../server/store.ts'
import { isObj, parseSSE } from '../server/rebyte/sse.ts'
import { rebyteJSON, rebyteFetch, type RebyteConfig } from '../server/rebyte/client.ts'
import { provisionComputer, seedSandbox } from './seed.ts'
import type { Env } from './env.ts'

const MODEL = 'claude-sonnet-4.6'
const TURN_TIMEOUT_MS = 240_000 // hard ceiling for a whole turn
const WINDOW_MS = 20_000 // per-alarm streaming window — short enough to never risk eviction
const DEFAULT_API_URL = 'https://api.rebyte.ai/v1'
const TERMINAL = new Set(['completed', 'succeeded', 'failed', 'canceled', 'cancelled'])

/** Relay event envelope (live /events + /content?include=events): {seq,eventType,payload}. */
interface RelayEvent {
  seq?: number
  eventType?: string
  payload?: Record<string, unknown>
}

/** The in-flight turn, persisted in DO storage so alarm() resumes idempotently. */
interface TurnState {
  taskId: string
  promptId: string
  prompt: string
  userEmail: string
  relayTaskId?: string
  lastRelaySeq: number
  sawText: boolean
  deadline: number
}

/** Prepended to the relay prompt so the hosted agent uses the travelkit skill + MCP (not
 *  web search / fabrication) and follows the booking red-lines. The UI shows only the user's
 *  original prompt (stored separately by routes). */
const REBYTE_INSTRUCTION = [
  '你是 TripDesk 的机票预订助手。对所有机票相关请求，必须使用沙箱 /code 里的 travelkit skill 与 travelkit MCP 工具',
  '（flight_search / flight_verify_solution / flight_create_order / flight_pay_order 等）来完成；',
  '严禁用网页搜索或凭记忆编造航班、价格、时刻——只认 travelkit 工具返回的真实数据。',
  '红线：先搜索→实时验价→验价通过后再收乘客证件；下单/支付/退改等写操作必须经用户明确确认；',
  '绝不向用户暴露 solutionId / orderKey / PNR / 票号等内部字段。默认用简体中文回复。',
  '沙箱/演示模式：可搜索、验价、下单、发起支付（发起支付会返回第三方支付链接给用户自行完成）；',
  '绝不替用户在第三方平台完成付款，也绝不谎称已支付。',
].join('')

interface CachedAgentComputer {
  id: string
  sandboxId?: string
}

export class TaskDO extends DurableObject<Env> {
  private store: Store = createD1Store(this.env.DB)
  /** D1-derived frame seq for the current window (set at window start, never in-memory across ticks). */
  private frameSeq = 0

  private rebyteConfig(): RebyteConfig {
    return { apiUrl: this.env.REBYTE_API_URL ?? DEFAULT_API_URL, apiKey: this.env.REBYTE_API_KEY }
  }

  // ── frame emission (durable seq from D1 so resumed ticks never collide) ──
  private emit(promptId: string, data: unknown): Promise<void> {
    return this.store.appendFrame(promptId, ++this.frameSeq, data)
  }
  private async maxFrameSeq(promptId: string): Promise<number> {
    const row = await this.env.DB.prepare(`SELECT COALESCE(MAX(seq),0) AS m FROM frames WHERE prompt_id = ?`)
      .bind(promptId)
      .first<{ m: number }>()
    return row?.m ?? 0
  }
  private async emitText(promptId: string, text: string): Promise<void> {
    if (!text.trim()) return
    await this.emit(promptId, { type: 'assistant', message: { content: [{ type: 'text', text }] } })
  }
  private async emitToolUse(promptId: string, id: string, name: string, input: unknown): Promise<void> {
    await this.emit(promptId, { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: input ?? {} }] } })
  }
  private async emitToolResult(promptId: string, toolUseId: string, output: unknown): Promise<void> {
    const content = typeof output === 'string' ? output : JSON.stringify(output ?? '')
    await this.emit(promptId, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] } })
  }

  /** Translate one relay event into stream-json frame(s). Returns assistant text produced. */
  private async translate(promptId: string, ev: RelayEvent): Promise<string> {
    const type = String(ev.eventType ?? '')
    const p = isObj(ev.payload) ? ev.payload : {}
    switch (type) {
      case 'text': case 'assistant': case 'message': case 'response': {
        const t = String(p.content ?? p.text ?? '')
        await this.emitText(promptId, t)
        return t
      }
      case 'tool_use': {
        const name = String(p.name ?? p.tool_name ?? '')
        const id = String(p.id ?? p.tool_id ?? '') || crypto.randomUUID()
        await this.emitToolUse(promptId, id, name, p.input ?? p.params ?? {})
        return ''
      }
      case 'tool_result': {
        await this.emitToolResult(promptId, String(p.id ?? p.tool_id ?? ''), p.output)
        return ''
      }
      default:
        await this.emit(promptId, { __relay: type || 'unknown', payload: p })
        return ''
    }
  }

  private mapStatus(relayStatus: string): string {
    if (relayStatus === 'succeeded' || relayStatus === 'completed') return 'completed'
    if (relayStatus === 'canceled' || relayStatus === 'cancelled') return 'canceled'
    return 'failed'
  }

  private async finalize(t: TurnState, status: string): Promise<void> {
    await this.store.finishPrompt(t.promptId, status) // no-op if already non-running
    await this.store.setTaskStatus(t.taskId, status)
    await this.ctx.storage.delete('turn')
    await this.ctx.storage.deleteAlarm()
  }

  /** Per-user sandbox, provisioned lazily on first use. Returns the user's cached
   *  agent_computers row; if none, provisions a fresh sandbox via the rebyte API, seeds
   *  travelkit into it (both pure fetch), persists it, and returns it. Concurrent first
   *  turns race on INSERT OR IGNORE — the loser's VM is orphaned (minor), both then use the
   *  winner's row. */
  private async agentComputerFor(email: string): Promise<CachedAgentComputer> {
    const existing = await this.store.getAgentComputer(email)
    if (existing?.id) return { id: existing.id, sandboxId: existing.sandboxId ?? undefined }

    const ac = await provisionComputer(this.rebyteConfig(), `tripdesk:${email || 'anon'}`)
    await seedSandbox(ac)
    await this.store.saveAgentComputer(email, ac.id, ac.sandboxId ?? null)
    // Re-read so concurrent provisioners converge on the same (winning) row.
    const canonical = await this.store.getAgentComputer(email)
    return canonical?.id ? { id: canonical.id, sandboxId: canonical.sandboxId ?? undefined } : { id: ac.id, sandboxId: ac.sandboxId }
  }

  // ── RPC surface (called from the Worker via env.TASK_DO.getByName(taskId)) ──
  /** Persist the turn intent and fire the alarm. Returns immediately; the alarm drives it. */
  async runTurn(taskId: string, promptId: string, prompt: string, userEmail = ''): Promise<void> {
    const t: TurnState = {
      taskId,
      promptId,
      prompt,
      userEmail,
      lastRelaySeq: 0,
      sawText: false,
      deadline: Date.now() + TURN_TIMEOUT_MS,
    }
    await this.ctx.storage.put('turn', t)
    await this.ctx.storage.setAlarm(Date.now())
  }

  /** Cancel the in-flight turn. The running alarm sees 'turn' gone and stops. */
  async cancel(promptId: string): Promise<boolean> {
    const t = await this.ctx.storage.get<TurnState>('turn')
    if (!t || t.promptId !== promptId) return false
    await this.finalize(t, 'canceled')
    return true
  }

  /** Drive one bounded window of the turn, then either finalize or re-arm the alarm. */
  async alarm(): Promise<void> {
    const t = await this.ctx.storage.get<TurnState>('turn')
    if (!t) return // canceled / already finalized
    const config = this.rebyteConfig()

    try {
      if (!t.relayTaskId) {
        const ac = await this.agentComputerFor(t.userEmail)
        const relayPrompt = `${REBYTE_INSTRUCTION}\n\n用户需求：\n${t.prompt}`
        const task = await rebyteJSON<{ id: string }>('/tasks', {
          method: 'POST',
          body: JSON.stringify({ prompt: relayPrompt, workspaceId: ac.id, executor: 'claude', model: MODEL }),
          config,
        })
        t.relayTaskId = task.id
        await this.store.setTaskRelayId(t.taskId, t.relayTaskId)
        await this.ctx.storage.put('turn', t)
        // Surface this turn's rebyte run so the UI can link to app.rebyte.ai/run/<id>.
        this.frameSeq = await this.maxFrameSeq(t.promptId)
        await this.emit(t.promptId, { __rebyte_run: t.relayTaskId })
      }

      const done = await this.streamWindow(t, config)
      if (done.terminal) {
        if (!t.sawText && done.finalResult?.trim()) await this.emitText(t.promptId, done.finalResult)
        return this.finalize(t, this.mapStatus(done.status ?? 'completed'))
      }

      // Window ended without a stream `done`. Ask the relay directly — finalize the moment
      // it's terminal (the live stream doesn't always send a clean done on delegated turns).
      const st = await rebyteJSON<{ status?: string; finalResult?: string }>(`/tasks/${t.relayTaskId}`, { config }).catch(
        () => ({}) as { status?: string; finalResult?: string },
      )
      if (st.status && TERMINAL.has(st.status)) {
        if (!t.sawText && st.finalResult?.trim()) await this.emitText(t.promptId, st.finalResult)
        return this.finalize(t, this.mapStatus(st.status))
      }

      if (Date.now() >= t.deadline) {
        await this.emit(t.promptId, { __error: `relay 超时（${TURN_TIMEOUT_MS / 1000}s 未结束）` })
        return this.finalize(t, 'failed')
      }

      await this.ctx.storage.put('turn', t) // persist lastRelaySeq / sawText
      await this.ctx.storage.setAlarm(Date.now() + 100) // continue promptly
    } catch (e: unknown) {
      await this.emit(t.promptId, { __error: e instanceof Error ? e.message : String(e) })
      await this.finalize(t, 'failed')
    }
  }

  /** Stream the relay /events for up to WINDOW_MS, translating new events into frames.
   *  Reconnecting replays from seq 0, so we dedupe by t.lastRelaySeq. Returns terminal info
   *  if a `done` arrived; otherwise {terminal:false} when the window/connection ends. */
  private async streamWindow(
    t: TurnState,
    config: RebyteConfig,
  ): Promise<{ terminal: boolean; status?: string; finalResult?: string }> {
    this.frameSeq = await this.maxFrameSeq(t.promptId)
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), WINDOW_MS)
    try {
      const res = await rebyteFetch(`/tasks/${t.relayTaskId}/events`, {
        headers: { Accept: 'text/event-stream' },
        signal: abort.signal,
        config,
      })
      if (res.status === 401 || res.status === 403) {
        await this.emit(t.promptId, { __error: `rebyte 鉴权失败 (${res.status})；检查 REBYTE_API_KEY / 模型授权。` })
        return { terminal: true, status: 'failed' }
      }
      if (!res.ok || !res.body) return { terminal: false }

      for await (const msg of parseSSE(res.body)) {
        if (msg.event === 'done') {
          const d = isObj(msg.data) ? msg.data : {}
          return {
            terminal: true,
            status: String(d.status ?? ''),
            finalResult: typeof d.finalResult === 'string' ? d.finalResult : undefined,
          }
        }
        if (!isObj(msg.data)) continue
        const ev = msg.data as RelayEvent
        const seq = typeof ev.seq === 'number' ? ev.seq : t.lastRelaySeq + 1
        if (seq <= t.lastRelaySeq) continue
        t.lastRelaySeq = seq
        if ((await this.translate(t.promptId, ev)).trim()) t.sawText = true
      }
      return { terminal: false } // stream closed without done (window timeout or relay close)
    } catch (e) {
      if (abort.signal.aborted) return { terminal: false } // window timer fired — not terminal
      throw e
    } finally {
      clearTimeout(timer)
    }
  }
}

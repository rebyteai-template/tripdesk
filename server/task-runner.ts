/**
 * Spawns the claude CLI per turn, in the project dir, and streams its
 * stream-json stdout into the `frames` table. Mirrors adits' local task-runner,
 * trimmed to single-user M1.
 *
 *   runTurn() → spawn claude -p ... → parse JSON lines → appendFrame → finish
 *
 * Session continuity: the first turn pins a --session-id; later turns --resume
 * it, so the agent keeps the in-flight orderKey / verified price across turns.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { env } from './env.ts'
import { store } from './db.ts'
import { ensureProject, mcpConfigPath } from './project.ts'

const SYSTEM_APPEND = [
  '你是 TripDesk 的机票预订助手。',
  '对所有机票相关请求，使用 travelkit skill（位于 .claude/skills/travelkit）并严格遵守其红线：',
  '先搜索→实时验价→验价通过后再收集证件；下单/支付/退改等写操作必须经用户明确确认；',
  '绝不向用户暴露 solutionId、orderKey、PNR、票号等内部字段。默认用简体中文回复。',
  env.PAYMENT_MODE === 'sandbox'
    ? '当前为沙箱/演示模式：可搜索、验价、下单，并可发起支付——发起支付只会返回第三方支付链接，交由用户自行在第三方平台（微信/支付宝/信用卡等）完成；你绝不替用户在第三方平台完成付款，也绝不谎称已支付，把支付链接交给用户后即停，等用户自行决定。'
    : '',
].join('')

const running = new Map<string, ChildProcess>()
const seqCounters = new Map<string, number>()

function nextSeq(promptId: string): number {
  const n = (seqCounters.get(promptId) ?? 0) + 1
  seqCounters.set(promptId, n)
  return n
}

function buildArgs(projectId: string, sessionId: string, resume: boolean): string[] {
  // The prompt is fed via stdin (see runTurn), not as a positional arg —
  // `--disallowedTools <tools...>` is variadic and would otherwise swallow a
  // trailing positional prompt.
  // flight_pay_order stays enabled in every mode: it only returns a third-party
  // payment LINK (Yeepay/Airwallex) for the user to complete externally — calling
  // it does not move money. The sandbox framing in SYSTEM_APPEND keeps the agent
  // from completing or faking a payment; it hands over the link and stops.
  const disallowed = ['AskUserQuestion']
  return [
    '-p',
    '--permission-mode', 'bypassPermissions',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--mcp-config', mcpConfigPath(projectId),
    '--strict-mcp-config',
    '--append-system-prompt', SYSTEM_APPEND,
    '--disallowedTools', ...disallowed,
    resume ? '--resume' : '--session-id', sessionId,
  ]
}

/** Spawns the turn and returns immediately; frames land in the DB as they
 *  arrive. Status flips on process close. Async only to await the store (the DB is
 *  now an async, swappable interface); callers still fire-and-forget. */
export async function runTurn(taskId: string, projectId: string, promptId: string, prompt: string): Promise<void> {
  let child: ChildProcess
  try {
    const cwd = ensureProject(projectId)
    const task = await store.getTask(taskId)
    const resume = !!task?.session_id
    const sessionId = task?.session_id ?? randomUUID()
    if (!resume) await store.setTaskSession(taskId, sessionId)

    child = spawn(env.CLAUDE_BIN, buildArgs(projectId, sessionId, resume), {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    })
    child.stdin!.end(prompt)
    running.set(promptId, child)
  } catch (e) {
    await store.appendFrame(promptId, nextSeq(promptId), { __error: e instanceof Error ? e.message : String(e) })
    await store.finishPrompt(promptId, 'failed')
    await store.setTaskStatus(taskId, 'failed')
    return
  }

  // Serialize frame writes: nextSeq assigns order synchronously, this chain keeps
  // an async driver's INSERTs in that order, and the close handler awaits it so
  // every frame lands before the status flips to terminal.
  let writeChain: Promise<void> = Promise.resolve()
  const write = (data: unknown): void => {
    const seq = nextSeq(promptId)
    writeChain = writeChain.then(() => store.appendFrame(promptId, seq, data)).catch(() => {})
  }

  let buf = ''
  child.stdout!.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8')
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line) continue
      let data: unknown
      try { data = JSON.parse(line) } catch { data = { __raw: line } }
      write(data)
    }
  })

  let stderr = ''
  child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

  child.on('error', (e: NodeJS.ErrnoException) => {
    const msg = e.code === 'ENOENT'
      ? `claude 未找到（${env.CLAUDE_BIN}）。设置 CLAUDE_BIN 指向真实 claude 二进制。`
      : e.message
    write({ __error: msg })
  })

  child.on('close', (code, signal) => {
    running.delete(promptId)
    if (buf.trim()) {
      let data: unknown
      try { data = JSON.parse(buf) } catch { data = { __raw: buf } }
      write(data)
    }
    if (stderr.trim()) write({ __stderr: stderr.trim() })

    const status = signal === 'SIGTERM' ? 'canceled' : code === 0 ? 'completed' : 'failed'
    void (async () => {
      await writeChain
      await store.finishPrompt(promptId, status)
      await store.setTaskStatus(taskId, status)
      seqCounters.delete(promptId)
    })()
  })
}

export function cancelTurn(promptId: string): boolean {
  const child = running.get(promptId)
  if (!child) return false
  child.kill('SIGTERM')
  return true
}

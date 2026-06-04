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
    ? '当前为沙箱模式：可以搜索、验价、下单，但严禁完成任何真实支付/扣款操作。'
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
  const disallowed = ['AskUserQuestion']
  if (env.PAYMENT_MODE === 'sandbox') {
    // Belt-and-suspenders: even if the prompt asks, the real pay tool is off.
    disallowed.push('mcp__travelkit__flight_pay_order')
  }
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
 *  arrive. Status flips on process close. */
export function runTurn(taskId: string, projectId: string, promptId: string, prompt: string): void {
  const cwd = ensureProject(projectId)
  const task = store.getTask(taskId)
  const resume = !!task?.session_id
  const sessionId = task?.session_id ?? randomUUID()
  if (!resume) store.setTaskSession(taskId, sessionId)

  const child = spawn(env.CLAUDE_BIN, buildArgs(projectId, sessionId, resume), {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  })
  child.stdin.end(prompt)
  running.set(promptId, child)

  let buf = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8')
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line) continue
      let data: unknown
      try { data = JSON.parse(line) } catch { data = { __raw: line } }
      store.appendFrame(promptId, nextSeq(promptId), data)
    }
  })

  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

  child.on('error', (e: NodeJS.ErrnoException) => {
    const msg = e.code === 'ENOENT'
      ? `claude 未找到（${env.CLAUDE_BIN}）。设置 CLAUDE_BIN 指向真实 claude 二进制。`
      : e.message
    store.appendFrame(promptId, nextSeq(promptId), { __error: msg })
  })

  child.on('close', (code, signal) => {
    running.delete(promptId)
    if (buf.trim()) {
      let data: unknown
      try { data = JSON.parse(buf) } catch { data = { __raw: buf } }
      store.appendFrame(promptId, nextSeq(promptId), data)
    }
    if (stderr.trim()) store.appendFrame(promptId, nextSeq(promptId), { __stderr: stderr.trim() })

    const status = signal === 'SIGTERM' ? 'canceled' : code === 0 ? 'completed' : 'failed'
    store.finishPrompt(promptId, status)
    store.setTaskStatus(taskId, status)
    seqCounters.delete(promptId)
  })
}

export function cancelTurn(promptId: string): boolean {
  const child = running.get(promptId)
  if (!child) return false
  child.kill('SIGTERM')
  return true
}

/**
 * Rebyte relay HTTP client. Ported from adits' server/backend/rebyte/rebyte.ts,
 * de-multi-tenant'd: TripDesk is single-user, so the org/partner key from env is
 * the only key. The relay authenticates via the `API_KEY` header (not Bearer).
 *
 * This file talks to the relay REST API only (agent-computers, tasks, events).
 * Sandbox file seeding uses the rebyte-sandbox SDK separately (see sandbox.ts).
 */
import { env } from '../env.ts'

export class RebyteError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'RebyteError'
  }
}

/** Low-level fetch against the relay, injecting the API_KEY header. Returns the
 *  raw Response so callers can stream (SSE) or read JSON. */
export function rebyteFetch(path: string, opts: RequestInit & { apiKey?: string } = {}): Promise<Response> {
  const { apiKey, ...init } = opts
  const key = apiKey ?? env.REBYTE_API_KEY
  if (!key) throw new RebyteError(0, 'REBYTE_API_KEY 未设置（在 .env.local 配置后再用 rebyte 后端）')
  const headers = new Headers(init.headers)
  headers.set('API_KEY', key)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
  return fetch(`${env.REBYTE_API_URL}${path}`, { ...init, headers })
}

/** Fetch JSON from the relay or throw RebyteError. */
export async function rebyteJSON<T = unknown>(path: string, opts: RequestInit & { apiKey?: string } = {}): Promise<T> {
  const res = await rebyteFetch(path, opts)
  const text = await res.text()
  if (!res.ok) {
    let msg: string
    try { msg = (JSON.parse(text)?.error?.message as string) ?? text } catch { msg = text || `HTTP ${res.status}` }
    throw new RebyteError(res.status, msg)
  }
  if (!text) return {} as T
  try { return JSON.parse(text) as T } catch { throw new RebyteError(res.status, `非 JSON 响应：${path}`) }
}

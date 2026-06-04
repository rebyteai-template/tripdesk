/**
 * Process-wide env, resolved once at boot. Single-user local mode only (M1).
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

function resolveClaudeBin(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
  // The shell `claude` is usually an alias to a local install; spawn() needs a
  // real path. Prefer the known local-install location, fall back to PATH.
  const local = join(homedir(), '.claude', 'local', 'claude')
  return existsSync(local) ? local : 'claude'
}

export const env = {
  PORT: parseInt(process.env.PORT ?? '4001', 10),

  /** Root for per-session project working dirs. Each holds .mcp.json +
   *  .claude/skills/travelkit so the spawned agent can reach TravelKit. */
  DATA_DIR: process.env.TRIPDESK_DATA_DIR || join(homedir(), '.tripdesk'),

  /** Real claude binary path (alias-safe). */
  CLAUDE_BIN: resolveClaudeBin(),

  /** sandbox | live — M1 is sandbox-only; the agent must not really pay. */
  PAYMENT_MODE: process.env.TRIPDESK_PAYMENT_MODE === 'live' ? 'live' : 'sandbox',

  /** Repo root — source of the .mcp.json + skill we copy into project dirs. */
  REPO_ROOT: process.cwd(),

  // ── backend selection ───────────────────────────────────────────────
  /** local = spawn claude on this box (M1 default). rebyte = run the agent on
   *  the Rebyte relay in a sandbox VM. Mirrors adits' ADITS_BACKEND. */
  BACKEND: process.env.TRIPDESK_BACKEND === 'rebyte' ? 'rebyte' as const : 'local' as const,

  // ── rebyte (only required when BACKEND=rebyte) ──────────────────────
  /** Rebyte relay base. The relay runs tasks + streams stream-json events. */
  REBYTE_API_URL: process.env.REBYTE_API_URL ?? 'https://api.rebyte.ai/v1',
  /** Org/partner API key, sent as the `API_KEY` header. Put it in .env.local
   *  (gitignored); never log it. Empty in local mode. */
  REBYTE_API_KEY: process.env.REBYTE_API_KEY ?? '',
  REBYTE_CONSOLE_URL: process.env.REBYTE_CONSOLE_URL ?? 'https://app.rebyte.ai/share',
}

export type Env = typeof env

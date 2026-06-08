/**
 * Seed the TravelKit config into a sandbox VM's /code:
 *   /code/.claude/settings.json      — `env` block with the per-user Simplifly credential
 *                                       (SIMPLIFLY_BASE_URL / SIMPLIFLY_AUTH_TOKEN)
 *   /code/.claude/skills/travelkit/  — the search→pay policy skill (direct Simplifly OpenAPI HTTP)
 *
 * The relay runs `claude` in /code, so project-level .claude/settings.json + .claude/skills
 * are auto-discovered, and the agent's bash/curl inherits the settings `env` vars.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { env } from '../env.ts'
import type { AgentComputer } from './provision.ts'
import { connectSandbox, writeFile } from './sandbox.ts'

const CODE = '/code'

function walk(root: string, prefix = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(root, prefix))) {
    const rel = prefix ? `${prefix}/${name}` : name
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(root, rel))
    else out.push(rel)
  }
  return out
}

/** Write .mcp.json + the full travelkit skill tree into the VM. Returns the
 *  list of seeded paths (for logging). Idempotent — overwrites. */
export async function seedTravelkit(ac: AgentComputer): Promise<string[]> {
  const sbx = await connectSandbox(ac)
  const written: string[] = []

  // Per-user Simplifly credential + gateway as Claude Code project settings `env`, so the
  // sandbox's non-interactive (`--print`) claude exposes SIMPLIFLY_BASE_URL / SIMPLIFLY_AUTH_TOKEN
  // to the agent's bash/curl. Locally these come from .env.local (server/env.ts); the deployed
  // Worker injects them per-user (worker/seed.ts applyCredential).
  const settings = JSON.stringify(
    { env: { SIMPLIFLY_BASE_URL: env.SIMPLIFLY_BASE_URL, SIMPLIFLY_AUTH_TOKEN: env.SIMPLIFLY_AUTH_TOKEN } },
    null,
    2,
  )
  await writeFile(sbx, `${CODE}/.claude/settings.json`, settings)
  written.push('.claude/settings.json')

  const skillRoot = join(env.REPO_ROOT, '.claude', 'skills', 'travelkit')
  for (const rel of walk(skillRoot)) {
    await writeFile(sbx, `${CODE}/.claude/skills/travelkit/${rel}`, readFileSync(join(skillRoot, rel), 'utf8'))
    written.push(`.claude/skills/travelkit/${rel}`)
  }
  return written
}

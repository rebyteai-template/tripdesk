/**
 * Seed the TravelKit config into a sandbox VM's /code, mirroring what
 * local/project.ts does on disk:
 *   /code/.mcp.json                  — travelkit MCP (holds the key)
 *   /code/.claude/skills/travelkit/  — the search→pay policy skill
 *
 * The relay runs `claude` in /code, so project-level .mcp.json + .claude/skills
 * are auto-discovered — the same mechanism the local backend relies on.
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

  const mcp = readFileSync(join(env.REPO_ROOT, '.mcp.json'), 'utf8')
  await writeFile(sbx, `${CODE}/.mcp.json`, mcp)
  written.push('.mcp.json')

  // Pre-trust the project .mcp.json so the sandbox's non-interactive (`--print`)
  // claude actually LOADS travelkit. cctools wires NO mcpServers into the coding
  // sub-agent and passes no --mcp-config (confirmed in cctools source), so the
  // sub-agent relies purely on project .mcp.json discovery — which is gated behind
  // a trust the headless agent can't grant interactively. Without this the
  // sub-agent has no flight_search → empty result → the manager fabricates.
  const settings = JSON.stringify({ enableAllProjectMcpServers: true }, null, 2)
  await writeFile(sbx, `${CODE}/.claude/settings.json`, settings)
  written.push('.claude/settings.json')

  const skillRoot = join(env.REPO_ROOT, '.claude', 'skills', 'travelkit')
  for (const rel of walk(skillRoot)) {
    await writeFile(sbx, `${CODE}/.claude/skills/travelkit/${rel}`, readFileSync(join(skillRoot, rel), 'utf8'))
    written.push(`.claude/skills/travelkit/${rel}`)
  }
  return written
}

/**
 * Project working dirs. Each spawned claude runs with cwd = a project dir that
 * we seed with:
 *   .mcp.json                  — copied from repo root (holds the TravelKit key)
 *   .claude/skills/travelkit/  — copied from the repo skill (search→pay policy)
 *
 * M1 uses a single default project so the UI has somewhere to talk to without a
 * project picker. Per-session projects are a later milestone.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { env } from './env.ts'

export const DEFAULT_PROJECT_ID = 'default'

export function projectDir(projectId: string): string {
  return join(env.DATA_DIR, 'projects', projectId)
}

/** Idempotent: creates and seeds the project dir if missing. Returns its path. */
export function ensureProject(projectId: string): string {
  const dir = projectDir(projectId)
  mkdirSync(dir, { recursive: true })

  const mcpSrc = join(env.REPO_ROOT, '.mcp.json')
  const mcpDst = join(dir, '.mcp.json')
  if (existsSync(mcpSrc) && !existsSync(mcpDst)) {
    cpSync(mcpSrc, mcpDst)
  }

  const skillSrc = join(env.REPO_ROOT, '.claude', 'skills', 'travelkit')
  const skillDst = join(dir, '.claude', 'skills', 'travelkit')
  if (existsSync(skillSrc) && !existsSync(skillDst)) {
    mkdirSync(join(dir, '.claude', 'skills'), { recursive: true })
    cpSync(skillSrc, skillDst, { recursive: true })
  }

  return dir
}

export function mcpConfigPath(projectId: string): string {
  return join(projectDir(projectId), '.mcp.json')
}

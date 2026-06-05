/**
 * rebyte bootstrap (Node CLI). Provisions + seeds sandbox VMs and emits the D1 rows the
 * Durable Object reads. Seeding needs Node (fs + the rebyte-sandbox SDK), which can't run in
 * a Worker — but it's idempotent and the VM persists, so we do it once here.
 *
 *   pnpm bootstrap:rebyte                      → one shared sandbox → kv.agent_computer (fallback)
 *   pnpm bootstrap:rebyte a@x.com b@y.com      → one sandbox PER email → agent_computers rows
 *   (or put the emails in ./whitelist.json as a JSON array)
 *
 * Writes the upserts to /tmp/tripdesk-bootstrap.sql and prints the wrangler commands to apply
 * them (remote + local). Per-email VMs are cached under DATA_DIR so re-runs reuse them.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { provisionAgentComputer, type AgentComputer } from '../server/rebyte/provision.ts'
import { seedTravelkit } from '../server/rebyte/seed.ts'

const DATA_DIR = process.env.TRIPDESK_DATA_DIR || join(homedir(), '.tripdesk')
const ACS_DIR = join(DATA_DIR, 'agent-computers')
const SQL_OUT = '/tmp/tripdesk-bootstrap.sql'

const esc = (s: string) => s.replace(/'/g, "''")
const sanitize = (email: string) => email.replace(/[^a-z0-9]+/gi, '_').toLowerCase()

/** Provision + cache one sandbox per key (email, or 'default'). */
async function ensureAgentComputer(key: string): Promise<AgentComputer> {
  const cache = join(ACS_DIR, `${sanitize(key)}.json`)
  if (existsSync(cache)) {
    const ac = JSON.parse(readFileSync(cache, 'utf8')) as Partial<AgentComputer>
    if (ac.sandboxId) return ac as AgentComputer
  }
  const ac = await provisionAgentComputer(`tripdesk-${sanitize(key)}`)
  mkdirSync(ACS_DIR, { recursive: true })
  writeFileSync(cache, JSON.stringify(ac, null, 2))
  return ac
}

function emails(): string[] {
  const args = process.argv.slice(2).filter((a) => a.includes('@'))
  if (args.length) return args
  if (existsSync('whitelist.json')) return JSON.parse(readFileSync('whitelist.json', 'utf8')) as string[]
  return [] // → single shared sandbox (kv fallback)
}

async function main(): Promise<void> {
  if (!process.env.REBYTE_API_KEY) throw new Error('REBYTE_API_KEY 未设置——用 `pnpm bootstrap:rebyte` 运行。')

  const list = emails()
  const stmts: string[] = []

  if (list.length === 0) {
    console.log('· no emails → seeding ONE shared sandbox (kv.agent_computer fallback)')
    const ac = await ensureAgentComputer('default')
    await seedTravelkit(ac)
    const v = esc(JSON.stringify({ id: ac.id, sandboxId: ac.sandboxId }))
    stmts.push(`INSERT OR REPLACE INTO kv (k, v) VALUES ('agent_computer', '${v}');`)
    console.log(`  ✓ shared sandbox id=${ac.id}`)
  } else {
    console.log(`· per-user: seeding one sandbox for each of ${list.length} email(s)`)
    for (const email of list) {
      const ac = await ensureAgentComputer(email)
      await seedTravelkit(ac)
      stmts.push(
        `INSERT OR REPLACE INTO agent_computers (user_email, ac_id, sandbox_id) ` +
          `VALUES ('${esc(email)}', '${esc(ac.id)}', '${esc(ac.sandboxId ?? '')}');`,
      )
      console.log(`  ✓ ${email} → sandbox id=${ac.id}`)
    }
  }

  writeFileSync(SQL_OUT, stmts.join('\n') + '\n')
  console.log(`\nWrote ${stmts.length} upsert(s) to ${SQL_OUT}. Apply with:`)
  console.log(`  wrangler d1 execute tripdesk --remote --file ${SQL_OUT}`)
  console.log(`  wrangler d1 execute tripdesk --local  --file ${SQL_OUT}`)
}

main().catch((e: unknown) => {
  console.error('bootstrap failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})

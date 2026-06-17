/**
 * Manager-config probe — verifies that our per-workspace agent config actually lands on the
 * rebyte workspace via the live /v1/agent-computers API:
 *
 *   1. ensureDefaultAgentComputer() — provision (or reuse the cached default VM) AND apply the
 *      manager config (this is the same call task-do.ts makes in production).
 *   2. GET /agent-computers/:id and assert the resulting config:
 *        · agentInstructions === AGENT_INSTRUCTIONS (the Kitty domain prompt)
 *        · web_search_&_browse view  → enabled === false   (the tool we cut)
 *        · sandbox + coding_agent views → enabled === true  (delegation tools must survive)
 *
 * This exercises the exact production path without running a full flight conversation. It DOES
 * provision a VM on first run (cached in DATA_DIR afterwards) — burns a little quota.
 *
 * Run: pnpm test:rebyte:config   (node --env-file=.env.local --import tsx server/rebyte/configprobe.ts)
 */
import { ensureDefaultAgentComputer } from './provision.ts'
import { rebyteJSON } from './client.ts'
import { AGENT_INSTRUCTIONS, WEB_SEARCH_VIEW } from './agent-config.ts'

interface AgentView {
  id: string
  name: string | null
  enabled: boolean
  server: { type: string; internalName: string | null; remoteId: string | null }
}
interface AgentComputerDetail {
  id: string
  agentInstructions: string | null
  views: AgentView[]
}

/** Internal names of the two delegation tools that MUST stay enabled. */
const KEEP_ON = ['sandbox', 'coding_agent'] as const

async function main() {
  console.log('[configprobe] 1/2 ensure + configure default agent-computer…')
  const ac = await ensureDefaultAgentComputer()
  console.log(`[configprobe]     workspace=${ac.id}`)

  console.log('[configprobe] 2/2 GET /agent-computers/:id and assert config…')
  const detail = await rebyteJSON<AgentComputerDetail>(`/agent-computers/${ac.id}`)

  const viewByTool = (name: string) => detail.views?.find((v) => v.server?.internalName === name)
  const web = viewByTool(WEB_SEARCH_VIEW)

  console.log('\n── live workspace config ──────────────────')
  console.log(`agentInstructions: ${detail.agentInstructions ? `${detail.agentInstructions.length} chars` : '(null)'}`)
  for (const v of detail.views ?? []) {
    console.log(`  ${v.enabled ? '🟢 on ' : '🔴 off'}  ${v.server?.internalName ?? v.server?.remoteId ?? v.name} (view ${v.id})`)
  }
  console.log('───────────────────────────────────────────\n')

  const failures: string[] = []

  if (detail.agentInstructions !== AGENT_INSTRUCTIONS) {
    failures.push('agent_instructions 未匹配（期望 Kitty 领域 prompt）')
  } else if (!detail.agentInstructions.includes('Kitty')) {
    failures.push('agent_instructions 不含 "Kitty"（产品名未生效）')
  }

  if (!web) failures.push(`未找到 ${WEB_SEARCH_VIEW} view（无法确认 web search 已关）`)
  else if (web.enabled) failures.push('web_search 仍开启（关闭未生效）')

  for (const tool of KEEP_ON) {
    const v = viewByTool(tool)
    if (!v) failures.push(`未找到 ${tool} view（委派工具缺失）`)
    else if (!v.enabled) failures.push(`${tool} 被关闭（不应该——委派要靠它）`)
  }

  console.log('──────────────────────────────────────────')
  if (failures.length) {
    console.log(`❌ 配置探针失败：\n  - ${failures.join('\n  - ')}`)
    process.exit(1)
  }
  console.log('✅ 配置探针通过：agent_instructions=Kitty 领域 prompt；web_search 已关；sandbox+coding_agent 仍开。')
  process.exit(0)
}
main().catch((e) => { console.error('ERROR', e?.stack || e?.message || e); process.exit(1) })

/**
 * One-off probe: connect to the cached sandbox VM and verify whether the
 * non-interactive `claude` there actually loads the seeded travelkit MCP.
 * Run: node --env-file=.env.local --import tsx server/rebyte/probe-mcp.ts
 */
import { ensureDefaultAgentComputer } from './provision.ts'
import { connectSandbox } from './sandbox.ts'

async function main() {
  const ac = await ensureDefaultAgentComputer()
  const sbx = await connectSandbox(ac)
  console.log(`[probe] VM ${ac.id} sandbox ${ac.sandboxId}`)

  const files = await sbx.commands.run(
    'echo "== /code/.claude =="; ls -la /code/.claude 2>&1; ' +
      'echo "== settings.json =="; cat /code/.claude/settings.json 2>&1; ' +
      'echo "== .mcp.json (head) =="; head -c 160 /code/.mcp.json 2>&1; echo',
  )
  console.log(files.stdout || files.stderr)

  console.log('=== claude mcp list (in /code) ===')
  const list = await sbx.commands.run('cd /code && claude mcp list 2>&1 | head -40')
  console.log(list.stdout || list.stderr)

  console.log('=== real flight_search via headless claude (100s cap) ===')
  const test = await sbx.commands.run(
    'cd /code && OUT=$(timeout 100 claude -p --output-format stream-json --verbose --dangerously-skip-permissions ' +
      '"用 travelkit 的 flight_search 搜 2026-06-20 PKX 到 PVG 直飞 1名成人，只把工具返回的原始结果给我" 2>&1); ' +
      'echo "-- travelkit tool_use markers --"; echo "$OUT" | grep -oE "mcp__travelkit__[a-z_]+|totalCount|displayOptions" | sort | uniq -c; ' +
      'echo "-- final result event (tail) --"; echo "$OUT" | tail -c 700',
  )
  console.log(test.stdout || test.stderr || '(no output)')
}
main().catch((e) => {
  console.error('[probe] ERR', e?.stack || e?.message || e)
  process.exit(1)
})

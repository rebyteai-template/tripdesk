/** Probe the seeded VM to pinpoint why the agent-loop sub-agent returned empty:
 *  (a) CCC can't get model creds (org not provisioned) vs (b) CCC doesn't
 *  auto-load /code/.mcp.json. Connects to the cached agent-computer and runs
 *  shell diagnostics. Never prints secrets — only names/existence.
 *  Run: node --env-file=.env.local --import tsx server/rebyte/vmprobe.ts
 */
import { loadCachedAgentComputer } from './provision.ts'
import { connectSandbox } from './sandbox.ts'

async function sh(sbx: Awaited<ReturnType<typeof connectSandbox>>, label: string, cmd: string) {
  console.log(`\n──────── ${label} ────────`)
  try {
    const r = await sbx.commands.run(cmd) as { exitCode?: number; stdout?: string; stderr?: string }
    if (r.stdout?.trim()) console.log(r.stdout.trim())
    if (r.stderr?.trim()) console.log('[stderr]', r.stderr.trim())
    console.log(`[exit ${r.exitCode ?? '?'}]`)
  } catch (e: unknown) {
    const x = e as { exitCode?: number; stdout?: string; stderr?: string; message?: string }
    if (x.stdout?.trim()) console.log(x.stdout.trim())
    if (x.stderr?.trim()) console.log('[stderr]', x.stderr.trim())
    console.log(`[exit ${x.exitCode ?? '?'}${x.exitCode === undefined && x.message ? ' err=' + x.message : ''}]`)
  }
}

async function main() {
  const ac = loadCachedAgentComputer()
  if (!ac) { console.error('no cached agent-computer; run the spike first'); process.exit(1) }
  console.log(`connecting VM ${ac.id} (sandbox ${ac.sandboxId})…`)
  const sbx = await connectSandbox(ac)

  await sh(sbx, 'seed: .mcp.json (token redacted)', 'ls -la /code/.mcp.json; echo "travelkit mentions:"; grep -o travelkit /code/.mcp.json | wc -l; echo "bytes:"; wc -c < /code/.mcp.json')
  await sh(sbx, 'seed: skill dir', 'ls /code/.claude/skills/travelkit 2>&1; echo "refs:"; ls /code/.claude/skills/travelkit/references 2>&1 | head')
  await sh(sbx, 'claude binary', 'which claude ccc 2>&1; claude --version 2>&1 | head -1; ls -la /usr/local/bin 2>/dev/null | grep -iE "claude|ccc"')
  await sh(sbx, 'auth/config files (names only)', 'ls -la ~/ 2>&1 | grep -iE "claude|\\.config"; ls -la ~/.claude* 2>&1; ls -la ~/.config 2>&1 | head; ls -la /code/CLAUDE.md 2>&1')
  await sh(sbx, 'relevant env (names only, values hidden)', 'env | grep -iE "ANTHROPIC|LITELLM|CLAUDE|OPENAI|_MODEL|BASE_URL|REBYTE|API_KEY" | sed -E "s/=.*/=<set>/" | sort')
  await sh(sbx, 'claude mcp list (auto-load of /code/.mcp.json?)', 'cd /code && claude mcp list 2>&1 | head -30')
  await sh(sbx, 'CCC live test (creds + MCP)', 'cd /code && timeout 100 claude -p "用一句话问好，并仅列出你能调用的 mcp 工具名称" --mcp-config /code/.mcp.json 2>&1 | head -40')

  console.log('\n[vmprobe] done')
  process.exit(0)
}
main().catch((e) => { console.error('[vmprobe] ERROR', e?.stack || e?.message || e); process.exit(1) })

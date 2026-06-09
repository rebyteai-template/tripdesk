/**
 * Live probe for the hand-rolled envd gRPC-Web file delete used by worker/seed.ts.
 *
 * The REST /files endpoint has no DELETE (405); envd's `filesystem.Filesystem/Remove` gRPC-Web
 * service does, and accepts the same auth as our writes (X-API-KEY + Basic `user:`). This exercises
 * the EXACT seed.ts `removeFile()` (pure fetch, no SDK) end to end: raw-write a temp file → remove
 * → confirm it's gone via REST GET (404). Reuses the cached default agent-computer if present.
 *
 * Run: node --env-file=.env.local --import tsx server/rebyte/removeprobe.ts
 */
import { removeFile } from '../../worker/seed.ts'
import { ensureDefaultAgentComputer, type AgentComputer } from './provision.ts'

function host(ac: AgentComputer) {
  return `https://49983-${ac.sandboxId}.${new URL(ac.sandboxBaseUrl).host}`
}
function fileUrl(ac: AgentComputer, rel: string) {
  return `${host(ac)}/files?path=${encodeURIComponent('/code/' + rel)}&username=user`
}

async function main() {
  const ac = await ensureDefaultAgentComputer('tripdesk-removeprobe')
  console.log(`[removeprobe] sandbox ${ac.sandboxId} @ ${ac.sandboxBaseUrl}`)

  const rel = `.removeprobe-${Date.now()}.txt`

  // raw write (same path seed.ts uses for writes)
  const fd = new FormData()
  fd.append('file', new Blob(['delete me\n']), rel)
  let r = await fetch(fileUrl(ac, rel), { method: 'POST', headers: { 'X-API-KEY': ac.sandboxApiKey }, body: fd })
  if (!r.ok) throw new Error(`write failed: HTTP ${r.status}`)
  r = await fetch(fileUrl(ac, rel), { headers: { 'X-API-KEY': ac.sandboxApiKey } })
  console.log(`[removeprobe] wrote ${rel} — GET=${r.status} (expect 200)`)
  if (!r.ok) throw new Error('file not present after write')

  // the thing under test
  await removeFile(ac, rel)
  console.log('[removeprobe] removeFile() returned')

  r = await fetch(fileUrl(ac, rel), { headers: { 'X-API-KEY': ac.sandboxApiKey } })
  console.log(`[removeprobe] GET after remove=${r.status} (expect 404)`)
  if (r.ok) throw new Error('REMOVE FAILED: file still readable')

  // idempotent: removing an absent file (grpc-status 5) must not throw
  await removeFile(ac, rel)
  console.log('[removeprobe] second removeFile() of absent file: no throw (idempotent)')

  console.log('\n✅ [removeprobe] PASS — hand-rolled gRPC-Web removeFile deletes in a live sandbox')
}

main().catch((e) => {
  console.error('\n❌ [removeprobe] FAIL:', e)
  process.exit(1)
})

/**
 * Per-user sandbox provisioning + seeding — pure fetch, Workers-native (no rebyte-sandbox
 * SDK; it drags in tar/fs and can't run on Workers).
 *
 *   provisionComputer() → POST /v1/agent-computers (rebyte relay API)
 *   seedSandbox()       → POST https://49983-<sandboxId>.<domain>/files (envd file API)
 *
 * The envd file API takes a multipart `file` field, auth via the sandbox's own X-API-KEY,
 * and auto-creates parent dirs — all verified against a live sandbox.
 */
import { SEED_FILES } from './seed-assets.generated.ts'
import { rebyteJSON, type RebyteConfig } from '../server/rebyte/client.ts'

export interface ProvisionedComputer {
  id: string
  sandboxId: string
  sandboxBaseUrl: string
  sandboxApiKey: string
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Provision a fresh agent-computer and wait until sandboxId is populated (the VM is
 *  addressable). Polls ~80s. */
export async function provisionComputer(config: RebyteConfig, name: string): Promise<ProvisionedComputer> {
  const created = await rebyteJSON<ProvisionedComputer>('/agent-computers', {
    method: 'POST',
    body: JSON.stringify({ name }),
    config,
  })
  if (created.sandboxId) return created
  for (let i = 0; i < 40; i++) {
    await sleep(2000)
    const fresh = await rebyteJSON<ProvisionedComputer>(`/agent-computers/${created.id}`, { config })
    if (fresh.sandboxId) return { ...created, ...fresh }
  }
  throw new Error(`agent-computer ${created.id} 80s 内未就绪`)
}

/** Write travelkit (.mcp.json + settings + skill) into the sandbox /code via the envd file
 *  API. Each write is a multipart POST; nested paths auto-create dirs. */
export async function seedSandbox(ac: ProvisionedComputer): Promise<void> {
  const domain = new URL(ac.sandboxBaseUrl).host // e.g. prod.rebyte.app
  const host = `https://49983-${ac.sandboxId}.${domain}`
  for (const [rel, content] of Object.entries(SEED_FILES)) {
    const fd = new FormData()
    fd.append('file', new Blob([content]), rel.split('/').pop() ?? 'file')
    const res = await fetch(`${host}/files?path=${encodeURIComponent('/code/' + rel)}&username=user`, {
      method: 'POST',
      headers: { 'X-API-KEY': ac.sandboxApiKey },
      body: fd,
    })
    if (!res.ok) throw new Error(`seed ${rel} failed: HTTP ${res.status}`)
  }
}

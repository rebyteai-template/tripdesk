/**
 * Sandbox file ops via the rebyte-sandbox SDK. Used to seed the TravelKit MCP
 * config + skill into the VM's /code (the agent's working dir). The relay runs
 * tasks separately over REST (see client.ts) — this is just files.
 *
 * SDK pinned to adits' git ref (ReByteAI/sandbox-sdk#84b6849). Connect opts are
 * {apiUrl, apiKey, domain}, sourced from the agent-computer provision response.
 */
import { Sandbox } from 'rebyte-sandbox'
import type { AgentComputer } from './provision.ts'

export async function connectSandbox(ac: AgentComputer): Promise<Sandbox> {
  return Sandbox.connect(ac.sandboxId, {
    apiUrl: ac.sandboxBaseUrl,
    apiKey: ac.sandboxApiKey,
    domain: new URL(ac.sandboxBaseUrl).hostname,
  })
}

/** Write a text file, creating its parent dir first (idempotent). */
export async function writeFile(sbx: Sandbox, path: string, content: string): Promise<void> {
  const slash = path.lastIndexOf('/')
  if (slash > 0) {
    try { await sbx.files.makeDir(path.slice(0, slash)) } catch { /* already exists */ }
  }
  await sbx.files.write(path, content)
}

export async function readFile(sbx: Sandbox, path: string): Promise<string> {
  return sbx.files.read(path)
}

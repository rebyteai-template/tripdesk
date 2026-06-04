/** Raw dump of relay task shapes, to learn the real event/content contract.
 *  Run: node --env-file=.env.local --import tsx server/rebyte/raw.ts <taskId> */
import { rebyteFetch } from './client.ts'

const taskId = process.argv[2]
if (!taskId) { console.error('usage: raw.ts <taskId>'); process.exit(1) }

async function dump(path: string) {
  console.log(`\n════════ GET ${path} ════════`)
  try {
    const res = await rebyteFetch(path)
    const text = await res.text()
    console.log(`status ${res.status}`)
    try { console.log(JSON.stringify(JSON.parse(text), null, 2).slice(0, 4000)) }
    catch { console.log(text.slice(0, 2000)) }
  } catch (e) { console.log('ERR', (e as Error).message) }
}

async function main() {
  await dump(`/tasks/${taskId}`)
  await dump(`/tasks/${taskId}/content`)
  await dump(`/tasks/${taskId}/content?include=events`)
}
main().catch((e) => { console.error(e); process.exit(1) })

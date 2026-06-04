/** Find WHERE the manager's reply is retrievable via the API. We know task
 *  117d5c89 has a real reply (visible in the rebyte UI: "我是 Rebyte 托管…").
 *  Probe candidate endpoints and report which one returns it.
 *  Run: node --env-file=.env.local --import tsx server/rebyte/getresp.ts <taskId> [marker]
 */
import { rebyteFetch } from './client.ts'

const taskId = process.argv[2]
const marker = process.argv[3] || '托管'
if (!taskId) { console.error('usage: getresp.ts <taskId> [marker]'); process.exit(1) }

const paths = [
  `/tasks/${taskId}/content`,
  `/tasks/${taskId}/content?include=events,messages`,
  `/tasks/${taskId}/content?include=messages`,
  `/tasks/${taskId}/content?include=response`,
  `/tasks/${taskId}/content?include=all`,
  `/tasks/${taskId}/messages`,
  `/tasks/${taskId}/agent-messages`,
  `/tasks/${taskId}/result`,
  `/tasks/${taskId}/output`,
  `/tasks/${taskId}`,
]

async function main() {
  for (const p of paths) {
    try {
      const res = await rebyteFetch(p)
      const text = await res.text()
      const hit = text.includes(marker)
      console.log(`\n${hit ? '✅ HIT' : '  ' + res.status} GET ${p}`)
      if (hit) {
        const i = text.indexOf(marker)
        console.log('   …' + text.slice(Math.max(0, i - 120), i + 200).replace(/\s+/g, ' '))
      } else if (res.status !== 200) {
        console.log('   ' + text.slice(0, 120))
      }
    } catch (e) { console.log(`  ERR GET ${p}: ${(e as Error).message}`) }
  }
  console.log('\n[getresp] done')
}
main().catch((e) => { console.error(e); process.exit(1) })

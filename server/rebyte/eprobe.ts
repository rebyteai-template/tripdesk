/** Probe the raw /events response to learn the streaming contract.
 *  Run: node --env-file=.env.local --import tsx server/rebyte/eprobe.ts <taskId> */
import { rebyteFetch } from './client.ts'

const taskId = process.argv[2]
if (!taskId) { console.error('usage: eprobe.ts <taskId>'); process.exit(1) }

async function probe(path: string, accept: boolean) {
  console.log(`\n════ GET ${path}  Accept:${accept ? 'text/event-stream' : '(none)'} ════`)
  const res = await rebyteFetch(path, accept ? { headers: { Accept: 'text/event-stream' } } : {})
  console.log('status', res.status, '| content-type:', res.headers.get('content-type'))
  if (!res.body) { console.log('(no body)', await res.text()); return }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let total = 0
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const { done, value } = await reader.read()
    if (done) { console.log('[stream closed]'); break }
    const chunk = dec.decode(value, { stream: true })
    total += chunk.length
    process.stdout.write(chunk)
    if (total > 3000) { console.log('\n[truncated at 3KB]'); break }
  }
  try { await reader.cancel() } catch { /* */ }
}

async function main() {
  await probe(`/tasks/${taskId}/events`, true)
  await probe(`/tasks/${taskId}/events`, false)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })

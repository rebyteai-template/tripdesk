import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { derive } from '../src/frames.ts'
import { buildRows } from '../src/components/FlightResultsTable.tsx'
import type { PromptContent } from '../src/api.ts'

// Real skill CLI output (scripts against the skill's own shopping fixture, no
// live API) — regenerate with the skill repo's fixture server whenever the
// compact contract changes, so this test tracks the actual wire format.
const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'compact-search-combo.json'), 'utf-8')

function promptWithToolResult(content: string): PromptContent {
  return {
    id: 'p1',
    prompt: 'search',
    status: 'completed',
    created_at: '2026-07-13 00:00:00',
    completed_at: '2026-07-13 00:01:00',
    attachments: [],
    frames: [
      {
        seq: 1,
        data: {
          type: 'user',
          message: {
            content: [{ type: 'tool_result', content }],
          },
        },
      },
    ],
  }
}

test('skill compact output renders combo rows with per-ticket prices and one total', () => {
  const view = derive([promptWithToolResult(fixture)])
  const options = view.search?.options ?? []
  assert.equal(options.length, 2)

  const rows = buildRows(options, [])

  // Option 1: two tickets (blocks 0/1), two segments each → 4 rows.
  const first = rows.filter((r) => r.option === options[0])
  assert.deepEqual(first.map((r) => r.price), ['¥420', '', '¥420', ''])
  assert.deepEqual(first.map((r) => r.total), ['¥840', '', '', ''])
  assert.deepEqual(first.map((r) => r.source), ['tongcheng', '', 'tongcheng', ''])

  // Option 2: ticket 1 has two segments, ticket 2 one segment → 3 rows.
  const second = rows.filter((r) => r.option === options[1])
  assert.deepEqual(second.map((r) => r.price), ['¥420', '', '¥500'])
  assert.deepEqual(second.map((r) => r.total), ['¥920', '', ''])
  assert.deepEqual(second.map((r) => r.source), ['tongcheng', '', 'qunar'])

  // Segment-level facts come straight from the wire format.
  assert.equal(first[0]?.cabin, '经济 V舱')
  assert.equal(first[0]?.baggage, '托运1*20kg')

  // The table never prints invented placeholder text.
  for (const row of rows) {
    for (const cell of [row.cabin, row.baggage, row.price, row.total, row.source]) {
      assert.ok(!cell.includes('未返回'), `table cell must not invent "未返回": ${cell}`)
    }
  }
})

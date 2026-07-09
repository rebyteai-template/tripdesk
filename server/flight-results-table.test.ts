import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildVerifyPrompt } from '../src/components/FlightResultsTable.tsx'
import type { CompactOption } from '../src/frames.ts'

const option: CompactOption = {
  optionNumber: 1,
  solutionId: 'sol-direct-bag',
  displayNumber: 3,
  journeyType: '直飞',
  duration: '2h20m',
  durationMinutes: 140,
  cabin: '经济 H舱',
  baggage: '托运1*23kg',
  hasCheckedBaggage: true,
  price: {
    amount: 1280,
    currency: 'CNY',
    display: '¥1,280',
    perType: { adult: { num: 2, unitTotal: 640, subtotal: 1280 } },
  },
  journeys: [
    {
      origin: 'PEK',
      destination: 'SHA',
      departureDate: '2026-08-05',
      departureTime: '07:45',
      arrivalDate: '2026-08-05',
      arrivalTime: '10:05',
      duration: '2h20m',
      transferCount: 0,
      segments: [
        {
          flightNo: 'MU5186',
          departure: 'PEK',
          departureDate: '2026-08-05',
          departureTime: '07:45',
          arrival: 'SHA',
          arrivalDate: '2026-08-05',
          arrivalTime: '10:05',
          cabin: '经济 H舱',
          checkedBaggage: '托运1*23kg',
        },
      ],
    },
  ],
}

test('buildVerifyPrompt binds verify to solutionId and includes row facts', () => {
  const prompt = buildVerifyPrompt(option)

  assert.match(prompt, /solutionId: sol-direct-bag/)
  assert.match(prompt, /verify --solution-id/)
  assert.match(prompt, /passengers: adult=2, child=0, infant=0/)
  assert.match(prompt, /MU5186 2026-08-05 PEKSHA 07:45-10:05 经济 H舱/)
  assert.match(prompt, /expected displayed price: ¥1,280/)
  assert.doesNotMatch(prompt, /表格序号|displayNumber/)
})

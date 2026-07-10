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

const comboLeg = (flightNo: string, from: string, to: string, date: string) => ({
  origin: from,
  destination: to,
  departureDate: date,
  departureTime: '10:00',
  arrivalDate: date,
  arrivalTime: '14:00',
  duration: '4h',
  transferCount: 0,
  segments: [
    { flightNo, departure: from, departureDate: date, departureTime: '10:00', arrival: to, arrivalDate: date, arrivalTime: '14:00', cabin: '经济' },
  ],
})

const comboOption: CompactOption = {
  optionNumber: 1,
  solutionId: 'combo:9064d66cf1ca49',
  journeyType: '多程',
  duration: '40h',
  durationMinutes: 2400,
  cabin: '经济',
  baggage: '托运1*23kg',
  hasCheckedBaggage: true,
  price: { amount: 46071, currency: 'CNY', display: '¥46,071', perType: { adult: { num: 3, unitTotal: 15357, subtotal: 46071 } } },
  journeys: [
    comboLeg('MU0583', 'PVG', 'LAX', '2026-09-27'),
    comboLeg('DL1194', 'LAX', 'SLC', '2026-09-29'),
    comboLeg('WN3888', 'SLC', 'BUF', '2026-10-02'),
    comboLeg('MU0588', 'JFK', 'PVG', '2026-10-07'),
  ],
}

test('buildVerifyPrompt on a 4-leg combo binds the combo solutionId and lists every leg', () => {
  const prompt = buildVerifyPrompt(comboOption)

  assert.match(prompt, /solutionId: combo:9064d66cf1ca49/)
  assert.match(prompt, /verify --solution-id/)
  assert.match(prompt, /passengers: adult=3, child=0, infant=0/)
  for (const flightNo of ['MU0583', 'DL1194', 'WN3888', 'MU0588']) {
    assert.match(prompt, new RegExp(flightNo))
  }
  assert.match(prompt, /expected displayed price: ¥46,071/)
})

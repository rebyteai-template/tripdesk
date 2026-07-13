import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildRows, buildVerifyPrompt } from '../src/components/FlightResultsTable.tsx'
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
  price: { amount: 46071, currency: 'CNY', perType: { adult: { num: 3, unitTotal: 15357, subtotal: 46071 } } },
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

test('combo rows show each ticket price/source on its block first row and the sum as 总价', () => {
  const combo: CompactOption = {
    ...comboOption,
    journeys: comboOption.journeys.map((j, i) => ({ ...j, blockIndex: i })),
    blocks: [
      { price: { amount: 20000, currency: 'CNY' }, source: '美亚' },
      { price: { amount: 1050, currency: 'CNY' }, source: 'yinling' },
      { price: { amount: 2658, currency: 'CNY' }, source: 'yinling' },
      { price: { amount: 22363, currency: 'CNY' } },
    ],
  }

  const rows = buildRows([combo], [])
  assert.equal(rows.length, 4)
  assert.deepEqual(rows.map((r) => r.price), ['¥20,000', '¥1,050', '¥2,658', '¥22,363'])
  assert.deepEqual(rows.map((r) => r.source), ['美亚', 'yinling', 'yinling', '--'])
  assert.deepEqual(rows.map((r) => r.total), ['¥46,071', '', '', ''])
})

test('a jointly-booked block (two journeys, one ticket) prices only its first row', () => {
  const combo: CompactOption = {
    ...comboOption,
    journeys: [
      { ...comboLeg('MU0583', 'PVG', 'LAX', '2026-09-27'), blockIndex: 0 },
      { ...comboLeg('MU0588', 'JFK', 'PVG', '2026-10-07'), blockIndex: 0 },
      { ...comboLeg('DL1194', 'LAX', 'SLC', '2026-09-29'), blockIndex: 1 },
    ],
    blocks: [
      { price: { amount: 45000, currency: 'CNY' }, source: '美亚' },
      { price: { amount: 1071, currency: 'CNY' }, source: 'yinling' },
    ],
  }

  const rows = buildRows([combo], [])
  assert.deepEqual(rows.map((r) => r.price), ['¥45,000', '', '¥1,071'])
  assert.deepEqual(rows.map((r) => r.source), ['美亚', '', 'yinling'])
  assert.deepEqual(rows.map((r) => r.total), ['¥46,071', '', ''])
})

test('a single-ticket option keeps its price on the first row and no per-block split', () => {
  const rows = buildRows([option], [])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.price, '¥1,280')
  assert.equal(rows[0]?.total, '¥1,280')
  assert.equal(rows[0]?.source, '--')
})

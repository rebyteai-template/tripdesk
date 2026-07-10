import assert from 'node:assert/strict'
import { test } from 'node:test'

import { derive } from '../src/frames.ts'
import type { PromptContent } from '../src/api.ts'

function promptWithToolResult(content: string): PromptContent {
  return {
    id: 'p1',
    prompt: 'search',
    status: 'completed',
    created_at: '2026-07-08 00:00:00',
    completed_at: '2026-07-08 00:01:00',
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

function compactSearch(optionNumber: number, flightNo: string, amount: number) {
  return {
    ok: true,
    searchedRequests: [{ uniqueCandidateCount: 1 }],
    displayOptions: [
      {
        optionNumber,
        solutionId: `sol-${flightNo.toLowerCase()}`,
        journeyType: '直飞',
        duration: '2h',
        durationMinutes: 120,
        cabin: '经济 H舱',
        baggage: '托运1*23kg',
        hasCheckedBaggage: true,
        price: { amount, currency: 'CNY', display: `¥${amount}` },
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
                flightNo,
                departure: 'PEK',
                departureName: '北京首都',
                departureDate: '2026-08-05',
                departureTime: '07:45',
                arrival: 'SHA',
                arrivalName: '上海虹桥',
                arrivalDate: '2026-08-05',
                arrivalTime: '10:05',
                cabin: '经济 H舱',
                checkedBaggage: '托运1*23kg',
              },
            ],
          },
        ],
      },
    ],
    displayMapping: { 1: {} },
  }
}

test('derive parses compact search JSON before trailing shell output', () => {
  const compact = compactSearch(1, 'MU5186', 1000)

  const view = derive([promptWithToolResult(`${JSON.stringify(compact)}\nShell cwd was reset to /code\n`)])
  assert.equal(view.stage, 'search')
  assert.equal(view.search?.options.length, 1)
  assert.equal(view.search?.options[0]?.solutionId, 'sol-mu5186')
  assert.equal(view.chat.at(-1)?.cards?.length, 1)
})

test('derive preserves multiple compact searches in one turn', () => {
  const prompt = promptWithToolResult('')
  prompt.frames = [
    {
      seq: 1,
      data: {
        type: 'user',
        message: { content: [{ type: 'tool_result', content: JSON.stringify(compactSearch(1, 'NH0964', 27364)) }] },
      },
    },
    {
      seq: 2,
      data: {
        type: 'user',
        message: { content: [{ type: 'tool_result', content: JSON.stringify(compactSearch(1, 'JL0022', 25798)) }] },
      },
    },
    {
      seq: 3,
      data: {
        type: 'assistant',
        message: { content: [{ type: 'text', text: '汇总如下' }] },
      },
    },
  ]

  const view = derive([prompt])
  const cardBubbles = view.chat.filter((b) => b.cards)
  assert.equal(cardBubbles.length, 2)
  assert.equal(cardBubbles[0]?.cards?.length, 1)
  assert.equal(cardBubbles[1]?.cards?.length, 1)
  const firstCard = cardBubbles[0]?.cards?.[0]
  const secondCard = cardBubbles[1]?.cards?.[0]
  const latestSearch = view.search?.options[0]
  if (!firstCard || !secondCard || !latestSearch) throw new Error('expected card-backed searches')
  assert.equal(firstCard.journeys[0]?.segments[0]?.flightNo, 'NH0964')
  assert.equal(secondCard.journeys[0]?.segments[0]?.flightNo, 'JL0022')
  assert.equal(latestSearch.journeys[0]?.segments[0]?.flightNo, 'JL0022')
})

function compactVerify(flightNo: string, amount: number) {
  return {
    ok: true,
    selectedOption: { optionNumber: 1 },
    verifiedOption: {
      price: { amount, currency: 'CNY' },
      journeys: [
        {
          origin: 'SLC',
          destination: 'BUF',
          departureDate: '2026-10-02',
          departureTime: '11:20',
          arrivalDate: '2026-10-02',
          arrivalTime: '20:05',
          duration: '6h45m',
          transferCount: 0,
          segments: [
            {
              flightNo,
              departure: 'SLC',
              departureDate: '2026-10-02',
              departureTime: '11:20',
              arrival: 'BUF',
              arrivalDate: '2026-10-02',
              arrivalTime: '20:05',
              cabin: '经济 T舱',
            },
          ],
        },
      ],
    },
  }
}

test('derive does not render the last fare card when a turn verifies multiple alternatives', () => {
  const prompt = promptWithToolResult('')
  prompt.frames = [
    {
      seq: 1,
      data: {
        type: 'user',
        message: { content: [{ type: 'tool_result', content: JSON.stringify(compactVerify('AA2883', 3858)) }] },
      },
    },
    {
      seq: 2,
      data: {
        type: 'user',
        message: { content: [{ type: 'tool_result', content: JSON.stringify(compactVerify('WN3888', 3978)) }] },
      },
    },
    {
      seq: 3,
      data: {
        type: 'assistant',
        message: { content: [{ type: 'text', text: '| 方案 | 价格 |\n|---|---|\n| AA | ¥3858 |\n| WN | ¥3978 |' }] },
      },
    },
  ]

  const view = derive([prompt])

  assert.equal(view.chat.some((b) => b.fare), false)
  assert.match(view.chat.at(-1)?.text ?? '', /\| WN \| ¥3978 \|/)
})

test('assistant text keys are unique across prompts with the same frame seq', () => {
  const first = promptWithToolResult('')
  first.id = 'prompt-a'
  first.prompt = 'first'
  first.frames = [
    {
      seq: 8,
      data: {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'first answer' }] },
      },
    },
  ]

  const second = promptWithToolResult('')
  second.id = 'prompt-b'
  second.prompt = 'second'
  second.frames = [
    {
      seq: 8,
      data: {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'second answer' }] },
      },
    },
  ]

  const keys = derive([first, second]).chat.map((b) => b.key)
  assert.equal(new Set(keys).size, keys.length)
})

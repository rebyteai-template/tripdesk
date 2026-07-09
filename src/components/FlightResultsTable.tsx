import { useMemo, useState } from 'react'
import type { CompactJourney, CompactOption, CompactSegment } from '../frames.ts'
import { paxLabel, stopsLabel } from '../booking.ts'

function dateCn(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${Number(m[2])}月${m[3]}日` : iso
}

function money(amount: number, currency = 'CNY'): string {
  const prefix = currency.toUpperCase() === 'CNY' ? '¥' : `${currency} `
  return `${prefix}${amount.toLocaleString('zh-CN')}`
}

function priceDisplay(o: CompactOption): string {
  if (o.price.display && o.price.display !== '¥0') return o.price.display
  return money(o.price.amount, o.price.currency)
}

function customerPrice(o: CompactOption): string {
  const entries = Object.entries(o.price.perType ?? {})
  if (!entries.length) return `价格：${priceDisplay(o)} 含税/人`
  const parts = entries.map(([type, p]) => {
    const unit = p.unitTotal ?? (p.num ? (p.subtotal ?? 0) / p.num : 0)
    return `${paxLabel(type)} ${money(unit, o.price.currency)} 含税/人`
  })
  return `价格：${parts.join('，')}`
}

function airportName(code: string, name?: string, terminal?: string): string {
  const base = (name || code).trim()
  if (!terminal) return base
  const t = terminal.startsWith('T') ? terminal : terminal.replace(/[()]/g, '')
  if (base.includes(t) || base.includes(`(${t})`)) return base
  return `${base}(${t})`
}

function routeCell(s: CompactSegment): string {
  const routeCode = `${s.departure}${s.arrival}`
  return `${routeCode}  ${airportName(s.departure, s.departureName, s.departureTerminal)} → ${airportName(s.arrival, s.arrivalName, s.arrivalTerminal)}`
}

function crossDays(j: CompactJourney, s: CompactSegment): number {
  if (s.arrivalDate && s.departureDate && s.arrivalDate > s.departureDate) {
    const a = Date.parse(`${s.departureDate}T00:00:00Z`)
    const b = Date.parse(`${s.arrivalDate}T00:00:00Z`)
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.max(0, Math.round((b - a) / 86400000))
  }
  return j.arrivalCrossDays ?? 0
}

function timeCell(j: CompactJourney, s: CompactSegment): string {
  const plus = crossDays(j, s)
  return `${s.departureTime}-${s.arrivalTime}${plus ? `(+${plus})` : ''}`
}

function durationCell(j: CompactJourney): string {
  const layover = j.layovers?.length ? `（中转 ${j.layovers.join(' / ')}）` : ''
  return `${j.duration}${layover}`
}

function recommendedFlights(text: string): Set<string> {
  const set = new Set<string>()
  const re = /推荐\s*([A-Z0-9]{2}\d{3,4})/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const flightNo = match[1]
    if (flightNo) set.add(flightNo.toUpperCase())
  }
  return set
}

function optionFlights(o: CompactOption): string[] {
  return o.journeys.flatMap((j) => j.segments.map((s) => s.flightNo.toUpperCase()))
}

function optionBadges(o: CompactOption, isRecommended: boolean): string[] {
  const tags = new Set<string>()
  if (isRecommended) tags.add('推荐')
  if (o.tag) tags.add(o.tag)
  return [...tags]
}

function optionSummary(o: CompactOption): string {
  const firstJourney = o.journeys[0]
  const firstSegment = firstJourney?.segments[0]
  if (!firstJourney || !firstSegment) return `方案 ${o.displayNumber ?? o.optionNumber}`
  return `方案 ${o.displayNumber ?? o.optionNumber} · ${firstSegment.flightNo} · ${timeCell(firstJourney, firstSegment)} · ${priceDisplay(o)}`
}

function passengerCountForPrompt(o: CompactOption): string {
  const perType = o.price.perType ?? {}
  const count = (type: string) => perType[type]?.num ?? 0
  const adult = count('adult')
  const child = count('child')
  const infant = count('infant')
  if (adult || child || infant) return `adult=${adult}, child=${child}, infant=${infant}`
  return '沿用本次查询的乘客人数'
}

export function buildVerifyPrompt(o: CompactOption): string {
  const selector = o.selectionLabel ?? `原始方案${o.optionNumber}`
  const checks = o.journeys.flatMap((journey, ji) =>
    journey.segments.map((segment) => {
      const label = o.journeys.length > 1 ? `${ji === 0 ? '去程' : ji === 1 ? '回程' : `第${ji + 1}程`}` : ''
      return `${label}${segment.flightNo} ${segment.departureDate} ${segment.departure}${segment.arrival} ${segment.departureTime}-${segment.arrivalTime} ${segment.cabin}`
    }),
  )
  const selection = o.solutionId
    ? `- solutionId: ${o.solutionId}`
    : `- ${selector}`
  const verifyCommand = o.solutionId
    ? '请使用 simplifly-flyai-skill verify --solution-id 核验这个 solutionId 的实时价格和可售性。'
    : '请使用 simplifly-flyai-skill verify 核验这个方案的实时价格和可售性。'
  return [
    '请对以下方案做实时验价。',
    '',
    'selection:',
    selection,
    o.solutionId ? '' : `- originalOptionNumber: ${o.optionNumber}`,
    `- passengers: ${passengerCountForPrompt(o)}`,
    '',
    'expected itinerary:',
    ...checks.map((check) => `- ${check}`),
    '',
    `expected displayed price: ${priceDisplay(o)}`,
    '',
    `${verifyCommand} 验价成功后返回价格、舱位、行李是否变化；不要下单。`,
  ].filter(Boolean).join('\n')
}

function journeyLabel(o: CompactOption, j: CompactJourney, index: number): string {
  const stops = stopsLabel(j.transferCount)
  if (o.journeys.length === 1) return stops
  if (o.journeys.length === 2) return `${index === 0 ? '去程' : '回程'}${stops}`
  return `第${index + 1}程${stops}`
}

function baggageForCopy(o: CompactOption): string {
  const byJourney = o.journeys.map((j, i) => {
    const bags = [...new Set(j.segments.map((s) => s.checkedBaggage).filter((x): x is string => Boolean(x)))]
    const bag = bags.join('，') || o.baggage || '未返回'
    if (o.journeys.length === 1) return bag
    const label = o.journeys.length === 2 ? (i === 0 ? '去程' : '回程') : `第${i + 1}程`
    return `${label}${bag}`
  })
  return `行李：${byJourney.join('，')}`
}

function copyText(o: CompactOption): string {
  const supplied = o.copyText?.trim()
  if (supplied) return supplied
  const lines: string[] = []
  let n = 1
  for (const journey of o.journeys) {
    for (const segment of journey.segments) {
      const plus = crossDays(journey, segment)
      lines.push(`${n}. ${segment.flightNo}  ${dateCn(segment.departureDate)}  ${segment.departure}${segment.arrival}  ${airportName(segment.departure, segment.departureName, segment.departureTerminal)} → ${airportName(segment.arrival, segment.arrivalName, segment.arrivalTerminal)}  ${segment.departureTime} - ${segment.arrivalTime}${plus ? `+${plus}` : ''}---${segment.cabin}`)
      n += 1
    }
  }
  lines.push(customerPrice(o))
  lines.push(baggageForCopy(o))
  lines.push('改期：未返回')
  lines.push('退票：未返回')
  return lines.join('\n')
}

interface FlightTableRow {
  key: string
  option: CompactOption
  optionKey: string
  optionNumber: number | ''
  journey: string
  flightNo: string
  date: string
  route: string
  time: string
  duration: string
  cabin: string
  baggage: string
  price: string
  source: string
  recommended: boolean
  badges: string[]
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const el = document.createElement('textarea')
  el.value = text
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)
}

export function FlightResultsTable({
  options,
  totalCount,
  contextText = '',
  onBook,
  busy,
}: {
  options: CompactOption[]
  totalCount?: number
  contextText?: string
  onBook: (prompt: string) => void
  busy: boolean
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const showTotal = useMemo(() => options.some((o) => o.journeys.length > 2), [options])
  const recommended = useMemo(() => recommendedFlights(contextText), [contextText])
  const recommendedOptions = useMemo(() => options.filter((o) => {
    const tagged = /推荐|综合/.test(o.tag ?? '')
    return tagged || optionFlights(o).some((flightNo) => recommended.has(flightNo))
  }), [options, recommended])
  const rows = useMemo<FlightTableRow[]>(() => options.flatMap((o) => {
    let rowIndex = 0
    const displayPrice = priceDisplay(o)
    const source = o.sourceDisplay || o.source || '未返回'
    const optionKey = `${o.displayNumber ?? o.optionNumber}:${o.optionNumber}:${o.journeys[0]?.segments[0]?.flightNo ?? ''}`
    const isRecommended = recommendedOptions.includes(o)
    const badges = optionBadges(o, isRecommended)
    return o.journeys.flatMap((j, ji) =>
      j.segments.map((s, si) => {
        const first = rowIndex === 0
        const journeyFirst = si === 0
        rowIndex += 1
        return {
          key: `${optionKey}-${ji}-${si}`,
          option: o,
          optionKey,
          optionNumber: first ? (o.displayNumber ?? o.optionNumber) : '',
          journey: journeyFirst ? journeyLabel(o, j, ji) : '',
          flightNo: s.flightNo,
          date: dateCn(s.departureDate),
          route: routeCell(s),
          time: timeCell(j, s),
          duration: journeyFirst ? durationCell(j) : '',
          cabin: s.cabin || o.cabin || '未返回',
          baggage: s.checkedBaggage || o.baggage || '未返回',
          price: first ? displayPrice : '',
          source: first ? source : '',
          recommended: isRecommended,
          badges: first ? badges : [],
        }
      }),
    )
  }), [options, recommendedOptions])

  async function onCopy(o: CompactOption) {
    await writeClipboard(copyText(o))
    const optionKey = `${o.displayNumber ?? o.optionNumber}:${o.optionNumber}:${o.journeys[0]?.segments[0]?.flightNo ?? ''}`
    setCopied(optionKey)
    window.setTimeout(() => setCopied((current) => (current === optionKey ? null : current)), 1400)
  }

  return (
    <div className="results flight-table-block">
      <div className="results-head">
        <h2>航班方案</h2>
        <span className="muted">{totalCount ? `共匹配 ${totalCount} 条，` : ''}显示 {options.length} 个方案</span>
      </div>
      {recommendedOptions.length ? (
        <div className="flight-recommend">
          <span className="option-badge">推荐</span>
          <span>{recommendedOptions.map(optionSummary).join('；')}</span>
        </div>
      ) : null}
      <div className="table-scroll">
        <table className="flight-table">
          <thead>
            <tr>
              <th>方案</th>
              <th>操作</th>
              <th>航程</th>
              <th>航班号</th>
              <th>日期</th>
              <th>航段</th>
              <th>时间</th>
              <th>飞行时长</th>
              <th>舱位</th>
              <th>行李</th>
              <th>价格</th>
              {showTotal ? <th>总价</th> : null}
              <th>供应渠道</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={row.recommended ? 'recommended' : undefined}>
                <td className="option-cell">
                  {row.optionNumber ? (
                    <div className="option-mark">
                      <span className="option-num">{row.optionNumber}</span>
                      {row.badges.map((badge) => <span key={badge} className="option-badge">{badge}</span>)}
                    </div>
                  ) : null}
                </td>
                <td>
                  {row.optionNumber ? (
                    <div className="flight-actions">
                      <button type="button" disabled={busy} onClick={() => onBook(buildVerifyPrompt(row.option))}>验价</button>
                      <button type="button" onClick={() => onCopy(row.option)}>{copied === row.optionKey ? '已复制' : '复制'}</button>
                    </div>
                  ) : null}
                </td>
                <td>{row.journey}</td>
                <td className="mono">{row.flightNo}</td>
                <td>{row.date}</td>
                <td className="route-cell">{row.route}</td>
                <td className="mono">{row.time}</td>
                <td>{row.duration}</td>
                <td>{row.cabin}</td>
                <td>{row.baggage}</td>
                <td className="num">{row.price}</td>
                {showTotal ? <td className="num">{row.price}</td> : null}
                <td>{row.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

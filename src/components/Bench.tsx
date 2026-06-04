import type { DerivedView, FareVerification, FareJourney } from '../frames.ts'
import { PAX_LABELS, passengerName, docLabel, amountLine, type PassengerDraft } from '../booking.ts'
import { SearchResultsTable } from './SearchResultsTable.tsx'
import { FareDetailCard } from './FareDetailCard.tsx'
import { PassengerForm } from './PassengerForm.tsx'
import { ConfirmGate, type ConfirmRow } from './ConfirmGate.tsx'

export type BenchMode = 'auto' | 'passengers' | 'confirm'

function journeyText(j: FareJourney): string {
  const first = j.legs[0]
  const last = j.legs[j.legs.length - 1]
  const route = first && last ? `${first.departure} → ${last.arrival}` : `${j.origin} → ${j.destination}`
  const flights = j.legs.map((l) => l.flightNo).filter(Boolean).join(' / ')
  const stops = j.transferNum === 0 ? '直飞' : `中转${j.transferNum}次`
  return `${route} · ${flights} · ${j.departureDate} ${j.departureTime}→${j.arrivalTime} · ${stops}`
}

function orderGate(fare: FareVerification, passengers: PassengerDraft[]): { rows: ConfirmRow[]; warning: string | null } {
  const rows: ConfirmRow[] = fare.journeys.map((j, i) => ({
    label: fare.journeys.length > 1 ? `航段 ${i + 1}` : '航班',
    value: journeyText(j),
  }))
  passengers.forEach((p, i) => {
    const tail = p.docNo ? `尾号 ${p.docNo.slice(-4)}` : ''
    rows.push({ label: `乘机人 ${i + 1}`, value: `${passengerName(p)} · ${PAX_LABELS[p.paxType]} · ${docLabel(p.docType)}${tail ? ` ${tail}` : ''}` })
  })
  const first = passengers[0]
  if (first) rows.push({ label: '联系人', value: `默认使用 ${passengerName(first)} ${first.phone}` })
  const warning = fare.minAvailability !== null && fare.minAvailability <= 3
    ? `当前余票不多，仅剩 ${fare.minAvailability} 张，请尽快完成预订和支付；未支付前票价和余票可能变化。`
    : null
  return { rows, warning }
}

export function Bench({
  view,
  mode,
  orderDraft,
  international,
  onBook,
  onContinue,
  onSubmitPassengers,
  onBackFromForm,
  onConfirmOrder,
  onCancelConfirm,
  busy,
}: {
  view: DerivedView
  mode: BenchMode
  orderDraft: PassengerDraft[]
  international: boolean
  onBook: (label: string) => void
  onContinue: () => void
  onSubmitPassengers: (passengers: PassengerDraft[]) => void
  onBackFromForm: () => void
  onConfirmOrder: () => void
  onCancelConfirm: () => void
  busy: boolean
}) {
  const { stage, search, fare, notice } = view
  const hasAny = search || fare

  let body: React.ReactNode = null
  if (mode === 'passengers' && fare) {
    body = (
      <PassengerForm initial={orderDraft} international={international}
        onSubmit={onSubmitPassengers} onBack={onBackFromForm} busy={busy} />
    )
  } else if (mode === 'confirm' && fare) {
    const { rows, warning } = orderGate(fare, orderDraft)
    body = (
      <ConfirmGate
        title="确认创建订单"
        rows={rows}
        amountLine={amountLine(fare)}
        warning={warning}
        note="确认后我会为你创建订单，但不会自动支付。"
        confirmLabel="确认创建订单"
        onConfirm={onConfirmOrder}
        onCancel={onCancelConfirm}
        busy={busy}
      />
    )
  } else if (stage === 'verify' && fare) {
    body = <FareDetailCard fare={fare} onContinue={onContinue} busy={busy} />
  } else if (search) {
    body = <SearchResultsTable options={search.options} totalCount={search.totalCount} onBook={onBook} busy={busy} />
  }

  return (
    <div className="bench">
      {notice ? <div className="bench-notice">{notice}</div> : null}
      {body}
      {!hasAny && !body ? (
        <div className="bench-empty">
          <div className="bench-empty-mark">✈</div>
          <p>右侧是你的订票工作台。</p>
          <p className="muted">在左侧告诉我出发地、目的地和日期，搜索结果会显示在这里。</p>
        </div>
      ) : null}
    </div>
  )
}

import type { FareVerification, FareJourney } from '../frames.ts'

const CABIN_LABELS: Record<string, string> = {
  economy: '经济舱',
  premium_economy: '超级经济舱',
  business: '商务舱',
  premium_business: '超级商务舱',
  first: '头等舱',
  premium_first: '超级头等舱',
}
const PAX_LABELS: Record<string, string> = { adult: '成人', child: '儿童', infant: '婴儿' }

function fmtDuration(d: string): string {
  const m = /(\d+)h(\d+)m/.exec(d)
  if (!m) return d
  return `${Number(m[1])}小时${Number(m[2]).toString().padStart(2, '0')}分`
}
function cabin(c: string, code?: string): string {
  return (CABIN_LABELS[c] ?? c) + (code ? ` / ${code}` : '')
}
function pax(t: string): string {
  return PAX_LABELS[t] ?? t
}

function JourneyRow({ j }: { j: FareJourney }) {
  const first = j.legs[0]
  const last = j.legs[j.legs.length - 1]
  const route = first && last ? `${first.departure} → ${last.arrival}` : `${j.origin} → ${j.destination}`
  const flights = j.legs.map((l) => l.flightNo).filter(Boolean).join(' / ')
  const stops = j.transferNum === 0 ? '直飞' : `中转${j.transferNum}次`
  const cab = first ? cabin(first.cabinClass, first.cabinCode) : ''
  return (
    <div className="fare-journey">
      <div className="fare-journey-main">
        <span className="fare-route">{route}</span>
        <span className="mono fare-flights">{flights}</span>
      </div>
      <div className="fare-journey-sub muted">
        {j.departureDate} {j.departureTime} → {j.arrivalDate} {j.arrivalTime}
        {' · '}{stops} {fmtDuration(j.duration)}
        {cab ? ` · ${cab}` : ''}
      </div>
    </div>
  )
}

export function FareDetailCard({
  fare,
  onContinue,
  busy,
}: {
  fare: FareVerification
  onContinue: () => void
  busy: boolean
}) {
  const cur = fare.currency === 'CNY' ? '¥' : `${fare.currency} `
  const hasDiscount = fare.publishTotal > fare.total
  const low = fare.minAvailability !== null && fare.minAvailability <= 3
  const multiPax = fare.passengers.length > 1 || (fare.passengers[0]?.num ?? 1) > 1

  return (
    <div className="card fare-card">
      <div className="card-head">
        <h2>✅ 实时价格验证通过</h2>
        <span className="muted">下面是核验后的最终价格与规则</span>
      </div>

      <section className="fare-section">
        {fare.journeys.map((j, i) => <JourneyRow key={i} j={j} />)}
      </section>

      <section className="fare-section fare-price">
        <div className="fare-price-total">
          <span>应付总价</span>
          <strong>{cur}{fare.total}</strong>
        </div>
        <div className="fare-price-break muted">
          票面价 {cur}{fare.baseFare} + 税费 {cur}{fare.tax}
          {hasDiscount ? <span className="fare-strike"> 原价 {cur}{fare.publishTotal}</span> : null}
        </div>
        {multiPax ? (
          <table className="fare-pax">
            <tbody>
              {fare.passengers.map((p, i) => (
                <tr key={i}>
                  <td>{pax(p.passengerType)} ×{p.num}</td>
                  <td className="num">票面 {cur}{p.baseFare}</td>
                  <td className="num">税 {cur}{p.tax}</td>
                  <td className="num">小计 {cur}{p.salePrice * p.num}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {fare.baggage.length ? (
        <section className="fare-section">
          <h3>行李额</h3>
          {fare.baggage.map((b, i) => (
            <div key={i} className="fare-kv muted">
              {fare.baggage.length > 1 ? <span className="fare-tag">{pax(b.passengerType)}</span> : null}
              {b.carryOn ? <div>手提：{b.carryOn}</div> : null}
              {b.checked ? <div>托运：{b.checked}</div> : null}
            </div>
          ))}
        </section>
      ) : null}

      {fare.fareRules.length ? (
        <section className="fare-section">
          <h3>退改规则</h3>
          {fare.fareRules.map((r, i) => (
            <div key={i} className="fare-kv muted">
              {fare.fareRules.length > 1 ? <span className="fare-tag">{pax(r.passengerType)}</span> : null}
              {r.refundDescription ? <div>退票：{r.refundDescription}</div> : null}
              {r.changeDescription ? <div>改签：{r.changeDescription}</div> : null}
              <div>{r.canVoid ? '支持免费取消（以工具返回为准）' : '不支持免费取消'}</div>
            </div>
          ))}
        </section>
      ) : null}

      {low ? (
        <div className="fare-warn">
          当前余票不多，仅剩 {fare.minAvailability} 张，请尽快完成预订和支付；未支付前票价和余票可能变化。
        </div>
      ) : null}

      <div className="fare-cta">
        <button disabled={busy} onClick={onContinue}>继续预订，收集乘机人信息</button>
        <p className="hint">确认验价无误后点此继续；我会引导你提供乘机人信息，创建订单前还会再次跟你确认，且不会自动支付。</p>
      </div>
    </div>
  )
}

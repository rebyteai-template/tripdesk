import { useState } from 'react'

import type { FlightProposal, ProposalJourney } from '../frames.ts'
import { flightDateCn, flightMoney, flightRouteCell, journeyRoleLabel } from '../lib/flight-display.ts'

function journeyFacts(journey: ProposalJourney) {
  const segments = journey.itinerary.segments
  const first = segments[0]!
  const last = segments[segments.length - 1]!
  const cross = last.arrivalDate > first.departureDate ? '(+1)' : ''
  return {
    flightNo: segments.map((segment) => segment.flightNo).join(' → '),
    date: flightDateCn(first.departureDate),
    route: segments.map(flightRouteCell).join(' / '),
    time: `${first.departureTime}-${last.arrivalTime}${cross}`,
    duration: journey.itinerary.duration || first.flightTime || '--',
  }
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

export function FlightProposalTable({ proposal }: { proposal: FlightProposal }) {
  const [copied, setCopied] = useState(false)

  async function onCopy() {
    await copyText(proposal.copyText)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className="results proposal-card">
      <div className="proposal-head">
        <div>
          <span className="proposal-kicker">最终报价</span>
          <h2>{proposal.title}</h2>
        </div>
        {proposal.capabilities.canCopy ? (
          <button type="button" onClick={onCopy}>{copied ? '已复制' : 'Copy'}</button>
        ) : null}
      </div>
      <div className="table-scroll">
        <table className="proposal-table">
          <thead>
            <tr>
              <th>行程</th>
              <th>航班 / 日期</th>
              <th>航段</th>
              <th>时间 / 时长</th>
              <th>价格</th>
            </tr>
          </thead>
          <tbody>
            {proposal.journeys.map((journey, index) => {
              const facts = journeyFacts(journey)
              return (
                <tr key={`${journey.role}-${facts.flightNo}-${index}`}>
                  <td><span className="proposal-role">{journeyRoleLabel(journey.role, index)}</span></td>
                  <td className="proposal-flight"><strong className="mono">{facts.flightNo}</strong><span>{facts.date}</span></td>
                  <td className="route-cell">{facts.route}</td>
                  <td className="proposal-time"><strong className="mono">{facts.time}</strong><span>{facts.duration}</span></td>
                  <td className="proposal-fares">
                    {journey.fares.map((fare) => (
                      <div key={`${fare.passengerType}-${fare.cabin}`} className="proposal-fare-line">
                        <span><strong>{fare.passengers}人 {fare.cabin}</strong> · {flightMoney(fare.unitPrice, proposal.total.currency)}/人</span>
                        <span className="muted">{fare.baggage}</span>
                      </div>
                    ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={4}>方案总价</th>
              <td className="proposal-total">{flightMoney(proposal.total.amount, proposal.total.currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

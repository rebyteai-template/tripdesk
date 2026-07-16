import type { JourneyRole } from '../frames.ts'

export interface FlightRouteDisplay {
  departure: string
  departureName?: string
  departureTerminal?: string
  arrival: string
  arrivalName?: string
  arrivalTerminal?: string
}

function airportDisplayName(code: string, name?: string, terminal?: string): string {
  const base = (name || code).trim()
  if (!terminal) return base
  const normalized = terminal.startsWith('T') ? terminal : terminal.replace(/[()]/g, '')
  if (base.includes(normalized) || base.includes(`(${normalized})`)) return base
  return `${base}(${normalized})`
}

export function flightRouteCell(route: FlightRouteDisplay): string {
  return `${route.departure}${route.arrival} ${airportDisplayName(route.departure, route.departureName, route.departureTerminal)} → ${airportDisplayName(route.arrival, route.arrivalName, route.arrivalTerminal)}`
}

export function flightDateCn(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return match ? `${Number(match[2])}月${match[3]}日` : iso
}

export function flightMoney(amount: number, currency: string): string {
  const prefix = currency.toUpperCase() === 'CNY' ? '¥' : `${currency} `
  return `${prefix}${amount.toLocaleString('zh-CN')}`
}

export function journeyRoleLabel(role: JourneyRole, index: number): string {
  if (role === 'outbound') return '去程'
  if (role === 'inbound') return '回程'
  return role === 'oneway' ? '单程' : `第${index + 1}程`
}

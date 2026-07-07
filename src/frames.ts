/**
 * Turns raw stream-json frames into the booking-domain state the chat stream renders.
 *
 * The UI is a mirror of the agent's TravelKit tool_results (DESIGN §4.1): we
 * walk the frames, recognise which travelkit tool produced each tool_result, and
 * derive a per-stage view model. The most recent successful domain tool decides
 * the active stage (a fresh search after a verify drops back to results).
 *
 * We read the FULL `assistant` / `user` / `result` frames and ignore the partial
 * `stream_event` deltas — simpler and good enough. Internal IDs
 * (solutionId/orderKey/coreSegmentId/airline codes) live only in the agent's
 * tool args and are never surfaced here.
 */
import type { Attachment, PromptContent } from './api.ts'

// ── search (rebyte-flight compact JSON) ────────────────────────────────
// The skill runs python scripts in the sandbox; the structured result we can parse
// is the COMPACT JSON (flight_search_compact.py stdout), replayed into our frames from
// the sub-session. `displayOptions` = the skill's curated recommendations, each fully
// structured. `displayMapping` (which carries the private solutionId) stays agent-side
// and is never read here. Cards mirror whatever the skill recommended — the real
// filtering/refinement ("拉扯") happens conversationally in chat.
export interface CompactSegment {
  flightNo: string
  departure: string        // IATA code
  departureName: string    // e.g. "北京大兴(PKX)"
  departureTerminal?: string
  departureDate: string
  departureTime: string
  arrival: string
  arrivalName: string
  arrivalTerminal?: string
  arrivalDate: string
  arrivalTime: string
  cabin: string            // already display form, e.g. "经济舱 T舱"
  checkedBaggage?: string  // e.g. "1件，20kg/件"
}
export interface CompactJourney {
  origin: string
  destination: string
  departureDate: string
  departureTime: string
  arrivalDate: string
  arrivalTime: string
  duration: string
  transferCount: number
  segments: CompactSegment[]
}
export interface CompactOption {
  optionNumber: number     // the user-visible 序号; selection rides this, never solutionId
  section?: string
  journeyType: string      // "单程直飞" | "单程中转N次" | "多程"
  duration: string         // "2h10m"
  durationMinutes: number
  cabin: string
  baggage?: string
  hasCheckedBaggage: boolean
  price: { amount: number; currency: string; display: string }
  journeys: CompactJourney[]
}
export interface SearchResult {
  options: CompactOption[]
  totalCount?: number       // unique candidates matched (skill curated down to options[])
}

// ── verify (rebyte-flight compact: flight_verify_selected.py) ──────────
// The verify result is COMPACT family too — a Bash result recognised by shape
// (`selectedOption`+`verifiedOption`), NOT an MCP tool by name. `verifiedOption` re-states the
// chosen option re-priced; `comparison` flags any change. Internal ids (solutionId/orderKey) stay
// in the script's private fields and are never read here. FareVerification is the booking fare
// model the write-flow consumes; compact fills what it has and leaves the rest empty (the card
// hides those) rather than faking per-pax splits / structured rules / availability.
export interface FareLeg {
  flightNo: string
  departure: string
  arrival: string
  cabinClass: string
  cabinCode?: string
  availability?: number
}
export interface FareJourney {
  origin: string
  destination: string
  departureDate?: string
  departureTime?: string
  arrivalDate?: string
  arrivalTime?: string
  duration: string
  transferNum: number
  legs: FareLeg[]
}
export interface FarePassengerLine {
  passengerType: string
  baseFare: number
  tax: number
  salePrice: number
  num: number
}
export interface BaggageInfo {
  passengerType: string
  carryOn?: string
  checked?: string
}
export interface FareRuleInfo {
  passengerType: string
  canVoid: boolean
  refundDescription?: string
  changeDescription?: string
}
export interface FareVerification {
  currency: string
  total: number
  baseFare: number
  tax: number
  publishTotal: number
  journeys: FareJourney[]
  passengers: FarePassengerLine[]
  baggage: BaggageInfo[]
  fareRules: FareRuleInfo[]
  minAvailability: number | null
  /** Compact verify gives the price split as a ready display string ("票价 ¥X + 税费 ¥Y"), not
   *  structured base/tax numbers — carried here so the card and order prompt show it verbatim. */
  priceBreakdownDisplay?: string
  /** Set when the re-priced solution differs from what the user picked (price/baggage/etc changed)
   *  — a Chinese advisory the card surfaces before the user continues to passenger collection. */
  changeNotice?: string
}

// ── chat + combined view ───────────────────────────────────────────────
export interface ChatBubble {
  key: string
  role: 'user' | 'assistant'
  text: string
  /** UTC timestamp this bubble was "sent": the prompt's created_at for the user turn, its
   *  completed_at (falling back to created_at while running) for assistant turns. The UI converts
   *  to the viewer's local timezone — see src/lib/time.ts. Absent on the rebyte run link. */
  ts?: string
  /** When set, the bubble renders as a link to this turn's rebyte run. */
  runUrl?: string
  /** Turn-level failure (DO `__error` frame) — rendered in the error palette. */
  error?: boolean
  /** Inline 方案 cards attached to this assistant turn (chat-stream): the rebyte-flight
   *  compact search rendered as selectable cards, with the agent's redundant markdown
   *  table stripped from `text`. Each search keeps its own bubble → full history. */
  cards?: CompactOption[]
  totalCount?: number
  /** Inline verify (fare) card attached to the verify turn — same chat-stream treatment as
   *  `cards`. The latest verify's fare is the SAME object as `DerivedView.fare`, so the panel
   *  shows the "继续预订" CTA only on that one (`b.fare === view.fare`). */
  fare?: FareVerification
  /** Images/files the user attached to this turn — rendered above the user bubble (thumbnails /
   *  file chips). Set only on user bubbles, only when non-empty. */
  attachments?: Attachment[]
}

export type Stage = 'idle' | 'search' | 'verify' | 'order' | 'payment'

export interface DerivedView {
  chat: ChatBubble[]
  stage: Stage
  search: SearchResult | null
  fare: FareVerification | null
  /** Last domain-tool failure surfaced to the user (e.g. price expired). */
  notice: string | null
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object'
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is { type: string; text: string } => isObj(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Remove markdown table blocks from assistant text when the same options render as inline
 *  cards — avoids showing the data twice. Deterministic, no agent cooperation: drop lines
 *  shaped like table rows (`| … |`) and collapse the resulting gap. */
function stripTables(text: string): string {
  const kept = text.split('\n').filter((line) => !/^\s*\|.*\|\s*$/.test(line))
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function derive(prompts: PromptContent[]): DerivedView {
  const chat: ChatBubble[] = []
  let search: SearchResult | null = null
  let fare: FareVerification | null = null
  let notice: string | null = null
  let stage: Stage = 'idle'
  // Signature of the last rendered card set, so a re-surfaced identical compact (the verify
  // turn re-reads the search compact file) doesn't render the same 方案 cards twice.
  let lastCardsSig = ''

  for (const p of prompts) {
    // The user turn is stamped with when it was sent; every assistant bubble in this turn is
    // stamped with the turn's completion (created_at while it's still streaming).
    const userTs = p.created_at
    const replyTs = p.completed_at ?? p.created_at
    // Attach the key only when there are attachments, so an optimistic turn (undefined) and a
    // reloaded one (server may send []) derive the identical user bubble (I0).
    chat.push({ key: `u-${p.id}`, role: 'user', text: p.prompt, ts: userTs, ...(p.attachments?.length ? { attachments: p.attachments } : {}) })
    // Hold this prompt's latest search / verify; attach to the next assistant text (stripping its
    // redundant markdown table), else flush as a standalone card bubble at prompt end.
    let pendingSearch: SearchResult | null = null
    let pendingFare: FareVerification | null = null

    for (const f of p.frames) {
      const data = f.data
      if (!isObj(data)) continue

      // rebyte run link for this turn (emitted by the DO when the relay task starts)
      if (typeof data.__rebyte_run === 'string') {
        chat.push({ key: `r-${p.id}-${f.seq}`, role: 'assistant', text: '', runUrl: `https://app.rebyte.ai/run/${data.__rebyte_run}` })
        continue
      }

      // turn failure (timeout / relay error) — without this bubble a failed turn is
      // indistinguishable from a blank chat once the loading indicator clears
      if (typeof data.__error === 'string' && data.__error.trim()) {
        chat.push({ key: `e-${p.id}-${f.seq}`, role: 'assistant', text: data.__error, error: true, ts: replyTs })
        continue
      }

      // assistant turn: collect text bubbles
      if (data.type === 'assistant' && isObj(data.message)) {
        const content = (data.message as Record<string, unknown>).content
        // Only a frame with real text consumes pendingSearch — a tool_use-only frame (e.g. the
        // sub-agent's `Write`) has empty text and must NOT swallow the cards before the summary.
        const text = textFromContent(content)
        if (text.trim()) {
          const key = `a-${(data.message as Record<string, unknown>).id ?? f.seq}-${f.seq}`
          // A search / verify card attaches to this turn's prose, with the redundant markdown
          // table stripped (the card shows the same data). Both can ride one bubble.
          const bubble: ChatBubble = { key, role: 'assistant', text, ts: replyTs }
          if (pendingSearch || pendingFare) bubble.text = stripTables(text)
          if (pendingSearch) { bubble.cards = pendingSearch.options; bubble.totalCount = pendingSearch.totalCount; pendingSearch = null }
          if (pendingFare) { bubble.fare = pendingFare; pendingFare = null }
          chat.push(bubble)
        }
      }

      // user turn carrying a tool_result. Both card-driving shapes are rebyte-flight COMPACT
      // family (Bash results — the skill talks direct HTTP, never MCP), so we route by SHAPE, not
      // tool name: search by `displayOptions`+`displayMapping`, verify by `selectedOption`+`verifiedOption`.
      if (data.type === 'user' && isObj(data.message)) {
        const content = (data.message as Record<string, unknown>).content
        if (!Array.isArray(content)) continue
        for (const block of content) {
          if (!isObj(block) || block.type !== 'tool_result') continue
          const raw = textFromContent(block.content)

          // compact search — cheap signature gate before parsing the (large) JSON
          if (raw.includes('"displayOptions"') && raw.includes('"displayMapping"')) {
            const payload = parseToolJson(raw)
            const parsed = payload && parseCompactSearch(payload)
            if (parsed) {
              search = parsed; fare = null; notice = null; stage = 'search'
              const sig = parsed.options.map((o) => `${o.optionNumber}:${o.price.amount}:${o.journeys[0]?.segments[0]?.flightNo ?? ''}`).join('|')
              if (sig !== lastCardsSig) { pendingSearch = parsed; lastCardsSig = sig }
              continue
            }
          }

          // compact verify (fare card) — shape gate; on expiry/failure surface a notice and keep
          // the prior stage so the user re-picks from the agent's refreshed (inline) search.
          if (raw.includes('"verifiedOption"') && raw.includes('"selectedOption"')) {
            const payload = parseToolJson(raw)
            if (!payload) continue
            if (payload.ok !== true) {
              notice = verifyErrorNotice(payload)
            } else {
              const parsed = parseCompactVerify(payload)
              if (parsed) { fare = parsed; pendingFare = parsed; notice = null; stage = 'verify' }
            }
            continue
          }
          // order / payment stages parsed in a later milestone
        }
      }
    }

    // a search / verify with no trailing summary text → standalone card bubble (keeps it visible)
    if (pendingSearch) {
      chat.push({ key: `cards-${p.id}`, role: 'assistant', text: '', cards: pendingSearch.options, totalCount: pendingSearch.totalCount, ts: replyTs })
    }
    if (pendingFare) {
      chat.push({ key: `fare-${p.id}`, role: 'assistant', text: '', fare: pendingFare, ts: replyTs })
    }
  }

  // de-dupe consecutive identical assistant bubbles; never drop a card- or attachment-bearing bubble
  const deduped: ChatBubble[] = []
  for (const b of chat) {
    const prev = deduped[deduped.length - 1]
    if (!b.cards && !b.fare && !b.attachments && prev && prev.role === b.role && prev.text === b.text && prev.runUrl === b.runUrl && !prev.cards && !prev.fare && !prev.attachments) continue
    deduped.push(b)
  }
  return { chat: deduped, stage, search, fare, notice }
}

function parseToolJson(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return null
  try {
    const json = JSON.parse(raw)
    return isObj(json) ? json : null
  } catch {
    return null
  }
}

/** rebyte-flight compact search JSON → search view model. Tool-name agnostic: this is
 *  a Bash result (python script stdout), recognised by its `displayOptions`/`displayMapping`
 *  shape. We read only the public `displayOptions`; `displayMapping.solutionId` stays private. */
function parseCompactSearch(json: Record<string, unknown>): SearchResult | null {
  if (!Array.isArray(json.displayOptions) || !isObj(json.displayMapping)) return null
  const options: CompactOption[] = []
  for (const raw of json.displayOptions) {
    const o = toCompactOption(raw)
    if (o) options.push(o)
  }
  if (!options.length) return null
  const sr = Array.isArray(json.searchedRequests) && isObj(json.searchedRequests[0]) ? json.searchedRequests[0] : null
  const totalCount = sr && typeof sr.uniqueCandidateCount === 'number' ? sr.uniqueCandidateCount : undefined
  return { options, totalCount }
}

function toCompactOption(raw: unknown): CompactOption | null {
  if (!isObj(raw)) return null
  const optionNumber = num(raw.optionNumber)
  if (!optionNumber) return null

  const journeys: CompactJourney[] = []
  for (const j of Array.isArray(raw.journeys) ? raw.journeys : []) {
    if (!isObj(j)) continue
    const segments: CompactSegment[] = []
    for (const s of Array.isArray(j.segments) ? j.segments : []) {
      if (!isObj(s)) continue
      segments.push({
        flightNo: str(s.flightNo),
        departure: str(s.departure),
        departureName: str(s.departureName) || str(s.departure),
        departureTerminal: str(s.departureTerminal) || undefined,
        departureDate: str(s.departureDate),
        departureTime: str(s.departureTime),
        arrival: str(s.arrival),
        arrivalName: str(s.arrivalName) || str(s.arrival),
        arrivalTerminal: str(s.arrivalTerminal) || undefined,
        arrivalDate: str(s.arrivalDate),
        arrivalTime: str(s.arrivalTime),
        cabin: str(s.cabin),
        checkedBaggage: str(s.checkedBaggage) || undefined,
      })
    }
    if (!segments.length) continue
    journeys.push({
      origin: str(j.origin),
      destination: str(j.destination),
      departureDate: str(j.departureDate),
      departureTime: str(j.departureTime),
      arrivalDate: str(j.arrivalDate),
      arrivalTime: str(j.arrivalTime),
      duration: str(j.duration),
      transferCount: num(j.transferCount),
      segments,
    })
  }
  if (!journeys.length) return null

  const firstTransfer = journeys[0]?.transferCount ?? 0
  const price = isObj(raw.price) ? raw.price : {}
  const amount = num(price.amount)
  return {
    optionNumber,
    section: str(raw.section) || undefined,
    journeyType: str(raw.journeyType) || (firstTransfer === 0 ? '直飞' : `中转${firstTransfer}次`),
    duration: str(raw.duration),
    durationMinutes: num(raw.durationMinutes),
    cabin: str(raw.cabin),
    baggage: str(raw.baggage) || undefined,
    hasCheckedBaggage: raw.hasCheckedBaggage === true,
    price: { amount, currency: str(price.currency) || 'CNY', display: str(price.display) || `¥${amount}` },
    journeys,
  }
}

/** rebyte-flight compact verify JSON (flight_verify_selected.py stdout) → fare view model.
 *  Recognised by shape (`selectedOption`+`verifiedOption`), like the compact search. We read the
 *  curated `verifiedOption` summary only; solutionId/orderKey stay in the script's private fields.
 *  Compact carries no per-passenger price split, structured fare rules, or seat availability — those
 *  stay empty (the card hides them) rather than being faked. */
function parseCompactVerify(json: Record<string, unknown>): FareVerification | null {
  const verified = isObj(json.verifiedOption) ? json.verifiedOption : null
  if (!verified) return null

  const journeys: FareJourney[] = []
  for (const j of Array.isArray(verified.journeys) ? verified.journeys : []) {
    if (!isObj(j)) continue
    const legs: FareLeg[] = []
    for (const s of Array.isArray(j.segments) ? j.segments : []) {
      if (!isObj(s)) continue
      // compact `cabin` is already a display string ("经济舱 T舱"); carry it as cabinClass so
      // cabinLabel() falls through to it unchanged (there is no separate cabinCode to split here).
      legs.push({ flightNo: str(s.flightNo), departure: str(s.departure), arrival: str(s.arrival), cabinClass: str(s.cabin) })
    }
    if (!legs.length) continue
    journeys.push({
      origin: str(j.origin),
      destination: str(j.destination),
      departureDate: str(j.departureDate) || undefined,
      departureTime: str(j.departureTime) || undefined,
      arrivalDate: str(j.arrivalDate) || undefined,
      arrivalTime: str(j.arrivalTime) || undefined,
      duration: str(j.duration),
      transferNum: num(j.transferCount),
      legs,
    })
  }
  if (!journeys.length) return null

  const price = isObj(verified.price) ? verified.price : {}
  const total = num(price.amount)
  const currency = str(price.currency) || 'CNY'

  // passenger rows from the verify request's counts (compact has no per-type price split) — enough
  // to seed the right number of form rows; salePrice stays 0 so the card hides the per-pax table.
  const passengers: FarePassengerLine[] = []
  const reqCount = isObj(json.request) && isObj(json.request.passengerCount) ? json.request.passengerCount : null
  for (const t of ['adult', 'child', 'infant'] as const) {
    const n = reqCount ? num(reqCount[t]) : 0
    if (n > 0) passengers.push({ passengerType: t, baseFare: 0, tax: 0, salePrice: 0, num: n })
  }
  if (!passengers.length) passengers.push({ passengerType: 'adult', baseFare: 0, tax: 0, salePrice: 0, num: 1 })

  // solution-level baggage string; only surfaced when the fare actually includes checked baggage.
  const baggage: BaggageInfo[] = []
  const bagStr = str(verified.baggage)
  if (verified.hasCheckedBaggage === true && bagStr) baggage.push({ passengerType: 'adult', checked: bagStr })

  return {
    currency,
    total,
    baseFare: 0,
    tax: 0,
    publishTotal: total,
    journeys,
    passengers,
    baggage,
    fareRules: [],
    minAvailability: null,
    priceBreakdownDisplay: str(verified.priceBreakdownDisplay) || undefined,
    changeNotice: buildChangeNotice(json.comparison),
  }
}

/** A successful verify whose re-priced solution differs from the user's pick → a short Chinese
 *  advisory the card shows before continuing. Undefined when nothing material changed. */
function buildChangeNotice(comparison: unknown): string | undefined {
  if (!isObj(comparison) || comparison.changed !== true) return undefined
  const labels: Record<string, string> = { flights: '航班', price: '价格', cabin: '舱位', baggage: '行李额', hasCheckedBaggage: '是否含托运' }
  const fields = (Array.isArray(comparison.changedFields) ? comparison.changedFields : [])
    .map((f) => labels[str(f)])
    .filter((x): x is string => Boolean(x))
  if (!fields.length) return undefined
  return `验价后${fields.join('、')}较所选有变化，请确认后再继续预订。`
}

/** Verify failed (expired search / rejected) → a user-facing notice. The agent re-runs search on
 *  expiry, so we point the user back to the refreshed options rather than the dead solution. */
function verifyErrorNotice(payload: Record<string, unknown>): string {
  if (str(payload.errorType) === 'expired_search') return '该方案价格/库存可能已过期，请从最新搜索结果中重新选择。'
  return str(payload.message) || '实时验价未通过，请稍后重试或重新选择其他方案。'
}

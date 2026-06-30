/**
 * Chat message timestamps — parse + format, with the timezone handled correctly.
 *
 * The store writes timestamps via SQLite `datetime('now')`: a UTC instant formatted
 * "YYYY-MM-DD HH:MM:SS" with NO timezone marker. `new Date("2026-06-30 12:34:56")`
 * would read that bare form as LOCAL time — wrong, the value is UTC — so we normalize
 * to ISO-UTC before parsing. Optimistic bubbles instead carry a real ISO string
 * (`new Date().toISOString()`, already has the `Z`) and pass through untouched.
 *
 * Rendering goes through `toLocale*`, which targets the VIEWER's local timezone: a
 * Beijing user sees Beijing time, a traveler abroad sees theirs — both off the same
 * stored UTC instant.
 */

/** Parse a stored timestamp into a Date, treating the bare SQLite form as UTC. Returns
 *  null for empty / unparseable input. */
export function parseTs(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  // Already carries a tz designator (trailing `Z` or `±HH:MM`) → trust it. Otherwise it's
  // the bare SQLite UTC form: swap the date/time space for `T` and stamp `Z` so the engine
  // parses it as UTC instead of local.
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)
  const iso = hasTz ? s : s.replace(' ', 'T') + 'Z'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Compact label under a bubble — `HH:MM` for today, `M月D日 HH:MM` for older messages.
 *  Both the date parts (getMonth/getDate) and the time read LOCAL components, so the whole
 *  label is in the viewer's timezone. */
export function shortStamp(d: Date): string {
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (sameDay) return time
  return `${d.getMonth() + 1}月${d.getDate()}日 ${time}`
}

/** Hover title — full local date+time plus the explicit timezone name (e.g. "GMT+8"), so
 *  the displayed local time is never ambiguous. */
export function fullStamp(d: Date): string {
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZoneName: 'short',
  })
}

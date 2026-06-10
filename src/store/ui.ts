import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { BenchMode } from '../components/Bench.tsx'
import type { PassengerDraft } from '../booking.ts'

// The current session lives in the URL (?t=…) so refresh / deep-link restores it.
// Identity comes from the embed handoff, so a session belongs to a tenant, not a tab.
function readUrlTaskId(): string | null {
  return new URLSearchParams(location.search).get('t')
}
function writeUrlTaskId(id: string | null): void {
  const u = new URL(location.href)
  if (id) u.searchParams.set('t', id)
  else u.searchParams.delete('t')
  history.replaceState(null, '', u)
}

const _taskIdAtom = atom<string | null>(readUrlTaskId())
/** Current session id. Reads are plain; writes also mirror to the URL (?t=). */
export const taskIdAtom = atom(
  (get) => get(_taskIdAtom),
  (_get, set, id: string | null) => {
    set(_taskIdAtom, id)
    writeUrlTaskId(id)
  },
)

/** Which bench view is showing. 'auto' follows the agent's frames; the others are
 *  driven by UI gestures (passenger form, confirm gate). */
export const benchModeAtom = atom<BenchMode>('auto')

/** In-progress passenger details for the current order draft. */
export const orderDraftAtom = atom<PassengerDraft[]>([])

/** Mobile session drawer open/closed. */
export const navOpenAtom = atom(false)

/** Mobile: which pane (chat | bench) is visible. */
export const paneAtom = atom<'chat' | 'bench'>('chat')

// Light/dark, persisted as a raw string under the legacy key so existing users
// keep their choice (default JSON storage would fail to parse the old raw value).
const rawThemeStorage = {
  getItem: (key: string, initial: 'light' | 'dark'): 'light' | 'dark' => {
    try {
      const v = localStorage.getItem(key)
      return v === 'dark' || v === 'light' ? v : initial
    } catch {
      return initial
    }
  },
  setItem: (key: string, value: 'light' | 'dark') => {
    try { localStorage.setItem(key, value) } catch { /* ignore */ }
  },
  removeItem: (key: string) => {
    try { localStorage.removeItem(key) } catch { /* ignore */ }
  },
}
export const themeAtom = atomWithStorage<'light' | 'dark'>('tripdesk-theme', 'light', rawThemeStorage)

/** Hidden debug mode (revealed by tapping the brand 10×) — gates the "new VM" control. */
export const debugAtom = atom(false)

/** Reset to a brand-new session (clears the task + its draft/bench state). */
export const newSessionAtom = atom(null, (_get, set) => {
  set(taskIdAtom, null)
  set(orderDraftAtom, [])
  set(benchModeAtom, 'auto')
  set(navOpenAtom, false)
})

/** Open an existing session: switch task, reset transient bench state, close drawer. */
export const openSessionAtom = atom(null, (_get, set, id: string) => {
  set(taskIdAtom, id)
  set(orderDraftAtom, [])
  set(benchModeAtom, 'auto')
  set(navOpenAtom, false)
})

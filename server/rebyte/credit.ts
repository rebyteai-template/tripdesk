/**
 * Org credit balance lookup (read-only) for the low-balance UI banner.
 *
 * The cctools relay already exposes the org wallet at `GET /v1/billing/credits`
 * (auth via the same API_KEY header as everything else). The org credit is tied
 * to the Worker's single REBYTE_API_KEY, so this balance is ORG-WIDE — shared by
 * all tenants of this deployment, not per end-user. We surface only `totalAvailable`
 * (the sum of every available pool); the rest of the billing payload — account ids,
 * lifetime totals — stays server-side and never reaches the UI.
 */
import { rebyteJSON, type RebyteConfig } from './client.ts'

/** Trimmed shape returned by GET /billing/credits (only the field the UI thresholds on). */
interface BillingCredits {
  totalAvailable?: number
}

/** Fetch the org's total available credit. Read-only; never throws to the caller —
 *  a relay hiccup must not be mistaken for "out of credit" (that would wrongly nag the
 *  user). On any failure returns null, which the route maps to `low: false`. */
export async function fetchCredit(config: RebyteConfig): Promise<number | null> {
  try {
    const r = await rebyteJSON<BillingCredits>('/billing/credits', { config })
    return typeof r.totalAvailable === 'number' ? r.totalAvailable : null
  } catch {
    return null
  }
}

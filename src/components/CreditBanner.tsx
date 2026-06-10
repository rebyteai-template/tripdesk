/**
 * Low-balance banner. Shows when the org's rebyte credit drops below the server-side
 * threshold (GET /credit → low). Org-wide (the deployment runs on one relay key), so every
 * tenant sees it; an admin tops up out of band. Dismissable per page load — but since `low`
 * stays true until a top-up, it reappears on the next session/reload, which is intended.
 *
 * Purely a heads-up: it does NOT block the composer (product decision — "仅横幅提示").
 */
import { useState } from 'react'

export function CreditBanner({ low }: { low: boolean }) {
  const [dismissed, setDismissed] = useState(false)
  if (!low || dismissed) return null
  return (
    <div className="credit-banner" role="alert">
      <span className="credit-banner-icon" aria-hidden="true">⚠️</span>
      <span className="credit-banner-text">账户额度即将用尽，请尽快充值，以免影响正常使用。</span>
      <button className="credit-banner-close" onClick={() => setDismissed(true)} aria-label="关闭提示">
        ✕
      </button>
    </div>
  )
}

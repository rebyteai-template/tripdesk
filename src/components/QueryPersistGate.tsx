import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { TENANT_ID } from '../api.ts'
import { makeQueryClient } from '../lib/queryClient.ts'
import {
  createIdbPersister,
  deletePersistedCache,
  persistKeyForTenant,
  shouldDehydrateQuery,
  QUERY_PERSIST_BUSTER,
  QUERY_PERSIST_MAX_AGE,
} from '../lib/queryPersist.ts'

// Remembers which tenant last used this device so we can wipe their snapshot
// when a different tenant loads (shared-device hygiene).
const LAST_TENANT_KEY = 'tripdesk-last-tenant'

/**
 * Wraps the app's React Query client in PersistQueryClientProvider so cached
 * server data (sessions, task history) survives reloads via IndexedDB. The cache
 * is keyed per tenant — (org, uid) from the embed handoff — and the previous
 * tenant's snapshot is wiped on identity change so nothing leaks across tenants
 * in the shared iframe. Falls back to a bare provider when unidentified.
 *
 * Tenant identity is read once from the URL fragment at load (api.ts), so it's
 * fixed for the page lifetime; the wipe effect therefore runs at most once.
 */
export function QueryPersistGate({ children }: { children: ReactNode }) {
  const tenant = TENANT_ID
  const queryClient = useMemo(() => makeQueryClient(), [tenant])
  const persister = useMemo(
    () => (tenant ? createIdbPersister(persistKeyForTenant(tenant)) : null),
    [tenant],
  )

  const wiped = useRef(false)
  useEffect(() => {
    if (wiped.current || !tenant) return
    wiped.current = true
    let prev: string | null = null
    try {
      prev = localStorage.getItem(LAST_TENANT_KEY)
      localStorage.setItem(LAST_TENANT_KEY, tenant)
    } catch {
      /* storage blocked (private mode / sandbox) — skip the wipe */
    }
    if (prev && prev !== tenant) {
      deletePersistedCache(prev).catch((e) =>
        console.error('Failed to wipe prior tenant query cache', e),
      )
    }
  }, [tenant])

  if (!tenant || !persister) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  return (
    <PersistQueryClientProvider
      key={tenant}
      client={queryClient}
      persistOptions={{
        persister,
        buster: QUERY_PERSIST_BUSTER,
        maxAge: QUERY_PERSIST_MAX_AGE,
        dehydrateOptions: { shouldDehydrateQuery },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}

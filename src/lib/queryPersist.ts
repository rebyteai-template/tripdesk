import type { Query } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'

// Bump on every build so a new deploy invalidates persisted snapshots before
// they ever hydrate. __BUILD_TIME__ is injected by vite.config.ts.
export const QUERY_PERSIST_BUSTER = __BUILD_TIME__

// Snapshots older than 24h are thrown out on hydration — keeps
// stale-while-revalidate honest (no silently day-old session lists).
export const QUERY_PERSIST_MAX_AGE = 24 * 60 * 60 * 1000

// Query-key heads that must NOT touch IndexedDB. `me` is auth-shaped: it must be
// validated fresh on every load (a persisted 200 would wrongly skip the gate).
// Live stream frames never enter React Query — they live in the jotai
// conversation store — so `taskContent` only ever holds the server's settled
// snapshot and is safe to persist (instant history on reload).
const NO_PERSIST_PREFIXES = new Set<string>(['me'])

export function shouldDehydrateQuery(query: Query): boolean {
  if (query.state.status !== 'success') return false
  const head = query.queryKey[0]
  if (typeof head !== 'string') return false
  return !NO_PERSIST_PREFIXES.has(head)
}

// Per-tenant IndexedDB key. Tenant = (org, uid) from the embed handoff. Switching
// tenants on a shared device wipes the prior entry (QueryPersistGate) so a cache
// never leaks across tenants. Bump the version suffix on breaking shape changes.
export function persistKeyForTenant(tenant: string): string {
  return `tripdesk-rq-cache-v1-${tenant}`
}

export function createIdbPersister(key: string) {
  return createAsyncStoragePersister({
    storage: {
      getItem: (k: string) => idbGet<string>(k).then((v) => v ?? null),
      setItem: (k: string, v: string) => idbSet(k, v),
      removeItem: (k: string) => idbDel(k),
    },
    key,
    // React Query fires on every cache mutation; throttle whole-client serialisation.
    throttleTime: 1000,
  })
}

export function deletePersistedCache(tenant: string): Promise<void> {
  return idbDel(persistKeyForTenant(tenant))
}

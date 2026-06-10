import { QueryClient } from '@tanstack/react-query'

/**
 * Shared QueryClient defaults, mirroring cctools (frontend/src/components/
 * QueryPersistGate.tsx): aggressive revalidation (5s stale, always refetch on
 * mount), fail-fast on auth / not-found, retry transient errors up to 3×.
 *
 * Our fetch layer (api.ts `json()`) throws `"<METHOD> <path> failed: <status>"`,
 * so we sniff the status out of the message rather than an axios-style response.
 */
export const QC_OPTIONS = {
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchOnMount: 'always' as const,
      retry: (failureCount: number, error: unknown) => {
        const msg = error instanceof Error ? error.message : ''
        if (/\bfailed: (401|403|404)\b/.test(msg)) return false
        return failureCount < 3
      },
    },
  },
}

export function makeQueryClient(): QueryClient {
  return new QueryClient(QC_OPTIONS)
}

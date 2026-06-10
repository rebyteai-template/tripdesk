import { useQuery } from '@tanstack/react-query'
import { getCredit } from '../api.ts'
import { queryKeys } from '../lib/queryKeys.ts'

/** Org credit status for the low-balance banner. Credit is only consumed by running turns,
 *  so a slow poll (60s) plus an invalidate after each turn (useSendMessage) keeps it fresh
 *  without busy-polling. `enabled` gates it behind a valid embed (no point querying when 401). */
export function useCredit(enabled = true) {
  return useQuery({
    queryKey: queryKeys.credit(),
    queryFn: getCredit,
    enabled,
    refetchInterval: 60_000,
  })
}

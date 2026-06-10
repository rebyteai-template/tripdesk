import { useQuery } from '@tanstack/react-query'
import { getMe } from '../api.ts'
import { queryKeys } from '../lib/queryKeys.ts'

/** The signed-in user (Cloudflare Access embed handoff). `isError` (401) → the
 *  app shows Unauthorized; `isPending` → the booting splash. */
export function useMe() {
  return useQuery({ queryKey: queryKeys.me(), queryFn: getMe })
}

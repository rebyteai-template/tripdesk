import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDebugConfig, saveDebugConfig } from '../api.ts'
import { queryKeys } from '../lib/queryKeys.ts'

/** The GLOBAL debug config (skill ref + manager prompt) shared by all users. Only fetched when the
 *  panel is mounted (App gates it on debugAtom). Not persisted (see queryKeys) → always fresh. */
export function useDebugConfig() {
  return useQuery({ queryKey: queryKeys.debugConfig(), queryFn: getDebugConfig })
}

/** Save the global config (admin only; 403 otherwise). Refetches the config on success so the panel
 *  reflects the persisted values (empty field → server echoes it, and tasks fall back to defaults). */
export function useSaveDebugConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveDebugConfig,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: queryKeys.debugConfig() }) },
  })
}

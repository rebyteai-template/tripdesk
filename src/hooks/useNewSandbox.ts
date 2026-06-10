import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { newSandbox } from '../api.ts'
import { queryKeys } from '../lib/queryKeys.ts'
import { newSessionAtom } from '../store/ui.ts'

/** Debug-only: provision a fresh sandbox VM, then drop into a new session so the
 *  next message runs on it. Slow — waits for the VM to boot. The caller reads
 *  isPending / isError / isSuccess+data for the button label. */
export function useNewSandbox() {
  const qc = useQueryClient()
  const newSession = useSetAtom(newSessionAtom)
  return useMutation({
    mutationFn: newSandbox,
    onSuccess: () => {
      newSession()
      void qc.invalidateQueries({ queryKey: queryKeys.sessions() })
    },
  })
}

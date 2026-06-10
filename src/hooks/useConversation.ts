import { useEffect, useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { derive } from '../frames.ts'
import { taskIdAtom } from '../store/ui.ts'
import { currentBusyAtom, currentTurnsAtom, hydrateTurnsAtom } from '../store/conversation.ts'
import { useTaskContent } from './useTaskContent.ts'

/**
 * Orchestrates the open session: fetches the server snapshot (React Query),
 * hydrates it into the jotai conversation store, and derives the bench/chat view
 * from the live working copy. Components read only `{ view, busy }`.
 *
 * Server state (RQ) and live stream state (jotai) meet here and nowhere else.
 */
export function useConversation() {
  const taskId = useAtomValue(taskIdAtom)
  const { data } = useTaskContent(taskId)
  const hydrate = useSetAtom(hydrateTurnsAtom)
  const turns = useAtomValue(currentTurnsAtom)
  const busy = useAtomValue(currentBusyAtom)

  useEffect(() => {
    if (taskId && data?.prompts) hydrate({ taskId, prompts: data.prompts })
  }, [taskId, data, hydrate])

  const view = useMemo(() => derive(turns), [turns])
  return { view, busy }
}

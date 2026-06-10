import { useCallback } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useQueryClient } from '@tanstack/react-query'
import { createTask, followup, streamPrompt } from '../api.ts'
import { queryKeys } from '../lib/queryKeys.ts'
import { benchModeAtom, taskIdAtom } from '../store/ui.ts'
import {
  addTurnAtom,
  appendFrameAtom,
  busyTasksAtom,
  creatingAtom,
  markBusyAtom,
} from '../store/conversation.ts'

// Active SSE closers, keyed by promptId, so a stream can be closed on done (and
// could be closed on teardown) instead of leaking an open EventSource.
const activeStreams = new Map<string, () => void>()

/**
 * Returns `send(text)` — the one turn-driver. New session → createTask, otherwise
 * followup; then optimistically add the turn, mark THIS task busy, and stream
 * frames into the jotai store. On done it clears that task's busy and refetches
 * sessions + this task's content so the server snapshot catches up.
 *
 * The busy/creating guards are per-session, so a running task never blocks sending
 * from a different or brand-new session (this is the multi-task fix).
 */
export function useSendMessage() {
  const qc = useQueryClient()
  const taskId = useAtomValue(taskIdAtom)
  const busyTasks = useAtomValue(busyTasksAtom)
  const creating = useAtomValue(creatingAtom)
  const setTaskId = useSetAtom(taskIdAtom)
  const setMode = useSetAtom(benchModeAtom)
  const setCreating = useSetAtom(creatingAtom)
  const addTurn = useSetAtom(addTurnAtom)
  const appendFrame = useSetAtom(appendFrameAtom)
  const markBusy = useSetAtom(markBusyAtom)

  return useCallback(
    async (text: string) => {
      const sessionId = taskId
      // Re-entry guard scoped to the targeted session; other sessions stay free.
      if (sessionId) {
        if (busyTasks.has(sessionId)) return
      } else {
        if (creating) return
        setCreating(true)
      }
      setMode('auto') // any new turn returns the bench to following the agent's frames
      let tid = sessionId
      try {
        let pid: string
        if (!tid) {
          const r = await createTask(text)
          tid = r.taskId
          setTaskId(r.taskId)
          pid = r.promptId
          void qc.invalidateQueries({ queryKey: queryKeys.sessions() })
        } else {
          const r = await followup(tid, text)
          pid = r.promptId
        }
        const ttid = tid
        addTurn({ taskId: ttid, prompt: { id: pid, prompt: text, frames: [] } })
        markBusy({ taskId: ttid, on: true })
        const stop = streamPrompt(
          pid,
          (seq, data) => appendFrame({ taskId: ttid, promptId: pid, seq, data }),
          () => {
            markBusy({ taskId: ttid, on: false })
            activeStreams.delete(pid)
            void qc.invalidateQueries({ queryKey: queryKeys.sessions() })
            void qc.invalidateQueries({ queryKey: queryKeys.taskContent(ttid) })
          },
        )
        activeStreams.set(pid, stop)
      } catch (e) {
        console.error(e)
        if (tid) markBusy({ taskId: tid, on: false })
      } finally {
        // taskId is now set and the task marked busy, so releasing the new-session
        // guard can't cause a double-create — busyTasks covers it from here.
        setCreating(false)
      }
    },
    [taskId, busyTasks, creating, qc, setTaskId, setMode, setCreating, addTurn, appendFrame, markBusy],
  )
}

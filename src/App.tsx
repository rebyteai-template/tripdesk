import { useEffect, useMemo, useState } from 'react'
import { createTask, followup, loadContent, streamPrompt, type PromptContent } from './api.ts'
import { derive } from './frames.ts'
import { passengersFromFare, buildOrderPrompt, type PassengerDraft } from './booking.ts'
import { ChatPanel } from './components/ChatPanel.tsx'
import { Composer } from './components/Composer.tsx'
import { Bench, type BenchMode } from './components/Bench.tsx'

const TASK_KEY = 'tripdesk.taskId'

export function App() {
  const [taskId, setTaskId] = useState<string | null>(() => localStorage.getItem(TASK_KEY))
  const [prompts, setPrompts] = useState<PromptContent[]>([])
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<BenchMode>('auto')
  const [orderDraft, setOrderDraft] = useState<PassengerDraft[]>([])

  // Rehydrate a prior conversation on load.
  useEffect(() => {
    if (!taskId) return
    loadContent(taskId)
      .then((c) => { if (c) setPrompts(c.prompts) })
      .catch(() => { /* stale id; ignore */ })
  }, [taskId])

  const view = useMemo(() => derive(prompts), [prompts])

  function appendFrame(promptId: string, seq: number, data: unknown) {
    setPrompts((prev) =>
      prev.map((p) => (p.id === promptId ? { ...p, frames: [...p.frames, { seq, data }] } : p)),
    )
  }

  async function send(text: string) {
    if (busy) return
    setBusy(true)
    setMode('auto') // any new turn returns the bench to following the agent's frames
    try {
      let pid: string
      if (!taskId) {
        const r = await createTask(text)
        setTaskId(r.taskId)
        localStorage.setItem(TASK_KEY, r.taskId)
        pid = r.promptId
      } else {
        const r = await followup(taskId, text)
        pid = r.promptId
      }
      setPrompts((prev) => [...prev, { id: pid, prompt: text, frames: [] }])
      streamPrompt(
        pid,
        (seq, data) => appendFrame(pid, seq, data),
        () => setBusy(false),
      )
    } catch (e) {
      console.error(e)
      setBusy(false)
    }
  }

  // fare card → passenger form (pure UI transition; nothing sent yet)
  function continueToPassengers() {
    if (!view.fare) return
    const need = passengersFromFare(view.fare)
    setOrderDraft((prev) => (prev.length === need.length ? prev : need))
    setMode('passengers')
  }

  function reset() {
    localStorage.removeItem(TASK_KEY)
    setTaskId(null)
    setPrompts([])
    setOrderDraft([])
    setMode('auto')
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">TripDesk</span>
        <span className="tag">沙箱模式</span>
        <button className="ghost" onClick={reset}>新会话</button>
      </header>
      <div className="split">
        <section className="left">
          <ChatPanel chat={view.chat} busy={busy} />
          <Composer onSend={send} busy={busy} />
        </section>
        <section className="right">
          <Bench
            view={view}
            mode={mode}
            orderDraft={orderDraft}
            international={false}
            onBook={(label) => send(`预订选项 ${label}，先帮我验价`)}
            onContinue={continueToPassengers}
            onSubmitPassengers={(passengers) => { setOrderDraft(passengers); setMode('confirm') }}
            onBackFromForm={() => setMode('auto')}
            onConfirmOrder={() => { if (view.fare) send(buildOrderPrompt(orderDraft, view.fare)) }}
            onCancelConfirm={() => setMode('passengers')}
            busy={busy}
          />
        </section>
      </div>
    </div>
  )
}

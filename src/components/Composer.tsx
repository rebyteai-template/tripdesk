import { useState } from 'react'

export function Composer({ onSend, busy }: { onSend: (text: string) => void; busy: boolean }) {
  const [text, setText] = useState('')

  function submit() {
    const t = text.trim()
    if (!t || busy) return
    onSend(t)
    setText('')
  }

  return (
    <div className="composer">
      <textarea
        value={text}
        placeholder="描述你的订票需求，或回复选项号…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <button onClick={submit} disabled={busy || !text.trim()}>
        {busy ? '…' : '发送'}
      </button>
    </div>
  )
}

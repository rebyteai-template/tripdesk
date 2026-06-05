import type { SessionSummary } from '../api.ts'

/** Per-user conversation sidebar. Static column on desktop; a slide-in drawer on
 *  mobile (toggled by the topbar hamburger, dismissed by the backdrop). */
export function SessionList({
  email,
  sessions,
  currentId,
  onSelect,
  open,
  onClose,
}: {
  email: string
  sessions: SessionSummary[]
  currentId: string | null
  onSelect: (id: string) => void
  open: boolean
  onClose: () => void
}) {
  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        {email && <div className="sidebar-user" title={email}>{email}</div>}
        <div className="sidebar-head">会话</div>
        {sessions.length === 0 && <div className="sidebar-empty">还没有会话</div>}
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`session${s.id === currentId ? ' active' : ''}`}
            onClick={() => onSelect(s.id)}
            title={s.title}
          >
            <span className="session-title">{s.title || '新会话'}</span>
            <span className="session-meta">{s.created_at.slice(5, 16)}</span>
          </button>
        ))}
      </aside>
    </>
  )
}

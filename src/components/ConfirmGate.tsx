/**
 * Reusable non-skippable confirmation for write operations (create order, pay,
 * cancel, refund, change). The write only ever fires from the confirm button —
 * the agent does not auto-execute — so this is the gate the skill requires.
 */
export interface ConfirmRow {
  label: string
  value: string
}

export function ConfirmGate({
  title,
  rows,
  amountLine,
  warning,
  note,
  confirmLabel,
  cancelLabel = '返回修改',
  onConfirm,
  onCancel,
  busy,
}: {
  title: string
  rows: ConfirmRow[]
  amountLine?: string
  warning?: string | null
  note?: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
}) {
  return (
    <div className="card gate">
      <div className="card-head">
        <h2>⚠️ {title}</h2>
        <span className="muted">请核对后确认，确认即向下游发起该操作</span>
      </div>

      <table className="gate-rows">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="gate-k">{r.label}</td>
              <td className="gate-v">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {amountLine ? <div className="gate-amount">{amountLine}</div> : null}
      {warning ? <div className="fare-warn">{warning}</div> : null}
      {note ? <p className="hint">{note}</p> : null}

      <div className="gate-actions">
        <button className="ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button className="gate-confirm" onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
      </div>
    </div>
  )
}

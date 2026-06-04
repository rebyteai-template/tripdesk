import { useState } from 'react'
import {
  DOC_TYPES, PAX_LABELS, GENDER_LABELS, usesPassport, passengerValid,
  type PassengerDraft, type DocType, type Gender,
} from '../booking.ts'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="pf-field">
      <span className="pf-label">{label}{required ? <em>*</em> : null}</span>
      {children}
    </label>
  )
}

export function PassengerForm({
  initial,
  international,
  onSubmit,
  onBack,
  busy,
}: {
  initial: PassengerDraft[]
  /** Whether the route looks international — only affects which doc type the UI defaults to. */
  international: boolean
  onSubmit: (passengers: PassengerDraft[]) => void
  onBack: () => void
  busy: boolean
}) {
  const [list, setList] = useState<PassengerDraft[]>(() =>
    international ? initial.map((p) => (p.docType === 'idcard' ? { ...p, docType: 'passport' } : p)) : initial,
  )

  function update(i: number, patch: Partial<PassengerDraft>) {
    setList((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }

  const allValid = list.every(passengerValid)

  return (
    <div className="card pf">
      <div className="card-head">
        <h2>乘机人信息</h2>
        <span className="muted">共 {list.length} 位 · 按证件原文填写，提交前不会创建订单</span>
      </div>

      {list.map((p, i) => {
        const passport = usesPassport(p.docType)
        return (
          <section key={i} className="pf-pax">
            <div className="pf-pax-head">乘机人 {i + 1} · {PAX_LABELS[p.paxType]}</div>
            <div className="pf-grid">
              <Field label="证件类型" required>
                <select value={p.docType} onChange={(e) => update(i, { docType: e.target.value as DocType })}>
                  {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </Field>

              {passport ? (
                <>
                  <Field label="护照英文姓" required>
                    <input value={p.surnameEn} placeholder="如 ZHANG"
                      onChange={(e) => update(i, { surnameEn: e.target.value })} />
                  </Field>
                  <Field label="护照英文名" required>
                    <input value={p.givenNamesEn} placeholder="如 SAN"
                      onChange={(e) => update(i, { givenNamesEn: e.target.value })} />
                  </Field>
                </>
              ) : (
                <Field label="中文姓名" required>
                  <input value={p.nameCn} placeholder="与证件一致"
                    onChange={(e) => update(i, { nameCn: e.target.value })} />
                </Field>
              )}

              <Field label="出生日期" required>
                <input type="date" value={p.birthday} onChange={(e) => update(i, { birthday: e.target.value })} />
              </Field>
              <Field label="性别" required>
                <select value={p.gender} onChange={(e) => update(i, { gender: e.target.value as Gender })}>
                  {(Object.keys(GENDER_LABELS) as Gender[]).map((g) => <option key={g} value={g}>{GENDER_LABELS[g]}</option>)}
                </select>
              </Field>
              <Field label="国籍" required>
                <input value={p.nationality} onChange={(e) => update(i, { nationality: e.target.value })} />
              </Field>
              <Field label={passport ? '护照号码' : '证件号码'} required>
                <input value={p.docNo} onChange={(e) => update(i, { docNo: e.target.value })} />
              </Field>
              {passport ? (
                <Field label="护照有效期" required>
                  <input type="date" value={p.passportExpiry} onChange={(e) => update(i, { passportExpiry: e.target.value })} />
                </Field>
              ) : null}
              <Field label="手机号" required>
                <input value={p.phone} inputMode="tel" onChange={(e) => update(i, { phone: e.target.value })} />
              </Field>
              <Field label="邮箱（可选）">
                <input value={p.email} inputMode="email" placeholder="用于接收通知"
                  onChange={(e) => update(i, { email: e.target.value })} />
              </Field>
            </div>
          </section>
        )
      })}

      <p className="hint">联系人默认使用第一位乘机人的姓名和手机号。证件信息仅用于本次下单，不写入仓库、不进 git。</p>
      <div className="pf-actions">
        <button className="ghost" onClick={onBack} disabled={busy}>返回</button>
        <button disabled={busy || !allValid} onClick={() => onSubmit(list)}>提交，进入下单确认</button>
      </div>
    </div>
  )
}

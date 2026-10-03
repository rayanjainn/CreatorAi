'use client'

import { useId, type ReactNode } from 'react'
import { useResettable } from '@/lib/editor/use-resettable'
import { clock, parseTime } from '@/lib/timeline'

/** Row with a small caption on the left and the control on the right (inspector layout). */
export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="insp-row">
      <span className="insp-label">{label}</span>
      <div className="insp-ctl">{children}</div>
      {hint && <small className="insp-hint">{hint}</small>}
    </div>
  )
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="insp-section">
      <header>
        <h4>{title}</h4>
        {aside}
      </header>
      {children}
    </section>
  )
}

/** Time input: shows `m:ss.cc`, accepts seconds, `m:ss.cc` or `hh:mm:ss:ff`; commits on blur/Enter, reverts on invalid input. */
export function TimeField({ label, value, onCommit, disabled, min, max, testid }: { label: string; value: number; onCommit: (v: number) => void; disabled?: boolean; min?: number; max?: number; testid?: string }) {
  const id = useId()
  const [draft, setDraft] = useResettable<string | null>(null, value)
  const shown = draft ?? clock(value)
  const commit = () => {
    if (draft === null) return
    const t = parseTime(draft)
    setDraft(null)
    if (t === null) return
    const v = Math.max(min ?? 0, max !== undefined ? Math.min(max, t) : t)
    if (Math.abs(v - value) > 1e-4) onCommit(v)
  }
  return (
    <input
      id={id}
      className="input mono insp-time"
      aria-label={label}
      value={shown}
      disabled={disabled}
      inputMode="decimal"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setDraft(null)
      }}
      data-testid={testid}
    />
  )
}

/** Numeric input with a unit, same commit rules as `TimeField`. */
export function NumField({ label, value, onCommit, step = 0.1, min, max, unit, disabled, digits = 1, testid }: { label: string; value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; disabled?: boolean; digits?: number; testid?: string }) {
  const [draft, setDraft] = useResettable<string | null>(null, value)
  const commit = () => {
    if (draft === null) return
    const n = Number(draft.replace(',', '.'))
    setDraft(null)
    if (!Number.isFinite(n)) return
    const v = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n))
    if (Math.abs(v - value) > 1e-6) onCommit(v)
  }
  return (
    <span className="insp-num">
      <input
        className="input mono"
        aria-label={label}
        type="text"
        inputMode="decimal"
        value={draft ?? value.toFixed(digits)}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setDraft(null)
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const n = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, value + (e.key === 'ArrowUp' ? step : -step)))
            onCommit(Number(n.toFixed(6)))
          }
        }}
        data-testid={testid}
      />
      {unit && <em>{unit}</em>}
    </span>
  )
}

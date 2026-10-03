'use client'

import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import type { Provenance } from '@/lib/api/types'

/** Click-to-edit text. Saves on blur or Cmd/Ctrl+Enter, cancels on Escape. */
export function InlineText({
  label,
  value,
  onSave,
  multiline,
  prov,
  className,
  testId,
}: {
  label: string
  value: string
  onSave: (v: string) => void
  multiline?: boolean
  prov?: Provenance
  className?: string
  testId?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(value)
  }
  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])
  const commit = () => {
    setEditing(false)
    const v = draft.trim()
    if (v && v !== value) onSave(v)
    else setDraft(value)
  }
  return (
    <div className={`inline-text ${className ?? ''}`} data-testid={testId}>
      <div className="inline-label">
        <span>{label}</span>
        {prov && <ProvenanceBadge {...prov} />}
      </div>
      {editing ? (
        multiline ? (
          <textarea ref={ref} className="textarea" rows={3} value={draft} aria-label={label} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(value); setEditing(false) } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit() }} />
        ) : (
          <input ref={ref} className="input" value={draft} aria-label={label} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(value); setEditing(false) } if (e.key === 'Enter') commit() }} />
        )
      ) : (
        <button type="button" className="inline-view" onClick={() => setEditing(true)} aria-label={`Edit ${label.toLowerCase()}`}>
          <span>{value || <em className="muted">Empty</em>}</span>
          <Pencil size={12} aria-hidden />
        </button>
      )}
    </div>
  )
}

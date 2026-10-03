'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'

/** Chip editor: Enter or comma adds, the x removes. `onChange` receives the full new list. */
export function TagEditor({ tags, onChange, disabled, label = 'Tags' }: { tags: string[]; onChange: (tags: string[]) => void; disabled?: boolean; label?: string }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const parts = draft
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    setDraft('')
    if (!parts.length) return
    const next = [...tags]
    for (const p of parts) if (!next.some((t) => t.toLowerCase() === p.toLowerCase())) next.push(p)
    if (next.length !== tags.length) onChange(next)
  }
  return (
    <div className="tag-editor" data-testid="tag-editor">
      <div className="chip-row" style={{ gap: 6 }}>
        {tags.map((t) => (
          <span key={t} className="tag-chip">
            {t}
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} disabled={disabled}>
              <X size={11} />
            </button>
          </span>
        ))}
        <label className="tag-input">
          <Plus size={12} aria-hidden />
          <input
            value={draft}
            disabled={disabled}
            placeholder={tags.length ? 'Add tag' : 'Add a tag, press Enter'}
            aria-label={`Add to ${label}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                add()
              } else if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1))
            }}
            onBlur={add}
          />
        </label>
      </div>
    </div>
  )
}

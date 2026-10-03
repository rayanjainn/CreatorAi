'use client'

import { AlertTriangle, Check, CloudOff, Loader2, Pencil } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { saveNow } from '@/lib/editor/controller'
import { useEditor } from '@/stores/editor'
import { relativeTime } from '@/lib/time'

/** Saved / Saving… / Unsaved / Conflict / Error / Offline indicator for the autosaver. */
export function SaveStatus() {
  const save = useEditor((s) => s.save)
  const revision = useEditor((s) => s.revision)
  const preview = useEditor((s) => s.preview)
  if (preview) {
    return (
      <span className="save-status" data-status="preview" data-testid="save-status">
        <Pencil size={13} /> Previewing rev {preview.revision}
      </span>
    )
  }
  const body = {
    saved: { icon: <Check size={13} />, text: 'Saved', tip: save.at ? `Saved ${relativeTime(new Date(save.at).toISOString())} as revision ${revision}.` : `Revision ${revision} is saved.` },
    saving: { icon: <Loader2 size={13} className="spin" />, text: 'Saving…', tip: 'Saving your changes as a new revision.' },
    unsaved: { icon: <Pencil size={13} />, text: 'Unsaved', tip: 'Your changes are saved automatically a moment after you stop editing (Ctrl+S saves now).' },
    conflict: { icon: <AlertTriangle size={13} />, text: 'Conflict', tip: 'This clip changed somewhere else. Resolve it to keep saving.' },
    error: { icon: <AlertTriangle size={13} />, text: 'Not saved', tip: save.error ?? 'Saving failed.' },
    offline: { icon: <CloudOff size={13} />, text: 'Offline', tip: 'The API is not reachable. Your changes are kept here and will be saved when it is back.' },
  }[save.status]
  const retry = save.status === 'error' || save.status === 'offline'
  return (
    <Tooltip content={<div>{body.tip}{save.violations && save.violations.length > 1 && <div style={{ marginTop: 4 }}>{save.violations.slice(0, 4).map((v, i) => <div key={i}>• {v.message}</div>)}</div>}{retry && <div style={{ marginTop: 4 }}>Click to try again.</div>}</div>} side="bottom">
      <button type="button" className="save-status" data-status={save.status} data-testid="save-status" onClick={() => retry && void saveNow()} aria-live="polite">
        {body.icon} <span>{body.text}</span>
        {save.status === 'saved' && <small className="mono">rev {revision}</small>}
      </button>
    </Tooltip>
  )
}

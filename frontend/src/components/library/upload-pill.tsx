'use client'

import { UploadCloud } from 'lucide-react'
import { useUploads } from '@/stores/uploads'

/** "2 uploading · 41%" pill that reopens the upload dialog; hidden when nothing is in flight. */
export function UploadPill({ onOpen, contentItemId }: { onOpen: () => void; contentItemId?: string }) {
  const all = useUploads((s) => s.items)
  const items = contentItemId ? all.filter((i) => i.contentItemId === contentItemId) : all
  const active = items.filter((i) => ['queued', 'starting', 'uploading', 'finalizing'].includes(i.phase))
  if (!active.length) return null
  const total = active.reduce((a, i) => a + i.file.size, 0)
  const sent = active.reduce((a, i) => a + i.sentBytes, 0)
  const pct = total ? Math.round((sent / total) * 100) : 0
  return (
    <button type="button" className="job-indicator" onClick={onOpen} data-testid="upload-pill" aria-label={`${active.length} uploading, ${pct} percent. Open upload dialog`}>
      <UploadCloud size={14} aria-hidden />
      <span>
        {active.length} uploading · {pct}%
      </span>
    </button>
  )
}

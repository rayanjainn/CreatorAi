'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { qk } from '@/lib/api/hooks'
import { fetchRevisions } from '@/lib/editor/api'
import { previewRevision, restoreTo } from '@/lib/editor/controller'
import { formatDateTime, relativeTime } from '@/lib/time'
import { useEditor } from '@/stores/editor'
import { toast } from '@/stores/toasts'

/** Revision history of the clip's timeline: preview one read-only, or restore it as a NEW revision. */
export function RevisionList({ clipId, limit, compact, onPick }: { clipId: string; limit?: number; compact?: boolean; /** Called after a preview or restore is started (lets a popover close itself). */ onPick?: () => void }) {
  const qc = useQueryClient()
  const revision = useEditor((s) => s.revision)
  const savedAt = useEditor((s) => s.save.at)
  const previewing = useEditor((s) => s.preview?.revision ?? null)
  const busy = useEditor((s) => s.busy)
  const q = useQuery({ queryKey: qk.revisions(clipId), queryFn: () => fetchRevisions(clipId), staleTime: 0 })
  useEffect(() => {
    if (savedAt) void qc.invalidateQueries({ queryKey: qk.revisions(clipId) })
  }, [savedAt, clipId, qc])
  if (q.isPending) return <p className="muted small">Loading revisions…</p>
  if (q.isError) return <p className="muted small">Could not load the revision history.</p>
  const rows = limit ? q.data.slice(0, limit) : q.data
  return (
    <ul className={`rev-list ${compact ? 'rev-compact' : ''}`} data-testid="revision-list">
      {rows.map((r) => (
        <li key={r.revision} className="rev-row" data-current={r.revision === revision} data-previewing={r.revision === previewing} data-testid="revision-row">
          <div className="rev-main">
            <b className="mono">Rev {r.revision}</b>
            {r.revision === revision && <span className="rev-now">current</span>}
            <span className="rev-note truncate" title={r.note}>{r.note || 'Saved'}</span>
            <small title={formatDateTime(r.created_at)}>
              {relativeTime(r.created_at)} · {r.duration.toFixed(1)} s · {r.video_items} {r.video_items === 1 ? 'clip' : 'clips'}
            </small>
          </div>
          {r.revision !== revision && (
            <div className="rev-actions">
              <Button size="sm" variant="ghost" onClick={() => {
                  void previewRevision(r.revision)
                  onPick?.()
                }} disabled={!!busy} data-testid="preview-revision" aria-label={`Preview revision ${r.revision}`}>
                <Eye size={12} /> Preview
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!!busy}
                onClick={async () => {
                  onPick?.()
                  if (await restoreTo(r.revision)) toast.success(`Restored revision ${r.revision}`, 'It is saved as a new revision; nothing was overwritten.')
                }}
                data-testid="restore-revision"
                aria-label={`Restore revision ${r.revision}`}
              >
                <RotateCcw size={12} /> Restore
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

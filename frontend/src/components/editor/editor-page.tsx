'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Eye, Monitor as MonitorIcon, RotateCcw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { RenderDialog } from '@/components/clips/render-dialog'
import { ConflictDialog } from './conflict-dialog'
import { EditorHeader } from './editor-header'
import { HistoryPanel } from './history-panel'
import { Inspector } from './inspector'
import { Monitor } from './monitor'
import { TimelinePanel } from './timeline/timeline-panel'
import { useEditorShortcuts } from './use-shortcuts'
import { useClip } from '@/lib/api/hooks'
import { isCode } from '@/lib/api/errors'
import { restoreTo, saveNow } from '@/lib/editor/controller'
import { useEditorBootstrap } from '@/lib/editor/use-bootstrap'
import { useFrames } from '@/lib/editor/use-frames'
import { totals } from '@/lib/timeline'
import { useMediaQuery } from '@/lib/use-media'
import { toast } from '@/stores/toasts'
import { useEditor, viewTimeline } from '@/stores/editor'
import type { Clip } from '@/lib/api/types'

/** `/editor/[clipId]`: loads the clip and its timeline, then renders the workspace (or an honest state). */
export function EditorPage({ clipId }: { clipId: string }) {
  const clipQ = useClip(clipId)
  const { query, ready } = useEditorBootstrap(clipId, !!clipQ.data)
  const wide = useMediaQuery('(min-width: 1024px)', true)

  if (clipQ.isError) {
    const missing = isCode(clipQ.error, 'NOT_FOUND')
    return (
      <div className="ed-state" data-testid="editor-error">
        {missing ? (
          <EmptyState tone="error" title="This clip does not exist" description="It may have been deleted, or the link is wrong. Clips are made from a project's footage on its Clips tab." actions={<Link href="/smart-clips" className="button button-secondary button-sm">Browse clips</Link>} />
        ) : (
          <ErrorState error={clipQ.error} onRetry={() => void clipQ.refetch()} title="Could not load this clip" />
        )}
      </div>
    )
  }
  if (query.isError) {
    const missing = isCode(query.error, 'NOT_FOUND')
    return (
      <div className="ed-state" data-testid="editor-error">
        {missing ? (
          <EmptyState tone="error" title="This clip has no timeline" description="The clip exists but its edit was never created, so there is nothing to open. Generating clips again creates one." actions={clipQ.data && <Link href={`/projects/${clipQ.data.content_item_id}/clips`} className="button button-secondary button-sm">Back to the clips</Link>} />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} title="Could not load the timeline" />
        )}
      </div>
    )
  }
  if (!clipQ.data || !ready) return <EditorSkeleton />
  if (!wide) return <SmallScreen clip={clipQ.data} />
  return <Workspace clip={clipQ.data} />
}

function EditorSkeleton() {
  return (
    <div className="ed-state ed-skeleton" data-testid="editor-loading" aria-busy>
      <Skeleton style={{ height: 52 }} />
      <div className="ed-skel-body">
        <Skeleton style={{ height: '100%' }} />
        <Skeleton style={{ height: '100%' }} />
        <Skeleton style={{ height: '100%' }} />
      </div>
      <Skeleton style={{ height: 260 }} />
    </div>
  )
}

function Workspace({ clip }: { clip: Clip }) {
  const mode = useEditor((s) => s.mode)
  const preview = useEditor((s) => s.preview)
  const timeline = useEditor(viewTimeline)
  const assets = useEditor((s) => s.assets)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const dialogOpen = exportOpen
  useEditorShortcuts(!dialogOpen)
  const ids = useMemo(() => Array.from(new Set(timeline.tracks.video.map((v) => v.asset_id).filter((x): x is string => !!x))), [timeline])
  const frames = useFrames(ids, assets)
  const revision = useEditor((s) => s.revision)
  const exportClip: Clip = { ...clip, timeline_duration: timeline.duration, edit_revision: revision }

  const startExport = async () => {
    setExporting(true)
    const ok = await saveNow()
    setExporting(false)
    if (!ok) {
      toast.warning('Save your changes first', 'The export renders the saved timeline, and your latest changes could not be saved yet.')
      return
    }
    setExportOpen(true)
  }

  return (
    <div className="editor" data-testid="editor" data-mode={mode} data-previewing={!!preview}>
      <EditorHeader clip={clip} onExport={() => void startExport()} exporting={exporting} />
      {preview && <PreviewBanner />}
      <div className="ed-body">
        {mode === 'edit' && <HistoryPanel clipId={clip.id} />}
        <div className="ed-center">
          <Monitor frames={frames} large={mode === 'preview'} />
        </div>
        {mode === 'edit' && <Inspector clip={clip} />}
      </div>
      {mode === 'edit' && <TimelinePanel frames={frames} />}
      <ConflictDialog />
      <RenderDialog clip={exportClip} open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  )
}

function PreviewBanner() {
  const preview = useEditor((s) => s.preview)!
  const setPreview = useEditor((s) => s.setPreview)
  const busy = useEditor((s) => s.busy)
  return (
    <div className="ed-banner" role="status" data-testid="preview-banner">
      <Eye size={14} />
      <span>
        Previewing <b>revision {preview.revision}</b>
        {preview.note ? <> ({preview.note})</> : null} read-only. Your current version is untouched.
      </span>
      <Button size="sm" variant="secondary" onClick={() => setPreview(null)} data-testid="preview-back">
        Back to latest
      </Button>
      <Button
        size="sm"
        disabled={!!busy}
        onClick={async () => {
          if (await restoreTo(preview.revision)) toast.success(`Restored revision ${preview.revision}`, 'Saved as a new revision.')
        }}
        data-testid="preview-restore"
      >
        <RotateCcw size={12} /> Restore this revision
      </Button>
    </div>
  )
}

/** Below 1024 px the timeline cannot be edited well: say so, show a read-only summary and keep Export reachable. */
function SmallScreen({ clip }: { clip: Clip }) {
  const timeline = useEditor((s) => s.timeline)
  const revision = useEditor((s) => s.revision)
  const [open, setOpen] = useState(false)
  const t = totals(timeline)
  return (
    <div className="ed-small" data-testid="editor-small-screen">
      <div className="ed-small-card">
        <div className="stat-icon violet">
          <MonitorIcon size={18} />
        </div>
        <h1>Open the editor on a larger screen</h1>
        <p>The timeline editor needs at least 1024 px of width for the monitor, timeline and inspector. You can still review this clip and export it from here.</p>
        <dl className="ed-small-facts">
          <div>
            <dt>Clip</dt>
            <dd>{clip.title}</dd>
          </div>
          <div>
            <dt>Length</dt>
            <dd className="mono">{timeline.duration.toFixed(1)} s · {timeline.aspect}</dd>
          </div>
          <div>
            <dt>Timeline</dt>
            <dd>
              {timeline.tracks.video.length} clips · {timeline.tracks.captions.length} captions · {timeline.tracks.audio.length} audio · {timeline.tracks.overlays.length} overlays
            </dd>
          </div>
          <div>
            <dt>Review</dt>
            <dd>
              {t.suggested} to review · {t.accepted} accepted · {t.rejected} rejected
            </dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd className="mono">{revision}</dd>
          </div>
        </dl>
        <div className="ed-small-actions">
          <Button onClick={() => setOpen(true)} data-testid="small-export">
            <Send size={14} /> Export
          </Button>
          <Link href={`/projects/${clip.content_item_id}/clips`} className="button button-secondary">
            Back to clips
          </Link>
        </div>
      </div>
      <RenderDialog clip={{ ...clip, timeline_duration: timeline.duration }} open={open} onOpenChange={setOpen} />
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Download, Film, Share2, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { NewPostDialog } from '@/components/community/new-post-dialog'
import { Thumb } from '@/components/common/thumb'
import { Button } from '@/components/ui/button'
import { VideoPlayer } from '@/components/media/video-player'
import { useDeleteRender } from '@/lib/api/hooks'
import { mediaUrl } from '@/lib/api/client'
import { PRESETS } from '@/lib/render-presets'
import { formatBytes, formatDuration } from '@/lib/format'
import { relativeTime } from '@/lib/time'
import { useJobs } from '@/stores/jobs'
import type { Render } from '@/lib/api/types'

/** One render: status (live progress), stale flag, preview, download, delete. */
export function RenderRow({ render, projectTitle }: { render: Render; projectTitle?: string }) {
  const del = useDeleteRender()
  const [preview, setPreview] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [share, setShare] = useState(false)
  const live = useJobs((s) => (render.job_id ? s.jobs[render.job_id] : undefined))
  const active = render.status === 'queued' || render.status === 'rendering'
  const preset = PRESETS.find((p) => p.id === render.preset)
  return (
    <li className="render-row" data-testid="render-row" data-status={render.status}>
      <div className="render-thumb">
        {preview && render.preview_url ? (
          <VideoPlayer src={render.preview_url} poster={render.thumbnail_url} autoPlay label={`Preview of ${render.clip_title ?? 'render'}`} />
        ) : (
          <button type="button" className="render-thumb-btn" disabled={render.status !== 'done'} onClick={() => setPreview(true)} aria-label="Preview this render">
            <Thumb src={render.thumbnail_url} iconSize={18} className={`thumb ${preset?.aspect === '16:9' ? '' : 'thumb-tall'}`} />
          </button>
        )}
      </div>
      <div className="render-main">
        <div className="render-title">
          <b className="truncate">{render.clip_title || 'Clip'}</b>
          <span className="badge">{preset?.label ?? render.preset}</span>
          {render.stale && (
            <span className="badge badge-amber" title="The clip was edited after this render was made." data-testid="stale-badge">
              Stale
            </span>
          )}
        </div>
        <small className="render-sub">
          {projectTitle && (
            <Link href={`/projects/${render.content_item_id}/clips`} className="link">
              {projectTitle}
            </Link>
          )}
          <span>{relativeTime(render.created_at)}</span>
          {render.status === 'done' && (
            <span className="mono">
              {formatDuration(render.duration_sec)} · {formatBytes(render.size_bytes)}
            </span>
          )}
        </small>
        {active && (
          <div style={{ maxWidth: 320 }}>
            <div className="progress">
              <i style={{ width: `${Math.max(4, live?.progress ?? 0)}%` }} />
            </div>
          </div>
        )}
        {render.status === 'failed' && <small className="asset-error">{render.error ?? 'Render failed'}</small>}
      </div>
      <div className="render-actions">
        <span className={`badge ${render.status === 'done' ? 'badge-green' : render.status === 'failed' ? 'badge-red' : 'badge-cyan'}`}>
          {active && <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} aria-hidden />}
          {render.status}
        </span>
        {render.status === 'done' && render.download_url && (
          <a className="button button-secondary button-sm" href={mediaUrl(render.download_url) ?? '#'} download data-testid="render-download">
            <Download size={13} /> Download
          </a>
        )}
        {render.status === 'done' && (
          <Button size="sm" variant="ghost" onClick={() => setShare(true)} title="Share with the community for feedback" data-testid="render-share">
            <Share2 size={13} /> Share
          </Button>
        )}
        {render.status === 'done' && !preview && (
          <Button size="sm" variant="ghost" onClick={() => setPreview(true)}>
            <Film size={13} /> Preview
          </Button>
        )}
        <button type="button" className="icon-button" aria-label="Delete this render" disabled={active} title={active ? 'Cancel the job before deleting' : 'Delete'} onClick={() => setConfirm(true)} data-testid="delete-render">
          <Trash2 size={14} />
        </button>
      </div>
      <NewPostDialog open={share} onOpenChange={setShare} renderId={render.id} />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this render?"
        description="The MP4 file is removed. The clip itself is not touched."
        confirmLabel="Delete render"
        danger
        loading={del.isPending}
        onConfirm={() => del.mutate(render.id, { onSuccess: () => setConfirm(false) })}
      />
    </li>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Download } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { VideoPlayer } from '@/components/media/video-player'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { useCreateRender, useRender } from '@/lib/api/hooks'
import { isCode } from '@/lib/api/errors'
import { mediaUrl } from '@/lib/api/client'
import { CAPTION_STYLES, PRESETS } from '@/lib/render-presets'
import { formatBytes, formatDuration } from '@/lib/format'
import { useJobs } from '@/stores/jobs'
import type { CaptionStyle, Clip, RenderPreset } from '@/lib/api/types'

/** Pick a preset and caption style, render, watch progress, then preview and download. */
export function RenderDialog({ clip, open, onOpenChange }: { clip: Clip | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" eyebrow="Export" title="Render this clip" description={clip ? <>“{clip.title}”</> : undefined}>
      {open && clip && <RenderBody key={clip.id} clip={clip} onClose={() => onOpenChange(false)} />}
    </Modal>
  )
}

function RenderBody({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const [preset, setPreset] = useState<RenderPreset>(clip.kind === 'full' ? 'yt_long' : 'yt_short')
  const [style, setStyle] = useState<CaptionStyle | ''>('')
  const create = useCreateRender()
  const renderId = create.data?.render.id
  const render = useRender(renderId)
  const r = render.data ?? create.data?.render
  const live = useJobs((s) => (create.data ? s.jobs[create.data.job_id] : undefined))
  const meta = PRESETS.find((p) => p.id === preset)!
  const length = clip.timeline_duration ?? clip.duration_sec
  const over = meta.max != null && length > meta.max ? length - meta.max : 0
  const serverOver = isCode(create.error, 'DURATION_EXCEEDS_PRESET') ? (create.error.details as { max_duration?: number; duration?: number; over_by?: number }) : null
  const active = r && (r.status === 'queued' || r.status === 'rendering')
  const progress = Math.round(live?.progress ?? (r?.status === 'done' ? 100 : 0))

  useEffect(() => {
    create.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  if (r && !create.isError) {
    return (
      <div className="render-result" data-testid="render-result" data-status={r.status}>
        {active && (
          <div role="status">
            <div className="progress-label" style={{ marginTop: 0 }}>
              <span>{r.status === 'queued' ? 'Waiting for the renderer' : `Rendering${live?.stage ? ` · ${live.stage}` : ''}`}</span>
              <b>{progress}%</b>
            </div>
            <div className="progress">
              <i style={{ width: `${Math.max(4, progress)}%` }} />
            </div>
          </div>
        )}
        {r.status === 'failed' && (
          <div className="notice notice-red" role="alert">
            <div className="notice-body">
              <b>The render failed</b>
              <p>{r.error ?? 'ffmpeg stopped without a reason.'}</p>
            </div>
          </div>
        )}
        {r.status === 'done' && (
          <>
            <div className="render-preview">
              <VideoPlayer src={r.preview_url} poster={r.thumbnail_url} label="Rendered video" />
            </div>
            <div className="render-facts mono">
              <span>{PRESETS.find((p) => p.id === r.preset)?.label}</span>
              <span>{formatDuration(r.duration_sec)}</span>
              <span>{formatBytes(r.size_bytes)}</span>
              {r.caption_style && <span>{r.caption_style.replace('_', ' ')}</span>}
            </div>
            <div className="modal-foot" style={{ marginTop: 6 }}>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              <a className="button" href={mediaUrl(r.download_url) ?? '#'} download data-testid="download-render">
                <Download size={14} /> Download MP4
              </a>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="preset-grid" role="radiogroup" aria-label="Preset">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} className="preset-card" data-active={preset === p.id} onClick={() => setPreset(p.id)} data-testid={`preset-${p.id}`}>
            <span className="aspect-box" style={{ width: p.aspect === '16:9' ? 34 : 20, height: p.aspect === '16:9' ? 20 : 34 }} aria-hidden />
            <b>{p.label}</b>
            <small>
              {p.aspect} · {p.size}
            </small>
            <small>{p.max ? `Up to ${p.max}s` : 'No length cap'}</small>
          </button>
        ))}
      </div>
      <label className="field">
        <span className="field-label">Caption style</span>
        <Select value={style} onChange={(e) => setStyle(e.target.value as CaptionStyle | '')} aria-label="Caption style">
          <option value="">Preset default ({CAPTION_STYLES.find((c) => c.id === meta.captions)?.label})</option>
          {CAPTION_STYLES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
        <span className="field-hint">Your clip is not changed: the preset gets its own copy of the timeline.</span>
      </label>
      {(over > 0 || serverOver) && (
        <div className="notice notice-amber" role="alert" data-testid="duration-warning">
          <div className="stat-icon amber">
            <AlertTriangle size={15} />
          </div>
          <div className="notice-body">
            <b>This clip is too long for {meta.label}</b>
            <p>
              The cap is <b className="mono">{serverOver?.max_duration ?? meta.max}s</b> and the clip runs <b className="mono">{(serverOver?.duration ?? length).toFixed(1)}s</b>, which is{' '}
              <b className="mono" data-testid="over-by">{(serverOver?.over_by ?? over).toFixed(1)}s</b> over. Trim it in the editor, or pick a preset without that cap.
            </p>
          </div>
        </div>
      )}
      {isCode(create.error, 'ASSET_NOT_READY') && (
        <div className="notice notice-red" role="alert">
          <div className="notice-body">
            <b>The source file is not ready</b>
            <p>{create.error.message}</p>
          </div>
        </div>
      )}
      <div className="modal-foot" style={{ marginTop: 6 }}>
        <ProvenanceBadge source="user" label="Your edit" />
        <span style={{ flex: 1 }} />
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={create.isPending} onClick={() => create.mutate({ clipId: clip.id, preset, caption_style: style || null })} data-testid="start-render">
          Render
        </Button>
      </div>
    </>
  )
}

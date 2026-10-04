'use client'

import { useMemo, useRef, useState } from 'react'
import { CircleAlert, Clapperboard, FileUp, Image as ImageIcon, Loader2, Music, Plus, Search } from 'lucide-react'
import { EmptyState } from '@/components/common/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useAssets } from '@/lib/api/hooks'
import { mediaUrl } from '@/lib/api/client'
import type { Asset } from '@/lib/api/types'
import { addAssetToTimeline, MEDIA_ACCEPT, startMediaDrag, uploadAndAdd } from '@/lib/editor/media'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useEditor } from '@/stores/editor'
import { useUploads } from '@/stores/uploads'
import { useDropZone } from './use-drop-zone'

type Filter = 'all' | 'video' | 'audio' | 'image'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'image', label: 'Images' },
]
const ICON = { video: Clapperboard, audio: Music, image: ImageIcon } as const

/** The library inside the editor: drag a file onto the timeline, or drop files from your computer to add them to both. */
export function MediaPanel({ contentItemId }: { contentItemId: string }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const readOnly = useEditor((s) => !!s.preview || !!s.busy || s.viewOnly)
  const assets = useAssets({ limit: 100, sort: '-created_at' })
  const uploads = useUploads((s) => s.items)
  const mine = uploads.filter((u) => u.tag === 'editor' && !['done', 'aborted'].includes(u.phase) && !(u.phase === 'processing' && u.assetId))
  const drop = useDropZone({
    disabled: readOnly,
    onAsset: (a) => void addAssetToTimeline(a.id),
    onFiles: (files) => uploadAndAdd(files, contentItemId),
  })

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (assets.data?.items ?? []).filter((a) => a.kind in ICON && (filter === 'all' || a.kind === filter) && (!needle || a.filename.toLowerCase().includes(needle)))
  }, [assets.data, filter, q])

  return (
    <div className="media-panel" data-testid="media-panel" {...drop.props}>
      <button
        type="button"
        className={cn('mp-drop', drop.over && 'over')}
        onClick={() => input.current?.click()}
        disabled={readOnly}
        data-testid="media-dropzone"
        aria-label="Add media: drop files here or choose files"
      >
        <span className="mp-drop-icon">
          <FileUp size={18} />
        </span>
        <b>{drop.over ? 'Drop to add' : 'Add media'}</b>
        <small>Drop video, audio or images here, or browse. They are saved to your library and added to the timeline.</small>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={MEDIA_ACCEPT}
        data-testid="media-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) uploadAndAdd(files, contentItemId)
        }}
      />

      <div className="mp-tools">
        <div className="mp-search">
          <Search size={13} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your library" aria-label="Search your library" />
        </div>
        <div className="mp-chips" role="group" aria-label="Filter by type">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={cn('mp-chip', filter === f.id && 'active')} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mp-list" data-testid="media-list">
        {mine.map((u) => (
          <div key={u.id} className="mp-row mp-uploading" data-testid="media-uploading">
            <span className="mp-thumb">
              <Loader2 size={16} className="spin" />
            </span>
            <span className="mp-meta">
              <b title={u.file.name}>{u.file.name}</b>
              <small>{u.phase === 'failed' ? 'Upload failed' : u.phase === 'queued' || u.phase === 'starting' ? 'Waiting…' : `Uploading ${Math.round((u.sentBytes / Math.max(1, u.file.size)) * 100)}%`}</small>
              {u.phase !== 'failed' && <span className="mp-bar" style={{ ['--p' as string]: `${(u.sentBytes / Math.max(1, u.file.size)) * 100}%` }} />}
            </span>
          </div>
        ))}
        {assets.isPending && (
          <>
            <Skeleton style={{ height: 56 }} />
            <Skeleton style={{ height: 56 }} />
            <Skeleton style={{ height: 56 }} />
          </>
        )}
        {assets.isError && <EmptyState compact tone="error" title="Could not load your library" description="Check that the API is running, then reopen this tab." />}
        {assets.data && rows.length === 0 && mine.length === 0 && (
          <EmptyState compact title={q || filter !== 'all' ? 'Nothing matches' : 'Your library is empty'} description={q || filter !== 'all' ? 'Try another filter or search.' : 'Drop a video, a song or a picture above to get started.'} />
        )}
        {rows.map((a) => (
          <MediaRow key={a.id} asset={a} disabled={readOnly} />
        ))}
      </div>
    </div>
  )
}

function MediaRow({ asset: a, disabled }: { asset: Asset; disabled: boolean }) {
  const Icon = ICON[a.kind as keyof typeof ICON] ?? Clapperboard
  const ready = a.status === 'ready'
  const failed = a.status === 'failed'
  const thumb = mediaUrl(a.thumb_url)
  return (
    <div
      className={cn('mp-row', !ready && 'busy')}
      draggable={!disabled && !failed}
      onDragStart={(e) => startMediaDrag(e, a)}
      data-testid="media-row"
      data-kind={a.kind}
      data-status={a.status}
      title={failed ? 'This file could not be processed' : 'Drag onto the timeline, or press +'}
    >
      <span className="mp-thumb" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}>
        {!thumb && <Icon size={16} aria-hidden />}
        {a.kind !== 'image' && a.duration_sec ? <i className="mono">{formatDuration(a.duration_sec)}</i> : null}
      </span>
      <span className="mp-meta">
        <b title={a.filename}>{a.filename}</b>
        <small>
          <Icon size={11} aria-hidden /> {a.kind}
          {failed ? ' · failed' : !ready ? ' · processing…' : ''}
        </small>
      </span>
      {failed ? (
        <CircleAlert size={15} className="mp-warn" aria-label="Failed" />
      ) : (
        <button type="button" className="icon-button mp-add" disabled={disabled} aria-label={`Add ${a.filename} to the timeline`} onClick={() => void addAssetToTimeline(a.id)} data-testid="media-add">
          <Plus size={15} />
        </button>
      )}
    </div>
  )
}

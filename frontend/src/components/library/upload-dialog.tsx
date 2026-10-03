'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Check, FileVideo, Link2, RotateCw, X } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { UploadZone } from './upload-zone'
import { PipelineChecklist } from './pipeline-checklist'
import { FailureNotice } from './failure-notice'
import { useAsset, qk } from '@/lib/api/hooks'
import { abortUpload, enqueueUploads, retryUpload } from '@/lib/upload'
import { formatBytes, formatEta, formatSpeed } from '@/lib/format'
import { KIND_META } from '@/lib/library'
import { useUploads, type UploadItem } from '@/stores/uploads'
import { useJobs } from '@/stores/jobs'
import type { AssetAnalysis, AssetKind } from '@/lib/api/types'

const GUESS: [RegExp, AssetKind][] = [
  [/\.(mp4|m4v|mov|mkv|webm|avi|mpe?g|wmv|flv|3gp)$/i, 'video'],
  [/\.(mp3|m4a|wav|aac|flac|ogg|opus|wma|aiff)$/i, 'audio'],
  [/\.(jpe?g|png|webp|gif|bmp|tiff?)$/i, 'image'],
]
const guessKind = (name: string): AssetKind => GUESS.find(([re]) => re.test(name))?.[1] ?? 'document'

/** Uploads started here keep running when the dialog is closed (state lives in the uploads store). */
export function UploadDialog({
  open,
  onOpenChange,
  contentItemId,
  onOpenAsset,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  contentItemId?: string
  onOpenAsset?: (id: string) => void
}) {
  const qc = useQueryClient()
  const all = useUploads((s) => s.items)
  const clear = useUploads((s) => s.clearFinished)
  const items = contentItemId ? all.filter((i) => i.contentItemId === contentItemId) : all

  const start = (files: File[]) => {
    enqueueUploads(files, contentItemId, () => {
      void qc.invalidateQueries({ queryKey: qk.assetsAll })
      void qc.invalidateQueries({ queryKey: qk.contentAll })
      void qc.invalidateQueries({ queryKey: qk.boardAll })
    })
  }
  const finished = items.some((i) => ['done', 'failed', 'aborted'].includes(i.phase))

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      eyebrow={contentItemId ? 'Project footage' : 'Asset library'}
      title="Upload footage"
      description="Files upload in chunks (4 at a time) and resume if the connection drops. Duplicates are detected by content, so re-uploading the same file is harmless."
      footer={
        <>
          {finished && (
            <Button variant="ghost" onClick={clear}>
              Clear finished
            </Button>
          )}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {items.some((i) => ['queued', 'starting', 'uploading', 'finalizing'].includes(i.phase)) ? 'Hide (keeps uploading)' : 'Done'}
          </Button>
        </>
      }
    >
      <UploadZone onFiles={start} />
      {items.length > 0 && (
        <ul className="upload-list" data-testid="upload-list">
          {items.map((it) => (
            <UploadRow key={it.id} item={it} onOpenAsset={(id) => { onOpenChange(false); onOpenAsset?.(id) }} />
          ))}
        </ul>
      )}
    </Modal>
  )
}

function UploadRow({ item, onOpenAsset }: { item: UploadItem; onOpenAsset?: (id: string) => void }) {
  const remove = useUploads((s) => s.remove)
  const following = item.phase === 'processing' && !!item.assetId
  const asset = useAsset(following ? item.assetId : null)
  const live = useJobs((s) => (item.jobId ? s.jobs[item.jobId] : undefined))
  const kind = asset.data ? (asset.data.kind as AssetKind) : guessKind(item.file.name)
  const Icon = KIND_META[kind]?.Icon ?? FileVideo
  const total = item.file.size
  const pct = total ? Math.min(100, Math.round((item.sentBytes / total) * 100)) : 0
  const uploading = ['queued', 'starting', 'uploading', 'finalizing'].includes(item.phase)
  const ready = asset.data?.status === 'ready'
  const failedAsset = asset.data?.status === 'failed' || (asset.data?.status === 'uploaded' && !!asset.data.error)

  // Keep the library fresh when processing settles.
  const qc = useQueryClient()
  useEffect(() => {
    if (ready || failedAsset) void qc.invalidateQueries({ queryKey: qk.assetsAll })
  }, [ready, failedAsset, qc])

  return (
    <li className="upload-row" data-testid="upload-row" data-phase={item.phase} data-asset-status={asset.data?.status}>
      <div className="upload-top">
        <span className="upload-icon">
          <Icon size={16} />
        </span>
        <div className="upload-name">
          <b className="truncate" title={item.file.name}>
            {item.file.name}
          </b>
          <small>{statusLine(item, ready, failedAsset, pct)}</small>
        </div>
        <div className="upload-actions">
          {uploading && (
            <button type="button" className="icon-button" aria-label={`Cancel upload of ${item.file.name}`} onClick={() => abortUpload(item.id)} data-testid="abort-upload">
              <X size={14} />
            </button>
          )}
          {item.phase === 'failed' && (
            <Button size="sm" variant="secondary" onClick={() => retryUpload(item.id)} data-testid="retry-upload">
              <RotateCw size={13} /> Retry
            </Button>
          )}
          {(ready || (item.phase === 'done' && item.assetId)) && onOpenAsset && (
            <Button size="sm" variant="secondary" onClick={() => onOpenAsset(item.assetId!)}>
              Open
            </Button>
          )}
          {!uploading && (
            <button type="button" className="icon-button" aria-label={`Remove ${item.file.name} from the list`} onClick={() => remove(item.id)}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {uploading && (
        <div>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Upload progress for ${item.file.name}`}>
            <i style={{ width: `${item.phase === 'finalizing' ? 100 : pct}%` }} />
          </div>
          <div className="upload-stats mono" data-testid="upload-stats">
            <span>
              {formatBytes(item.sentBytes)} / {formatBytes(total)}
            </span>
            {item.speed > 0 && <span>{formatSpeed(item.speed)}</span>}
            {item.etaSec ? <span>{formatEta(item.etaSec)}</span> : null}
            {item.totalChunks ? <span>{item.totalChunks} chunk{item.totalChunks === 1 ? '' : 's'}</span> : null}
          </div>
        </div>
      )}

      {item.phase === 'failed' && item.error && (
        <p className="upload-error" role="alert">
          <AlertCircle size={13} aria-hidden /> {item.error.message}
        </p>
      )}

      {item.phase === 'done' && item.duplicate && (
        <p className="upload-note" data-testid="upload-duplicate">
          <Link2 size={13} aria-hidden /> Already in your library (same content), so nothing new was created or processed.
        </p>
      )}

      {following && asset.data && !ready && !failedAsset && (
        <PipelineChecklist
          kind={asset.data.kind}
          doneEntries={asset.data.stages_done}
          current={live?.stage || asset.data.job?.stage}
          hasAudio={(asset.data.analysis as AssetAnalysis).probe?.has_audio ?? true}
          compact
        />
      )}
      {following && asset.data && failedAsset && <FailureNotice asset={asset.data} />}
      {ready && (
        <p className="upload-ok" data-testid="upload-ready">
          <Check size={13} aria-hidden /> Processed and searchable.
          {asset.data?.warnings.some((w) => w.code === 'CAPTIONS_UNAVAILABLE') ? ' AI shot captions were skipped (no AI provider).' : ''}
        </p>
      )}
    </li>
  )
}

function statusLine(item: UploadItem, ready: boolean, failed: boolean, pct: number): string {
  switch (item.phase) {
    case 'queued':
      return `${formatBytes(item.file.size)} · waiting`
    case 'starting':
      return `${formatBytes(item.file.size)} · preparing`
    case 'uploading':
      return `Uploading ${pct}%`
    case 'finalizing':
      return 'Assembling and checking the file'
    case 'processing':
      return ready ? 'Ready' : failed ? 'Processing failed' : 'Processing'
    case 'done':
      return item.duplicate ? 'Duplicate' : 'Done'
    case 'failed':
      return 'Upload failed'
    case 'aborted':
      return 'Canceled'
  }
}

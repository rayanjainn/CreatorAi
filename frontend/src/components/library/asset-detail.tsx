'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Check, Trash2, X } from 'lucide-react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ErrorState } from '@/components/common/error-state'
import { Segmented } from '@/components/common/segmented'
import { EmptyState } from '@/components/common/empty-state'
import { Thumb } from '@/components/common/thumb'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { PlayerHandle, VideoPlayer } from '@/components/media/video-player'
import { TranscriptView, type TranscriptSeg } from '@/components/media/transcript-view'
import { ShotStrip } from '@/components/media/shot-strip'
import { Waveform } from '@/components/media/waveform'
import { AttachTranscriptButton, FailureNotice } from './failure-notice'
import { PipelineChecklist } from './pipeline-checklist'
import { AssetStatusChip } from './status-chip'
import { TagEditor } from './tag-editor'
import { useAssetDrawer } from './use-asset-drawer'
import { useAsset, useContentItem, useDeleteAsset, usePatchAsset, useReprocessAsset, useTranscript } from '@/lib/api/hooks'
import { mediaUrl } from '@/lib/api/client'
import { KIND_META, PIPELINE, kindOf } from '@/lib/library'
import { formatBytes, formatDuration, formatTimecode, stripDemo } from '@/lib/format'
import { formatDateTime } from '@/lib/time'
import { useJobs } from '@/stores/jobs'
import type { AssetAnalysis, AssetDetail as AssetDetailT } from '@/lib/api/types'

type Tab = 'transcript' | 'shots' | 'details'

/**
 * The asset drawer, driven by the URL (`?asset=<id>&t=<sec>`). Mount it once on any page that lists assets.
 * Esc / the close button / the backdrop all clear the params.
 */
export function AssetDetailHost() {
  const { assetId, t, close } = useAssetDrawer()
  return (
    <Dialog.Root open={!!assetId} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="drawer-backdrop" />
        <Dialog.Popup className="drawer drawer-wide" data-testid="asset-drawer" aria-describedby={undefined}>
          {assetId && <AssetDetailBody key={assetId} id={assetId} startAt={t} onClose={close} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function AssetDetailBody({ id, startAt, onClose }: { id: string; startAt?: number; onClose: () => void }) {
  const q = useAsset(id)
  return q.isPending ? (
    <>
      <Head title="Loading…" onClose={onClose} />
      <div className="drawer-body">
        <Skeleton style={{ height: 300, borderRadius: 14 }} />
        <Skeleton style={{ height: 120, marginTop: 14 }} />
      </div>
    </>
  ) : q.isError ? (
    <>
      <Head title="Asset" onClose={onClose} />
      <div className="drawer-body">
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load this asset" />
      </div>
    </>
  ) : (
    <Loaded asset={q.data} startAt={startAt} onClose={onClose} />
  )
}

function Head({ title, onClose, children }: { title: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <div className="drawer-head">
      <div style={{ minWidth: 0 }}>
        <div className="eyebrow violet-text">Asset</div>
        <Dialog.Title render={<h2 className="truncate" />}>{title}</Dialog.Title>
        {children}
      </div>
      <Dialog.Close className="icon-button" aria-label="Close asset" onClick={onClose}>
        <X size={16} />
      </Dialog.Close>
    </div>
  )
}

function Loaded({ asset, startAt, onClose }: { asset: AssetDetailT; startAt?: number; onClose: () => void }) {
  const kind = kindOf(asset)
  const analysis = asset.analysis as AssetAnalysis
  const player = useRef<PlayerHandle>(null)
  const [time, setTime] = useState(startAt ?? 0)
  const [tab, setTab] = useState<Tab>(kind === 'video' || kind === 'audio' ? 'transcript' : kind === 'image' ? 'details' : 'details')
  const transcript = useTranscript(asset.id, kind === 'video' || kind === 'audio')
  const live = useJobs((s) => (asset.job ? s.jobs[asset.job.id] : undefined))
  const [confirm, setConfirm] = useState(false)
  const del = useDeleteAsset()

  const seek = (t: number) => {
    setTime(t)
    player.current?.seek(t, true)
  }

  const segs: TranscriptSeg[] = useMemo(() => {
    if (transcript.data?.segments.length) return transcript.data.segments
    return asset.segments.map((s) => ({ idx: s.idx, start: s.start_sec, end: s.end_sec, text: s.text }))
  }, [transcript.data, asset.segments])

  const processing = asset.status === 'processing' || asset.status === 'uploaded'
  const tabs: { value: Tab; label: string }[] = [
    ...(kind === 'video' || kind === 'audio' ? [{ value: 'transcript' as Tab, label: 'Transcript' }] : []),
    ...(kind === 'video' || kind === 'image' ? [{ value: 'shots' as Tab, label: `Shots${asset.shots.length ? ` (${asset.shots.length})` : ''}` }] : []),
    { value: 'details', label: 'Details' },
  ]

  return (
    <>
      <Head title={asset.filename} onClose={onClose}>
        <div className="drawer-meta">
          <AssetStatusChip asset={{ status: asset.status, job: asset.job ?? undefined }} />
          <ProvenanceBadge {...asset.provenance} />
          {asset.duration_sec ? <span className="mono muted">{formatDuration(asset.duration_sec)}</span> : null}
        </div>
      </Head>
      <div className="drawer-body asset-body">
        <div className="asset-left">
          <div className="player-wrap">
            {kind === 'video' ? (
              <VideoPlayer ref={player} src={asset.urls.proxy ?? asset.urls.original} poster={asset.thumb_url} start={startAt} onTime={setTime} label={`Player for ${asset.filename}`} />
            ) : kind === 'audio' ? (
              <div className="player-audio-wrap">
                <Thumb src={asset.thumb_url} iconSize={34} className="thumb audio-thumb" />
                <VideoPlayer ref={player} media="audio" src={asset.urls.audio ?? asset.urls.original} start={startAt} onTime={setTime} label={`Player for ${asset.filename}`} />
              </div>
            ) : kind === 'image' ? (
                          <img className="asset-image" src={mediaUrl(asset.urls.original ?? asset.thumb_url) ?? undefined} alt={asset.description || asset.filename} />
            ) : (
              <div className="doc-preview" data-testid="doc-preview">
                {analysis.text ? <pre>{analysis.text}</pre> : <EmptyState compact title="No text to show" description="This file is stored as is. Only plain text and Markdown are read." />}
              </div>
            )}
          </div>
          {kind !== 'image' && analysis.energy && analysis.energy.length > 0 && (
            <Waveform energy={analysis.energy} silences={analysis.silences} currentTime={time} onSeek={seek} />
          )}
          <FailureNotice asset={asset} />
          {asset.status !== 'failed' && asset.warnings.length > 0 && (
            <div className="notice notice-amber" data-testid="asset-warnings">
              <div className="notice-body">
                {asset.warnings.map((w) => (
                  <p key={w.code}>
                    <b>{w.code === 'CAPTIONS_UNAVAILABLE' ? 'AI captions unavailable' : w.code}</b>
                    <span className="notice-fine" style={{ display: 'block' }}>
                      {w.message}
                    </span>
                  </p>
                ))}
              </div>
            </div>
          )}
          {processing && (
            <div className="card tight">
              <div className="eyebrow">Pipeline</div>
              <PipelineChecklist
                kind={asset.kind}
                doneEntries={asset.stages_done}
                current={live?.stage || asset.job?.stage}
                hasAudio={analysis.probe?.has_audio ?? true}
                compact
              />
            </div>
          )}
        </div>
        <div className="asset-right">
          <Segmented<Tab> value={tab} onChange={setTab} options={tabs} label="Asset sections" />
          <div className="asset-tab" data-testid={`tab-${tab}`}>
            {tab === 'transcript' && (
              <TranscriptTab asset={asset} segs={segs} loading={transcript.isPending && !segs.length} source={transcript.data} time={time} onSeek={seek} />
            )}
            {tab === 'shots' &&
              (asset.shots.length ? (
                <ShotStrip shots={asset.shots} duration={asset.duration_sec} currentTime={time} onSeek={seek} />
              ) : (
                <EmptyState compact title="No shots yet" description={processing ? 'Shot detection runs during processing.' : 'No shots were detected for this file.'} />
              ))}
            {tab === 'details' && <DetailsTab asset={asset} analysis={analysis} onDelete={() => setConfirm(true)} />}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${asset.filename}?`}
        description="This removes the file, its transcript, shots and search index, and cancels any running processing. Scripts and clips that used it are not deleted. This cannot be undone."
        confirmLabel="Delete asset"
        danger
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(asset.id, {
            onSuccess: () => {
              setConfirm(false)
              onClose()
            },
          })
        }
      />
    </>
  )
}

function TranscriptTab({
  asset,
  segs,
  loading,
  source,
  time,
  onSeek,
}: {
  asset: AssetDetailT
  segs: TranscriptSeg[]
  loading: boolean
  source: ReturnType<typeof useTranscript>['data']
  time: number
  onSeek: (t: number) => void
}) {
  if (loading) return <Skeleton style={{ height: 260 }} />
  if (!segs.length) {
    const processing = asset.status === 'processing' || asset.status === 'uploaded'
    return (
      <EmptyState
        compact
        title={processing ? 'Transcript on its way' : 'No transcript'}
        description={processing ? 'It appears here as soon as transcription finishes.' : 'Nothing was transcribed for this file. If it has speech you can attach a transcript you already have.'}
        actions={!processing && <AttachTranscriptButton assetId={asset.id} variant="secondary" />}
      />
    )
  }
  return (
    <div>
      <div className="transcript-head">
        {source ? (
          <>
            <ProvenanceBadge {...source.provenance} />
            <span className="muted">
              {source.source === 'sidecar' ? 'Attached transcript' : 'Speech to text'}
              {source.language ? ` · ${source.language}` : ''}
              {source.model ? ` · ${source.model}` : ''}
            </span>
          </>
        ) : (
          <span className="muted">Transcript segments</span>
        )}
        <span className="mono muted" style={{ marginLeft: 'auto' }}>
          {formatTimecode(time, true)}
        </span>
      </div>
      <TranscriptView segments={segs} currentTime={time} onSeek={onSeek} estimated={source?.words_estimated} />
    </div>
  )
}

function DetailsTab({ asset, analysis, onDelete }: { asset: AssetDetailT; analysis: AssetAnalysis; onDelete: () => void }) {
  const patch = usePatchAsset()
  const reprocess = useReprocessAsset()
  const project = useContentItem(asset.content_item_id ?? undefined)
  const [desc, setDesc] = useState(asset.description)
  const [saved, setSaved] = useState(false)
  const [restart, setRestart] = useState('')
  const busy = asset.status === 'processing'

  const saveDescription = () => {
    if (desc === asset.description) return
    patch.mutate({ id: asset.id, patch: { description: desc } }, { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 1800) } })
  }

  const rows: [string, React.ReactNode][] = [
    ['Type', `${KIND_META[kindOf(asset)].label} · ${asset.mime}`],
    ['Duration', asset.duration_sec ? `${formatDuration(asset.duration_sec)} (${asset.duration_sec.toFixed(1)} s)` : '—'],
    ['Resolution', asset.width && asset.height ? `${asset.width}×${asset.height}${asset.fps ? ` @ ${Math.round(asset.fps)} fps` : ''}` : '—'],
    ['Size', formatBytes(asset.size_bytes)],
    ['Added', formatDateTime(asset.created_at)],
    ['SHA-256', <span key="sha" className="mono">{asset.sha256.slice(0, 16)}…</span>],
    [
      'Project',
      asset.content_item_id ? (
        <Link key="p" href={`/projects/${asset.content_item_id}/footage`} className="link">
          {project.data ? stripDemo(project.data.title) : 'Open project'}
        </Link>
      ) : (
        'Not attached to a project'
      ),
    ],
  ]

  const provenance = Object.entries(asset.provenance_by_stage)
  return (
    <div className="details-tab">
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <section>
        <h4 className="sub-h">Tags</h4>
        <TagEditor tags={asset.tags} disabled={patch.isPending} onChange={(tags) => patch.mutate({ id: asset.id, patch: { tags } })} />
      </section>

      <section>
        <div className="sub-h-row">
          <h4 className="sub-h">Description</h4>
          {saved && (
            <span className="saved-note" role="status">
              <Check size={12} /> Saved
            </span>
          )}
        </div>
        <textarea
          className="textarea"
          value={desc}
          rows={3}
          placeholder="What is in this file? Edits you make are kept and never overwritten by AI captions."
          aria-label="Description"
          onChange={(e) => setDesc(e.target.value)}
          onBlur={saveDescription}
        />
      </section>

      <section>
        <h4 className="sub-h">Where each result came from</h4>
        {provenance.length === 0 ? (
          <p className="muted small">Nothing generated yet.</p>
        ) : (
          <div className="stage-prov">
            {provenance.map(([stage, p]) => (
              <div key={stage} className="status-row">
                <div className="status-main">
                  <b style={{ textTransform: 'capitalize' }}>{stage}</b>
                  <small>
                    {[p.provider, p.model].filter(Boolean).join(' · ') || 'built in'}
                  </small>
                </div>
                <ProvenanceBadge {...p} />
              </div>
            ))}
          </div>
        )}
        <dl className="kv" style={{ marginTop: 10 }}>
          {analysis.asr && (
            <>
              <dt>Speech</dt>
              <dd>
                {analysis.asr.no_speech ? 'No speech found' : `${analysis.asr.words ?? 0} words · ${analysis.asr.provider ?? analysis.asr.source ?? ''}${analysis.asr.language ? ` · ${analysis.asr.language}` : ''}`}
              </dd>
            </>
          )}
          {analysis.silence_total_sec !== undefined && (
            <>
              <dt>Silence</dt>
              <dd>
                {analysis.silence_total_sec.toFixed(1)} s in {analysis.silences?.length ?? 0} gaps
              </dd>
            </>
          )}
          {analysis.shots && (
            <>
              <dt>Shots</dt>
              <dd>
                {analysis.shots.count ?? 0} via {analysis.shots.method ?? 'detector'}
              </dd>
            </>
          )}
          {analysis.embedder && (
            <>
              <dt>Search index</dt>
              <dd>
                {analysis.embedder.backend}
                {analysis.embedder.real === false ? ' (keyword-grade fallback)' : ''}
              </dd>
            </>
          )}
        </dl>
      </section>

      <section>
        <h4 className="sub-h">Pipeline</h4>
        <PipelineChecklist
          kind={asset.kind}
          doneEntries={asset.stages_done}
          failedStage={analysis.failed_stage}
          jobDone={!busy}
          hasAudio={analysis.probe?.has_audio ?? true}
        />
        <div className="reprocess-row">
          <Select aria-label="Restart from stage" value={restart} onChange={(e) => setRestart(e.target.value)} disabled={busy}>
            <option value="">Resume where it stopped</option>
            {PIPELINE.map((s) => (
              <option key={s.id} value={s.id}>
                Restart from: {s.label}
              </option>
            ))}
          </Select>
          <Button variant="secondary" size="sm" disabled={busy} loading={reprocess.isPending} onClick={() => reprocess.mutate({ id: asset.id, stage: restart || undefined })} data-testid="reprocess">
            Reprocess
          </Button>
        </div>
      </section>

      <div className="danger-row">
        <div>
          <b>Delete this asset</b>
          <small>Removes the file and everything derived from it.</small>
        </div>
        <Button variant="danger" size="sm" onClick={onDelete} data-testid="delete-asset">
          <Trash2 size={13} /> Delete
        </Button>
      </div>
    </div>
  )
}

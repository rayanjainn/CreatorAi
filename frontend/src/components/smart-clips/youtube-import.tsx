'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { AlertTriangle, Check, Download, ExternalLink, Film, Link2, Loader2, Search, Trash2 } from 'lucide-react'
import { ClipCard } from '@/components/clips/clip-card'
import { RenderDialog } from '@/components/clips/render-dialog'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { Segmented } from '@/components/common/segmented'
import { Button, LinkButton } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { withAccessToken } from '@/lib/api/client'
import { isApiError } from '@/lib/api/errors'
import { useClips, useDeleteYtImport, useStartYtImport, useYtImports, useYtImportStatus, useYtSearch } from '@/lib/api/hooks'
import { formatDuration } from '@/lib/format'
import { relativeTime } from '@/lib/time'
import { useRole } from '@/lib/use-role'
import { cn } from '@/lib/utils'
import type { Clip, YtImport, YtImportStatus, YtVideoResult } from '@/lib/api/types'

type Mode = 'topic' | 'link'
type Options = { autoClips: boolean; count: number }

const thumb = (videoId: string) => withAccessToken(`/api/v1/yt-import/thumbnail/${videoId}`)
const ACTIVE = new Set(['queued', 'downloading', 'processing', 'clipping'])

/**
 * Smart Clips > From YouTube: find videos on a topic with the web search (or paste a link), download one with yt-dlp, run it through
 * the same pipeline as an upload (transcribe, index, embed) and cut short 9:16 clips automatically.
 */
export function YoutubeImport() {
  const status = useYtImportStatus()
  const imports = useYtImports()
  const [selected, setSelected] = useState<string | null>(null)
  if (status.isPending) return <Skeleton style={{ height: 320 }} />
  if (status.isError) return <ErrorState error={status.error} onRetry={() => void status.refetch()} title="Could not check the YouTube import setup" />
  if (!status.data.available) {
    return <EmptyState icon={<Film size={22} />} title="yt-dlp is not installed" description="Run make setup (or pip install yt-dlp in backend/.venv) and restart the API." />
  }
  const active = selected ?? imports.data?.[0]?.id ?? null
  const current = imports.data?.find((i) => i.id === active) ?? null
  return (
    <div className="sc-layout">
      <div className="sc-side">
        <ImportForm status={status.data} onStarted={setSelected} />
        <ImportList items={imports.data} loading={imports.isPending} selected={active} onSelect={setSelected} />
      </div>
      <div className="sc-main">
        {current ? (
          <ImportView row={current} onRetry={setSelected} />
        ) : (
          <EmptyState icon={<Film size={22} />} title="Nothing imported yet" description="Search a topic or paste a YouTube link on the left. The video is downloaded, transcribed and indexed, and the best moments become short clips." />
        )}
      </div>
    </div>
  )
}

function ImportForm({ status, onStarted }: { status: YtImportStatus; onStarted: (id: string) => void }) {
  const { canEdit } = useRole()
  const [mode, setMode] = useState<Mode>(status.search_configured ? 'topic' : 'link')
  const [topic, setTopic] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [url, setUrl] = useState('')
  const [opts, setOpts] = useState<Options>({ autoClips: true, count: 4 })
  const start = useStartYtImport()
  const search = useYtSearch(mode === 'topic' ? submitted : '')
  const apiError = start.error && isApiError(start.error) ? start.error : null

  const importUrl = (link: string, why?: string) =>
    start.mutate({ url: link, topic: why || null, auto_clips: opts.autoClips, clip_count: opts.count }, { onSuccess: (row) => onStarted(row.id) })

  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    if (topic.trim().length >= 2) setSubmitted(topic.trim())
  }
  const linkOk = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|embed\/|live\/)|youtu\.be\/)\S+/i.test(url.trim())

  return (
    <section className="card sc-form" data-testid="yt-form">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">yt-dlp · local pipeline</div>
          <h2>Clip a YouTube video</h2>
        </div>
      </div>
      <Segmented<Mode>
        label="How to find the video"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'topic', label: 'Search a topic' },
          { value: 'link', label: 'Paste a link' },
        ]}
      />
      {mode === 'topic' ? (
        <form onSubmit={onSearch} className="yt-search">
          <Field
            label="Topic"
            htmlFor="yt-topic"
            hint={status.search_configured ? `Web search (${status.search_provider}) finds YouTube videos about it.` : undefined}
            error={status.search_configured ? null : 'Topic search needs SERPER_API_KEY (SEARCH_PROVIDER=serper) or TAVILY_API_KEY in .env. You can still paste a link.'}
          >
            <div className="sc-url">
              <Search size={15} aria-hidden />
              <Input id="yt-topic" placeholder="e.g. how to edit short form video" value={topic} onChange={(e) => setTopic(e.target.value)} disabled={!status.search_configured} data-testid="yt-topic" />
            </div>
          </Field>
          <Button type="submit" variant="secondary" block disabled={!status.search_configured || topic.trim().length < 2} loading={search.isFetching} data-testid="yt-search">
            <Search size={14} /> Find videos
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (linkOk) importUrl(url.trim())
          }}
          className="yt-search"
        >
          <Field label="YouTube link" htmlFor="yt-url" hint="A single public video: youtube.com/watch, youtu.be or /shorts/ links.">
            <div className="sc-url">
              <Link2 size={15} aria-hidden />
              <Input id="yt-url" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" data-testid="yt-url" />
            </div>
          </Field>
          <Button type="submit" block disabled={!linkOk || !canEdit} loading={start.isPending} data-testid="yt-import-link">
            <Download size={14} /> Import and clip
          </Button>
        </form>
      )}
      <div className="sc-row">
        <label className="yt-check">
          <input type="checkbox" checked={opts.autoClips} onChange={(e) => setOpts({ ...opts, autoClips: e.target.checked })} data-testid="yt-auto-clips" />
          Make short clips when it is ready
        </label>
        <Field label="Clips" htmlFor="yt-count">
          <Select id="yt-count" value={opts.count} disabled={!opts.autoClips} onChange={(e) => setOpts({ ...opts, count: Number(e.target.value) })}>
            {[2, 3, 4, 5, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n} clips
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="muted small">
        Up to {Math.round(status.max_duration_sec / 60)} min, downloaded at {status.max_height}p.{' '}
        {status.asr_available ? 'Transcribed with Whisper.' : 'No speech-to-text is configured, so YouTube’s own captions are used (labelled as such).'} Only import videos you
        have the rights to reuse.
      </p>
      {!canEdit && <p className="field-error">You have view-only access to this workspace.</p>}
      {apiError && (
        <p className="field-error" role="alert" data-testid="yt-start-error">
          {apiError.message}
        </p>
      )}
      {mode === 'topic' && submitted && <SearchResults query={submitted} search={search} maxSec={status.max_duration_sec} busy={start.isPending ? start.variables?.url : undefined} disabled={!canEdit} onImport={(v) => importUrl(v.url, submitted)} />}
    </section>
  )
}

function SearchResults({
  query,
  search,
  maxSec,
  busy,
  disabled,
  onImport,
}: {
  query: string
  search: ReturnType<typeof useYtSearch>
  maxSec: number
  busy?: string
  disabled: boolean
  onImport: (v: YtVideoResult) => void
}) {
  if (search.isPending) return <Skeleton style={{ height: 180 }} />
  if (search.isError) return <p className="field-error" role="alert" data-testid="yt-search-error">{isApiError(search.error) ? search.error.message : 'The search failed.'}</p>
  if (!search.data.results.length) return <p className="muted small">No YouTube videos found for “{query}”. Try other words.</p>
  return (
    <ul className="yt-results" data-testid="yt-results" aria-label={`Videos about ${query}`}>
      {search.data.results.map((v) => {
        const tooLong = v.duration_sec != null && v.duration_sec > maxSec
        return (
          <li key={v.video_id} className="yt-result" data-testid="yt-result">
            <img src={thumb(v.video_id)} alt="" loading="lazy" />
            <div className="yt-result-main">
              <b title={v.title}>{v.title}</b>
              <small>
                {[v.channel, v.duration_sec != null ? formatDuration(v.duration_sec) : null, v.published].filter(Boolean).join(' · ')}
              </small>
              <div className="yt-result-actions">
                <Button size="sm" disabled={tooLong || disabled || !!busy} loading={busy === v.url} onClick={() => onImport(v)} title={tooLong ? 'Longer than the import limit' : undefined} data-testid="yt-import">
                  <Download size={13} /> {tooLong ? 'Too long' : 'Import'}
                </Button>
                <a className="link small" href={v.url} target="_blank" rel="noreferrer noopener">
                  Watch <ExternalLink size={11} />
                </a>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function ImportList({ items, loading, selected, onSelect }: { items?: YtImport[]; loading: boolean; selected: string | null; onSelect: (id: string) => void }) {
  const del = useDeleteYtImport()
  if (loading) return <Skeleton style={{ height: 120 }} />
  if (!items?.length) return null
  return (
    <section className="card sc-recent" data-testid="yt-imports">
      <div className="card-heading">
        <h3>Imports</h3>
      </div>
      <ul>
        {items.map((i) => (
          <li key={i.id} data-selected={i.id === selected}>
            <button type="button" onClick={() => onSelect(i.id)} className="sc-recent-btn">
              <span className={cn('sc-pill', i.status === 'done' ? 'st-completed' : i.status === 'failed' ? 'st-failed' : 'st-processing')}>
                {i.status === 'done' ? (i.clips_count ? `${i.clips_count} clips` : 'Ready') : i.status === 'failed' ? 'Failed' : `${i.progress}%`}
              </span>
              <b title={i.title}>{i.title}</b>
              <small>
                {relativeTime(i.created_at)}
                {i.duration_sec ? ` · ${formatDuration(i.duration_sec)}` : ''}
              </small>
            </button>
            <button type="button" className="icon-button" aria-label="Remove this import from the list" title="Remove from the list (the project, video and clips stay)" disabled={i.status === 'queued' || i.status === 'downloading'} onClick={() => del.mutate(i.id)}>
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

const STEPS = [
  { id: 'download', label: 'Downloading from YouTube' },
  { id: 'process', label: 'Transcribing and indexing' },
  { id: 'clips', label: 'Cutting short clips' },
  { id: 'done', label: 'Ready' },
] as const

function stepOf(row: YtImport): number {
  if (row.status === 'done') return 3
  if (row.status === 'clipping') return 2
  if (row.status === 'processing') return 1
  return 0
}

function ImportView({ row, onRetry }: { row: YtImport; onRetry: (id: string) => void }) {
  const retry = useStartYtImport()
  const step = stepOf(row)
  const running = ACTIVE.has(row.status)
  const auto = !!row.options?.auto_clips
  return (
    <section className="card sc-project" data-testid="yt-import-view" data-status={row.status}>
      <div className="yt-head">
        <img src={thumb(row.video_id)} alt="" className="yt-head-thumb" />
        <div>
          <div className="eyebrow">
            {row.channel ?? 'YouTube'}
            {row.duration_sec ? ` · ${formatDuration(row.duration_sec)}` : ''}
            {row.topic ? ` · topic “${row.topic}”` : ''}
          </div>
          <h2>{row.title}</h2>
          <a className="link small" href={row.url} target="_blank" rel="noreferrer noopener">
            {row.url} <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {row.status === 'failed' ? (
        <div className="sc-fail" role="alert" data-testid="yt-failed" data-code={row.error_code ?? ''}>
          <AlertTriangle size={18} />
          <div>
            <b>{failTitle(row.error_code)}</b>
            <p>{row.error ?? 'The import did not finish.'}</p>
            <Button size="sm" variant="secondary" loading={retry.isPending} onClick={() => retry.mutate({ url: row.url, topic: row.topic, content_item_id: row.content_item_id, auto_clips: auto, clip_count: Number(row.options?.clip_count ?? 4) }, { onSuccess: (r) => onRetry(r.id) })}>
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="progress" aria-label="Import progress" aria-valuenow={row.progress} role="progressbar" data-testid="yt-progress">
            <i style={{ width: `${Math.max(3, row.progress)}%` }} />
          </div>
          <ol className="sc-steps" aria-label="Progress">
            {STEPS.filter((s) => auto || s.id !== 'clips').map((s) => {
              const idx = STEPS.findIndex((x) => x.id === s.id)
              const state = idx < step || row.status === 'done' ? 'done' : idx === step ? 'active' : 'pending'
              return (
                <li key={s.id} data-state={state}>
                  <span className="sc-dot">{state === 'done' ? <Check size={12} /> : state === 'active' ? <Loader2 size={12} className="spin" /> : null}</span>
                  <b>{s.label}</b>
                  {state === 'active' && running && <small className="muted">{row.stage}</small>}
                </li>
              )
            })}
          </ol>
        </>
      )}

      {row.transcript_source && (
        <p className="muted small" data-testid="yt-transcript-source">
          Transcript: {row.transcript_source === 'asr' ? 'speech-to-text (Whisper)' : 'the video’s YouTube captions'}
        </p>
      )}
      {row.content_item_id && (
        <div className="yt-links">
          <LinkButton size="sm" variant="secondary" href={`/projects/${row.content_item_id}/clips`} data-testid="yt-open-project">
            Open the project
          </LinkButton>
          {row.asset_id && (
            <Link className="link small" href={`/assets?asset=${row.asset_id}`}>
              Video in the library
            </Link>
          )}
        </div>
      )}
      {row.status === 'done' && row.content_item_id && row.asset_id && <ImportClips itemId={row.content_item_id} assetId={row.asset_id} auto={auto} />}
    </section>
  )
}

function failTitle(code: string | null): string {
  switch (code) {
    case 'YT_LOGIN_REQUIRED':
      return 'YouTube wants a signed-in viewer'
    case 'YT_UNAVAILABLE':
      return 'That video is not available'
    case 'YT_TOO_LONG':
      return 'Too long to import'
    case 'ASR_UNAVAILABLE':
      return 'No transcript could be made'
    case 'CLIPS_FAILED':
    case 'NO_CLIP_CANDIDATES':
      return 'No clips could be cut'
    case 'CANCELED':
      return 'Canceled'
    default:
      return 'The import failed'
  }
}

function ImportClips({ itemId, assetId, auto }: { itemId: string; assetId: string; auto: boolean }) {
  const clips = useClips(itemId, { kind: 'short' })
  const [renderClip, setRenderClip] = useState<Clip | null>(null)
  const [open, setOpen] = useState(false)
  if (clips.isPending) return <Skeleton style={{ height: 240 }} />
  if (clips.isError) return <ErrorState error={clips.error} onRetry={() => void clips.refetch()} />
  const mine = clips.data.filter((c) => c.source_asset_id === assetId)
  if (!mine.length) {
    return auto ? (
      <EmptyState compact title="No clips were found in this video" description="Smart Clips needs speech. Open the project to try again with other settings." />
    ) : (
      <EmptyState compact title="Ready for clipping" description="The video is transcribed and indexed. Open the project and press Generate clips." />
    )
  }
  return (
    <>
      <div className="clip-grid" data-testid="yt-clips">
        {mine.map((c, i) => (
          <ClipCard
            key={c.id}
            clip={c}
            index={i}
            onRender={(cl) => {
              setRenderClip(cl)
              setOpen(true)
            }}
          />
        ))}
      </div>
      <RenderDialog clip={renderClip} open={open} onOpenChange={setOpen} />
    </>
  )
}

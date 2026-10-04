'use client'

import { useMemo, useState } from 'react'
import { Link2, Rocket, Trash2 } from 'lucide-react'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { Segmented } from '@/components/common/segmented'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { isApiError } from '@/lib/api/errors'
import { useAssets, useDeleteLumiclipProject, useLumiclipProject, useLumiclipProjects, useLumiclipStatus, useStartLumiclip } from '@/lib/api/hooks'
import { formatDuration, parseClock } from '@/lib/format'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { ClipSettings, DEFAULT_SETTINGS, type ClipSettingsValues } from './clip-settings'
import { LumiClipCard } from './lumi-clip-card'
import { ProjectProgress } from './project-progress'
import { LumiclipSetupCard } from './setup-card'
import { YoutubeDownloader } from './youtube-downloader'
import type { LumiclipProject } from '@/lib/api/types'

type Source = 'url' | 'library'

/** Clip a video link (or a library video) in the cloud with LumiClip, follow it, and save the clips to the library. */
export function LumiclipStudio() {
  const status = useLumiclipStatus()
  const projects = useLumiclipProjects()
  const [selected, setSelected] = useState<string | null>(null)
  if (status.isPending) return <Skeleton style={{ height: 320 }} />
  if (status.isError) return <ErrorState error={status.error} onRetry={() => void status.refetch()} title="Could not check the LumiClip setup" />
  if (!status.data.configured) {
    return (
      <div className="sc-layout">
        <div className="sc-side">
          <YoutubeDownloader />
        </div>
        <div className="sc-main">
          <LumiclipSetupCard />
        </div>
      </div>
    )
  }

  const active = selected ?? projects.data?.[0]?.id ?? null
  return (
    <div className="sc-layout">
      <div className="sc-side">
        <YoutubeDownloader />
        <StartForm cloudinary={status.data.cloudinary_configured} onStarted={(id) => setSelected(id)} />
        <ProjectList items={projects.data} loading={projects.isPending} selected={active} onSelect={setSelected} />
      </div>
      <div className="sc-main">{active ? <ProjectView id={active} onGone={() => setSelected(null)} /> : <EmptyState icon={<Rocket size={22} />} title="Nothing clipped yet" description="Paste a video link on the left and press Find the best clips. Your results appear here and are kept." />}</div>
    </div>
  )
}

function StartForm({ cloudinary, onStarted }: { cloudinary: boolean; onStarted: (projectId: string) => void }) {
  const [source, setSource] = useState<Source>('url')
  const [url, setUrl] = useState('')
  const [assetId, setAssetId] = useState('')
  const [settings, setSettings] = useState<ClipSettingsValues>(DEFAULT_SETTINGS)
  const start = useStartLumiclip()
  const videos = useAssets({ kind: 'video', status: 'ready', limit: 100 }, { enabled: source === 'library' })

  const startS = parseClock(settings.start)
  const endS = parseClock(settings.end)
  const badNumber = (settings.start && startS === null) || (settings.end && endS === null)
  const rangeError = badNumber ? 'Use mm:ss or seconds' : startS !== null && endS !== null && endS <= startS ? 'End must be after the start' : null
  const urlOk = /^https?:\/\/\S+\.\S+/i.test(url.trim())
  const can = source === 'url' ? urlOk : !!assetId
  const apiError = start.error && isApiError(start.error) ? start.error : null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!can || rangeError) return
    start.mutate(
      {
        url: source === 'url' ? url.trim() : null,
        asset_id: source === 'library' ? assetId : null,
        aspect_ratio: settings.aspect,
        language: settings.language === 'auto' ? null : settings.language,
        subtitle_style: settings.subtitleStyle,
        start_time: startS || null,
        end_time: endS || null,
      },
      { onSuccess: (p) => onStarted(p.id) },
    )
  }

  return (
    <form className="card sc-form" onSubmit={submit} data-testid="lumiclip-form">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">Cloud clipper</div>
          <h2>Clip a video</h2>
        </div>
        <ProvenanceBadge source="ai" provider="lumiclip" />
      </div>
      <Segmented<Source>
        label="Where is the video?"
        value={source}
        onChange={setSource}
        options={[
          { value: 'url', label: 'A link' },
          { value: 'library', label: 'My library' },
        ]}
      />
      {source === 'url' ? (
        <Field label="Video link" htmlFor="sc-url" hint="YouTube and most public video pages work. Private videos do not.">
          <div className="sc-url">
            <Link2 size={15} aria-hidden />
            <Input id="sc-url" type="url" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" data-testid="lumiclip-url" />
          </div>
        </Field>
      ) : (
        <Field
          label="Library video"
          htmlFor="sc-asset"
          hint={cloudinary ? 'It is uploaded to your Cloudinary account first so LumiClip can read it.' : undefined}
          error={cloudinary ? null : 'Needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in .env, or paste a public link instead.'}
        >
          <Select id="sc-asset" value={assetId} onChange={(e) => setAssetId(e.target.value)} disabled={!cloudinary}>
            <option value="">{videos.isPending ? 'Loading your videos…' : videos.data?.items.length ? 'Choose a video' : 'No ready videos in your library yet'}</option>
            {videos.data?.items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.filename} · {formatDuration(a.duration_sec)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <ClipSettings value={settings} onChange={setSettings} disabled={start.isPending} rangeError={rangeError} />
      {apiError && (
        <p className="field-error" role="alert" data-testid="lumiclip-start-error">
          {apiError.message}
        </p>
      )}
      <Button type="submit" block loading={start.isPending} disabled={!can || !!rangeError || (source === 'library' && !cloudinary)} data-testid="lumiclip-start">
        <Rocket size={15} /> Find the best clips
      </Button>
    </form>
  )
}

function ProjectList({ items, loading, selected, onSelect }: { items?: LumiclipProject[]; loading: boolean; selected: string | null; onSelect: (id: string) => void }) {
  const del = useDeleteLumiclipProject()
  if (loading) return <Skeleton style={{ height: 120 }} />
  if (!items?.length) return null
  return (
    <section className="card sc-recent" data-testid="lumiclip-projects">
      <div className="card-heading">
        <h3>Recent</h3>
      </div>
      <ul>
        {items.map((p) => (
          <li key={p.id} data-selected={p.id === selected}>
            <button type="button" onClick={() => onSelect(p.id)} className="sc-recent-btn">
              <span className={cn('sc-pill', `st-${p.status}`)}>{p.status === 'completed' ? `${p.clips.length} clips` : p.status === 'failed' ? 'Failed' : 'Working…'}</span>
              <b title={p.source_url}>{hostOf(p.source_url)}</b>
              <small>
                {relativeTime(p.created_at)} · {p.aspect_ratio}
              </small>
            </button>
            <button type="button" className="icon-button" aria-label="Remove this project from the list" title="Remove from the list (saved clips stay in your library)" onClick={() => del.mutate(p.id)}>
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function hostOf(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.length > 1 ? u.pathname.slice(0, 24) : ''}`
  } catch {
    return url.slice(0, 40)
  }
}

function ProjectView({ id, onGone }: { id: string; onGone: () => void }) {
  const q = useLumiclipProject(id)
  const clips = useMemo(() => q.data?.clips ?? [], [q.data])
  if (q.isPending) return <Skeleton style={{ height: 280 }} />
  if (q.isError) {
    if (isApiError(q.error) && q.error.code === 'NOT_FOUND') {
      onGone()
      return null
    }
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} title="Could not load this project" />
  }
  const p = q.data
  return (
    <section className="card sc-project" data-testid="lumiclip-project" data-status={p.status}>
      <div className="card-heading">
        <div>
          <div className="eyebrow">{p.aspect_ratio} · {p.source_asset_id ? 'From your library' : 'From a link'}</div>
          <h2 title={p.source_url}>{hostOf(p.source_url)}</h2>
        </div>
        {p.source_duration_sec ? <span className="badge badge-gray">Source {formatDuration(p.source_duration_sec)}</span> : null}
      </div>
      <ProjectProgress project={p} />
      {p.status === 'completed' && clips.length === 0 && <EmptyState compact title="LumiClip found no clips in this video" description="Try a longer video, a different part of it, or another language setting." />}
      {clips.length > 0 && (
        <div className="sc-grid" data-testid="lumiclip-clips">
          {clips.map((c, i) => (
            <LumiClipCard key={c.id} project={p} clip={c} index={i} />
          ))}
        </div>
      )}
    </section>
  )
}

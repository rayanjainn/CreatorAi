'use client'

import Link from 'next/link'
import { use, useMemo, useState, type FormEvent } from 'react'
import { CalendarClock, ExternalLink, RotateCw, Upload, Video } from 'lucide-react'
import { Button, LinkButton } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { Thumb } from '@/components/common/thumb'
import { mediaUrl } from '@/lib/api/client'
import { errorMessage } from '@/lib/api/errors'
import { usePublish, usePublishDefaults, usePublishJobs, useRetryPublish, type PublishDefaults, type PublishJob } from '@/lib/api/publishing'
import { formatDuration } from '@/lib/format'
import { relativeTime } from '@/lib/time'
import { useProjectRole } from '@/lib/use-role'

const PRESET_LABEL: Record<string, string> = { yt_short: 'YouTube Short', yt_long: 'YouTube (16:9)', reels: 'Instagram Reels', tiktok: 'TikTok' }
const STATUS_LABEL: Record<PublishJob['status'], string> = {
  queued: 'Waiting to upload',
  uploading: 'Uploading',
  processing: 'Processing on YouTube',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
}

/** Publish: send a finished render to the connected YouTube channel, now or on a schedule. */
export default function PublishPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const defaults = usePublishDefaults(id)
  const jobs = usePublishJobs(id)
  const { canEdit } = useProjectRole(id)

  if (defaults.isPending) return <Skeleton style={{ height: 320 }} />
  if (defaults.isError) return <ErrorState error={defaults.error} onRetry={() => void defaults.refetch()} title="Could not load publishing" />
  const d = defaults.data
  const conn = d.connection

  return (
    <div className="stack" data-testid="publish-page">
      {!conn.connected ? (
        <section className="card" data-testid="publish-connect">
          <div className="card-heading">
            <div>
              <div className="eyebrow violet-text">Publish</div>
              <h2>{conn.configured ? 'Connect your YouTube channel first' : 'YouTube is not set up on this machine'}</h2>
            </div>
          </div>
          <p className="muted small">
            {conn.configured
              ? 'An admin connects the channel once in Settings. Until then you can still download every render from the Clips tab.'
              : 'Publishing needs a free Google OAuth client in .env. Settings explains the three steps. Until then you can download every render from the Clips tab.'}
          </p>
          <div className="mon-row" style={{ marginTop: 12 }}>
            <LinkButton href="/settings#youtube" size="sm">
              Open Settings
            </LinkButton>
            <LinkButton href={`/projects/${id}/clips`} size="sm" variant="secondary">
              Go to renders
            </LinkButton>
          </div>
        </section>
      ) : d.renders.length === 0 ? (
        <EmptyState
          icon={<Video size={22} />}
          title="No finished render yet"
          description="Render a clip as a YouTube Short or YouTube (16:9) in the Clips tab, then publish it here."
          actions={<LinkButton href={`/projects/${id}/clips`}>Open clips</LinkButton>}
        />
      ) : canEdit ? (
        <PublishForm itemId={id} d={d} />
      ) : (
        <p className="muted">You can view this project but not publish it.</p>
      )}

      <section className="stack">
        <div className="section-head">
          <div>
            <div className="eyebrow violet-text">History</div>
            <h2>Uploads</h2>
          </div>
        </div>
        {jobs.isPending ? (
          <Skeleton style={{ height: 80 }} />
        ) : jobs.data && jobs.data.length > 0 ? (
          jobs.data.map((j) => <JobRow key={j.id} itemId={id} job={j} canEdit={canEdit} />)
        ) : (
          <p className="muted small">Nothing published from this project yet.</p>
        )}
      </section>
    </div>
  )
}

function PublishForm({ itemId, d }: { itemId: string; d: PublishDefaults }) {
  const publish = usePublish(itemId)
  const publishable = d.renders.filter((r) => r.publishable)
  const [renderId, setRenderId] = useState(publishable[0]?.id ?? '')
  const render = d.renders.find((r) => r.id === renderId)
  const brands = useMemo(() => render?.sponsor_brands ?? [], [render])
  const disclosure = brands.length ? d.disclosure_template.replace('{brands}', brands.join(' and ')) : ''
  const [title, setTitle] = useState(d.title)
  const [description, setDescription] = useState(disclosure ? `${disclosure}\n\n${d.description}`.trim() : d.description)
  const [tags, setTags] = useState(d.tags.join(', '))
  const [visibility, setVisibility] = useState<PublishJob['visibility']>('private')
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState('')
  const missingDisclosure = !!disclosure && !description.includes(disclosure)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!renderId || !title.trim() || (when === 'later' && !at)) return
    publish.mutate({
      render_id: renderId,
      title: title.trim(),
      description,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      visibility: when === 'later' ? 'private' : visibility,
      scheduled_at: when === 'later' ? new Date(at).toISOString() : null,
    })
  }

  if (publishable.length === 0)
    return (
      <EmptyState
        compact
        icon={<Video size={22} />}
        title="Only download-only renders so far"
        description="Reels and TikTok renders are downloads. Render the clip as a YouTube Short or YouTube (16:9) to publish it."
        actions={<LinkButton href={`/projects/${itemId}/clips`}>Open clips</LinkButton>}
      />
    )

  return (
    <section className="card" data-testid="publish-form">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">Publish to {d.connection.channel_title || 'YouTube'}</div>
          <h2>Send a render to YouTube</h2>
        </div>
      </div>
      <form onSubmit={submit} className="mon-form" style={{ marginTop: 12 }}>
        <div className="pub-grid">
          <div className="pub-preview">
            {render?.preview_url ? (
              <video src={mediaUrl(render.preview_url) ?? undefined} poster={mediaUrl(render.thumbnail_url) ?? undefined} controls preload="none" />
            ) : (
              <Thumb src={render?.thumbnail_url} />
            )}
          </div>
          <div className="mon-form">
            <Field label="Render" htmlFor="pub-render">
              <Select id="pub-render" value={renderId} onChange={(e) => setRenderId(e.target.value)} data-testid="publish-render">
                {publishable.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.clip_title || 'Clip'} · {PRESET_LABEL[r.preset] ?? r.preset} · {formatDuration(r.duration_sec)}
                    {r.stale ? ' (older edit)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Title" htmlFor="pub-title" hint={`${title.length}/100`}>
              <Input id="pub-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required data-testid="publish-title" />
            </Field>
            {d.title_options.length > 1 && (
              <div className="pub-options small">
                {d.title_options.map((t) => (
                  <button key={t} type="button" className="chip" onClick={() => setTitle(t)}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <Field label="Description" htmlFor="pub-desc" hint={missingDisclosure ? undefined : `${description.length}/5000`} error={missingDisclosure ? `This clip contains a sponsor read. Keep "${disclosure}" in the description and tick "paid promotion" in YouTube Studio.` : null}>
          <Textarea id="pub-desc" rows={6} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} data-testid="publish-description" />
        </Field>
        <div className="mon-form-grid">
          <Field label="Tags" htmlFor="pub-tags" hint="Comma separated">
            <Input id="pub-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field label="When" htmlFor="pub-when">
            <Select id="pub-when" value={when} onChange={(e) => setWhen(e.target.value as 'now' | 'later')} data-testid="publish-when">
              <option value="now">Now</option>
              <option value="later">Schedule</option>
            </Select>
          </Field>
          {when === 'now' ? (
            <Field label="Visibility" htmlFor="pub-vis">
              <Select id="pub-vis" value={visibility} onChange={(e) => setVisibility(e.target.value as PublishJob['visibility'])} data-testid="publish-visibility">
                <option value="private">Private</option>
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
              </Select>
            </Field>
          ) : (
            <Field label="Goes public at" htmlFor="pub-at" hint="Uploaded as private until then">
              <Input id="pub-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required />
            </Field>
          )}
        </div>
        {publish.error && (
          <p className="field-error" role="alert">
            {errorMessage(publish.error)}
          </p>
        )}
        <div className="mon-row">
          <Button type="submit" loading={publish.isPending} disabled={!title.trim() || (when === 'later' && !at)} data-testid="publish-submit">
            {when === 'later' ? <CalendarClock size={14} /> : <Upload size={14} />} {when === 'later' ? 'Schedule upload' : 'Upload to YouTube'}
          </Button>
          <span className="muted small">The upload runs in the background; you can leave this page.</span>
        </div>
      </form>
    </section>
  )
}

function JobRow({ itemId, job, canEdit }: { itemId: string; job: PublishJob; canEdit: boolean }) {
  const retry = useRetryPublish(itemId)
  return (
    <article className="pub-job" data-testid="publish-job" data-status={job.status}>
      <div style={{ minWidth: 0 }}>
        <b>{job.title}</b>
        <p className="muted small">
          {STATUS_LABEL[job.status]}
          {job.status === 'scheduled' && job.scheduled_at ? ` for ${new Date(job.scheduled_at).toLocaleString()}` : ''}
          {job.status === 'published' && job.published_at ? ` ${relativeTime(job.published_at)}` : ''} · {job.visibility}
        </p>
        {job.error && <p className="field-error small">{job.error}</p>}
      </div>
      <div className="mon-row">
        {job.url && (
          <a className="button button-sm button-secondary" href={job.url} target="_blank" rel="noreferrer noopener">
            Watch <ExternalLink size={12} aria-hidden />
          </a>
        )}
        {job.studio_url && (
          <a className="button button-sm button-ghost" href={job.studio_url} target="_blank" rel="noreferrer noopener">
            Studio <ExternalLink size={12} aria-hidden />
          </a>
        )}
        {job.status === 'failed' && canEdit && (
          <Button size="sm" onClick={() => retry.mutate(job.id)} loading={retry.isPending}>
            <RotateCw size={13} /> Retry
          </Button>
        )}
        {job.status === 'failed' && job.error?.includes('Settings') && (
          <Link href="/settings#youtube" className="link small">
            Settings
          </Link>
        )}
      </div>
    </article>
  )
}

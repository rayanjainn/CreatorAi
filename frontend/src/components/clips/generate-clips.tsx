'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AlertTriangle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { useGenerateClips, useJob } from '@/lib/api/hooks'
import { isCode } from '@/lib/api/errors'
import { formatDuration } from '@/lib/format'
import { useJobs } from '@/stores/jobs'
import { useProjectUi } from '@/stores/project-ui'
import { longestReadyVideo } from '@/lib/library'
import type { Asset } from '@/lib/api/types'

/** Generate clips from the primary (or chosen) video, with job progress and result warnings. */
export function GenerateClips({ projectId, assets }: { projectId: string; assets: Asset[] }) {
  const gen = useGenerateClips(projectId)
  const videos = assets.filter((a) => a.kind === 'video' && a.status === 'ready')
  const primary = useProjectUi((s) => s.primary[projectId])
  const hydrate = useProjectUi((s) => s.hydrate)
  useEffect(() => {
    hydrate()
  }, [hydrate])
  const [count, setCount] = useState(4)
  const [full, setFull] = useState(false)
  const [source, setSource] = useState('')
  const defaultSource = videos.find((v) => v.id === primary)?.id ?? longestReadyVideo(assets)?.id ?? ''
  const chosen = source || defaultSource
  const jobId = gen.data?.job_id
  const job = useJob(jobId)
  const live = useJobs((s) => (jobId ? s.jobs[jobId] : undefined))
  const status = live?.status ?? job.data?.status
  const running = gen.isPending || status === 'queued' || status === 'running'
  const progress = Math.round(live?.progress ?? job.data?.progress ?? 0)
  const result = (job.data?.result ?? {}) as { warnings?: string[]; kept?: number }
  const err = gen.error

  return (
    <section className="card" data-testid="generate-clips">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">Smart clips</div>
          <h2>Find the best moments</h2>
        </div>
      </div>
      <p className="muted small" style={{ margin: '6px 0 14px' }}>
        Scores every window of your footage with rules (speech rate, hook words, energy, script match) and keeps the best. Works without an AI key: the copy then comes from your transcript.
      </p>
      <div className="gen-grid">
        <label className="field">
          <span className="field-label">Source video</span>
          <Select value={chosen} onChange={(e) => setSource(e.target.value)} disabled={videos.length === 0} aria-label="Source video" data-testid="clip-source">
            {videos.length === 0 && <option value="">No ready video</option>}
            {videos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.filename} ({formatDuration(v.duration_sec)}){v.id === defaultSource ? ' · primary' : ''}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span className="field-label">How many</span>
          <Select value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Number of clips">
            {[1, 2, 3, 4, 5, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        <label className="check">
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Also make a full cut (16:9, all speech)
        </label>
        <Button onClick={() => gen.mutate({ asset_id: chosen || null, count, include_full_cut: full })} loading={running} disabled={videos.length === 0} data-testid="generate-clips-btn">
          <Sparkles size={14} /> {running ? `Working ${progress}%` : 'Generate clips'}
        </Button>
      </div>
      {videos.length === 0 && (
        <p className="muted small" style={{ marginTop: 10 }}>
          Upload and process a video first. <Link href={`/projects/${projectId}/footage`} className="link">Go to footage</Link>
        </p>
      )}
      {isCode(err, 'ASSET_NOT_READY') && (
        <div className="notice notice-amber mt" role="alert">
          <div className="stat-icon amber">
            <AlertTriangle size={15} />
          </div>
          <div className="notice-body">
            <b>No processed video to cut</b>
            <p>{err.message}</p>
          </div>
        </div>
      )}
      {running && jobId && (
        <div style={{ marginTop: 14 }} role="status" data-testid="clips-progress">
          <div className="progress-label" style={{ marginTop: 0 }}>
            <span>Generating clips{live?.stage ? ` · ${live.stage}` : ''}</span>
            <b>{progress}%</b>
          </div>
          <div className="progress">
            <i style={{ width: `${Math.max(4, progress)}%` }} />
          </div>
        </div>
      )}
      {status === 'failed' && (
        <div className="notice notice-red mt" role="alert">
          <div className="notice-body">
            <b>Clip generation failed</b>
            <p>{job.data?.error ?? live?.error ?? 'Unknown error.'}</p>
          </div>
        </div>
      )}
      {status === 'succeeded' && (result.warnings?.length ?? 0) > 0 && (
        <div className="notice notice-amber mt" data-testid="clips-warnings">
          <div className="stat-icon amber">
            <AlertTriangle size={15} />
          </div>
          <div className="notice-body">
            <b>Finished with notes</b>
            {result.warnings!.map((w) => (
              <p key={w}>{w.startsWith('COPY_FALLBACK') ? 'No AI provider answered, so titles, hooks and captions were taken from the transcript (fallback copy).' : w.startsWith('SHORT_FOOTAGE') ? 'Your footage is short, so the minimum clip length was lowered.' : w}</p>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

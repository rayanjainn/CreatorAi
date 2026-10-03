'use client'

import { useState } from 'react'
import { Activity as ActivityIcon, Ban, CheckCircle2, CircleAlert, Clock3, RotateCw, XCircle } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Segmented } from '@/components/common/segmented'
import { useActivity, useCancelJob, useJobs, useRetryJob } from '@/lib/api/hooks'
import type { Job } from '@/lib/api/types'
import { actionLabel, jobLabel } from '@/lib/format'
import { formatDateTime, relativeTime } from '@/lib/time'
import { isTerminal } from '@/lib/sse'

const TONE: Record<string, { cls: string; label: string; Icon: typeof Clock3 }> = {
  queued: { cls: 'badge-gray', label: 'Queued', Icon: Clock3 },
  running: { cls: '', label: 'Running', Icon: ActivityIcon },
  succeeded: { cls: 'badge-green', label: 'Done', Icon: CheckCircle2 },
  failed: { cls: 'badge-red', label: 'Failed', Icon: XCircle },
  canceled: { cls: 'badge-gray', label: 'Canceled', Icon: Ban },
}

function JobRow({ job }: { job: Job }) {
  const cancel = useCancelJob()
  const retry = useRetryJob()
  const tone = TONE[job.status] ?? TONE.queued
  const live = !isTerminal(job.status)
  return (
    <div className="job-row" data-testid="job-row" data-status={job.status}>
      <div className="activity-dot">
        <tone.Icon size={15} />
      </div>
      <div style={{ minWidth: 0 }}>
        <b>{jobLabel(job.type)}</b>
        <small className="truncate" title={job.finished_at ? formatDateTime(job.finished_at) : undefined}>
          {job.type} · {job.stage || 'waiting'} ·{' '}
          {job.finished_at ? `finished ${relativeTime(job.finished_at)}` : `started ${relativeTime(job.started_at ?? job.created_at)}`}
        </small>
      </div>
      <div>
        {live ? (
          <>
            <div className="progress" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${job.progress}%` }} />
            </div>
            <small style={{ display: 'block', marginTop: 5 }}>{job.progress}%</small>
          </>
        ) : (
          <span className={`badge ${tone.cls}`}>{tone.label}</span>
        )}
      </div>
      <div>
        {live && (
          <Button size="sm" variant="secondary" onClick={() => cancel.mutate(job.id)} loading={cancel.isPending}>
            Cancel
          </Button>
        )}
        {job.status === 'failed' && (
          <Button size="sm" variant="secondary" onClick={() => retry.mutate(job.id)} loading={retry.isPending}>
            <RotateCw size={13} /> Retry
          </Button>
        )}
      </div>
      {job.status === 'failed' && job.error && (
        <div className="job-error" role="note">
          <CircleAlert size={12} style={{ display: 'inline', marginRight: 6 }} />
          {job.error}
        </div>
      )}
    </div>
  )
}

export default function JobsPage() {
  const [filter, setFilter] = useState<'all' | 'active' | 'failed'>('all')
  const jobs = useJobs({ limit: 100 }, 4000)
  const activity = useActivity({ limit: 50 })

  const list = (jobs.data ?? []).filter((j) => (filter === 'all' ? true : filter === 'active' ? !isTerminal(j.status) : j.status === 'failed'))

  return (
    <div className="page">
      <PageHeader eyebrow="CreatorAI / System" title="Jobs & Activity" description="Everything running in the background, and a log of what changed. Jobs refresh every few seconds." />
      <div className="split-2">
        <section className="card" aria-labelledby="jobs-h">
          <div className="card-heading">
            <h2 id="jobs-h">Jobs</h2>
            <Segmented
              label="Filter jobs"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'failed', label: 'Failed' },
              ]}
            />
          </div>
          <div style={{ marginTop: 8 }}>
            {jobs.isPending ? (
              [0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 52, margin: '12px 0' }} />)
            ) : jobs.isError ? (
              <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} title="Could not load jobs" />
            ) : list.length === 0 ? (
              <EmptyState compact icon={<ActivityIcon size={20} />} title={filter === 'all' ? 'No jobs yet' : 'Nothing here'} description="Uploads, matching, clip generation and renders appear here while they run." />
            ) : (
              list.map((j) => <JobRow key={j.id} job={j} />)
            )}
          </div>
        </section>

        <section className="card" aria-labelledby="act-h">
          <div className="card-heading">
            <h2 id="act-h">Activity log</h2>
            <small>{activity.data ? `${activity.data.total} entries` : ''}</small>
          </div>
          <div style={{ marginTop: 8 }}>
            {activity.isPending ? (
              [0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: 40, margin: '10px 0' }} />)
            ) : activity.isError ? (
              <ErrorState error={activity.error} onRetry={() => activity.refetch()} title="Could not load activity" />
            ) : activity.data.items.length === 0 ? (
              <EmptyState compact title="No activity yet" description="Creating, moving and editing content is logged here." />
            ) : (
              activity.data.items.map((a) => (
                <div key={a.id} className="mini-row" data-testid="activity-row">
                  <div className="activity-dot">
                    <ActivityIcon size={14} />
                  </div>
                  <div>
                    <b>{actionLabel(a.action)}</b>
                    <small className="truncate">
                      {(a.meta?.title as string | undefined) ?? a.entity_type}
                      {a.action === 'stage_moved' && a.meta?.from ? ` · ${String(a.meta.from)} → ${String(a.meta.to)}` : ''}
                    </small>
                  </div>
                  <small title={formatDateTime(a.created_at)}>{relativeTime(a.created_at)}</small>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

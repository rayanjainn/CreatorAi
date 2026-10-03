'use client'

import Link from 'next/link'
import { use } from 'react'
import { AlertTriangle, Play, SplitSquareHorizontal } from 'lucide-react'
import { CoverageBar } from '@/components/match/coverage-bar'
import { ScriptFootageView } from '@/components/match/script-footage-view'
import { MissingScenes } from '@/components/match/missing-scenes'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { Button, LinkButton } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useContentItem, useMatch, useRunMatch } from '@/lib/api/hooks'
import { isCode } from '@/lib/api/errors'
import { useJobs } from '@/stores/jobs'
import type { Card } from '@/lib/api/types'

export default function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const item = useContentItem(id)
  const card = item.data as Card | undefined
  const match = useMatch(id, { enabled: !!card?.progress.has_script })
  const run = useRunMatch(id)
  const liveJob = useJobs((s) => (match.data?.job ? s.jobs[match.data.job.id] : undefined))

  if (item.isPending || match.isLoading) return <Skeleton style={{ height: 300, borderRadius: 15 }} />
  if (item.isError) return <ErrorState error={item.error} onRetry={() => item.refetch()} />
  if (match.isError) return <ErrorState error={match.error} onRetry={() => match.refetch()} title="Could not load matching" />
  if (!card?.progress.has_script) {
    return (
      <EmptyState
        icon={<SplitSquareHorizontal size={22} />}
        title="Write a script first"
        description="Matching maps every beat of your script to the footage that says it. There is no script for this project yet."
        actions={<LinkButton href={`/projects/${id}/script`}>Go to the script</LinkButton>}
      />
    )
  }
  const m = match.data
  const job = m?.job
  const status = liveJob?.status ?? job?.status
  const running = status === 'queued' || status === 'running'
  const progress = Math.round(liveJob?.progress ?? job?.progress ?? 0)
  const stage = liveJob?.stage ?? job?.stage

  const runButton = (label: string) => (
    <Button onClick={() => run.mutate()} loading={run.isPending || running} data-testid="run-match">
      <Play size={14} /> {running ? `Matching ${progress}%` : label}
    </Button>
  )

  const err = run.error
  return (
    <div className="stack" data-testid="match-page">
      {isCode(err, 'NO_SCRIPT', 'ASSET_NOT_READY') && (
        <div className="notice notice-amber" role="alert" data-testid="match-error">
          <div className="stat-icon amber">
            <AlertTriangle size={15} />
          </div>
          <div className="notice-body">
            <b>{isCode(err, 'ASSET_NOT_READY') ? 'No processed footage with a transcript yet' : 'This script has no scenes'}</b>
            <p>{err.message}</p>
            <div className="notice-actions">
              <Link href={`/projects/${id}/${isCode(err, 'ASSET_NOT_READY') ? 'footage' : 'script'}`} className="button button-secondary button-sm">
                {isCode(err, 'ASSET_NOT_READY') ? 'Go to footage' : 'Go to script'}
              </Link>
            </div>
          </div>
        </div>
      )}
      {job?.status === 'failed' && (
        <div className="notice notice-red" role="alert">
          <div className="notice-body">
            <b>The last matching run failed</b>
            <p>{job.error}</p>
          </div>
        </div>
      )}
      {running && (
        <div className="card tight" role="status" data-testid="match-progress">
          <div className="progress-label" style={{ marginTop: 0 }}>
            <span>Matching script to footage{stage ? ` · ${stage}` : ''}</span>
            <b>{progress}%</b>
          </div>
          <div className="progress">
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {!m || !m.ran ? (
        <EmptyState
          icon={<SplitSquareHorizontal size={22} />}
          title="Not matched yet"
          description="Matching never runs on its own after you edit the script. Press the button when your footage is processed and the script is ready."
          actions={runButton('Run matching')}
        />
      ) : (
        <>
          <section className="card">
            <div className="card-heading">
              <div>
                <div className="eyebrow violet-text">Script ↔ footage · script v{m.script_version}</div>
                <h2>Coverage</h2>
              </div>
              {runButton('Re-run matching')}
            </div>
            <CoverageBar match={m} />
            {m.job?.notes && m.job.notes.length > 0 && (
              <ul className="bullets" style={{ marginTop: 12 }}>
                {m.job.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </section>
          <MissingScenes missing={m.missing_scenes} weak={m.weak_scenes} />
          <section className="card">
            <div className="card-heading">
              <div>
                <div className="eyebrow violet-text">Beat by beat</div>
                <h2>Script and footage</h2>
              </div>
            </div>
            <ScriptFootageView beats={m.beats} projectId={id} />
          </section>
        </>
      )}
    </div>
  )
}

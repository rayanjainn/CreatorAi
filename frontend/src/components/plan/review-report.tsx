'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, Crosshair, Lightbulb, RefreshCw } from 'lucide-react'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { LlmNotice, isLlmError } from '@/components/common/llm-notice'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { ScoreRing } from './score-ring'
import { useReview, useReviewVersions, useRunReview } from '@/lib/api/hooks'
import { isCode } from '@/lib/api/errors'
import { formatTimecode } from '@/lib/format'
import { relativeTime } from '@/lib/time'
import type { ReviewIssue, ReviewScoreKey } from '@/lib/api/types'

const SCORES: { key: ReviewScoreKey; label: string; hint: string }[] = [
  { key: 'hook', label: 'Hook', hint: 'Does the opening grab attention in the first seconds?' },
  { key: 'clarity', label: 'Clarity', hint: 'Filler words and rambling lower this.' },
  { key: 'pacing', label: 'Pacing', hint: 'Words per minute and long silences.' },
  { key: 'coverage', label: 'Coverage', hint: 'How much of the script your footage actually says.' },
  { key: 'cta', label: 'Call to action', hint: 'Is there a clear ask at the end?' },
]

const SEVERITY: Record<string, string> = { high: 'badge-red', medium: 'badge-amber', low: 'badge-gray' }

/**
 * Director review. Scores are computed by rules from the transcript (never by the model); only the wording
 * (strengths, fixes, suggestions) is AI. The two badges make that split explicit.
 */
export function ReviewReport({ projectId, hasReview, onGoTo }: { projectId: string; hasReview: boolean; onGoTo: (assetId: string, sec: number) => void }) {
  const [version, setVersion] = useState<number | undefined>()
  const run = useRunReview(projectId)
  const review = useReview(projectId, version, hasReview || !!run.data)
  const versions = useReviewVersions(projectId)
  const latest = versions.data?.[0]?.version
  const r = review.data

  const runButton = (label: string, primary?: boolean) => (
    <Button variant={primary ? 'primary' : 'secondary'} size="sm" loading={run.isPending} onClick={() => run.mutate(undefined, { onSuccess: () => setVersion(undefined) })} data-testid="run-review">
      <RefreshCw size={13} /> {label}
    </Button>
  )
  const err = run.error

  return (
    <section className="card review" id="review" data-testid="review-report">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">Director review</div>
          <h2>How does the footage hold up?</h2>
        </div>
        <div className="page-actions">
          {(versions.data?.length ?? 0) > 1 && (
            <Select aria-label="Review version" value={version ?? latest ?? ''} onChange={(e) => setVersion(Number(e.target.value) === latest ? undefined : Number(e.target.value))} style={{ width: 150, minHeight: 32, fontSize: 12 }}>
              {versions.data!.map((v) => (
                <option key={v.id} value={v.version}>
                  v{v.version} · {Math.round(v.overall_score)}
                </option>
              ))}
            </Select>
          )}
          {r && runButton('Re-run review')}
        </div>
      </div>

      {isLlmError(err) && <LlmNotice error={err} onRetry={() => run.mutate()} className="mt" />}
      {isCode(err, 'ASSET_NOT_READY') && (
        <div className="notice notice-amber mt" role="alert" data-testid="review-not-ready">
          <div className="stat-icon amber">
            <AlertTriangle size={15} />
          </div>
          <div className="notice-body">
            <b>There is nothing to review yet</b>
            <p>{err.message}</p>
            <div className="notice-actions">
              <Link href={`/projects/${projectId}/footage`} className="button button-secondary button-sm">
                Go to footage
              </Link>
            </div>
          </div>
        </div>
      )}

      {review.isLoading ? (
        <Skeleton style={{ height: 180, marginTop: 14 }} />
      ) : review.isError ? (
        <ErrorState error={review.error} onRetry={() => review.refetch()} title="Could not load the review" />
      ) : !r ? (
        <EmptyState
          compact
          icon={<ClipboardCheck size={20} />}
          title="No review yet"
          description="Once your footage is processed, the Director scores the hook, clarity, pacing, coverage and call to action, and points at the exact seconds to fix."
          actions={runButton('Run review', true)}
        />
      ) : (
        <div className="review-body">
          <div className="review-top">
            <div className="review-overall">
              <ScoreRing value={r.overall_score} size={96} stroke={8} label="Overall score" />
              <div>
                <b>Overall</b>
                <small>
                  v{r.version} · {relativeTime(r.created_at)}
                </small>
              </div>
            </div>
            <div className="score-bars">
              {SCORES.map((s) => {
                const v = r.scores[s.key]
                return (
                  <div key={s.key} className="score-bar" title={s.hint} data-testid={`score-${s.key}`} data-value={v ?? 'unknown'}>
                    <span>{s.label}</span>
                    <div className="progress">
                      <i style={{ width: `${v ?? 0}%`, background: v == null ? 'transparent' : undefined }} />
                    </div>
                    <b className="mono">{v == null ? 'unknown' : Math.round(v)}</b>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="review-prov" data-testid="review-provenance">
            <span>
              <ProvenanceBadge {...(r.provenance_by_part.scores ?? { source: 'heuristic' })} label="Scores" /> computed by rules from the transcript
            </span>
            <span>
              <ProvenanceBadge {...(r.provenance_by_part.text ?? r.provenance)} label="Wording" /> strengths, fixes and suggestions
            </span>
          </div>

          {r.warnings.map((w) => (
            <div key={w.code + (w.message ?? '')} className="notice notice-amber" data-testid={`review-warning-${w.code}`}>
              <div className="stat-icon amber">
                <AlertTriangle size={15} />
              </div>
              <div className="notice-body">
                <b>{w.code === 'COVERAGE_UNKNOWN' ? 'Coverage is unknown' : w.code === 'NO_SCRIPT' ? 'No script to compare against' : w.code.replace(/_/g, ' ').toLowerCase()}</b>
                <p>{w.message}</p>
                {w.code === 'COVERAGE_UNKNOWN' && (
                  <div className="notice-actions">
                    <Link href={`/projects/${projectId}/match`} className="button button-secondary button-sm">
                      Run matching
                    </Link>
                  </div>
                )}
              </div>
            </div>
          ))}

          <div className="review-cols">
            <div>
              <h3 className="sub-h">
                <CheckCircle2 size={12} /> Strengths
              </h3>
              <ul className="bullets good">{r.strengths.length ? r.strengths.map((s) => <li key={s}>{s}</li>) : <li className="muted">Nothing stood out yet.</li>}</ul>
            </div>
            <div>
              <h3 className="sub-h">
                <Lightbulb size={12} /> Suggestions
              </h3>
              <ul className="bullets">{r.suggestions.length ? r.suggestions.map((s) => <li key={s}>{s}</li>) : <li className="muted">No suggestions.</li>}</ul>
            </div>
          </div>

          <div>
            <h3 className="sub-h">Issues ({r.issues.length})</h3>
            {r.issues.length === 0 ? (
              <p className="muted small">No issues found.</p>
            ) : (
              <ul className="issue-list">
                {r.issues.map((i, n) => (
                  <IssueRow key={n} issue={i} onGoTo={onGoTo} />
                ))}
              </ul>
            )}
          </div>

          {r.missing_scenes.length > 0 && (
            <div>
              <h3 className="sub-h">Missing scenes</h3>
              <ul className="issue-list">
                {r.missing_scenes.map((m, n) => (
                  <li key={n} className="issue">
                    <div className="issue-main">
                      <b>{m.title ?? (m.scene_idx !== undefined ? `Scene ${m.scene_idx + 1}` : 'Missing')}</b>
                      <p>{m.text ?? m.beats?.[0]}</p>
                      {m.suggestion && <small>{m.suggestion}</small>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function IssueRow({ issue, onGoTo }: { issue: ReviewIssue; onGoTo: (assetId: string, sec: number) => void }) {
  const canJump = !!issue.asset_id && issue.asset_sec != null
  return (
    <li className="issue" data-testid="review-issue">
      <span className={`badge ${SEVERITY[issue.severity] ?? 'badge-gray'}`}>{issue.severity}</span>
      <div className="issue-main">
        <b style={{ textTransform: 'capitalize' }}>{issue.type}</b>
        {issue.fix && <p>{issue.fix}</p>}
        <small>
          {issue.at_sec != null && <span className="mono">at {formatTimecode(issue.at_sec)} in the edit</span>}
          {issue.scene_idx != null && <span> · scene {issue.scene_idx + 1}</span>}
        </small>
      </div>
      {canJump && (
        <Button variant="secondary" size="sm" onClick={() => onGoTo(issue.asset_id!, issue.asset_sec!)} data-testid="issue-goto">
          <Crosshair size={12} /> Go to {formatTimecode(issue.asset_sec)}
        </Button>
      )}
    </li>
  )
}

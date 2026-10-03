'use client'

import { useQueries } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { ScoreRing } from '@/components/plan/score-ring'
import { HubRow, HubSkeleton } from '@/components/hubs/project-hub-row'
import { useProjects } from '@/components/hubs/use-projects'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { LinkButton } from '@/components/ui/button'
import { fetchPlan, fetchReview, qk } from '@/lib/api/hooks'

/** Hub: every project with its latest Director plan and review score. The work itself happens in /projects/[id]/plan. */
export default function CreativeDirectorPage() {
  const { board, cards } = useProjects()
  const withPlan = cards.filter((c) => c.progress.has_plan)
  const plans = useQueries({ queries: withPlan.map((c) => ({ queryKey: qk.plan(c.id), queryFn: () => fetchPlan(c.id) })) })
  const withReview = cards.filter((c) => c.progress.has_review)
  const reviews = useQueries({ queries: withReview.map((c) => ({ queryKey: qk.review(c.id), queryFn: () => fetchReview(c.id) })) })
  const planOf = (id: string) => plans[withPlan.findIndex((c) => c.id === id)]?.data
  const reviewOf = (id: string) => reviews[withReview.findIndex((c) => c.id === id)]?.data

  return (
    <div className="page">
      <PageHeader eyebrow="CreatorAI / AI tools" title="Creative Director" description="Every project with its latest plan and review. Open one to generate a plan, edit the shot list or re-run the review." />
      {board.isPending ? (
        <HubSkeleton />
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => board.refetch()} />
      ) : cards.length === 0 ? (
        <EmptyState icon={<Bot size={22} />} title="No projects yet" description="Create a project, then ask the Director for a plan." actions={<LinkButton href="/projects">Go to projects</LinkButton>} />
      ) : (
        <ul className="hub-list" data-testid="director-hub">
          {cards.map((c) => {
            const plan = planOf(c.id)
            const review = reviewOf(c.id)
            return (
              <HubRow
                key={c.id}
                card={c}
                testId="hub-row"
                links={[
                  { href: `/projects/${c.id}/plan`, label: c.progress.has_plan ? 'Open plan' : 'Make a plan' },
                  { href: `/projects/${c.id}/plan#review`, label: c.progress.has_review ? 'Open review' : 'Review' },
                ]}
              >
                {c.progress.has_plan ? (
                  <p className="hub-text">
                    <span className="muted">Plan v{plan?.version ?? '…'}:</span> {plan?.plan.angle ?? ''} {plan && <ProvenanceBadge {...plan.provenance} />}
                  </p>
                ) : (
                  <p className="hub-text muted">No plan yet.</p>
                )}
                <div className="hub-score">
                  {review ? (
                    <>
                      <ScoreRing value={review.overall_score} size={38} stroke={4} label="Review score" />
                      <span className="muted small">Review v{review.version}</span>
                      <ProvenanceBadge {...review.provenance} />
                    </>
                  ) : (
                    <span className="muted small">{c.progress.has_review ? 'Loading review…' : 'Not reviewed'}</span>
                  )}
                </div>
              </HubRow>
            )
          })}
        </ul>
      )}
    </div>
  )
}

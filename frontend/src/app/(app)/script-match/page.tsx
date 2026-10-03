'use client'

import { useQueries } from '@tanstack/react-query'
import { SplitSquareHorizontal } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { HubRow, HubSkeleton } from '@/components/hubs/project-hub-row'
import { useProjects } from '@/components/hubs/use-projects'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { LinkButton } from '@/components/ui/button'
import { fetchMatch, qk } from '@/lib/api/hooks'

/** Hub: match coverage of every project that has a script. */
export default function ScriptMatchPage() {
  const { board, cards } = useProjects()
  const scripted = cards.filter((c) => c.progress.has_script)
  const matches = useQueries({ queries: scripted.map((c) => ({ queryKey: qk.match(c.id), queryFn: () => fetchMatch(c.id) })) })

  return (
    <div className="page">
      <PageHeader eyebrow="CreatorAI / AI tools" title="Script Match" description="How much of each script your footage covers. Matching only runs when you press the button inside a project." />
      {board.isPending ? (
        <HubSkeleton />
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => board.refetch()} />
      ) : scripted.length === 0 ? (
        <EmptyState icon={<SplitSquareHorizontal size={22} />} title="No scripts to match" description="Write a script in a project first, add footage, then run matching." actions={<LinkButton href="/projects">Go to projects</LinkButton>} />
      ) : (
        <ul className="hub-list" data-testid="match-hub">
          {scripted.map((c, i) => {
            const m = matches[i]?.data
            const pct = m?.ran ? m.coverage.coverage_pct : null
            return (
              <HubRow key={c.id} card={c} testId="hub-row" links={[{ href: `/projects/${c.id}/match`, label: m?.ran ? 'Open matching' : 'Run matching' }, { href: `/projects/${c.id}/footage`, label: 'Footage' }]}>
                {matches[i]?.isPending ? (
                  <p className="hub-text muted">Loading…</p>
                ) : m?.ran ? (
                  <div className="hub-cov">
                    <div className="coverage-bar" role="img" aria-label={`Coverage ${Math.round(pct ?? 0)} percent`} style={{ maxWidth: 360 }}>
                      <div style={{ width: `${pct ?? 0}%`, background: 'var(--green)' }} />
                    </div>
                    <b className="mono" data-testid="hub-coverage">{pct == null ? '–' : `${Math.round(pct)}%`}</b>
                    <span className="muted small">
                      {m.coverage.matched + m.coverage.confirmed} matched · {m.coverage.weak} weak · {m.coverage.missing} missing
                    </span>
                    <ProvenanceBadge {...m.provenance} />
                  </div>
                ) : (
                  <p className="hub-text muted">Not matched yet.</p>
                )}
              </HubRow>
            )
          })}
        </ul>
      )}
    </div>
  )
}

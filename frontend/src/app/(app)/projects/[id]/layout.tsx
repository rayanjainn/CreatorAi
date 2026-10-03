'use client'

import Link from 'next/link'
import { use } from 'react'
import { usePathname } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useContentItem } from '@/lib/api/hooks'
import { StageBadge } from '@/components/common/stage-badge'
import { ProgressRing } from '@/components/common/progress-ring'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { ErrorState } from '@/components/common/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { isApiError } from '@/lib/api/errors'
import { isDemoTitle, stripDemo } from '@/lib/format'
import type { Stage } from '@/lib/api/types'
import { LinkButton } from '@/components/ui/button'
import { EmptyState } from '@/components/common/empty-state'

const TABS = ['plan', 'script', 'footage', 'match', 'clips', 'sponsors', 'publish']

/**
 * Project shell (header + tabs) shared by every /projects/[id]/* page. Later build steps replace the
 * tab pages; keep this layout (title, stage, progress, tabs).
 */
export default function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const pathname = usePathname()
  const item = useContentItem(id)

  if (item.isError && isApiError(item.error) && item.error.status === 404) {
    return (
      <div className="page">
        <EmptyState title="Project not found" description="It may have been deleted." actions={<LinkButton href="/projects">Back to projects</LinkButton>} />
      </div>
    )
  }

  return (
    <div className="page" style={{ gap: 18 }}>
      <div>
        <Link href="/projects" className="button button-ghost button-sm" style={{ marginLeft: -10 }}>
          <ArrowLeft size={14} /> Projects
        </Link>
      </div>
      {item.isPending ? (
        <Skeleton style={{ height: 70 }} />
      ) : item.isError ? (
        <ErrorState error={item.error} onRetry={() => item.refetch()} title="Could not load this project" />
      ) : (
        <header style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <StageBadge stage={item.data.stage as Stage} />
              {isDemoTitle(item.data.title) && <ProvenanceBadge source="demo" />}
            </div>
            <h1 style={{ fontSize: 'clamp(24px, 3vw, 32px)', letterSpacing: '-0.035em', lineHeight: 1.1 }} data-testid="project-title">
              {stripDemo(item.data.title)}
            </h1>
          </div>
          <ProgressRing percent={item.data.progress.percent} />
        </header>
      )}
      <nav className="tabs-bar" aria-label="Project sections">
        {TABS.map((t) => (
          <Link key={t} href={`/projects/${id}/${t}`} className="tab-link" aria-current={pathname.endsWith(`/${t}`) ? 'page' : undefined} style={{ textTransform: 'capitalize' }}>
            {t}
          </Link>
        ))}
      </nav>
      <div className="project-body">{children}</div>
    </div>
  )
}

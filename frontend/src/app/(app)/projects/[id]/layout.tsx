'use client'

import Link from 'next/link'
import { use } from 'react'
import { usePathname } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useContentItem } from '@/lib/api/hooks'
import { ProjectHeader } from '@/components/projects/project-header'
import { ErrorState } from '@/components/common/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { isApiError } from '@/lib/api/errors'
import type { Card } from '@/lib/api/types'
import { LinkButton } from '@/components/ui/button'
import { EmptyState } from '@/components/common/empty-state'

const TABS = ['plan', 'script', 'footage', 'match', 'clips', 'sponsors', 'research', 'publish']

/**
 * Project shell (header + tabs) shared by every /projects/[id]/* page.
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
        <ProjectHeader item={item.data as Card} />
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

import type { ReactNode } from 'react'
import { Hammer } from 'lucide-react'
import { PageHeader } from './page-header'
import { EmptyState } from './empty-state'

/**
 * Placeholder for routes that a later build step will implement for real.
 * The route, shell and breadcrumb already exist; replace the body, keep the route.
 */
export function ComingNext({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="page" data-testid="coming-next">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <EmptyState
        icon={<Hammer size={22} />}
        title="Coming in the next build step"
        description="The API for this feature is already in the backend. This screen is being built next and shows no sample data in the meantime."
        actions={children}
      />
    </div>
  )
}

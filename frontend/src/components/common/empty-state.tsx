import type { ReactNode } from 'react'
import { AlertCircle, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'

export function EmptyState({
  icon,
  title,
  description,
  actions,
  compact,
  tone,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  actions?: ReactNode
  compact?: boolean
  tone?: 'default' | 'error'
  className?: string
}) {
  return (
    <div className={cn('empty-state', tone === 'error' && 'error', compact && 'compact', className)} role={tone === 'error' ? 'alert' : undefined}>
      <div className="empty-icon">{icon ?? (tone === 'error' ? <AlertCircle size={22} /> : <Inbox size={22} />)}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  )
}

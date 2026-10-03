'use client'

import { RotateCw } from 'lucide-react'
import { EmptyState } from './empty-state'
import { Button } from '@/components/ui/button'
import { errorMessage, isApiError } from '@/lib/api/errors'

/** Inline query-failure state with a retry button. */
export function ErrorState({ error, onRetry, title = 'Could not load this' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const net = isApiError(error) && error.code === 'NETWORK_ERROR'
  return (
    <EmptyState
      tone="error"
      title={net ? 'The API is not reachable' : title}
      description={errorMessage(error)}
      actions={
        onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RotateCw size={14} /> Try again
          </Button>
        )
      }
    />
  )
}

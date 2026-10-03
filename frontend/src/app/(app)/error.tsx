'use client'

import { useEffect } from 'react'
import { RotateCw } from 'lucide-react'
import { EmptyState } from '@/components/common/empty-state'
import { Button, LinkButton } from '@/components/ui/button'

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div className="page">
      <EmptyState
        tone="error"
        title="Something broke on this page"
        description={error.message || 'An unexpected error occurred. Your data is safe; try again.'}
        actions={
          <>
            <Button onClick={reset}>
              <RotateCw size={14} /> Try again
            </Button>
            <LinkButton href="/dashboard" variant="secondary">
              Back to dashboard
            </LinkButton>
          </>
        }
      />
    </div>
  )
}

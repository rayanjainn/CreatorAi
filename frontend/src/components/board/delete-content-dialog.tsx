'use client'

import { useQuery } from '@tanstack/react-query'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { previewDelete, useDeleteContent } from '@/lib/api/hooks'
import { errorMessage } from '@/lib/api/errors'
import type { Card } from '@/lib/api/types'
import { stripDemo } from '@/lib/format'

/**
 * Two-step delete matching the API contract: DELETE without `confirm` returns 409 CONFIRMATION_REQUIRED
 * with the cascade counts, which we show; confirming repeats the call with `confirm=true`.
 */
export function DeleteContentDialog({ card, onClose }: { card: Card | null; onClose: () => void }) {
  const del = useDeleteContent()
  const id = card?.id
  const preview = useQuery({
    queryKey: ['delete-preview', id],
    queryFn: () => previewDelete(id!),
    enabled: !!id,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    meta: { silent: true },
  })
  const cascade = preview.data

  return (
    <ConfirmDialog
      open={!!card}
      onOpenChange={(o) => !o && onClose()}
      title="Delete this content?"
      description={card ? <>“{stripDemo(card.title)}” and everything planned for it will be removed. This can not be undone.</> : undefined}
      confirmLabel="Delete"
      danger
      loading={del.isPending}
      onConfirm={() => card && del.mutate(card.id, { onSuccess: onClose })}
    >
      {preview.isError ? (
        <p className="field-error">{errorMessage(preview.error)}</p>
      ) : cascade ? (
        <div className="cascade-list" data-testid="cascade">
          <div>
            <span>Scripts</span>
            <b>{cascade.scripts ?? 0}</b>
          </div>
          <div>
            <span>Plans and reviews</span>
            <b>{cascade.director_outputs ?? 0}</b>
          </div>
          <div>
            <span>Clips</span>
            <b>{cascade.clips ?? 0}</b>
          </div>
          <div>
            <span>Footage assets (kept, unlinked)</span>
            <b>{cascade.assets_detached ?? 0}</b>
          </div>
        </div>
      ) : (
        <Skeleton style={{ height: 96 }} />
      )}
    </ConfirmDialog>
  )
}

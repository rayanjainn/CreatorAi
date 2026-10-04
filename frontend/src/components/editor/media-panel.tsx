'use client'

export function MediaPanel({ contentItemId }: { contentItemId: string }) {
  return <div data-testid="media-panel" data-item={contentItemId} />
}

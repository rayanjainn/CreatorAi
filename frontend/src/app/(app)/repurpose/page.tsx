'use client'

import { Repeat2 } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { RenderRow } from '@/components/clips/render-row'
import { useProjects } from '@/components/hubs/use-projects'
import { LinkButton } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAllRenders } from '@/lib/api/hooks'
import { stripDemo } from '@/lib/format'

/** Hub: every render of every clip (GET /renders): preview, download, delete. */
export default function RepurposePage() {
  const renders = useAllRenders()
  const { titles } = useProjects()
  return (
    <div className="page">
      <PageHeader eyebrow="CreatorAI / AI tools" title="Repurpose" description="Every MP4 you rendered, ready for YouTube Shorts, Reels, TikTok or YouTube. Render more from a clip in Smart Clips." actions={<LinkButton href="/smart-clips" variant="secondary">Find a clip to render</LinkButton>} />
      {renders.isPending ? (
        <Skeleton style={{ height: 240, borderRadius: 15 }} />
      ) : renders.isError ? (
        <ErrorState error={renders.error} onRetry={() => renders.refetch()} />
      ) : renders.data.length === 0 ? (
        <EmptyState icon={<Repeat2 size={22} />} title="No renders yet" description="Open a clip, pick a preset and render it. Finished videos are listed here with a download button." actions={<LinkButton href="/smart-clips">Go to Smart Clips</LinkButton>} />
      ) : (
        <section className="card">
          <ul className="render-list" data-testid="all-renders">
            {renders.data.map((r) => (
              <RenderRow key={r.id} render={r} projectTitle={titles.has(r.content_item_id) ? stripDemo(titles.get(r.content_item_id)!) : undefined} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

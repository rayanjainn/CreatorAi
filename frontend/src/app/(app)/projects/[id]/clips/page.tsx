'use client'

import { use, useState } from 'react'
import { Clapperboard } from 'lucide-react'
import { ClipCard } from '@/components/clips/clip-card'
import { GenerateClips } from '@/components/clips/generate-clips'
import { RenderDialog } from '@/components/clips/render-dialog'
import { RenderRow } from '@/components/clips/render-row'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { Segmented } from '@/components/common/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { useAssets, useClips, useContentRenders } from '@/lib/api/hooks'
import type { Clip, ClipStatus } from '@/lib/api/types'

export default function ClipsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const clips = useClips(id)
  const renders = useContentRenders(id)
  const assets = useAssets({ content_item_id: id, limit: 200 })
  const [filter, setFilter] = useState<'all' | ClipStatus>('all')
  const [renderClip, setRenderClip] = useState<Clip | null>(null)
  const [open, setOpen] = useState(false)

  const list = (clips.data ?? []).filter((c) => filter === 'all' || c.status === filter)
  const counts = (s: ClipStatus) => (clips.data ?? []).filter((c) => c.status === s).length

  return (
    <div className="stack" data-testid="clips-page">
      <GenerateClips projectId={id} assets={assets.data?.items ?? []} />

      <section className="stack">
        <div className="section-head">
          <div>
            <div className="eyebrow violet-text">{clips.data?.length ?? 0} clips</div>
            <h2>Suggested clips</h2>
          </div>
          <Segmented<'all' | ClipStatus>
            label="Filter clips"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'suggested', label: `Suggested (${counts('suggested')})` },
              { value: 'accepted', label: `Accepted (${counts('accepted')})` },
              { value: 'rejected', label: `Rejected (${counts('rejected')})` },
            ]}
          />
        </div>
        {clips.isPending ? (
          <div className="clip-grid">
            {[0, 1].map((i) => (
              <Skeleton key={i} style={{ height: 380, borderRadius: 15 }} />
            ))}
          </div>
        ) : clips.isError ? (
          <ErrorState error={clips.error} onRetry={() => clips.refetch()} title="Could not load clips" />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Clapperboard size={22} />}
            title={clips.data.length ? 'No clips in this filter' : 'No clips yet'}
            description={clips.data.length ? 'Pick another filter.' : 'Generate clips above and the best-scoring moments of your footage show up here.'}
          />
        ) : (
          <div className="clip-grid" data-testid="clip-grid">
            {list.map((c, i) => (
              <ClipCard
                key={c.id}
                clip={c}
                index={i}
                onRender={(cl) => {
                  setRenderClip(cl)
                  setOpen(true)
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section className="card" data-testid="renders-section">
        <div className="card-heading">
          <div>
            <div className="eyebrow violet-text">Export</div>
            <h2>Renders</h2>
          </div>
        </div>
        {renders.isPending ? (
          <Skeleton style={{ height: 80, marginTop: 12 }} />
        ) : renders.isError ? (
          <ErrorState error={renders.error} onRetry={() => renders.refetch()} />
        ) : renders.data.length === 0 ? (
          <EmptyState compact title="No renders yet" description="Render a clip to get an MP4 for YouTube Shorts, Reels, TikTok or YouTube." />
        ) : (
          <ul className="render-list">
            {renders.data.map((r) => (
              <RenderRow key={r.id} render={r} />
            ))}
          </ul>
        )}
      </section>
      <RenderDialog clip={renderClip} open={open} onOpenChange={setOpen} />
    </div>
  )
}

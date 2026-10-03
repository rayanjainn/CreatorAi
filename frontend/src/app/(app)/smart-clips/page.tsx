'use client'

import { useState } from 'react'
import { Clapperboard } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { Segmented } from '@/components/common/segmented'
import { ClipCard } from '@/components/clips/clip-card'
import { RenderDialog } from '@/components/clips/render-dialog'
import { useProjects } from '@/components/hubs/use-projects'
import { LinkButton } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAllClips } from '@/lib/api/hooks'
import { stripDemo } from '@/lib/format'
import type { Clip, ClipStatus } from '@/lib/api/types'

/** Hub: clips of every project, best score first (GET /clips). */
export default function SmartClipsPage() {
  const [status, setStatus] = useState<'all' | ClipStatus>('all')
  const clips = useAllClips({ status: status === 'all' ? undefined : status })
  const { titles } = useProjects()
  const [renderClip, setRenderClip] = useState<Clip | null>(null)
  const [open, setOpen] = useState(false)

  return (
    <div className="page">
      <PageHeader eyebrow="CreatorAI / AI tools" title="Smart Clips" description="The best-scoring moments across all your projects. Accept, edit, open in the editor or render them here." />
      <div className="toolbar">
        <Segmented<'all' | ClipStatus>
          label="Filter clips"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'suggested', label: 'Suggested' },
            { value: 'accepted', label: 'Accepted' },
            { value: 'rejected', label: 'Rejected' },
          ]}
        />
        <span className="muted small">{clips.data ? `${clips.data.length} clips` : ''}</span>
      </div>
      {clips.isPending ? (
        <div className="clip-grid">
          {[0, 1].map((i) => (
            <Skeleton key={i} style={{ height: 380, borderRadius: 15 }} />
          ))}
        </div>
      ) : clips.isError ? (
        <ErrorState error={clips.error} onRetry={() => clips.refetch()} />
      ) : clips.data.length === 0 ? (
        <EmptyState icon={<Clapperboard size={22} />} title="No clips yet" description="Generate clips from a project's footage and they appear here." actions={<LinkButton href="/projects">Go to projects</LinkButton>} />
      ) : (
        <div className="clip-grid" data-testid="all-clips">
          {clips.data.map((c, i) => (
            <ClipCard
              key={c.id}
              clip={c}
              index={i}
              projectTitle={titles.has(c.content_item_id) ? stripDemo(titles.get(c.content_item_id)!) : undefined}
              onRender={(cl) => {
                setRenderClip(cl)
                setOpen(true)
              }}
            />
          ))}
        </div>
      )}
      <RenderDialog clip={renderClip} open={open} onOpenChange={setOpen} />
    </div>
  )
}

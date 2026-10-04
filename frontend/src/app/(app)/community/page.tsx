'use client'

import { useState } from 'react'
import { Plus, Search, Users } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { Segmented } from '@/components/common/segmented'
import { NewPostDialog } from '@/components/community/new-post-dialog'
import { PLATFORMS } from '@/components/community/platforms'
import { PostCard } from '@/components/community/post-card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { useCommunityPosts, type CommunityFilters } from '@/lib/api/hooks'
import { useDebounced } from '@/lib/use-debounced'
import { useRole } from '@/lib/use-role'
import type { CommunityPlatform } from '@/lib/api/types'

type Sort = NonNullable<CommunityFilters['sort']>

/** Community: everyone on this server shares finished work and gives feedback before it goes to YouTube, Instagram or TikTok. */
export default function CommunityPage() {
  const { canEdit } = useRole()
  const [sort, setSort] = useState<Sort>('new')
  const [platform, setPlatform] = useState<'' | CommunityPlatform>('')
  const [mine, setMine] = useState(false)
  const [q, setQ] = useState('')
  const query = useDebounced(q.trim(), 300)
  const [open, setOpen] = useState(false)
  const posts = useCommunityPosts({ sort, platform: platform || undefined, author: mine ? 'me' : undefined, q: query || undefined })
  const filtered = !!(platform || mine || query)

  return (
    <div className="page">
      <PageHeader
        eyebrow="CreatorAI / Grow"
        title="Community"
        description="Share a clip before you post it, get feedback from other creators, and give some back. Everyone with an account on this server sees these posts."
        actions={
          canEdit && (
            <Button onClick={() => setOpen(true)} data-testid="new-post">
              <Plus size={15} /> Share your work
            </Button>
          )
        }
      />
      <div className="toolbar cp-toolbar">
        <Segmented<Sort>
          label="Sort posts"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'new', label: 'Newest' },
            { value: 'top', label: 'Most liked' },
            { value: 'discussed', label: 'Most discussed' },
          ]}
        />
        <Select aria-label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value as '' | CommunityPlatform)} className="cp-filter" data-testid="platform-filter">
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
        <label className="yt-check">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} data-testid="mine-filter" /> Only mine
        </label>
        <div className="sc-url cp-q">
          <Search size={15} aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search posts" aria-label="Search posts" />
        </div>
        <span className="muted small">{posts.data ? `${posts.data.total} post${posts.data.total === 1 ? '' : 's'}` : ''}</span>
      </div>
      {posts.isPending ? (
        <div className="cp-grid">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 360, borderRadius: 15 }} />
          ))}
        </div>
      ) : posts.isError ? (
        <ErrorState error={posts.error} onRetry={() => void posts.refetch()} />
      ) : posts.data.items.length === 0 ? (
        <EmptyState
          icon={<Users size={22} />}
          title={filtered ? 'No posts match' : 'No posts yet'}
          description={filtered ? 'Try another filter.' : 'Export a clip, then share it here to get feedback before it goes live.'}
          actions={!filtered && canEdit ? <Button onClick={() => setOpen(true)}>Share your work</Button> : undefined}
        />
      ) : (
        <div className="cp-grid" data-testid="community-feed">
          {posts.data.items.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}
      <NewPostDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}

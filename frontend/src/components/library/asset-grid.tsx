'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { AssetCard } from './asset-card'
import type { Asset } from '@/lib/api/types'

export function AssetGrid({ assets, view, onOpen }: { assets: Asset[]; view: 'grid' | 'list'; onOpen: (id: string) => void }) {
  if (view === 'list') {
    return (
      <div className="asset-list" data-testid="asset-list">
        {assets.map((a) => (
          <AssetCard key={a.id} asset={a} onOpen={onOpen} variant="list" />
        ))}
      </div>
    )
  }
  return (
    <div className="asset-grid" data-testid="asset-grid">
      {assets.map((a, i) => (
        <AssetCard key={a.id} asset={a} onOpen={onOpen} index={i} />
      ))}
    </div>
  )
}

export function AssetGridSkeleton({ view = 'grid', count = 8 }: { view?: 'grid' | 'list'; count?: number }) {
  return view === 'list' ? (
    <div className="asset-list">
      {Array.from({ length: Math.min(count, 5) }, (_, i) => (
        <Skeleton key={i} style={{ height: 84, borderRadius: 12 }} />
      ))}
    </div>
  ) : (
    <div className="asset-grid">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} style={{ height: 258, borderRadius: 15 }} />
      ))}
    </div>
  )
}

'use client'

import { useCallback, useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { api, mediaUrl, unwrap } from '@/lib/api/client'
import { qk } from '@/lib/api/hooks'
import type { AssetDetail } from '@/lib/api/types'
import type { EditAssets } from './types'

export type Frames = { frameAt: (assetId: string | null, srcTime: number) => string | null; ready: boolean }

/**
 * Keyframe images for the video assets of the timeline. Uses the shots of `GET /assets/{id}` (one keyframe per shot) and
 * falls back to the asset thumbnail from the edit payload; null when the asset has neither.
 */
export function useFrames(assetIds: string[], assets: EditAssets): Frames {
  const key = assetIds.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ids = useMemo(() => assetIds, [key])
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.asset(id),
      queryFn: () => unwrap(api.GET('/api/v1/assets/{asset_id}', { params: { path: { asset_id: id }, query: { include_energy: true } } })) as Promise<AssetDetail>,
      staleTime: 5 * 60_000,
    })),
  })
  const stamp = results.map((r) => r.dataUpdatedAt).join(',')
  const shots = useMemo(() => {
    const m = new Map<string, { s: number; e: number; url: string }[]>()
    results.forEach((r, i) => {
      const list = (r.data?.shots ?? []).filter((x) => x.keyframe_url).map((x) => ({ s: x.start_sec, e: x.end_sec, url: x.keyframe_url as string }))
      if (list.length) m.set(ids[i], list)
    })
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, ids])
  const frameAt = useCallback(
    (assetId: string | null, t: number) => {
      if (!assetId) return null
      const list = shots.get(assetId)
      const hit = list?.find((x) => t >= x.s && t < x.e) ?? list?.[list.length - 1]
      return mediaUrl(hit?.url ?? assets[assetId]?.thumb_url ?? null)
    },
    [shots, assets],
  )
  return { frameAt, ready: results.every((r) => !r.isPending) }
}

'use client'

import { useJobs } from '@/stores/jobs'
import { STATUS_LABEL } from '@/lib/library'
import type { Asset } from '@/lib/api/types'

/** Asset status with live job progress (job SSE through the jobs store, falling back to the list's job snapshot). */
export function AssetStatusChip({ asset, showStage = true }: { asset: Pick<Asset, 'status' | 'job'>; showStage?: boolean }) {
  const live = useJobs((s) => (asset.job ? s.jobs[asset.job.id] : undefined))
  const status = asset.status
  if (status === 'processing' || status === 'uploaded') {
    const pct = Math.round(live?.progress ?? asset.job?.progress ?? 0)
    const stage = live?.stage || asset.job?.stage
    return (
      <span className="badge badge-cyan asset-status" data-status="processing" data-testid="asset-status">
        <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} aria-hidden />
        {status === 'uploaded' && !asset.job ? 'Queued' : `${pct}%`}
        {showStage && stage && stage !== 'done' && stage !== 'queued' ? <span className="asset-stage"> · {stage}</span> : null}
      </span>
    )
  }
  const cls = status === 'ready' ? 'badge-green badge-dot' : status === 'failed' ? 'badge-red badge-dot' : 'badge-gray'
  return (
    <span className={`badge ${cls} asset-status`} data-status={status} data-testid="asset-status">
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

export function useLiveProgress(asset: Pick<Asset, 'status' | 'job'>): number | null {
  const live = useJobs((s) => (asset.job ? s.jobs[asset.job.id] : undefined))
  if (asset.status !== 'processing' && asset.status !== 'uploaded') return null
  return Math.round(live?.progress ?? asset.job?.progress ?? 0)
}

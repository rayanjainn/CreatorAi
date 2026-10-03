'use client'

import { use, useState } from 'react'
import { Plus } from 'lucide-react'
import { DirectorForm } from '@/components/plan/director-form'
import { PlanView } from '@/components/plan/plan-view'
import { ShotList } from '@/components/plan/shot-list'
import { ReviewReport } from '@/components/plan/review-report'
import { AssetDetailHost } from '@/components/library/asset-detail'
import { useAssetDrawer } from '@/components/library/use-asset-drawer'
import { ErrorState } from '@/components/common/error-state'
import { Select } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useContentItem, usePlan, usePlanVersions } from '@/lib/api/hooks'
import { formatDateTime } from '@/lib/time'
import type { Card } from '@/lib/api/types'

export default function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const item = useContentItem(id)
  const [version, setVersion] = useState<number | undefined>()
  const [showForm, setShowForm] = useState(false)
  const plan = usePlan(id, version, !!(item.data as Card | undefined)?.progress.has_plan)
  const versions = usePlanVersions(id)
  const drawer = useAssetDrawer()
  const latest = versions.data?.[0]?.version

  if (item.isPending || plan.isLoading) {
    return (
      <div className="stack">
        <Skeleton style={{ height: 260, borderRadius: 15 }} />
        <Skeleton style={{ height: 340, borderRadius: 15 }} />
      </div>
    )
  }
  if (item.isError) return <ErrorState error={item.error} onRetry={() => item.refetch()} />
  if (plan.isError) return <ErrorState error={plan.error} onRetry={() => plan.refetch()} title="Could not load the plan" />
  const card = item.data as Card
  const p = plan.data

  return (
    <div className="stack" data-testid="plan-page">
      {!p || showForm ? (
        <DirectorForm item={card} hasPlan={!!p} onDone={() => { setShowForm(false); setVersion(undefined) }} />
      ) : (
        <div className="plan-bar">
          {(versions.data?.length ?? 0) > 1 && (
            <Select aria-label="Plan version" value={version ?? latest ?? ''} onChange={(e) => setVersion(Number(e.target.value) === latest ? undefined : Number(e.target.value))} style={{ width: 230, minHeight: 36 }} data-testid="plan-version">
              {versions.data!.map((v) => (
                <option key={v.id} value={v.version}>
                  v{v.version} · {formatDateTime(v.created_at)}
                </option>
              ))}
            </Select>
          )}
          <Button variant="secondary" size="sm" onClick={() => setShowForm(true)} data-testid="new-plan">
            <Plus size={13} /> New plan version
          </Button>
        </div>
      )}
      {p && (
        <>
          {version !== undefined && version !== latest && (
            <div className="notice" role="status">
              <div className="notice-body">
                <b>You are viewing v{p.version}</b>
                <p>The latest is v{latest}. Older versions are read-only.</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setVersion(undefined)}>
                Back to latest
              </Button>
            </div>
          )}
          <PlanView plan={p} projectId={id} />
          <ShotList plan={p} readOnly={version !== undefined && version !== latest} />
        </>
      )}
      <ReviewReport projectId={id} hasReview={card.progress.has_review} onGoTo={(assetId, sec) => drawer.open(assetId, sec)} />
      <AssetDetailHost />
    </div>
  )
}

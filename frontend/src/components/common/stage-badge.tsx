import type { Stage } from '@/lib/api/types'
import { STAGE_LABEL } from '@/lib/format'

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className="stage-badge" data-stage={stage}>
      {STAGE_LABEL[stage] ?? stage}
    </span>
  )
}

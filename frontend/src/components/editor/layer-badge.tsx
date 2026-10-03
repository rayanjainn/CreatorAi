'use client'

import { Check, Sparkles, UserRound, X } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import type { LayerSource, LayerStatus } from '@/lib/timeline'

const STATUS_TEXT: Record<LayerStatus, string> = {
  suggested: 'Suggested: it renders unless you reject it',
  accepted: 'Accepted: you approved it',
  rejected: 'Rejected: it is left out of previews and renders',
}

/**
 * Who made a timeline layer and what you decided about it. AI layers carry the yellow "Agent" chip with the
 * suggested / accepted / rejected state and the reason in the tooltip; layers you made carry the orange "You" chip.
 */
export function LayerBadge({
  source,
  status,
  reason,
  compact,
  className = '',
}: {
  source: LayerSource
  status: LayerStatus
  reason?: string | null
  /** Icon-only (timeline items too narrow for text). */
  compact?: boolean
  className?: string
}) {
  const ai = source === 'ai'
  const label = ai ? 'Agent' : 'You'
  return (
    <Tooltip
      content={
        <div className="lb-tip">
          <b>{ai ? 'Made by the Agent' : 'Made by you'}</b>
          <div>{STATUS_TEXT[status]}</div>
          {reason && (
            <div className="lb-reason">
              <span>Why</span> {reason}
            </div>
          )}
        </div>
      }
    >
      <span className={`layer-badge ${className}`} data-source={source} data-status={status} data-testid="layer-badge" tabIndex={0} aria-label={`${label} layer, ${status}${reason ? `, ${reason}` : ''}`}>
        {ai ? <Sparkles aria-hidden /> : <UserRound aria-hidden />}
        {!compact && <span className="lb-label">{label}</span>}
        <span className="lb-state" aria-hidden>
          {status === 'accepted' ? <Check /> : status === 'rejected' ? <X /> : <i />}
        </span>
      </span>
    </Tooltip>
  )
}

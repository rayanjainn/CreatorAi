'use client'

import { AlertCircle, Check, Circle, Minus } from 'lucide-react'
import { stageStates } from '@/lib/library'
import type { StageState } from '@/lib/library'

/**
 * The `asset.process` stages as a checklist: done (from `stages_done`), the running one (job `stage` events),
 * skipped (e.g. AI captions without a provider) and the failed one.
 */
export function PipelineChecklist({
  kind,
  doneEntries,
  current,
  failedStage,
  jobDone,
  hasAudio,
  compact,
}: {
  kind: string
  doneEntries: string[]
  current?: string | null
  failedStage?: string | null
  jobDone?: boolean
  hasAudio?: boolean
  compact?: boolean
}) {
  const rows = stageStates(kind, { doneEntries, current, failedStage, jobDone, hasAudio })
  return (
    <ol className={`pipeline ${compact ? 'compact' : ''}`} data-testid="pipeline" aria-label="Processing steps">
      {rows.map((r) => (
        <li key={r.id} data-state={r.state} data-stage={r.id} aria-current={r.state === 'active' ? 'step' : undefined}>
          <span className="pipe-icon" aria-hidden>
            <StateIcon state={r.state} />
          </span>
          <span className="pipe-label">{r.label}</span>
          {!compact && <span className="pipe-hint">{r.state === 'skipped' && r.note ? r.note : r.hint}</span>}
          <span className="sr-only">{r.state}</span>
        </li>
      ))}
    </ol>
  )
}

function StateIcon({ state }: { state: StageState }) {
  if (state === 'done') return <Check size={12} strokeWidth={3} />
  if (state === 'active') return <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
  if (state === 'failed') return <AlertCircle size={13} />
  if (state === 'skipped') return <Minus size={12} strokeWidth={3} />
  return <Circle size={8} />
}

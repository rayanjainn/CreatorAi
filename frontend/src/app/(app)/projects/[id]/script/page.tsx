'use client'

import { use, useState } from 'react'
import { CheckCircle2, ChevronDown, Fingerprint } from 'lucide-react'
import { HookPicker } from '@/components/script/hook-picker'
import { ScriptGenerate } from '@/components/script/script-generate'
import { ScriptEditor } from '@/components/script/script-editor'
import { MetaPanel } from '@/components/script/meta-panel'
import { ScriptVersions } from '@/components/script/script-versions'
import { ErrorState } from '@/components/common/error-state'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useApproveScript, useContentItem, useScript, useScriptVersions } from '@/lib/api/hooks'
import type { Card } from '@/lib/api/types'

export default function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const item = useContentItem(id)
  const card = item.data as Card | undefined
  const versions = useScriptVersions(id)
  const script = useScript(id, (versions.data?.length ?? 0) > 0)
  const approve = useApproveScript(id)
  const [open, setOpen] = useState(false)

  if (item.isPending || versions.isPending || script.isLoading) return <Skeleton style={{ height: 320, borderRadius: 15 }} />
  if (item.isError) return <ErrorState error={item.error} onRetry={() => item.refetch()} />
  if (script.isError) return <ErrorState error={script.error} onRetry={() => script.refetch()} title="Could not load the script" />
  const s = script.data ?? null
  const hasScenes = !!s?.scenes.length

  return (
    <div className="stack" data-testid="script-page">
      {s && hasScenes && (
        <div className="script-bar" data-testid="script-bar">
          <div className="script-bar-info">
            <span className="badge">v{s.version}</span>
            <ProvenanceBadge {...s.provenance} />
            {s.style_applied && (
              <span className="badge badge-cyan" data-testid="twin-banner" title="The Creative Twin style profile was applied when this was written">
                <Fingerprint size={11} /> Written in your style
              </span>
            )}
            {s.generation.hook_repaired && <span className="badge badge-amber">Hook was repaired to match your choice</span>}
            {s.generation.within_tolerance === false && <span className="badge badge-amber">Length is off target</span>}
            <span className="muted small mono">
              {s.counters.word_count} words · {s.counters.est_sec.toFixed(1)}s
            </span>
          </div>
          {s.approved ? (
            <span className="badge badge-green" data-testid="approved-chip">
              <CheckCircle2 size={12} /> Approved
            </span>
          ) : (
            <Button onClick={() => approve.mutate(s.id)} loading={approve.isPending} data-testid="approve-script">
              <CheckCircle2 size={14} /> Mark approved · move to Shoot
            </Button>
          )}
        </div>
      )}

      {hasScenes ? (
        <>
          <ScriptEditor projectId={id} script={s!} />
          <MetaPanel projectId={id} script={s!} />
          <ScriptVersions projectId={id} />
          <section className="card collapsible">
            <button type="button" className="collapse-head" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="toggle-rewrite">
              <div>
                <div className="eyebrow violet-text">Start over</div>
                <h2>Pick another hook or write a new version</h2>
              </div>
              <ChevronDown size={18} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} />
            </button>
            {open && (
              <div className="stack" style={{ marginTop: 16 }}>
                <HookPicker projectId={id} script={s} />
                <ScriptGenerate item={card!} script={s} />
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <HookPicker projectId={id} script={s} />
          <ScriptGenerate item={card!} script={s} />
        </>
      )}
    </div>
  )
}

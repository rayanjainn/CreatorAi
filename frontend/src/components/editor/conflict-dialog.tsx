'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, GitMerge, RotateCcw } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { applyRebase, overwriteWithMine, planRebase, reloadLatest, type RebasePlan } from '@/lib/editor/controller'
import { diffTimelines } from '@/lib/timeline'
import { useEditor } from '@/stores/editor'

/**
 * REVISION_CONFLICT: the clip was saved elsewhere (another tab, or the Twin). Never overwrites silently: it says what
 * is at stake and offers reload, a safe merge (only when the two sets of changes provably do not touch each other),
 * or an explicit overwrite that keeps the other revision in history.
 */
export function ConflictDialog() {
  const conflict = useEditor((s) => s.conflict)
  const revision = useEditor((s) => s.revision)
  // only computed while the dialog is up (the store updates 60 times a second during playback)
  const localChanges = useEditor((s) => {
    if (!s.conflict) return 0
    const d = diffTimelines(s.serverTimeline, s.timeline)
    return d.items.size + d.globals.length
  })
  const [planned, setPlanned] = useState<{ rev: number | null; plan: RebasePlan | 'error' } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const rev = conflict?.currentRevision ?? null
  const plan: RebasePlan | 'loading' | 'error' | null = !conflict ? null : planned && planned.rev === rev ? planned.plan : 'loading'

  useEffect(() => {
    if (rev === null) return
    let live = true
    planRebase()
      .then((p) => live && setPlanned({ rev, plan: p }))
      .catch(() => live && setPlanned({ rev, plan: 'error' }))
    return () => {
      live = false
    }
  }, [rev])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open={!!conflict} onOpenChange={() => undefined} dismissible={false} size="md" eyebrow="Edit conflict" title="This clip changed somewhere else" description={null}>
      <div className="conflict" data-testid="conflict-dialog">
        <div className="notice notice-amber" role="alert">
          <div className="stat-icon amber">
            <AlertTriangle size={15} />
          </div>
          <div className="notice-body">
            <b>
              You started from revision <span className="mono">{revision}</span>; the latest is revision <span className="mono" data-testid="conflict-current">{conflict?.currentRevision}</span>
            </b>
            <p>
              Another tab (or the Twin) saved this timeline after you opened it. Saving now would hide their change, so nothing was saved. You have{' '}
              <b>
                {localChanges} unsaved change{localChanges === 1 ? '' : 's'}
              </b>
              .
            </p>
          </div>
        </div>
        <div className="conflict-options">
          <div className="conflict-opt">
            <div>
              <b>
                <RotateCcw size={13} /> Reload the latest
              </b>
              <p>Discards your {localChanges} unsaved change{localChanges === 1 ? '' : 's'} and shows revision {conflict?.currentRevision}.</p>
            </div>
            <Button variant="secondary" size="sm" loading={busy === 'reload'} disabled={!!busy} onClick={() => void run('reload', reloadLatest)} data-testid="conflict-reload">
              Reload latest
            </Button>
          </div>
          <div className="conflict-opt">
            <div>
              <b>
                <GitMerge size={13} /> Keep my changes (merge)
              </b>
              {plan === 'loading' && <p className="muted">Checking whether the two sets of changes can be combined…</p>}
              {plan === 'error' && <p className="muted">Could not check the latest revision.</p>}
              {plan && typeof plan === 'object' && plan.ok && <p>Your changes touch different layers than theirs, so they can be combined safely. Saved as a new revision on top of {plan.revision}.</p>}
              {plan && typeof plan === 'object' && !plan.ok && <p className="muted">Not offered: {plan.reason}</p>}
            </div>
            <Button size="sm" disabled={!plan || typeof plan !== 'object' || !plan.ok || !!busy} loading={busy === 'merge'} onClick={() => plan && typeof plan === 'object' && plan.ok && void run('merge', () => applyRebase(plan))} data-testid="conflict-rebase">
              Merge &amp; save
            </Button>
          </div>
          <div className="conflict-opt conflict-opt-danger">
            <div>
              <b>Replace the latest with my version</b>
              <p>Saves your timeline as a new revision. Revision {conflict?.currentRevision} stays in the history and can be restored.</p>
            </div>
            <Button variant="danger" size="sm" loading={busy === 'overwrite'} disabled={!!busy} onClick={() => void run('overwrite', overwriteWithMine)} data-testid="conflict-overwrite">
              Overwrite
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

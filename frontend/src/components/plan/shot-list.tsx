'use client'

import { useMemo, useState } from 'react'
import { Download, RotateCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { downloadAuthed } from '@/lib/api/client'
import { usePatchPlan } from '@/lib/api/hooks'
import { errorMessage } from '@/lib/api/errors'
import { toast } from '@/stores/toasts'
import type { Plan, ShotEntry } from '@/lib/api/types'

const SHOT_TYPES = ['wide', 'medium', 'close-up', 'screen', 'b-roll', 'insert', 'over-the-shoulder']

/** Editable shot table (one row per scene). Saving patches the latest plan version; export gives CSV or Markdown. */
export function ShotList({ plan, readOnly }: { plan: Plan; readOnly?: boolean }) {
  const patch = usePatchPlan(plan.content_item_id)
  const [rows, setRows] = useState<ShotEntry[]>(plan.plan.shot_list)
  const [seen, setSeen] = useState(plan.plan.shot_list)
  if (seen !== plan.plan.shot_list) {
    setSeen(plan.plan.shot_list)
    setRows(plan.plan.shot_list)
  }
  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(plan.plan.shot_list), [rows, plan.plan.shot_list])
  const edited = new Set(plan.edited_by_user.shot_list ?? [])

  const set = (i: number, k: keyof ShotEntry, v: string) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [k]: v } : row)))
  const exportAs = async (format: 'csv' | 'md') => {
    try {
      await downloadAuthed(`/api/v1/content/${plan.content_item_id}/director/plan/export?format=${format}&version=${plan.version}`, `shot-list-v${plan.version}.${format}`)
    } catch (e) {
      toast.error('Export failed', errorMessage(e))
    }
  }

  return (
    <section className="card" data-testid="shot-list">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">Shoot plan</div>
          <h2>Shot list</h2>
        </div>
        <div className="page-actions">
          <Button variant="secondary" size="sm" onClick={() => exportAs('csv')} data-testid="export-csv">
            <Download size={13} /> CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={() => exportAs('md')} data-testid="export-md">
            <Download size={13} /> Markdown
          </Button>
        </div>
      </div>
      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table className="data-table shot-table">
          <thead>
            <tr>
              <th>Scene</th>
              <th>Shot</th>
              <th>Framing</th>
              <th>B-roll</th>
              <th>Notes</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const section = plan.plan.structure[r.scene - 1]?.section
              const prov = edited.has(r.scene) ? { source: 'user' as const } : plan.shot_provenance[i]
              return (
                <tr key={r.scene} data-testid="shot-row">
                  <td>
                    <b>{r.scene}</b>
                    {section && <small style={{ display: 'block' }}>{section}</small>}
                  </td>
                  <td>
                    <input className="cell-input" list="shot-types" value={r.shot_type} disabled={readOnly} aria-label={`Scene ${r.scene} shot type`} onChange={(e) => set(i, 'shot_type', e.target.value)} />
                  </td>
                  <td>
                    <input className="cell-input" value={r.framing} disabled={readOnly} aria-label={`Scene ${r.scene} framing`} onChange={(e) => set(i, 'framing', e.target.value)} />
                  </td>
                  <td>
                    <input className="cell-input" value={r.b_roll ?? ''} disabled={readOnly} aria-label={`Scene ${r.scene} b-roll`} onChange={(e) => set(i, 'b_roll', e.target.value)} />
                  </td>
                  <td>
                    <input className="cell-input" value={r.note ?? ''} disabled={readOnly} aria-label={`Scene ${r.scene} notes`} onChange={(e) => set(i, 'note', e.target.value)} />
                  </td>
                  <td>{prov ? <ProvenanceBadge {...prov} /> : null}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <datalist id="shot-types">
          {SHOT_TYPES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
      {readOnly ? (
        <p className="muted small" style={{ marginTop: 10 }}>
          You are viewing an older version. Only the latest version can be edited.
        </p>
      ) : (
        <div className="form-foot">
          <span className="dirty-note" data-dirty={dirty} role="status">
            {patch.isPending ? 'Saving…' : dirty ? 'Unsaved changes' : edited.size ? 'Saved · your edits are marked “You”' : 'All changes saved'}
          </span>
          <div className="page-actions">
            <Button variant="ghost" size="sm" disabled={!dirty || patch.isPending} onClick={() => setRows(plan.plan.shot_list)}>
              <RotateCcw size={13} /> Discard
            </Button>
            <Button size="sm" disabled={!dirty} loading={patch.isPending} onClick={() => patch.mutate(rows)} data-testid="save-shots">
              <Save size={13} /> Save shot list
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

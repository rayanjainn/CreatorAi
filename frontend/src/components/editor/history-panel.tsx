'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Bot, Check, ChevronRight, Circle, CircleCheck, CircleX, History, ListChecks, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useActivity } from '@/lib/api/hooks'
import { acceptAllLayers, seekTo, setGroupStatus, setItemStatus } from '@/lib/editor/actions'
import { actionLabel } from '@/lib/format'
import { relativeTime } from '@/lib/time'
import { itemSpan, layerGroups, totals, clock, type AnyItem, type LayerGroup, type Timeline } from '@/lib/timeline'
import { useEditor, viewTimeline } from '@/stores/editor'
import { LayerBadge } from './layer-badge'
import { RevisionList } from './revision-list'

/** Left panel: honest "Twin chat not available" card + the real edit history and AI changes checklist. */
export function HistoryPanel({ clipId }: { clipId: string }) {
  const timeline = useEditor(viewTimeline)
  const ro = useEditor((s) => !!s.preview || !!s.busy)
  const groups = useMemo(() => layerGroups(timeline), [timeline])
  const t = totals(timeline)
  const ai = t.ai
  const decided = groups.reduce((n, g) => n + g.items.filter((i) => i.source === 'ai' && i.status !== 'suggested').length, 0)
  return (
    <aside className="agent-panel" aria-label="Agent and edit history" data-testid="history-panel">
      <div className="twin-card" data-testid="twin-unavailable">
        <div className="twin-card-head">
          <span className="twin-orb">
            <Bot size={15} />
          </span>
          <div>
            <b>Twin chat isn&apos;t available yet</b>
            <small>Creative Twin</small>
          </div>
        </div>
        <p>
          The Twin backend isn&apos;t built, so there is no agent to chat with and nothing here is simulated. Everything the Agent already did to this clip is
          below. Review it, then accept or reject it.
        </p>
        <Link href="/creative-twin" className="link small">
          What the Twin will do
        </Link>
      </div>

      <div className="checklist">
        <header className="cl-head">
          <div>
            <span className="eyebrow">
              <ListChecks size={11} /> Edit history &amp; AI changes
            </span>
            <p>
              {ai === 0 ? 'No Agent layers on this clip.' : t.suggested > 0 ? `${t.suggested} of ${ai + t.user} layers wait for your review.` : 'Every layer is reviewed.'}
            </p>
          </div>
          <Button size="sm" disabled={ro || t.suggested === 0} onClick={() => acceptAllLayers()} data-testid="accept-all-panel">
            <Check size={12} /> Accept all
          </Button>
        </header>
        {ai > 0 && (
          <div className="cl-progress" role="progressbar" aria-valuemin={0} aria-valuemax={ai} aria-valuenow={decided} aria-label="Agent layers reviewed">
            <i style={{ width: `${(decided / ai) * 100}%` }} />
          </div>
        )}
        <ul className="cl-list">
          {groups.map((g) => (
            <GroupRow key={g.key} group={g} timeline={timeline} ro={ro} />
          ))}
          {groups.length === 0 && <li className="cl-empty">This timeline has no layers yet.</li>}
        </ul>
      </div>

      <ActivitySection clipId={clipId} />

      <section className="cl-section">
        <h4>
          <History size={12} /> Revisions
        </h4>
        <RevisionList clipId={clipId} limit={6} compact />
      </section>
    </aside>
  )
}

function StatusIcon({ g }: { g: LayerGroup }) {
  if (g.counts.suggested > 0) return <Circle size={15} className="cl-ic cl-ic-pending" aria-label="Needs review" />
  if (g.counts.accepted === 0) return <CircleX size={15} className="cl-ic cl-ic-rejected" aria-label="All rejected" />
  return <CircleCheck size={15} className="cl-ic cl-ic-done" aria-label="Reviewed" />
}

function GroupRow({ group, timeline, ro }: { group: LayerGroup; timeline: Timeline; ro: boolean }) {
  const [open, setOpen] = useState(false)
  const select = useEditor((s) => s.select)
  const c = group.counts
  return (
    <li className="cl-group" data-testid="layer-group" data-kind={group.key}>
      <div className="cl-row">
        <button type="button" className="cl-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronRight size={13} className="cl-chev" aria-hidden />
          <StatusIcon g={group} />
          <span className="cl-label">{group.label}</span>
          <span className="cl-counts">
            {c.suggested > 0 && <em className="amber">{c.suggested} suggested</em>}
            {c.accepted > 0 && <em className="green">{c.accepted} accepted</em>}
            {c.rejected > 0 && <em className="red">{c.rejected} rejected</em>}
          </span>
        </button>
        <span className="cl-actions">
          <button type="button" className="cl-act cl-act-ok" disabled={ro || c.suggested + c.rejected === 0} onClick={() => setGroupStatus(group.items, 'accepted')} aria-label={`Accept all ${group.label}`} title={`Accept all ${group.label.toLowerCase()}`} data-testid="group-accept">
            <Check size={12} />
          </button>
          <button type="button" className="cl-act cl-act-no" disabled={ro || c.suggested + c.accepted === 0} onClick={() => setGroupStatus(group.items, 'rejected')} aria-label={`Reject all ${group.label}`} title={`Reject all ${group.label.toLowerCase()}`} data-testid="group-reject">
            <X size={12} />
          </button>
        </span>
      </div>
      {open && (
        <ul className="cl-items">
          {group.items.map((item) => (
            <ItemRow key={item.id} item={item} timeline={timeline} ro={ro} onPick={() => (select([item.id]), seekTo(itemSpan(item)[0]))} />
          ))}
        </ul>
      )}
    </li>
  )
}

function label(item: AnyItem, timeline: Timeline): string {
  if ('text' in item && item.text) return item.text
  if ('asset_id' in item && 'gain_db' in item) return `${item.kind}`
  if ('src_in' in item) {
    const i = timeline.tracks.video.filter((v) => v.status !== 'rejected').findIndex((v) => v.id === item.id)
    return i >= 0 ? `Clip ${i + 1} · ${(item.src_out - item.src_in).toFixed(1)}s` : `Rejected clip · ${(item.src_out - item.src_in).toFixed(1)}s`
  }
  return item.id
}

function ItemRow({ item, timeline, ro, onPick }: { item: AnyItem; timeline: Timeline; ro: boolean; onPick: () => void }) {
  const [a] = itemSpan(item)
  return (
    <li className="cl-item" data-status={item.status}>
      <button type="button" className="cl-item-main" onClick={onPick}>
        <span className="mono cl-time">{clock(a)}</span>
        <span className="cl-item-label truncate">{label(item, timeline)}</span>
      </button>
      <LayerBadge source={item.source} status={item.status} reason={item.reason} compact />
      <span className="cl-actions">
        {item.status !== 'accepted' && (
          <button type="button" className="cl-act cl-act-ok" disabled={ro} onClick={() => setItemStatus([item.id], 'accepted')} aria-label={item.status === 'rejected' ? 'Restore' : 'Accept'} title={item.status === 'rejected' ? 'Restore' : 'Accept'}>
            <Check size={11} />
          </button>
        )}
        {item.status !== 'rejected' && (
          <button type="button" className="cl-act cl-act-no" disabled={ro} onClick={() => setItemStatus([item.id], 'rejected')} aria-label="Reject" title="Reject">
            <X size={11} />
          </button>
        )}
      </span>
    </li>
  )
}

function activityText(a: { action: string; meta: Record<string, unknown> }): string {
  const m = a.meta
  if (a.action === 'layer_accepted' || a.action === 'layer_rejected') {
    const n = Number(m.count ?? 1)
    const kind = String(m.kind ?? m.layer ?? 'layer')
    const noun = kind === 'clip' ? 'cut' : kind
    const who = Array.isArray(m.sources) && m.sources.length === 1 ? (m.sources[0] === 'ai' ? 'Agent ' : 'your ') : ''
    return `${a.action === 'layer_accepted' ? 'Accepted' : 'Rejected'} ${n} ${who}${noun}${n === 1 ? '' : 's'}`
  }
  return actionLabel(a.action)
}

function ActivitySection({ clipId }: { clipId: string }) {
  const qc = useQueryClient()
  const savedAt = useEditor((s) => s.save.at)
  const q = useActivity({ entity_type: 'clip', entity_id: clipId, limit: 8 })
  useEffect(() => {
    if (savedAt) void qc.invalidateQueries({ queryKey: ['activity'] })
  }, [savedAt, qc])
  return (
    <section className="cl-section" data-testid="activity">
      <h4>
        <Sparkles size={12} /> Recent activity
      </h4>
      {q.isPending && <p className="muted small">Loading…</p>}
      {q.data && q.data.items.length === 0 && <p className="muted small">Nothing logged yet. Accepting or rejecting a layer shows up here.</p>}
      <ul className="act-list">
        {q.data?.items.map((a) => (
          <li key={a.id} data-testid="activity-row" data-action={a.action}>
            <span className={`act-dot ${a.action === 'layer_rejected' ? 'red' : a.action === 'layer_accepted' ? 'green' : ''}`} />
            <span className="act-text">{activityText(a)}</span>
            <small>{relativeTime(a.created_at)}</small>
          </li>
        ))}
      </ul>
    </section>
  )
}

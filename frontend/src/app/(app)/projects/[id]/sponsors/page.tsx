'use client'

import Link from 'next/link'
import { use, useState, type FormEvent } from 'react'
import { Megaphone, Pencil, Plus, Radar, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { errorMessage, isCode } from '@/lib/api/errors'
import { useClips } from '@/lib/api/hooks'
import {
  useAcceptSlot,
  useDeals,
  useDeleteBrief,
  useFindSlots,
  useSaveBrief,
  useSponsorBriefs,
  useUpdateSlot,
  type SponsorBrief,
  type SponsorSlot,
} from '@/lib/api/monetization'
import { formatTimecode } from '@/lib/format'
import { useProjectRole } from '@/lib/use-role'
import { toast } from '@/stores/toasts'

const KIND_LABEL: Record<SponsorSlot['kind'], string> = { both: 'Topic change + pause', topic_shift: 'Topic change', pause: 'Natural pause' }
const lines = (text: string) => text.split('\n').map((s) => s.trim()).filter(Boolean)

/** Sponsors: a brief for this video, the best moments for the read, and placing it into a clip. */
export default function SponsorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const briefs = useSponsorBriefs(id)
  const { canEdit } = useProjectRole(id)
  const [editing, setEditing] = useState<SponsorBrief | 'new' | null>(null)

  return (
    <div className="stack" data-testid="sponsors-page">
      <section className="card">
        <div className="card-heading">
          <div>
            <div className="eyebrow violet-text">Sponsors</div>
            <h2>Where should the sponsor read go?</h2>
          </div>
          {canEdit && editing === null && (
            <Button size="sm" onClick={() => setEditing('new')} data-testid="new-brief">
              <Plus size={13} /> Add a sponsor
            </Button>
          )}
        </div>
        <p className="muted small">
          Describe the sponsor, then CreatorAi reads your transcript and suggests up to three moments where a read fits: where the topic changes, where you pause, and where you
          already talk about something close to the product. Placing a read adds a placeholder segment, a &ldquo;Sponsored&rdquo; label and captions to the clip you choose.
        </p>
        {editing !== null && <BriefForm itemId={id} brief={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </section>

      {briefs.isPending ? (
        <Skeleton style={{ height: 160 }} />
      ) : briefs.isError ? (
        <ErrorState error={briefs.error} onRetry={() => void briefs.refetch()} title="Could not load sponsors" />
      ) : briefs.data.length === 0 ? (
        editing === null && <EmptyState compact icon={<Megaphone size={22} />} title="No sponsor for this video" description="Add one to find the best slots for the read." />
      ) : (
        briefs.data.map((b) => <BriefCard key={b.id} itemId={id} brief={b} canEdit={canEdit} onEdit={() => setEditing(b)} />)
      )}
    </div>
  )
}

function BriefForm({ itemId, brief, onDone }: { itemId: string; brief: SponsorBrief | null; onDone: () => void }) {
  const save = useSaveBrief(itemId)
  const deals = useDeals()
  const [brand, setBrand] = useState(brief?.brand ?? '')
  const [product, setProduct] = useState(brief?.product ?? '')
  const [points, setPoints] = useState((brief?.key_points ?? []).join('\n'))
  const [cta, setCta] = useState(brief?.cta ?? '')
  const [avoid, setAvoid] = useState((brief?.do_not_say ?? []).join('\n'))
  const [duration, setDuration] = useState(brief?.duration_sec ?? 20)
  const [deal, setDeal] = useState(brief?.deal_id ?? '')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!brand.trim() || !product.trim()) return
    save.mutate(
      { id: brief?.id, brand: brand.trim(), product: product.trim(), key_points: lines(points), cta: cta.trim(), do_not_say: lines(avoid), duration_sec: duration, deal_id: deal || null },
      { onSuccess: onDone },
    )
  }
  const pickDeal = (dealId: string) => {
    setDeal(dealId)
    const d = deals.data?.find((x) => x.id === dealId)
    if (d && !brand.trim()) setBrand(d.brand)
  }

  return (
    <form onSubmit={submit} className="mon-form" data-testid="brief-form">
      <div className="mon-form-grid">
        <Field label="Brand" htmlFor="sb-brand">
          <Input id="sb-brand" value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={120} required data-testid="brief-brand" />
        </Field>
        <Field label="Product" htmlFor="sb-product">
          <Input id="sb-product" value={product} onChange={(e) => setProduct(e.target.value)} maxLength={160} required data-testid="brief-product" />
        </Field>
        <Field label="Read length" htmlFor="sb-dur" hint={`${duration} seconds, about ${Math.round(duration * 2.5)} words`}>
          <input id="sb-dur" type="range" min={10} max={60} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
        </Field>
        <Field label="Deal (optional)" htmlFor="sb-deal">
          <Select id="sb-deal" value={deal} onChange={(e) => pickDeal(e.target.value)}>
            <option value="">Not linked</option>
            {deals.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.brand}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Key points" htmlFor="sb-points" hint="One per line, from the brand's brief">
        <Textarea id="sb-points" rows={3} value={points} onChange={(e) => setPoints(e.target.value)} />
      </Field>
      <div className="mon-form-grid">
        <Field label="Call to action" htmlFor="sb-cta" hint="e.g. Use code CREATOR for 20% off">
          <Input id="sb-cta" value={cta} onChange={(e) => setCta(e.target.value)} maxLength={300} />
        </Field>
        <Field label="Never say" htmlFor="sb-avoid" hint="One phrase per line">
          <Textarea id="sb-avoid" rows={2} value={avoid} onChange={(e) => setAvoid(e.target.value)} />
        </Field>
      </div>
      {save.error && (
        <p className="field-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="mon-row">
        <Button type="submit" loading={save.isPending} disabled={!brand.trim() || !product.trim()} data-testid="brief-save">
          {brief ? 'Save sponsor' : 'Add sponsor'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function BriefCard({ itemId, brief, canEdit, onEdit }: { itemId: string; brief: SponsorBrief; canEdit: boolean; onEdit: () => void }) {
  const find = useFindSlots(itemId)
  const del = useDeleteBrief(itemId)
  const [confirm, setConfirm] = useState(false)
  const warnings = find.data?.brief.id === brief.id ? find.data.warnings : []
  const notReady = isCode(find.error, 'ASSET_NOT_READY')
  const visible = brief.slots.filter((s) => s.status !== 'rejected')

  return (
    <article className="card" data-testid="brief-card">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">
            {brief.duration_sec} s read{brief.cta ? ` · ${brief.cta}` : ''}
          </div>
          <h2>
            {brief.brand} · {brief.product}
          </h2>
        </div>
        {canEdit && (
          <div className="mon-row">
            <Button size="sm" onClick={() => find.mutate({ briefId: brief.id })} loading={find.isPending} data-testid="find-slots">
              <Radar size={13} /> {brief.slots.length ? 'Find again' : 'Find slots'}
            </Button>
            <Button size="sm" variant="ghost" onClick={onEdit} aria-label="Edit sponsor">
              <Pencil size={13} />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} aria-label="Delete sponsor">
              <Trash2 size={13} />
            </Button>
          </div>
        )}
      </div>
      {brief.key_points.length > 0 && (
        <ul className="mon-points small">
          {brief.key_points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {notReady && (
        <p className="auth-alert info" role="status">
          This needs a processed video with a transcript. Upload footage in the <Link href={`/projects/${itemId}/footage`}>Footage</Link> tab first.
        </p>
      )}
      {find.error && !notReady && (
        <p className="field-error" role="alert">
          {errorMessage(find.error)}
        </p>
      )}
      {warnings.map((w) => (
        <p key={w} className="auth-alert info" role="status" data-testid="slot-warning">
          {w}
        </p>
      ))}
      {visible.length === 0 ? (
        <p className="muted small">{brief.slots.length ? 'Every suggestion was dismissed. Find again for fresh ones.' : 'No slots yet.'}</p>
      ) : (
        <div className="mon-slots">
          {visible.map((s, n) => (
            <SlotCard key={s.id} itemId={itemId} slot={s} index={n} canEdit={canEdit} brand={brief.brand} />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Remove ${brief.brand}?`}
        description="Its suggested slots are removed. Reads already placed in a clip stay there until you delete them in the editor."
        confirmLabel="Remove sponsor"
        danger
        loading={del.isPending}
        onConfirm={() => del.mutate(brief.id, { onSuccess: () => setConfirm(false) })}
      />
    </article>
  )
}

function SlotCard({ itemId, slot, index, canEdit, brand }: { itemId: string; slot: SponsorSlot; index: number; canEdit: boolean; brand: string }) {
  const update = useUpdateSlot(itemId)
  const accept = useAcceptSlot(itemId)
  const clips = useClips(itemId)
  const [script, setScript] = useState(slot.integration_script)
  const [clipId, setClipId] = useState('')
  const dirty = script.trim() !== slot.integration_script
  const usable = (clips.data ?? []).filter((c) => c.status !== 'rejected')
  const chosen = clipId || usable.find((c) => c.kind === 'full')?.id || usable[0]?.id || ''
  const outside = isCode(accept.error, 'SLOT_OUTSIDE_CLIP')

  const place = () => {
    if (!chosen) return
    accept.mutate(
      { id: slot.id, clipId: chosen },
      { onSuccess: () => toast.success('Sponsor read placed', `The ${brand} segment is in the clip as a suggestion. Open the editor to review it.`) },
    )
  }

  return (
    <div className="mon-slot" data-testid="slot-card" data-status={slot.status}>
      <div className="mon-slot-head">
        <span className="mon-slot-n">{index + 1}</span>
        <div>
          <b>{formatTimecode(slot.at_sec)}</b>
          <span className="muted small"> · {KIND_LABEL[slot.kind]} · score {Math.round(slot.score * 100)}</span>
        </div>
        <ProvenanceBadge {...slot.provenance} />
      </div>
      <p className="muted small">{slot.rationale}</p>
      <Field label="Sponsor read" htmlFor={`slot-${slot.id}`} hint={slot.integration_script ? undefined : 'Write the read here, or add an AI key to have it drafted.'}>
        <Textarea id={`slot-${slot.id}`} rows={4} value={script} onChange={(e) => setScript(e.target.value)} readOnly={!canEdit || slot.status === 'accepted'} data-testid="slot-script" />
      </Field>
      {slot.lower_third && <p className="small">On screen: {slot.lower_third}</p>}
      {slot.transition_back && <p className="small muted">Back to the video: &ldquo;{slot.transition_back}&rdquo;</p>}
      {slot.status === 'accepted' ? (
        <p className="small" data-testid="slot-placed">
          Placed in a clip. <Link href={`/editor/${slot.clip_id}`}>Open the editor</Link> to review or record it.
        </p>
      ) : (
        canEdit && (
          <div className="mon-row">
            {dirty && (
              <Button size="sm" variant="secondary" loading={update.isPending} onClick={() => update.mutate({ id: slot.id, integration_script: script })}>
                Save read
              </Button>
            )}
            {usable.length > 0 ? (
              <>
                <Select aria-label="Clip to place the read in" value={chosen} onChange={(e) => setClipId(e.target.value)} data-testid="slot-clip">
                  {usable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.kind === 'full' ? 'Full cut' : c.title || 'Clip'} ({formatTimecode(c.start_sec)} to {formatTimecode(c.end_sec)})
                    </option>
                  ))}
                </Select>
                <Button size="sm" onClick={place} loading={accept.isPending} disabled={dirty} title={dirty ? 'Save the read first' : undefined} data-testid="slot-accept">
                  Place in clip
                </Button>
              </>
            ) : (
              <span className="small muted">
                Generate clips in the <Link href={`/projects/${itemId}/clips`}>Clips</Link> tab (include the full cut) to place this read.
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: slot.id, status: 'rejected' })} aria-label="Dismiss this slot">
              <X size={13} />
            </Button>
          </div>
        )
      )}
      {accept.error && (
        <p className="field-error" role="alert">
          {outside ? 'That clip does not include this moment. Choose the full cut or a clip that covers it.' : errorMessage(accept.error)}
        </p>
      )}
    </div>
  )
}

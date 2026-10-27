'use client'

import { useState, type FormEvent } from 'react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { errorMessage } from '@/lib/api/errors'
import { useContentList } from '@/lib/api/hooks'
import { DEAL_STAGES, useSaveDeal, type Deal, type DealInput, type DealStage } from '@/lib/api/monetization'
import { stripDemo } from '@/lib/format'

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD']

/** Create or edit a brand deal. Every value is the creator's own; nothing is pre-filled with guesses. */
export function DealDialog({
  open,
  onOpenChange,
  deal,
  initial,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deal?: Deal | null
  /** Pre-fill for a new deal (from the brand lookup). */
  initial?: DealInput
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={deal ? `Edit ${deal.brand}` : 'New brand deal'} eyebrow="Monetization" size="lg">
      {open && <DealForm key={deal?.id ?? 'new'} deal={deal ?? null} initial={initial} onDone={() => onOpenChange(false)} />}
    </Modal>
  )
}

function DealForm({ deal, initial, onDone }: { deal: Deal | null; initial?: DealInput; onDone: () => void }) {
  const save = useSaveDeal()
  const projects = useContentList()
  const start = deal ?? initial ?? {}
  const [brand, setBrand] = useState(start.brand ?? '')
  const [website, setWebsite] = useState(start.website ?? '')
  const [contactName, setContactName] = useState(start.contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(start.contact_email ?? '')
  const [stage, setStage] = useState<DealStage>((start.stage as DealStage) ?? 'prospect')
  const [fee, setFee] = useState(start.fee != null ? String(start.fee) : '')
  const [currency, setCurrency] = useState(start.currency ?? 'USD')
  const [deliverables, setDeliverables] = useState(start.deliverables ?? '')
  const [due, setDue] = useState(start.due_date ?? '')
  const [notes, setNotes] = useState(start.notes ?? '')
  const [project, setProject] = useState(start.content_item_id ?? '')

  const feeNum = fee.trim() === '' ? null : Number(fee)
  const feeBad = feeNum !== null && (!Number.isFinite(feeNum) || feeNum < 0)
  const emailBad = contactEmail.trim() !== '' && !/^\S+@\S+\.\S+$/.test(contactEmail.trim())

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!brand.trim() || feeBad || emailBad) return
    save.mutate(
      {
        id: deal?.id,
        brand: brand.trim(),
        website: website.trim(),
        contact_name: contactName.trim(),
        contact_email: contactEmail.trim(),
        stage,
        fee: feeNum,
        currency,
        deliverables: deliverables.trim(),
        due_date: due || null,
        notes: notes.trim(),
        content_item_id: project || null,
      },
      { onSuccess: onDone },
    )
  }

  return (
    <form onSubmit={submit} className="mon-form" data-testid="deal-form">
      <div className="mon-form-grid">
        <Field label="Brand" htmlFor="deal-brand">
          <Input id="deal-brand" value={brand} onChange={(e) => setBrand(e.target.value)} required maxLength={120} autoFocus data-testid="deal-brand" />
        </Field>
        <Field label="Website" htmlFor="deal-site" hint="Used by the lookup and in the pitch">
          <Input id="deal-site" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="acme.com" maxLength={300} />
        </Field>
        <Field label="Contact name" htmlFor="deal-cname">
          <Input id="deal-cname" value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Contact email" htmlFor="deal-cemail" error={emailBad ? 'That does not look like an email address' : null}>
          <Input id="deal-cemail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Stage" htmlFor="deal-stage">
          <Select id="deal-stage" value={stage} onChange={(e) => setStage(e.target.value as DealStage)} data-testid="deal-stage">
            {DEAL_STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="mon-fee">
          <Field label="Fee" htmlFor="deal-fee" error={feeBad ? 'Enter a positive number' : null}>
            <Input id="deal-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="Agreed or asked" data-testid="deal-fee" />
          </Field>
          <Field label="Currency" htmlFor="deal-cur">
            <Select id="deal-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set([currency, ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Due date" htmlFor="deal-due" hint="When the deliverable is due">
          <Input id="deal-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Video (optional)" htmlFor="deal-project">
          <Select id="deal-project" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">Not linked</option>
            {projects.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {stripDemo(p.title)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Deliverables" htmlFor="deal-deliv" hint="e.g. a 60 second mid-roll, a link in the description and a pinned comment">
        <Textarea id="deal-deliv" rows={2} value={deliverables} onChange={(e) => setDeliverables(e.target.value)} maxLength={1000} />
      </Field>
      <Field label="Notes" htmlFor="deal-notes">
        <Textarea id="deal-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
      </Field>
      {save.error && (
        <p className="field-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="modal-foot" style={{ padding: 0, border: 0 }}>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending} disabled={!brand.trim() || feeBad || emailBad} data-testid="deal-save">
          {deal ? 'Save deal' : 'Add deal'}
        </Button>
      </div>
    </form>
  )
}

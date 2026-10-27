'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { AlertTriangle, BadgeDollarSign, CalendarClock, Calculator, ExternalLink, Globe, Handshake, Mail, Pencil, Plus, Search, Sparkles, Trash2, Trophy, Wallet } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { Segmented } from '@/components/common/segmented'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { CopyButton } from '@/components/common/copy-button'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api/errors'
import {
  DEAL_STAGES,
  money,
  useBrandLookup,
  useDealSummary,
  useDeals,
  useDeleteDeal,
  useRateEstimate,
  useSaveDeal,
  type Deal,
  type DealInput,
  type DealStage,
} from '@/lib/api/monetization'
import { DealDialog } from './deal-dialog'
import { PitchDialog } from './pitch-dialog'

type Tab = 'pipeline' | 'rate' | 'lookup'

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="ins-stat">
      <span className="ins-stat-icon" aria-hidden>
        {icon}
      </span>
      <small>{label}</small>
      <b>{value}</b>
      {hint && <em>{hint}</em>}
    </div>
  )
}

/** Monetization studio: the creator's own deal pipeline, pitches, a rate estimate and a brand lookup. */
export function MonetizationView() {
  const [tab, setTab] = useState<Tab>('pipeline')
  const [editing, setEditing] = useState<Deal | null>(null)
  const [creating, setCreating] = useState<DealInput | null>(null)
  const [pitching, setPitching] = useState<Deal | null>(null)
  const summary = useDealSummary()
  const s = summary.data
  const cur = s?.currency ?? 'USD'

  return (
    <div className="page" data-testid="monetization-page">
      <PageHeader
        eyebrow="CreatorAI / Grow"
        title="Monetization"
        description="Track brand deals from first email to paid, write pitches from your real numbers, and price an integration. Every figure here is one you entered."
        actions={
          <Button onClick={() => setCreating({})} data-testid="new-deal">
            <Plus size={14} /> New deal
          </Button>
        }
      />

      {summary.isPending ? (
        <div className="ins-grid mon-stats">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ height: 104 }} />
          ))}
        </div>
      ) : s ? (
        <div className="ins-grid mon-stats" data-testid="deal-summary">
          <Stat icon={<Handshake size={16} />} label="Open pipeline" value={money(s.open_value, cur)} hint={`${s.total} ${s.total === 1 ? 'deal' : 'deals'} in total`} />
          <Stat icon={<BadgeDollarSign size={16} />} label="Booked, not paid" value={money(s.booked_value, cur)} hint="Contracted or delivered" />
          <Stat icon={<Wallet size={16} />} label="Paid" value={money(s.paid_value, cur)} hint={s.average_paid_fee == null ? 'Shows once a deal is paid' : `${money(s.average_paid_fee, cur)} average`} />
          <Stat icon={<Trophy size={16} />} label="Win rate" value={s.win_rate == null ? '–' : `${Math.round(s.win_rate * 100)}%`} hint={s.win_rate == null ? 'Needs a closed deal' : 'Of deals that closed'} />
        </div>
      ) : null}
      {s && s.currencies.length > 1 && (
        <p className="muted small">Deals use {s.currencies.join(', ')}: totals add the numbers as typed, without converting currencies.</p>
      )}

      {s && s.overdue.length > 0 && (
        <div className="notice notice-amber" role="status" data-testid="overdue">
          <AlertTriangle size={16} aria-hidden />
          <div className="notice-body">
            <b>Past due</b>
            <p>{s.overdue.map((d) => `${d.brand} (${d.due_date})`).join(', ')}</p>
          </div>
        </div>
      )}

      <Segmented
        label="Section"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'pipeline', label: 'Deals' },
          { value: 'rate', label: 'Rate calculator' },
          { value: 'lookup', label: 'Brand lookup' },
        ]}
      />

      {tab === 'pipeline' && <Pipeline onEdit={setEditing} onPitch={setPitching} onCreate={() => setCreating({})} />}
      {tab === 'rate' && <RateCalculator />}
      {tab === 'lookup' && <BrandLookupPanel onAdd={(d) => setCreating(d)} />}

      <DealDialog open={!!editing || !!creating} onOpenChange={(o) => !o && (setEditing(null), setCreating(null))} deal={editing} initial={creating ?? undefined} />
      <PitchDialog deal={pitching} onOpenChange={(o) => !o && setPitching(null)} />
    </div>
  )
}

function Pipeline({ onEdit, onPitch, onCreate }: { onEdit: (d: Deal) => void; onPitch: (d: Deal) => void; onCreate: () => void }) {
  const deals = useDeals()
  const save = useSaveDeal()
  const del = useDeleteDeal()
  const [removing, setRemoving] = useState<Deal | null>(null)

  if (deals.isPending) return <Skeleton style={{ height: 260 }} />
  if (deals.isError) return <ErrorState error={deals.error} onRetry={() => void deals.refetch()} title="Could not load deals" />
  if (deals.data.length === 0)
    return (
      <EmptyState
        icon={<Handshake size={22} />}
        title="No brand deals yet"
        description="Add the brands you are talking to, or one you would like to work with. Use Brand lookup to find the contact they publish."
        actions={
          <Button size="sm" onClick={onCreate}>
            <Plus size={13} /> Add your first deal
          </Button>
        }
      />
    )

  return (
    <>
      <div className="mon-board" data-testid="deal-board">
        {DEAL_STAGES.map((stage) => {
          const cards = deals.data.filter((d) => d.stage === stage.id)
          return (
            <section key={stage.id} className="mon-col" data-stage={stage.id} aria-label={stage.label}>
              <header>
                <span>{stage.label}</span>
                <b>{cards.length}</b>
              </header>
              {cards.map((d) => (
                <article key={d.id} className="mon-card" data-testid="deal-card" data-overdue={d.overdue || undefined}>
                  <div className="mon-card-top">
                    <h3>{d.brand}</h3>
                    {d.fee != null && <span className="mon-fee-tag">{money(d.fee, d.currency)}</span>}
                  </div>
                  {d.deliverables && <p className="mon-deliv">{d.deliverables}</p>}
                  <div className="mon-meta">
                    {d.due_date && (
                      <span className={d.overdue ? 'mon-due late' : 'mon-due'}>
                        <CalendarClock size={12} aria-hidden /> {d.due_date}
                      </span>
                    )}
                    {d.contact_email && (
                      <a href={`mailto:${d.contact_email}`} className="mon-contact" title={d.contact_name || d.contact_email}>
                        <Mail size={12} aria-hidden /> {d.contact_name || d.contact_email}
                      </a>
                    )}
                    {d.content_item_id && (
                      <Link href={`/projects/${d.content_item_id}/sponsors`} className="mon-contact">
                        Sponsor slots
                      </Link>
                    )}
                  </div>
                  <div className="mon-actions">
                    <Select
                      aria-label={`Stage of ${d.brand}`}
                      value={d.stage}
                      onChange={(e) => save.mutate({ id: d.id, stage: e.target.value as DealStage })}
                      data-testid="deal-move"
                    >
                      {DEAL_STAGES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                    <div className="mon-buttons">
                      <Button size="sm" variant="secondary" onClick={() => onPitch(d)} data-testid="deal-pitch">
                        <Sparkles size={13} /> {d.pitch ? 'Pitch' : 'Write pitch'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onEdit(d)} aria-label={`Edit ${d.brand}`}>
                        <Pencil size={13} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(d)} aria-label={`Delete ${d.brand}`}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          )
        })}
      </div>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Delete the ${removing?.brand ?? ''} deal?`}
        description="Its notes and pitch are removed too. This cannot be undone."
        confirmLabel="Delete deal"
        danger
        loading={del.isPending}
        onConfirm={() => removing && del.mutate(removing.id, { onSuccess: () => setRemoving(null) })}
      />
    </>
  )
}

function RateCalculator() {
  const rate = useRateEstimate()
  const [views, setViews] = useState('')
  const [low, setLow] = useState('20')
  const [high, setHigh] = useState('40')
  const [placements, setPlacements] = useState('1')
  const r = rate.data

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = Number(views.replace(/[, ]/g, ''))
    if (!Number.isFinite(v) || v < 1) return
    rate.mutate({ avg_views: Math.round(v), cpm_low: Number(low) || 0, cpm_high: Number(high) || 0, placements: Math.max(1, Number(placements) || 1) })
  }

  return (
    <section className="card" data-testid="rate-card">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">
            <Calculator size={12} aria-hidden /> Rate calculator
          </div>
          <h2>What to charge for an integration</h2>
        </div>
      </div>
      <p className="muted small">
        Brands usually price a sponsored segment per thousand expected views (CPM). Start from your real average views. The 20 to 40 range is only a starting point that
        creators often quote: change it to what your niche and past deals support.
      </p>
      <form onSubmit={submit} className="mon-rate-form">
        <Field label="Average views per video" htmlFor="rate-views" hint="Views in the first 30 days are what brands pay for">
          <Input id="rate-views" inputMode="numeric" value={views} onChange={(e) => setViews(e.target.value)} placeholder="e.g. 18000" required data-testid="rate-views" />
        </Field>
        <Field label="CPM low" htmlFor="rate-low">
          <Input id="rate-low" inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} />
        </Field>
        <Field label="CPM high" htmlFor="rate-high">
          <Input id="rate-high" inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} />
        </Field>
        <Field label="Videos in the package" htmlFor="rate-n">
          <Input id="rate-n" inputMode="numeric" value={placements} onChange={(e) => setPlacements(e.target.value)} />
        </Field>
        <Button type="submit" loading={rate.isPending} data-testid="rate-run">
          Estimate
        </Button>
      </form>
      {rate.error && (
        <p className="field-error" role="alert">
          {errorMessage(rate.error)}
        </p>
      )}
      {r && (
        <div className="mon-rate-out" data-testid="rate-result">
          <div className="mon-rate-range">
            <div>
              <small>Low</small>
              <b>{money(r.low)}</b>
            </div>
            <div className="mid">
              <small>Middle</small>
              <b>{money(r.mid)}</b>
            </div>
            <div>
              <small>High</small>
              <b>{money(r.high)}</b>
            </div>
            <ProvenanceBadge source="heuristic" provider="rate-formula" />
          </div>
          <p className="muted small">
            {r.avg_views.toLocaleString()} views / 1000 x {r.cpm_low} to {r.cpm_high} CPM x {r.placements} {r.placements === 1 ? 'video' : 'videos'}.
          </p>
          {r.history.paid_deals > 0 ? (
            <p className="small">
              Your own history: {r.history.paid_deals} paid {r.history.paid_deals === 1 ? 'deal' : 'deals'}, {money(r.history.average_fee)} on average, {money(r.history.highest_fee)} at most. Weigh this
              more than the formula.
            </p>
          ) : (
            <p className="muted small">Mark deals as Paid and their fees show up here as your own benchmark.</p>
          )}
        </div>
      )}
    </section>
  )
}

function BrandLookupPanel({ onAdd }: { onAdd: (d: DealInput) => void }) {
  const lookup = useBrandLookup()
  const [site, setSite] = useState('')
  const r = lookup.data

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (site.trim().length >= 3) lookup.mutate(site.trim())
  }

  return (
    <section className="card" data-testid="lookup-card">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">
            <Globe size={12} aria-hidden /> Brand lookup
          </div>
          <h2>Who to contact at a brand</h2>
        </div>
      </div>
      <p className="muted small">
        Reads the brand&apos;s own home, contact, partnerships, press and about pages, and lists the email addresses and social accounts printed there, with the page each
        came from. It never guesses an address.
      </p>
      <form onSubmit={submit} className="research-form">
        <Input value={site} onChange={(e) => setSite(e.target.value)} placeholder="Brand website, e.g. acme.com" aria-label="Brand website" maxLength={300} data-testid="lookup-site" />
        <Button type="submit" loading={lookup.isPending} disabled={site.trim().length < 3} data-testid="lookup-run">
          <Search size={14} /> Look up
        </Button>
      </form>
      {lookup.error && (
        <p className="field-error" role="alert" data-testid="lookup-error">
          {errorMessage(lookup.error)}
        </p>
      )}
      {r && (
        <div className="mon-lookup" data-testid="lookup-result">
          <div className="mon-lookup-head">
            <div>
              <h3>{r.title || r.site}</h3>
              {r.description && <p className="muted small">{r.description}</p>}
            </div>
            <Button size="sm" onClick={() => onAdd({ brand: r.title.split(/[|\-–:]/)[0]?.trim() || new URL(r.site).hostname, website: r.site, contact_email: r.emails[0]?.email ?? '' })} data-testid="lookup-add">
              <Plus size={13} /> Add as deal
            </Button>
          </div>
          {r.emails.length > 0 ? (
            <ul className="mon-emails">
              {r.emails.map((e) => (
                <li key={e.email}>
                  <a href={`mailto:${e.email}`}>{e.email}</a>
                  <CopyButton text={e.email} label={`Copy ${e.email}`} />
                  <a href={e.found_on} target="_blank" rel="noreferrer noopener" className="muted small">
                    found on {new URL(e.found_on).pathname || '/'} <ExternalLink size={10} aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small">No email address is printed on these pages.</p>
          )}
          {Object.keys(r.socials).length > 0 && (
            <p className="mon-socials small">
              {Object.entries(r.socials).map(([k, url]) => (
                <a key={k} href={url} target="_blank" rel="noreferrer noopener">
                  {k} <ExternalLink size={10} aria-hidden />
                </a>
              ))}
            </p>
          )}
          <p className="muted small">{r.note}</p>
          <details>
            <summary className="small">Pages checked ({r.pages.length})</summary>
            <ul className="small">
              {r.pages.map((p) => (
                <li key={p.url}>
                  {p.url} · {p.status ?? p.error ?? 'failed'}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </section>
  )
}

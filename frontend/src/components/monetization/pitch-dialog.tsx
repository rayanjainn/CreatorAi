'use client'

import { useState, type FormEvent } from 'react'
import { Mail, Sparkles } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { CopyButton } from '@/components/common/copy-button'
import { LlmNotice, isLlmError } from '@/components/common/llm-notice'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { errorMessage } from '@/lib/api/errors'
import { usePitch, type ChannelStats, type Deal } from '@/lib/api/monetization'
import { relativeTime } from '@/lib/time'

const STATS_KEY = 'creatorai.channelStats'

function loadStats(): ChannelStats {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY) || '{}') as ChannelStats
  } catch {
    return {}
  }
}

/**
 * Pitch email for one deal. The model may only use the numbers typed here (the backend prompt forbids
 * invented statistics); the numbers are remembered in this browser for the next pitch.
 */
export function PitchDialog({ deal, onOpenChange }: { deal: Deal | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Modal open={!!deal} onOpenChange={onOpenChange} title={deal ? `Pitch ${deal.brand}` : 'Pitch'} eyebrow="Sponsor pitch" size="lg">
      {deal && <PitchBody key={deal.id} deal={deal} />}
    </Modal>
  )
}

function PitchBody({ deal }: { deal: Deal }) {
  const pitch = usePitch()
  const [stats, setStats] = useState<ChannelStats>(loadStats)
  const [notes, setNotes] = useState('')
  const current = pitch.data?.pitch ?? deal.pitch
  const set = (k: keyof ChannelStats) => (e: React.ChangeEvent<HTMLInputElement>) => setStats((s) => ({ ...s, [k]: e.target.value }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats))
    } catch {
      /* private mode: nothing to remember */
    }
    pitch.mutate({ id: deal.id, stats, notes })
  }

  const mailto = current && deal.contact_email ? `mailto:${deal.contact_email}?subject=${encodeURIComponent(current.subject)}&body=${encodeURIComponent(current.email)}` : null

  return (
    <div className="mon-pitch" data-testid="pitch-dialog">
      <form onSubmit={submit} className="mon-form">
        <p className="muted small">
          Your numbers, as you want them quoted. Leave a field empty and the pitch will not mention it: nothing is made up.
        </p>
        <div className="mon-form-grid">
          <Field label="Subscribers" htmlFor="ps-subs">
            <Input id="ps-subs" value={stats.subscribers ?? ''} onChange={set('subscribers')} placeholder="e.g. 48,000" maxLength={60} />
          </Field>
          <Field label="Average views per video" htmlFor="ps-views">
            <Input id="ps-views" value={stats.avg_views ?? ''} onChange={set('avg_views')} placeholder="e.g. 15k in the first 30 days" maxLength={60} />
          </Field>
          <Field label="Audience" htmlFor="ps-aud">
            <Input id="ps-aud" value={stats.audience ?? ''} onChange={set('audience')} placeholder="e.g. indie developers, 25 to 34" maxLength={300} />
          </Field>
          <Field label="Top countries" htmlFor="ps-geo">
            <Input id="ps-geo" value={stats.top_countries ?? ''} onChange={set('top_countries')} placeholder="e.g. US, UK, India" maxLength={200} />
          </Field>
        </div>
        <Field label="Anything else to mention" htmlFor="ps-notes">
          <Input id="ps-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. I already use their product daily" maxLength={600} />
        </Field>
        <div>
          <Button type="submit" loading={pitch.isPending} data-testid="pitch-generate">
            <Sparkles size={14} /> {current ? 'Write a new version' : 'Write the pitch'}
          </Button>
        </div>
      </form>

      {pitch.error && (isLlmError(pitch.error) ? <LlmNotice error={pitch.error} /> : <p className="field-error" role="alert">{errorMessage(pitch.error)}</p>)}

      {current && (
        <article className="mon-pitch-out" data-testid="pitch-output">
          <div className="mon-pitch-head">
            <div>
              <div className="eyebrow violet-text">Written {relativeTime(current.created_at)}</div>
              <h3>{current.subject}</h3>
            </div>
            <ProvenanceBadge {...current.provenance} />
          </div>
          <div className="mon-copy-row">
            <span className="muted small">Subject</span>
            <CopyButton text={current.subject} label="Copy subject" />
          </div>
          <pre className="mon-email">{current.email}</pre>
          <div className="mon-copy-row">
            <span className="muted small">Email body</span>
            <CopyButton text={current.email} label="Copy email" />
            {mailto && (
              <a className="button button-sm" href={mailto}>
                <Mail size={13} /> Open in mail app
              </a>
            )}
          </div>
          {current.talking_points.length > 0 && (
            <>
              <h4>For the call</h4>
              <ul>
                {current.talking_points.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </>
          )}
          {current.follow_up && (
            <>
              <h4>Follow-up a week later</h4>
              <p>{current.follow_up}</p>
            </>
          )}
          <p className="muted small">Read it before you send it. Move the deal to Pitched once it is out.</p>
        </article>
      )}
    </div>
  )
}

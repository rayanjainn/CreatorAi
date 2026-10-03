'use client'

import { useId, useState, type FormEvent } from 'react'
import { Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { LlmNotice } from '@/components/common/llm-notice'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { DOMAINS } from '@/components/board/new-content-dialog'
import { useGeneratePlan, useMe } from '@/lib/api/hooks'
import type { Card, Domain } from '@/lib/api/types'

export const PLATFORMS = [
  { value: 'youtube_shorts', label: 'YouTube Shorts' },
  { value: 'youtube', label: 'YouTube (long)' },
  { value: 'instagram_reels', label: 'Instagram Reels' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'linkedin', label: 'LinkedIn' },
]

/** Brief for the AI Director. Every field defaults from the project and the creator profile. */
export function DirectorForm({ item, onDone, hasPlan }: { item: Card; onDone?: () => void; hasPlan: boolean }) {
  const me = useMe()
  const profile = me.data?.profile
  const gen = useGeneratePlan(item.id)
  const ids = { objective: useId(), audience: useId(), domain: useId(), length: useId(), platform: useId() }
  const [objective, setObjective] = useState(item.objective || item.idea_text || '')
  const [audience, setAudience] = useState<string | null>(null)
  const [domain, setDomain] = useState<Domain | ''>((item.domain as Domain | null) ?? '')
  const [length, setLength] = useState(String(item.target_duration_sec ?? 45))
  const [platform, setPlatform] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    gen.mutate(
      {
        objective: objective.trim() || undefined,
        audience: (audience ?? profile?.audience ?? '').trim() || undefined,
        domain: domain || undefined,
        target_duration_sec: Number(length) || undefined,
        platform: platform ?? profile?.platforms?.[0] ?? undefined,
      },
      { onSuccess: () => onDone?.() },
    )
  }

  return (
    <form className="card director-form" onSubmit={submit} data-testid="director-form">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">AI Director</div>
          <h2>{hasPlan ? 'Generate a new plan version' : 'What are you making?'}</h2>
        </div>
      </div>
      <p className="muted small" style={{ margin: '6px 0 16px' }}>
        The Director proposes an angle, a timed structure, storytelling tips, hook ideas and a shot list. Old versions are kept.
      </p>
      <div className="form-grid">
        <Field label="Objective" htmlFor={ids.objective} className="span-all">
          <Textarea id={ids.objective} rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What should a viewer know, feel or do afterwards?" maxLength={1000} />
        </Field>
        <Field label="Audience" htmlFor={ids.audience}>
          <Input id={ids.audience} value={audience ?? profile?.audience ?? ''} onChange={(e) => setAudience(e.target.value)} placeholder="Who is this for?" maxLength={300} />
        </Field>
        <Field label="Domain" htmlFor={ids.domain}>
          <Select id={ids.domain} value={domain} onChange={(e) => setDomain(e.target.value as Domain | '')}>
            <option value="">Use my profile</option>
            {DOMAINS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Target length (seconds)" htmlFor={ids.length}>
          <Input id={ids.length} type="number" min={10} max={3600} value={length} onChange={(e) => setLength(e.target.value)} />
        </Field>
        <Field label="Platform" htmlFor={ids.platform}>
          <Select id={ids.platform} value={platform ?? profile?.platforms?.[0] ?? 'youtube_shorts'} onChange={(e) => setPlatform(e.target.value)}>
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <LlmNotice error={gen.error} onRetry={() => gen.mutate({})} className="mt" />
      <div className="form-foot">
        <span className="muted small">
          {gen.data ? (
            <>
              Generated v{gen.data.version} <ProvenanceBadge {...gen.data.provenance} />
            </>
          ) : (
            'Takes a few seconds.'
          )}
        </span>
        <Button type="submit" loading={gen.isPending} data-testid="generate-plan">
          <Wand2 size={14} /> {hasPlan ? 'Generate new version' : 'Generate plan'}
        </Button>
      </div>
    </form>
  )
}

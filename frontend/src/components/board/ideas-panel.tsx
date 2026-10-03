'use client'

import { useState, type FormEvent } from 'react'
import { Check, Lightbulb, Wand2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { useDataMode } from '@/components/provenance/data-mode'
import { useAcceptIdea, useDismissIdea, useGenerateIdeas, useIdeas } from '@/lib/api/hooks'
import type { Provenance } from '@/lib/api/types'
import { relativeTime } from '@/lib/time'

export function IdeasPanel() {
  const ideas = useIdeas('suggested')
  const gen = useGenerateIdeas()
  const accept = useAcceptIdea()
  const dismiss = useDismissIdea()
  const { mode } = useDataMode()
  const [topic, setTopic] = useState('')
  const off = mode === 'unconfigured'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    gen.mutate({ topic: topic.trim() || undefined, count: 5 })
  }

  return (
    <aside className="card ideas-panel" aria-labelledby="ideas-h" data-testid="ideas-panel">
      <div className="card-heading">
        <div>
          <div className="eyebrow amber-text">Idea suggestions</div>
          <h2 id="ideas-h">What to make next</h2>
        </div>
        <Lightbulb size={18} style={{ color: 'var(--amber)' }} aria-hidden />
      </div>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <Input aria-label="Topic for new ideas" placeholder="Topic (optional)" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300} />
        <Button type="submit" size="sm" loading={gen.isPending} disabled={off} title={off ? 'Add an AI key to generate ideas' : 'Generate ideas'} style={{ minHeight: 40 }}>
          <Wand2 size={14} /> Generate
        </Button>
      </form>
      {off && <p className="field-hint">Idea generation needs an AI key. Existing suggestions below still work.</p>}
      <div className="ideas-list">
        {ideas.isPending ? (
          [0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 98, borderRadius: 12 }} />)
        ) : ideas.isError ? (
          <ErrorState error={ideas.error} onRetry={() => ideas.refetch()} title="Could not load ideas" />
        ) : ideas.data.items.length === 0 ? (
          <EmptyState compact icon={<Lightbulb size={20} />} title="No suggestions yet" description={off ? 'Set up an AI provider, then generate ideas tailored to your channel.' : 'Generate a batch tailored to your channel and recent titles.'} />
        ) : (
          ideas.data.items.map((idea) => (
            <article key={idea.id} className="idea-card" data-testid="idea-card">
              <div className="idea-top">
                {idea.provenance ? <ProvenanceBadge {...(idea.provenance as Provenance)} /> : <ProvenanceBadge source="heuristic" label="Unlabelled" />}
                <small>{relativeTime(idea.created_at)}</small>
              </div>
              <b>{idea.title}</b>
              {idea.rationale && <p>{idea.rationale}</p>}
              <div className="idea-actions">
                <Button size="sm" onClick={() => accept.mutate(idea.id)} loading={accept.isPending && accept.variables === idea.id} aria-label={`Add “${idea.title}” to the board`}>
                  <Check size={13} /> Add to board
                </Button>
                <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(idea.id)} aria-label={`Dismiss “${idea.title}”`}>
                  <X size={13} /> Dismiss
                </Button>
              </div>
            </article>
          ))
        )}
      </div>
    </aside>
  )
}

'use client'

import { use, useState, type FormEvent } from 'react'
import { ExternalLink, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { LlmNotice, isLlmError } from '@/components/common/llm-notice'
import { EmptyState } from '@/components/common/empty-state'
import { useContentItem, useResearch, useRunResearch } from '@/lib/api/hooks'
import { isCode } from '@/lib/api/errors'
import { stripDemo } from '@/lib/format'
import { relativeTime } from '@/lib/time'
import { useProjectRole } from '@/lib/use-role'
import type { Card } from '@/lib/api/types'

/** Research: ask a question, get a short brief built only from web results, with the links it used. */
export default function ResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const item = useContentItem(id).data as Card | undefined
  const briefs = useResearch(id)
  const run = useRunResearch(id)
  const { canEdit } = useProjectRole(id)
  const [topic, setTopic] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (topic.trim().length >= 3) run.mutate(topic.trim(), { onSuccess: () => setTopic('') })
  }
  const err = run.error
  const needsKey = isCode(err, 'SEARCH_NOT_CONFIGURED')

  return (
    <div className="stack" data-testid="research-page">
      <section className="card">
        <div className="card-heading">
          <div>
            <div className="eyebrow violet-text">Research</div>
            <h2>What should this video get right?</h2>
          </div>
        </div>
        <p className="muted small">Ask about a topic. CreatorAi searches the web and writes a brief using only what it found, with links you can check.</p>
        {canEdit && (
          <form onSubmit={submit} className="research-form">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={item ? `e.g. ${stripDemo(item.title)}` : 'A topic to research'} aria-label="Research topic" maxLength={300} data-testid="research-topic" />
            <Button type="submit" loading={run.isPending} disabled={topic.trim().length < 3} data-testid="research-run">
              <Search size={14} /> Research
            </Button>
          </form>
        )}
        {err && needsKey && (
          <p className="auth-alert info" role="status" data-testid="search-not-configured">
            Research needs a web search key. Add <code>TAVILY_API_KEY</code> (or <code>SERPER_API_KEY</code> with <code>SEARCH_PROVIDER=serper</code>) to <code>.env</code> and restart the API. Both have free tiers.
          </p>
        )}
        {err && !needsKey && (isLlmError(err) ? <LlmNotice error={err} /> : <p className="twin-error" role="alert">{(err as Error).message}</p>)}
      </section>

      {briefs.isPending ? (
        <Skeleton style={{ height: 140 }} />
      ) : briefs.data && briefs.data.length === 0 ? (
        <EmptyState compact title="No research yet" description="Your briefs for this project show up here." />
      ) : (
        briefs.data?.map((b) => (
          <article key={b.id} className="card research-brief" data-testid="research-brief">
            <div className="card-heading">
              <div>
                <div className="eyebrow violet-text">{relativeTime(b.created_at)}</div>
                <h2>{b.topic}</h2>
              </div>
              {b.provenance && <ProvenanceBadge source={b.provenance.source as 'ai'} provider={b.provenance.provider ?? undefined} model={b.provenance.model ?? undefined} />}
            </div>
            <p>{b.doc.summary}</p>
            <h3>Key points</h3>
            <ul>
              {b.doc.key_points.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ul>
            {b.doc.trends.length > 0 && (
              <>
                <h3>What is trending</h3>
                <ul>
                  {b.doc.trends.map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ul>
              </>
            )}
            <h3>Sources</h3>
            <ul className="research-sources">
              {b.doc.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer noopener">
                    {s.title} <ExternalLink size={11} aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </article>
        ))
      )}
    </div>
  )
}

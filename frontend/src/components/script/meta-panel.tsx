'use client'

import { Tags } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/empty-state'
import { CopyButton } from '@/components/common/copy-button'
import { LlmNotice } from '@/components/common/llm-notice'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { useGenerateMeta } from '@/lib/api/hooks'
import type { Script } from '@/lib/api/types'

function Block({ label, children, copy }: { label: string; children: React.ReactNode; copy: string }) {
  if (!copy.trim()) return null
  return (
    <div className="meta-block" data-testid="meta-block">
      <div className="meta-label">
        <span>{label}</span>
        <CopyButton text={copy} label={`Copy ${label.toLowerCase()}`} />
      </div>
      {children}
    </div>
  )
}

/** Publishing metadata for the script: titles, description, CTAs, tags, captions, pinned comment, thumbnail text. */
export function MetaPanel({ projectId, script }: { projectId: string; script: Script }) {
  const gen = useGenerateMeta(projectId)
  const m = script.meta
  const has = m.titles.length || m.description || m.ctas.length || m.captions.length || m.tags.length
  const prov = script.provenance_by_part.meta
  return (
    <section className="card" data-testid="meta-panel">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">Publishing</div>
          <h2>Titles, description and tags</h2>
        </div>
        <div className="page-actions">
          {has && prov ? <ProvenanceBadge {...prov} /> : null}
          <Button variant={has ? 'secondary' : 'primary'} size="sm" loading={gen.isPending} disabled={!script.scenes.length} onClick={() => gen.mutate(script.id)} data-testid="generate-meta">
            {has ? 'Regenerate' : 'Generate metadata'}
          </Button>
        </div>
      </div>
      <LlmNotice error={gen.error} onRetry={() => gen.mutate(script.id)} className="mt" />
      {!has ? (
        <EmptyState compact icon={<Tags size={20} />} title="No metadata yet" description="Generate three title options, a description, CTAs, tags, captions, a pinned comment and thumbnail text from this script." />
      ) : (
        <div className="meta-grid">
          <Block label="Titles" copy={m.titles.join('\n')}>
            <ul className="meta-list">
              {m.titles.map((t) => (
                <li key={t}>
                  <span>{t}</span>
                  <CopyButton text={t} label="Copy title" />
                </li>
              ))}
            </ul>
          </Block>
          <Block label="Description" copy={m.description}>
            <p className="meta-text">{m.description}</p>
          </Block>
          <Block label="CTAs" copy={m.ctas.join('\n')}>
            <ul className="meta-list">
              {m.ctas.map((t) => (
                <li key={t}>
                  <span>{t}</span>
                  <CopyButton text={t} label="Copy CTA" />
                </li>
              ))}
            </ul>
          </Block>
          <Block label="Tags" copy={m.tags.join(', ')}>
            <div className="chip-row" style={{ gap: 6 }}>
              {m.tags.map((t) => (
                <span key={t} className="badge badge-gray">
                  {t}
                </span>
              ))}
            </div>
          </Block>
          <Block label="Captions" copy={m.captions.join('\n')}>
            <ul className="meta-list">
              {m.captions.map((t) => (
                <li key={t}>
                  <span>{t}</span>
                  <CopyButton text={t} label="Copy caption" />
                </li>
              ))}
            </ul>
          </Block>
          <Block label="Pinned comment" copy={m.supporting.pinned_comment ?? ''}>
            <p className="meta-text">{m.supporting.pinned_comment}</p>
          </Block>
          <Block label="Thumbnail text" copy={(m.supporting.thumbnail_text ?? []).join('\n')}>
            <ul className="meta-list">
              {(m.supporting.thumbnail_text ?? []).map((t) => (
                <li key={t}>
                  <span>{t}</span>
                  <CopyButton text={t} label="Copy thumbnail text" />
                </li>
              ))}
            </ul>
          </Block>
        </div>
      )}
    </section>
  )
}

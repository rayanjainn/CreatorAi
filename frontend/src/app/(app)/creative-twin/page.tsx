'use client'

import { BrainCircuit, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState } from '@/components/common/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { LlmNotice, isLlmError } from '@/components/common/llm-notice'
import { TwinChat } from '@/components/twin/twin-chat'
import { useTwin, useTwinStyleUpdate } from '@/lib/api/hooks'
import { relativeTime } from '@/lib/time'
import { isCode } from '@/lib/api/errors'

const KIND: Record<string, string> = { approved_script: 'Script', approved_clip: 'Clip', preference: 'Preference', feedback: 'Feedback' }

export default function CreativeTwinPage() {
  const twin = useTwin()
  const update = useTwinStyleUpdate()
  const t = twin.data
  const style = t?.style
  const learned = !!style?.summary

  return (
    <div className="page" data-testid="twin-page">
      <PageHeader
        eyebrow="CreatorAI / Grow"
        title="Creative Twin"
        description="An assistant that learns your voice from the scripts you approve and the clips you accept. It suggests; you decide."
      />
      <div className="twin-layout">
        <section className="card twin-main" aria-label="Chat with your Twin">
          <TwinChat />
        </section>

        <aside className="twin-side">
          <section className="card" aria-labelledby="style-h">
            <div className="card-heading">
              <div>
                <div className="eyebrow violet-text">Style profile</div>
                <h2 id="style-h">How you write</h2>
              </div>
              <BrainCircuit size={18} aria-hidden style={{ color: 'var(--accent-text)' }} />
            </div>
            {twin.isPending ? (
              <Skeleton style={{ height: 120 }} />
            ) : twin.isError ? (
              <ErrorState error={twin.error} onRetry={() => void twin.refetch()} />
            ) : learned ? (
              <div className="twin-style">
                <p>{style!.summary}</p>
                <div className="twin-tags">
                  {style!.tone_descriptors?.map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </div>
                {!!style!.vocabulary?.favor?.length && (
                  <p className="muted small">
                    <b>Favours:</b> {style!.vocabulary.favor.join(', ')}
                  </p>
                )}
                {!!style!.vocabulary?.avoid?.length && (
                  <p className="muted small">
                    <b>Avoids:</b> {style!.vocabulary.avoid.join(', ')}
                  </p>
                )}
                {style!.provenance && <ProvenanceBadge source={style!.provenance.source as 'ai'} provider={style!.provenance.provider ?? undefined} model={style!.provenance.model ?? undefined} />}
              </div>
            ) : (
              <p className="muted small">Nothing learned yet. Approve a script (move a project with a script to Shoot), then learn from it.</p>
            )}
            <Button size="sm" variant="secondary" loading={update.isPending} onClick={() => update.mutate()} data-testid="twin-learn" style={{ marginTop: 12 }}>
              <RefreshCw size={13} /> {learned ? 'Refresh from my scripts' : 'Learn from my scripts'}
            </Button>
            {update.isError &&
              (isLlmError(update.error) ? (
                <LlmNotice error={update.error} />
              ) : (
                <p className="twin-error" role="alert">
                  {isCode(update.error, 'NOTHING_TO_LEARN') ? (update.error as Error).message : 'Could not update the style profile.'}
                </p>
              ))}
            {t && <p className="muted small" style={{ marginTop: 8 }}>Updated {t.style_revision}×. {t.approvals_since_update} new approval{t.approvals_since_update === 1 ? '' : 's'} since.</p>}
          </section>

          <section className="card" aria-labelledby="mem-h">
            <div className="card-heading">
              <div>
                <div className="eyebrow violet-text">Memories</div>
                <h2 id="mem-h">What it remembers</h2>
              </div>
              <small>{t?.memory_count ?? 0}</small>
            </div>
            {t && t.memories.length === 0 ? (
              <p className="muted small">Empty. Approved scripts and accepted clips are remembered here and used to answer in your voice.</p>
            ) : (
              <ul className="twin-mem">
                {t?.memories.slice(0, 8).map((m) => (
                  <li key={m.id}>
                    <span>{KIND[m.kind] ?? m.kind}</span>
                    <p>{m.text}</p>
                    <small>{relativeTime(m.created_at)}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { LlmNotice } from '@/components/common/llm-notice'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { PLATFORMS } from '@/components/plan/director-form'
import { useGenerateHooks, useMe, usePatchScript } from '@/lib/api/hooks'
import type { HookOption, Script } from '@/lib/api/types'

/** Generate hook options and choose one. Hooks persist on the script, so they survive reloads. */
export function HookPicker({ projectId, script }: { projectId: string; script: Script | null }) {
  const me = useMe()
  const gen = useGenerateHooks(projectId)
  const patch = usePatchScript(projectId)
  const [tone, setTone] = useState<string | null>(null)
  const [platform, setPlatform] = useState<string | null>(null)
  const hooks: HookOption[] = gen.data?.hooks ?? script?.hook_options ?? []
  const selected = script?.selected_hook ?? ''
  const scriptId = gen.data?.script_id ?? script?.id

  const generate = () =>
    gen.mutate({ count: 5, tone: (tone ?? me.data?.profile.tone) || null, platform: platform ?? me.data?.profile.platforms?.[0] ?? null })

  return (
    <section className="card hook-picker" data-testid="hook-picker">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">Step 1</div>
          <h2>Pick a hook</h2>
        </div>
        {gen.data && <ProvenanceBadge {...gen.data.provenance} />}
      </div>
      <div className="hook-controls">
        <Input aria-label="Tone" placeholder="Tone, e.g. direct, friendly" value={tone ?? me.data?.profile.tone ?? ''} onChange={(e) => setTone(e.target.value)} />
        <Select aria-label="Platform" value={platform ?? me.data?.profile.platforms?.[0] ?? 'youtube_shorts'} onChange={(e) => setPlatform(e.target.value)}>
          {PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
        <Button onClick={generate} loading={gen.isPending} data-testid="generate-hooks">
          <Sparkles size={14} /> {hooks.length ? 'More hooks' : 'Generate hooks'}
        </Button>
      </div>
      <LlmNotice error={gen.error} onRetry={generate} className="mt" />
      {hooks.length > 0 && (
        <ul className="hook-list" data-testid="hook-list">
          {hooks.map((h) => {
            const isSel = h.text === selected
            return (
              <li key={h.text} className="hook-card" data-selected={isSel} data-testid="hook-option">
                <div className="hook-main">
                  <p>{h.text}</p>
                  {h.why && <small>{h.why}</small>}
                  <div className="hook-meta">
                    <span className="badge" data-testid="hook-type">{h.type}</span>
                    <span className="signal" title="Hook signal score from the hook rules (not the model)">
                      <span className="signal-bar">
                        <i style={{ width: `${Math.round(h.signal_score * 100)}%` }} />
                      </span>
                      <span className="mono">{Math.round(h.signal_score * 100)}</span>
                    </span>
                    {h.provenance && <ProvenanceBadge {...h.provenance} />}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={isSel ? 'secondary' : 'primary'}
                  disabled={!scriptId || patch.isPending}
                  onClick={() => scriptId && patch.mutate({ scriptId, patch: { selected_hook: h.text } })}
                  data-testid="use-hook"
                >
                  {isSel ? (
                    <>
                      <Check size={13} /> Selected
                    </>
                  ) : (
                    'Use this'
                  )}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

'use client'

import { useState } from 'react'
import { PenLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { LlmNotice } from '@/components/common/llm-notice'
import { PLATFORMS } from '@/components/plan/director-form'
import { useGenerateScript, useMe } from '@/lib/api/hooks'
import type { Card, Script } from '@/lib/api/types'

export function ScriptGenerate({ item, script }: { item: Card; script: Script | null }) {
  const me = useMe()
  const gen = useGenerateScript(item.id)
  const hook = script?.selected_hook ?? ''
  const [tone, setTone] = useState<string | null>(null)
  const [platform, setPlatform] = useState<string | null>(null)
  const [length, setLength] = useState(String(item.target_duration_sec ?? script?.length_sec ?? 45))
  const body = () => ({
    hook,
    tone: (tone ?? me.data?.profile.tone) || null,
    platform: platform ?? me.data?.profile.platforms?.[0] ?? null,
    length_sec: Number(length) || null,
  })
  return (
    <section className="card" data-testid="script-generate">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">Step 2</div>
          <h2>Generate the script</h2>
        </div>
      </div>
      <p className="muted small" style={{ margin: '6px 0 14px' }}>
        {hook ? (
          <>
            Chosen hook: <b style={{ color: '#fff' }}>“{hook}”</b>. The first scene starts with it word for word. The latest Director plan is used when there is one.
          </>
        ) : (
          'Choose a hook above first. The script opens with it.'
        )}
      </p>
      <div className="form-grid three">
        <Field label="Tone">
          <Input value={tone ?? me.data?.profile.tone ?? ''} onChange={(e) => setTone(e.target.value)} />
        </Field>
        <Field label="Platform">
          <Select value={platform ?? me.data?.profile.platforms?.[0] ?? 'youtube_shorts'} onChange={(e) => setPlatform(e.target.value)}>
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Length (seconds)">
          <Input type="number" min={10} max={3600} value={length} onChange={(e) => setLength(e.target.value)} />
        </Field>
      </div>
      <LlmNotice error={gen.error} onRetry={() => gen.mutate(body())} className="mt" />
      <div className="form-foot">
        <span className="muted small">Creates a new version; earlier ones stay in the history.</span>
        <Button disabled={!hook} loading={gen.isPending} onClick={() => gen.mutate(body())} data-testid="generate-script">
          <PenLine size={14} /> {script?.scenes.length ? 'Generate new version' : 'Generate script'}
        </Button>
      </div>
    </section>
  )
}

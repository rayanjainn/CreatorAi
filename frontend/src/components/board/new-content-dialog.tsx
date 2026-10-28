'use client'

import { useEffect, useId, useState, type FormEvent } from 'react'
import { Lightbulb, Wand2 } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { useDataMode } from '@/components/provenance/data-mode'
import { useCreateContent, useGenerateIdeas } from '@/lib/api/hooks'
import { errorMessage } from '@/lib/api/errors'
import type { Domain, Idea, Provenance, Stage } from '@/lib/api/types'
import { STAGES, isStage } from '@/lib/format'
import { useUi } from '@/stores/ui'

export const DOMAINS: { value: Domain; label: string }[] = [
  { value: 'education', label: 'Education' },
  { value: 'technology', label: 'Technology' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'lifestyle', label: 'Lifestyle' },
  { value: 'business', label: 'Business' },
]

/** Global "New content" dialog. Open it with `useUi.getState().openNewContent({title?, stage?})`. */
export function NewContentDialog() {
  const open = useUi((s) => s.newContentOpen)
  const prefill = useUi((s) => s.newContentPrefill)
  const close = useUi((s) => s.closeNewContent)
  return (
    <Modal open={open} onOpenChange={(o) => !o && close()} eyebrow="Content board" title="New content" description="Capture an idea now, plan and script it later. It lands in the column you choose.">
      {/* The form remounts on every open so state never leaks between sessions. */}
      {open && <NewContentForm key={JSON.stringify(prefill)} onDone={close} prefill={prefill} />}
    </Modal>
  )
}

function NewContentForm({ onDone, prefill }: { onDone: () => void; prefill: { title?: string; idea_text?: string; stage?: string } | null }) {
  const create = useCreateContent()
  const gen = useGenerateIdeas()
  const { mode } = useDataMode()
  const ids = { title: useId(), topic: useId(), stage: useId(), domain: useId(), notes: useId() }
  const [title, setTitle] = useState(prefill?.title ?? '')
  const [notes, setNotes] = useState(prefill?.idea_text ?? '')
  const [domain, setDomain] = useState<Domain | ''>('')
  const [stage, setStage] = useState<Stage>(prefill?.stage && isStage(prefill.stage) ? prefill.stage : 'idea')
  const [topic, setTopic] = useState('')
  const [suggestions, setSuggestions] = useState<Idea[]>([])
  const [prov, setProv] = useState<Provenance | null>(null)

  useEffect(() => {
    document.getElementById(ids.title)?.focus()
  }, [ids.title])

  const aiOff = mode === 'unconfigured'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    create.mutate(
      { title: title.trim(), idea_text: notes.trim() || undefined, domain: domain || undefined, stage },
      { onSuccess: onDone },
    )
  }

  const suggest = () =>
    gen.mutate(
      { topic: topic.trim() || undefined, count: 4 },
      {
        onSuccess: (out) => {
          setSuggestions(out.ideas)
          setProv(out.provenance as Provenance)
        },
      },
    )

  return (
    <form onSubmit={submit} className="modal-body" style={{ gap: 14 }}>
      <Field label="Title" htmlFor={ids.title}>
        <Input id={ids.title} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 3 editing mistakes that kill retention" maxLength={200} required />
      </Field>
      <div className="form-grid">
        <Field label="Column" htmlFor={ids.stage}>
          <Select id={ids.stage} value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Topic area" htmlFor={ids.domain}>
          <Select id={ids.domain} value={domain} onChange={(e) => setDomain(e.target.value as Domain | '')}>
            <option value="">Use my profile default</option>
            {DOMAINS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Notes" htmlFor={ids.notes} hint="Optional. Angle, audience, anything to remember.">
        <Textarea id={ids.notes} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} rows={3} />
      </Field>

      <div className="card" style={{ padding: 14, background: 'var(--surface-2)', borderRadius: 12, boxShadow: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Lightbulb size={15} style={{ color: 'var(--amber)' }} />
          <b style={{ fontSize: 12.5 }}>Need a spark?</b>
          {prov && <ProvenanceBadge {...prov} />}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input aria-label="Topic for idea suggestions" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (optional)" id={ids.topic} />
          <Button variant="secondary" onClick={suggest} loading={gen.isPending} disabled={aiOff} title={aiOff ? 'Add an AI key to enable idea generation' : undefined}>
            <Wand2 size={14} /> Suggest
          </Button>
        </div>
        {aiOff && <p className="field-hint" style={{ marginTop: 8 }}>No AI provider is configured yet, so idea generation is off. See Settings to add a key.</p>}
        {gen.isError && <p className="field-error" style={{ marginTop: 8 }}>{errorMessage(gen.error)}</p>}
        {suggestions.length > 0 && (
          <div className="chip-row" style={{ marginTop: 10 }}>
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip"
                aria-pressed={title === s.title}
                onClick={() => {
                  setTitle(s.title)
                  if (!notes) setNotes(s.rationale)
                }}
                title={s.rationale}
              >
                {s.title}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="modal-foot" style={{ marginTop: 6 }}>
        <Button variant="secondary" onClick={onDone} disabled={create.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending} disabled={!title.trim()} data-testid="create-content-submit">
          Add to board
        </Button>
      </div>
    </form>
  )
}

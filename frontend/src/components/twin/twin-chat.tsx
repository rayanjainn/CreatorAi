'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowUp, Check, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { LlmNotice, isLlmError } from '@/components/common/llm-notice'
import { useTwinApply, useTwinChat, useTwinClear, useTwinMessages } from '@/lib/api/hooks'
import type { TwinApplied, TwinMessage } from '@/lib/api/types'

const ACTION_LABEL: Record<string, string> = {
  tighten_pauses: 'Tighten pauses',
  set_caption_style: 'Change caption style',
  trim_clip: 'Trim the clip',
  regenerate_hooks: 'Write new hooks',
  create_idea: 'Add to my ideas',
  toggle_music: 'Toggle music',
}
const STARTERS = ['Give me three video ideas in my voice', 'How should I open my next video?', 'What do I do too much in my scripts?']

/** The Twin conversation. Replies come from a real model and carry a provenance badge; suggestions run only when you press them. */
export function TwinChat({ contentItemId, clipId, compact, beforeApply, onApplied }: { contentItemId?: string | null; clipId?: string | null; compact?: boolean; beforeApply?: () => Promise<unknown> | unknown; onApplied?: () => void }) {
  const history = useTwinMessages()
  const chat = useTwinChat()
  const apply = useTwinApply()
  const clear = useTwinClear()
  const [text, setText] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, TwinApplied>>({})
  const end = useRef<HTMLDivElement>(null)
  const msgs = history.data ?? []

  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [msgs.length, pending])

  const send = (message: string) => {
    const m = message.trim()
    if (!m || chat.isPending) return
    setPending(m)
    setText('')
    chat.mutate({ message: m, content_item_id: contentItemId, clip_id: clipId }, { onSettled: () => setPending(null) })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    send(text)
  }

  return (
    <div className="twin-chat" data-testid="twin-chat" data-compact={compact || undefined}>
      <div className="twin-log" aria-live="polite">
        {msgs.length === 0 && !pending && (
          <div className="twin-empty">
            <Sparkles size={18} aria-hidden />
            <p>Ask me anything about your next video. I answer in your voice and I get better as you approve scripts and accept clips.</p>
            <div className="twin-starters">
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m: TwinMessage) => (
          <div key={m.id} className="twin-msg" data-role={m.role}>
            <p>{m.content}</p>
            {m.role === 'assistant' && m.provenance && <ProvenanceBadge source={m.provenance.source as 'ai'} provider={m.provenance.provider ?? undefined} model={m.provenance.model ?? undefined} />}
            {m.actions?.map((a, i) => {
              const key = `${m.id}:${i}`
              const r = done[key]
              return (
                <div key={key} className="twin-action">
                  {r ? (
                    <span>
                      <Check size={13} aria-hidden /> {r.message}
                      {r.open_editor && r.clip_id && (
                        <>
                          {' '}
                          <Link href={`/editor/${r.clip_id}`} className="link">
                            Open the editor
                          </Link>
                        </>
                      )}
                    </span>
                  ) : (
                    <Button size="sm" variant="secondary" loading={apply.isPending} onClick={async () => {
                      await beforeApply?.()
                      apply.mutate({ id: m.id, index: i }, { onSuccess: (res) => { setDone((d) => ({ ...d, [key]: res })); if ((res as { reload?: boolean }).reload) setTimeout(() => onApplied?.(), 900) } })
                    }}>
                      {ACTION_LABEL[a.type] ?? a.type}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        ))}
        {pending && (
          <>
            <div className="twin-msg" data-role="user">
              <p>{pending}</p>
            </div>
            <div className="twin-msg" data-role="assistant">
              <p className="muted">Thinking…</p>
            </div>
          </>
        )}
        {chat.isError &&
          (isLlmError(chat.error) ? <LlmNotice error={chat.error} /> : <p className="twin-error" role="alert">{(chat.error as Error).message}</p>)}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="twin-input">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask your Twin…" aria-label="Message your Twin" maxLength={2000} data-testid="twin-input" />
        <button type="submit" className="twin-send" disabled={!text.trim() || chat.isPending} aria-label="Send">
          <ArrowUp size={16} />
        </button>
        {msgs.length > 0 && (
          <button type="button" className="icon-button" aria-label="Clear the conversation" title="Clear the conversation" onClick={() => clear.mutate()}>
            <Trash2 size={14} />
          </button>
        )}
      </form>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Scissors, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/field'
import { LlmNotice } from '@/components/common/llm-notice'
import { ProvenanceBadge } from '@/components/provenance/provenance-badge'
import { usePatchScript, useRewriteScene } from '@/lib/api/hooks'
import type { Provenance, Script, SceneInput } from '@/lib/api/types'

type DraftScene = { key: string; title: string; intent: string; text: string; origIdx: number }

const WPS = 2.5 // words per second, same constant as the backend
const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0)
const sig = (d: { title: string; intent: string; text: string }[]) => JSON.stringify(d.map((s) => [s.title, s.intent, s.text]))
const fromScript = (s: Script): DraftScene[] => s.scenes.map((sc, i) => ({ key: `${s.id}-${i}`, title: sc.title, intent: sc.intent ?? '', text: sc.text, origIdx: i }))

/**
 * Scene list (left, reorderable) + scene editor (right). Edits autosave after a short pause; the dirty indicator
 * shows unsaved / saving / saved. Per-scene regenerate and tighten call the model and replace that scene.
 */
export function ScriptEditor({ projectId, script }: { projectId: string; script: Script }) {
  const patch = usePatchScript(projectId)
  const rewrite = useRewriteScene(projectId)
  const [draft, setDraft] = useState<DraftScene[]>(() => fromScript(script))
  const [sel, setSel] = useState(0)
  const [instruction, setInstruction] = useState('')
  const serverSig = useMemo(() => sig(script.scenes.map((s) => ({ title: s.title, intent: s.intent ?? '', text: s.text }))), [script.scenes])
  const draftSig = sig(draft)
  const dirty = draftSig !== serverSig

  // Adopt server changes (new version, scene tool, restore) unless the user has unsaved edits of their own.
  const prev = useRef({ id: script.id, server: serverSig, draft: draftSig })
  useEffect(() => {
    const p = prev.current
    if (script.id !== p.id) {
      setDraft(fromScript(script))
      setSel(0)
    } else if (serverSig !== p.server && p.draft === p.server) {
      setDraft(fromScript(script))
    }
    prev.current = { id: script.id, server: serverSig, draft: draftSig }
  }, [script, serverSig, draftSig])

  // Debounced autosave.
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => {
      const scenes: SceneInput[] = draft.map((d) => ({ title: d.title, intent: d.intent, text: d.text }))
      patch.mutate({ scriptId: script.id, patch: { scenes } })
    }, 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSig, dirty, script.id])

  const cur = draft[Math.min(sel, draft.length - 1)]
  const curIdx = Math.min(sel, draft.length - 1)
  const total = draft.reduce((a, d) => a + words(d.text), 0) / WPS
  const target = script.counters.target_sec
  const set = (i: number, k: 'title' | 'intent' | 'text', v: string) => setDraft((d) => d.map((s, j) => (j === i ? { ...s, [k]: v } : s)))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= draft.length) return
    setDraft((d) => {
      const n = [...d]
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })
    setSel(j)
  }
  const serverScene = cur ? script.scenes[cur.origIdx] : undefined
  const provOf = (origIdx: number): Provenance | undefined => {
    const sc = script.scenes[origIdx]
    if (sc?.edited_by_user || script.edited_by_user.scenes?.includes(origIdx)) return { source: 'user' }
    return sc?.provenance ?? script.provenance_by_part.scenes?.[String(origIdx)]
  }
  const busy = dirty || patch.isPending || rewrite.isPending
  const status = patch.isPending ? 'Saving…' : dirty ? 'Unsaved changes' : patch.isError ? 'Save failed' : 'All changes saved'

  if (!cur) return null
  return (
    <section className="card script-editor" data-testid="script-editor">
      <div className="card-heading">
        <div>
          <div className="eyebrow violet-text">Script · v{script.version}</div>
          <h2>Scenes</h2>
        </div>
        <div className="editor-counter" data-testid="est-counter" data-over={target ? total > target * 1.25 : false}>
          <b className="mono">{total.toFixed(1)}s</b>
          {target ? <span> of {target}s target</span> : null}
          <span className="dirty-note" data-dirty={dirty || patch.isPending} role="status" data-testid="dirty-indicator">
            {status}
          </span>
        </div>
      </div>
      <div className="editor-grid">
        <ol className="scene-list" aria-label="Scenes">
          {draft.map((d, i) => (
            <li key={d.key} data-selected={i === curIdx}>
              <button type="button" className="scene-pick" onClick={() => setSel(i)} data-testid="scene-item" aria-current={i === curIdx}>
                <span className="scene-num">{i + 1}</span>
                <span className="scene-title">
                  <b className="truncate">{d.title || 'Untitled'}</b>
                  <small className="mono">{(words(d.text) / WPS).toFixed(1)}s</small>
                </span>
              </button>
              <span className="scene-move">
                <button type="button" aria-label={`Move scene ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp size={12} />
                </button>
                <button type="button" aria-label={`Move scene ${i + 1} down`} disabled={i === draft.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown size={12} />
                </button>
              </span>
            </li>
          ))}
        </ol>
        <div className="scene-edit" key={cur.key}>
          <div className="scene-edit-head">
            <Input aria-label="Scene title" value={cur.title} onChange={(e) => set(curIdx, 'title', e.target.value)} className="scene-title-input" data-testid="scene-title" />
            {provOf(cur.origIdx) && <ProvenanceBadge {...provOf(cur.origIdx)!} />}
          </div>
          <Input aria-label="Scene intent" value={cur.intent} placeholder="Intent of this scene" onChange={(e) => set(curIdx, 'intent', e.target.value)} />
          <Textarea aria-label="Scene text" rows={8} value={cur.text} onChange={(e) => set(curIdx, 'text', e.target.value)} data-testid="scene-text" placeholder="What you say in this scene" />
          <div className="scene-foot">
            <span className="mono muted" data-testid="scene-est">
              {words(cur.text)} words · {(words(cur.text) / WPS).toFixed(1)}s
            </span>
          </div>
          {serverScene && serverScene.beats.length > 0 && (
            <div className="beats" data-testid="beats">
              <div className="eyebrow">Beats{dirty ? ' (update when saved)' : ''}</div>
              {serverScene.beats.map((b) => (
                <div key={b.idx} className="beat-marker">
                  <span className="beat-pin mono">B{b.idx + 1}</span>
                  <span>{b.text}</span>
                  <small className="mono">{b.est_sec.toFixed(1)}s</small>
                </div>
              ))}
            </div>
          )}
          <div className="scene-tools">
            <Input aria-label="Instruction for regenerating this scene" placeholder="Optional: how should it change?" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              loading={rewrite.isPending && rewrite.variables?.mode === 'regenerate'}
              onClick={() => rewrite.mutate({ scriptId: script.id, idx: cur.origIdx, mode: 'regenerate', instruction: instruction || undefined })}
              data-testid="regenerate-scene"
            >
              <Wand2 size={13} /> Regenerate
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              loading={rewrite.isPending && rewrite.variables?.mode === 'tighten'}
              onClick={() => rewrite.mutate({ scriptId: script.id, idx: cur.origIdx, mode: 'tighten' })}
              data-testid="tighten-scene"
            >
              <Scissors size={13} /> Tighten
            </Button>
          </div>
          <LlmNotice error={rewrite.error} onRetry={() => rewrite.variables && rewrite.mutate(rewrite.variables)} />
          {rewrite.data && (
            <p className="muted small" role="status">
              Scene {rewrite.data.scene && (rewrite.data.scene as { idx?: number }).idx !== undefined ? (rewrite.data.scene as { idx: number }).idx + 1 : ''} rewritten: {rewrite.data.words_before} to {rewrite.data.words_after} words.{' '}
              <ProvenanceBadge {...rewrite.data.provenance} />
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

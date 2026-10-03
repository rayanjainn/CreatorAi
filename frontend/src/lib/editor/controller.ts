/**
 * Editor persistence: autosave, server ops, revisions and REVISION_CONFLICT handling. Non-React so it can be driven from
 * hooks, keyboard shortcuts and tests; all state lives in `useEditor`.
 */
import { isApiError } from '@/lib/api/errors'
import { rebase, recordChange, validateAll, type Timeline, type Violation } from '@/lib/timeline'
import { useEditor, type EditorState } from '@/stores/editor'
import { toast } from '@/stores/toasts'
import { api, unwrap } from '@/lib/api/client'
import { applyServerOp, assetToEditAsset, fetchEdit, fetchRevision, restoreRevision, saveEdit } from './api'
import { getEngine } from './engine-store'
import type { OpResult } from './types'

export const AUTOSAVE_MS = 1200
const OFFLINE_RETRY_MS = 5000

const get = () => useEditor.getState()
let timer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<boolean> | null = null

export const assetDurations = (assets: EditorState['assets']): Record<string, number> =>
  Object.fromEntries(Object.entries(assets).filter(([, a]) => a.duration_sec).map(([id, a]) => [id, a.duration_sec as number]))

function readViolations(e: unknown): Violation[] {
  if (!isApiError(e)) return []
  const v = e.details.violations
  if (Array.isArray(v)) return v.map((x) => ({ code: String(x.code ?? 'INVALID'), message: String(x.message ?? ''), path: String(x.path ?? ''), item_id: (x.item_id as string | null) ?? null }))
  const d = e.details.detail
  if (Array.isArray(d)) return d.map((x: { msg?: string; loc?: unknown[] }) => ({ code: 'SCHEMA', message: String(x.msg ?? ''), path: (x.loc ?? []).join('.'), item_id: null }))
  return []
}

function handleError(e: unknown, what: string): void {
  const s = get()
  if (isApiError(e) && e.code === 'REVISION_CONFLICT') {
    const cur = e.details.current_revision
    s.setConflict({ currentRevision: typeof cur === 'number' ? cur : s.revision + 1, updatedAt: (e.details.updated_at as string | undefined) ?? null })
    return
  }
  if (isApiError(e) && (e.code === 'VALIDATION_ERROR' || e.status === 422)) {
    const violations = readViolations(e)
    s.setSave({ status: 'error', error: violations[0]?.message ?? e.message, violations })
    return
  }
  if (isApiError(e) && e.code === 'NETWORK_ERROR') {
    s.setSave({ status: 'offline', error: e.message })
    scheduleRetry()
    return
  }
  s.setSave({ status: 'error', error: e instanceof Error ? e.message : `${what} failed` })
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    retryTimer = null
    if (get().dirty && get().save.status === 'offline') void saveNow()
  }, OFFLINE_RETRY_MS)
}

/** Save the working copy now. Resolves true when nothing is left unsaved. */
export async function saveNow(): Promise<boolean> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (inFlight) {
    await inFlight
    return get().dirty ? saveNow() : true
  }
  const s = get()
  if (!s.clipId || s.preview) return true
  if (!s.dirty) return true
  if (s.conflict) return false
  const violations = validateAll(s.timeline, assetDurations(s.assets))
  if (violations.length) {
    s.setSave({ status: 'error', error: violations[0].message, violations })
    return false
  }
  const { clipId, timeline, revision, version } = s
  const note = (s.pendingNote || 'Edited in the editor').slice(0, 200)
  s.setSave({ status: 'saving' })
  inFlight = (async () => {
    try {
      const res = await saveEdit(clipId, timeline, revision, note)
      get().markSaved(res.revision, version, timeline)
      return true
    } catch (e) {
      handleError(e, 'Saving')
      return false
    } finally {
      inFlight = null
    }
  })()
  const ok = await inFlight
  if (ok && get().dirty) scheduleAutosave()
  return ok && !get().dirty
}

export function scheduleAutosave(ms = AUTOSAVE_MS) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void saveNow()
  }, ms)
}

/** Subscribe the autosaver to edits; returns the unsubscribe function. */
export function startAutosave(): () => void {
  let lastVersion = get().version
  const unsub = useEditor.subscribe((s) => {
    if (s.version === lastVersion) return
    lastVersion = s.version
    if (s.dirty && !s.preview && !s.conflict && s.loaded) scheduleAutosave()
  })
  const online = () => {
    if (get().dirty && ['offline', 'error'].includes(get().save.status)) void saveNow()
  }
  const beforeUnload = (e: BeforeUnloadEvent) => {
    if (get().dirty && !get().conflict) {
      e.preventDefault()
      e.returnValue = ''
    }
  }
  window.addEventListener('online', online)
  window.addEventListener('beforeunload', beforeUnload)
  return () => {
    unsub()
    window.removeEventListener('online', online)
    window.removeEventListener('beforeunload', beforeUnload)
    if (timer) clearTimeout(timer)
    if (retryTimer) clearTimeout(retryTimer)
    timer = retryTimer = null
  }
}

/** Run a server op (tighten pauses, ...): flush local edits first, then replace local state with the result. */
export async function runServerOp(op: string, params: Record<string, unknown>, note: string): Promise<OpResult | null> {
  const s0 = get()
  if (!s0.clipId || s0.preview || s0.busy) return null
  if (s0.dirty && !(await saveNow())) {
    toast.warning('Fix the save problem first', 'Your local changes could not be saved, so the server operation was not run.')
    return null
  }
  const s = get()
  s.setBusy(op)
  s.setSave({ status: 'saving' })
  try {
    const res = await applyServerOp(s.clipId!, op, params, s.revision, note)
    get().adopt(res.timeline, res.revision)
    return res
  } catch (e) {
    if (isApiError(e) && e.code !== 'REVISION_CONFLICT' && e.code !== 'NETWORK_ERROR') {
      get().setSave({ status: 'saved', at: Date.now() })
      toast.warning('Could not run that', e.message)
    } else handleError(e, 'Running the operation')
    return null
  } finally {
    get().setBusy(null)
  }
}

/** Restore an older revision as a NEW revision (history is never rewritten). */
export async function restoreTo(revision: number): Promise<boolean> {
  const s0 = get()
  if (!s0.clipId || s0.busy) return false
  if (s0.dirty && !(await saveNow())) return false
  const s = get()
  s.setBusy('restore')
  s.setSave({ status: 'saving' })
  try {
    const res = await restoreRevision(s.clipId!, revision, s.revision)
    // the restored content may reference assets the editor has not loaded yet
    const p = await fetchEdit(s.clipId!)
    get().adopt(res.timeline, res.revision, { assets: { ...get().assets, ...p.assets } })
    return true
  } catch (e) {
    handleError(e, 'Restoring')
    return false
  } finally {
    get().setBusy(null)
  }
}

/** Throw away local changes and load the latest server revision. */
export async function reloadLatest(): Promise<void> {
  const s = get()
  if (!s.clipId) return
  try {
    const p = await fetchEdit(s.clipId)
    get().adopt(p.timeline, p.revision, { fresh: true, assets: { ...get().assets, ...p.assets } })
  } catch (e) {
    handleError(e, 'Reloading')
  }
}

export type RebasePlan = { ok: true; timeline: Timeline; theirs: Timeline; revision: number } | { ok: false; reason: string }

/** Can my local changes be combined with the latest revision? (Pure three-way merge; nothing is changed.) */
export async function planRebase(): Promise<RebasePlan> {
  const s = get()
  if (!s.clipId) return { ok: false, reason: 'No clip is open.' }
  const p = await fetchEdit(s.clipId)
  const merged = rebase(s.serverTimeline, s.timeline, p.timeline, assetDurations({ ...s.assets, ...p.assets }))
  return merged.ok ? { ok: true, timeline: merged.timeline, theirs: p.timeline, revision: p.revision } : merged
}

/** Apply a rebase plan: merged timeline on top of the latest revision, saved as a new revision. */
export async function applyRebase(plan: Extract<RebasePlan, { ok: true }>): Promise<void> {
  const s = get()
  useEditor.setState({
    timeline: plan.timeline,
    serverTimeline: plan.theirs,
    revision: plan.revision,
    history: recordChange(s.history, s.timeline),
    dirty: true,
    version: s.version + 1,
    conflict: null,
    pendingNote: 'Merged with a newer revision',
    save: { status: 'unsaved' },
  })
  await saveNow()
}

/** Overwrite the latest revision with my version (the other revision stays in history and can be restored). */
export async function overwriteWithMine(): Promise<void> {
  const s = get()
  if (!s.clipId) return
  try {
    const p = await fetchEdit(s.clipId)
    useEditor.setState({ revision: p.revision, serverTimeline: p.timeline, conflict: null, dirty: true, version: s.version + 1, pendingNote: `Replaced revision ${p.revision} with my edits`, save: { status: 'unsaved' } })
    await saveNow()
  } catch (e) {
    handleError(e, 'Overwriting')
  }
}

/** Re-fetch signed media URLs (they expire after an hour) without touching the timeline. */
export async function refreshAssets(): Promise<void> {
  const s = get()
  if (!s.clipId) return
  try {
    const p = await fetchEdit(s.clipId)
    useEditor.setState((x) => ({ assets: { ...x.assets, ...p.assets } }))
  } catch {
    /* the next interval tries again */
  }
}

/** Make sure the editor knows the assets a timeline refers to (an old revision may use ones the editor never loaded). */
export async function ensureAssets(timeline: Timeline): Promise<void> {
  const known = get().assets
  const ids = new Set<string>()
  for (const v of timeline.tracks.video) if (v.asset_id) ids.add(v.asset_id)
  for (const a of timeline.tracks.audio) ids.add(a.asset_id)
  const missing = [...ids].filter((id) => !known[id])
  if (!missing.length) return
  const found = await Promise.all(
    missing.map(async (id) => {
      try {
        const d = await unwrap(api.GET('/api/v1/assets/{asset_id}', { params: { path: { asset_id: id }, query: { include_energy: true } } }))
        return [id, assetToEditAsset(d)] as const
      } catch {
        return null
      }
    }),
  )
  get().mergeAssets(Object.fromEntries(found.filter((x): x is NonNullable<typeof x> => !!x)))
}

/** Show an older revision read-only in the monitor and timeline (nothing is changed on the server). */
export async function previewRevision(revision: number): Promise<boolean> {
  const s = get()
  if (!s.clipId) return false
  try {
    const detail = await fetchRevision(s.clipId, revision)
    await ensureAssets(detail.timeline)
    get().setPreview(detail)
    const eng = getEngine()
    if (eng) eng.seek(0)
    else get().setPlayhead(0)
    return true
  } catch (e) {
    toast.error('Could not open that revision', e instanceof Error ? e.message : undefined)
    return false
  }
}

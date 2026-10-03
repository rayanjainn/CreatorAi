import type { Stage } from '@/lib/api/types'

export const STAGES: { id: Stage; label: string; hint: string }[] = [
  { id: 'idea', label: 'Idea', hint: 'Captured, not started' },
  { id: 'script', label: 'Script', hint: 'Plan and write it' },
  { id: 'shoot', label: 'Shoot', hint: 'Script approved, ready to film' },
  { id: 'edit', label: 'Edit', hint: 'Footage in, cutting' },
  { id: 'review', label: 'Review', hint: 'Final checks' },
  { id: 'published', label: 'Published', hint: 'Out in the world' },
]

export const STAGE_LABEL: Record<Stage, string> = Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<
  Stage,
  string
>

export function isStage(v: string): v is Stage {
  return v in STAGE_LABEL
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return ''
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Seeded demo rows are titled "[DEMO] ...". Used until the API exposes provenance on cards (see FRONTEND_NOTES). */
export const DEMO_PREFIX = '[DEMO]'
export function isDemoTitle(title: string): boolean {
  return title.trimStart().toUpperCase().startsWith(DEMO_PREFIX)
}
export function stripDemo(title: string): string {
  return isDemoTitle(title) ? title.trimStart().slice(DEMO_PREFIX.length).trimStart() : title
}

const JOB_LABELS: Record<string, string> = {
  'asset.process': 'Processing media',
  'project.match': 'Matching script to footage',
  'clips.generate': 'Generating clips',
  'render.run': 'Rendering video',
  'publish.upload': 'Publishing',
  'analytics.sync': 'Syncing analytics',
  'twin.update': 'Updating style profile',
}
export function jobLabel(type: string): string {
  return JOB_LABELS[type] ?? type
}

const ACTION_LABELS: Record<string, string> = {
  content_created: 'Created content',
  content_updated: 'Edited content',
  content_deleted: 'Deleted content',
  stage_moved: 'Moved stage',
  ideas_generated: 'Generated ideas',
  idea_accepted: 'Accepted an idea',
  idea_dismissed: 'Dismissed an idea',
  hooks_generated: 'Generated hooks',
  script_generated: 'Generated a script',
  script_edited: 'Edited the script',
  script_restored: 'Restored a script version',
  script_approved: 'Approved the script',
  scene_regenerated: 'Regenerated a scene',
  scene_tightened: 'Tightened a scene',
  script_meta_generated: 'Generated script metadata',
  plan_generated: 'Generated a plan',
  plan_edited: 'Edited the plan',
  review_generated: 'Generated a review',
  match_completed: 'Matched script to footage',
  clips_generated: 'Generated clips',
}
export function actionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action]
  const text = action.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** `m:ss` (or `m:ss.t` with `fine`) for media positions. */
export function formatTimecode(sec: number | null | undefined, fine = false): string {
  if (sec == null || !Number.isFinite(sec)) return '0:00'
  const total = Math.max(0, sec)
  const m = Math.floor(total / 60)
  const s = total - m * 60
  return fine ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(s)).padStart(2, '0')}`
}

export function formatRange(a: number | null | undefined, b: number | null | undefined): string {
  return `${formatTimecode(a)}–${formatTimecode(b)}`
}

export function formatSpeed(bytesPerSec: number): string {
  return bytesPerSec > 0 ? `${formatBytes(bytesPerSec)}/s` : ''
}

export function formatEta(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return ''
  if (sec < 60) return `${Math.ceil(sec)}s left`
  const m = Math.floor(sec / 60)
  return `${m}m ${Math.round(sec - m * 60)}s left`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Copy text to the clipboard; resolves false when the browser refuses (no permission, insecure context). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

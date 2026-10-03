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

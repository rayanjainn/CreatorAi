import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LumiclipProject } from '@/lib/api/types'

const STEPS: { id: string; label: string; hint: string }[] = [
  { id: 'downloading', label: 'Fetching the video', hint: 'LumiClip pulls the source' },
  { id: 'transcribing', label: 'Transcribing', hint: 'Speech to text' },
  { id: 'analyzing', label: 'Finding the best moments', hint: 'Scoring hooks and energy' },
  { id: 'cutting', label: 'Cutting the clips', hint: 'Captions and reframing' },
  { id: 'done', label: 'Ready', hint: 'Review and save' },
]

const ERROR_HELP: Record<string, { title: string; body: string }> = {
  source_auth: { title: 'That video needs a login', body: 'It is private, age-restricted or members-only, so LumiClip cannot read it. Use a public link, or download it and clip it from your library.' },
  source_unavailable: { title: 'LumiClip could not fetch the video', body: 'The link may be wrong, deleted or blocked in some regions. Check it opens in a private window.' },
  api_auth: { title: 'LumiClip rejected the key', body: 'Check LUMICLIP_API_KEY in .env and restart the API.' },
  quota: { title: 'Out of credits or rate-limited', body: 'Wait a moment, or check your LumiClip plan.' },
}

/** Where a LumiClip project is in its pipeline, or why it failed. */
export function ProjectProgress({ project }: { project: LumiclipProject }) {
  if (project.status === 'failed') {
    const help = ERROR_HELP[project.error_category ?? '']
    return (
      <div className="sc-fail" role="alert" data-testid="lumiclip-failed" data-category={project.error_category ?? 'unknown'}>
        <AlertTriangle size={18} />
        <div>
          <b>{help?.title ?? 'This project failed'}</b>
          <p>{help?.body ?? 'LumiClip could not finish this video.'}</p>
          {project.error && <small>LumiClip said: {project.error}</small>}
        </div>
      </div>
    )
  }
  const current = project.status === 'completed' ? STEPS.length - 1 : Math.max(0, STEPS.findIndex((s) => s.id === project.step))
  return (
    <ol className="sc-steps" data-testid="lumiclip-progress" aria-label="Progress">
      {STEPS.map((s, i) => {
        const state = i < current || project.status === 'completed' ? 'done' : i === current ? 'active' : 'pending'
        return (
          <li key={s.id} data-state={state} title={s.hint}>
            <span className={cn('sc-dot')}>{state === 'done' ? <Check size={12} /> : state === 'active' ? <Loader2 size={12} className="spin" /> : null}</span>
            <b>{s.label}</b>
          </li>
        )
      })}
    </ol>
  )
}

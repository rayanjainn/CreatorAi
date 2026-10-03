import { useMemo } from 'react'
import { create } from 'zustand'
import type { Job } from '@/lib/api/types'
import { isTerminal, type JobEvent } from '@/lib/sse'
import { jobLabel } from '@/lib/format'

export type TrackedJob = {
  id: string
  type: string
  label: string
  status: string
  progress: number
  stage: string
  error: string | null
  entityType?: string
  entityId?: string | null
  /** Set once the finished state has been announced with a toast. */
  announced: boolean
  /** Hidden from the toast stack by the user. */
  dismissed: boolean
}

type JobsState = {
  jobs: Record<string, TrackedJob>
  upsertJob: (j: Job | (JobEvent & { id?: string })) => TrackedJob | null
  markAnnounced: (id: string) => void
  dismiss: (id: string) => void
  /** ids that are queued or running */
  activeIds: () => string[]
}

export const useJobs = create<JobsState>((set, get) => ({
  jobs: {},
  upsertJob: (j) => {
    const id = ('job_id' in j && j.job_id ? (j.job_id as string) : (j as { id?: string }).id) as string | undefined
    if (!id) return null
    const prev = get().jobs[id]
    const type = ((j as { type?: string }).type ?? prev?.type ?? 'job') as string
    const next: TrackedJob = {
      id,
      type,
      label: jobLabel(type),
      status: j.status ?? prev?.status ?? 'queued',
      progress: typeof j.progress === 'number' ? j.progress : (prev?.progress ?? 0),
      stage: ((j as { stage?: string }).stage ?? prev?.stage ?? '') as string,
      error: ((j as { error?: string | null }).error ?? (isTerminal(j.status) ? ((j as JobEvent).message ?? null) : null) ?? prev?.error ?? null) as string | null,
      entityType: (j as { entity_type?: string }).entity_type ?? prev?.entityType,
      entityId: (j as { entity_id?: string | null }).entity_id ?? prev?.entityId,
      announced: prev?.announced ?? false,
      dismissed: prev?.dismissed ?? false,
    }
    set((s) => ({ jobs: { ...s.jobs, [id]: next } }))
    return next
  },
  markAnnounced: (id) => set((s) => (s.jobs[id] ? { jobs: { ...s.jobs, [id]: { ...s.jobs[id], announced: true } } } : s)),
  dismiss: (id) => set((s) => (s.jobs[id] ? { jobs: { ...s.jobs, [id]: { ...s.jobs[id], dismissed: true } } } : s)),
  activeIds: () =>
    Object.values(get().jobs)
      .filter((j) => !isTerminal(j.status))
      .map((j) => j.id),
}))

/** Jobs that are queued or running (memoised: selecting a fresh array from the store would loop). */
export function useActiveJobs(): TrackedJob[] {
  const jobs = useJobs((s) => s.jobs)
  return useMemo(() => Object.values(jobs).filter((j) => !isTerminal(j.status)), [jobs])
}

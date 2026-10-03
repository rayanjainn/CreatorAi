'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, unwrap } from '@/lib/api/client'
import { invalidateAfterJob } from '@/lib/api/hooks'
import { subscribeJob, isTerminal, type JobSubscription } from '@/lib/sse'
import { useJobs } from '@/stores/jobs'
import { toast } from '@/stores/toasts'
import type { Job } from '@/lib/api/types'

const POLL_MS = 4000

/**
 * Headless: keeps the jobs store in sync with the API.
 *  - polls GET /jobs (queued + running + recently finished) as the discovery/fallback channel
 *  - opens an SSE stream per active job for live progress
 *  - on completion: announces once, invalidates data queries
 * Mounted once by the (app) shell.
 */
export function JobsProvider() {
  const qc = useQueryClient()
  const subs = useRef(new Map<string, JobSubscription>())

  useEffect(() => {
    let stopped = false
    const mountedAt = Date.now()
    const store = useJobs.getState

    const finish = (id: string) => {
      const j = store().jobs[id]
      if (!j || j.announced) return
      store().markAnnounced(id)
      invalidateAfterJob(qc)
      if (j.status === 'succeeded') toast.success(`${j.label} finished`)
      else if (j.status === 'failed') toast.error(`${j.label} failed`, j.error ?? undefined, { label: 'View jobs', href: '/jobs' })
      subs.current.get(id)?.close()
      subs.current.delete(id)
    }

    const ensureSub = (id: string) => {
      if (subs.current.has(id)) return
      subs.current.set(
        id,
        subscribeJob(id, {
          onEvent: (e) => {
            store().upsertJob({ ...e, job_id: id })
            if (isTerminal(e.status)) finish(id)
          },
          onGiveUp: () => subs.current.delete(id),
        }),
      )
    }

    const poll = async () => {
      if (stopped || document.visibilityState === 'hidden') return
      try {
        const jobs = await unwrap<Job[]>(api.GET('/api/v1/jobs', { params: { query: { limit: 20 } } }), { skipAuthRedirect: false })
        for (const j of jobs) {
          const known = store().jobs[j.id]
          if (!known && isTerminal(j.status)) {
            // Old history: remember it silently so we never toast about it. A job that started and
            // finished while we were mounted (too fast to see running) is still announced.
            store().upsertJob(j)
            const finishedAt = j.finished_at ? Date.parse(j.finished_at) : 0
            if (finishedAt >= mountedAt - 2000) finish(j.id)
            else store().markAnnounced(j.id)
            continue
          }
          store().upsertJob(j)
          if (isTerminal(j.status)) finish(j.id)
          else ensureSub(j.id)
        }
      } catch {
        /* transient: next tick */
      }
    }

    void poll()
    const timer = setInterval(poll, POLL_MS)
    const onVis = () => document.visibilityState === 'visible' && void poll()
    document.addEventListener('visibilitychange', onVis)
    const current = subs.current
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
      current.forEach((s) => s.close())
      current.clear()
    }
  }, [qc])

  return null
}

export { trackJob } from '@/lib/track-job'

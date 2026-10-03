import { api, unwrap } from '@/lib/api/client'
import { useJobs } from '@/stores/jobs'
import type { Job } from '@/lib/api/types'

/** Call right after enqueueing a job (upload, match, clips, render) so progress shows up immediately. */
export async function trackJob(jobId: string | null | undefined) {
  if (!jobId) return
  try {
    const job = await unwrap<Job>(api.GET('/api/v1/jobs/{job_id}', { params: { path: { job_id: jobId } } }))
    useJobs.getState().upsertJob(job)
  } catch {
    /* the poller will find it */
  }
}

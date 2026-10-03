// media.moments handler: generates the moments of one indexed asset for a queued
// editing_jobs row. Failures are recorded on the job row (see agents/editing/jobs.js).
import { runMomentsJob } from '../modules/agents/editing/service.js';

export async function mediaMoments(data) {
  return runMomentsJob(data.jobId);
}

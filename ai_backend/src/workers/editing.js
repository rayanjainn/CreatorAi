// editing.reels / editing.revise handlers: run one queued editing_jobs row through the
// Editing Agent. Failures are recorded on the job row (see agents/editing/jobs.js).
import { runReelsJob, runReviseJob } from '../modules/agents/editing/service.js';

export async function editingReels(data) {
  return runReelsJob(data.jobId);
}

export async function editingRevise(data) {
  return runReviseJob(data.jobId);
}

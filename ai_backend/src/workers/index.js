// Job name -> handler(data, job). Each phase registers the handlers for its jobs here.
// A handler returns an object (stored as the job output) or throws to fail the job.
import { JOBS } from '../queue/jobs.js';
import { noop } from './noop.js';
import { agentRun } from './agents.js';
import { processAsset, stepHandlers } from './process.js';
import { renderRun } from './render.js';
import { mediaMoments } from './moments.js';
import { editingReels, editingRevise } from './editing.js';

export const handlers = {
  [JOBS.NOOP]: noop,
  // P3: media.process starts a pipeline run; one handler per step job (see process.js).
  [JOBS.MEDIA_PROCESS]: processAsset,
  ...stepHandlers,
  [JOBS.AGENT_RUN]: agentRun,
  // P7: render one pinned timeline version (see render.js).
  [JOBS.RENDER_RUN]: renderRun,
  // P6: moments, reels and revisions (one editing_jobs row each).
  [JOBS.MEDIA_MOMENTS]: mediaMoments,
  [JOBS.EDITING_REELS]: editingReels,
  [JOBS.EDITING_REVISE]: editingRevise,
};

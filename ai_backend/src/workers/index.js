// Job name -> handler(data, job). Each phase registers the handlers for its jobs here.
// A handler returns an object (stored as the job output) or throws to fail the job.
import { JOBS } from '../queue/jobs.js';
import { noop } from './noop.js';

export const handlers = {
  [JOBS.NOOP]: noop,
};

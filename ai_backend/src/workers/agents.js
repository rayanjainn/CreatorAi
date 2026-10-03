// agent.run handler: executes one queued agent run. Agent failures (invalid output,
// provider errors, timeouts) are recorded on the run and do not fail the job, so
// pg-boss does not retry a run whose outcome is already decided.
import { executeRun } from '../modules/agents/service.js';
import { directorAgent } from '../modules/agents/director/service.js';

// Agent name -> definition, resolved per call (the definitions live in modules that
// import the queue, so they are not read while this module is being evaluated).
function agents() {
  return {
    director: directorAgent,
  };
}

export async function agentRun(data) {
  return executeRun(data.runId, agents());
}

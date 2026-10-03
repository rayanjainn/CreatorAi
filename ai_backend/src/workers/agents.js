// agent.run handler: executes one queued agent run. Agent failures (invalid output,
// provider errors, timeouts) are recorded on the run and do not fail the job, so
// pg-boss does not retry a run that already has its outcome.
import { executeRun } from '../modules/agents/service.js';

// Agent name -> definition. Each agent sub-module adds its definition here.
export const AGENTS = {};

export async function agentRun(data) {
  return executeRun(data.runId, AGENTS);
}

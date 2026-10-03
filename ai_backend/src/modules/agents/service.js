// agents service: the module's public API. Other modules import this file and nothing
// else from here. Agent sub-modules (director, research, script) use startRun() to queue
// a run; the agent.run worker calls executeRun() with the agent registry.
import { notFound } from '../../lib/errors.js';
import { enqueue } from '../../queue/boss.js';
import { JOBS } from '../../queue/jobs.js';
import * as repo from './repo.js';
import { runAgent } from './run.js';
import { toRun, Uuid } from './schemas.js';

export { runAgent, AgentOutputError, configureRunner, resetRunner } from './run.js';

export const isUuid = (value) => Uuid.safeParse(value).success;

// getRun(projectId, runId) -> AgentRun. Missing, malformed or other project's id -> 404.
export async function getRun(projectId, runId) {
  const row = isUuid(projectId) && isUuid(runId) ? await repo.findRun(projectId, runId) : null;
  if (!row) throw notFound('Agent run not found');
  return toRun(row);
}

// startRun({ agent, projectId, userId, input }) -> AgentRun (status 'queued').
// Inserts the run and enqueues an agent.run job for it.
export async function startRun({ agent, projectId, userId, input }) {
  const row = await repo.insertRun({ projectId, userId, agent, input, status: 'queued' });
  try {
    await enqueue(JOBS.AGENT_RUN, { runId: row.id });
  } catch (err) {
    await repo.finishRun(row.id, {
      status: 'failed',
      error: { code: 'enqueue_failed', message: 'Could not queue the agent run' },
      attempts: 0,
      tokensIn: 0,
      tokensOut: 0,
      ms: 0,
    });
    throw err;
  }
  return toRun(row);
}

// executeRun(runId, agents): runs a queued run with its agent definition from `agents`
// ({ [name]: { outputSchema, system?, instructions?, tools?, refine?, persist? } }).
// Returns { runId, status }; a missing or already-finished run is skipped.
export async function executeRun(runId, agents) {
  const row = await repo.findRunById(runId);
  if (!row || (row.status !== 'queued' && row.status !== 'running')) {
    return { runId, status: row?.status ?? 'missing', skipped: true };
  }
  const def = agents[row.agent];
  if (!def) {
    const done = await repo.finishRun(row.id, {
      status: 'failed',
      error: { code: 'unknown_agent', message: `No agent named "${row.agent}"` },
      attempts: 0,
      tokensIn: 0,
      tokensOut: 0,
      ms: 0,
    });
    return { runId, status: done.status };
  }
  const { run } = await runAgent({
    ...def,
    name: row.agent,
    input: row.input,
    runId: row.id,
    projectId: row.project_id,
    userId: row.created_by,
  });
  return { runId, status: run.status };
}

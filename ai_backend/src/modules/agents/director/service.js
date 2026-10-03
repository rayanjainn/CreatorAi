// agents/director service: the Director Agent (content plans).
// Public API: directorAgent (definition for the agent.run worker), requestPlan,
// listPlans, getPlan.
import { notFound } from '../../../lib/errors.js';
import { isUuid, startRun } from '../service.js';
import * as repo from './repo.js';
import { DirectorInput, Plan, PlanDoc } from './schemas.js';

const iso = (v) => new Date(v).toISOString();

const toPlan = (row) =>
  Plan.parse({
    id: row.id,
    projectId: row.project_id,
    createdBy: row.created_by ?? null,
    runId: row.run_id ?? null,
    input: row.input,
    doc: row.doc,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });

export const directorAgent = {
  outputSchema: PlanDoc,
  system:
    'You are the Director Agent of a short-form video studio. You plan content: concrete, ' +
    'filmable video ideas with a clear angle, format and opening hook, and a publishing schedule.',
  instructions: (input) =>
    [
      `Plan content for the "${input.niche}" niche, aimed at: ${input.audience}.`,
      `Goals: ${input.goals.join('; ')}. Cadence: ${input.cadence}. Horizon: ${input.horizonDays} days` +
        (input.startDate ? ` starting ${input.startDate}.` : '.'),
      'Give enough ideas to fill the schedule. Each schedule entry has a YYYY-MM-DD date and ideaIdx, ' +
        'the zero-based index of an idea in ideas[].',
    ].join('\n'),
  async persist(client, { output, input, runId, projectId, userId }) {
    const row = await repo.insertPlan(client, { projectId, userId, runId, input, doc: output });
    return { type: 'plan', id: row.id };
  },
};

// requestPlan(projectId, userId, body) -> queued AgentRun.
export async function requestPlan(projectId, userId, body) {
  const input = DirectorInput.parse(body);
  return startRun({ agent: 'director', projectId, userId, input });
}

export async function listPlans(projectId) {
  return (await repo.listPlans(projectId)).map(toPlan);
}

// getPlan(projectId, planId) -> Plan. Missing, malformed or another project's id -> 404.
export async function getPlan(projectId, planId) {
  const row = isUuid(projectId) && isUuid(planId) ? await repo.findPlan(projectId, planId) : null;
  if (!row) throw notFound('Plan not found');
  return toPlan(row);
}

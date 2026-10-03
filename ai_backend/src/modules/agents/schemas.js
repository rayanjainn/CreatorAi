// agents schemas: the agent_runs output shape and shared id/param schemas.
import { z } from 'zod';

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed'];

export const Uuid = z.uuid();

export const RunError = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export const AgentRun = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  createdBy: z.uuid().nullable(),
  agent: z.string(),
  status: z.enum(RUN_STATUSES),
  input: z.unknown(),
  output: z.unknown().nullable(),
  toolResults: z.unknown().nullable(),
  artifact: z.object({ type: z.string(), id: z.string() }).nullable(),
  error: RunError.nullable(),
  attempts: z.number().int().nonnegative(),
  tokens: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative() }),
  ms: z.number().int().nonnegative().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

const iso = (v) => (v == null ? null : new Date(v).toISOString());

// agent_runs row -> AgentRun.
export function toRun(row) {
  return AgentRun.parse({
    id: row.id,
    projectId: row.project_id,
    createdBy: row.created_by ?? null,
    agent: row.agent,
    status: row.status,
    input: row.input,
    output: row.output ?? null,
    toolResults: row.tool_results ?? null,
    artifact: row.artifact_type ? { type: row.artifact_type, id: row.artifact_id } : null,
    error: row.error ?? null,
    attempts: row.attempts,
    tokens: { input: row.tokens_in, output: row.tokens_out },
    ms: row.ms ?? null,
    provider: row.provider ?? null,
    model: row.model ?? null,
    createdAt: iso(row.created_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  });
}

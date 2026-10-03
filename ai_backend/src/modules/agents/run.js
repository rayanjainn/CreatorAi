// Shared agent runner. runAgent() builds the prompt, calls the LLM adapter for JSON,
// validates the reply with Zod (plus the agent's own refine() check), retries once with
// the validation error, and records everything on an agent_runs row. On success the
// agent's persist() writes its artifact in the same transaction that marks the run
// succeeded, so a failed run never leaves an artifact behind.
import { z } from 'zod';
import { getLlm } from '../../adapters/llm/index.js';
import { withTransaction } from '../../db/pool.js';
import * as repo from './repo.js';
import { toRun } from './schemas.js';

const MAX_ATTEMPTS = 2;
const DEFAULTS = Object.freeze({ timeoutMs: 90_000, llm: null });
let settings = { ...DEFAULTS };

// configureRunner({ llm?, timeoutMs? }): swap the LLM client (tests inject the real
// adapter over a stubbed fetch) or the per-call timeout. resetRunner() restores defaults.
export function configureRunner(overrides = {}) {
  settings = { ...settings, ...overrides };
}

export function resetRunner() {
  settings = { ...DEFAULTS };
}

// Thrown by an agent's refine() when the output parses but breaks a rule the schema
// cannot express (e.g. citing a URL the search never returned). Triggers the retry.
export class AgentOutputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AgentOutputError';
  }
}

const formatIssues = (issues) =>
  issues.map((i) => `- ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`).join('\n');

function jsonSchemaOf(schema) {
  try {
    return JSON.stringify(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }));
  } catch {
    return null;
  }
}

function composePrompt({ name, instructions, input, toolResults, outputSchema }) {
  const parts = [];
  const text = typeof instructions === 'function' ? instructions(input, toolResults) : instructions;
  parts.push(text || `Run the ${name} agent on the input below.`);
  parts.push(`## Input\n${JSON.stringify(input, null, 2)}`);
  for (const [tool, result] of Object.entries(toolResults)) {
    parts.push(`## Tool result: ${tool}\n${JSON.stringify(result, null, 2)}`);
  }
  const shape = jsonSchemaOf(outputSchema);
  parts.push(
    shape
      ? `## Output\nReturn one JSON object that matches this JSON Schema:\n${shape}`
      : '## Output\nReturn one JSON object.',
  );
  return parts.join('\n\n');
}

const retryNote = (problem) =>
  `\n\n## Your previous reply was invalid\n${problem}\nReply again with corrected JSON only.`;

async function runTools(tools, input) {
  const results = {};
  for (const tool of tools) results[tool.name] = await tool.run(input);
  return results;
}

function toRunError(err) {
  const code = typeof err.code === 'string' && /^[a-z_]+$/.test(err.code) ? err.code : 'agent_error';
  const error = { code, message: err.message || 'Agent failed' };
  if (err.details !== undefined) error.details = err.details;
  else if (Array.isArray(err.errors)) error.details = err.errors;
  return error;
}

// runAgent({ name, input, outputSchema, tools?, system?, instructions?, refine?, persist?,
//            projectId, userId, runId? })
//   tools:   [{ name, run(input) }], run before the model; results go into the prompt
//   refine:  (output, { input, toolResults }) -> output; throw AgentOutputError to retry
//   persist: (client, { output, input, toolResults, runId }) -> { type, id } | null
//   runId:   finish an existing (queued) run; otherwise a new run row is created.
// Never throws for agent failures: returns { run, output, artifact } with run.status
// 'succeeded' or 'failed'.
export async function runAgent(opts) {
  const { name, input = {}, outputSchema, tools = [], system, instructions, refine, persist } = opts;
  const row = opts.runId
    ? await repo.markRunning(opts.runId)
    : await repo.insertRun({ projectId: opts.projectId, userId: opts.userId, agent: name, input, status: 'running' });
  if (!row) throw new Error(`Run ${opts.runId} does not exist or has already finished`);

  const llm = settings.llm ?? getLlm();
  const started = Date.now();
  const stats = { attempts: 0, tokensIn: 0, tokensOut: 0, provider: null, model: null, toolResults: null };
  const elapsed = () => Date.now() - started;

  try {
    const toolResults = await runTools(tools, input);
    if (tools.length) stats.toolResults = toolResults;
    const prompt = composePrompt({ name, instructions, input, toolResults, outputSchema });
    const fullSystem = `${system ?? `You are the ${name} agent.`}\nRespond with a single JSON object only: no prose, no markdown fences.`;

    let problem = null;
    while (stats.attempts < MAX_ATTEMPTS) {
      stats.attempts += 1;
      let reply;
      try {
        reply = await llm.completeJson({
          system: fullSystem,
          prompt: problem ? prompt + retryNote(problem) : prompt,
          timeoutMs: settings.timeoutMs,
        });
      } catch (err) {
        if (err.code !== 'invalid_json') throw err;
        problem = 'The reply was not valid JSON.';
        continue;
      }
      stats.tokensIn += reply.usage?.inputTokens ?? 0;
      stats.tokensOut += reply.usage?.outputTokens ?? 0;
      stats.provider = reply.provider ?? null;
      stats.model = reply.model ?? null;

      const parsed = outputSchema.safeParse(reply.json);
      if (!parsed.success) {
        problem = `It failed schema validation:\n${formatIssues(parsed.error.issues)}`;
        continue;
      }
      let output = parsed.data;
      if (refine) {
        try {
          output = await refine(output, { input, toolResults });
        } catch (err) {
          if (!(err instanceof AgentOutputError)) throw err;
          problem = err.message;
          continue;
        }
      }

      const runId = row.id;
      return await withTransaction(async (client) => {
        const artifact = persist ? ((await persist(client, { output, input, toolResults, runId })) ?? null) : null;
        const done = await repo.finishRun(runId, { ...stats, status: 'succeeded', output, artifact, ms: elapsed() }, client);
        return { run: toRun(done), output, artifact };
      });
    }

    const err = new Error(`Output failed validation after ${MAX_ATTEMPTS} attempts: ${problem}`);
    err.code = 'invalid_output';
    throw err;
  } catch (err) {
    const done = await repo.finishRun(row.id, { ...stats, status: 'failed', error: toRunError(err), ms: elapsed() });
    return { run: toRun(done), output: null, artifact: null };
  }
}

// P4.T1: the shared agent runner (modules/agents/run.js) against the fake LLM, and the
// run polling endpoint GET /projects/:projectId/agents/runs/:runId.
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { getLlm } from '../../src/adapters/llm/index.js';
import { configureRunner, resetRunner, runAgent } from '../../src/modules/agents/run.js';
import { getRun, startRun } from '../../src/modules/agents/service.js';
import { JOBS, parsePayload } from '../../src/queue/jobs.js';
import { authHeader, createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues, drainQueue } from '../helpers/queue.js';

const app = createApp({ log: { error() {} } });
const llm = getLlm();

const Echo = z.strictObject({ title: z.string().min(1), count: z.number().int() });

beforeEach(async () => {
  await resetDb();
  llm.reset();
  resetRunner();
});
afterEach(() => {
  llm.reset();
  resetRunner();
});
afterAll(closeAll);

async function owned() {
  const owner = await createUser(app);
  const res = await request(app).post('/projects').set(authHeader(owner.token)).send({ name: 'Runner' });
  expect(res.status).toBe(201);
  return { owner, project: res.body.project };
}

const base = (ctx) => ({
  name: 'echo',
  projectId: ctx.project.id,
  userId: ctx.owner.user.id,
  input: { topic: 'hooks' },
  outputSchema: Echo,
});

describe('runAgent', () => {
  it('valid JSON on the first try -> succeeded, attempts 1, row stores input, output, tokens and ms', async () => {
    const ctx = await owned();
    llm.queueResponse({ title: 'Hello', count: 3 });
    const result = await runAgent(base(ctx));
    expect(result.output).toEqual({ title: 'Hello', count: 3 });
    expect(result.run).toMatchObject({ agent: 'echo', status: 'succeeded', attempts: 1, error: null });

    const run = await getRun(ctx.project.id, result.run.id);
    expect(run).toMatchObject({
      id: result.run.id,
      projectId: ctx.project.id,
      createdBy: ctx.owner.user.id,
      agent: 'echo',
      status: 'succeeded',
      attempts: 1,
      input: { topic: 'hooks' },
      output: { title: 'Hello', count: 3 },
    });
    expect(run.tokens.input).toBeGreaterThan(0);
    expect(run.tokens.output).toBeGreaterThan(0);
    expect(run.ms).toBeGreaterThanOrEqual(0);
    // The prompt carries the input and the expected output shape.
    expect(llm.calls[0].prompt).toContain('hooks');
    expect(llm.calls[0].prompt).toContain('count');
  });

  it('schema-invalid then valid -> succeeded with attempts 2; the retry prompt quotes the validation error', async () => {
    const ctx = await owned();
    llm.queueResponse({ title: '', count: 'three' }, { title: 'Fixed', count: 1 });
    const result = await runAgent(base(ctx));
    expect(result.run).toMatchObject({ status: 'succeeded', attempts: 2 });
    expect(result.output).toEqual({ title: 'Fixed', count: 1 });
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].prompt).toMatch(/count/);
    expect(llm.calls[1].prompt).toMatch(/invalid/i);
  });

  it('invalid JSON text then valid -> succeeded with attempts 2', async () => {
    const ctx = await owned();
    llm.queueResponse('not json at all', { title: 'Ok', count: 2 });
    const result = await runAgent(base(ctx));
    expect(result.run).toMatchObject({ status: 'succeeded', attempts: 2 });
  });

  it('invalid twice -> failed, persist never called, error visible on the run', async () => {
    const ctx = await owned();
    llm.queueResponse({ nope: true }, 'still not json');
    let persisted = false;
    const result = await runAgent({ ...base(ctx), persist: async () => (persisted = true) });
    expect(persisted).toBe(false);
    expect(result.output).toBeNull();
    expect(result.run).toMatchObject({ status: 'failed', attempts: 2 });
    expect(result.run.error.code).toBe('invalid_output');
    expect(result.run.error.message).toMatch(/2 attempts/);
    const run = await getRun(ctx.project.id, result.run.id);
    expect(run.status).toBe('failed');
    expect(run.output).toBeNull();
  });

  it('persist runs with the output and the artifact reference lands on the run', async () => {
    const ctx = await owned();
    llm.queueResponse({ title: 'Saved', count: 9 });
    const result = await runAgent({
      ...base(ctx),
      persist: async (_client, { output }) => ({ type: 'echo', id: `echo-${output.count}` }),
    });
    expect(result.artifact).toEqual({ type: 'echo', id: 'echo-9' });
    expect(result.run.artifact).toEqual({ type: 'echo', id: 'echo-9' });
  });

  it('a thrown provider error is not retried: failed after one attempt with the message recorded', async () => {
    const ctx = await owned();
    llm.queueResponse(new Error('provider exploded'));
    const result = await runAgent(base(ctx));
    expect(result.run).toMatchObject({ status: 'failed', attempts: 1 });
    expect(result.run.error.message).toContain('provider exploded');
  });

  it('LLM timeout -> failed with code timeout', async () => {
    const ctx = await owned();
    configureRunner({ timeoutMs: 50 });
    llm.queueResponse(llm.delay(2000, { title: 'late', count: 1 }));
    const started = Date.now();
    const result = await runAgent(base(ctx));
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result.run).toMatchObject({ status: 'failed' });
    expect(result.run.error.code).toBe('timeout');
  });

  it('tools run before the model and their results reach the prompt and refine()', async () => {
    const ctx = await owned();
    llm.queueResponse({ title: 'With tools', count: 1 });
    const seen = {};
    const result = await runAgent({
      ...base(ctx),
      tools: [{ name: 'lookup', run: async (input) => ({ found: `about ${input.topic}` }) }],
      refine: (output, { toolResults }) => {
        seen.toolResults = toolResults;
        return { ...output, title: output.title.toUpperCase() };
      },
    });
    expect(llm.calls[0].prompt).toContain('about hooks');
    expect(seen.toolResults).toEqual({ lookup: { found: 'about hooks' } });
    expect(result.output.title).toBe('WITH TOOLS');
  });
});

describe('agent.run job', () => {
  it('startRun queues a run; draining runs it; an unknown agent fails with unknown_agent', async () => {
    const ctx = await owned();
    await clearQueues();
    const queued = await startRun({ agent: 'no-such-agent', projectId: ctx.project.id, userId: ctx.owner.user.id, input: {} });
    expect(queued.status).toBe('queued');
    const results = await drainQueue({ names: [JOBS.AGENT_RUN] });
    expect(results).toEqual([expect.objectContaining({ name: 'agent.run', state: 'completed' })]);
    const run = await getRun(ctx.project.id, queued.id);
    expect(run.status).toBe('failed');
    expect(run.error.code).toBe('unknown_agent');
  });

  it('the agent.run payload is Zod-validated', () => {
    expect(() => parsePayload(JOBS.AGENT_RUN, { runId: 'nope' })).toThrow();
    expect(parsePayload(JOBS.AGENT_RUN, { runId: '00000000-0000-4000-8000-000000000000' })).toEqual({
      runId: '00000000-0000-4000-8000-000000000000',
    });
  });
});

describe('GET /projects/:projectId/agents/runs/:runId', () => {
  it('members read the run; another project id or a bad id -> 404', async () => {
    const ctx = await owned();
    llm.queueResponse({ title: 'Polled', count: 4 });
    const { run } = await runAgent(base(ctx));

    const res = await request(app).get(`/projects/${ctx.project.id}/agents/runs/${run.id}`).set(authHeader(ctx.owner.token));
    expect(res.status).toBe(200);
    expect(res.body.run).toMatchObject({ id: run.id, status: 'succeeded', attempts: 1, output: { title: 'Polled', count: 4 } });

    const other = await request(app).post('/projects').set(authHeader(ctx.owner.token)).send({ name: 'Other' });
    const cross = await request(app)
      .get(`/projects/${other.body.project.id}/agents/runs/${run.id}`)
      .set(authHeader(ctx.owner.token));
    expect(cross.status).toBe(404);

    const bad = await request(app).get(`/projects/${ctx.project.id}/agents/runs/not-a-uuid`).set(authHeader(ctx.owner.token));
    expect(bad.status).toBe(404);
  });
});

// P4.T2: Director Agent. POST /agents/director/plan -> 202 { runId } -> agent.run job
// -> content_plans row; GET /plans, GET /plans/:planId.
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getLlm } from '../../src/adapters/llm/index.js';
import { configureRunner, resetRunner } from '../../src/modules/agents/service.js';
import { authHeader } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues, drainQueue } from '../helpers/queue.js';
import { directorBody, planReply, team } from './fixtures.js';

const app = createApp({ log: { error() {} } });
const llm = getLlm();
let t;

beforeEach(async () => {
  await resetDb();
  await clearQueues();
  llm.reset();
  resetRunner();
  t = await team(app);
});
afterEach(() => {
  llm.reset();
  resetRunner();
});
afterAll(closeAll);

const as = (user) => authHeader(user.token);
const base = () => `/projects/${t.project.id}`;

async function plan(user = t.editor, body = directorBody()) {
  const res = await request(app).post(`${base()}/agents/director/plan`).set(as(user)).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return res.body.runId;
}

const getRun = (runId, user = t.viewer) => request(app).get(`${base()}/agents/runs/${runId}`).set(as(user));

describe('POST /agents/director/plan', () => {
  it('202 { runId } -> queued run; drain -> succeeded with a stored, retrievable plan', async () => {
    llm.queueResponse(planReply());
    const runId = await plan();
    expect((await getRun(runId)).body.run).toMatchObject({ status: 'queued', agent: 'director' });

    await drainQueue();
    const run = (await getRun(runId)).body.run;
    expect(run).toMatchObject({ status: 'succeeded', attempts: 1, artifact: { type: 'plan' } });
    expect(llm.calls[0].prompt).toContain('home espresso');

    const planId = run.artifact.id;
    const one = await request(app).get(`${base()}/plans/${planId}`).set(as(t.viewer));
    expect(one.status).toBe(200);
    expect(one.body.plan).toMatchObject({
      id: planId,
      projectId: t.project.id,
      createdBy: t.editor.user.id,
      runId,
      input: directorBody(),
      doc: planReply(),
    });

    const list = await request(app).get(`${base()}/plans`).set(as(t.viewer));
    expect(list.status).toBe(200);
    expect(list.body.plans.map((p) => p.id)).toEqual([planId]);
  });

  it('invalid output once then valid -> succeeded with attempts = 2', async () => {
    llm.queueResponse({ ideas: [] }, planReply());
    const runId = await plan();
    await drainQueue();
    expect((await getRun(runId)).body.run).toMatchObject({ status: 'succeeded', attempts: 2 });
  });

  it('a schedule entry pointing at a missing idea counts as invalid output', async () => {
    const bad = planReply();
    bad.schedule.push({ date: '2026-10-10', ideaIdx: 7 });
    llm.queueResponse(bad, planReply());
    const runId = await plan();
    await drainQueue();
    const run = (await getRun(runId)).body.run;
    expect(run).toMatchObject({ status: 'succeeded', attempts: 2 });
    expect(llm.calls[1].prompt).toMatch(/ideaIdx/);
  });

  it('invalid twice -> run failed, error visible, no plan row', async () => {
    llm.queueResponse('not json', { ideas: 'nope' });
    const runId = await plan();
    await drainQueue();
    const run = (await getRun(runId)).body.run;
    expect(run).toMatchObject({ status: 'failed', attempts: 2, artifact: null });
    expect(run.error.code).toBe('invalid_output');
    expect(run.error.message).toBeTruthy();
    const list = await request(app).get(`${base()}/plans`).set(as(t.owner));
    expect(list.body.plans).toEqual([]);
  });

  it('invalid body -> 400 and nothing is queued', async () => {
    const res = await request(app)
      .post(`${base()}/agents/director/plan`)
      .set(as(t.editor))
      .send({ ...directorBody(), horizonDays: 0, niche: '' });
    expect(res.status).toBe(400);
    expect(await drainQueue()).toEqual([]);
  });

  it('viewer can read plans but gets 403 on running the agent', async () => {
    const res = await request(app).post(`${base()}/agents/director/plan`).set(as(t.viewer)).send(directorBody());
    expect(res.status).toBe(403);
    expect((await request(app).get(`${base()}/plans`).set(as(t.viewer))).status).toBe(200);
  });

  it('a plan id from another project -> 404, and a malformed id -> 404', async () => {
    llm.queueResponse(planReply());
    const runId = await plan();
    await drainQueue();
    const planId = (await getRun(runId)).body.run.artifact.id;
    const cross = await request(app).get(`/projects/${t.otherProject.id}/plans/${planId}`).set(as(t.owner));
    expect(cross.status).toBe(404);
    const crossRun = await request(app).get(`/projects/${t.otherProject.id}/agents/runs/${runId}`).set(as(t.owner));
    expect(crossRun.status).toBe(404);
    expect((await request(app).get(`${base()}/plans/xyz`).set(as(t.owner))).status).toBe(404);
  });

  it('LLM timeout -> run failed while the API stays responsive', async () => {
    configureRunner({ timeoutMs: 1500 });
    let modelCalled;
    const called = new Promise((r) => (modelCalled = r));
    llm.queueResponse((req) => {
      modelCalled();
      return llm.delay(10_000, planReply())(req);
    });
    const runId = await plan();

    const draining = drainQueue();
    // While the worker waits on the model, the API still answers quickly.
    await called;
    const started = Date.now();
    const health = await request(app).get('/health');
    const polled = await getRun(runId);
    expect(health.status).toBe(200);
    expect(polled.body.run.status).toBe('running');
    expect(Date.now() - started).toBeLessThan(1000);

    await draining;
    const run = (await getRun(runId)).body.run;
    expect(run.status).toBe('failed');
    expect(run.error.code).toBe('timeout');
    expect((await request(app).get(`${base()}/plans`).set(as(t.owner))).body.plans).toEqual([]);
  });
});

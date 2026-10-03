// P4.T3: Research Agent. POST /agents/research ({ topic } or { planId, ideaIndex })
// -> 202 -> research_briefs row; GET /briefs, GET /briefs/:briefId. Sources may only
// cite URLs the search adapter returned.
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getLlm } from '../../src/adapters/llm/index.js';
import { getWebSearch } from '../../src/adapters/search/index.js';
import { resetRunner } from '../../src/modules/agents/service.js';
import { authHeader } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues, drainQueue } from '../helpers/queue.js';
import { briefReply, directorBody, planReply, team } from './fixtures.js';

const app = createApp({ log: { error() {} } });
const llm = getLlm();
const search = getWebSearch();
let t;

beforeEach(async () => {
  await resetDb();
  await clearQueues();
  llm.reset();
  search.reset();
  resetRunner();
  t = await team(app);
});
afterEach(() => {
  llm.reset();
  search.reset();
});
afterAll(closeAll);

const as = (user) => authHeader(user.token);
const base = () => `/projects/${t.project.id}`;
const getRun = async (runId) => (await request(app).get(`${base()}/agents/runs/${runId}`).set(as(t.viewer))).body.run;

// URLs the fake search returns for a query (deterministic).
const searchedUrls = async (query) => (await search.search(query, { limit: 8 })).results.map((r) => r.url);

// Reply function: cites the first two URLs from the search results in the prompt.
const citeFromPrompt = (extra = []) => (req) => {
  const urls = [...new Set(req.prompt.match(/https:\/\/example\.com\/[^\s"]+/g) ?? [])];
  return briefReply([...urls.slice(0, 2), ...extra]);
};

async function research(body, user = t.editor) {
  const res = await request(app).post(`${base()}/agents/research`).set(as(user)).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return res.body.runId;
}

describe('POST /agents/research', () => {
  it('topic -> 202 -> drain -> succeeded; the brief is stored, retrievable and cites only searched URLs', async () => {
    llm.queueResponse(citeFromPrompt());
    const runId = await research({ topic: 'espresso grind size' });
    await drainQueue();

    const run = await getRun(runId);
    expect(run).toMatchObject({ status: 'succeeded', agent: 'research', attempts: 1, artifact: { type: 'brief' } });
    expect(search.calls[0].query).toContain('espresso grind size');
    expect(run.toolResults.web_search.results.length).toBeGreaterThan(0);

    const res = await request(app).get(`${base()}/briefs/${run.artifact.id}`).set(as(t.viewer));
    expect(res.status).toBe(200);
    const brief = res.body.brief;
    expect(brief).toMatchObject({ projectId: t.project.id, runId, planId: null, ideaIndex: null, topic: 'espresso grind size' });
    expect(brief.doc.sources).toHaveLength(2);

    // The recorded tool results are exactly what the search adapter returns for that query.
    const allowed = await searchedUrls(run.toolResults.web_search.query);
    expect(run.toolResults.web_search.results.map((r) => r.url)).toEqual(allowed);
    for (const s of brief.doc.sources) expect(allowed).toContain(s.url);

    const list = await request(app).get(`${base()}/briefs`).set(as(t.viewer));
    expect(list.body.briefs.map((b) => b.id)).toEqual([brief.id]);
  });

  it('invented URLs are dropped: every stored source came from the search results', async () => {
    llm.queueResponse(citeFromPrompt(['https://invented.example/fake-study']));
    const runId = await research({ topic: 'latte art' });
    await drainQueue();
    const run = await getRun(runId);
    expect(run.status).toBe('succeeded');
    const brief = (await request(app).get(`${base()}/briefs/${run.artifact.id}`).set(as(t.owner))).body.brief;
    const allowed = run.toolResults.web_search.results.map((r) => r.url);
    expect(brief.doc.sources.length).toBe(2);
    expect(brief.doc.sources.every((s) => allowed.includes(s.url))).toBe(true);
    expect(JSON.stringify(brief)).not.toContain('invented.example');
  });

  it('only invented URLs -> retried with the reason; twice -> failed with no brief', async () => {
    llm.queueResponse(briefReply(['https://invented.example/a']), briefReply(['https://invented.example/b']));
    const runId = await research({ topic: 'tamping' });
    await drainQueue();
    const run = await getRun(runId);
    expect(run).toMatchObject({ status: 'failed', attempts: 2, artifact: null });
    expect(run.error.code).toBe('invalid_output');
    expect(llm.calls[1].prompt).toMatch(/search results/i);
    expect((await request(app).get(`${base()}/briefs`).set(as(t.owner))).body.briefs).toEqual([]);
  });

  it('invalid output once then valid -> attempts = 2', async () => {
    llm.queueResponse({ summary: 42 }, citeFromPrompt());
    const runId = await research({ topic: 'water hardness' });
    await drainQueue();
    expect(await getRun(runId)).toMatchObject({ status: 'succeeded', attempts: 2 });
  });

  it('from a plan idea: the brief links to the plan and idea index, and the search uses the idea', async () => {
    llm.queueResponse(planReply());
    const planRes = await request(app).post(`${base()}/agents/director/plan`).set(as(t.editor)).send(directorBody());
    await drainQueue();
    const planId = (await getRun(planRes.body.runId)).artifact.id;

    llm.queueResponse(citeFromPrompt());
    const runId = await research({ planId, ideaIndex: 1 });
    await drainQueue();
    const run = await getRun(runId);
    expect(run.status).toBe('succeeded');
    expect(run.input).toMatchObject({ planId, ideaIndex: 1, idea: planReply().ideas[1] });
    expect(search.calls[0].query).toContain(planReply().ideas[1].title);
    const brief = (await request(app).get(`${base()}/briefs/${run.artifact.id}`).set(as(t.viewer))).body.brief;
    expect(brief).toMatchObject({ planId, ideaIndex: 1, topic: planReply().ideas[1].title });
  });

  it('body must name exactly one of topic or planId (+ ideaIndex) -> otherwise 400', async () => {
    const post = (body) => request(app).post(`${base()}/agents/research`).set(as(t.editor)).send(body);
    expect((await post({})).status).toBe(400);
    expect((await post({ topic: 'a', planId: '00000000-0000-4000-8000-000000000000', ideaIndex: 0 })).status).toBe(400);
    expect((await post({ planId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    expect(await drainQueue()).toEqual([]);
  });

  it('a plan from another project -> 404; an idea index past the plan -> 400', async () => {
    llm.queueResponse(planReply());
    const other = await request(app)
      .post(`/projects/${t.otherProject.id}/agents/director/plan`)
      .set(as(t.owner))
      .send(directorBody());
    await drainQueue();
    const foreignPlanId = (
      await request(app).get(`/projects/${t.otherProject.id}/agents/runs/${other.body.runId}`).set(as(t.owner))
    ).body.run.artifact.id;

    const cross = await request(app)
      .post(`${base()}/agents/research`)
      .set(as(t.editor))
      .send({ planId: foreignPlanId, ideaIndex: 0 });
    expect(cross.status).toBe(404);

    const past = await request(app)
      .post(`/projects/${t.otherProject.id}/agents/research`)
      .set(as(t.owner))
      .send({ planId: foreignPlanId, ideaIndex: 5 });
    expect(past.status).toBe(400);
  });

  it('viewer reads briefs but gets 403 running research; foreign brief id -> 404', async () => {
    expect((await request(app).post(`${base()}/agents/research`).set(as(t.viewer)).send({ topic: 'x' })).status).toBe(403);
    expect((await request(app).get(`${base()}/briefs`).set(as(t.viewer))).status).toBe(200);

    llm.queueResponse(citeFromPrompt());
    const runId = await research({ topic: 'crema' });
    await drainQueue();
    const briefId = (await getRun(runId)).artifact.id;
    const cross = await request(app).get(`/projects/${t.otherProject.id}/briefs/${briefId}`).set(as(t.owner));
    expect(cross.status).toBe(404);
  });
});

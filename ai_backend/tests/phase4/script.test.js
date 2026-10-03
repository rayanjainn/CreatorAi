// P4.T4: Script Agent. POST /agents/script { briefId } -> 202 -> scripts row;
// GET /scripts, GET /scripts/:scriptId, PATCH /scripts/:scriptId (human edits).
// Includes the chain test: plan -> research(ideas[0]) -> script, linked by foreign keys.
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { getLlm } from '../../src/adapters/llm/index.js';
import { getPool } from '../../src/db/pool.js';
import { resetRunner } from '../../src/modules/agents/service.js';
import { authHeader } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues, drainQueue } from '../helpers/queue.js';
import { briefReply, directorBody, planReply, scriptReply, team } from './fixtures.js';

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
afterEach(() => llm.reset());
afterAll(closeAll);

const as = (user) => authHeader(user.token);
const base = (project = t.project) => `/projects/${project.id}`;
const getRun = async (runId, project = t.project) =>
  (await request(app).get(`${base(project)}/agents/runs/${runId}`).set(as(t.owner))).body.run;

const citeFromPrompt = (req) => briefReply((req.prompt.match(/https:\/\/example\.com\/[^\s"]+/g) ?? []).slice(0, 2));

// Runs an agent through the API and the queue; returns the finished run.
async function runVia(path, body, reply, { user = t.editor, project = t.project } = {}) {
  llm.queueResponse(...[].concat(reply));
  const res = await request(app).post(`${base(project)}${path}`).set(as(user)).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  await drainQueue();
  return getRun(res.body.runId, project);
}

async function makeBrief(project = t.project) {
  const run = await runVia('/agents/research', { topic: 'espresso grind size' }, citeFromPrompt, { user: t.owner, project });
  expect(run.status).toBe('succeeded');
  return run.artifact.id;
}

describe('chain: plan -> research(ideas[0]) -> script', () => {
  it('each step succeeds and the foreign keys link all three artifacts', async () => {
    const planRun = await runVia('/agents/director/plan', directorBody(), planReply());
    expect(planRun.status).toBe('succeeded');
    const planId = planRun.artifact.id;

    const briefRun = await runVia('/agents/research', { planId, ideaIndex: 0 }, citeFromPrompt);
    expect(briefRun.status).toBe('succeeded');
    const briefId = briefRun.artifact.id;

    const scriptRun = await runVia('/agents/script', { briefId, targetSeconds: 30 }, scriptReply());
    expect(scriptRun).toMatchObject({ status: 'succeeded', agent: 'script', attempts: 1, artifact: { type: 'script' } });
    const scriptId = scriptRun.artifact.id;

    // The Script Agent saw the idea and the brief.
    const prompt = llm.calls.at(-1).prompt;
    expect(prompt).toContain(planReply().ideas[0].title);
    expect(prompt).toContain(briefReply([]).summary);

    const script = (await request(app).get(`${base()}/scripts/${scriptId}`).set(as(t.viewer))).body.script;
    expect(script).toMatchObject({ id: scriptId, briefId, runId: scriptRun.id, doc: scriptReply(), createdBy: t.editor.user.id });
    const brief = (await request(app).get(`${base()}/briefs/${briefId}`).set(as(t.viewer))).body.brief;
    expect(brief).toMatchObject({ planId, ideaIndex: 0 });

    const { rows } = await getPool().query(
      `SELECT s.id AS script_id, b.id AS brief_id, p.id AS plan_id
         FROM scripts s
         JOIN research_briefs b ON b.id = s.brief_id
         JOIN content_plans p ON p.id = b.plan_id
        WHERE s.id = $1`,
      [scriptId],
    );
    expect(rows).toEqual([{ script_id: scriptId, brief_id: briefId, plan_id: planId }]);

    // The foreign keys are real constraints, not just matching ids.
    const { rows: fks } = await getPool().query(
      `SELECT conrelid::regclass::text AS tbl, confrelid::regclass::text AS ref
         FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text IN ('scripts', 'research_briefs')`,
    );
    expect(fks).toEqual(
      expect.arrayContaining([
        { tbl: 'scripts', ref: 'research_briefs' },
        { tbl: 'research_briefs', ref: 'content_plans' },
      ]),
    );

    const list = await request(app).get(`${base()}/scripts`).set(as(t.viewer));
    expect(list.body.scripts.map((s) => s.id)).toEqual([scriptId]);
  });
});

describe('POST /agents/script', () => {
  it('invalid output once then valid -> attempts = 2', async () => {
    const briefId = await makeBrief();
    const run = await runVia('/agents/script', { briefId }, [{ hooks: [] }, scriptReply()]);
    expect(run).toMatchObject({ status: 'succeeded', attempts: 2 });
  });

  it('invalid twice -> failed, error visible, no script row', async () => {
    const briefId = await makeBrief();
    const run = await runVia('/agents/script', { briefId }, ['nope', { script: 'nope' }]);
    expect(run).toMatchObject({ status: 'failed', attempts: 2, artifact: null });
    expect(run.error.code).toBe('invalid_output');
    expect((await request(app).get(`${base()}/scripts`).set(as(t.owner))).body.scripts).toEqual([]);
  });

  it('a brief from another project -> 404; a bad body -> 400; viewer -> 403', async () => {
    const foreignBrief = await makeBrief(t.otherProject);
    const post = (user, body) => request(app).post(`${base()}/agents/script`).set(as(user)).send(body);
    expect((await post(t.editor, { briefId: foreignBrief })).status).toBe(404);
    expect((await post(t.editor, { briefId: 'nope' })).status).toBe(400);
    expect((await post(t.editor, { briefId: foreignBrief, targetSeconds: -5 })).status).toBe(400);
    expect((await post(t.viewer, { briefId: foreignBrief })).status).toBe(403);
    expect(await drainQueue()).toEqual([]);
  });
});

describe('scripts: read and human edits', () => {
  async function makeScript() {
    const briefId = await makeBrief();
    const run = await runVia('/agents/script', { briefId }, scriptReply());
    return run.artifact.id;
  }

  it('PATCH (editor+) merges the edited fields, validates the result and records the editor', async () => {
    const scriptId = await makeScript();
    const res = await request(app)
      .patch(`${base()}/scripts/${scriptId}`)
      .set(as(t.editor))
      .send({ cta: 'Comment your grinder', hooks: ['A better hook'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.script.doc).toEqual({ ...scriptReply(), cta: 'Comment your grinder', hooks: ['A better hook'] });
    expect(res.body.script.editedBy).toBe(t.editor.user.id);
    expect(res.body.script.editedAt).toBeTruthy();

    const again = await request(app).get(`${base()}/scripts/${scriptId}`).set(as(t.viewer));
    expect(again.body.script.doc.cta).toBe('Comment your grinder');
  });

  it('PATCH rejects invalid edits with 400 and leaves the script unchanged', async () => {
    const scriptId = await makeScript();
    const patch = (body) => request(app).patch(`${base()}/scripts/${scriptId}`).set(as(t.owner)).send(body);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ hooks: [] })).status).toBe(400);
    expect((await patch({ script: [{ section: 'x', text: 'y', estSeconds: -1 }] })).status).toBe(400);
    expect((await patch({ cta: 'ok', extra: true })).status).toBe(400);
    const now = await request(app).get(`${base()}/scripts/${scriptId}`).set(as(t.owner));
    expect(now.body.script.doc).toEqual(scriptReply());
    expect(now.body.script.editedBy).toBeNull();
  });

  it('viewer reads but cannot PATCH; another project id -> 404', async () => {
    const scriptId = await makeScript();
    expect((await request(app).get(`${base()}/scripts/${scriptId}`).set(as(t.viewer))).status).toBe(200);
    expect((await request(app).patch(`${base()}/scripts/${scriptId}`).set(as(t.viewer)).send({ cta: 'x' })).status).toBe(403);
    const otherBase = base(t.otherProject);
    expect((await request(app).get(`${otherBase}/scripts/${scriptId}`).set(as(t.owner))).status).toBe(404);
    expect((await request(app).patch(`${otherBase}/scripts/${scriptId}`).set(as(t.owner)).send({ cta: 'x' })).status).toBe(404);
    expect((await request(app).get(`${base()}/scripts/not-a-uuid`).set(as(t.owner))).status).toBe(404);
  });
});

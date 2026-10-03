// Shared phase-4 test fixtures: a project team over HTTP and schema-valid agent replies.
import request from 'supertest';
import { expect } from 'vitest';
import { authHeader, createUser } from '../helpers/auth.js';

// owner + editor + viewer on one project, plus a non-member and a second project.
export async function team(app) {
  const [owner, editor, viewer, outsider] = await Promise.all([1, 2, 3, 4].map(() => createUser(app)));
  const create = async (name) => {
    const res = await request(app).post('/projects').set(authHeader(owner.token)).send({ name });
    expect(res.status).toBe(201);
    return res.body.project;
  };
  const project = await create('Agents');
  const otherProject = await create('Elsewhere');
  for (const [user, role] of [[editor, 'editor'], [viewer, 'viewer']]) {
    const add = await request(app)
      .post(`/projects/${project.id}/members`)
      .set(authHeader(owner.token))
      .send({ email: user.email, role });
    expect(add.status).toBe(201);
  }
  return { owner, editor, viewer, outsider, project, otherProject };
}

export const directorBody = () => ({
  niche: 'home espresso',
  audience: 'beginners with a budget machine',
  goals: ['grow to 10k followers', 'sell a course'],
  cadence: '3 per week',
  horizonDays: 14,
});

export const planReply = () => ({
  ideas: [
    { title: 'Dial in any bean in 5 shots', angle: 'myth busting', format: 'short', hook: 'You are wasting beans' },
    { title: 'Milk steaming under $100', angle: 'budget', format: 'tutorial', hook: 'Latte art on a budget' },
  ],
  schedule: [
    { date: '2026-10-06', ideaIdx: 0 },
    { date: '2026-10-08', ideaIdx: 1 },
  ],
});

// A brief citing the given URLs.
export const briefReply = (urls) => ({
  summary: 'Beginners struggle with grind size more than anything else.',
  keyPoints: ['Grind finer when shots run fast', 'Weigh doses'],
  trends: ['Single dosing'],
  sources: urls.map((url, i) => ({ title: `Source ${i + 1}`, url })),
});

export const scriptReply = () => ({
  hooks: ['Stop wasting beans', 'Five shots to the perfect espresso'],
  script: [
    { section: 'hook', text: 'Your first shot tasted sour? Here is why.', estSeconds: 4 },
    { section: 'body', text: 'Grind finer until the shot takes 28 seconds.', estSeconds: 20 },
    { section: 'cta', text: 'Follow for part two.', estSeconds: 3 },
  ],
  cta: 'Follow for part two',
  shots: [{ section: 'hook', description: 'Close-up of a sour face after a sip' }],
  broll: [{ section: 'body', description: 'Slow-motion espresso pour' }],
});

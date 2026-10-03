import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enqueue, getBoss } from '../../src/queue/boss.js';
import { JOBS } from '../../src/queue/jobs.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues, drainQueue } from '../helpers/queue.js';

beforeAll(resetDb);
beforeEach(clearQueues);
afterAll(closeAll);

describe('queue', () => {
  it('noop job: enqueued -> processed by drainQueue() -> completion recorded', async () => {
    const id = await enqueue(JOBS.NOOP, { message: 'hello' });
    expect(id).toBeTruthy();

    const results = await drainQueue();
    expect(results).toEqual([expect.objectContaining({ name: JOBS.NOOP, id, state: 'completed' })]);

    const boss = await getBoss();
    const [job] = await boss.findJobs(JOBS.NOOP, { id });
    expect(job.state).toBe('completed');
    expect(job.output).toMatchObject({ ok: true, echo: 'hello' });
  });

  it('drainQueue() on empty queues returns nothing', async () => {
    expect(await drainQueue()).toEqual([]);
  });

  it('rejects a payload that does not match the job schema', async () => {
    await expect(enqueue(JOBS.NOOP, { message: 42 })).rejects.toThrow();
    await expect(enqueue(JOBS.NOOP, { unexpected: true })).rejects.toThrow();
  });

  it('rejects a job name without a payload schema', async () => {
    await expect(enqueue('nope.unknown', {})).rejects.toThrow(/Unknown job/);
  });
});

import { getBoss, runJob } from '../../src/queue/boss.js';
import { handlers } from '../../src/workers/index.js';

// Runs every pending job inline, including jobs that handlers enqueue along the way,
// until all queues are empty. Returns [{ name, id, state, output | error }] in run order.
// Jobs waiting on a retry delay are not picked up; a test that needs them calls this again.
export async function drainQueue({ names = Object.keys(handlers), maxJobs = 500 } = {}) {
  const boss = await getBoss();
  const results = [];
  for (;;) {
    let ran = false;
    for (const name of names) {
      const [job] = await boss.fetch(name, { batchSize: 1 });
      if (!job) continue;
      ran = true;
      results.push(await runJob(boss, name, job));
      if (results.length > maxJobs) throw new Error(`drainQueue ran more than ${maxJobs} jobs: is a job re-enqueueing itself?`);
    }
    if (!ran) return results;
  }
}

// Empties every queue so jobs from one test can't leak into the next.
export async function clearQueues() {
  const boss = await getBoss();
  for (const name of Object.keys(handlers)) await boss.deleteAllJobs(name);
}

// pg-boss on the app's own Postgres (schema "pgboss"), so there is no Redis to run.
import { PgBoss } from 'pg-boss';
import { getEnv } from '../config/env.js';
import { PAYLOADS, parsePayload } from './jobs.js';
import { handlers } from '../workers/index.js';

export const DEFAULT_SEND_OPTIONS = Object.freeze({ retryLimit: 2, retryDelay: 5, retryBackoff: true });

let starting;

async function start() {
  const env = getEnv();
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: 'pgboss',
    max: 5,
    // Tests drain jobs by hand; background timers would only race them.
    supervise: env.NODE_ENV !== 'test',
    schedule: env.NODE_ENV !== 'test',
  });
  boss.on('error', (err) => console.error('[pg-boss]', err.message));
  await boss.start();
  for (const name of Object.keys(PAYLOADS)) {
    if (!(await boss.getQueue(name))) await boss.createQueue(name);
  }
  return boss;
}

export function getBoss() {
  starting ??= start().catch((err) => {
    starting = undefined;
    throw err;
  });
  return starting;
}

export async function stopBoss() {
  if (!starting) return;
  const pending = starting;
  starting = undefined;
  const boss = await pending.catch(() => null);
  await boss?.stop({ graceful: false, close: true });
}

// Validates the payload against its schema, then enqueues. Returns the job id.
export async function enqueue(name, data, options = {}) {
  const payload = parsePayload(name, data);
  const boss = await getBoss();
  return boss.send(name, payload, { ...DEFAULT_SEND_OPTIONS, ...options });
}

// Runs one fetched job through its handler and records the outcome in pg-boss, the way
// boss.work() does in worker.js. Used by drainQueue() to run jobs inline in tests.
export async function runJob(boss, name, job) {
  const handler = handlers[name];
  if (!handler) throw new Error(`No handler registered for job "${name}"`);
  try {
    const output = await handler(job.data, job);
    const data = output == null || typeof output === 'object' ? output ?? null : { value: output };
    await boss.complete(name, job.id, data);
    return { name, id: job.id, state: 'completed', output: data };
  } catch (err) {
    await boss.fail(name, job.id, { message: err.message, retryable: err.retryable !== false });
    return { name, id: job.id, state: 'failed', error: err.message };
  }
}

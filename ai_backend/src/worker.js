import { getEnv } from './config/env.js';

try {
  getEnv();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const { migrate } = await import('./db/migrate.js');
const { closePool } = await import('./db/pool.js');
const { getBoss, stopBoss } = await import('./queue/boss.js');
const { handlers } = await import('./workers/index.js');

await migrate();
const boss = await getBoss();

for (const [name, handler] of Object.entries(handlers)) {
  // One job at a time per queue: the free-tier providers behind most jobs rate-limit hard.
  // pg-boss completes the job with the returned output, or fails (and retries) it on throw.
  await boss.work(name, { batchSize: 1 }, async ([job]) => {
    try {
      const output = await handler(job.data, job);
      console.log(`[worker] ${name} ${job.id} completed`);
      return output;
    } catch (err) {
      console.error(`[worker] ${name} ${job.id} failed: ${err.message}`);
      throw err;
    }
  });
}
console.log(`worker listening on: ${Object.keys(handlers).join(', ')}`);

async function shutdown() {
  await stopBoss();
  await closePool();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

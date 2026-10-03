import { getEnv } from './config/env.js';

let env;
try {
  env = getEnv();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const { createApp } = await import('./app.js');
const { migrate } = await import('./db/migrate.js');
const { closePool } = await import('./db/pool.js');

await migrate();
const server = createApp().listen(env.PORT, () => {
  console.log(`api listening on :${env.PORT} (${env.NODE_ENV}, adapters=${env.ADAPTERS}, vectors=${env.VECTOR_BACKEND})`);
});

function shutdown() {
  server.close(() => closePool().finally(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

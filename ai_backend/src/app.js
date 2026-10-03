// Express app factory. Frozen after phase 0: modules replace their own routes.js and
// never edit this file. Every router below is mounted from day one (as 501 stubs).
import express from 'express';
import { getPool } from './db/pool.js';
import { errorHandler, notFoundHandler, requestId } from './lib/http.js';
import { router as authRoutes } from './modules/auth/routes.js';
import { router as projectRoutes } from './modules/projects/routes.js';
import { router as mediaRoutes, webhookRouter as mediaWebhooks } from './modules/media/routes.js';
import { router as searchRoutes } from './modules/search/routes.js';
import { router as timelineRoutes } from './modules/timeline/routes.js';
import { router as renderRoutes } from './modules/render/routes.js';
import { router as mcpRoutes } from './modules/mcp/routes.js';
import { router as agentRunRoutes } from './modules/agents/routes.js';
import { router as directorRoutes } from './modules/agents/director/routes.js';
import { router as researchRoutes } from './modules/agents/research/routes.js';
import { router as scriptRoutes } from './modules/agents/script/routes.js';
import { router as editingRoutes } from './modules/agents/editing/routes.js';
import { router as twinRoutes } from './modules/agents/twin/routes.js';

// Routers mounted under /projects/:projectId declare their full sub-paths
// (e.g. '/timelines/:timelineId'), so they can share the prefix without clashing.
export const PROJECT_ROUTERS = [
  mediaRoutes,
  searchRoutes,
  timelineRoutes,
  renderRoutes,
  agentRunRoutes,
  directorRoutes,
  researchRoutes,
  scriptRoutes,
  editingRoutes,
  twinRoutes,
];

const HEALTH_TIMEOUT_MS = 2000;

async function pingDb(pool) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('database ping timed out')), HEALTH_TIMEOUT_MS);
  });
  try {
    await Promise.race([pool.query('SELECT 1'), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// options.pool overrides the database used by /health.
// options.configure(app) adds routes before the 404/error handlers (used by tests).
export function createApp({ pool, configure, log = console } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');

  app.use(requestId());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (req, res) => {
    try {
      await pingDb(pool ?? getPool());
      res.json({ status: 'ok', db: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  });

  app.use('/auth', authRoutes);
  app.use('/projects', projectRoutes);
  for (const router of PROJECT_ROUTERS) app.use('/projects/:projectId', router);
  app.use('/webhooks', mediaWebhooks);
  app.use('/mcp', mcpRoutes);

  configure?.(app);

  app.use(notFoundHandler());
  app.use(errorHandler({ log }));
  return app;
}

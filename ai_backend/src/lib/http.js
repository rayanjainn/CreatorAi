import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from './errors.js';

const SAFE_REQUEST_ID = /^[\w.-]{1,64}$/;

export function requestId() {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.set('x-request-id', req.id);
    next();
  };
}

// validate(schema) checks req.body; validate({ body, params, query }) checks several parts.
// Parsed values replace req.body and req.params; the parsed query lands on req.validQuery
// because req.query is a read-only getter in Express 5.
export function validate(schemaOrParts) {
  const parts = schemaOrParts instanceof z.ZodType ? { body: schemaOrParts } : schemaOrParts;
  return (req, res, next) => {
    const issues = [];
    const parsed = {};
    for (const [part, schema] of Object.entries(parts)) {
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) parsed[part] = result.data;
      else issues.push(...result.error.issues.map((i) => ({ ...i, path: [part, ...i.path] })));
    }
    if (issues.length) return next(new HttpError(400, 'validation_failed', 'Request validation failed', issues));
    if (parsed.body !== undefined) req.body = parsed.body;
    if (parsed.params !== undefined) Object.assign(req.params, parsed.params);
    if (parsed.query !== undefined) req.validQuery = parsed.query;
    next();
  };
}

// A router whose planned endpoints answer 501 until their phase lands. Registering the
// exact paths (not a catch-all) keeps unknown URLs on the 404 path and lets several
// routers share the /projects/:projectId prefix.
export function stubRouter(phase, routes) {
  const router = Router({ mergeParams: true });
  for (const [method, path] of routes) {
    router[method.toLowerCase()](path, (req, res) => {
      res.status(501).json({
        error: {
          code: 'not_implemented',
          message: `${method.toUpperCase()} ${path} is planned for phase ${phase}`,
          requestId: req.id,
        },
      });
    });
  }
  return router;
}

export function notFoundHandler() {
  return (req, res) => {
    res.status(404).json({
      error: { code: 'not_found', message: `No route for ${req.method} ${req.path}`, requestId: req.id },
    });
  };
}

export function errorHandler({ log = console } = {}) {
  // Express only treats a middleware as an error handler when it declares four arguments.
  return (err, req, res, _next) => {
    let status = 500;
    let body = { code: 'internal', message: 'Internal Server Error' };

    if (err instanceof HttpError) {
      status = err.status;
      body = { code: err.code, message: err.message };
      if (err.details !== undefined) body.details = err.details;
    } else if (err instanceof z.ZodError) {
      status = 400;
      body = { code: 'validation_failed', message: 'Request validation failed', details: err.issues };
    } else if (err?.type === 'entity.parse.failed') {
      status = 400;
      body = { code: 'invalid_json', message: 'Request body is not valid JSON' };
    } else if (err?.type === 'entity.too.large') {
      status = 413;
      body = { code: 'payload_too_large', message: 'Request body is too large' };
    }

    if (status >= 500) log.error(`[${req.id}] ${req.method} ${req.originalUrl}`, err);
    res.status(status).json({ error: { ...body, requestId: req.id } });
  };
}

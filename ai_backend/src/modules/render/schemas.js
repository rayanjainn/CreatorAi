// render schemas: request bodies and the render output shape.
import { z } from 'zod';
import { RENDER_KINDS } from './ffmpeg-args.js';

export const RENDER_STATUSES = Object.freeze(['queued', 'rendering', 'done', 'failed']);

export const RenderKind = z.enum(RENDER_KINDS);

// POST /timelines/:timelineId/render. version omitted -> the timeline's head.
export const RequestRenderBody = z.strictObject({
  version: z.number().int().min(1).optional(),
  kind: RenderKind,
});

export const RenderId = z.uuid();

export const Render = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  timelineId: z.uuid(),
  version: z.number().int().min(1),
  kind: RenderKind,
  status: z.enum(RENDER_STATUSES),
  progress: z.number().min(0).max(1),
  outputAssetId: z.uuid().nullable(),
  outputUrl: z.string().nullable(),
  error: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  requestedBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});

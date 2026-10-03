// media schemas: request bodies, params, queries and the asset output shape.
import { z } from 'zod';

export const KINDS = ['original', 'proxy', 'keyframe', 'audio', 'render'];
export const STATUSES = ['pending', 'uploaded', 'processing', 'indexed', 'failed'];
export const Kind = z.enum(KINDS);

export const AssetId = z.uuid();

// The folder is always chosen by the server; the client sends nothing.
export const SignBody = z.strictObject({});

export const ListQuery = z.strictObject({
  kind: Kind.default('original'),
  parentAssetId: AssetId.optional(),
});

export const Asset = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  kind: Kind,
  parentAssetId: z.uuid().nullable(),
  publicId: z.string(),
  url: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  status: z.enum(STATUSES),
  meta: z.record(z.string(), z.unknown()),
  createdBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

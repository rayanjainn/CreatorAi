// media schemas: request bodies, params, queries and the asset output shape.
import { z } from 'zod';

export const KINDS = ['original', 'proxy', 'keyframe', 'audio', 'render'];
export const STATUSES = ['pending', 'uploaded', 'processing', 'indexed', 'failed'];
export const Kind = z.enum(KINDS);

export const AssetId = z.uuid();

// The folder is always chosen by the server; the client sends nothing.
export const SignBody = z.strictObject({});

// Register after a direct upload: the Cloudinary public_id the upload returned.
export const RegisterBody = z.strictObject({
  publicId: z.string().trim().min(1).max(512),
});

// Cloudinary notification (webhook). Cloudinary sends many more fields than these, and
// their set varies by notification type, so unknown keys are allowed through.
export const CloudinaryNotification = z.looseObject({
  notification_type: z.string().min(1),
  public_id: z.string().min(1).optional(),
  resource_type: z.string().optional(),
});

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

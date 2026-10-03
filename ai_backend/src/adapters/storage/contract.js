import { z } from 'zod';

export const ResourceType = z.enum(['video', 'image', 'raw']);

export const SignUploadOutput = z.object({
  cloudName: z.string().min(1),
  apiKey: z.string().min(1),
  timestamp: z.number().int().positive(),
  signature: z.string().min(1),
  folder: z.string().min(1),
  resourceType: ResourceType,
  uploadUrl: z.string().url(),
});

export const Resource = z.object({
  publicId: z.string().min(1),
  resourceType: ResourceType,
  url: z.string().url(),
  format: z.string(),
  bytes: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const DestroyOutput = z.object({ result: z.enum(['ok', 'not found']) });

import { z } from 'zod';

export const TranscribeInput = z
  .object({
    url: z.string().optional(),
    filePath: z.string().optional(),
    language: z.string().optional(),
    durationMs: z.number().int().positive().optional(),
  })
  .refine((v) => v.url || v.filePath, 'url or filePath is required');

export const TranscribeOutput = z.object({
  language: z.string(),
  durationMs: z.number().int().nonnegative(),
  segments: z.array(
    z
      .object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), text: z.string().min(1) })
      .refine((s) => s.endMs > s.startMs, 'endMs must be after startMs'),
  ),
});

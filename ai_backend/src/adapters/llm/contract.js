import { z } from 'zod';

export const CompleteJsonInput = z.object({
  system: z.string().optional(),
  prompt: z.string().min(1),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  images: z.array(z.string()).optional(), // URLs for vision calls
  timeoutMs: z.number().int().positive().optional(),
});

export const CompleteJsonOutput = z.object({
  json: z.record(z.string(), z.unknown()),
  text: z.string(),
  provider: z.string(),
  model: z.string(),
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }),
});

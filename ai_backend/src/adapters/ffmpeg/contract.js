import { z } from 'zod';

export const ProbeOutput = z.object({
  durationMs: z.number().int().nonnegative(),
  format: z.string(),
  streams: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      type: z.enum(['video', 'audio', 'other']),
      codec: z.string(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      fps: z.number().positive().optional(),
      sampleRate: z.number().int().positive().optional(),
      channels: z.number().int().positive().optional(),
    }),
  ),
});

export const RunOutput = z.object({ code: z.number().int(), stderrTail: z.string() });

// detectScenes(input, { threshold }) -> cut times in ms, ascending, each > 0.
export const DetectScenesOutput = z.array(z.number().int().positive());

export const ExtractFrameOutput = z.object({ path: z.string().min(1) });

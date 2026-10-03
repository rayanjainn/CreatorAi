import { z } from 'zod';

export const TranscribeInput = z
  .object({
    url: z.string().optional(),
    filePath: z.string().optional(),
    language: z.string().optional(),
    durationMs: z.number().int().positive().optional(),
  })
  .refine((v) => v.url || v.filePath, 'url or filePath is required');

const Segment = z
  .object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), text: z.string().min(1) })
  .refine((s) => s.endMs > s.startMs, 'endMs must be after startMs');

export const TranscribeOutput = z.object({
  language: z.string(),
  durationMs: z.number().int().nonnegative(),
  segments: z.array(Segment),
});

// Long audio is transcribed in chunks. Each chunk's segment times are relative to the
// chunk start; offsetMs is where the chunk starts in the whole file. Chunks may overlap.
export const ChunkedTranscribeOutput = z.object({
  language: z.string(),
  durationMs: z.number().int().nonnegative(),
  chunks: z
    .array(
      z.object({
        offsetMs: z.number().int().nonnegative(),
        segments: z.array(Segment),
      }),
    )
    .min(1),
});

// normalizeTranscript(output, { durationMs? }) -> { language, durationMs, segments }:
// one continuous list in file time, ordered by start, non-overlapping and clipped to
// [0, durationMs] (the asset's duration when known, else the output's). Chunk offsets are
// added to each chunk's segments; where chunks overlap, a segment that ends before the
// previous one does is dropped as a duplicate and a partly overlapping one is trimmed.
export function normalizeTranscript(output, { durationMs } = {}) {
  const chunked = output && Array.isArray(output.chunks);
  const parsed = chunked ? ChunkedTranscribeOutput.parse(output) : TranscribeOutput.parse(output);
  const limit = durationMs ?? parsed.durationMs;
  const chunks = chunked ? [...parsed.chunks].sort((a, b) => a.offsetMs - b.offsetMs) : [{ offsetMs: 0, segments: parsed.segments }];

  const all = chunks
    .flatMap((c) => c.segments.map((s) => ({ startMs: s.startMs + c.offsetMs, endMs: s.endMs + c.offsetMs, text: s.text.trim() })))
    .filter((s) => s.text)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const segments = [];
  let lastEnd = 0;
  for (const s of all) {
    const startMs = Math.max(s.startMs, lastEnd);
    const endMs = limit > 0 ? Math.min(s.endMs, limit) : s.endMs;
    if (endMs <= startMs) continue;
    segments.push({ startMs, endMs, text: s.text });
    lastEnd = endMs;
  }
  return { language: parsed.language, durationMs: limit, segments };
}

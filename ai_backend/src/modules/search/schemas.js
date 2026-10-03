// search schemas (phase 3): the search request body and the hit shape.
import { z } from 'zod';

export const KINDS = ['transcript', 'scene'];

export const SearchBody = z.strictObject({
  query: z.string().trim().min(1).max(1000),
  kinds: z.array(z.enum(KINDS)).min(1).max(KINDS.length).optional(),
  assetIds: z.array(z.uuid()).min(1).max(200).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

const Base = {
  assetId: z.uuid(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  score: z.number(),
};

export const Hit = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('transcript'), ...Base, text: z.string() }),
  z.object({ kind: z.literal('scene'), ...Base, caption: z.string().nullable(), keyframeAssetId: z.uuid().nullable() }),
]);

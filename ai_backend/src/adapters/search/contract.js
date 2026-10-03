import { z } from 'zod';

export const SearchOutput = z.object({
  query: z.string(),
  results: z.array(z.object({ title: z.string().min(1), url: z.string().url(), snippet: z.string() })),
});

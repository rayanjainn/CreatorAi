// agents/research schemas: request body, the agent's output (BriefDoc), the stored brief.
import { z } from 'zod';
import { Idea } from '../director/schemas.js';

const text = (max) => z.string().trim().min(1).max(max);

// Exactly one of { topic } or { planId, ideaIndex }.
export const ResearchBody = z.union([
  z.strictObject({ topic: text(300) }),
  z.strictObject({ planId: z.uuid(), ideaIndex: z.number().int().nonnegative() }),
]);

// What the run stores as its input: the topic, plus the plan idea snapshot when given.
export const ResearchInput = z.object({
  topic: text(300),
  planId: z.uuid().optional(),
  ideaIndex: z.number().int().nonnegative().optional(),
  idea: Idea.optional(),
});

export const Source = z.object({ title: text(300), url: z.url() });

export const BriefDoc = z.object({
  summary: text(4000),
  keyPoints: z.array(text(1000)).min(1).max(20),
  trends: z.array(text(1000)).max(20),
  sources: z.array(Source).max(20),
});

export const Brief = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  createdBy: z.uuid().nullable(),
  runId: z.uuid().nullable(),
  planId: z.uuid().nullable(),
  ideaIndex: z.number().int().nullable(),
  topic: z.string(),
  input: ResearchInput,
  doc: BriefDoc,
  createdAt: z.string(),
  updatedAt: z.string(),
});

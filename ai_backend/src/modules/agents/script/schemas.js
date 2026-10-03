// agents/script schemas: request bodies, the agent's output (ScriptDoc), the stored script.
import { z } from 'zod';
import { Idea } from '../director/schemas.js';
import { BriefDoc } from '../research/schemas.js';

const text = (max) => z.string().trim().min(1).max(max);

export const ScriptBody = z.strictObject({
  briefId: z.uuid(),
  targetSeconds: z.number().int().min(5).max(600).optional(),
  tone: text(200).optional(),
  notes: text(2000).optional(),
});

// What the run stores as its input: the brief snapshot and the idea it came from.
export const ScriptInput = z.object({
  briefId: z.uuid(),
  topic: z.string(),
  idea: Idea.partial({ angle: true, format: true, hook: true }),
  brief: BriefDoc,
  targetSeconds: z.number().int().optional(),
  tone: z.string().optional(),
  notes: z.string().optional(),
});

const Cue = z.object({ section: text(100).optional(), description: text(1000) });

export const ScriptDoc = z.object({
  hooks: z.array(text(500)).min(1).max(10),
  script: z
    .array(z.object({ section: text(100), text: text(4000), estSeconds: z.number().positive().max(600) }))
    .min(1)
    .max(50),
  cta: text(500),
  shots: z.array(Cue).max(50),
  broll: z.array(Cue).max(50),
});

// PATCH body: any subset of the doc's fields (at least one); the merged doc must still
// be a valid ScriptDoc.
export const ScriptPatch = z
  .strictObject({
    hooks: ScriptDoc.shape.hooks.optional(),
    script: ScriptDoc.shape.script.optional(),
    cta: ScriptDoc.shape.cta.optional(),
    shots: ScriptDoc.shape.shots.optional(),
    broll: ScriptDoc.shape.broll.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one of hooks, script, cta, shots, broll' });

export const Script = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  createdBy: z.uuid().nullable(),
  runId: z.uuid().nullable(),
  briefId: z.uuid(),
  input: ScriptInput,
  doc: ScriptDoc,
  editedBy: z.uuid().nullable(),
  editedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

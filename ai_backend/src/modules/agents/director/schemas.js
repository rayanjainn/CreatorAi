// agents/director schemas: request body, the agent's output (PlanDoc) and the stored plan.
import { z } from 'zod';

const text = (max) => z.string().trim().min(1).max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a YYYY-MM-DD date');

export const DirectorInput = z.strictObject({
  niche: text(200),
  audience: text(500),
  goals: z.array(text(300)).min(1).max(10),
  cadence: text(100), // e.g. "3 per week"
  horizonDays: z.number().int().min(1).max(90),
  startDate: isoDate.optional(),
});

export const Idea = z.object({
  title: text(200),
  angle: text(500),
  format: text(100),
  hook: text(500),
});

export const PlanDoc = z
  .object({
    ideas: z.array(Idea).min(1).max(30),
    schedule: z.array(z.object({ date: isoDate, ideaIdx: z.number().int().nonnegative() })).max(120),
  })
  .superRefine((doc, ctx) => {
    doc.schedule.forEach((entry, i) => {
      if (entry.ideaIdx >= doc.ideas.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['schedule', i, 'ideaIdx'],
          message: `ideaIdx ${entry.ideaIdx} does not point at one of the ${doc.ideas.length} ideas`,
        });
      }
    });
  });

export const Plan = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  createdBy: z.uuid().nullable(),
  runId: z.uuid().nullable(),
  input: DirectorInput,
  doc: PlanDoc,
  createdAt: z.string(),
  updatedAt: z.string(),
});

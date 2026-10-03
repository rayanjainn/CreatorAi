// projects schemas: request bodies, params and the project output shape.
import { z } from 'zod';

// Highest first. The ranking itself lives in service.js (hasRole).
export const ROLES = ['owner', 'editor', 'viewer'];
export const Role = z.enum(ROLES);

const name = z.string().trim().min(1).max(200);
const description = z.string().trim().max(2000);

export const CreateProjectBody = z.strictObject({
  name,
  description: description.optional(),
});

// At least one field; description: null clears it.
export const UpdateProjectBody = z
  .strictObject({
    name: name.optional(),
    description: description.nullable().optional(),
  })
  .refine((b) => b.name !== undefined || b.description !== undefined, {
    message: 'Provide at least one of name, description',
  });

export const ProjectId = z.uuid();

// What a response contains about a project, from the caller's point of view.
export const Project = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  role: Role,
});

export const UserId = z.uuid();

const email = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254));

export const AddMemberBody = z.strictObject({ email, role: Role });

export const UpdateMemberBody = z.strictObject({ role: Role });

// What a response contains about a project member.
export const Member = z.object({
  userId: z.uuid(),
  email: z.string(),
  name: z.string().nullable(),
  role: Role,
  createdAt: z.string(),
});

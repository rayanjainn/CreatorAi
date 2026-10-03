// auth schemas: request bodies and the public user shape.
import { z } from 'zod';

const email = z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254));
// bcrypt only uses the first 72 bytes; cap well above min to keep hashing cheap.
const password = z.string().min(8).max(72);

export const RegisterBody = z.object({
  email,
  password,
  name: z.string().trim().min(1).max(100).optional(),
});

export const LoginBody = z.object({
  email,
  password: z.string().min(1).max(72),
});

// What any response may contain about a user. Never includes the password hash.
export const PublicUser = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string().nullable(),
});

// Zod-validated environment. getEnv() throws on first access if anything required
// is missing, so a misconfigured process never gets as far as listening.
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

if (process.env.SKIP_DOTENV !== '1') {
  dotenv.config({ path: process.env.ENV_FILE || path.resolve(process.cwd(), '.env'), quiet: true });
}

const required = z.string().trim().min(1, 'is required');
const optional = z.string().trim().optional();

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: required,
    DATABASE_URL_TEST: optional,
    JWT_SECRET: required,

    ADAPTERS: z.enum(['real', 'fake']).default('real'),
    VECTOR_BACKEND: z.enum(['pgvector', 'array']).default('pgvector'),
    EMBED_DIM: z.coerce.number().int().positive().default(768),

    LLM_PROVIDER: z.enum(['gemini', 'groq']).default('gemini'),
    LLM_MODEL: z.string().default('gemini-3.5-flash'),
    VISION_MODEL: z.string().default('gemini-3.5-flash'),
    LLM_FALLBACK_MODEL: z.string().default('openai/gpt-oss-120b'),
    STT_MODEL: z.string().default('whisper-large-v3-turbo'),
    EMBED_MODEL: z.string().default('gemini-embedding-2'),
    SEARCH_PROVIDER: z.enum(['tavily', 'serper']).default('tavily'),

    GEMINI_API_KEY: optional,
    GROQ_API_KEY: optional,
    TAVILY_API_KEY: optional,
    SERPER_API: optional,
    CLOUDINARY_CLOUD_NAME: optional,
    CLOUDINARY_API_KEY: optional,
    CLOUDINARY_API_SECRET: optional,

    FFMPEG_PATH: z.string().default('ffmpeg'),
    FFPROBE_PATH: z.string().default('ffprobe'),
  })
  .superRefine((env, ctx) => {
    if (env.ADAPTERS !== 'real') return;
    const keys = [
      'GEMINI_API_KEY',
      'GROQ_API_KEY',
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
      env.SEARCH_PROVIDER === 'serper' ? 'SERPER_API' : 'TAVILY_API_KEY',
    ];
    for (const key of keys) {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'is required when ADAPTERS=real' });
    }
  });

export class EnvError extends Error {
  constructor(issues) {
    const lines = issues.map((i) => `  - ${i.path.join('.') || '(root)'} ${i.message}`);
    super(`Invalid environment:\n${lines.join('\n')}`);
    this.name = 'EnvError';
    this.issues = issues;
  }
}

export function loadEnv(source = process.env) {
  const result = EnvSchema.safeParse(source);
  if (!result.success) throw new EnvError(result.error.issues);
  return Object.freeze(result.data);
}

let cached;

export function getEnv() {
  cached ??= loadEnv(process.env);
  return cached;
}

// Tests change process.env between files; this drops the cached copy.
export function resetEnv() {
  cached = undefined;
}

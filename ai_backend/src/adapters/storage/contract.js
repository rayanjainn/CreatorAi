import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const ResourceType = z.enum(['video', 'image', 'raw']);

export const SignUploadOutput = z.object({
  cloudName: z.string().min(1),
  apiKey: z.string().min(1),
  timestamp: z.number().int().positive(),
  signature: z.string().min(1),
  folder: z.string().min(1),
  resourceType: ResourceType,
  uploadUrl: z.string().url(),
});

export const Resource = z.object({
  publicId: z.string().min(1),
  resourceType: ResourceType,
  url: z.string().url(),
  format: z.string(),
  bytes: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const DestroyInput = z.object({ resourceType: ResourceType.default('video') });
export const DestroyOutput = z.object({ result: z.enum(['ok', 'not found']) });

// ---- helpers shared by real.js and fake.js, so both sign and verify the same way ----

// Cloudinary API request signature: the params sorted by key, joined as k=v with '&',
// then sha1(that + api_secret). file, api_key, resource_type, cloud_name and empty
// values are not signed.
const UNSIGNED = new Set(['file', 'api_key', 'resource_type', 'cloud_name', 'signature']);

export function signParams(params, secret) {
  const toSign = Object.keys(params)
    .filter((k) => !UNSIGNED.has(k) && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${Array.isArray(params[k]) ? params[k].join(',') : params[k]}`)
    .join('&');
  return createHash('sha1').update(toSign + secret).digest('hex');
}

// Notifications (webhooks): X-Cld-Signature = sha1(raw body + X-Cld-Timestamp + api_secret).
// The timestamp must be recent: Cloudinary recommends rejecting anything over two hours old.
export const NOTIFICATION_MAX_AGE_S = 2 * 60 * 60;

export function notificationSignature(body, timestamp, secret) {
  return createHash('sha1').update(`${body}${timestamp}${secret}`).digest('hex');
}

// True only for a string body, a fresh integer timestamp (number or digit string) and a
// matching signature (constant-time compare).
export function verifyNotificationWith(secret, { body, timestamp, signature } = {}) {
  if (!secret || typeof body !== 'string' || typeof signature !== 'string') return false;
  const ts = typeof timestamp === 'string' && /^\d{1,12}$/.test(timestamp) ? Number(timestamp) : timestamp;
  if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > NOTIFICATION_MAX_AGE_S) return false;
  const expected = Buffer.from(notificationSignature(body, ts, secret));
  const given = Buffer.from(signature.toLowerCase());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

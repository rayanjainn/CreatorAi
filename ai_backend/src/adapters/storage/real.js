// Cloudinary over plain fetch: signed direct uploads, Admin API lookups, signed destroy,
// delivery URLs and notification verification. No SDK: the upload signature is
// sha1(sorted params + api_secret) and the Admin API uses HTTP basic auth.
import fs from 'node:fs';
import path from 'node:path';
import { getEnv } from '../../config/env.js';
import { DestroyInput, Resource, signParams, verifyNotificationWith } from './contract.js';

const API = 'https://api.cloudinary.com/v1_1';
const DELIVERY = 'https://res.cloudinary.com';

function creds() {
  const env = getEnv();
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary is not configured: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET');
  }
  return { cloudName, apiKey, apiSecret };
}

const nowS = () => Math.floor(Date.now() / 1000);
const encodePublicId = (publicId) => publicId.split('/').map(encodeURIComponent).join('/');

async function failure(res, what) {
  const text = await res.text().catch(() => '');
  let message = text.slice(0, 300);
  try {
    message = JSON.parse(text)?.error?.message ?? message;
  } catch {
    // not JSON: keep the raw text
  }
  return new Error(`Cloudinary ${what} failed: ${res.status} ${message}`);
}

function toResource(r) {
  return Resource.parse({
    publicId: r.public_id,
    resourceType: r.resource_type,
    url: r.secure_url ?? r.url,
    format: r.format ?? '',
    bytes: r.bytes ?? 0,
    durationMs: typeof r.duration === 'number' ? Math.round(r.duration * 1000) : undefined,
    width: r.width || undefined,
    height: r.height || undefined,
  });
}

export async function signUpload({ folder, resourceType = 'video' }) {
  const { cloudName, apiKey, apiSecret } = creds();
  const timestamp = nowS();
  return {
    cloudName,
    apiKey,
    timestamp,
    signature: signParams({ folder, timestamp }, apiSecret),
    folder,
    resourceType,
    uploadUrl: `${API}/${cloudName}/${resourceType}/upload`,
  };
}

// Admin API: GET /resources/:type/upload/:public_id. Not found -> null.
// Videos need media_metadata=true, or the response has no `duration`.
export async function getResource(publicId, { resourceType = 'video' } = {}) {
  const { cloudName, apiKey, apiSecret } = creds();
  const query = resourceType === 'video' ? '?media_metadata=true' : '';
  const res = await fetch(`${API}/${cloudName}/resources/${resourceType}/upload/${encodePublicId(publicId)}${query}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res, 'getResource');
  return toResource(await res.json());
}

export function proxyUrl(publicId, { width = 480 } = {}) {
  return `${DELIVERY}/${creds().cloudName}/video/upload/w_${width},q_auto/${publicId}.mp4`;
}

// Audio-only rendition at 16 kHz. Cloudinary has no channel-count transformation; the
// transcription step downmixes to mono if it needs to.
export function audioUrl(publicId) {
  return `${DELIVERY}/${creds().cloudName}/video/upload/af_16000/${publicId}.mp3`;
}

// Server-side signed upload (keyframes, renders) into `folder`.
export async function uploadFile(filePath, { folder, resourceType = 'video' } = {}) {
  const { cloudName, apiKey, apiSecret } = creds();
  const params = { folder, timestamp: nowS() };
  const form = new FormData();
  form.append('file', await fs.openAsBlob(filePath), path.basename(filePath));
  for (const [k, v] of Object.entries(params)) if (v !== undefined) form.append(k, String(v));
  form.append('api_key', apiKey);
  form.append('signature', signParams(params, apiSecret));
  const res = await fetch(`${API}/${cloudName}/${resourceType}/upload`, { method: 'POST', body: form });
  if (!res.ok) throw await failure(res, 'uploadFile');
  return toResource(await res.json());
}

export async function destroy(publicId, options = {}) {
  const { resourceType } = DestroyInput.parse(options);
  const { cloudName, apiKey, apiSecret } = creds();
  const params = { public_id: publicId, timestamp: nowS() };
  const body = new URLSearchParams({
    public_id: publicId,
    timestamp: String(params.timestamp),
    api_key: apiKey,
    signature: signParams(params, apiSecret),
  });
  const res = await fetch(`${API}/${cloudName}/${resourceType}/destroy`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw await failure(res, 'destroy');
  const { result } = await res.json();
  return { result: result === 'ok' ? 'ok' : 'not found' };
}

export function verifyNotification(input) {
  return verifyNotificationWith(creds().apiSecret, input);
}

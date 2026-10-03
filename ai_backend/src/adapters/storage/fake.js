// In-memory Cloudinary. putResource() seeds what a client "uploaded" directly.
// destroyed records every destroy() call; reset() clears both.
import fs from 'node:fs/promises';
import path from 'node:path';
import { notificationSignature, signParams, verifyNotificationWith } from './contract.js';

const BASE = 'https://res.fake-cloudinary.test/demo';
const resources = new Map();
export const destroyed = [];

// Deterministic secret: tests sign notifications with signNotification().
export const FAKE_API_SECRET = 'fake-api-secret';

export function reset() {
  resources.clear();
  destroyed.length = 0;
}

export function putResource({ publicId, resourceType = 'video', format = 'mp4', bytes = 1_000_000, ...rest }) {
  const resource = { publicId, resourceType, format, bytes, url: `${BASE}/${resourceType}/upload/${publicId}.${format}`, ...rest };
  resources.set(publicId, resource);
  return resource;
}

export async function signUpload({ folder, resourceType = 'video' }) {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    cloudName: 'demo',
    apiKey: 'fake-api-key',
    timestamp,
    signature: signParams({ folder, timestamp }, FAKE_API_SECRET),
    folder,
    resourceType,
    uploadUrl: `https://api.fake-cloudinary.test/v1_1/demo/${resourceType}/upload`,
  };
}

export async function getResource(publicId) {
  return resources.get(publicId) ?? null;
}

export function proxyUrl(publicId, { width = 480 } = {}) {
  return `${BASE}/video/upload/w_${width},q_auto/${publicId}.mp4`;
}

export function audioUrl(publicId) {
  return `${BASE}/video/upload/ac_mono,af_16000/${publicId}.mp3`;
}

export async function uploadFile(filePath, { folder, resourceType = 'video' } = {}) {
  const { size } = await fs.stat(filePath);
  const ext = path.extname(filePath);
  const name = path.basename(filePath, ext);
  return putResource({
    publicId: folder ? `${folder}/${name}` : name,
    resourceType,
    format: ext.slice(1) || 'bin',
    bytes: size,
  });
}

export async function destroy(publicId, _options = {}) {
  destroyed.push(publicId);
  return { result: resources.delete(publicId) ? 'ok' : 'not found' };
}

export function signNotification(body, timestamp) {
  return notificationSignature(body, timestamp, FAKE_API_SECRET);
}

export function verifyNotification(input) {
  return verifyNotificationWith(FAKE_API_SECRET, input);
}

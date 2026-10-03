// Cloudinary: signed direct uploads, Admin API lookups, derived URLs (phase 2).
import { notImplemented } from '../pick.js';

export const signUpload = notImplemented('storage', 'signUpload', 2);
export const getResource = notImplemented('storage', 'getResource', 2);
export const uploadFile = notImplemented('storage', 'uploadFile', 2);
export const destroy = notImplemented('storage', 'destroy', 2);

export function proxyUrl() {
  throw new Error('storage.proxyUrl (real) is not implemented yet: planned for phase 2');
}

export function audioUrl() {
  throw new Error('storage.audioUrl (real) is not implemented yet: planned for phase 3');
}

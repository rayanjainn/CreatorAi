import { pick } from '../pick.js';
import * as fake from './fake.js';
import * as real from './real.js';

// signUpload({ folder, resourceType? }) -> { cloudName, apiKey, timestamp, signature, folder, resourceType, uploadUrl }
// getResource(publicId, { resourceType? }) -> Resource | null
// proxyUrl(publicId, { width? })       -> low-res video URL
// audioUrl(publicId)                   -> 16 kHz audio URL
// uploadFile(filePath, { folder, resourceType? }) -> Resource
// destroy(publicId, { resourceType? }) -> { result: 'ok' | 'not found' }
// verifyNotification({ body, timestamp, signature }) -> boolean (Cloudinary webhook check)
// fake only: putResource(), reset(), destroyed[], signNotification(body, timestamp), FAKE_API_SECRET
export const getStorage = () => pick(real, fake);

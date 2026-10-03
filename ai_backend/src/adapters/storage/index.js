import { pick } from '../pick.js';
import * as fake from './fake.js';
import * as real from './real.js';

// signUpload({ folder, resourceType? }) -> { cloudName, apiKey, timestamp, signature, folder, resourceType, uploadUrl }
// getResource(publicId)                -> Resource | null
// proxyUrl(publicId, { width? })       -> low-res video URL
// audioUrl(publicId)                   -> mono 16 kHz audio URL
// uploadFile(filePath, { folder, resourceType? }) -> Resource
// destroy(publicId)                    -> { result: 'ok' | 'not found' }
export const getStorage = () => pick(real, fake);

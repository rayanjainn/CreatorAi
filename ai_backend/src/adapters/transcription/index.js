import { pick } from '../pick.js';
import * as fake from './fake.js';
import * as real from './real.js';

// transcribe({ url | filePath, language?, durationMs? })
//   -> { language, durationMs, segments: [{ startMs, endMs, text }] }
export const getTranscription = () => pick(real, fake);

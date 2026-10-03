import { pick } from '../pick.js';
import * as fake from './fake.js';
import * as real from './real.js';

// transcribe({ url | filePath, language?, durationMs? })
//   -> { language, durationMs, segments: [{ startMs, endMs, text }] }
//   or, for long audio sent in chunks,
//   -> { language, durationMs, chunks: [{ offsetMs, segments: [...] (chunk-relative) }] }
// contract.js normalizeTranscript() turns either into one continuous segment list.
// fake only: queueResult(...outputs | Error | fn), calls, reset()
export const getTranscription = () => pick(real, fake);

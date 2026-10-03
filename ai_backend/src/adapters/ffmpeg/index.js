import { pick } from '../pick.js';
import * as fake from './fake.js';
import * as real from './real.js';

// probe(fileOrUrl)                 -> { durationMs, format, streams: [...] }
// run(args[], { onProgress? })     -> { code, stderrTail }
export const getFfmpeg = () => pick(real, fake);

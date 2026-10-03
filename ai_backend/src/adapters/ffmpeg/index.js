import { pick } from '../pick.js';
import * as fake from './fake.js';
import * as real from './real.js';

// probe(fileOrUrl)                          -> { durationMs, format, streams: [...] }
// run(args[], { onProgress? })              -> { code, stderrTail }; onProgress({ outTimeMs, done });
//                                              non-zero exit throws Error { code, stderrTail }
// detectScenes(fileOrUrl, { threshold? })   -> cut times in ms (select='gt(scene,T)',showinfo)
// extractFrame(fileOrUrl, atMs, outPath)    -> { path } (one JPEG)
// fake only: runs[], frames[], setCuts(ms[]), reset()
export const getFfmpeg = () => pick(real, fake);

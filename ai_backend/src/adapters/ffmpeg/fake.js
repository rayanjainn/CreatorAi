// Fake FFmpeg: probe returns a fixed 20 s 640x360 clip, run records args and succeeds,
// detectScenes returns the fixture's cuts (7 s, 14 s) unless setCuts() says otherwise,
// extractFrame writes a tiny placeholder JPEG. Tests that need real media (scene cuts,
// renders) use the real adapter on the fixture.
import fs from 'node:fs/promises';

export const runs = [];
export const frames = [];

const DEFAULT_CUTS = [7_000, 14_000];
let cuts = DEFAULT_CUTS;

export function reset() {
  runs.length = 0;
  frames.length = 0;
  cuts = DEFAULT_CUTS;
}

// setCuts([ms, ...]): what the next detectScenes() calls return (until reset()).
export function setCuts(list) {
  cuts = [...list];
}

export async function probe() {
  return {
    durationMs: 20_000,
    format: 'mov,mp4,m4a,3gp,3g2,mj2',
    streams: [
      { index: 0, type: 'video', codec: 'h264', width: 640, height: 360, fps: 30 },
      { index: 1, type: 'audio', codec: 'aac', sampleRate: 44_100, channels: 1 },
    ],
  };
}

export async function run(args, { onProgress } = {}) {
  runs.push(args);
  onProgress?.({ outTimeMs: 0, done: true });
  return { code: 0, stderrTail: '' };
}

export async function detectScenes(_input, _options = {}) {
  return [...cuts];
}

// SOI + a JFIF APP0 marker + EOI: enough bytes to look like a JPEG.
const PLACEHOLDER_JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

export async function extractFrame(input, atMs, outPath) {
  frames.push({ input, atMs, outPath });
  await fs.writeFile(outPath, PLACEHOLDER_JPEG);
  return { path: outPath };
}

// Fake FFmpeg: probe returns a fixed 20 s 640x360 clip, run records args and succeeds.
// Tests that need real media (scene cuts, renders) use the real adapter on the fixture.
export const runs = [];

export function reset() {
  runs.length = 0;
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
  onProgress?.({ outTimeMs: 0 });
  return { code: 0, stderrTail: '' };
}

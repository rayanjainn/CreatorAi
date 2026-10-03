// Generates the test video with FFmpeg so no binary is committed:
// 20 s, 640x360 @ 30 fps, 440 Hz sine audio, hard scene cuts at 7 s and 14 s
// (testsrc -> solid blue -> SMPTE bars).
// Usage: node tests/fixtures/make-fixture.js [--force]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const FIXTURE = Object.freeze({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture.mp4'),
  durationMs: 20_000,
  cutsMs: [7_000, 14_000],
  width: 640,
  height: 360,
  fps: 30,
});

export function makeFixture({ out = FIXTURE.path, force = false, ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg' } = {}) {
  if (!force && fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  const { width: w, height: h, fps } = FIXTURE;
  const size = `${w}x${h}`;
  const tmp = `${out}.tmp.mp4`;
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=${fps}:duration=7`,
    '-f', 'lavfi', '-i', `color=c=0x1f3fbf:size=${size}:rate=${fps}:duration=7`,
    '-f', 'lavfi', '-i', `smptebars=size=${size}:rate=${fps}:duration=6`,
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=20',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]',
    '-map', '[v]', '-map', '3:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-g', String(fps),
    '-c:a', 'aac', '-ac', '1', '-b:a', '96k',
    '-movflags', '+faststart', '-shortest', tmp,
  ];
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8', windowsHide: true });
  if (r.error) throw new Error(`Could not run ffmpeg ("${ffmpeg}"): ${r.error.message}. Run "npm run preflight".`);
  if (r.status !== 0) throw new Error(`ffmpeg failed to build the fixture:\n${r.stderr}`);
  fs.renameSync(tmp, out);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    console.log(makeFixture({ force: process.argv.includes('--force') }));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

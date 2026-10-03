import { spawnSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE, makeFixture } from '../fixtures/make-fixture.js';

let probe;

beforeAll(() => {
  const file = makeFixture();
  const r = spawnSync(
    process.env.FFPROBE_PATH || 'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { encoding: 'utf8', windowsHide: true },
  );
  if (r.error || r.status !== 0) throw new Error(`ffprobe failed: ${r.error?.message ?? r.stderr}`);
  probe = JSON.parse(r.stdout);
}, 120_000);

describe('fixture generator', () => {
  it('produces a ~20 s file', () => {
    expect(Number(probe.format.duration) * 1000).toBeGreaterThan(FIXTURE.durationMs - 250);
    expect(Number(probe.format.duration) * 1000).toBeLessThan(FIXTURE.durationMs + 250);
  });

  it('has a video stream of the declared size and an audio stream', () => {
    const video = probe.streams.find((s) => s.codec_type === 'video');
    const audio = probe.streams.find((s) => s.codec_type === 'audio');
    expect(video).toMatchObject({ width: FIXTURE.width, height: FIXTURE.height });
    expect(audio).toBeTruthy();
  });
});

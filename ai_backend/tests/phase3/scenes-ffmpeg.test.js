// Real FFmpeg adapter (P3.T2): spawn-based probe/run on the generated fixture. No network.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as ffmpeg from '../../src/adapters/ffmpeg/real.js';
import { ProbeOutput, RunOutput } from '../../src/adapters/ffmpeg/contract.js';
import { FIXTURE, makeFixture } from '../fixtures/make-fixture.js';

beforeAll(() => {
  makeFixture();
});

describe('real ffmpeg.probe', () => {
  it('reads the fixture: ~20 s with a 640x360 video stream and an audio stream', async () => {
    const out = ProbeOutput.parse(await ffmpeg.probe(FIXTURE.path));
    expect(Math.abs(out.durationMs - FIXTURE.durationMs)).toBeLessThanOrEqual(200);
    const video = out.streams.find((s) => s.type === 'video');
    const audio = out.streams.find((s) => s.type === 'audio');
    expect(video).toMatchObject({ codec: 'h264', width: 640, height: 360 });
    expect(video.fps).toBeCloseTo(30, 0);
    expect(audio).toMatchObject({ codec: 'aac', channels: 1, sampleRate: 44_100 });
  });

  it('a missing file -> error naming the input', async () => {
    await expect(ffmpeg.probe('does-not-exist.mp4')).rejects.toThrow(/does-not-exist\.mp4/);
  });
});

describe('real ffmpeg.run', () => {
  it('reports progress (outTimeMs rising to ~the input duration) and exits 0', async () => {
    const seen = [];
    const out = RunOutput.parse(
      await ffmpeg.run(['-i', FIXTURE.path, '-f', 'null', '-'], { onProgress: (p) => seen.push(p) }),
    );
    expect(out.code).toBe(0);
    expect(seen.length).toBeGreaterThan(0);
    for (const p of seen) expect(Number.isInteger(p.outTimeMs)).toBe(true);
    for (let i = 1; i < seen.length; i++) expect(seen[i].outTimeMs).toBeGreaterThanOrEqual(seen[i - 1].outTimeMs);
    expect(seen.at(-1).outTimeMs).toBeGreaterThan(FIXTURE.durationMs - 1000);
    expect(seen.at(-1).done).toBe(true);
  });

  it('non-zero exit -> error with the exit code and the stderr tail', async () => {
    const err = await ffmpeg.run(['-i', 'does-not-exist.mp4', '-f', 'null', '-']).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).not.toBe(0);
    expect(err.stderrTail).toMatch(/does-not-exist\.mp4/);
    expect(err.message).toMatch(/does-not-exist\.mp4/);
  });
});

describe('real ffmpeg.detectScenes / extractFrame', () => {
  it('detectScenes finds the two known cuts (ms, ascending)', async () => {
    const cuts = await ffmpeg.detectScenes(FIXTURE.path, { threshold: 0.35 });
    expect(cuts).toHaveLength(FIXTURE.cutsMs.length);
    cuts.forEach((c, i) => expect(Math.abs(c - FIXTURE.cutsMs[i])).toBeLessThanOrEqual(500));
  });

  it('extractFrame writes one JPEG at the requested time', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p3b-frame-'));
    try {
      const out = path.join(dir, 'frame.jpg');
      await ffmpeg.extractFrame(FIXTURE.path, 10_500, out);
      const bytes = await fs.readFile(out);
      expect(bytes.length).toBeGreaterThan(100);
      expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

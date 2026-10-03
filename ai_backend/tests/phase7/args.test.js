// P7.T1: buildFfmpegArgs(doc, inputs, { kind, outputPath }) is pure, so its output is
// pinned by snapshots and a few structural assertions. No FFmpeg runs here.
import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs, renderSize } from '../../src/modules/render/ffmpeg-args.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const INPUTS = { [A]: 'https://cdn.test/a.mp4', [B]: 'https://cdn.test/b.mp4' };

function doc(clips, output = { width: 1080, height: 1920, fps: 30 }) {
  return {
    schemaVersion: 1,
    output,
    tracks: [
      { id: 'v1', type: 'video', clips: clips.map((c, i) => ({ id: `c${i + 1}`, volume: 1, ...c })) },
      { id: 'cap', type: 'caption', clips: [{ id: 't1', startMs: 0, endMs: 500, text: 'ignored' }] },
    ],
  };
}

const ONE = doc([{ assetId: A, sourceInMs: 1_000, sourceOutMs: 3_000, startMs: 0 }]);
const THREE = doc([
  { assetId: A, sourceInMs: 1_000, sourceOutMs: 3_000, startMs: 0 },
  { assetId: A, sourceInMs: 8_000, sourceOutMs: 9_500, startMs: 2_000 },
  { assetId: A, sourceInMs: 15_000, sourceOutMs: 16_250, startMs: 3_500, volume: 0.5 },
]);
const TWO_ASSETS = doc([
  { assetId: A, sourceInMs: 0, sourceOutMs: 2_000, startMs: 0 },
  { assetId: B, sourceInMs: 5_000, sourceOutMs: 8_000, startMs: 2_000 },
]);

const build = (d, kind = 'final') => buildFfmpegArgs(d, INPUTS, { kind, outputPath: 'out.mp4' });
const filterOf = (args) => args[args.indexOf('-filter_complex') + 1];

describe('buildFfmpegArgs snapshots', () => {
  it('1 clip, final', () => {
    expect(build(ONE)).toMatchSnapshot();
  });

  it('3 clips, final', () => {
    expect(build(THREE)).toMatchSnapshot();
  });

  it('clips from 2 assets, final', () => {
    expect(build(TWO_ASSETS)).toMatchSnapshot();
  });

  it('3 clips, preview', () => {
    expect(build(THREE, 'preview')).toMatchSnapshot();
  });
});

describe('buildFfmpegArgs structure', () => {
  it('one input per clip, each seeked to the clip source range', () => {
    const { args } = build(THREE);
    const inputs = args.flatMap((a, i) => (a === '-i' ? [args[i + 1]] : []));
    expect(inputs).toEqual([INPUTS[A], INPUTS[A], INPUTS[A]]);
    expect(args.slice(0, 6)).toEqual(['-ss', '1.000', '-t', '2.000', '-i', INPUTS[A]]);
  });

  it('one filter_complex: trim, setpts, scale + crop to the output size, concat of video and audio', () => {
    const { args } = build(TWO_ASSETS);
    const filter = filterOf(args);
    for (const part of ['trim=duration=2.000', 'setpts=PTS-STARTPTS', 'scale=1080:1920:force_original_aspect_ratio=increase', 'crop=1080:1920', 'atrim=duration=3.000', 'asetpts=PTS-STARTPTS', 'concat=n=2:v=1:a=1[vout][aout]']) {
      expect(filter).toContain(part);
    }
    expect(args).toEqual(expect.arrayContaining(['-map', '[vout]', '[aout]']));
    expect(args.at(-1)).toBe('out.mp4');
  });

  it('duration is the sum of clips; final keeps the output size', () => {
    expect(build(THREE)).toMatchObject({ durationMs: 4_750, width: 1080, height: 1920 });
  });

  it('preview is 480 wide (even height, same aspect) with a faster preset', () => {
    const preview = build(THREE, 'preview');
    const final = build(THREE, 'final');
    expect(preview).toMatchObject({ width: 480, height: 854, durationMs: 4_750 });
    expect(filterOf(preview.args)).toContain('scale=480:854');
    expect(preview.args[preview.args.indexOf('-preset') + 1]).toBe('veryfast');
    expect(final.args[final.args.indexOf('-preset') + 1]).not.toBe('veryfast');
  });

  it('renderSize: preview never upscales an output already <= 480 wide', () => {
    expect(renderSize({ width: 320, height: 240, fps: 30 }, 'preview')).toEqual({ width: 320, height: 240 });
    expect(renderSize({ width: 1920, height: 1080, fps: 30 }, 'preview')).toEqual({ width: 480, height: 270 });
  });

  it('a gap between clips is filled with black video and silence', () => {
    const gapped = doc([
      { assetId: A, sourceInMs: 0, sourceOutMs: 1_000, startMs: 0 },
      { assetId: A, sourceInMs: 2_000, sourceOutMs: 3_000, startMs: 1_500 },
    ]);
    const out = build(gapped);
    expect(out.durationMs).toBe(2_500);
    const filter = filterOf(out.args);
    expect(filter).toContain('color=c=black:s=1080x1920:r=30:d=0.500');
    expect(filter).toContain('anullsrc=r=48000:cl=stereo');
    expect(filter).toContain('concat=n=3:v=1:a=1');
  });

  it('clips are rendered in timeline order whatever their array order', () => {
    const shuffled = doc([
      { assetId: B, sourceInMs: 5_000, sourceOutMs: 8_000, startMs: 2_000 },
      { assetId: A, sourceInMs: 0, sourceOutMs: 2_000, startMs: 0 },
    ]);
    expect(build(shuffled).args).toEqual(build(TWO_ASSETS).args);
  });

  it('an input marked hasAudio: false gets silence instead of [n:a]', () => {
    const { args } = buildFfmpegArgs(ONE, { [A]: { url: 'x.mp4', hasAudio: false } }, { kind: 'final', outputPath: 'o.mp4' });
    expect(filterOf(args)).not.toContain('[0:a]');
    expect(filterOf(args)).toContain('anullsrc');
  });

  it('is pure: same input, same output, and the doc is not mutated', () => {
    const copy = structuredClone(THREE);
    expect(build(THREE)).toEqual(build(THREE));
    expect(THREE).toEqual(copy);
  });

  it('rejects a timeline with no video clips, a missing input and an unknown kind', () => {
    expect(() => build(doc([]))).toThrow(/no video clips/i);
    expect(() => buildFfmpegArgs(TWO_ASSETS, { [A]: 'a.mp4' }, { kind: 'final', outputPath: 'o.mp4' })).toThrow(B);
    expect(() => buildFfmpegArgs(ONE, INPUTS, { kind: 'draft', outputPath: 'o.mp4' })).toThrow(/kind/);
  });
});

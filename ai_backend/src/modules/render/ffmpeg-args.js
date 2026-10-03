// Pure FFmpeg argument builder for renders (P7.T1). No I/O, no env: the same doc, inputs
// and options always give the same args, so it is tested by snapshot without FFmpeg.
//
// buildFfmpegArgs(doc, inputs, { kind, outputPath }) -> { args, durationMs, width, height }
// - doc: a valid Timeline JSON v1 doc (timeline/schemas.js).
// - inputs: { [assetId]: url | { url, hasAudio = true } } for every asset the clips use.
// - kind: 'preview' (480 wide, veryfast, lower quality) | 'final' (output size).
// The args exclude the flags the ffmpeg adapter adds itself (-hide_banner -nostdin -y
// -progress pipe:1).
//
// What is rendered: the first video track that has clips, in startMs order. Each clip is
// its own input, seeked with -ss/-t (cheap on remote URLs: HTTP range requests), then
// trim + setpts, scale + crop to the render size, fps, and the audio chain atrim +
// asetpts + volume, resampled to 48 kHz stereo. Gaps between clips become black frames
// and silence. One concat joins video and audio. Caption tracks are not burned in (MVP)
// and further video tracks are ignored.

export const RENDER_KINDS = Object.freeze(['preview', 'final']);
export const PREVIEW_WIDTH = 480;

const AUDIO_RATE = 48_000;
const sec = (ms) => (ms / 1000).toFixed(3);
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

const ENCODE = {
  preview: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k'],
  final: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k'],
};

// renderSize(output, kind) -> { width, height }. Preview scales the output down to 480
// wide (even height, same aspect); it never upscales.
export function renderSize(output, kind) {
  if (kind !== 'preview' || output.width <= PREVIEW_WIDTH) return { width: output.width, height: output.height };
  return { width: PREVIEW_WIDTH, height: even((output.height * PREVIEW_WIDTH) / output.width) };
}

// The clips to render: the first video track with clips, ordered by startMs.
export function renderClips(doc) {
  const track = (doc?.tracks ?? []).find((t) => t.type === 'video' && t.clips.length > 0);
  if (!track) return [];
  return [...track.clips].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

function resolveInput(inputs, assetId) {
  const value = inputs?.[assetId];
  if (typeof value === 'string' && value) return { url: value, hasAudio: true };
  if (value && typeof value.url === 'string' && value.url) return { url: value.url, hasAudio: value.hasAudio !== false };
  throw new Error(`No render input for asset ${assetId}`);
}

export function buildFfmpegArgs(doc, inputs, { kind, outputPath } = {}) {
  if (!RENDER_KINDS.includes(kind)) throw new Error(`Unknown render kind "${kind}"`);
  if (typeof outputPath !== 'string' || !outputPath) throw new Error('outputPath is required');
  const clips = renderClips(doc);
  if (!clips.length) throw new Error('Timeline has no video clips to render');

  const { width, height } = renderSize(doc.output, kind);
  const fps = doc.output.fps;
  const videoTail = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps},format=yuv420p`;
  const audioTail = `aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:sample_rates=${AUDIO_RATE}:channel_layouts=stereo`;
  const silence = (d) => `anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=duration=${d},asetpts=PTS-STARTPTS,${audioTail}`;

  const inputArgs = [];
  const chains = [];
  const segments = [];
  let cursor = 0;
  let gaps = 0;

  for (const [i, clip] of clips.entries()) {
    if (clip.startMs > cursor) {
      const d = sec(clip.startMs - cursor);
      const g = gaps++;
      chains.push(`color=c=black:s=${width}x${height}:r=${fps}:d=${d},setsar=1,format=yuv420p[gv${g}]`);
      chains.push(`${silence(d)}[ga${g}]`);
      segments.push(`[gv${g}][ga${g}]`);
    }
    const input = resolveInput(inputs, clip.assetId);
    const lengthMs = clip.sourceOutMs - clip.sourceInMs;
    const d = sec(lengthMs);
    inputArgs.push('-ss', sec(clip.sourceInMs), '-t', d, '-i', input.url);
    chains.push(`[${i}:v]trim=duration=${d},setpts=PTS-STARTPTS,${videoTail}[v${i}]`);
    chains.push(
      input.hasAudio
        ? `[${i}:a]atrim=duration=${d},asetpts=PTS-STARTPTS,volume=${clip.volume},${audioTail}[a${i}]`
        : `${silence(d)}[a${i}]`,
    );
    segments.push(`[v${i}][a${i}]`);
    cursor = Math.max(cursor, clip.startMs + lengthMs);
  }

  chains.push(`${segments.join('')}concat=n=${segments.length}:v=1:a=1[vout][aout]`);

  const args = [
    ...inputArgs,
    '-filter_complex', chains.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    ...ENCODE[kind],
    '-ar', String(AUDIO_RATE), '-r', String(fps),
    '-movflags', '+faststart',
    outputPath,
  ];
  return { args, durationMs: cursor, width, height };
}

// ffprobe / ffmpeg via child_process.spawn using FFPROBE_PATH / FFMPEG_PATH. No wrapper
// library. Inputs may be local paths or http(s) URLs (FFmpeg reads both).
import { spawn } from 'node:child_process';
import { getEnv } from '../../config/env.js';
import { ProbeOutput } from './contract.js';

const TAIL_BYTES = 4000;

// Spawns `bin args`, collecting stdout fully and the last TAIL_BYTES of stderr.
// onStdout(chunk) sees stdout as it arrives. Resolves { code, stdout, stderrTail };
// rejects only when the binary cannot be started.
function spawnCollect(bin, args, { onStdout, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out.push(chunk);
      onStdout?.(chunk);
    });
    child.stderr.on('data', (chunk) => {
      onStderr?.(chunk);
      err = (err + chunk).slice(-TAIL_BYTES);
    });
    child.on('error', (e) => reject(new Error(`Could not run "${bin}": ${e.message}`)));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout: out.join(''), stderrTail: err.trim() }));
  });
}

const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

// "30000/1001" -> 29.97
function parseRate(rate) {
  if (typeof rate !== 'string') return undefined;
  const [num, den = '1'] = rate.split('/');
  const fps = Number(num) / Number(den);
  return Number.isFinite(fps) && fps > 0 ? fps : undefined;
}

function toStream(s) {
  const type = s.codec_type === 'video' || s.codec_type === 'audio' ? s.codec_type : 'other';
  const stream = { index: s.index, type, codec: s.codec_name ?? 'unknown' };
  if (type === 'video') {
    Object.assign(stream, { width: toInt(s.width), height: toInt(s.height), fps: parseRate(s.avg_frame_rate) ?? parseRate(s.r_frame_rate) });
  }
  if (type === 'audio') Object.assign(stream, { sampleRate: toInt(s.sample_rate), channels: toInt(s.channels) });
  for (const k of Object.keys(stream)) if (stream[k] === undefined) delete stream[k];
  return stream;
}

// Parses FFmpeg's `-progress pipe:1` stream (key=value lines, each block ending in
// progress=continue|end) and calls onProgress({ outTimeMs, done }) once per block.
function progressParser(onProgress) {
  let buffer = '';
  let outTimeMs = 0;
  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (key === 'out_time_us') {
        const us = Number(value);
        if (Number.isFinite(us)) outTimeMs = Math.max(outTimeMs, Math.round(us / 1000));
      } else if (key === 'progress') {
        onProgress?.({ outTimeMs, done: value === 'end' });
      }
    }
  };
}

function ffmpegError(args, { code, stderrTail }) {
  const err = new Error(`ffmpeg exited with code ${code}: ${stderrTail.slice(-1000)}`);
  err.code = code;
  err.stderrTail = stderrTail;
  err.args = args;
  return err;
}

// Internal: runs ffmpeg with the standard flags (-hide_banner -nostdin -y -progress pipe:1).
async function exec(args, { onProgress, onStderr } = {}) {
  const { FFMPEG_PATH } = getEnv();
  const full = ['-hide_banner', '-nostdin', '-y', '-nostats', '-progress', 'pipe:1', ...args];
  const result = await spawnCollect(FFMPEG_PATH, full, { onStdout: progressParser(onProgress), onStderr });
  if (result.code !== 0) throw ffmpegError(args, result);
  return { code: result.code, stderrTail: result.stderrTail };
}

// run(args[], { onProgress? }) -> { code: 0, stderrTail }. onProgress({ outTimeMs, done })
// fires once per FFmpeg progress block. Non-zero exit -> Error with .code and .stderrTail.
// The Phase 7 renderer reuses this.
export function run(args, { onProgress } = {}) {
  return exec(args, { onProgress });
}

// detectScenes(input, { threshold = 0.35 }) -> cut times in ms, ascending. Runs
// select='gt(scene,T)',showinfo and reads pts_time from showinfo's stderr lines.
export async function detectScenes(input, { threshold = 0.35 } = {}) {
  const cuts = [];
  let buffer = '';
  const onStderr = (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) collectCut(line, cuts);
  };
  await exec(['-i', input, '-an', '-sn', '-vf', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'], { onStderr });
  collectCut(buffer, cuts);
  return [...new Set(cuts)].sort((a, b) => a - b);
}

function collectCut(line, cuts) {
  if (!line.includes('Parsed_showinfo')) return;
  const m = /pts_time:\s*(-?[\d.]+)/.exec(line);
  if (m) {
    const ms = Math.round(Number(m[1]) * 1000);
    if (Number.isFinite(ms) && ms > 0) cuts.push(ms);
  }
}

// extractFrame(input, atMs, outPath) -> { path }: one JPEG frame at atMs (input seeking).
export async function extractFrame(input, atMs, outPath) {
  const at = (Math.max(0, atMs) / 1000).toFixed(3);
  await exec(['-ss', at, '-i', input, '-frames:v', '1', '-q:v', '3', '-an', outPath]);
  return { path: outPath };
}

// probe(input) -> { durationMs, format, streams: [...] }
export async function probe(input) {
  const { FFPROBE_PATH } = getEnv();
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', input];
  const { code, stdout, stderrTail } = await spawnCollect(FFPROBE_PATH, args);
  if (code !== 0) throw new Error(`ffprobe failed on ${input} (exit ${code}): ${stderrTail}`);
  const data = JSON.parse(stdout);
  const seconds = Number(data.format?.duration);
  return ProbeOutput.parse({
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0,
    format: data.format?.format_name ?? 'unknown',
    streams: (data.streams ?? []).map(toStream),
  });
}

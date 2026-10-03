// Groq Whisper (OpenAI-compatible /audio/transcriptions, verbose_json) on the mono 16 kHz
// audio the storage adapter serves. Model ID from env (STT_MODEL).
// - The audio is downloaded once (url) or read from disk (filePath).
// - Files above chunkBytes (default 20 MB; Groq's free-tier upload limit is 25 MB) are split
//   into byte chunks (MP3 decoders resync on frame boundaries) and transcribed one by one.
//   Each chunk's start in the file is the sum of the previous chunks' reported durations
//   (or a byte-proportional share of durationMs when a reply has no duration). The result
//   is then { language, durationMs, chunks: [{ offsetMs, segments }] } (see contract.js
//   normalizeTranscript); a single chunk returns plain { language, durationMs, segments }.
// - A shared rate limiter spaces calls (free tier: 20 req/min); 429 -> exponential backoff;
//   every request has an AbortController timeout. fetch is read from globalThis at call
//   time, so tests can stub it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { getEnv } from '../../config/env.js';
import { createRateLimiter } from '../llm/real.js';
import { TranscribeInput } from './contract.js';

const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const sttLimiter = createRateLimiter({ intervals: { groq: 3000 } });

function sttError(message, extra = {}) {
  return Object.assign(new Error(`transcription: ${message}`), { code: 'transcription_failed', ...extra });
}

async function withTimeout(timeoutMs, fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) throw sttError(`timed out after ${timeoutMs} ms`, { code: 'timeout' });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function loadAudio({ url, filePath }, timeoutMs) {
  if (filePath) return { bytes: await fs.readFile(filePath), name: path.basename(filePath), type: 'audio/mpeg' };
  return withTimeout(timeoutMs, async (signal) => {
    const res = await globalThis.fetch(url, { signal });
    if (!res.ok) throw sttError(`audio download HTTP ${res.status}`, { status: res.status });
    const name = path.basename(new URL(url).pathname) || 'audio.mp3';
    return { bytes: Buffer.from(await res.arrayBuffer()), name, type: res.headers.get('content-type') || 'audio/mpeg' };
  });
}

const toMs = (s) => Math.round(Number(s) * 1000);

function toSegments(reply) {
  return (reply?.segments ?? [])
    .map((s) => ({ startMs: Math.max(0, toMs(s.start)), endMs: toMs(s.end), text: String(s.text ?? '').trim() }))
    .filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs && s.text);
}

// createTranscriptionClient(options) -> { transcribe(input) }
//   env: { GROQ_API_KEY, STT_MODEL } (default getEnv() at call time); sleep, limiter,
//   retries (429 retries, default 3), baseDelayMs (2000), timeoutMs (per request, 120000),
//   chunkBytes (20 MB).
export function createTranscriptionClient({
  env,
  sleep = defaultSleep,
  limiter = sttLimiter,
  retries = 3,
  baseDelayMs = 2000,
  timeoutMs = 120_000,
  chunkBytes = 20 * 1024 * 1024,
} = {}) {
  async function postChunk(chunk, { name, type }, { apiKey, model, language }) {
    for (let attempt = 0; ; attempt++) {
      await limiter.take('groq');
      const form = new FormData();
      form.append('file', new Blob([chunk], { type }), name);
      form.append('model', model);
      form.append('response_format', 'verbose_json');
      form.append('temperature', '0');
      if (language) form.append('language', language);
      const res = await withTimeout(timeoutMs, (signal) =>
        globalThis.fetch(GROQ_TRANSCRIBE_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}` },
          body: form,
          signal,
        }),
      );
      if (res.ok) return res.json();
      let message = res.statusText;
      try {
        message = (await res.json())?.error?.message || message;
      } catch {
        // keep statusText
      }
      if (res.status === 429 && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        await sleep(Math.max(baseDelayMs * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter : 0));
        continue;
      }
      throw sttError(`HTTP ${res.status} ${message}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 });
    }
  }

  async function transcribe(input) {
    const req = TranscribeInput.parse(input);
    const cfg = env ?? getEnv();
    if (!cfg.GROQ_API_KEY) throw sttError('GROQ_API_KEY is not set', { code: 'not_configured' });
    const audio = await loadAudio(req, timeoutMs);
    const total = audio.bytes.length;
    if (!total) throw sttError('audio is empty', { retryable: false });

    const opts = { apiKey: cfg.GROQ_API_KEY, model: cfg.STT_MODEL, language: req.language };
    const chunks = [];
    let offsetMs = 0;
    let language = req.language;
    for (let start = 0; start < total; start += chunkBytes) {
      const piece = audio.bytes.subarray(start, Math.min(start + chunkBytes, total));
      const reply = await postChunk(piece, audio, opts);
      language ??= reply?.language;
      chunks.push({ offsetMs, segments: toSegments(reply) });
      const replyMs = reply?.duration != null && Number.isFinite(Number(reply.duration)) ? toMs(reply.duration) : null;
      offsetMs += replyMs ?? (req.durationMs ? Math.round((req.durationMs * piece.length) / total) : 0);
    }
    const durationMs = req.durationMs ?? offsetMs;
    const lang = language || 'unknown';
    return chunks.length === 1
      ? { language: lang, durationMs, segments: chunks[0].segments }
      : { language: lang, durationMs, chunks };
  }

  return { transcribe };
}

let defaultClient;

// transcribe({ url | filePath, language?, durationMs? })
export function transcribe(input) {
  defaultClient ??= createTranscriptionClient();
  return defaultClient.transcribe(input);
}

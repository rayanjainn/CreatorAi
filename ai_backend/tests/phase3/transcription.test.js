// P3.T1 transcription step: chunk-aware (offsets re-based per chunk into one continuous,
// ordered, non-overlapping list clipped to the asset duration), idempotent; and the real
// Groq Whisper adapter with fetch stubbed.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { getTranscription } from '../../src/adapters/transcription/index.js';
import { createTranscriptionClient } from '../../src/adapters/transcription/real.js';
import { query } from '../../src/db/pool.js';
import { run } from '../../src/workers/steps/transcription.js';
import { closeAll, resetDb } from '../helpers/db.js';
import { clearQueues } from '../helpers/queue.js';
import { registerOriginal, team } from './helpers.js';

const app = createApp({ log: { error() {} } });

const segmentsOf = async (assetId) =>
  (
    await query('SELECT start_ms, end_ms, text FROM transcript_segments WHERE asset_id = $1 ORDER BY start_ms', [assetId])
  ).rows.map((r) => [r.start_ms, r.end_ms, r.text]);

describe('transcription step', () => {
  let t;
  beforeEach(async () => {
    await resetDb();
    await clearQueues();
    getStorage().reset();
    getTranscription().reset();
    t = await team(app);
  });
  afterAll(closeAll);

  it('two chunks -> one continuous, correctly offset segment list', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token, { durationMs: 20_000 });
    getTranscription().queueResult({
      language: 'en',
      durationMs: 20_000,
      chunks: [
        // second chunk listed first: order comes from offsetMs
        {
          offsetMs: 10_000,
          segments: [
            { startMs: 0, endMs: 4_000, text: 'third' },
            { startMs: 4_000, endMs: 9_000, text: 'fourth' },
          ],
        },
        {
          offsetMs: 0,
          segments: [
            { startMs: 0, endMs: 5_000, text: 'first' },
            { startMs: 5_000, endMs: 10_000, text: 'second' },
          ],
        },
      ],
    });
    const out = await run({ assetId: asset.id, projectId: t.project.id });
    expect(out.segments).toBe(4);
    expect(await segmentsOf(asset.id)).toEqual([
      [0, 5_000, 'first'],
      [5_000, 10_000, 'second'],
      [10_000, 14_000, 'third'],
      [14_000, 19_000, 'fourth'],
    ]);
  });

  it('overlapping chunks: duplicates dropped, overlaps trimmed, clipped to the asset duration', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token, { durationMs: 15_000 });
    getTranscription().queueResult({
      language: 'en',
      durationMs: 16_000,
      chunks: [
        { offsetMs: 0, segments: [{ startMs: 0, endMs: 6_000, text: 'a' }, { startMs: 6_000, endMs: 9_000, text: 'b' }] },
        // starts 1 s before the first chunk ends: 'b again' repeats b, 'c' overlaps b's end
        {
          offsetMs: 8_000,
          segments: [
            { startMs: 0, endMs: 900, text: 'b again' },
            { startMs: 500, endMs: 4_000, text: 'c' },
            { startMs: 4_000, endMs: 8_000, text: 'd past the end' },
            { startMs: 7_500, endMs: 8_000, text: 'e entirely past the end' },
          ],
        },
      ],
    });
    await run({ assetId: asset.id, projectId: t.project.id });
    expect(await segmentsOf(asset.id)).toEqual([
      [0, 6_000, 'a'],
      [6_000, 9_000, 'b'],
      [9_000, 12_000, 'c'],
      [12_000, 15_000, 'd past the end'],
    ]);
  });

  it('a rerun replaces the segments instead of duplicating them', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token);
    await run({ assetId: asset.id, projectId: t.project.id });
    const first = await segmentsOf(asset.id);
    await run({ assetId: asset.id, projectId: t.project.id });
    expect(await segmentsOf(asset.id)).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it('an invalid adapter reply fails the step and keeps the previous segments', async () => {
    const asset = await registerOriginal(app, t.project, t.editor.token);
    await run({ assetId: asset.id, projectId: t.project.id });
    const before = await segmentsOf(asset.id);
    getTranscription().queueResult({ language: 'en', durationMs: 1000, segments: [{ startMs: 5, endMs: 2, text: 'x' }] });
    await expect(run({ assetId: asset.id, projectId: t.project.id })).rejects.toThrow();
    expect(await segmentsOf(asset.id)).toEqual(before);
  });
});

describe('real transcription adapter (Groq Whisper, fetch stubbed)', () => {
  const env = { GROQ_API_KEY: 'groq-key', STT_MODEL: 'whisper-test-model' };
  const noLimit = { take: async () => {} };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  afterEach(() => vi.unstubAllGlobals());

  it('downloads the audio, posts it with the model from env and maps verbose_json segments', async () => {
    const fetch = vi.fn(async (url) => {
      if (String(url).startsWith('https://audio.test/')) return new Response(new Uint8Array(100), { status: 200 });
      return json(200, {
        language: 'english',
        duration: 4.2,
        segments: [
          { start: 0, end: 1.5, text: ' Hello there. ' },
          { start: 1.5, end: 1.5, text: 'zero length' },
          { start: 1.5, end: 4.2, text: 'General Kenobi.' },
        ],
      });
    });
    vi.stubGlobal('fetch', fetch);
    const out = await createTranscriptionClient({ env, limiter: noLimit }).transcribe({ url: 'https://audio.test/a.mp3' });
    expect(out).toEqual({
      language: 'english',
      durationMs: 4200,
      segments: [
        { startMs: 0, endMs: 1500, text: 'Hello there.' },
        { startMs: 1500, endMs: 4200, text: 'General Kenobi.' },
      ],
    });
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(init.headers.authorization).toBe('Bearer groq-key');
    expect(init.body.get('model')).toBe('whisper-test-model');
    expect(init.body.get('response_format')).toBe('verbose_json');
    expect(init.body.get('file')).toBeInstanceOf(Blob);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('large audio is sent in chunks whose offsets follow the reported durations', async () => {
    let call = 0;
    const fetch = vi.fn(async (url) => {
      if (String(url).startsWith('https://audio.test/')) return new Response(new Uint8Array(250), { status: 200 });
      call += 1;
      return json(200, { duration: 10, segments: [{ start: 1, end: 2, text: `chunk ${call}` }] });
    });
    vi.stubGlobal('fetch', fetch);
    const out = await createTranscriptionClient({ env, limiter: noLimit, chunkBytes: 100 }).transcribe({
      url: 'https://audio.test/long.mp3',
      durationMs: 30_000,
    });
    expect(fetch).toHaveBeenCalledTimes(4); // download + 3 chunks
    expect(out.chunks.map((c) => c.offsetMs)).toEqual([0, 10_000, 20_000]);
    expect(out.chunks[2].segments).toEqual([{ startMs: 1000, endMs: 2000, text: 'chunk 3' }]);
    expect(out.durationMs).toBe(30_000);
  });

  it('429 backs off and retries; a 401 fails as not retryable', async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).startsWith('https://audio.test/')) return new Response(new Uint8Array(10), { status: 200 });
        n += 1;
        return n === 1 ? json(429, { error: { message: 'slow down' } }) : json(200, { duration: 1, segments: [] });
      }),
    );
    const out = await createTranscriptionClient({ env, limiter: noLimit, sleep }).transcribe({ url: 'https://audio.test/a.mp3' });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(out.segments).toEqual([]);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        String(url).startsWith('https://audio.test/')
          ? new Response(new Uint8Array(10), { status: 200 })
          : json(401, { error: { message: 'bad key' } }),
      ),
    );
    await expect(createTranscriptionClient({ env, limiter: noLimit }).transcribe({ url: 'https://audio.test/a.mp3' })).rejects.toMatchObject({
      status: 401,
      retryable: false,
    });
  });

  it('refuses to run without GROQ_API_KEY', async () => {
    await expect(createTranscriptionClient({ env: { STT_MODEL: 'm' } }).transcribe({ url: 'https://audio.test/a.mp3' })).rejects.toMatchObject({
      code: 'not_configured',
    });
  });
});

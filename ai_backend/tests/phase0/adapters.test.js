import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { getEnv } from '../../src/config/env.js';
import { getLlm } from '../../src/adapters/llm/index.js';
import { getEmbeddings } from '../../src/adapters/embeddings/index.js';
import { getTranscription } from '../../src/adapters/transcription/index.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { getWebSearch } from '../../src/adapters/search/index.js';
import { getFfmpeg } from '../../src/adapters/ffmpeg/index.js';
import * as embeddingsReal from '../../src/adapters/embeddings/real.js';
import * as transcriptionReal from '../../src/adapters/transcription/real.js';
import * as storageReal from '../../src/adapters/storage/real.js';
import * as ffmpegReal from '../../src/adapters/ffmpeg/real.js';
import { CompleteJsonOutput } from '../../src/adapters/llm/contract.js';
import { embeddingsOutput } from '../../src/adapters/embeddings/contract.js';
import { TranscribeOutput } from '../../src/adapters/transcription/contract.js';
import { DestroyOutput, Resource, SignUploadOutput } from '../../src/adapters/storage/contract.js';
import { SearchOutput } from '../../src/adapters/search/contract.js';
import { ProbeOutput, RunOutput } from '../../src/adapters/ffmpeg/contract.js';

const all = [getLlm, getEmbeddings, getTranscription, getStorage, getWebSearch, getFfmpeg];
afterEach(() => all.forEach((get) => get().reset()));

describe('ADAPTERS=fake selects every fake', () => {
  it.each(all.map((g) => [g.name, g]))('%s', (_name, get) => {
    expect(getEnv().ADAPTERS).toBe('fake');
    expect(typeof get().reset).toBe('function');
  });
});

describe('fake llm', () => {
  it('returns schema-valid JSON output', async () => {
    const out = await getLlm().completeJson({ system: 's', prompt: 'p' });
    expect(CompleteJsonOutput.parse(out).json).toEqual({ ok: true });
  });

  it('plays scripted replies in order, records calls, and surfaces invalid JSON and errors', async () => {
    const llm = getLlm();
    llm.queueResponse({ ideas: [1] }, 'not json', new Error('429 from provider'));
    expect((await llm.completeJson({ prompt: 'a' })).json).toEqual({ ideas: [1] });
    await expect(llm.completeJson({ prompt: 'b' })).rejects.toMatchObject({ code: 'invalid_json' });
    await expect(llm.completeJson({ prompt: 'c' })).rejects.toThrow('429');
    expect(llm.calls.map((c) => c.prompt)).toEqual(['a', 'b', 'c']);
  });
});

describe('fake embeddings', () => {
  const dim = getEnv().EMBED_DIM;

  it('returns deterministic unit vectors of EMBED_DIM', async () => {
    const e = getEmbeddings();
    const [a, b] = await e.embedTexts(['hello', 'world']);
    embeddingsOutput(dim).parse([a, b]);
    expect(Math.hypot(...a)).toBeCloseTo(1, 6);
    expect((await e.embedTexts(['hello']))[0]).toEqual(a);
    expect(a).not.toEqual(b);
    embeddingsOutput(dim).parse(await e.embedImages(['https://x.test/k.jpg']));
  });

  it('seed() pins an exact vector', async () => {
    const pinned = Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : 0));
    getEmbeddings().seed('text:pinned', pinned);
    expect((await getEmbeddings().embedTexts(['pinned']))[0]).toEqual(pinned);
  });
});

describe('fake transcription', () => {
  it('returns ordered, non-overlapping segments within the duration', async () => {
    const out = TranscribeOutput.parse(await getTranscription().transcribe({ url: 'https://x.test/a.mp3', durationMs: 20_000 }));
    expect(out.segments.length).toBeGreaterThan(1);
    for (let i = 1; i < out.segments.length; i++) {
      expect(out.segments[i].startMs).toBeGreaterThanOrEqual(out.segments[i - 1].endMs);
    }
    expect(out.segments.at(-1).endMs).toBeLessThanOrEqual(out.durationMs);
  });

  it('requires a url or file path', async () => {
    await expect(getTranscription().transcribe({})).rejects.toThrow();
  });
});

describe('fake storage', () => {
  it('sign, getResource, proxyUrl, uploadFile, destroy are schema-valid', async () => {
    const s = getStorage();
    SignUploadOutput.parse(await s.signUpload({ folder: 'proj/p1/originals' }));

    s.putResource({ publicId: 'proj/p1/originals/clip', durationMs: 20_000, width: 640, height: 360 });
    Resource.parse(await s.getResource('proj/p1/originals/clip'));
    expect(await s.getResource('missing')).toBeNull();
    expect(s.proxyUrl('proj/p1/originals/clip')).toMatch(/^https:\/\//);

    const file = path.join(os.tmpdir(), `adapter-upload-${process.pid}.txt`);
    await fs.writeFile(file, 'data');
    try {
      const uploaded = Resource.parse(await s.uploadFile(file, { folder: 'proj/p1/derived', resourceType: 'raw' }));
      expect(uploaded.publicId).toBe(`proj/p1/derived/adapter-upload-${process.pid}`);
    } finally {
      await fs.rm(file, { force: true });
    }

    expect(DestroyOutput.parse(await s.destroy('proj/p1/originals/clip'))).toEqual({ result: 'ok' });
    expect(await s.destroy('proj/p1/originals/clip')).toEqual({ result: 'not found' });
  });
});

describe('fake web search', () => {
  it('returns stable, schema-valid results', async () => {
    const a = SearchOutput.parse(await getWebSearch().search('short form hooks', { limit: 3 }));
    expect(a.results).toHaveLength(3);
    expect(await getWebSearch().search('short form hooks', { limit: 3 })).toEqual(a);
  });
});

describe('fake ffmpeg', () => {
  it('probe and run are schema-valid', async () => {
    const f = getFfmpeg();
    const probe = ProbeOutput.parse(await f.probe('anything.mp4'));
    expect(probe.streams.map((s) => s.type).sort()).toEqual(['audio', 'video']);
    RunOutput.parse(await f.run(['-version']));
    expect(f.runs).toEqual([['-version']]);
  });
});

describe('real adapters are stubs until their phase', () => {
  it.each([
    ['embeddings.embedTexts', () => embeddingsReal.embedTexts(['x'])],
    ['transcription.transcribe', () => transcriptionReal.transcribe({ url: 'x' })],
    ['storage.signUpload', () => storageReal.signUpload({ folder: 'x' })],
    ['ffmpeg.probe', () => ffmpegReal.probe('x')],
  ])('%s throws "not implemented"', async (_name, call) => {
    await expect(call()).rejects.toThrow(/not implemented/);
  });
});

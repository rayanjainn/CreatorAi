// Storage adapter (P2.T1): the fake's contract and the real Cloudinary adapter's signing,
// verification and Admin API mapping. The real adapter never reaches the network here:
// fetch is stubbed.
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnv } from '../../src/config/env.js';
import { getStorage } from '../../src/adapters/storage/index.js';
import { DestroyOutput, Resource, SignUploadOutput } from '../../src/adapters/storage/contract.js';
import * as real from '../../src/adapters/storage/real.js';

const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const now = () => Math.floor(Date.now() / 1000);

describe('fake storage', () => {
  const s = getStorage();
  beforeEach(() => s.reset());

  it('verifies notification signatures made with its deterministic secret', () => {
    const body = JSON.stringify({ notification_type: 'upload', public_id: 'proj/x/originals/a' });
    const timestamp = now();
    const signature = s.signNotification(body, timestamp);
    expect(signature).toBe(sha1(body + timestamp + s.FAKE_API_SECRET));
    expect(s.verifyNotification({ body, timestamp, signature })).toBe(true);
    expect(s.verifyNotification({ body: body + ' ', timestamp, signature })).toBe(false);
    expect(s.verifyNotification({ body, timestamp, signature: 'f'.repeat(40) })).toBe(false);
    expect(s.verifyNotification({ body, timestamp, signature: undefined })).toBe(false);
    expect(s.verifyNotification({ body, timestamp: undefined, signature })).toBe(false);
  });

  it('rejects a notification older than two hours even when correctly signed', () => {
    const body = '{}';
    const old = now() - 3 * 3600;
    expect(s.verifyNotification({ body, timestamp: old, signature: s.signNotification(body, old) })).toBe(false);
  });

  it('records every destroy call', async () => {
    s.putResource({ publicId: 'proj/x/originals/a' });
    await s.destroy('proj/x/originals/a');
    await s.destroy('proj/x/derived/k1', { resourceType: 'image' });
    expect(s.destroyed).toEqual(['proj/x/originals/a', 'proj/x/derived/k1']);
    s.reset();
    expect(s.destroyed).toEqual([]);
  });
});

describe('real storage (Cloudinary), no network', () => {
  const ENV = { CLOUDINARY_CLOUD_NAME: 'demo-cloud', CLOUDINARY_API_KEY: '1234', CLOUDINARY_API_SECRET: 'shh-secret' };
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
    Object.assign(process.env, ENV);
    resetEnv();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetEnv();
    vi.unstubAllGlobals();
  });

  it('signUpload signs folder + timestamp: sha1(sorted params + api_secret)', async () => {
    const out = SignUploadOutput.parse(await real.signUpload({ folder: 'proj/p1/originals' }));
    expect(out).toMatchObject({
      cloudName: 'demo-cloud',
      apiKey: '1234',
      folder: 'proj/p1/originals',
      resourceType: 'video',
      uploadUrl: 'https://api.cloudinary.com/v1_1/demo-cloud/video/upload',
    });
    expect(Math.abs(out.timestamp - now())).toBeLessThan(5);
    expect(out.signature).toBe(sha1(`folder=proj/p1/originals&timestamp=${out.timestamp}shh-secret`));
  });

  it('verifyNotification: sha1(body + timestamp + api_secret), fresh timestamps only', () => {
    const body = '{"notification_type":"upload"}';
    const ts = now();
    const good = sha1(body + ts + 'shh-secret');
    expect(real.verifyNotification({ body, timestamp: ts, signature: good })).toBe(true);
    expect(real.verifyNotification({ body, timestamp: String(ts), signature: good })).toBe(true);
    expect(real.verifyNotification({ body, timestamp: ts, signature: sha1(body + ts + 'other') })).toBe(false);
    const old = ts - 3 * 3600;
    expect(real.verifyNotification({ body, timestamp: old, signature: sha1(body + old + 'shh-secret') })).toBe(false);
  });

  it('getResource maps the Admin API response (seconds -> ms) and uses basic auth', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          public_id: 'proj/p1/originals/clip',
          resource_type: 'video',
          format: 'mp4',
          bytes: 12345,
          secure_url: 'https://res.cloudinary.com/demo-cloud/video/upload/v1/proj/p1/originals/clip.mp4',
          duration: 20.04,
          width: 640,
          height: 360,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = Resource.parse(await real.getResource('proj/p1/originals/clip'));
    expect(r).toMatchObject({ publicId: 'proj/p1/originals/clip', durationMs: 20040, width: 640, height: 360, bytes: 12345 });
    const [url, init] = fetchMock.mock.calls[0];
    // Without media_metadata=true the real Admin API omits `duration` for videos.
    expect(url).toBe(
      'https://api.cloudinary.com/v1_1/demo-cloud/resources/video/upload/proj/p1/originals/clip?media_metadata=true',
    );
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('1234:shh-secret').toString('base64')}`);
  });

  it('getResource returns null on 404 and throws on other errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"nope"}}', { status: 404 })));
    expect(await real.getResource('missing')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"boom"}}', { status: 500 })));
    await expect(real.getResource('x')).rejects.toThrow(/500/);
  });

  it('destroy posts a signed request and maps the result', async () => {
    const fetchMock = vi.fn(async () => new Response('{"result":"not found"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(DestroyOutput.parse(await real.destroy('proj/p1/derived/k', { resourceType: 'image' }))).toEqual({
      result: 'not found',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/destroy');
    const form = new URLSearchParams(init.body);
    expect(form.get('public_id')).toBe('proj/p1/derived/k');
    expect(form.get('signature')).toBe(sha1(`public_id=proj/p1/derived/k&timestamp=${form.get('timestamp')}shh-secret`));
  });

  it('proxyUrl and audioUrl are Cloudinary delivery URLs', () => {
    expect(real.proxyUrl('proj/p1/originals/clip')).toBe(
      'https://res.cloudinary.com/demo-cloud/video/upload/w_480,q_auto/proj/p1/originals/clip.mp4',
    );
    expect(real.audioUrl('proj/p1/originals/clip')).toMatch(/^https:\/\/res\.cloudinary\.com\/demo-cloud\/video\/upload\/.+\.mp3$/);
  });
});

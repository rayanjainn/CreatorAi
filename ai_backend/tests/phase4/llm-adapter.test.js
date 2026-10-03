// P4.T1: the real LLM adapter (Gemini primary, Groq fallback) with global fetch stubbed.
// No network: every test replaces fetch with vi.fn and sleep with a recorder.
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../src/app.js';
import { createLlmClient, createRateLimiter } from '../../src/adapters/llm/real.js';
import { configureRunner, resetRunner, runAgent } from '../../src/modules/agents/run.js';
import { authHeader, createUser } from '../helpers/auth.js';
import { closeAll, resetDb } from '../helpers/db.js';

const ENV = {
  LLM_PROVIDER: 'gemini',
  LLM_MODEL: 'primary-model-from-env',
  LLM_FALLBACK_MODEL: 'fallback-model-from-env',
  GEMINI_API_KEY: 'gemini-test-key',
  GROQ_API_KEY: 'groq-test-key',
};

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const geminiOk = (obj, usage = { promptTokenCount: 11, candidatesTokenCount: 7 }) =>
  json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }], usageMetadata: usage });

const groqOk = (obj) =>
  json(200, {
    choices: [{ message: { content: JSON.stringify(obj) } }],
    usage: { prompt_tokens: 5, completion_tokens: 3 },
  });

const isGemini = (url) => String(url).includes('generativelanguage.googleapis.com');
const isGroq = (url) => String(url).includes('api.groq.com');

// fetch that never answers until its AbortSignal fires.
const hanging = (url, init) =>
  new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')));
  });

const noLimit = { take: async () => {} };

function client(overrides = {}) {
  const sleeps = [];
  const llm = createLlmClient({
    env: ENV,
    sleep: async (ms) => sleeps.push(ms),
    limiter: noLimit,
    retries: 2,
    baseDelayMs: 100,
    ...overrides,
  });
  return { llm, sleeps };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetRunner();
});

describe('createLlmClient (real adapter, fetch stubbed)', () => {
  it('calls Gemini in JSON mode with the env model and key, and parses the reply', async () => {
    const fetch = vi.fn(async () => geminiOk({ ideas: ['a'] }));
    vi.stubGlobal('fetch', fetch);
    const { llm } = client();
    const out = await llm.completeJson({ system: 'be brief', prompt: 'plan please', temperature: 0.2 });
    expect(out).toMatchObject({
      json: { ideas: ['a'] },
      provider: 'gemini',
      model: 'primary-model-from-env',
      usage: { inputTokens: 11, outputTokens: 7 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('/models/primary-model-from-env:generateContent');
    expect(init.method).toBe('POST');
    expect(init.headers['x-goog-api-key']).toBe('gemini-test-key');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.systemInstruction.parts[0].text).toBe('be brief');
    expect(body.contents[0].parts[0].text).toBe('plan please');
  });

  it('strips markdown fences; a non-JSON reply throws invalid_json without falling back', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(200, { candidates: [{ content: { parts: [{ text: '```json\n{"a":1}\n```' }] } }] }))
      .mockResolvedValueOnce(json(200, { candidates: [{ content: { parts: [{ text: 'sorry, no' }] } }] }));
    vi.stubGlobal('fetch', fetch);
    const { llm } = client();
    expect((await llm.completeJson({ prompt: 'x' })).json).toEqual({ a: 1 });
    await expect(llm.completeJson({ prompt: 'y' })).rejects.toMatchObject({ code: 'invalid_json' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('429 -> exponential backoff on Gemini, then Groq (OpenAI-compatible, JSON response_format) succeeds', async () => {
    const fetch = vi.fn(async (url) => (isGemini(url) ? json(429, { error: { message: 'quota' } }) : groqOk({ ok: 1 })));
    vi.stubGlobal('fetch', fetch);
    const { llm, sleeps } = client();
    const out = await llm.completeJson({ system: 's', prompt: 'p' });
    expect(out).toMatchObject({ json: { ok: 1 }, provider: 'groq', model: 'fallback-model-from-env' });
    expect(out.usage).toEqual({ inputTokens: 5, outputTokens: 3 });

    const urls = fetch.mock.calls.map(([u]) => u);
    expect(urls.filter(isGemini)).toHaveLength(3); // first try + 2 retries
    expect(urls.filter(isGroq)).toHaveLength(1);
    expect(isGroq(urls.at(-1))).toBe(true);
    expect(sleeps).toEqual([100, 200]); // exponential

    const [groqUrl, init] = fetch.mock.calls.at(-1);
    expect(groqUrl).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer groq-test-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('fallback-model-from-env');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('a 5xx from Gemini switches to Groq without backing off', async () => {
    const fetch = vi.fn(async (url) => (isGemini(url) ? json(503, { error: { message: 'overloaded' } }) : groqOk({ ok: 2 })));
    vi.stubGlobal('fetch', fetch);
    const { llm, sleeps } = client();
    expect((await llm.completeJson({ prompt: 'p' })).provider).toBe('groq');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([]);
  });

  it('both providers failing -> providers_failed error listing both causes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => json(isGemini(url) ? 500 : 502, { error: { message: isGemini(url) ? 'gem down' : 'groq down' } })));
    const { llm } = client();
    const err = await llm.completeJson({ prompt: 'p' }).catch((e) => e);
    expect(err.code).toBe('providers_failed');
    expect(err.message).toMatch(/gemini/);
    expect(err.message).toMatch(/groq/);
    expect(err.errors).toEqual([
      expect.objectContaining({ provider: 'gemini', status: 500 }),
      expect.objectContaining({ provider: 'groq', status: 502 }),
    ]);
  });

  it('times out each provider through AbortController -> code timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(hanging));
    const { llm } = client();
    const started = Date.now();
    const err = await llm.completeJson({ prompt: 'p', timeoutMs: 30 }).catch((e) => e);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(err.code).toBe('timeout');
    expect(err.errors.map((e) => [e.provider, e.code])).toEqual([
      ['gemini', 'timeout'],
      ['groq', 'timeout'],
    ]);
  });

  it('LLM_PROVIDER=groq makes Groq primary', async () => {
    const fetch = vi.fn(async () => groqOk({ g: 1 }));
    vi.stubGlobal('fetch', fetch);
    const { llm } = client({ env: { ...ENV, LLM_PROVIDER: 'groq' } });
    expect((await llm.completeJson({ prompt: 'p' })).provider).toBe('groq');
    expect(isGroq(fetch.mock.calls[0][0])).toBe(true);
  });

  it('every call goes through the shared rate limiter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({ a: 1 })));
    const taken = [];
    const { llm } = client({ limiter: { take: async (key) => taken.push(key) } });
    await llm.completeJson({ prompt: 'p' });
    await llm.completeJson({ prompt: 'q' });
    expect(taken).toEqual(['gemini', 'gemini']);
  });
});

describe('createRateLimiter', () => {
  it('spaces calls per provider by the minimum interval, one at a time', async () => {
    let clock = 0;
    const sleeps = [];
    const limiter = createRateLimiter({
      intervals: { gemini: 1000, groq: 500 },
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    await Promise.all([limiter.take('gemini'), limiter.take('gemini'), limiter.take('groq')]);
    clock += 200;
    await limiter.take('groq');
    expect(sleeps).toEqual([1000, 300]);
  });
});

describe('runAgent over the real adapter (HTTP mocked)', () => {
  const app = createApp({ log: { error() {} } });
  let ctx;

  beforeEach(async () => {
    await resetDb();
    const owner = await createUser(app);
    const res = await request(app).post('/projects').set(authHeader(owner.token)).send({ name: 'Fallback' });
    ctx = { owner, project: res.body.project };
  });
  afterAll(closeAll);

  const Out = z.object({ title: z.string() });
  const run = () => runAgent({ name: 'probe', projectId: ctx.project.id, userId: ctx.owner.user.id, input: {}, outputSchema: Out });

  it('primary 429 -> backoff -> fallback succeeds: the run succeeds and records the provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (isGemini(url) ? json(429, {}) : groqOk({ title: 'from groq' }))));
    const { llm, sleeps } = client();
    configureRunner({ llm });
    const { run: r } = await run();
    expect(r).toMatchObject({ status: 'succeeded', provider: 'groq', model: 'fallback-model-from-env', output: { title: 'from groq' } });
    expect(sleeps.length).toBeGreaterThan(0);
  });

  it('both providers failing -> run failed with both errors recorded', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => json(isGemini(url) ? 500 : 503, {})));
    const { llm } = client();
    configureRunner({ llm });
    const { run: r } = await run();
    expect(r.status).toBe('failed');
    expect(r.error.code).toBe('providers_failed');
    expect(r.error.details.map((d) => d.provider)).toEqual(['gemini', 'groq']);
  });
});

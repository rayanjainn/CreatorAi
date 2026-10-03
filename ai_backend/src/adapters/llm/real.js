// Real LLM adapter: Gemini primary (JSON mode), Groq fallback (OpenAI-compatible chat
// completions with response_format json_object). LLM_PROVIDER picks the primary.
// - One shared rate limiter spaces calls per provider (free tiers rate-limit hard).
// - 429 -> exponential backoff (retries times), then the next provider.
// - 5xx, network errors, timeouts and other HTTP errors -> the next provider at once.
// - A reply that is not a JSON object throws code 'invalid_json' (the agent runner
//   retries it); it does not fall back.
// - Every request has a timeout via AbortController.
// Model IDs come from env (LLM_MODEL, LLM_FALLBACK_MODEL), never from code.
// fetch is read from globalThis at call time, so tests can stub it.
import { getEnv } from '../../config/env.js';
import { CompleteJsonInput, CompleteJsonOutput } from './contract.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One limiter, keyed per provider. Calls are serialized; each waits until at least
// intervals[key] ms have passed since the previous call to the same provider.
export function createRateLimiter({ intervals = {}, now = Date.now, sleep = defaultSleep } = {}) {
  const last = new Map();
  let chain = Promise.resolve();
  return {
    take(key) {
      const turn = chain.then(async () => {
        const interval = intervals[key] ?? 0;
        if (last.has(key)) {
          const wait = last.get(key) + interval - now();
          if (wait > 0) await sleep(wait);
        }
        last.set(key, now());
      });
      chain = turn.catch(() => {});
      return turn;
    },
  };
}

// Free-tier pacing: Gemini Flash ~15 req/min, Groq 30 req/min.
export const sharedLimiter = createRateLimiter({ intervals: { gemini: 4000, groq: 2000 } });

class ProviderError extends Error {
  constructor(provider, message, { status, code = 'provider_error', retryAfterMs } = {}) {
    super(`${provider}: ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.code = code;
    if (status !== undefined) this.status = status;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

function invalidJson(text, why = 'not valid JSON') {
  const err = new Error(`LLM reply is ${why}`);
  err.code = 'invalid_json';
  err.text = text;
  return err;
}

export function parseJsonReply(text) {
  const stripped = String(text ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let json;
  try {
    json = JSON.parse(stripped);
  } catch {
    throw invalidJson(text);
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw invalidJson(text, 'not a JSON object');
  return json;
}

async function errorMessage(res) {
  try {
    const body = await res.json();
    return body?.error?.message || body?.message || res.statusText || 'request failed';
  } catch {
    return res.statusText || 'request failed';
  }
}

function retryAfter(res) {
  const s = Number(res.headers.get('retry-after'));
  return Number.isFinite(s) && s > 0 ? s * 1000 : undefined;
}

// POST JSON with a timeout. Throws ProviderError (status set for HTTP errors).
async function postJson(provider, url, headers, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new ProviderError(provider, `timed out after ${timeoutMs} ms`, { code: 'timeout' })),
    timeoutMs,
  );
  try {
    let res;
    try {
      res = await globalThis.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new ProviderError(provider, `timed out after ${timeoutMs} ms`, { code: 'timeout' });
      }
      throw new ProviderError(provider, `network error: ${err.message}`, { code: 'network_error' });
    }
    if (!res.ok) {
      throw new ProviderError(provider, `HTTP ${res.status} ${await errorMessage(res)}`, {
        status: res.status,
        code: res.status === 429 ? 'rate_limited' : 'http_error',
        retryAfterMs: res.status === 429 ? retryAfter(res) : undefined,
      });
    }
    try {
      return await res.json();
    } catch {
      throw new ProviderError(provider, 'response body is not JSON', { status: res.status });
    }
  } finally {
    clearTimeout(timer);
  }
}

async function imagePart(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await globalThis.fetch(url, { signal: controller.signal });
    if (!res.ok) throw new ProviderError('gemini', `image ${url}: HTTP ${res.status}`, { code: 'image_fetch_failed' });
    const data = Buffer.from(await res.arrayBuffer()).toString('base64');
    return { inline_data: { mime_type: res.headers.get('content-type') || 'image/jpeg', data } };
  } finally {
    clearTimeout(timer);
  }
}

const PROVIDERS = {
  gemini: {
    key: 'GEMINI_API_KEY',
    async call(req, { apiKey, model, timeoutMs }) {
      const parts = [{ text: req.prompt }];
      for (const url of req.images ?? []) parts.push(await imagePart(url, timeoutMs));
      const body = {
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json' },
      };
      if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
      if (req.temperature !== undefined) body.generationConfig.temperature = req.temperature;
      const data = await postJson(
        'gemini',
        `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': apiKey },
        body,
        timeoutMs,
      );
      const text = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      if (!text) {
        const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || 'empty reply';
        throw new ProviderError('gemini', `no content (${reason})`);
      }
      return {
        text,
        usage: {
          inputTokens: data?.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: data?.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    },
  },
  groq: {
    key: 'GROQ_API_KEY',
    async call(req, { apiKey, model, timeoutMs }) {
      // json_object mode requires the word "JSON" somewhere in the messages.
      const system = `${req.system ?? ''}\nRespond with a JSON object.`.trim();
      const body = {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: req.prompt },
        ],
        response_format: { type: 'json_object' },
      };
      if (req.temperature !== undefined) body.temperature = req.temperature;
      const data = await postJson('groq', GROQ_URL, { authorization: `Bearer ${apiKey}` }, body, timeoutMs);
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new ProviderError('groq', 'no content in reply');
      return {
        text,
        usage: { inputTokens: data?.usage?.prompt_tokens ?? 0, outputTokens: data?.usage?.completion_tokens ?? 0 },
      };
    },
  },
};

// createLlmClient(options) -> { completeJson(request) }
//   env:         { LLM_PROVIDER, LLM_MODEL, LLM_FALLBACK_MODEL, GEMINI_API_KEY, GROQ_API_KEY }
//                (default: getEnv() at call time)
//   sleep(ms):   backoff sleep (tests pass a recorder)
//   limiter:     { take(provider) } (default: the process-wide sharedLimiter)
//   retries:     429 retries per provider before falling back (default 2)
//   baseDelayMs: first backoff delay, doubled each retry (default 2000)
//   maxDelayMs:  cap on one backoff delay (default 30000)
//   timeoutMs:   per-request timeout when the request sets none (default 60000)
export function createLlmClient({
  env,
  sleep = defaultSleep,
  limiter = sharedLimiter,
  retries = 2,
  baseDelayMs = 2000,
  maxDelayMs = 30_000,
  timeoutMs = 60_000,
} = {}) {
  async function attemptProvider(name, req, model, cfg) {
    const provider = PROVIDERS[name];
    const apiKey = cfg[provider.key];
    if (!apiKey) throw new ProviderError(name, `${provider.key} is not set`, { code: 'not_configured' });
    for (let attempt = 0; ; attempt++) {
      await limiter.take(name);
      try {
        return await provider.call(req, { apiKey, model, timeoutMs: req.timeoutMs ?? timeoutMs });
      } catch (err) {
        if (err.status !== 429 || attempt >= retries) throw err;
        const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
        await sleep(Math.min(Math.max(backoff, err.retryAfterMs ?? 0), maxDelayMs));
      }
    }
  }

  async function completeJson(request) {
    const req = CompleteJsonInput.parse(request);
    const cfg = env ?? getEnv();
    const primary = cfg.LLM_PROVIDER === 'groq' ? 'groq' : 'gemini';
    const chain = [
      { name: primary, model: req.model ?? cfg.LLM_MODEL },
      { name: primary === 'gemini' ? 'groq' : 'gemini', model: cfg.LLM_FALLBACK_MODEL },
    ];

    const errors = [];
    for (const { name, model } of chain) {
      let reply;
      try {
        reply = await attemptProvider(name, req, model, cfg);
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
        errors.push({ provider: name, model, code: err.code, status: err.status ?? null, message: err.message });
        continue;
      }
      const json = parseJsonReply(reply.text);
      return CompleteJsonOutput.parse({ json, text: reply.text, provider: name, model, usage: reply.usage });
    }

    const err = new Error(`All LLM providers failed: ${errors.map((e) => e.message).join('; ')}`);
    err.code = errors.every((e) => e.code === 'timeout') ? 'timeout' : 'providers_failed';
    err.errors = errors;
    throw err;
  }

  return { completeJson };
}

let defaultClient;

// completeJson({ system?, prompt, model?, temperature?, images?, timeoutMs? })
//   -> { json, text, provider, model, usage }
export function completeJson(request) {
  defaultClient ??= createLlmClient();
  return defaultClient.completeJson(request);
}

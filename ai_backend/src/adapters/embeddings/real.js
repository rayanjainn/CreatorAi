// Gemini embeddings (batchEmbedContents) at EMBED_DIM, model from env (EMBED_MODEL).
// - Texts and images (gemini-embedding-2 is multimodal: the image is fetched and sent as
//   inline_data). Models that are text-only (EMBED_MODEL containing "embedding-001", or a
//   400 refusing the image part) make embedImages reject with code 'unsupported', which
//   the embeddings step answers by embedding the scene caption instead.
// - outputDimensionality = EMBED_DIM; vectors are L2-normalised (Gemini only normalises
//   the full-size output). Batches of up to 100 inputs per request.
// - A shared rate limiter spaces calls; 429 -> exponential backoff; every request has an
//   AbortController timeout. fetch is read from globalThis at call time (tests stub it).
import { getEnv } from '../../config/env.js';
import { createRateLimiter } from '../llm/real.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const BATCH = 100;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const embedLimiter = createRateLimiter({ intervals: { gemini: 700 } });

function embedError(message, extra = {}) {
  return Object.assign(new Error(`embeddings: ${message}`), { code: 'embeddings_failed', ...extra });
}

async function withTimeout(timeoutMs, fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) throw embedError(`timed out after ${timeoutMs} ms`, { code: 'timeout' });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const textOnly = (model) => /embedding-001|text-embedding/.test(model);

function normalise(values, dim) {
  if (!Array.isArray(values) || values.length !== dim || !values.every(Number.isFinite)) {
    throw embedError(`expected ${dim} finite values, got ${Array.isArray(values) ? values.length : typeof values}`);
  }
  const norm = Math.hypot(...values) || 1;
  return values.map((x) => x / norm);
}

// createEmbeddingsClient(options) -> { embedTexts, embedImages, supportsImages }
//   env: { GEMINI_API_KEY, EMBED_MODEL, EMBED_DIM } (default getEnv() at call time);
//   sleep, limiter, retries (429 retries, default 3), baseDelayMs (2000), timeoutMs (60000).
export function createEmbeddingsClient({
  env,
  sleep = defaultSleep,
  limiter = embedLimiter,
  retries = 3,
  baseDelayMs = 2000,
  timeoutMs = 60_000,
} = {}) {
  const cfg = () => env ?? getEnv();

  async function batchEmbed(parts) {
    const { GEMINI_API_KEY: apiKey, EMBED_MODEL: model, EMBED_DIM: dim } = cfg();
    if (!apiKey) throw embedError('GEMINI_API_KEY is not set', { code: 'not_configured' });
    const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:batchEmbedContents`;
    const out = [];
    for (let i = 0; i < parts.length; i += BATCH) {
      const body = {
        requests: parts.slice(i, i + BATCH).map((p) => ({
          model: `models/${model}`,
          content: { parts: [p] },
          outputDimensionality: dim,
        })),
      };
      for (let attempt = 0; ; attempt++) {
        await limiter.take('gemini');
        const res = await withTimeout(timeoutMs, (signal) =>
          globalThis.fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body),
            signal,
          }),
        );
        if (res.ok) {
          const data = await res.json();
          const embeddings = data?.embeddings ?? [];
          if (embeddings.length !== body.requests.length) {
            throw embedError(`expected ${body.requests.length} embeddings, got ${embeddings.length}`);
          }
          out.push(...embeddings.map((e) => normalise(e?.values, dim)));
          break;
        }
        let message = res.statusText;
        try {
          message = (await res.json())?.error?.message || message;
        } catch {
          // keep statusText
        }
        if (res.status === 429 && attempt < retries) {
          await sleep(baseDelayMs * 2 ** attempt);
          continue;
        }
        throw embedError(`HTTP ${res.status} ${message}`, {
          status: res.status,
          retryable: res.status === 429 || res.status >= 500,
        });
      }
    }
    return out;
  }

  async function imagePart(url) {
    return withTimeout(timeoutMs, async (signal) => {
      const res = await globalThis.fetch(url, { signal });
      if (!res.ok) throw embedError(`image ${url}: HTTP ${res.status}`, { status: res.status });
      const data = Buffer.from(await res.arrayBuffer()).toString('base64');
      return { inline_data: { mime_type: res.headers.get('content-type') || 'image/jpeg', data } };
    });
  }

  function supportsImages() {
    return !textOnly(cfg().EMBED_MODEL);
  }

  async function embedTexts(texts) {
    if (!texts.length) return [];
    return batchEmbed(texts.map((text) => ({ text })));
  }

  async function embedImages(urls) {
    if (!supportsImages()) throw embedError(`${cfg().EMBED_MODEL} does not embed images`, { code: 'unsupported' });
    if (!urls.length) return [];
    const parts = [];
    for (const url of urls) parts.push(await imagePart(url));
    try {
      return await batchEmbed(parts);
    } catch (err) {
      if (err.status === 400) throw embedError(`image input refused: ${err.message}`, { code: 'unsupported' });
      throw err;
    }
  }

  return { embedTexts, embedImages, supportsImages };
}

let defaultClient;
const client = () => (defaultClient ??= createEmbeddingsClient());

// embedTexts(texts[]) -> number[EMBED_DIM][]
export const embedTexts = (texts) => client().embedTexts(texts);
// embedImages(urls[]) -> number[EMBED_DIM][] (rejects with code 'unsupported' on text-only models)
export const embedImages = (urls) => client().embedImages(urls);
export const supportsImages = () => client().supportsImages();

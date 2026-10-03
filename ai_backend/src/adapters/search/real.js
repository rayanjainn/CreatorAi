// Real web search for the Research Agent. SEARCH_PROVIDER picks serper (SERPER_API) or
// tavily (TAVILY_API_KEY). Uses global fetch (read at call time, so tests can stub it)
// with an AbortController timeout. Results without a valid URL are dropped.
import { getEnv } from '../../config/env.js';
import { SearchOutput } from './contract.js';

const Result = SearchOutput.shape.results.element;

function searchError(message, code = 'search_failed') {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function postJson(url, headers, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      if (controller.signal.aborted) throw searchError(`search timed out after ${timeoutMs} ms`, 'timeout');
      throw searchError(`search request failed: ${err.message}`);
    }
    if (!res.ok) throw searchError(`search failed: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const PROVIDERS = {
  serper: {
    key: 'SERPER_API',
    async search(query, limit, apiKey, timeoutMs) {
      const data = await postJson('https://google.serper.dev/search', { 'x-api-key': apiKey }, { q: query, num: limit }, timeoutMs);
      return (data?.organic ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? '' }));
    },
  },
  tavily: {
    key: 'TAVILY_API_KEY',
    async search(query, limit, apiKey, timeoutMs) {
      const data = await postJson(
        'https://api.tavily.com/search',
        { authorization: `Bearer ${apiKey}` },
        { query, max_results: limit, search_depth: 'basic' },
        timeoutMs,
      );
      return (data?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? '' }));
    },
  },
};

// createSearchClient({ env?, timeoutMs? }) -> { search(query, { limit? }) }
export function createSearchClient({ env, timeoutMs = 15_000 } = {}) {
  return {
    async search(query, { limit = 5 } = {}) {
      const cfg = env ?? getEnv();
      const provider = PROVIDERS[cfg.SEARCH_PROVIDER] ?? PROVIDERS.tavily;
      const apiKey = cfg[provider.key];
      if (!apiKey) throw searchError(`${provider.key} is not set`, 'not_configured');
      const raw = await provider.search(query, limit, apiKey, timeoutMs);
      const results = raw.filter((r) => Result.safeParse(r).success).slice(0, limit);
      return SearchOutput.parse({ query, results });
    },
  };
}

let defaultClient;

// search(query, { limit? }) -> { query, results: [{ title, url, snippet }] }
export function search(query, options) {
  defaultClient ??= createSearchClient();
  return defaultClient.search(query, options);
}

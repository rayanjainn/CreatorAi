// P4.T3: the real web-search adapter (serper and tavily) with global fetch stubbed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSearchClient } from '../../src/adapters/search/real.js';
import { SearchOutput } from '../../src/adapters/search/contract.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('serper', () => {
  const env = { SEARCH_PROVIDER: 'serper', SERPER_API: 'serper-key' };

  it('POSTs the query with the API key and maps organic results', async () => {
    const fetch = vi.fn(async () =>
      json(200, {
        organic: [
          { title: 'Espresso guide', link: 'https://coffee.example/guide', snippet: 'Grind finer' },
          { title: 'Broken', link: 'not a url', snippet: '' },
          { title: 'Dosing', link: 'https://coffee.example/dose' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const out = await createSearchClient({ env }).search('espresso grind', { limit: 3 });
    expect(SearchOutput.parse(out)).toEqual({
      query: 'espresso grind',
      results: [
        { title: 'Espresso guide', url: 'https://coffee.example/guide', snippet: 'Grind finer' },
        { title: 'Dosing', url: 'https://coffee.example/dose', snippet: '' },
      ],
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://google.serper.dev/search');
    expect(init.headers['x-api-key']).toBe('serper-key');
    expect(JSON.parse(init.body)).toEqual({ q: 'espresso grind', num: 3 });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('an HTTP error throws search_failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(403, { message: 'bad key' })));
    await expect(createSearchClient({ env }).search('x')).rejects.toMatchObject({ code: 'search_failed' });
  });
});

describe('tavily', () => {
  const env = { SEARCH_PROVIDER: 'tavily', TAVILY_API_KEY: 'tvly-key' };

  it('POSTs a basic search and maps results', async () => {
    const fetch = vi.fn(async () =>
      json(200, { results: [{ title: 'Milk', url: 'https://milk.example/steam', content: 'Stretch then roll' }] }),
    );
    vi.stubGlobal('fetch', fetch);
    const out = await createSearchClient({ env }).search('steam milk', { limit: 2 });
    expect(out.results).toEqual([{ title: 'Milk', url: 'https://milk.example/steam', snippet: 'Stretch then roll' }]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.tavily.com/search');
    expect(init.headers.authorization).toBe('Bearer tvly-key');
    expect(JSON.parse(init.body)).toMatchObject({ query: 'steam milk', max_results: 2, search_depth: 'basic' });
  });

  it('times out through AbortController', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url, init) =>
          new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
      ),
    );
    await expect(createSearchClient({ env, timeoutMs: 20 }).search('x')).rejects.toMatchObject({ code: 'timeout' });
  });
});

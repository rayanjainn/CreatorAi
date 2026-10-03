// Deterministic web search: the same query always returns the same URLs, so tests can
// check that the Research Agent cites only URLs the search actually returned.
export const calls = [];

export function reset() {
  calls.length = 0;
}

export async function search(query, { limit = 5 } = {}) {
  calls.push({ query, limit });
  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'query';
  return {
    query,
    results: Array.from({ length: limit }, (_, i) => ({
      title: `${query} (source ${i + 1})`,
      url: `https://example.com/${slug}/${i + 1}`,
      snippet: `Background on ${query}, point ${i + 1}.`,
    })),
  };
}

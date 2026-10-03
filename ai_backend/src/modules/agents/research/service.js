// agents/research service: the Research Agent (research briefs with web sources).
// Public API: researchAgent (definition for the agent.run worker), requestResearch,
// listBriefs, getBrief.
//
// Citation rule, enforced in code: the brief may only cite URLs that the web_search
// tool returned for this run. Uncited URLs are dropped; a brief left with no valid
// source while the search found some is invalid output (retried once, then failed).
import { getWebSearch } from '../../../adapters/search/index.js';
import { badRequest, notFound } from '../../../lib/errors.js';
import { getPlan } from '../director/service.js';
import { AgentOutputError, isUuid, startRun } from '../service.js';
import * as repo from './repo.js';
import { Brief, BriefDoc, ResearchBody, ResearchInput } from './schemas.js';

const SEARCH_LIMIT = 8;
const iso = (v) => new Date(v).toISOString();

const toBrief = (row) =>
  Brief.parse({
    id: row.id,
    projectId: row.project_id,
    createdBy: row.created_by ?? null,
    runId: row.run_id ?? null,
    planId: row.plan_id ?? null,
    ideaIndex: row.idea_index ?? null,
    topic: row.topic,
    input: row.input,
    doc: row.doc,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });

const searchQuery = (input) => (input.idea ? `${input.idea.title} ${input.idea.angle}` : input.topic);

const normalizeUrl = (url) => url.trim().replace(/\/+$/, '');

// Keeps only sources whose URL the search returned (first title wins on duplicates).
export function restrictSources(doc, searchResults) {
  const allowed = new Map(searchResults.map((r) => [normalizeUrl(r.url), r.url]));
  const seen = new Set();
  const sources = [];
  for (const source of doc.sources) {
    const key = normalizeUrl(source.url);
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    sources.push({ title: source.title, url: allowed.get(key) });
  }
  return { ...doc, sources };
}

export const researchAgent = {
  outputSchema: BriefDoc,
  system:
    'You are the Research Agent of a short-form video studio. You turn web search results into a ' +
    'factual research brief for a video. Cite only URLs that appear in the web_search tool result.',
  tools: [
    {
      name: 'web_search',
      run: (input) => getWebSearch().search(searchQuery(input), { limit: SEARCH_LIMIT }),
    },
  ],
  instructions: (input) =>
    [
      input.idea
        ? `Research this video idea: "${input.idea.title}" (angle: ${input.idea.angle}; format: ${input.idea.format}).`
        : `Research this topic: "${input.topic}".`,
      'Summarize what a creator needs to know, list key points and current trends, and cite sources.',
      'sources[] may only contain URLs copied exactly from the web_search results below.',
    ].join('\n'),
  refine(output, { toolResults }) {
    const results = toolResults.web_search?.results ?? [];
    const restricted = restrictSources(output, results);
    if (results.length && !restricted.sources.length) {
      throw new AgentOutputError(
        'sources[] cited no URL from the web_search results. Cite only URLs listed in those search results.',
      );
    }
    return restricted;
  },
  async persist(client, { output, input, runId, projectId, userId }) {
    const row = await repo.insertBrief(client, {
      projectId,
      userId,
      runId,
      planId: input.planId,
      ideaIndex: input.ideaIndex,
      topic: input.topic,
      input,
      doc: output,
    });
    return { type: 'brief', id: row.id };
  },
};

// requestResearch(projectId, userId, body) -> queued AgentRun.
// A planId must belong to the project (404 otherwise); ideaIndex must exist (400).
export async function requestResearch(projectId, userId, body) {
  const parsed = ResearchBody.parse(body);
  let input;
  if ('planId' in parsed) {
    const plan = await getPlan(projectId, parsed.planId);
    const idea = plan.doc.ideas[parsed.ideaIndex];
    if (!idea) throw badRequest(`ideaIndex ${parsed.ideaIndex} is out of range: the plan has ${plan.doc.ideas.length} ideas`);
    input = { topic: idea.title, planId: plan.id, ideaIndex: parsed.ideaIndex, idea };
  } else {
    input = { topic: parsed.topic };
  }
  return startRun({ agent: 'research', projectId, userId, input: ResearchInput.parse(input) });
}

export async function listBriefs(projectId) {
  return (await repo.listBriefs(projectId)).map(toBrief);
}

// getBrief(projectId, briefId) -> Brief. Missing, malformed or another project's id -> 404.
export async function getBrief(projectId, briefId) {
  const row = isUuid(projectId) && isUuid(briefId) ? await repo.findBrief(projectId, briefId) : null;
  if (!row) throw notFound('Brief not found');
  return toBrief(row);
}

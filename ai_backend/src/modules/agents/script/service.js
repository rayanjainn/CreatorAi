// agents/script service: the Script Agent (hooks, script, CTA, shots and B-roll).
// Public API: scriptAgent (definition for the agent.run worker), requestScript,
// listScripts, getScript, updateScript.
import { withTransaction } from '../../../db/pool.js';
import { notFound } from '../../../lib/errors.js';
import { getBrief } from '../research/service.js';
import { isUuid, startRun } from '../service.js';
import * as repo from './repo.js';
import { Script, ScriptBody, ScriptDoc, ScriptInput, ScriptPatch } from './schemas.js';

const iso = (v) => (v == null ? null : new Date(v).toISOString());

const toScript = (row) =>
  Script.parse({
    id: row.id,
    projectId: row.project_id,
    createdBy: row.created_by ?? null,
    runId: row.run_id ?? null,
    briefId: row.brief_id,
    input: row.input,
    doc: row.doc,
    editedBy: row.edited_by ?? null,
    editedAt: iso(row.edited_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });

export const scriptAgent = {
  outputSchema: ScriptDoc,
  system:
    'You are the Script Agent of a short-form video studio. You write tight, spoken scripts with ' +
    'scroll-stopping hooks, a clear call to action, a shot list and B-roll suggestions.',
  instructions: (input) =>
    [
      `Write a video script for the idea "${input.idea.title}"` +
        (input.idea.angle ? ` (angle: ${input.idea.angle}).` : '.'),
      'Base every claim on the research brief in the input; do not invent facts.',
      input.targetSeconds ? `Target length: about ${input.targetSeconds} seconds in total (sum of estSeconds).` : '',
      input.tone ? `Tone: ${input.tone}.` : '',
      input.notes ? `Creator notes: ${input.notes}` : '',
      'hooks: alternative opening lines. script: ordered sections with spoken text and estSeconds. ' +
        'shots and broll: { section, description } cues tied to script sections.',
    ]
      .filter(Boolean)
      .join('\n'),
  async persist(client, { output, input, runId, projectId, userId }) {
    const row = await repo.insertScript(client, { projectId, userId, runId, briefId: input.briefId, input, doc: output });
    return { type: 'script', id: row.id };
  },
};

// requestScript(projectId, userId, body) -> queued AgentRun. The brief must belong to the
// project (404 otherwise); its doc and idea are snapshotted into the run input.
export async function requestScript(projectId, userId, body) {
  const { briefId, ...options } = ScriptBody.parse(body);
  const brief = await getBrief(projectId, briefId);
  const input = ScriptInput.parse({
    briefId: brief.id,
    topic: brief.topic,
    idea: brief.input.idea ?? { title: brief.topic },
    brief: brief.doc,
    ...options,
  });
  return startRun({ agent: 'script', projectId, userId, input });
}

export async function listScripts(projectId) {
  return (await repo.listScripts(projectId)).map(toScript);
}

// getScript(projectId, scriptId) -> Script. Missing, malformed or another project's id -> 404.
export async function getScript(projectId, scriptId) {
  const row = isUuid(projectId) && isUuid(scriptId) ? await repo.findScript(projectId, scriptId) : null;
  if (!row) throw notFound('Script not found');
  return toScript(row);
}

// updateScript(projectId, scriptId, userId, patch) -> Script. Human edit: the patch is
// merged into the current doc and the result must be a valid ScriptDoc (else 400).
export async function updateScript(projectId, scriptId, userId, patch) {
  const fields = ScriptPatch.parse(patch);
  if (!isUuid(projectId) || !isUuid(scriptId)) throw notFound('Script not found');
  const row = await withTransaction(async (client) => {
    const current = await repo.findScript(projectId, scriptId, client, { forUpdate: true });
    if (!current) throw notFound('Script not found');
    const doc = ScriptDoc.parse({ ...current.doc, ...fields });
    return repo.updateScriptDoc(client, scriptId, { doc, userId });
  });
  return toScript(row);
}

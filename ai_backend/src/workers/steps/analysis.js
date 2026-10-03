// P3 pipeline step: video analysis: LLM caption per keyframe -> scenes.caption, plus one asset_analysis row (needs scenes).
// Contract shared by every step (owned by the P3 orchestrator, implemented per step):
//   run({ assetId, projectId }) -> plain JSON object (stored as the step output).
// - Idempotent: a re-run replaces this step's own rows, never duplicates them.
// - Throws to fail the step (retried); throws NonRetryableError (src/lib/errors.js) when
//   retrying cannot help.
// - Reads earlier steps' results from the database, never from the caller.
//
// Keyframes are captioned CAPTION_BATCH images per vision call (VISION_MODEL), then one
// text call (LLM_MODEL) summarises the captions and the transcript. Every reply is
// Zod-validated; an invalid reply is retried once with the problem quoted, a second
// invalid reply fails the step. Nothing is written until every call has succeeded.
import { z } from 'zod';
import { getEnv } from '../../config/env.js';
import { getLlm } from '../../adapters/llm/index.js';
import { query, withTransaction } from '../../db/pool.js';
import { listAssets } from '../../modules/media/service.js';
import { loadAsset, loadScenes } from './lib/scenes-shared.js';

export const CAPTION_BATCH = 4;
const TRANSCRIPT_CHARS = 6000;

const captionsReply = (n) =>
  z.object({ captions: z.array(z.string().trim().min(1).max(500)).length(n) });

export const SummaryReply = z.object({
  summary: z.string().trim().min(1).max(2000),
  topics: z.array(z.string().trim().min(1).max(80)).max(12),
});

const CAPTION_SYSTEM =
  'You describe video keyframes for a search index. Be concrete: people, objects, setting, on-screen text, action. ' +
  'Reply with JSON only.';
const SUMMARY_SYSTEM = 'You summarise videos for a search index. Reply with JSON only.';

function issueText(err) {
  if (err instanceof z.ZodError) return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  return err.message;
}

// One LLM call whose JSON must match `schema`; one retry on invalid JSON / schema failure.
async function completeValidated(request, schema, what) {
  const llm = getLlm();
  let prompt = request.prompt;
  let lastProblem;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { json } = await llm.completeJson({ ...request, prompt });
      return schema.parse(json);
    } catch (err) {
      if (err?.code !== 'invalid_json' && !(err instanceof z.ZodError)) throw err;
      lastProblem = issueText(err);
      prompt = `${request.prompt}\n\nYour previous reply was invalid (${lastProblem}). Reply again with only the JSON object described above.`;
    }
  }
  throw new Error(`analysis: ${what} output invalid twice: ${lastProblem}`);
}

async function captionBatch(urls) {
  const prompt =
    `You are given ${urls.length} keyframe image(s) from one video, in order. ` +
    `Write one short caption (max 25 words) per image, in the same order. ` +
    `Reply as {"captions": [${urls.length} strings]}.`;
  const reply = await completeValidated(
    { system: CAPTION_SYSTEM, prompt, model: getEnv().VISION_MODEL, images: urls, temperature: 0.2 },
    captionsReply(urls.length),
    'caption',
  );
  return reply.captions;
}

async function transcriptText(assetId) {
  const { rows } = await query('SELECT text FROM transcript_segments WHERE asset_id = $1 ORDER BY start_ms', [assetId]);
  return rows.map((r) => r.text.trim()).filter(Boolean).join(' ').slice(0, TRANSCRIPT_CHARS);
}

async function summarise(captioned, transcript) {
  const lines = captioned.map((s) => `- [${(s.startMs / 1000).toFixed(1)}s-${(s.endMs / 1000).toFixed(1)}s] ${s.caption}`);
  const prompt = [
    'Summarise this video in 2-4 sentences and list up to 8 short topics.',
    'Reply as {"summary": string, "topics": [string, ...]}.',
    '',
    'Scene captions:',
    lines.length ? lines.join('\n') : '(none)',
    '',
    'Transcript:',
    transcript || '(none)',
  ].join('\n');
  return completeValidated({ system: SUMMARY_SYSTEM, prompt, model: getEnv().LLM_MODEL, temperature: 0.2 }, SummaryReply, 'summary');
}

export async function run({ assetId, projectId }) {
  await loadAsset(projectId, assetId);
  const scenes = await loadScenes(assetId);
  const keyframes = new Map(
    (await listAssets(projectId, { kind: 'keyframe', parentAssetId: assetId })).map((k) => [k.id, k]),
  );
  const withImage = scenes
    .map((s) => ({ ...s, url: s.keyframeAssetId ? keyframes.get(s.keyframeAssetId)?.url : null }))
    .filter((s) => s.url);

  const captions = new Map();
  for (let i = 0; i < withImage.length; i += CAPTION_BATCH) {
    const batch = withImage.slice(i, i + CAPTION_BATCH);
    const texts = await captionBatch(batch.map((s) => s.url));
    batch.forEach((s, j) => captions.set(s.id, texts[j]));
  }

  const transcript = await transcriptText(assetId);
  const captioned = scenes.filter((s) => captions.has(s.id)).map((s) => ({ ...s, caption: captions.get(s.id) }));
  const analysis =
    captioned.length || transcript ? await summarise(captioned, transcript) : { summary: 'No visual or spoken content to analyse.', topics: [] };

  await withTransaction(async (client) => {
    for (const s of scenes) {
      await client.query('UPDATE scenes SET caption = $2 WHERE id = $1', [s.id, captions.get(s.id) ?? null]);
    }
    await client.query(
      `INSERT INTO asset_analysis (asset_id, summary, topics, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (asset_id) DO UPDATE SET summary = EXCLUDED.summary, topics = EXCLUDED.topics, updated_at = now()`,
      [assetId, analysis.summary, JSON.stringify(analysis.topics)],
    );
  });

  return { captions: captions.size, topics: analysis.topics.length };
}

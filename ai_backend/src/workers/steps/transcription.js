// P3 pipeline step: transcription. The asset's audio-only URL (mono, 16 kHz, from the
// storage adapter) goes to the transcription adapter; the result becomes one ordered,
// non-overlapping list of transcript_segments within the asset duration.
// Step contract: see src/workers/process.js (idempotent: delete-then-insert; throws to fail).
import { getStorage } from '../../adapters/storage/index.js';
import { getTranscription } from '../../adapters/transcription/index.js';
import { normalizeTranscript } from '../../adapters/transcription/contract.js';
import { withTransaction } from '../../db/pool.js';
import { NonRetryableError } from '../../lib/errors.js';
import { getAsset } from '../../modules/media/service.js';

export async function run({ assetId, projectId }) {
  const asset = await getAsset(projectId, assetId);
  if (asset.kind !== 'original') throw new NonRetryableError(`asset ${assetId} is not an original`);

  const url = getStorage().audioUrl(asset.publicId);
  const raw = await getTranscription().transcribe({ url, ...(asset.durationMs ? { durationMs: asset.durationMs } : {}) });
  const { language, segments } = normalizeTranscript(raw, { durationMs: asset.durationMs });

  await withTransaction(async (client) => {
    await client.query('DELETE FROM transcript_segments WHERE asset_id = $1', [assetId]);
    if (!segments.length) return;
    await client.query(
      `INSERT INTO transcript_segments (asset_id, start_ms, end_ms, text, speaker)
       SELECT $1, s.start_ms, s.end_ms, s.text, s.speaker
       FROM unnest($2::int[], $3::int[], $4::text[], $5::text[]) AS s(start_ms, end_ms, text, speaker)`,
      [
        assetId,
        segments.map((s) => s.startMs),
        segments.map((s) => s.endMs),
        segments.map((s) => s.text),
        segments.map((s) => s.speaker ?? null),
      ],
    );
  });
  return { language, segments: segments.length };
}

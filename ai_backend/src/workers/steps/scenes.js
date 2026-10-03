// P3 pipeline step: scene detection + keyframes: writes scenes rows (contiguous, covering the full duration) and one keyframe asset per scene via media createDerivedAsset.
// Contract shared by every step (owned by the P3 orchestrator, implemented per step):
//   run({ assetId, projectId }) -> plain JSON object (stored as the step output).
// - Idempotent: a re-run replaces this step's own rows, never duplicates them.
// - Throws to fail the step (retried); throws NonRetryableError (src/lib/errors.js) when
//   retrying cannot help.
// - Reads earlier steps' results from the database, never from the caller.
export async function run({ assetId, projectId }) {
  throw new Error(`step "scenes" not implemented yet (asset ${assetId}, project ${projectId})`);
}

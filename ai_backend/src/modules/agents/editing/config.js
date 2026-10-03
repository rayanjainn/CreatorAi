// agents/editing config: scoring weights, windowing and candidate limits, reel tolerance.
// Defaults below; configureEditing() overrides them (tests, tuning), resetEditing()
// restores them. Weights are stored with every moment, so a score can be explained later.

const DEFAULTS = Object.freeze({
  // score = sum(w_k * s_k) / sum(w_k), sub-scores 0-1 from the LLM.
  weights: Object.freeze({ hook: 0.35, selfContained: 0.3, energy: 0.15, topicMatch: 0.2 }),
  // Transcript windows: grown segment by segment towards targetMs (never past maxMs),
  // one window per strideMs of start time; edges snap to a scene cut within snapMs.
  window: Object.freeze({ minMs: 15_000, targetMs: 30_000, maxMs: 60_000, strideMs: 10_000, snapMs: 1_500 }),
  // Candidates: top-k by score, minMs-maxMs long, non-overlapping.
  candidates: Object.freeze({ k: 5, minMs: 15_000, maxMs: 60_000 }),
  // Windows labelled per LLM call.
  labelBatch: 12,
  // A reel's kept duration must be within targetSeconds * (1 +/- reelTolerance).
  reelTolerance: 0.2,
  output: Object.freeze({ width: 1080, height: 1920, fps: 30 }),
});

let current = DEFAULTS;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function merge(base, overrides) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? { ...base[key], ...value } : value;
  }
  return out;
}

export function getEditingConfig() {
  return current;
}

// configureEditing({ weights?, window?, candidates?, labelBatch?, reelTolerance?, output? }):
// nested objects are merged key by key into the current config.
export function configureEditing(overrides = {}) {
  current = merge(current, overrides);
}

export function resetEditing() {
  current = DEFAULTS;
}

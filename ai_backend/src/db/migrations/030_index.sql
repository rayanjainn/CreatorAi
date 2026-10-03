-- Phase 3: the per-asset index read by moments (P6). Committed by the orchestrator before
-- P6/P7 run in parallel with P3 still pending: these two tables and media/service.js
-- getAssetIndex() are the contract. P3 adds faces, asset_analysis, processing_jobs and
-- the vector indexes in 031-039.

CREATE TABLE IF NOT EXISTS transcript_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  start_ms integer NOT NULL CHECK (start_ms >= 0),
  end_ms integer NOT NULL,
  text text NOT NULL,
  speaker text,
  embedding {{VECTOR}},
  CHECK (end_ms > start_ms)
);

CREATE INDEX IF NOT EXISTS transcript_segments_asset_idx ON transcript_segments (asset_id, start_ms);

CREATE TABLE IF NOT EXISTS scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  idx integer NOT NULL CHECK (idx >= 0),
  start_ms integer NOT NULL CHECK (start_ms >= 0),
  end_ms integer NOT NULL,
  keyframe_asset_id uuid REFERENCES assets (id) ON DELETE SET NULL,
  caption text,
  embedding {{VECTOR}},
  CHECK (end_ms > start_ms),
  UNIQUE (asset_id, idx)
);

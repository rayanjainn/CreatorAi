-- Phase 3: outputs of the faces and analysis steps. Committed by the orchestrator before
-- the two P3 tracks run in parallel (contract: written by workers/faces.js and
-- workers/analysis.js, read by the index endpoint).

CREATE TABLE IF NOT EXISTS faces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  scene_id uuid REFERENCES scenes (id) ON DELETE CASCADE,
  at_ms integer NOT NULL CHECK (at_ms >= 0),
  -- { x, y, width, height } in pixels of the keyframe
  bbox jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS faces_asset_idx ON faces (asset_id, at_ms);

CREATE TABLE IF NOT EXISTS asset_analysis (
  asset_id uuid PRIMARY KEY REFERENCES assets (id) ON DELETE CASCADE,
  summary text NOT NULL,
  topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

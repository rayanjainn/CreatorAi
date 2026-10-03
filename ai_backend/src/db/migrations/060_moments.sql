-- Phase 6: semantic moments of an indexed asset. Each generation replaces the asset's
-- rows. scores holds the LLM sub-scores (hook, selfContained, energy, topicMatch, each
-- 0-1) and the weights used, so `score` can be explained; status 'candidate' marks the
-- top-K non-overlapping moments chosen for reels, 'scored' the rest.

CREATE TABLE IF NOT EXISTS moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  start_ms integer NOT NULL CHECK (start_ms >= 0),
  end_ms integer NOT NULL,
  title text NOT NULL,
  hook_line text NOT NULL,
  summary text NOT NULL DEFAULT '',
  scores jsonb NOT NULL,
  score double precision NOT NULL CHECK (score >= 0 AND score <= 1),
  status text NOT NULL DEFAULT 'scored' CHECK (status IN ('scored', 'candidate')),
  job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_ms > start_ms)
);

CREATE INDEX IF NOT EXISTS moments_asset_idx ON moments (asset_id, start_ms);

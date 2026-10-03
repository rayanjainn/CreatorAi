-- Phase 2: media assets. Originals and derived assets (proxy, keyframe, audio, render)
-- live in one table; derived rows point at their original through parent_asset_id.
-- Committed by the orchestrator before P2/P5 run in parallel: this table and
-- media/service.js getAssetsByIds() are the contract the timeline validator relies on.

CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('original', 'proxy', 'keyframe', 'audio', 'render')),
  parent_asset_id uuid REFERENCES assets (id) ON DELETE CASCADE,
  cloudinary_public_id text NOT NULL,
  url text,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  width integer,
  height integer,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploaded', 'processing', 'indexed', 'failed')),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS assets_project_public_id_key ON assets (project_id, cloudinary_public_id);
CREATE INDEX IF NOT EXISTS assets_project_id_idx ON assets (project_id);
CREATE INDEX IF NOT EXISTS assets_parent_asset_id_idx ON assets (parent_asset_id);

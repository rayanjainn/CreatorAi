-- Phase 3: per-asset processing state, one row per (asset, pipeline step). Written by the
-- orchestrator (src/workers/process.js), read by GET /media/:assetId/index.
-- run_id identifies one pipeline run: media.process (and reprocess) start a new run, and a
-- step job carrying an older run_id is skipped. job_id is the pg-boss job currently
-- scheduled for the step (null = not scheduled yet).

CREATE TABLE IF NOT EXISTS processing_jobs (
  asset_id uuid NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  step text NOT NULL CHECK (step IN ('transcription', 'scenes', 'faces', 'analysis', 'embeddings')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  error text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  run_id uuid NOT NULL,
  job_id uuid,
  output jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, step)
);

-- Search: one row per scene / segment is scanned per project; the scenes table only had
-- the (asset_id, idx) unique index.
CREATE INDEX IF NOT EXISTS scenes_asset_start_idx ON scenes (asset_id, start_ms);

-- @if pgvector
-- HNSW cosine indexes for the vector columns (pgvector only; the array backend scans).
CREATE INDEX IF NOT EXISTS transcript_segments_embedding_hnsw
  ON transcript_segments USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS scenes_embedding_hnsw
  ON scenes USING hnsw (embedding vector_cosine_ops);
-- @endif

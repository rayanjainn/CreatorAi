-- Phase 6: one row per moments / reels / revise request. The API inserts it 'queued' and
-- answers 202 { jobId }; the worker runs it and records the result (moment counts,
-- timeline ids, new version) or the error. The LLM calls themselves are agent_runs rows,
-- listed in run_ids.

CREATE TABLE IF NOT EXISTS editing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('moments', 'reels', 'revise')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  asset_id uuid REFERENCES assets (id) ON DELETE CASCADE,
  timeline_id uuid REFERENCES timelines (id) ON DELETE CASCADE,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error jsonb,
  run_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS editing_jobs_project_created_idx ON editing_jobs (project_id, created_at DESC);

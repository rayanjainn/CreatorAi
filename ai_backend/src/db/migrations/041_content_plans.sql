-- Phase 4: Director Agent output. One row per succeeded director run.

CREATE TABLE IF NOT EXISTS content_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  run_id uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_plans_project_created_idx ON content_plans (project_id, created_at DESC);

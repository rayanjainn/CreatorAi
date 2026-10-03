-- Phase 4: Script Agent output, written from one research brief. Humans edit the doc
-- afterwards (PATCH), which records edited_by / edited_at.

CREATE TABLE IF NOT EXISTS scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  run_id uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
  brief_id uuid NOT NULL REFERENCES research_briefs (id) ON DELETE CASCADE,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  doc jsonb NOT NULL,
  edited_by uuid REFERENCES users (id) ON DELETE SET NULL,
  edited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scripts_project_created_idx ON scripts (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scripts_brief_id_idx ON scripts (brief_id);

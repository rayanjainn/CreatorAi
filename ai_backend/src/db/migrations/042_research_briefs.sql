-- Phase 4: Research Agent output. A brief researches either a free topic or one idea
-- of a content plan (plan_id + idea_index).

CREATE TABLE IF NOT EXISTS research_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  run_id uuid REFERENCES agent_runs (id) ON DELETE SET NULL,
  plan_id uuid REFERENCES content_plans (id) ON DELETE SET NULL,
  idea_index integer CHECK (idea_index IS NULL OR idea_index >= 0),
  topic text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS research_briefs_project_created_idx ON research_briefs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_briefs_plan_id_idx ON research_briefs (plan_id);

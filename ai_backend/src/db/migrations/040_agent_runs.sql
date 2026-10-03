-- Phase 4: one row per agent call (Director, Research, Script, ...). The API creates the
-- run 'queued', the worker flips it to 'running' and finishes it as 'succeeded' (output
-- plus the artifact it produced) or 'failed' (error, no artifact).

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  agent text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  tool_results jsonb,
  artifact_type text,
  artifact_id text,
  error jsonb,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  tokens_in integer NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out integer NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  ms integer CHECK (ms IS NULL OR ms >= 0),
  provider text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_runs_project_created_idx ON agent_runs (project_id, created_at DESC);

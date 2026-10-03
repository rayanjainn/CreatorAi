-- Phase 5: versioned Timeline JSON. A timeline is a pointer (head_version) to the newest
-- row of its append-only version history. Every save inserts version head + 1 and moves
-- the pointer in the same transaction (see timeline/repo.js).

CREATE TABLE IF NOT EXISTS timelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title text NOT NULL,
  source_asset_id uuid REFERENCES assets (id) ON DELETE SET NULL,
  head_version integer NOT NULL DEFAULT 0 CHECK (head_version >= 0),
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS timelines_project_id_idx ON timelines (project_id);

-- author_id and agent_run_id have no foreign keys on purpose: a version is an audit
-- record, and ON DELETE SET NULL would be an UPDATE, which the trigger below refuses.
-- (agent_runs also belongs to phase 4.) Versions are strictly sequential, so the parent
-- of version n is always n - 1; v1 has none.
CREATE TABLE IF NOT EXISTS timeline_versions (
  timeline_id uuid NOT NULL REFERENCES timelines (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  parent_version integer,
  author_type text NOT NULL CHECK (author_type IN ('ai', 'human')),
  author_id uuid,
  agent_run_id uuid,
  summary text NOT NULL DEFAULT '',
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (timeline_id, version),
  CHECK ((version = 1 AND parent_version IS NULL) OR parent_version = version - 1),
  CHECK (author_type = 'ai' OR author_id IS NOT NULL)
);

-- Append-only guard. UPDATE is always refused. DELETE is refused unless the parent
-- timeline is already gone, which is exactly the ON DELETE CASCADE path (deleting a
-- timeline, or its project): the RI cascade runs after the parent row is deleted, so the
-- parent is no longer visible here. Deleting a whole timeline therefore still works;
-- deleting or editing individual versions does not. TRUNCATE (test resets) has no
-- row-level triggers and is unaffected.
CREATE OR REPLACE FUNCTION timeline_versions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM timelines WHERE id = OLD.timeline_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'timeline_versions is append-only: % refused', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS timeline_versions_append_only ON timeline_versions;
CREATE TRIGGER timeline_versions_append_only
  BEFORE UPDATE OR DELETE ON timeline_versions
  FOR EACH ROW EXECUTE FUNCTION timeline_versions_append_only();

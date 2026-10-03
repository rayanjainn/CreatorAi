-- Phase 7: renders. A render is pinned to one timeline version and kind; the worker
-- (src/workers/render.js) moves it queued -> rendering -> done | failed and records the
-- uploaded MP4 as an assets row of kind 'render'.

CREATE TABLE IF NOT EXISTS renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  timeline_id uuid NOT NULL REFERENCES timelines (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  kind text NOT NULL CHECK (kind IN ('preview', 'final')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'rendering', 'done', 'failed')),
  progress double precision NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  output_asset_id uuid REFERENCES assets (id) ON DELETE SET NULL,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  requested_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS renders_timeline_idx ON renders (timeline_id, created_at DESC);

-- At most one live (queued, rendering or done) render per { timeline, version, kind }:
-- asking again returns it (idempotent, race-safe through ON CONFLICT). A failed render
-- leaves the slot free, so the same request can be retried.
CREATE UNIQUE INDEX IF NOT EXISTS renders_live_key ON renders (timeline_id, version, kind)
  WHERE status <> 'failed';

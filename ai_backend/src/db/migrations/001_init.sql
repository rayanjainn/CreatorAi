-- Phase 0 baseline. Migration numbers are reserved per phase:
-- P0 001-009, P1 010-019, P2 020-029, P3 030-039, P4 040-049,
-- P5 050-059, P6 060-069, P7 070-079, P8 080-089.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- @if pgvector
CREATE EXTENSION IF NOT EXISTS vector;
-- @endif

-- @if array
-- Cosine distance over float8[] for installs without pgvector. Same meaning as
-- pgvector's <=> operator: 0 = same direction, 2 = opposite.
CREATE OR REPLACE FUNCTION cosine_distance(a float8[], b float8[])
RETURNS float8
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT 1 - SUM(x * y) / NULLIF(SQRT(SUM(x * x)) * SQRT(SUM(y * y)), 0)
  FROM unnest(a, b) AS t(x, y)
$$;
-- @endif

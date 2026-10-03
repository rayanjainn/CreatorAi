-- 001_init.sql: CreatorAi schema (Plan.md section 5 translated for SQLite per docs/LOCAL_FIRST.md)
--
-- Conventions:
--   * ids are TEXT (uuid4 strings generated in Python)
--   * jsonb / text[] / int[] are TEXT holding JSON (json_valid CHECKs where the column is JSON)
--   * timestamps are TEXT ISO-8601 UTC ("2026-10-03T12:00:00Z"); updated_at is maintained by
--     SQLAlchemy onupdate (no triggers)
--   * embeddings are BLOBs of little-endian float32 (L2-normalised, 384-d)
--   * booleans are INTEGER 0/1

create table if not exists schema_migrations (
  name text primary key,
  applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ───────── users, workspace and profile ─────────
create table users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

create table workspaces (
  id text primary key,
  owner_id text not null unique references users(id) on delete cascade,
  name text not null default 'My Channel',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

create table creator_profiles (
  workspace_id text primary key references workspaces(id) on delete cascade,
  display_name text not null,
  domain text not null check (domain in ('education','technology','entertainment','lifestyle','business')),
  audience text not null default '',
  tone text not null default 'conversational',
  language text not null default 'en',
  platforms text not null default '["youtube_shorts"]' check (json_valid(platforms)),
  style_profile text not null default '{}' check (json_valid(style_profile)),
  style_profile_rev integer not null default 0,
  approvals_since_style_update integer not null default 0,
  onboarding_done integer not null default 0 check (onboarding_done in (0,1)),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

create table youtube_connections (
  workspace_id text primary key references workspaces(id) on delete cascade,
  channel_id text not null,
  channel_title text,
  refresh_token_enc text not null,
  scopes text not null check (json_valid(scopes)),
  status text not null default 'active' check (status in ('active','expired','revoked')),
  connected_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_sync_at text
);

-- ───────── board and planning ─────────
create table content_items (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  title text not null,
  idea_text text not null default '',
  objective text not null default '',
  domain text check (domain in ('education','technology','entertainment','lifestyle','business')),
  stage text not null default 'idea'
    check (stage in ('idea','script','shoot','edit','review','published')),
  position integer not null default 0,
  target_duration_sec integer,
  published_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
create index idx_content_items_ws_stage on content_items (workspace_id, stage, position);

create table idea_suggestions (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  title text not null,
  rationale text not null default '',
  source text not null check (source in ('insights','twin')),
  status text not null default 'suggested' check (status in ('suggested','accepted','dismissed')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
create index idx_idea_suggestions_ws_status on idea_suggestions (workspace_id, status);

create table director_outputs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  content_item_id text not null references content_items(id) on delete cascade,
  kind text not null check (kind in ('plan','review')),
  version integer not null default 1,
  payload text not null check (json_valid(payload)),
  metrics text not null default '{}' check (json_valid(metrics)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
create index idx_director_outputs_item on director_outputs (content_item_id, kind, version desc);

-- ───────── scripts ─────────
create table scripts (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  content_item_id text not null references content_items(id) on delete cascade,
  version integer not null default 1,
  is_current integer not null default 1 check (is_current in (0,1)),
  hook_options text not null default '[]' check (json_valid(hook_options)),
  selected_hook text not null default '',
  body_md text not null default '',
  scenes text not null default '[]' check (json_valid(scenes)),
  meta text not null default '{}' check (json_valid(meta)),
  tone text, platform text, length_sec integer,
  provider text, model text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
create unique index scripts_one_current on scripts (content_item_id) where is_current = 1;

create table script_beats (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  script_id text not null references scripts(id) on delete cascade,
  scene_idx integer not null,
  beat_idx integer not null,
  text text not null,
  intent text not null default '',
  est_sec real not null default 5,
  embedding blob,
  unique (script_id, scene_idx, beat_idx)
);

-- ───────── assets ─────────
create table uploads (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  content_item_id text references content_items(id) on delete set null,
  filename text not null,
  mime text not null,
  size_bytes integer not null,
  chunk_size integer not null,
  total_chunks integer not null,
  received_chunks text not null default '[]' check (json_valid(received_chunks)),
  status text not null default 'uploading' check (status in ('uploading','completed','aborted')),
  asset_id text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

create table assets (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  content_item_id text references content_items(id) on delete set null,
  kind text not null check (kind in ('video','image','audio','document')),
  filename text not null,
  storage_key text not null,
  proxy_key text, thumb_key text, audio_key text,
  mime text not null,
  size_bytes integer not null,
  sha256 text not null,
  duration_sec real,
  width integer, height integer, fps real,
  status text not null default 'uploaded'
    check (status in ('uploaded','processing','ready','failed')),
  error text,
  description text not null default '',
  tags text not null default '[]' check (json_valid(tags)),
  folder text not null default '/',
  analysis text not null default '{}' check (json_valid(analysis)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  unique (workspace_id, sha256)
);
create index idx_assets_ws_kind on assets (workspace_id, kind, created_at desc);
create index idx_assets_content_item on assets (content_item_id);

create table asset_segments (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  asset_id text not null references assets(id) on delete cascade,
  idx integer not null,
  start_sec real not null,
  end_sec real not null,
  text text not null,
  words text not null default '[]' check (json_valid(words)),
  embedding blob,
  unique (asset_id, idx)
);
create index idx_asset_segments_ws on asset_segments (workspace_id, asset_id);

-- Full-text search over transcript text (external-content FTS5, kept in sync by triggers).
-- If the table is ever VACUUMed, run: insert into asset_segments_fts(asset_segments_fts) values('rebuild');
create virtual table asset_segments_fts using fts5(
  text, content='asset_segments', content_rowid='rowid', tokenize='unicode61'
);
create trigger asset_segments_ai after insert on asset_segments begin
  insert into asset_segments_fts(rowid, text) values (new.rowid, new.text);
end;
create trigger asset_segments_ad after delete on asset_segments begin
  insert into asset_segments_fts(asset_segments_fts, rowid, text) values ('delete', old.rowid, old.text);
end;
create trigger asset_segments_au after update of text on asset_segments begin
  insert into asset_segments_fts(asset_segments_fts, rowid, text) values ('delete', old.rowid, old.text);
  insert into asset_segments_fts(rowid, text) values (new.rowid, new.text);
end;

create table asset_shots (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  asset_id text not null references assets(id) on delete cascade,
  idx integer not null,
  start_sec real not null,
  end_sec real not null,
  keyframe_key text,
  caption text not null default '',
  tags text not null default '[]' check (json_valid(tags)),
  embedding blob,
  unique (asset_id, idx)
);
create index idx_asset_shots_ws on asset_shots (workspace_id, asset_id);

-- ───────── matching ─────────
create table beat_matches (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  content_item_id text not null references content_items(id) on delete cascade,
  script_beat_id text not null unique references script_beats(id) on delete cascade,
  asset_id text references assets(id) on delete set null,
  start_sec real, end_sec real,
  score real not null default 0,
  status text not null check (status in ('matched','weak','missing','confirmed','rejected')),
  alternatives text not null default '[]' check (json_valid(alternatives)),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
create index idx_beat_matches_item on beat_matches (workspace_id, content_item_id);

-- ───────── clips, edits, renders ─────────
create table clips (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  content_item_id text not null references content_items(id) on delete cascade,
  source_asset_id text not null references assets(id) on delete cascade,
  kind text not null default 'short' check (kind in ('short','full')),
  title text not null default '',
  hook text not null default '',
  caption text not null default '',
  reason text not null default '',
  score real not null default 0,
  features text not null default '{}' check (json_valid(features)),
  start_sec real not null,
  end_sec real not null,
  status text not null default 'suggested' check (status in ('suggested','accepted','rejected')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
create index idx_clips_item_status on clips (content_item_id, status);

create table edits (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  clip_id text not null unique references clips(id) on delete cascade,
  timeline text not null check (json_valid(timeline)),
  revision integer not null default 1,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

create table edit_revisions (
  id text primary key,
  edit_id text not null references edits(id) on delete cascade,
  revision integer not null,
  timeline text not null check (json_valid(timeline)),
  note text not null default '',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  unique (edit_id, revision)
);

create table renders (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  clip_id text not null references clips(id) on delete cascade,
  preset text not null check (preset in ('yt_short','reels','tiktok','yt_long')),
  edit_revision integer not null,
  status text not null default 'queued' check (status in ('queued','rendering','done','failed')),
  output_key text, thumb_key text,
  duration_sec real, size_bytes integer,
  error text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  finished_at text
);
create index idx_renders_clip on renders (clip_id, created_at desc);

-- ───────── sponsorship ─────────
create table sponsor_briefs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  content_item_id text not null references content_items(id) on delete cascade,
  brand text not null,
  product text not null,
  key_points text not null default '[]' check (json_valid(key_points)),
  cta text not null default '',
  do_not_say text not null default '[]' check (json_valid(do_not_say)),
  duration_sec integer not null default 20 check (duration_sec between 10 and 60),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

create table sponsor_slots (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  brief_id text not null references sponsor_briefs(id) on delete cascade,
  asset_id text not null references assets(id) on delete cascade,
  at_sec real not null,
  kind text not null check (kind in ('pause','topic_shift','both')),
  score real not null,
  rationale text not null default '',
  integration_script text not null default '',
  status text not null default 'suggested' check (status in ('suggested','accepted','rejected')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ───────── publishing and analytics ─────────
create table publish_jobs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  content_item_id text not null references content_items(id) on delete cascade,
  render_id text not null references renders(id) on delete restrict,
  platform text not null default 'youtube' check (platform = 'youtube'),
  title text not null,
  description text not null default '',
  tags text not null default '[]' check (json_valid(tags)),
  visibility text not null default 'private' check (visibility in ('private','unlisted','public')),
  scheduled_at text,
  status text not null default 'queued'
    check (status in ('queued','uploading','processing','scheduled','published','failed')),
  youtube_video_id text,
  error text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  published_at text
);

create table yt_videos (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  youtube_video_id text not null,
  content_item_id text references content_items(id) on delete set null,
  title text not null,
  published_at text,
  duration_sec integer,
  format text not null default 'short' check (format in ('short','long')),
  hook_text text not null default '',
  hook_type text not null default 'other'
    check (hook_type in ('question','number','bold_claim','story','other')),
  topic text not null default '',
  retention text check (retention is null or json_valid(retention)),
  is_seed integer not null default 0 check (is_seed in (0,1)),
  unique (workspace_id, youtube_video_id)
);

create table yt_metrics_daily (
  id text primary key,
  yt_video_id text not null references yt_videos(id) on delete cascade,
  day text not null,
  views integer not null default 0,
  watch_time_min real not null default 0,
  avg_view_duration_sec real not null default 0,
  avg_view_pct real not null default 0,
  likes integer not null default 0,
  comments integer not null default 0,
  subscribers_gained integer not null default 0,
  unique (yt_video_id, day)
);

create table insight_snapshots (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('summary','next_ideas')),
  range_days integer not null default 90,
  payload text not null check (json_valid(payload)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
create index idx_insight_snapshots_ws on insight_snapshots (workspace_id, kind, created_at desc);

-- ───────── digital twin ─────────
create table twin_memories (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('approved_script','approved_clip','preference','feedback')),
  text text not null,
  source_id text,
  embedding blob,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
create index idx_twin_memories_ws on twin_memories (workspace_id, kind);

create table twin_messages (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  actions text not null default '[]' check (json_valid(actions)),
  context text not null default '{}' check (json_valid(context)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
create index idx_twin_messages_ws on twin_messages (workspace_id, created_at desc);

-- ───────── jobs, llm, activity ─────────
create table jobs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  type text not null,
  entity_type text not null,
  entity_id text,
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','failed','canceled')),
  progress integer not null default 0 check (progress between 0 and 100),
  stage text not null default '',
  error text,
  result text not null default '{}' check (json_valid(result)),
  payload text not null default '{}' check (json_valid(payload)),
  attempts integer not null default 0,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  started_at text,
  finished_at text
);
create index idx_jobs_ws_status on jobs (workspace_id, status, created_at desc);
create index idx_jobs_entity on jobs (entity_type, entity_id);

create table llm_cache (
  key text primary key,
  task text not null,
  provider text not null,
  model text not null,
  response text not null check (json_valid(response)),
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

create table llm_usage (
  id integer primary key autoincrement,
  workspace_id text references workspaces(id) on delete cascade,
  task text not null,
  provider text not null,
  model text not null,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  latency_ms integer not null default 0,
  cache_hit integer not null default 0 check (cache_hit in (0,1)),
  status text not null default 'ok',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
create index idx_llm_usage_ws on llm_usage (workspace_id, created_at desc);

create table activity_log (
  id integer primary key autoincrement,
  workspace_id text not null references workspaces(id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id text,
  meta text not null default '{}' check (json_valid(meta)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
create index idx_activity_log_ws on activity_log (workspace_id, created_at desc);

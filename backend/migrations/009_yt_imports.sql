-- YouTube imports: a link (found by topic search or pasted) downloaded with yt-dlp into the library,
-- run through the normal ingest, then (optionally) Smart Clips. Status is advanced from the jobs.
create table yt_imports (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  content_item_id text references content_items(id) on delete set null,
  url text not null,
  video_id text not null,
  topic text,
  title text not null,
  channel text,
  duration_sec real,
  options text not null default '{}',
  status text not null default 'queued'
    check (status in ('queued','downloading','processing','clipping','done','failed')),
  job_id text,
  asset_id text references assets(id) on delete set null,
  clips_job_id text,
  transcript_source text,
  error text,
  error_code text,
  created_at text not null,
  updated_at text not null
);
create index yt_imports_ws_idx on yt_imports (workspace_id, created_at desc);
create index yt_imports_asset_idx on yt_imports (asset_id);

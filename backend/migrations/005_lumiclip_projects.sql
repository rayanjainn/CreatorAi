-- Clips cut by the optional LumiClip cloud clipper (https://lumiclip.ai) from a video URL or a library video.
-- One row per project we started; `clips` is the last response of the provider, `imported` maps a provider
-- clip id to the library asset it was saved as.
create table lumiclip_projects (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  content_item_id text references content_items(id) on delete set null,
  source_url text not null,
  source_asset_id text references assets(id) on delete set null,
  remote_id text not null,
  aspect_ratio text not null default '9:16' check (aspect_ratio in ('9:16','16:9')),
  options text not null default '{}' check (json_valid(options)),
  status text not null default 'processing',
  step text not null default '',
  message text,
  error text,
  error_category text,
  expected_clips integer,
  source_duration_sec real,
  clips text not null default '[]' check (json_valid(clips)),
  imported text not null default '{}' check (json_valid(imported)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
create index idx_lumiclip_ws on lumiclip_projects (workspace_id, created_at desc);
create unique index idx_lumiclip_remote on lumiclip_projects (workspace_id, remote_id);

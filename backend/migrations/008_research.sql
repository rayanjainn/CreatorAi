-- Research briefs: a topic, the web results it was built from, and the cited summary (provenance says which model wrote it).
create table research_briefs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  content_item_id text references content_items(id) on delete set null,
  topic text not null,
  doc text not null,
  results text not null,
  provenance text,
  created_at text not null
);
create index research_briefs_ws_idx on research_briefs (workspace_id, created_at desc);

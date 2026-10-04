-- Teams and collaboration: workspace members with roles, per-project role overrides, invite links,
-- comments, and who did what in the activity log.

alter table users add column display_name text;
update users set display_name = (
  select cp.display_name from creator_profiles cp
  join workspaces w on w.id = cp.workspace_id
  where w.owner_id = users.id
);

create table workspace_members (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null check (role in ('owner','admin','editor','viewer')),
  invited_by text references users(id) on delete set null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  primary key (workspace_id, user_id)
);
create index idx_wm_user on workspace_members (user_id);
-- every existing workspace owner becomes its owner member
insert into workspace_members (workspace_id, user_id, role)
  select id, owner_id, 'owner' from workspaces;

-- A project is a content item. A row here overrides the user's workspace role on that one project
-- (raise a viewer to editor for a single video, or make an editor read-only on one).
create table project_members (
  content_item_id text not null references content_items(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null check (role in ('editor','viewer')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  primary key (content_item_id, user_id)
);
create index idx_pm_user on project_members (user_id);

create table invites (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin','editor','viewer')),
  content_item_id text references content_items(id) on delete cascade,
  project_role text check (project_role in ('editor','viewer')),
  token text not null unique,
  invited_by text references users(id) on delete set null,
  expires_at text not null,
  accepted_at text,
  accepted_by text references users(id) on delete set null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
create index idx_invites_ws on invites (workspace_id, created_at desc);

create table comments (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  content_item_id text not null references content_items(id) on delete cascade,
  clip_id text references clips(id) on delete cascade,
  parent_id text references comments(id) on delete cascade,
  author_id text not null references users(id) on delete cascade,
  at_sec real,
  body text not null,
  resolved integer not null default 0 check (resolved in (0,1)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
create index idx_comments_item on comments (content_item_id, created_at);
create index idx_comments_clip on comments (clip_id, created_at);

alter table activity_log add column user_id text;

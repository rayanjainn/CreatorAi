-- Community: a feed shared by everyone on this server (across workspaces). A post is a copy of a
-- finished render (or a library video) with a title, a description and the platforms it is meant
-- for; others like it and comment on it (threads, one level of replies in the UI).
create table community_posts (
  id text primary key,
  author_id text not null references users(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade,
  render_id text references renders(id) on delete set null,
  asset_id text references assets(id) on delete set null,
  title text not null,
  body text not null default '',
  platforms text not null default '[]',
  tags text not null default '[]',
  video_key text not null,
  thumb_key text,
  duration_sec real,
  aspect text,
  created_at text not null,
  updated_at text not null
);
create index community_posts_created_idx on community_posts (created_at desc);
create index community_posts_author_idx on community_posts (author_id, created_at desc);

create table community_comments (
  id text primary key,
  post_id text not null references community_posts(id) on delete cascade,
  author_id text not null references users(id) on delete cascade,
  parent_id text references community_comments(id) on delete cascade,
  body text not null,
  created_at text not null,
  updated_at text not null
);
create index community_comments_post_idx on community_comments (post_id, created_at);

create table community_likes (
  post_id text not null references community_posts(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  created_at text not null,
  primary key (post_id, user_id)
);
create index community_likes_user_idx on community_likes (user_id);

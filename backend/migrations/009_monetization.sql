-- Brand deals: the creator's own sponsorship pipeline (every value is typed by the creator; nothing is estimated here).
create table brand_deals (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  content_item_id text references content_items(id) on delete set null,
  brand text not null,
  website text not null default '',
  contact_name text not null default '',
  contact_email text not null default '',
  stage text not null default 'prospect'
    check (stage in ('prospect','pitched','negotiating','contracted','delivered','paid','lost')),
  fee real check (fee is null or fee >= 0),
  currency text not null default 'USD',
  deliverables text not null default '',
  due_date text,
  notes text not null default '',
  pitch text check (pitch is null or json_valid(pitch)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
create index brand_deals_ws_idx on brand_deals (workspace_id, stage, updated_at desc);

-- Sponsor slot copy written with the slot (Plan 8.10 step 6) and where an accepted slot went.
alter table sponsor_slots add column lower_third text not null default '';
alter table sponsor_slots add column transition_back text not null default '';
alter table sponsor_slots add column provenance text check (provenance is null or json_valid(provenance));
alter table sponsor_slots add column clip_id text references clips(id) on delete set null;
alter table sponsor_briefs add column deal_id text references brand_deals(id) on delete set null;
create index sponsor_slots_brief_idx on sponsor_slots (brief_id, at_sec);

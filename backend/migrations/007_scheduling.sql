-- The day a content item is planned to go out (YYYY-MM-DD), set from the calendar. Not a publish: nothing is posted automatically.
alter table content_items add column scheduled_for text;

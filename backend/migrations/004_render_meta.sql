-- Renders remember the caption style they were rendered with and the job that produced them
-- (the UI polls /jobs/{job_id} for progress and uses it to reconnect after a reload).
alter table renders add column caption_style text;
alter table renders add column job_id text;

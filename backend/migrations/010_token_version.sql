-- Bumped when the password changes or every session is signed out; tokens carry it as "tv" and older ones stop working.
alter table users add column token_version integer not null default 0;

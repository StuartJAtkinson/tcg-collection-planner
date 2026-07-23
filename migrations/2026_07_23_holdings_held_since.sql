-- Held-since: when a slot entered the collection. Nullable so older imports that didn't track
-- a date aren't rejected; NULL means "since the dawn of time for this user". The /value
-- sparkline gates each day on held_since <= p.as_of so newly-acquired cards don't retroactively
-- inflate historical prices.
alter table holdings add column if not exists held_since date;

-- Backfill existing rows: set them to 30 days ago so the sparkline has a real 30-day history
-- to draw immediately after this migration lands on an active DB. New rows default to current_date.
update holdings set held_since = current_date - interval '30 days' where held_since is null;

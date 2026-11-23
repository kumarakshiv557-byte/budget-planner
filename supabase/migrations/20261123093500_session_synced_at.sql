-- Remember when each bank connection was first synced, so a new (or renewed) connection gets its
-- full ~90 days of history the first time, whatever the app asks for.
alter table public.eb_sessions add column if not exists synced_at timestamptz;
-- Connections already synced before this change.
update public.eb_sessions set synced_at = now() where synced_at is null and jsonb_array_length(accounts) > 0 and created_at < '2026-11-23 09:20:00+00';

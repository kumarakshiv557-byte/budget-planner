-- Household accounts: each bank connection belongs to someone ("me", "wife", …), so the app can tag
-- every synced line with whose account it came from.
alter table public.eb_auth_states add column if not exists owner text not null default 'me';
alter table public.eb_sessions add column if not exists owner text not null default 'me';
alter table public.eb_sessions add column if not exists bank text;

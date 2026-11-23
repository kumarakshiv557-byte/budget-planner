-- The household's whole budget (lines, sorting, budget items, income), so every device opens the same data.
-- One row; only the revolut-sync Edge Function (service role, behind the sync passphrase) reads or writes it.
create table if not exists public.app_state (
  id text primary key,
  data jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.app_state enable row level security;

-- Storage for the Revolut (Enable Banking) sync Edge Function.
-- Only the Edge Function (service role) touches these tables: RLS is on with no policies,
-- so the public anon key cannot read or write them.

create table if not exists public.eb_auth_states (
  state text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.eb_sessions (
  id bigint generated always as identity primary key,
  session_id text not null unique,
  accounts jsonb not null default '[]'::jsonb,
  valid_until timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.eb_auth_states enable row level security;
alter table public.eb_sessions enable row level security;

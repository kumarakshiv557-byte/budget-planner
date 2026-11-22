-- Devices subscribed to bill reminders (web push). Only the bill-reminders Edge Function (service role)
-- touches this table: RLS is on with no policies, so the public anon key cannot read or write it.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  bills jsonb not null default '[]'::jsonb,
  time_zone text not null default 'UTC',
  sent text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

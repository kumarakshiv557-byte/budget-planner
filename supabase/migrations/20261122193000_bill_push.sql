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

-- The push keys and the cron secret are kept in Vault; the Edge Function reads them through this,
-- and only the service role may call it.
create or replace function public.bill_push_secrets()
returns table (name text, secret text)
language sql
security definer
set search_path = ''
as $$
  select s.name, s.decrypted_secret from vault.decrypted_secrets s
  where s.name in ('bill_push_vapid_public', 'bill_push_vapid_private', 'bill_push_cron');
$$;
revoke all on function public.bill_push_secrets() from public, anon, authenticated;
grant execute on function public.bill_push_secrets() to service_role;

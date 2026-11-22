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

-- Lets the function save the push key pair it makes on first run (only if not already there).
create or replace function public.bill_push_store_secret(p_name text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_name not in ('bill_push_vapid_public', 'bill_push_vapid_private') then
    raise exception 'not allowed';
  end if;
  if not exists (select 1 from vault.secrets where name = p_name) then
    perform vault.create_secret(p_secret, p_name);
  end if;
end;
$$;
revoke all on function public.bill_push_store_secret(text, text) from public, anon, authenticated;
grant execute on function public.bill_push_store_secret(text, text) to service_role;

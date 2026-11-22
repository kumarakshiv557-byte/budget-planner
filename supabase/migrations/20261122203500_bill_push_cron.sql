create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- The cron secret is made once in SQL and kept in Vault (never typed anywhere):
--   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'bill_push_cron');

-- Every hour on the hour: the function sends reminders to devices where it is now 9:00.
select cron.schedule(
  'bill-reminders-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://lyfztzgubetxreowrylh.supabase.co/functions/v1/bill-reminders/cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'bill_push_cron')
    ),
    body := '{}'::jsonb
  );
  $$
);

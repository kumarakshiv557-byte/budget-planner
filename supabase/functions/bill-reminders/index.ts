// Push reminders for "Pay myself" bills.
//
// Routes (all under /functions/v1/bill-reminders), each needs `x-sync-secret: <SYNC_SECRET>`
// (the same passphrase as Revolut sync) except /cron, which needs `x-cron-secret` (the Vault cron secret):
//   GET  /key          → { publicKey } VAPID key the browser subscribes with
//   POST /subscribe    → { subscription, bills, timeZone } store or update this device
//   POST /unsubscribe  → { endpoint } forget this device
//   POST /test         → { endpoint } send a test notification now
//   POST /cron         → called hourly by pg_cron; sends reminders at 09:00 in each device's time zone
//
// Secrets: SYNC_SECRET (Edge Function secret, shared with revolut-sync). The push keys and the cron
// secret live in Supabase Vault (bill_push_vapid_public, bill_push_vapid_private, bill_push_cron) and are
// read through public.bill_push_secrets(), which only the service role may call. The key pair is made
// by this function on its first run; the cron secret is made in SQL and only pg_cron reads it.

import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import webpush from 'npm:web-push@3.6.7';

import { localNow, remindersFor, type PushBill } from './reminders.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

let secretsPromise: Promise<Record<string, string>> | null = null;
function vault() {
  secretsPromise ??= (async () => {
    const { data, error } = await db.rpc('bill_push_secrets');
    if (error) throw error;
    const s = Object.fromEntries(((data ?? []) as { name: string; secret: string }[]).map((r) => [r.name, r.secret]));
    if (!s.bill_push_vapid_public || !s.bill_push_vapid_private) {
      // First run: make the push key pair here and keep it in Vault, so it never leaves the server.
      const keys = webpush.generateVAPIDKeys();
      for (const [name, secret] of [['bill_push_vapid_public', keys.publicKey], ['bill_push_vapid_private', keys.privateKey]]) {
        const { error: e } = await db.rpc('bill_push_store_secret', { p_name: name, p_secret: secret });
        if (e) throw e;
      }
      // Read back what was stored, in case another request stored its pair first.
      const { data: again, error: e2 } = await db.rpc('bill_push_secrets');
      if (e2) throw e2;
      for (const r of (again ?? []) as { name: string; secret: string }[]) s[r.name] = r.secret;
    }
    webpush.setVapidDetails('https://kumarakshiv557-byte.github.io/budget-planner/', s.bill_push_vapid_public, s.bill_push_vapid_private);
    return s;
  })().catch((e) => {
    secretsPromise = null;
    throw e;
  });
  return secretsPromise;
}

const SEND_HOUR = 9;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-sync-secret, authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const secretOk = (req: Request, header: string, name: string) => env(name).length >= 12 && req.headers.get(header) === env(name);

type Row = { endpoint: string; subscription: webpush.PushSubscription; bills: PushBill[]; time_zone: string; sent: string[] };

async function send(row: Pick<Row, 'endpoint' | 'subscription'>, payload: { title: string; body: string; tag?: string }) {
  try {
    await webpush.sendNotification(row.subscription, JSON.stringify(payload), { TTL: 6 * 3600 });
    return true;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    // 404/410: the browser dropped this subscription, so forget it.
    if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', row.endpoint);
    else console.error('push failed', code, (e as Error).message);
    return false;
  }
}

async function cron() {
  const { data, error } = await db.from('push_subscriptions').select('*');
  if (error) throw error;
  let sent = 0;
  for (const row of (data ?? []) as Row[]) {
    const { date, hour } = localNow(new Date(), row.time_zone || 'UTC');
    if (hour !== SEND_HOUR) continue;
    const done = new Set(row.sent ?? []);
    const due = remindersFor(row.bills ?? [], date).filter((r) => !done.has(r.key));
    for (const r of due) if (await send(row, { title: r.title, body: r.body, tag: r.key })) done.add(r.key);
    if (due.length) {
      sent += due.length;
      // Keep the log short: only keys from the last few days can come up again.
      const cutoff = new Date(Date.parse(`${date}T00:00:00Z`) - 5 * 86400_000).toISOString().slice(0, 10);
      const keep = [...done].filter((k) => (k.split(':').at(-2) ?? '') >= cutoff);
      await db.from('push_subscriptions').update({ sent: keep.slice(-200) }).eq('endpoint', row.endpoint);
    }
  }
  return json({ ok: true, sent });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const route = new URL(req.url).pathname.split('/').filter(Boolean).pop();
  try {
    const secrets = await vault();
    if (route === 'cron' && req.method === 'POST') {
      const cronSecret = secrets.bill_push_cron ?? '';
      if (cronSecret.length < 24 || req.headers.get('x-cron-secret') !== cronSecret) return json({ error: 'Forbidden' }, 403);
      return await cron();
    }
    if (!secretOk(req, 'x-sync-secret', 'SYNC_SECRET')) return json({ error: 'Wrong or missing sync passphrase.' }, 401);
    if (route === 'key' && req.method === 'GET') return json({ publicKey: secrets.bill_push_vapid_public });
    const body = await req.json().catch(() => ({}));
    if (route === 'subscribe' && req.method === 'POST') {
      const sub = body.subscription as webpush.PushSubscription | undefined;
      if (!sub?.endpoint?.startsWith('https://')) return json({ error: 'Missing push subscription.' }, 400);
      const bills = Array.isArray(body.bills) ? (body.bills as PushBill[]).slice(0, 200) : [];
      const { error } = await db.from('push_subscriptions').upsert({
        endpoint: sub.endpoint,
        subscription: sub,
        bills,
        time_zone: typeof body.timeZone === 'string' ? body.timeZone : 'UTC',
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return json({ ok: true, bills: bills.length });
    }
    if (route === 'unsubscribe' && req.method === 'POST') {
      await db.from('push_subscriptions').delete().eq('endpoint', String(body.endpoint ?? ''));
      return json({ ok: true });
    }
    if (route === 'test' && req.method === 'POST') {
      const { data } = await db.from('push_subscriptions').select('endpoint, subscription').eq('endpoint', String(body.endpoint ?? '')).maybeSingle();
      if (!data) return json({ error: 'This device is not registered for notifications yet.' }, 404);
      const ok = await send(data as Row, { title: 'Bill reminders are on ✓', body: `You'll get a reminder at ${SEND_HOUR}:00 the day before each bill is due.` });
      return ok ? json({ ok: true }) : json({ error: 'The browser refused the notification.' }, 502);
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

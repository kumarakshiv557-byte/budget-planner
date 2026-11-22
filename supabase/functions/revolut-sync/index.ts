// Revolut sync through Enable Banking (EU open banking).
//
// Routes (all under /functions/v1/revolut-sync):
//   POST /connect   → returns { url } to send you to Revolut's consent screen
//   GET  /start     → redirects straight to Revolut's consent screen (open on a phone; no passphrase
//                     needed because starting consent reveals nothing, and reading data still needs it)
//   GET  /callback  → Enable Banking redirects here after consent; stores the session
//   GET  /status    → { connected, validUntil, accounts }
//   POST /sync      → { transactions } booked spending since body.dateFrom (default: 90 days ago)
//
// Every route except /start and /callback requires the header `x-sync-secret: <SYNC_SECRET>`.
// Secrets (set in Supabase → Edge Functions → Secrets):
//   EB_APP_ID        Enable Banking application ID
//   EB_PRIVATE_KEY   contents of the .pem file Enable Banking downloaded
//   SYNC_SECRET      a long random passphrase you also type into the app's Settings
//   EB_ASPSP_NAME    optional, defaults to "Revolut"
//   EB_COUNTRY       optional, defaults to "PT"

import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

import { base64url, normalizeTransactions, pemToPkcs8, type EbTransaction } from './eb-normalize.ts';

const EB_API = 'https://api.enablebanking.com';
const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-sync-secret, authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

let keyPromise: Promise<CryptoKey> | null = null;
function signingKey() {
  keyPromise ??= crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(env('EB_PRIVATE_KEY')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return keyPromise;
}

async function ebJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: env('EB_APP_ID') }));
  const body = base64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(), new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${base64url(new Uint8Array(sig))}`;
}

async function eb<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${EB_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await ebJwt()}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Enable Banking ${path.split('?')[0]} failed (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

function selfUrl(req: Request, route: string) {
  // Behind Supabase's gateway the function is served at /functions/v1/revolut-sync.
  return `${env('SUPABASE_URL')}/functions/v1/revolut-sync/${route}`;
}

function authorised(req: Request) {
  const secret = env('SYNC_SECRET');
  return secret.length >= 12 && req.headers.get('x-sync-secret') === secret;
}

type Aspsp = { name: string; country: string; maximum_consent_validity?: number };

async function createAuth(req: Request) {
  const name = env('EB_ASPSP_NAME') || 'Revolut';
  const country = env('EB_COUNTRY') || 'PT';
  const { aspsps } = await eb<{ aspsps: Aspsp[] }>(`/aspsps?country=${country}&psu_type=personal`);
  const bank = aspsps.find((a) => a.name.toLowerCase() === name.toLowerCase()) ?? aspsps.find((a) => a.name.toLowerCase().includes(name.toLowerCase()));
  if (!bank) throw new Error(`No bank called "${name}" in ${country}. Available: ${aspsps.map((a) => a.name).slice(0, 30).join(', ')}`);

  const maxSeconds = bank.maximum_consent_validity ?? 90 * 86400;
  const validUntil = new Date(Date.now() + Math.min(maxSeconds, 180 * 86400) * 1000 - 60_000).toISOString();
  const state = crypto.randomUUID();
  const { error } = await db.from('eb_auth_states').insert({ state });
  if (error) throw error;

  const auth = await eb<{ url: string }>('/auth', {
    method: 'POST',
    body: JSON.stringify({
      access: { valid_until: validUntil },
      aspsp: { name: bank.name, country: bank.country },
      state,
      redirect_url: selfUrl(req, 'callback'),
      psu_type: 'personal',
    }),
  });
  return { url: auth.url, bank: bank.name, validUntil };
}

// Supabase shows function responses on *.supabase.co as plain text, so keep these pages plain.
const page = (title: string, msg: string) =>
  new Response(`${title}\n\n${msg}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

async function callback(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return page('Not connected', url.searchParams.get('error_description') ?? 'Revolut did not send an authorisation code.');

  const { data: st } = await db.from('eb_auth_states').delete().eq('state', state).select().maybeSingle();
  if (!st || Date.now() - new Date(st.created_at).getTime() > 30 * 60_000) {
    return page('Link expired', 'Please press "Connect Revolut" in the app again.');
  }

  const session = await eb<{
    session_id: string;
    accounts: { uid: string; currency?: string; name?: string; account_id?: { iban?: string } }[];
    access: { valid_until: string };
  }>('/sessions', { method: 'POST', body: JSON.stringify({ code }) });

  const { error } = await db.from('eb_sessions').insert({
    session_id: session.session_id,
    accounts: session.accounts.map((a) => ({ uid: a.uid, currency: a.currency, name: a.name, iban: a.account_id?.iban ?? null })),
    valid_until: session.access.valid_until,
  });
  if (error) throw error;
  return page('Revolut connected ✓', `${session.accounts.length} account(s) linked. You can close this page. Press "Sync now" in the budget app whenever you like.`);
}

async function latestSession() {
  const { data, error } = await db
    .from('eb_sessions')
    .select('*')
    .gt('valid_until', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as null | { session_id: string; valid_until: string; accounts: { uid: string; currency?: string; name?: string; iban?: string | null }[] };
}

async function status() {
  const s = await latestSession();
  return json(s ? { connected: true, validUntil: s.valid_until, accounts: s.accounts.map((a) => ({ name: a.name, currency: a.currency })) } : { connected: false });
}

async function sync(req: Request) {
  const s = await latestSession();
  if (!s) return json({ error: 'Not connected, or the Revolut consent has expired. Press "Connect Revolut" again.' }, 409);
  const body = await req.json().catch(() => ({}));
  const dateFrom: string =
    typeof body.dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dateFrom)
      ? body.dateFrom
      : new Date(Date.now() - 89 * 86400_000).toISOString().slice(0, 10);
  const ownIbans = s.accounts.map((a) => a.iban ?? '').filter(Boolean);

  const all = [];
  for (const acc of s.accounts) {
    let key: string | undefined;
    for (let page = 0; page < 50; page++) {
      const q = new URLSearchParams({ date_from: dateFrom });
      if (key) q.set('continuation_key', key);
      const r = await eb<{ transactions: EbTransaction[]; continuation_key?: string | null }>(`/accounts/${acc.uid}/transactions?${q}`);
      all.push(...normalizeTransactions(acc.uid, r.transactions ?? [], ownIbans));
      key = r.continuation_key ?? undefined;
      if (!key) break;
    }
  }
  return json({ transactions: all, validUntil: s.valid_until, dateFrom });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const route = new URL(req.url).pathname.split('/').filter(Boolean).pop();
  try {
    if (route === 'callback' && req.method === 'GET') return await callback(req);
    if (route === 'start' && req.method === 'GET') return Response.redirect((await createAuth(req)).url, 302);
    if (!authorised(req)) return json({ error: 'Wrong or missing sync passphrase.' }, 401);
    if (route === 'connect' && req.method === 'POST') return json(await createAuth(req));
    if (route === 'status' && req.method === 'GET') return await status();
    if (route === 'sync' && req.method === 'POST') return await sync(req);
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    return route === 'callback' || route === 'start' ? page('Something went wrong', msg) : json({ error: msg }, 500);
  }
});

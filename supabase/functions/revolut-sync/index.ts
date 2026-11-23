// Revolut sync through Enable Banking (EU open banking).
//
// Routes (all under /functions/v1/revolut-sync):
//   POST /connect   → { owner?, bank?, country? } returns { url } to send someone to their bank's consent screen
//   GET  /start     → ?owner=&bank=&country= redirects straight to the bank's consent screen (open on a phone; no
//                     passphrase needed because starting consent reveals nothing, and reading data still needs it)
//   GET  /callback  → Enable Banking redirects here after consent; stores the session
//   GET  /status    → { connected, validUntil, accounts, connections: [{ owner, bank, validUntil, accounts }] }
//   POST /sync      → { transactions, income, transfers } booked spending and money in since body.dateFrom
//                     (default: 90 days ago) from every connection. body.fullFor lists owners to read the full
//                     ~90 days for (a newly connected account). Money moved between two connected accounts is
//                     left out of both lists, and its rows' ids are returned in `transfers`.
//
// Each connection belongs to an owner ("me", "wife", …): the household's people, as named in the app.
//
// Every route except /start and /callback requires the header `x-sync-secret: <SYNC_SECRET>`.
// Secrets (set in Supabase → Edge Functions → Secrets):
//   EB_APP_ID        Enable Banking application ID
//   EB_PRIVATE_KEY   contents of the .pem file Enable Banking downloaded
//   SYNC_SECRET      a long random passphrase you also type into the app's Settings
//   EB_ASPSP_NAME    optional, defaults to "Revolut"
//   EB_COUNTRY       optional, defaults to "PT"

import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

import { base64url, findTransfers, normalizeRows, pemToPkcs8, type EbTransaction, type SyncedTransaction } from './eb-normalize.ts';

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
type Who = { owner?: unknown; bank?: unknown; country?: unknown };

/** Owner labels are short ids the app uses ("me", "wife", "mom"); anything else is cut down to that shape. */
const ownerOf = (v: unknown) => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) : '') || 'me';
const textOf = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function createAuth(req: Request, who: Who = {}) {
  const owner = ownerOf(who.owner);
  const name = textOf(who.bank, 60) || env('EB_ASPSP_NAME') || 'Revolut';
  const country = (textOf(who.country, 2) || env('EB_COUNTRY') || 'PT').toUpperCase();
  const { aspsps } = await eb<{ aspsps: Aspsp[] }>(`/aspsps?country=${country}&psu_type=personal`);
  const bank = aspsps.find((a) => a.name.toLowerCase() === name.toLowerCase()) ?? aspsps.find((a) => a.name.toLowerCase().includes(name.toLowerCase()));
  if (!bank) throw new Error(`No bank called "${name}" in ${country}. Available: ${aspsps.map((a) => a.name).slice(0, 30).join(', ')}`);

  const maxSeconds = bank.maximum_consent_validity ?? 90 * 86400;
  const validUntil = new Date(Date.now() + Math.min(maxSeconds, 180 * 86400) * 1000 - 60_000).toISOString();
  const state = crypto.randomUUID();
  const { error } = await db.from('eb_auth_states').insert({ state, owner });
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
  return { url: auth.url, bank: bank.name, owner, validUntil };
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
    return page('Link expired', 'Please start connecting again from the budget app.');
  }

  const session = await eb<{
    session_id: string;
    aspsp?: { name?: string };
    accounts: { uid: string; currency?: string; name?: string; account_id?: { iban?: string } }[];
    access: { valid_until: string };
  }>('/sessions', { method: 'POST', body: JSON.stringify({ code }) });

  const { error } = await db.from('eb_sessions').insert({
    session_id: session.session_id,
    owner: st.owner ?? 'me',
    bank: session.aspsp?.name ?? null,
    accounts: session.accounts.map((a) => ({ uid: a.uid, currency: a.currency, name: a.name, iban: a.account_id?.iban ?? null })),
    valid_until: session.access.valid_until,
  });
  if (error) throw error;
  return page('Bank connected ✓', `${session.accounts.length} account(s) linked. You can close this page. Press "Sync now" in the budget app whenever you like.`);
}

type Session = {
  session_id: string;
  owner: string;
  bank: string | null;
  valid_until: string;
  accounts: { uid: string; currency?: string; name?: string; iban?: string | null }[];
};

/** The newest unexpired connection for each owner. */
async function liveSessions(): Promise<Session[]> {
  const { data, error } = await db
    .from('eb_sessions')
    .select('*')
    .gt('valid_until', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  const byOwner = new Map<string, Session>();
  for (const s of (data ?? []) as Session[]) if (!byOwner.has(s.owner ?? 'me')) byOwner.set(s.owner ?? 'me', { ...s, owner: s.owner ?? 'me' });
  return [...byOwner.values()];
}

async function status() {
  const all = await liveSessions();
  const connections = all.map((s) => ({
    owner: s.owner,
    bank: s.bank ?? 'Revolut',
    validUntil: s.valid_until,
    accounts: s.accounts.map((a) => ({ name: a.name, currency: a.currency })),
  }));
  const me = all.find((s) => s.owner === 'me');
  return json({
    connected: all.length > 0,
    ...(me ? { validUntil: me.valid_until, accounts: me.accounts.map((a) => ({ name: a.name, currency: a.currency })) } : {}),
    connections,
  });
}

async function sync(req: Request) {
  const all = await liveSessions();
  if (!all.length) return json({ error: 'No bank is connected, or the consent has expired. Connect again from Settings.' }, 409);
  const body = await req.json().catch(() => ({}));
  const full = new Date(Date.now() - 89 * 86400_000).toISOString().slice(0, 10);
  const fullFor: string[] = Array.isArray(body.fullFor) ? body.fullFor.map(ownerOf) : [];
  // A newly connected account reads the full window, and then so do the others, so that money moved
  // between them in that window can be paired up and left out.
  const dateFrom: string =
    !fullFor.some((o) => all.some((s) => s.owner === o)) && typeof body.dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dateFrom)
      ? body.dateFrom
      : full;
  const ownIbans = all.flatMap((s) => s.accounts.map((a) => a.iban ?? '')).filter(Boolean);

  const spending: SyncedTransaction[] = [];
  const income: SyncedTransaction[] = [];
  for (const s of all) {
    for (const acc of s.accounts) {
      let key: string | undefined;
      for (let page = 0; page < 50; page++) {
        const q = new URLSearchParams({ date_from: dateFrom });
        if (key) q.set('continuation_key', key);
        const r = await eb<{ transactions: EbTransaction[]; continuation_key?: string | null }>(`/accounts/${acc.uid}/transactions?${q}`);
        const n = normalizeRows(acc.uid, r.transactions ?? [], ownIbans);
        const tag = (x: SyncedTransaction) => (s.owner === 'me' ? x : { ...x, owner: s.owner });
        spending.push(...n.spending.map(tag));
        income.push(...n.income.map(tag));
        key = r.continuation_key ?? undefined;
        if (!key) break;
      }
    }
  }
  const transfers = findTransfers(spending, income);
  const skip = new Set(transfers);
  const me = all.find((s) => s.owner === 'me') ?? all[0];
  return json({
    transactions: spending.filter((t) => !skip.has(t.externalId)),
    income: income.filter((t) => !skip.has(t.externalId)),
    transfers,
    owners: all.map((s) => s.owner),
    validUntil: me.valid_until,
    dateFrom,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const route = new URL(req.url).pathname.split('/').filter(Boolean).pop();
  try {
    if (route === 'callback' && req.method === 'GET') return await callback(req);
    if (route === 'start' && req.method === 'GET') {
      const q = new URL(req.url).searchParams;
      return Response.redirect((await createAuth(req, { owner: q.get('owner'), bank: q.get('bank'), country: q.get('country') })).url, 302);
    }
    if (!authorised(req)) return json({ error: 'Wrong or missing sync passphrase.' }, 401);
    if (route === 'connect' && req.method === 'POST') return json(await createAuth(req, await req.json().catch(() => ({}))));
    if (route === 'status' && req.method === 'GET') return await status();
    if (route === 'sync' && req.method === 'POST') return await sync(req);
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    return route === 'callback' || route === 'start' ? page('Something went wrong', msg) : json({ error: msg }, 500);
  }
});

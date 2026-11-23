// Revolut sync through Enable Banking (EU open banking).
//
// Routes (all under /functions/v1/revolut-sync):
//   POST /connect   → { owner?, bank?, country? } returns { url } to send someone to their bank's consent screen
//   GET  /start     → ?owner=&bank=&country= redirects straight to the bank's consent screen (open on a phone; no
//                     passphrase needed because starting consent reveals nothing, and reading data still needs it)
//   GET  /callback  → Enable Banking redirects here after consent; stores the session
//   GET  /status    → { connected, validUntil, accounts, connections: [{ owner, bank, bankName, bic, validUntil, accounts }] }
//                     bankName/bic come from the account's SWIFT/BIC as the bank reports it.
//   GET  /banks     → ?country=PT { banks: [{ name, bic? }] } banks Enable Banking can connect to, for the app's picker
//   POST /sync      → { transactions, income, transfers } booked spending and money in since body.dateFrom
//                     (default: 90 days ago) from every connection. body.fullFor lists owners to read the full
//                     ~90 days for (a newly connected account). Money moved between two connected accounts is
//                     left out of both lists, and its rows' ids are returned in `transfers`. A connection the bank
//                     won't read is skipped and listed in `problems`; the others still sync.
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

type Aspsp = { name: string; country: string; bic?: string; maximum_consent_validity?: number };
/** The bank holding an account, as it reports itself (SWIFT/BIC and name). */
type Servicer = { bic_fi?: string | null; name?: string | null };
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
    accounts: { uid: string; currency?: string; name?: string; account_id?: { iban?: string }; account_servicer?: Servicer }[];
    access: { valid_until: string };
  }>('/sessions', { method: 'POST', body: JSON.stringify({ code }) });

  const { error } = await db.from('eb_sessions').insert({
    session_id: session.session_id,
    owner: st.owner ?? 'me',
    bank: session.aspsp?.name ?? null,
    accounts: session.accounts.map((a) => ({
      uid: a.uid,
      currency: a.currency,
      name: a.name,
      iban: a.account_id?.iban ?? null,
      bic: a.account_servicer?.bic_fi ?? '',
      servicer: a.account_servicer?.name ?? null,
    })),
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
  /** When this connection was first synced; null for a new one, which then gets its full history. */
  synced_at: string | null;
  /** bic: '' once looked up and not given; missing on connections made before it was stored. */
  accounts: { uid: string; currency?: string; name?: string; iban?: string | null; bic?: string; servicer?: string | null }[];
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

/** Fill in the SWIFT/BIC of accounts connected before it was stored (once; the result is saved). */
async function fillBics(sessions: Session[], req: Request) {
  for (const s of sessions) {
    const missing = s.accounts.filter((a) => a.bic === undefined);
    if (!missing.length) continue;
    for (const a of missing) {
      try {
        const d = await eb<{ account_servicer?: Servicer }>(`/accounts/${a.uid}/details`, { headers: psuHeaders(req) });
        a.bic = d.account_servicer?.bic_fi ?? '';
        a.servicer = d.account_servicer?.name ?? null;
      } catch (e) {
        console.error(`status: details for ${a.uid} failed`, e);
      }
    }
    if (missing.some((a) => a.bic !== undefined)) await db.from('eb_sessions').update({ accounts: s.accounts }).eq('session_id', s.session_id);
  }
}

/** Banks by the first four letters of their SWIFT/BIC, for when the bank sends a BIC but no name. */
const BIC_BANKS: Record<string, string> = {
  REVO: 'Revolut',
  TOTA: 'Santander Totta',
  CGDI: 'Caixa Geral de Depósitos',
  BCOM: 'Millennium BCP',
  BBPI: 'BPI',
  BESC: 'Novo Banco',
  CCCM: 'Crédito Agrícola',
  ACTV: 'ActivoBank',
  NTSB: 'N26',
  TRWI: 'Wise',
};

async function status(req: Request) {
  const all = await liveSessions();
  await fillBics(all, req);
  const connections = all.map((s) => {
    const withBic = s.accounts.find((a) => a.bic) ?? s.accounts[0];
    const bic = withBic?.bic || undefined;
    return {
      owner: s.owner,
      bank: s.bank ?? 'Revolut',
      bankName: withBic?.servicer || (bic && BIC_BANKS[bic.slice(0, 4).toUpperCase()]) || s.bank || 'Revolut',
      ...(bic ? { bic } : {}),
      validUntil: s.valid_until,
      accounts: s.accounts.map((a) => ({ name: a.name, currency: a.currency })),
    };
  });
  const me = all.find((s) => s.owner === 'me');
  return json({
    connected: all.length > 0,
    ...(me ? { validUntil: me.valid_until, accounts: me.accounts.map((a) => ({ name: a.name, currency: a.currency })) } : {}),
    connections,
  });
}

/** Banks Enable Banking can connect to in a country, for the app's bank picker. */
async function banks(req: Request) {
  const country = (textOf(new URL(req.url).searchParams.get('country'), 2) || 'PT').toUpperCase();
  const { aspsps } = await eb<{ aspsps: Aspsp[] }>(`/aspsps?country=${country}&psu_type=personal`);
  const list = aspsps
    .filter((a) => a.country === country)
    .map((a) => ({ name: a.name, ...(a.bic ? { bic: a.bic } : {}) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return json({ country, banks: list });
}

/** Short, readable reason from an Enable Banking error. */
function shortError(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  const detail = /"message":"([^"]+)"/.exec(m)?.[1];
  if (/ASPSP_RATE_LIMIT|ASPSP_ERROR/.test(m)) return `the bank refused to share data just now ("${detail ?? 'error'}"). It usually works again after a few hours`;
  return detail ? `the bank answered "${detail}"` : m.slice(0, 200);
}

/**
 * Headers telling the bank the person is using the app right now. Without them many banks (Santander Totta among
 * them) allow only about 4 reads a day per account, then refuse with an error until the next day.
 */
function psuHeaders(req: Request): Record<string, string> {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || '';
  const ua = req.headers.get('user-agent') ?? '';
  return {
    ...(ip ? { 'Psu-Ip-Address': ip } : {}),
    ...(ua ? { 'Psu-User-Agent': ua.slice(0, 300) } : {}),
    ...(ip || ua ? { 'Psu-Accept': 'application/json', 'Psu-Accept-Language': req.headers.get('accept-language')?.slice(0, 100) || 'en' } : {}),
  };
}

/** All booked rows of one account since dateFrom. */
async function readAccount(uid: string, dateFrom: string, ownIbans: string[], psu: Record<string, string>) {
  const read = async (headers: Record<string, string>) => {
    const spending: SyncedTransaction[] = [];
    const income: SyncedTransaction[] = [];
    let key: string | undefined;
    for (let page = 0; page < 50; page++) {
      const q = new URLSearchParams({ date_from: dateFrom });
      if (key) q.set('continuation_key', key);
      const r = await eb<{ transactions: EbTransaction[]; continuation_key?: string | null }>(`/accounts/${uid}/transactions?${q}`, { headers });
      const n = normalizeRows(uid, r.transactions ?? [], ownIbans);
      spending.push(...n.spending);
      income.push(...n.income);
      key = r.continuation_key ?? undefined;
      if (!key) break;
    }
    return { spending, income };
  };
  try {
    return await read(psu);
  } catch (e) {
    // A bank that wants more of these headers than we can give refuses them all; then read as a background fetch.
    if (Object.keys(psu).length && /PSU_HEADER/.test(e instanceof Error ? e.message : String(e))) return await read({});
    throw e;
  }
}

async function sync(req: Request) {
  const all = await liveSessions();
  if (!all.length) return json({ error: 'No bank is connected, or the consent has expired. Connect again from Settings.' }, 409);
  const body = await req.json().catch(() => ({}));
  const full = new Date(Date.now() - 89 * 86400_000).toISOString().slice(0, 10);
  const fullFor: string[] = Array.isArray(body.fullFor) ? body.fullFor.map(ownerOf) : [];
  // A newly connected account (never synced, or asked for by the app) reads the full window, and then so do
  // the others, so that money moved between them in that window can be paired up and left out.
  const fresh = all.some((s) => !s.synced_at && s.accounts.length > 0) || fullFor.some((o) => all.some((s) => s.owner === o));
  const dateFrom: string =
    !fresh && typeof body.dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dateFrom)
      ? body.dateFrom
      : full;
  const ownIbans = all.flatMap((s) => s.accounts.map((a) => a.iban ?? '')).filter(Boolean);
  const psu = psuHeaders(req);

  const spending: SyncedTransaction[] = [];
  const income: SyncedTransaction[] = [];
  /** Connections the bank wouldn't let us read; the rest still sync. */
  const problems: { owner: string; bank: string; message: string }[] = [];
  const readOwners = new Set<string>();
  const readSessions: string[] = [];
  for (const s of all) {
    let ok = s.accounts.length > 0;
    for (const acc of s.accounts) {
      try {
        const got = await readAccount(acc.uid, dateFrom, ownIbans, psu);
        const tag = (x: SyncedTransaction) => (s.owner === 'me' ? x : { ...x, owner: s.owner });
        spending.push(...got.spending.map(tag));
        income.push(...got.income.map(tag));
      } catch (e) {
        ok = false;
        console.error(`sync: ${s.owner} account ${acc.uid} failed`, e);
        problems.push({ owner: s.owner, bank: s.bank ?? 'Revolut', message: shortError(e) });
      }
    }
    if (ok) {
      readOwners.add(s.owner);
      if (!s.synced_at) readSessions.push(s.session_id);
    }
  }
  if (readSessions.length) await db.from('eb_sessions').update({ synced_at: new Date().toISOString() }).in('session_id', readSessions);
  const transfers = findTransfers(spending, income);
  const skip = new Set(transfers);
  const me = all.find((s) => s.owner === 'me') ?? all[0];
  return json({
    transactions: spending.filter((t) => !skip.has(t.externalId)),
    income: income.filter((t) => !skip.has(t.externalId)),
    transfers,
    owners: all.map((s) => s.owner).filter((o) => readOwners.has(o)),
    problems,
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
    if (route === 'status' && req.method === 'GET') return await status(req);
    if (route === 'banks' && req.method === 'GET') return await banks(req);
    if (route === 'sync' && req.method === 'POST') return await sync(req);
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    return route === 'callback' || route === 'start' ? page('Something went wrong', msg) : json({ error: msg }, 500);
  }
});

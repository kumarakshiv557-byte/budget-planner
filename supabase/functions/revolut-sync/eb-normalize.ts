// Pure helpers shared by the Edge Function and the app's tests. No Deno or Node APIs here.

/** Subset of an Enable Banking transaction that we read. */
export type EbTransaction = {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator?: 'CRDT' | 'DBIT' | string | null;
  status?: string | null;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: { name?: string | null; postal_address?: PostalAddress | null } | null;
  debtor?: { name?: string | null; postal_address?: PostalAddress | null } | null;
  creditor_account?: { iban?: string | null } | null;
  debtor_account?: { iban?: string | null } | null;
  remittance_information?: string[] | null;
  note?: string | null;
  merchant_category_code?: string | null;
  bank_transaction_code?: { description?: string | null; code?: string | null; sub_code?: string | null } | null;
  exchange_rate?: { instructed_amount?: { amount?: string | null; currency?: string | null } | null } | null;
};

type PostalAddress = { town_name?: string | null; country?: string | null; street_name?: string | null; address_line?: string[] | null };

/** Extra facts the bank shares about a payment (whatever it fills in). */
export type TxDetails = {
  /** "Card payment", "Bank transfer", or the bank's own wording. */
  kind?: string;
  /** What sort of business, from the card's merchant code, e.g. "Restaurants". */
  merchantType?: string;
  /** Town and country (or address) of the other side, when sent. */
  place?: string;
  /** The full reference text, when it says more than the description. */
  reference?: string;
  /** Amount in the original currency, for payments abroad, e.g. "GBP 12.00". */
  foreign?: string;
  /** Day the card was used, when it differs from the booking day. */
  usedOn?: string;
};

/** Merchant category codes (ISO 18245) people meet most, then broad ranges. */
const MCC: Record<string, string> = {
  '4111': 'Local transport', '4121': 'Taxi / ride-hailing', '4131': 'Buses', '4511': 'Airlines', '4784': 'Tolls', '4789': 'Transport',
  '4812': 'Phone shop', '4814': 'Phone / telecoms', '4816': 'Online services', '4829': 'Money transfer', '4899': 'TV / streaming',
  '4900': 'Utilities', '5045': 'Computers', '5094': 'Jewellery', '5200': 'Home improvement', '5251': 'Hardware store', '5261': 'Garden centre',
  '5311': 'Department store', '5331': 'Variety store', '5399': 'General merchandise', '5411': 'Supermarket', '5422': 'Butcher',
  '5441': 'Sweets', '5451': 'Dairy', '5462': 'Bakery', '5499': 'Food shop', '5532': 'Car parts', '5541': 'Fuel', '5542': 'Fuel (pump)',
  '5611': 'Menswear', '5621': "Women's clothes", '5641': "Children's clothes", '5651': 'Clothes', '5655': 'Sportswear', '5661': 'Shoes',
  '5691': 'Clothes', '5699': 'Clothes / accessories', '5712': 'Furniture', '5719': 'Homeware', '5722': 'Appliances', '5732': 'Electronics',
  '5734': 'Software', '5735': 'Music', '5812': 'Restaurants', '5813': 'Bars', '5814': 'Fast food', '5815': 'Digital media', '5816': 'Games',
  '5817': 'Apps', '5818': 'Digital goods', '5912': 'Pharmacy', '5921': 'Off-licence', '5941': 'Sports shop', '5942': 'Bookshop',
  '5943': 'Stationery', '5945': 'Toys / games', '5947': 'Gifts', '5964': 'Mail order', '5965': 'Mail order', '5968': 'Subscription',
  '5969': 'Direct selling', '5977': 'Cosmetics', '5992': 'Florist', '5993': 'Tobacco', '5994': 'Newsagent', '5995': 'Pet shop',
  '5999': 'Shop', '6010': 'Cash (bank)', '6011': 'Cash machine', '6012': 'Bank', '6051': 'Crypto / currency', '6300': 'Insurance',
  '6513': 'Rent / property', '7011': 'Hotels', '7210': 'Laundry', '7230': 'Hairdresser / beauty', '7298': 'Spa', '7299': 'Services',
  '7311': 'Advertising', '7372': 'Software / IT', '7399': 'Business services', '7512': 'Car hire', '7523': 'Parking', '7538': 'Car repair',
  '7542': 'Car wash', '7832': 'Cinema', '7841': 'Video rental', '7922': 'Tickets / theatre', '7941': 'Sports clubs', '7991': 'Tourist attractions',
  '7995': 'Betting', '7997': 'Gym / clubs', '7999': 'Recreation', '8011': 'Doctor', '8021': 'Dentist', '8042': 'Optician', '8043': 'Optician',
  '8062': 'Hospital', '8099': 'Health', '8220': 'University', '8299': 'Education', '8398': 'Charity', '8999': 'Professional services',
  '9211': 'Courts', '9222': 'Fines', '9311': 'Tax payment', '9399': 'Government', '9402': 'Post office',
};

/** Readable business type for a merchant category code. */
export function merchantType(code?: string | null): string | undefined {
  const c = (code ?? '').trim();
  if (!/^\d{4}$/.test(c)) return undefined;
  if (MCC[c]) return MCC[c];
  const n = Number(c);
  if (n >= 3000 && n <= 3299) return 'Airlines';
  if (n >= 3351 && n <= 3441) return 'Car hire';
  if (n >= 3501 && n <= 3999) return 'Hotels';
  if (n >= 5811 && n <= 5814) return 'Food & drink';
  return undefined;
}

/** What the bank tells us about a row beyond its short description. Empty fields are left out. */
export function detailsOf(t: EbTransaction, isDebit: boolean, description: string, date: string): TxDetails | undefined {
  const d: TxDetails = {};
  const mt = merchantType(t.merchant_category_code);
  if (mt) d.merchantType = mt;
  const otherAccount = isDebit ? t.creditor_account?.iban : t.debtor_account?.iban;
  const code = t.bank_transaction_code?.description?.trim();
  if (t.merchant_category_code) d.kind = 'Card payment';
  else if (code) d.kind = code;
  else if (otherAccount) d.kind = 'Bank transfer';
  const addr = (isDebit ? t.creditor : t.debtor)?.postal_address;
  if (addr) {
    const parts = [addr.street_name, ...(addr.address_line ?? []), addr.town_name, addr.country].map((x) => x?.trim()).filter(Boolean);
    if (parts.length) d.place = [...new Set(parts)].join(', ');
  }
  const ref = [...(t.remittance_information ?? []), t.note ?? ''].map((x) => x.trim()).filter(Boolean).join(' · ');
  if (ref && ref.toLowerCase() !== description.toLowerCase()) d.reference = ref.slice(0, 300);
  const fx = t.exchange_rate?.instructed_amount;
  if (fx?.currency && fx.amount && fx.currency !== t.transaction_amount.currency) d.foreign = `${fx.currency} ${Math.abs(Number(fx.amount)).toFixed(2)}`;
  const used = (t.transaction_date ?? '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(used) && used !== date) d.usedOn = used;
  return Object.keys(d).length ? d : undefined;
}

/** A bank row in the shape the app imports. Spending is positive. */
export type SyncedTransaction = {
  externalId: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  /** Whose bank connection it came from ("me", "wife", …). Missing means "me". */
  owner?: string;
  details?: TxDetails;
};

/**
 * Split bank rows into spending and income.
 * - Only booked rows (status BOOK, or no status).
 * - Money out (DBIT) becomes positive spending; money in (CRDT) becomes positive income.
 * - Transfers between your own accounts (e.g. a Revolut pocket) are skipped both ways.
 */
export function normalizeRows(
  accountUid: string,
  rows: EbTransaction[],
  ownIbans: string[] = [],
): { spending: SyncedTransaction[]; income: SyncedTransaction[] } {
  const own = new Set(ownIbans.filter(Boolean).map((i) => i.replace(/\s/g, '').toUpperCase()));
  const spending: SyncedTransaction[] = [];
  const income: SyncedTransaction[] = [];
  for (const t of rows) {
    if (t.status && t.status !== 'BOOK') continue;
    const raw = Number(t.transaction_amount?.amount);
    if (!Number.isFinite(raw) || raw === 0) continue;
    // Some banks send signed amounts instead of an indicator.
    const isDebit = t.credit_debit_indicator ? t.credit_debit_indicator === 'DBIT' : raw < 0;
    const otherIban = (isDebit ? t.creditor_account?.iban : t.debtor_account?.iban)?.replace(/\s/g, '').toUpperCase();
    if (otherIban && own.has(otherIban)) continue;

    const date = (t.booking_date || t.transaction_date || t.value_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const party = isDebit ? t.creditor?.name : t.debtor?.name;
    const description =
      party?.trim() ||
      (t.remittance_information ?? []).join(' ').trim() ||
      t.note?.trim() ||
      (isDebit ? 'Revolut payment' : 'Money in');
    const ref = t.entry_reference || t.transaction_id || `${date}|${description}|${raw}`;
    const details = detailsOf(t, isDebit, description, date);
    (isDebit ? spending : income).push({
      externalId: `eb:${accountUid}:${ref}`,
      date,
      description,
      amount: Math.round(Math.abs(raw) * 100) / 100,
      currency: t.transaction_amount.currency,
      ...(details ? { details } : {}),
    });
  }
  return { spending, income };
}

/** The bank account a synced row came from (its externalId is `eb:<account uid>:<ref>`). */
const accountOf = (r: SyncedTransaction) => r.externalId.split(':')[1] ?? '';

/**
 * Money moved between two of your connected accounts (say from yours to your wife's) shows up as spending
 * in one and income in the other. Pair them up: same amount and currency, different accounts, booked at most
 * `days` apart. Each row is used at most once. Returns the externalIds of both sides of every pair.
 */
export function findTransfers(spending: SyncedTransaction[], income: SyncedTransaction[], days = 3): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  const dayOf = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400_000;
  for (const s of [...spending].sort((a, b) => a.date.localeCompare(b.date))) {
    let best: SyncedTransaction | undefined;
    for (const i of income) {
      if (used.has(i.externalId) || i.currency !== s.currency || i.amount !== s.amount) continue;
      if (accountOf(i) === accountOf(s)) continue;
      const gap = Math.abs(dayOf(i.date) - dayOf(s.date));
      if (gap > days) continue;
      if (!best || gap < Math.abs(dayOf(best.date) - dayOf(s.date))) best = i;
    }
    if (best) {
      used.add(best.externalId);
      out.push(s.externalId, best.externalId);
    }
  }
  return out;
}

/** Spending rows only (money out, positive). */
export function normalizeTransactions(accountUid: string, rows: EbTransaction[], ownIbans: string[] = []): SyncedTransaction[] {
  return normalizeRows(accountUid, rows, ownIbans).spending;
}

/** Wrap a PKCS#1 RSA key ("BEGIN RSA PRIVATE KEY") in a PKCS#8 envelope so WebCrypto can import it. */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const rsaOid = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const len = (n: number) =>
    n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 0xff] : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff];
  const octet = [0x04, ...len(pkcs1.length)];
  const body = [0x02, 0x01, 0x00, ...rsaOid, ...octet];
  const total = body.length + pkcs1.length;
  const out = new Uint8Array([0x30, ...len(total), ...body]);
  const result = new Uint8Array(out.length + pkcs1.length);
  result.set(out, 0);
  result.set(pkcs1, out.length);
  return result;
}

/** PEM text → DER bytes in PKCS#8 form. */
export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const isPkcs1 = pem.includes('BEGIN RSA PRIVATE KEY');
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return isPkcs1 ? pkcs1ToPkcs8(der) : der;
}

export function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

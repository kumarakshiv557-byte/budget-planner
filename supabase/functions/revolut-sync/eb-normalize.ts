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
  creditor?: { name?: string | null } | null;
  debtor?: { name?: string | null } | null;
  creditor_account?: { iban?: string | null } | null;
  debtor_account?: { iban?: string | null } | null;
  remittance_information?: string[] | null;
  note?: string | null;
};

/** A bank row in the shape the app imports. Spending is positive. */
export type SyncedTransaction = {
  externalId: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
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
    (isDebit ? spending : income).push({
      externalId: `eb:${accountUid}:${ref}`,
      date,
      description,
      amount: Math.round(Math.abs(raw) * 100) / 100,
      currency: t.transaction_amount.currency,
    });
  }
  return { spending, income };
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

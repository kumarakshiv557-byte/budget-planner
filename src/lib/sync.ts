import { matchRule, typeFor } from './budget.ts';
import type { BudgetState, Income, Transaction } from './types.ts';
import type { SyncedTransaction } from '../../supabase/functions/revolut-sync/eb-normalize.ts';

export type { SyncedTransaction };

/** Turn rows from the sync backend into app transactions, skipping ones already imported. */
export function mergeSynced(state: BudgetState, rows: SyncedTransaction[], idFor: () => string): Transaction[] {
  const seen = new Set([...state.transactions.map((t) => t.externalId).filter(Boolean), ...(state.transferIds ?? [])]);
  const out: Transaction[] = [];
  for (const r of rows) {
    if (seen.has(r.externalId)) continue;
    seen.add(r.externalId);
    const rule = matchRule(r.description, state.rules);
    const categoryId = rule?.categoryId ?? null;
    out.push({
      id: idFor(),
      date: r.date,
      description: r.description,
      amount: r.amount,
      categoryId,
      ...(rule?.subcategoryId ? { subcategoryId: rule.subcategoryId } : {}),
      type: typeFor(r.description, state.rules),
      ...(rule?.payment ? { payment: rule.payment } : {}),
      ...(rule?.note ? { note: rule.note } : {}),
      ...(r.owner && r.owner !== 'me' ? { owner: r.owner } : {}),
      source: 'revolut',
      externalId: r.externalId,
    });
  }
  return out;
}

/** Turn synced money-in rows into income, skipping ones already imported. */
export function mergeSyncedIncome(state: BudgetState, rows: SyncedTransaction[], idFor: () => string): Income[] {
  const seen = new Set([...(state.income ?? []).map((t) => t.externalId).filter(Boolean), ...(state.transferIds ?? [])]);
  const out: Income[] = [];
  for (const r of rows) {
    if (seen.has(r.externalId)) continue;
    seen.add(r.externalId);
    out.push({
      id: idFor(),
      date: r.date,
      description: r.description,
      amount: r.amount,
      source: 'revolut',
      externalId: r.externalId,
      ...(r.owner && r.owner !== 'me' ? { owner: r.owner } : {}),
    });
  }
  return out;
}

export type SyncConfig = { url: string; secret: string };

export type Connection = { owner: string; bank: string; validUntil: string; accounts: { name?: string; currency?: string }[] };
export type SyncStatus = {
  connected: boolean;
  validUntil?: string;
  accounts?: { name?: string; currency?: string }[];
  /** One per person with a live bank connection (older servers leave this out). */
  connections?: Connection[];
};

/** A link someone opens on their own phone to connect their bank (no passphrase needed to start consent). */
export function connectLink(cfg: SyncConfig, owner: string, bank: string, country: string) {
  const q = new URLSearchParams({ owner, bank: bank.trim() || 'Revolut', country: (country.trim() || 'PT').toUpperCase() });
  return `${cfg.url.replace(/\/+$/, '')}/start?${q}`;
}

/**
 * Bank rows to import as lines, and the transfers between your own accounts to take out.
 * Transfers already imported as spending or income before both accounts were connected are removed too.
 */
export function applyTransfers(state: BudgetState, transfers: string[]): Pick<BudgetState, 'transactions' | 'income' | 'transferIds'> {
  const ids = new Set(transfers);
  return {
    transactions: state.transactions.filter((t) => !t.externalId || !ids.has(t.externalId)),
    income: state.income.filter((t) => !t.externalId || !ids.has(t.externalId)),
    transferIds: [...new Set([...(state.transferIds ?? []), ...transfers])].slice(-2000),
  };
}

async function call<T>(cfg: SyncConfig, route: string, init: RequestInit = {}): Promise<T> {
  const base = cfg.url.replace(/\/+$/, '');
  const res = await fetch(`${base}/${route}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-sync-secret': cfg.secret, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Sync server returned ${res.status}`);
  return body as T;
}

export const syncApi = {
  status: (cfg: SyncConfig) => call<SyncStatus>(cfg, 'status'),
  connect: (cfg: SyncConfig, who: { owner?: string; bank?: string; country?: string } = {}) =>
    call<{ url: string; bank: string; validUntil: string }>(cfg, 'connect', { method: 'POST', body: JSON.stringify(who) }),
  sync: (cfg: SyncConfig, dateFrom?: string, fullFor: string[] = []) =>
    call<{
      transactions: SyncedTransaction[];
      income?: SyncedTransaction[];
      /** Both sides of money moved between two connected accounts (left out of the lists above). */
      transfers?: string[];
      /** Whose connections were read. */
      owners?: string[];
      /** Connections the bank wouldn't read (fully); the rest synced. */
      problems?: { owner: string; bank: string; message: string }[];
      validUntil: string;
      dateFrom: string;
    }>(cfg, 'sync', {
      method: 'POST',
      body: JSON.stringify({ ...(dateFrom ? { dateFrom } : {}), ...(fullFor.length ? { fullFor } : {}) }),
    }),
};

/** Re-fetch a few days before the last sync so late-booking card payments are not missed. */
export function nextDateFrom(lastSyncedAt: string | undefined, now = new Date()): string | undefined {
  if (!lastSyncedAt) return undefined; // server default: last ~90 days
  const d = new Date(lastSyncedAt);
  d.setUTCDate(d.getUTCDate() - 5);
  const floor = new Date(now.getTime() - 89 * 86400_000);
  return (d < floor ? floor : d).toISOString().slice(0, 10);
}

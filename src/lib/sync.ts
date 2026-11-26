import { isTransferLine, matchRule, transferRuleOf } from './budget.ts';
import type { BudgetState, Income, Transaction, TransferLine } from './types.ts';
import { findTransfers, type SyncedTransaction } from '../../supabase/functions/revolut-sync/eb-normalize.ts';

export type { SyncedTransaction };

/** Turn rows from the sync backend into app transactions, skipping ones already imported. */
export function mergeSynced(state: BudgetState, rows: SyncedTransaction[], idFor: () => string): Transaction[] {
  const seen = new Set([...state.transactions.map((t) => t.externalId).filter(Boolean), ...(state.transferIds ?? [])]);
  const out: Transaction[] = [];
  for (const r of rows) {
    if (seen.has(r.externalId) || isTransferLine(r.description, state.transferRules)) continue;
    seen.add(r.externalId);
    const rule = matchRule(r.description, state.rules, r.amount);
    const categoryId = rule?.categoryId ?? null;
    out.push({
      id: idFor(),
      date: r.date,
      description: r.description,
      amount: r.amount,
      categoryId,
      ...(rule?.subcategoryId ? { subcategoryId: rule.subcategoryId } : {}),
      type: rule?.type ?? 'variable-one-time',
      ...(rule?.payment ? { payment: rule.payment } : {}),
      ...(rule?.note ? { note: rule.note } : {}),
      ...(r.owner && r.owner !== 'me' ? { owner: r.owner } : {}),
      ...(r.details ? { details: r.details } : {}),
      source: 'revolut',
      externalId: r.externalId,
    });
  }
  return out;
}

/** Bank details for lines already here that don't have them yet, by externalId. */
export function detailsFor(state: BudgetState, rows: SyncedTransaction[]): Record<string, NonNullable<Transaction['details']>> {
  const missing = new Set(state.transactions.filter((t) => t.externalId && !t.details).map((t) => t.externalId!));
  const out: Record<string, NonNullable<Transaction['details']>> = {};
  for (const r of rows) if (r.details && missing.has(r.externalId)) out[r.externalId] = r.details;
  return out;
}

/** Turn synced money-in rows into income, skipping ones already imported. */
export function mergeSyncedIncome(state: BudgetState, rows: SyncedTransaction[], idFor: () => string): Income[] {
  const seen = new Set([...(state.income ?? []).map((t) => t.externalId).filter(Boolean), ...(state.transferIds ?? [])]);
  const out: Income[] = [];
  for (const r of rows) {
    if (seen.has(r.externalId) || isTransferLine(r.description, state.transferRules)) continue;
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

/** Where this device keeps the sync server URL and passphrase. */
export const SYNC_CONFIG_KEY = 'budget-planner/sync-config/v1';

export type Connection = {
  owner: string;
  /** The bank's name in Enable Banking (what a new link must use). */
  bank: string;
  /** The bank as the account itself reports it (from its SWIFT/BIC). */
  bankName?: string;
  bic?: string;
  validUntil: string;
  accounts: { name?: string; currency?: string }[];
};
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
/**
 * Transfers between two connected accounts whose two sides came in on different syncs (the server only pairs
 * rows from one sync). Only unsorted spending from the last ~100 days is considered, so nothing you sorted moves.
 */
export function findSyncedTransfers(state: BudgetState, today = new Date()): string[] {
  const since = new Date(today.getTime() - 100 * 86400_000).toISOString().slice(0, 10);
  const shape = (t: Transaction | Income): SyncedTransaction => ({
    externalId: t.externalId!,
    date: t.date,
    description: t.description,
    amount: t.amount,
    currency: state.currency,
  });
  const out = state.transactions.filter((t) => t.externalId?.startsWith('eb:') && !t.categoryId && t.date >= since).map(shape);
  const inn = state.income.filter((t) => t.externalId?.startsWith('eb:') && t.date >= since).map(shape);
  return findTransfers(out, inn);
}

/**
 * Bank lines a sync leaves out as transfers, to list on the Income tab: rows matching a remembered transfer, rows
 * the server paired, and lines already here that `paired` takes out. Lines already listed are skipped.
 */
export function transferLinesFrom(
  state: BudgetState,
  res: { transactions: SyncedTransaction[]; income?: SyncedTransaction[]; transferLines?: { spending: SyncedTransaction[]; income: SyncedTransaction[] } },
  paired: string[] = [],
): TransferLine[] {
  const seen = new Set((state.transferLog ?? []).map((x) => `${x.dir}:${x.externalId}`));
  const out: TransferLine[] = [];
  const add = (r: { externalId?: string; date: string; description: string; amount: number; owner?: string }, dir: 'in' | 'out', why: string) => {
    if (!r.externalId || seen.has(`${dir}:${r.externalId}`)) return;
    seen.add(`${dir}:${r.externalId}`);
    out.push({ externalId: r.externalId, date: r.date, description: r.description, amount: r.amount, ...(r.owner && r.owner !== 'me' ? { owner: r.owner } : {}), dir, why });
  };
  for (const r of res.transactions) {
    const rule = transferRuleOf(r.description, state.transferRules);
    if (rule) add(r, 'out', rule);
  }
  for (const r of res.income ?? []) {
    const rule = transferRuleOf(r.description, state.transferRules);
    if (rule) add(r, 'in', rule);
  }
  for (const r of res.transferLines?.spending ?? []) add(r, 'out', 'pair');
  for (const r of res.transferLines?.income ?? []) add(r, 'in', 'pair');
  const ids = new Set(paired);
  for (const t of state.transactions) if (t.externalId && ids.has(t.externalId)) add(t, 'out', 'pair');
  for (const t of state.income) if (t.externalId && ids.has(t.externalId)) add(t, 'in', 'pair');
  return out;
}

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
  banks: (cfg: SyncConfig, country: string) =>
    call<{ country: string; banks: { name: string; bic?: string }[] }>(cfg, `banks?country=${encodeURIComponent(country)}`),
  connect: (cfg: SyncConfig, who: { owner?: string; bank?: string; country?: string } = {}) =>
    call<{ url: string; bank: string; validUntil: string }>(cfg, 'connect', { method: 'POST', body: JSON.stringify(who) }),
  sync: (cfg: SyncConfig, dateFrom?: string, fullFor: string[] = []) =>
    call<{
      transactions: SyncedTransaction[];
      income?: SyncedTransaction[];
      /** Both sides of money moved between two connected accounts (left out of the lists above). */
      transfers?: string[];
      /** The rows behind `transfers` (newer servers only). */
      transferLines?: { spending: SyncedTransaction[]; income: SyncedTransaction[] };
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
